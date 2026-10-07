// Click-through hit testing: the pet window is a 240×320 transparent box, but
// only the pixels the character actually draws should take the mouse. A
// sprite's mask is the union of every APNG frame's alpha > 0, so it covers
// whatever the animation ever shows; the margin makes thin edges easy to grab.

export type AlphaMask = Readonly<{ width: number; height: number; data: Uint8Array }>;

type Rect = Readonly<{ left: number; top: number; width: number; height: number }>;

type Frame = { width: number; height: number; x: number; y: number; parts: Uint8Array[] };

const PNG_SIGNATURE_LENGTH = 8;

async function inflate(parts: Uint8Array[]): Promise<Uint8Array> {
  const stream = new Blob(parts as BlobPart[]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

// Undo PNG row filters; returns the raw scanlines without filter bytes.
function unfilter(data: Uint8Array, rowBytes: number, rows: number, bpp: number): Uint8Array {
  const out = new Uint8Array(rowBytes * rows);
  for (let y = 0; y < rows; y++) {
    const type = data[y * (rowBytes + 1)];
    const src = y * (rowBytes + 1) + 1;
    const row = y * rowBytes;
    const prev = row - rowBytes;
    for (let x = 0; x < rowBytes; x++) {
      const a = x >= bpp ? out[row + x - bpp] : 0;
      const b = y > 0 ? out[prev + x] : 0;
      const c = x >= bpp && y > 0 ? out[prev + x - bpp] : 0;
      const v = data[src + x];
      out[row + x] =
        type === 1 ? v + a
        : type === 2 ? v + b
        : type === 3 ? v + ((a + b) >> 1)
        : type === 4 ? v + paeth(a, b, c)
        : v;
    }
  }
  return out;
}

type Format = { colorType: number; bitDepth: number; interlaced: boolean; trns: Uint8Array | null };

// Alpha of every pixel of one decoded frame, or null when the format has no
// per-pixel alpha we can read (the whole frame rectangle then counts as drawn).
function frameAlpha(raw: Uint8Array, w: number, h: number, f: Format): Uint8Array | null {
  const alpha = new Uint8Array(w * h);
  const { colorType, bitDepth } = f;
  if (colorType === 3) {
    const trns = f.trns;
    const rowBytes = Math.ceil((w * bitDepth) / 8);
    const mask = (1 << bitDepth) - 1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const bit = x * bitDepth;
        const index = (raw[y * rowBytes + (bit >> 3)] >> (8 - bitDepth - (bit & 7))) & mask;
        alpha[y * w + x] = trns && index < trns.length ? trns[index] : 255;
      }
    }
    return alpha;
  }
  if (colorType === 6 || colorType === 4) {
    const channels = colorType === 6 ? 4 : 2;
    const bytes = bitDepth / 8;
    const stride = channels * bytes;
    for (let i = 0; i < w * h; i++) alpha[i] = raw[i * stride + (channels - 1) * bytes];
    return alpha;
  }
  return null;
}

function bytesPerPixel(f: Format): number {
  const channels = f.colorType === 6 ? 4 : f.colorType === 4 ? 2 : f.colorType === 2 ? 3 : 1;
  return Math.max(1, (channels * f.bitDepth) >> 3);
}

function rowBytesFor(w: number, f: Format): number {
  const channels = f.colorType === 6 ? 4 : f.colorType === 4 ? 2 : f.colorType === 2 ? 3 : 1;
  return Math.ceil((w * channels * f.bitDepth) / 8);
}

