// APNG byte helpers: retime an existing animation (APNG has no playbackRate)
// and encode RGBA frames into a new one for "My character".

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array, start: number, end: number): number {
  let crc = 0xffffffff;
  for (let i = start; i < end; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// Scale every frame delay by 1/speed in place, fixing each fcTL checksum.
export type Bytes = Uint8Array<ArrayBuffer>;

export function retimeApng(bytes: Bytes, speed: number): Bytes {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = 8; offset < bytes.length;) {
    const length = view.getUint32(offset);
    if (view.getUint32(offset + 4) === 0x6663544c) { // fcTL
      const delay = view.getUint16(offset + 28) / (view.getUint16(offset + 30) || 100);
      view.setUint16(offset + 28, Math.max(1, Math.round(delay / speed * 10000)));
      view.setUint16(offset + 30, 10000);
      view.setUint32(offset + 8 + length, crc32(bytes, offset + 4, offset + 8 + length));
    }
    offset += length + 12;
  }
  return bytes;
}

async function deflate(data: Bytes): Promise<Bytes> {
  const stream = new Blob([data]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// PNG adaptive filtering: per row, the filter with the smallest absolute sum.
function filterRows(rgba: Uint8ClampedArray, w: number, h: number): Bytes {
  const stride = w * 4;
  const out = new Uint8Array(h * (stride + 1));
  const candidates = [0, 1, 2, 4].map(() => new Uint8Array(stride));
  for (let y = 0; y < h; y++) {
    const row = y * stride;
    const prev = row - stride;
    let best = 0;
    let bestScore = Infinity;
    for (let f = 0; f < 4; f++) {
      const type = [0, 1, 2, 4][f];
      const buf = candidates[f];
      let score = 0;
      for (let x = 0; x < stride; x++) {
        const cur = rgba[row + x];
        const a = x >= 4 ? rgba[row + x - 4] : 0;
        const b = y > 0 ? rgba[prev + x] : 0;
        const c = x >= 4 && y > 0 ? rgba[prev + x - 4] : 0;
        let v: number;
        if (type === 0) v = cur;
        else if (type === 1) v = cur - a;
        else if (type === 2) v = cur - b;
        else {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          v = cur - (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
        }
        v &= 0xff;
        buf[x] = v;
        score += v < 128 ? v : 256 - v;
      }
      if (score < bestScore) {
        bestScore = score;
        best = f;
      }
    }
    out[y * (stride + 1)] = [0, 1, 2, 4][best];
    out.set(candidates[best], y * (stride + 1) + 1);
  }
  return out;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.length + 12);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out, 4, 8 + data.length));
  return out;
}

// Full-cell RGBA frames at a fixed fps; plays = 0 loops forever.
export async function encodeApng(
  frames: Uint8ClampedArray[],
  w: number,
  h: number,
  fps: number,
  plays = 0,
): Promise<Bytes> {
  const parts: Uint8Array[] = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])];
  const ihdr = new Uint8Array(13);
  const ih = new DataView(ihdr.buffer);
  ih.setUint32(0, w);
  ih.setUint32(4, h);
  ihdr.set([8, 6, 0, 0, 0], 8);
  parts.push(chunk("IHDR", ihdr));
  const actl = new Uint8Array(8);
  new DataView(actl.buffer).setUint32(0, frames.length);
  new DataView(actl.buffer).setUint32(4, plays);
  parts.push(chunk("acTL", actl));
  let seq = 0;
  for (let i = 0; i < frames.length; i++) {
    const fctl = new Uint8Array(26);
    const fv = new DataView(fctl.buffer);
    fv.setUint32(0, seq++);
    fv.setUint32(4, w);
    fv.setUint32(8, h);
    fv.setUint16(20, 1);
    fv.setUint16(22, fps);
    parts.push(chunk("fcTL", fctl)); // dispose 0, blend 0 (source)
    const data = await deflate(filterRows(frames[i], w, h));
    if (i === 0) {
      parts.push(chunk("IDAT", data));
    } else {
      const fdat = new Uint8Array(data.length + 4);
      new DataView(fdat.buffer).setUint32(0, seq++);
      fdat.set(data, 4);
      parts.push(chunk("fdAT", fdat));
    }
  }
  parts.push(chunk("IEND", new Uint8Array(0)));
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