// Split a PNG/APNG into its frames (IDAT is the default image; each fcTL
// starts an animation frame, whose data follows in IDAT or fdAT chunks).
export function parseFrames(bytes: Uint8Array): { width: number; height: number; format: Format; frames: Frame[] } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0;
  let height = 0;
  const format: Format = { colorType: 6, bitDepth: 8, interlaced: false, trns: null };
  const frames: Frame[] = [];
  let current: Frame | null = null;
  let defaultImage: Frame | null = null;
  for (let o = PNG_SIGNATURE_LENGTH; o + 8 <= bytes.length;) {
    const length = view.getUint32(o);
    const type = String.fromCharCode(...bytes.subarray(o + 4, o + 8));
    const body = bytes.subarray(o + 8, o + 8 + length);
    if (type === "IHDR") {
      width = view.getUint32(o + 8);
      height = view.getUint32(o + 12);
      format.bitDepth = body[8];
      format.colorType = body[9];
      format.interlaced = body[12] !== 0;
    } else if (type === "tRNS") {
      format.trns = body.slice();
    } else if (type === "fcTL") {
      current = {
        width: view.getUint32(o + 12),
        height: view.getUint32(o + 16),
        x: view.getUint32(o + 20),
        y: view.getUint32(o + 24),
        parts: [],
      };
      frames.push(current);
    } else if (type === "IDAT") {
      if (current) current.parts.push(body);
      else {
        defaultImage ??= { width, height, x: 0, y: 0, parts: [] };
        defaultImage.parts.push(body);
      }
    } else if (type === "fdAT" && current) {
      current.parts.push(body.subarray(4));
    } else if (type === "IEND") {
      break;
    }
    o += length + 12;
  }
  if (defaultImage) frames.unshift(defaultImage);
  return { width, height, format, frames };
}

export async function apngAlphaMask(bytes: Uint8Array): Promise<AlphaMask> {
  const { width, height, format, frames } = parseFrames(bytes);
  const data = new Uint8Array(width * height);
  for (const frame of frames) {
    const alpha = format.interlaced
      ? null
      : frameAlpha(
          unfilter(await inflate(frame.parts), rowBytesFor(frame.width, format), frame.height, bytesPerPixel(format)),
          frame.width,
          frame.height,
          format,
        );
    for (let y = 0; y < frame.height; y++) {
      const ty = frame.y + y;
      if (ty >= height) break;
      for (let x = 0; x < frame.width; x++) {
        const tx = frame.x + x;
        if (tx >= width) break;
        if (!alpha || alpha[y * frame.width + x] > 0) data[ty * width + tx] = 1;
      }
    }
  }
  return { width, height, data };
}

// Map a window-local CSS point onto the sprite's pixel grid. The image keeps
// its aspect ratio, so the element box maps linearly; a mirrored sprite
// (--flip: -1) reads its mask from the other side.
export function spritePoint(
  x: number,
  y: number,
  rect: Rect,
  mask: Pick<AlphaMask, "width" | "height">,
  flipped: boolean,
): { x: number; y: number; perCss: number } {
  const perCss = mask.width / rect.width;
  let sx = (x - rect.left) * perCss;
  if (flipped) sx = mask.width - sx;
  return { x: sx, y: (y - rect.top) * (mask.height / rect.height), perCss };
}

// True when any drawn pixel lies within `radius` sprite pixels of (x, y).
export function hitsMask(mask: AlphaMask, x: number, y: number, radius: number): boolean {
  const r = Math.max(0, Math.ceil(radius));
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  const x0 = Math.max(0, cx - r);
  const x1 = Math.min(mask.width - 1, cx + r);
  const y0 = Math.max(0, cy - r);
  const y1 = Math.min(mask.height - 1, cy + r);
  for (let py = y0; py <= y1; py++) {
    const dy = py - cy;
    for (let px = x0; px <= x1; px++) {
      const dx = px - cx;
      if (dx * dx + dy * dy <= r * r && mask.data[py * mask.width + px]) return true;
    }
  }
  return false;
}

export function insideRect(x: number, y: number, rect: Rect, margin: number): boolean {
  return (
    x >= rect.left - margin &&
    x <= rect.left + rect.width + margin &&
    y >= rect.top - margin &&
    y <= rect.top + rect.height + margin
  );
}
