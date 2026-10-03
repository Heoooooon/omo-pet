// "My character" pipeline, run in the settings window. Rust talks to the
// user's own Grok login / Codex CLI and stores files in a job folder; this
// side keys the chroma background, finds loops and encodes the APNGs.
import { invoke } from "@tauri-apps/api/core";
import { encodeApng, type Bytes } from "./apng";
import { jobUrl } from "./packs";
import type { Instrument } from "./settings-store";

export type ToolStatus = {
  grok_installed: boolean;
  grok_login: "ok" | "expired" | "missing" | "unreadable";
  codex_installed: boolean;
  codex_logged_in: boolean;
};

export type StepId = "side" | "play" | "chute" | "idle" | "walk" | "fall" | "playAnim" | "pack";
export type StepStatus = "wait" | "run" | "done" | "fail";
export type OnStep = (id: StepId, status: StepStatus, detail?: string) => void;

export type Built = {
  job: string;
  previews: Partial<Record<"idle" | "walk" | "fall" | "play", string>>;
  stride?: number;
};

type RGB = [number, number, number];
const KEYS: Record<"magenta" | "green", RGB> = { magenta: [255, 0, 255], green: [0, 255, 0] };
const FPS = 24;
const CELL_W = 192; // same cell and body height as the bundled omo-cat idle
const CELL_H = 256;
const BODY_H = 224;
const PLAY_MAX_W = 400;

const INSTRUMENT_PHRASE: Record<Instrument, [string, string]> = {
  vocal: [
    "singing happily into a small plain black handheld microphone held close to its mouth",
    "sings into its microphone: its mouth opens and closes in time like singing, its head sways gently to the beat",
  ],
  guitar: [
    "playing a small plain electric guitar held across its body on a strap, one hand on the neck and the other strumming",
    "plays the guitar: the strumming hand moves up and down over the strings in a steady rhythm, its head bobs to the beat",
  ],
  bass: [
    "playing a plain electric bass guitar with a long neck held across its body on a strap, one hand on the neck and the other plucking",
    "plays the bass: the plucking hand picks the strings in a steady groove, its head nods to the beat",
  ],
  drums: [
    "sitting on a small stool behind a compact plain drum kit (bass drum, snare, hi-hat, one cymbal), holding two drumsticks",
    "plays the drums: both drumsticks hit the snare and hi-hat alternately in a steady rhythm while the kit itself stays still",
  ],
  keys: [
    "standing behind a small plain keyboard synthesizer on an X-shaped stand with both hands on the keys",
    "plays the keyboard: both hands press the keys in a bouncy rhythm while the keyboard and stand stay still",
  ],
};

function background(key: "magenta" | "green") {
  const fill = key === "magenta" ? "pure magenta #FF00FF" : "pure chroma green #00FF00";
  return `Whole body fully visible with generous empty margin on every side. Background: one perfectly flat ${fill} fill edge to edge, no shadow, no floor, no gradient, no text, no other objects or characters.`;
}

const KEEP =
  "Keep the character's exact design, colors, outfit, proportions and drawing style from the reference image, as a clean 2D cartoon sprite with a clear outline. No logos or text anywhere.";

function stillPrompts(inst: Instrument, key: "magenta" | "green") {
  return {
    side: `Redraw the character from the reference image as a full-body game sprite: side view facing right, standing upright and relaxed with arms down at its sides. ${KEEP} ${background(key)}`,
    play: `The same character as the reference image, ${INSTRUMENT_PHRASE[inst][0]}, seen in a three-quarter front view turned slightly to the right toward the viewer, cheerful. The whole instrument is fully inside the picture. ${KEEP} ${background(key)}`,
    chute: `The same character as the reference image hangs calmly from the straps of an open round parachute above its head, seen from the front, legs dangling, smiling. The whole parachute and the character are fully inside the picture. ${KEEP} ${background(key)}`,
  };
}

const LOCKED =
  "It stays centered in the frame and does not move across the screen; the whole body always stays fully inside the frame. Camera completely locked, no zoom, no pan. The background stays a perfectly flat, pure chroma-key fill for the whole clip: no shadows, no ground line, no particles, no lighting changes. Keep the drawing style and colors exactly as in the first frame.";
const LOOPS = " The clip ends exactly on the starting pose so it loops seamlessly.";

function videoPrompts(inst: Instrument) {
  return {
    idle: `2D game sprite animation. The character stands in place and breathes gently: its body rises and falls slightly, it blinks once and its head tilts a tiny bit and back. Its feet stay planted. ${LOCKED}${LOOPS}`,
    walk: `2D game sprite animation. The character walks in place toward the right with a steady, natural walking cycle like on a treadmill: legs alternate full steps, arms swing gently, the body bobs slightly. Seen from the exact side, facing right. ${LOCKED}`,
    fall: `2D game sprite animation. The character glides down under its open parachute, held in place in the frame: character and canopy sway together in a slow gentle pendulum, its legs dangle and the canopy ripples softly while staying fully open. ${LOCKED}${LOOPS}`,
    play: `2D game sprite animation. The character ${INSTRUMENT_PHRASE[inst][1]}. ${LOCKED}${LOOPS}`,
  };
}

// ---------- small helpers ----------

function errorText(e: unknown): string {
  return typeof e === "string" ? e : e instanceof Error ? e.message : JSON.stringify(e);
}

async function grokCall<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    if (errorText(e) !== "grok-expired") throw e;
    await invoke("creator_grok_refresh");
    return await invoke<T>(cmd, args);
  }
}

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

async function writeJob(job: string, name: string, bytes: Uint8Array) {
  await invoke("creator_write", { job, name, base64: toBase64(bytes) });
}

async function canvasPng(canvas: HTMLCanvasElement): Promise<Bytes> {
  const blob = await new Promise<Blob>((ok, fail) =>
    canvas.toBlob((b) => (b ? ok(b) : fail(new Error("canvas encode failed"))), "image/png"),
  );
  return new Uint8Array(await blob.arrayBuffer());
}

async function loadImage(url: string): Promise<HTMLImageElement> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`missing file (${res.status})`);
  const img = new Image();
  img.src = URL.createObjectURL(await res.blob());
  await img.decode();
  return img;
}

function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = "high";
  return { c, ctx };
}

// Pick the chroma key that fights the picture least: a pink or purple
// character keys badly on magenta.
async function chooseKey(sourcePath: string): Promise<"magenta" | "green"> {
  const img = await loadImage(jobUrl(sourcePath));
  const { ctx } = canvas(96, 96);
  ctx.drawImage(img, 0, 0, 96, 96);
  const d = ctx.getImageData(0, 0, 96, 96).data;
  let magenta = 0;
  let green = 0;
  for (let i = 0; i < d.length; i += 4) {
    const [r, g, b] = [d[i], d[i + 1], d[i + 2]];
    if (r > 140 && b > 110 && g < Math.min(r, b) - 40) magenta++;
    if (g > 140 && g > r + 40 && g > b + 40) green++;
  }
  return magenta > green ? "green" : "magenta";
}

// ---------- keying ----------

function borderKey(d: Uint8ClampedArray, w: number, h: number): RGB {
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  const take = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    rs.push(d[i]);
    gs.push(d[i + 1]);
    bs.push(d[i + 2]);
  };
  for (let x = 0; x < w; x += 3) {
    take(x, 1);
    take(x, h - 2);
  }
  for (let y = 0; y < h; y += 3) {
    take(1, y);
    take(w - 2, y);
  }
  const med = (a: number[]) => a.sort((p, q) => p - q)[a.length >> 1];
  return [med(rs), med(gs), med(bs)];
}

// Alpha from the distance to the key; partly covered edge pixels are
// un-mixed (C = aF + (1-a)K solved for F) so no key-colored halo remains.
function keyOut(img: ImageData, key: RGB) {
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const dr = d[i] - key[0];
    const dg = d[i + 1] - key[1];
    const db = d[i + 2] - key[2];
    const dist = Math.sqrt(dr * dr + dg * dg + db * db);
    let a = Math.min(1, Math.max(0, (dist - 50) / 80));
    if (a < 0.06) a = 0;
    if (a > 0 && a < 1) {
      for (let c = 0; c < 3; c++) {
        d[i + c] = Math.min(255, Math.max(0, (d[i + c] - (1 - a) * key[c]) / a));
      }
    }
    d[i + 3] = Math.round(a * 255);
  }
  despillEdges(img, key);
}

// Video chroma subsampling bleeds the key 1-3 px into the outline. Within
// that band, pull key-hued pixels back to neutral (magenta: R,B down to G;
// green: G down to max(R,B)); the interior keeps its colors.
function despillEdges(img: ImageData, key: RGB) {
  const { width: w, height: h, data: d } = img;
  let near = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) near[i] = d[i * 4 + 3] < 128 ? 1 : 0;
  for (let pass = 0; pass < 3; pass++) {
    const next = near.slice();
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        if (!near[i] && (near[i - 1] || near[i + 1] || near[i - w] || near[i + w])) next[i] = 1;
      }
    }
    near = next;
  }
  const green = key[1] > key[0];
  for (let i = 0; i < w * h; i++) {
    if (!near[i] || d[i * 4 + 3] === 0) continue;
    const p = i * 4;
    if (green) {
      const cap = Math.max(d[p], d[p + 2]);
      if (d[p + 1] > cap) d[p + 1] = cap;
    } else {
      const spill = Math.min(d[p], d[p + 2]) - d[p + 1];
      if (spill > 0) {
        d[p] -= spill;
        d[p + 2] -= spill;
      }
    }
  }
}

type Box = { x0: number; y0: number; x1: number; y1: number };

function alphaBox(img: ImageData, threshold = 40): Box | null {
  const { width: w, height: h, data } = img;
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > threshold) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}

function unionBox(boxes: (Box | null)[]): Box {
  const valid = boxes.filter((b): b is Box => b !== null);
  if (!valid.length) throw new Error("the character disappeared during keying");
  return {
    x0: Math.min(...valid.map((b) => b.x0)),
    y0: Math.min(...valid.map((b) => b.y0)),
    x1: Math.max(...valid.map((b) => b.x1)),
    y1: Math.max(...valid.map((b) => b.y1)),
  };
}

// ---------- stills → video canvases ----------

async function keyedStill(job: string, name: string): Promise<{ img: ImageData; box: Box }> {
  const image = await loadImage(jobUrl(`${job}/${name}`));
  const k = Math.min(1, 1024 / Math.max(image.naturalWidth, image.naturalHeight));
  const { ctx } = canvas(Math.round(image.naturalWidth * k), Math.round(image.naturalHeight * k));
  ctx.drawImage(image, 0, 0, ctx.canvas.width, ctx.canvas.height);
  const img = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
  keyOut(img, borderKey(img.data, img.width, img.height));
  const box = alphaBox(img);
  if (!box) throw new Error(`${name}: no character found on the background`);
  return { img, box };
}

// Re-seat a still on a flat key canvas the video model can hold steady.
async function videoCanvas(job: string, still: string, out: string, key: "magenta" | "green") {
  const { img, box } = await keyedStill(job, still);
  const bw = box.x1 - box.x0;
  const bh = box.y1 - box.y0;
  const wide = bw / bh > 1.15;
  const W = wide ? 1280 : 720;
  const H = 720;
  const k = Math.min((H * 0.64) / bh, (W * 0.8) / bw);
  const src = canvas(img.width, img.height);
  src.ctx.putImageData(img, 0, 0);
  const dst = canvas(W, H);
  dst.ctx.fillStyle = `rgb(${KEYS[key].join(",")})`;
  dst.ctx.fillRect(0, 0, W, H);
  const dw = bw * k;
  const dh = bh * k;
  dst.ctx.drawImage(src.c, box.x0, box.y0, bw, bh, (W - dw) / 2, H * 0.84 - dh, dw, dh);
  await writeJob(job, out, await canvasPng(dst.c));
}

// ---------- clips → frames ----------

async function clipFrames(job: string, name: string): Promise<ImageData[]> {
  const res = await fetch(jobUrl(`${job}/${name}`), { cache: "no-store" });
  if (!res.ok) throw new Error(`${name} missing`);
  const url = URL.createObjectURL(await res.blob());
  const video = document.createElement("video");
  video.muted = true;
  video.preload = "auto";
  video.src = url;
  await new Promise<void>((ok, fail) => {
    video.onloadeddata = () => ok();
    video.onerror = () => fail(new Error(`${name}: the clip cannot be decoded`));
  });
  const n = Math.min(120, Math.round(video.duration * FPS));
  const k = 480 / video.videoHeight;
  const { ctx } = canvas(Math.round(video.videoWidth * k), 480);
  const frames: ImageData[] = [];
  let key: RGB | null = null;
  for (let i = 0; i < n; i++) {
    video.currentTime = (i + 0.5) / FPS;
    await new Promise<void>((ok) => {
      video.onseeked = () => ok();
    });
    ctx.drawImage(video, 0, 0, ctx.canvas.width, ctx.canvas.height);
    const img = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
    key ??= borderKey(img.data, img.width, img.height);
    keyOut(img, key);
    frames.push(img);
  }
  URL.revokeObjectURL(url);
  return frames;
}

function signature(img: ImageData): Float32Array {
  const S = 40;
  const out = new Float32Array(S * S);
  const { width: w, height: h, data } = img;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = (Math.floor((y * h) / S) * w + Math.floor((x * w) / S)) * 4;
      out[y * S + x] = data[i + 3] / 255 + (data[i] + data[i + 1] + data[i + 2]) / 765;
    }
  }
  return out;
}

function diff(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / a.length;
}

// One walk cycle: the period whose frames best repeat after a short lead-in.
function walkCycle(frames: ImageData[]): ImageData[] {
  const sig = frames.map(signature);
  const start = Math.min(4, frames.length - 1);
  let best = 0;
  let bestScore = Infinity;
  for (let p = 12; p <= Math.min(40, frames.length - start - 4); p++) {
    let score = 0;
    let count = 0;
    for (let k = 0; k < 4; k++) {
      score += diff(sig[start + k], sig[start + k + p]);
      count++;
    }
    if (score / count < bestScore) {
      bestScore = score / count;
      best = p;
    }
  }
  if (!best) return frames;
  return frames.slice(start, start + best);
}

// Walking in place still drifts a little: pin every frame's feet line and
// body center so the sprite does not slide inside its cell.
function anchorFeet(frames: ImageData[]): ImageData[] {
  return frames.map((img) => {
    const box = alphaBox(img, 128);
    if (!box) return img;
    let sum = 0;
    let n = 0;
    for (let y = box.y0; y < box.y1; y++) {
      for (let x = box.x0; x < box.x1; x++) {
        if (img.data[(y * img.width + x) * 4 + 3] > 128) {
          sum += x;
          n++;
        }
      }
    }
    const dx = Math.round(img.width / 2 - sum / n);
    const dy = Math.round(img.height * 0.9 - box.y1);
    const out = new ImageData(img.width, img.height);
    for (let y = 0; y < img.height; y++) {
      const sy = y - dy;
      if (sy < 0 || sy >= img.height) continue;
      for (let x = 0; x < img.width; x++) {
        const sx = x - dx;
        if (sx < 0 || sx >= img.width) continue;
        const si = (sy * img.width + sx) * 4;
        out.data.set(img.data.subarray(si, si + 4), (y * img.width + x) * 4);
      }
    }
    return out;
  });
}

// ---------- frames → APNG ----------

async function fitAndEncode(frames: ImageData[], scale: number, cellW: number, cellH: number, box: Box): Promise<Bytes> {
  const src = canvas(frames[0].width, frames[0].height);
  const dst = canvas(cellW, cellH);
  const dw = (box.x1 - box.x0) * scale;
  const dh = (box.y1 - box.y0) * scale;
  const ox = (cellW - dw) / 2;
  const oy = cellH - 8 - dh;
  const out: Uint8ClampedArray[] = [];
  for (const f of frames) {
    src.ctx.putImageData(f, 0, 0);
    dst.ctx.clearRect(0, 0, cellW, cellH);
    dst.ctx.drawImage(src.c, box.x0, box.y0, box.x1 - box.x0, box.y1 - box.y0, ox, oy, dw, dh);
    out.push(dst.ctx.getImageData(0, 0, cellW, cellH).data);
  }
  return encodeApng(out, cellW, cellH, FPS, 0);
}

async function savePack(job: string, state: string, bytes: Bytes, previews: Built["previews"]) {
  await writeJob(job, `pack/${state}.apng`, bytes);
  previews[state as keyof Built["previews"]] = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
}

async function packFrames(
  job: string,
  clips: { idle: ImageData[]; walk: ImageData[] | null; fall: ImageData[] | null; play: ImageData[] },
  previews: Built["previews"],
): Promise<number | undefined> {
  const idleBox = unionBox(clips.idle.map((f) => alphaBox(f)));
  const bodyScale = Math.min(BODY_H / (idleBox.y1 - idleBox.y0), (CELL_W - 12) / (idleBox.x1 - idleBox.x0));
  await savePack(job, "idle", await fitAndEncode(clips.idle, bodyScale, CELL_W, CELL_H, idleBox), previews);

  let stride: number | undefined;
  if (clips.walk) {
    const box = unionBox(clips.walk.map((f) => alphaBox(f)));
    const k = Math.min(bodyScale, (CELL_W - 12) / (box.x1 - box.x0), (CELL_H - 12) / (box.y1 - box.y0));
    await savePack(job, "walk", await fitAndEncode(clips.walk, k, CELL_W, CELL_H, box), previews);
    // Planted-foot travel of a chibi gait is about 0.42 body heights per cycle.
    const bodyDisplay = (BODY_H * 176) / CELL_W;
    stride = Math.round((0.42 * bodyDisplay * 0.75) / (clips.walk.length / FPS));
  }
  if (clips.fall) {
    const box = unionBox(clips.fall.map((f) => alphaBox(f)));
    const k = Math.min(bodyScale, (CELL_W - 12) / (box.x1 - box.x0), (CELL_H - 12) / (box.y1 - box.y0));
    await savePack(job, "fall", await fitAndEncode(clips.fall, k, CELL_W, CELL_H, box), previews);
  }
  const playBox = unionBox(clips.play.map((f) => alphaBox(f)));
  const pk = Math.min(BODY_H / (playBox.y1 - playBox.y0), (PLAY_MAX_W - 16) / (playBox.x1 - playBox.x0));
  const playW = Math.ceil(((playBox.x1 - playBox.x0) * pk + 16) / 2) * 2;
  await savePack(job, "play", await fitAndEncode(clips.play, pk, playW, CELL_H, playBox), previews);
  return stride;
}

// ---------- the two pipelines ----------

async function normalizeSource(job: string, sourcePath: string) {
  const img = await loadImage(jobUrl(sourcePath));
  const k = Math.min(1, 1024 / Math.max(img.naturalWidth, img.naturalHeight));
  const { c, ctx } = canvas(Math.round(img.naturalWidth * k), Math.round(img.naturalHeight * k));
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  await writeJob(job, "ref.png", await canvasPng(c));
}

// A retry keeps the job folder: stills and clips that already exist are
// reused so a failed step does not spend the user's quota twice.
async function exists(job: string, name: string): Promise<boolean> {
  const res = await fetch(jobUrl(`${job}/${name}`), { method: "HEAD", cache: "no-store" }).catch(() => null);
  return res?.ok === true;
}

async function runStep<T>(id: StepId, onStep: OnStep, work: () => Promise<T>): Promise<T> {
  onStep(id, "run");
  try {
    const out = await work();
    onStep(id, "done");
    return out;
  } catch (e) {
    onStep(id, "fail", errorText(e));
    throw e;
  }
}

const pause = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

async function makeClip(
  job: string,
  prompt: string,
  image: string,
  last: string | null,
  out: string,
  onWait: (status: string) => void,
) {
  const request = await grokCall<string>("creator_video_start", {
    job,
    prompt,
    image,
    lastFrame: last,
    duration: 3,
  });
  const deadline = Date.now() + 15 * 60e3;
  while (Date.now() < deadline) {
    await pause(5000);
    const poll = await grokCall<{ status: string; done: boolean; failed: boolean; message?: string }>(
      "creator_video_poll",
      { job, request, out },
    );
    if (poll.failed) throw new Error(poll.message ?? `video ${poll.status}`);
    if (poll.done) return;
    onWait(poll.status);
  }
  throw new Error("the video took longer than 15 minutes");
}

export async function createAnimated(
  job: string,
  sourcePath: string,
  inst: Instrument,
  onStep: OnStep,
): Promise<Built> {
  const key = await chooseKey(sourcePath);
  await normalizeSource(job, sourcePath);
  const P = stillPrompts(inst, key);
  const image = async (prompt: string, refs: string[], out: string) => {
    if (!(await exists(job, out))) await grokCall<void>("creator_grok_image", { job, prompt, refs, out });
  };

  await runStep("side", onStep, () => image(P.side, ["ref.png"], "side.png"));
  await Promise.all([
    runStep("play", onStep, () => image(P.play, ["side.png", "ref.png"], "play.png")),
    runStep("chute", onStep, () => image(P.chute, ["side.png"], "chute.png")),
  ]);
  await videoCanvas(job, "side.png", "canvas-side.png", key);
  await videoCanvas(job, "play.png", "canvas-play.png", key);
  await videoCanvas(job, "chute.png", "canvas-chute.png", key);

  const V = videoPrompts(inst);
  const clip = (id: StepId, prompt: string, img: string, last: string | null, out: string, delay: number) =>
    runStep(id, onStep, async () => {
      if (await exists(job, out)) return;
      await pause(delay);
      await makeClip(job, prompt, img, last, out, (s) => onStep(id, "run", s));
    });
  await Promise.all([
    clip("idle", V.idle, "canvas-side.png", "canvas-side.png", "idle.mp4", 0),
    clip("walk", V.walk, "canvas-side.png", null, "walk.mp4", 3000),
    clip("fall", V.fall, "canvas-chute.png", "canvas-chute.png", "fall.mp4", 6000),
    clip("playAnim", V.play, "canvas-play.png", "canvas-play.png", "play.mp4", 9000),
  ]);

  return runStep("pack", onStep, async () => {
    const pinned = (f: ImageData[]) => f.slice(0, Math.max(1, f.length - 1));
    const idle = pinned(await clipFrames(job, "idle.mp4"));
    const walk = anchorFeet(walkCycle(await clipFrames(job, "walk.mp4")));
    const fall = pinned(await clipFrames(job, "fall.mp4"));
    const play = pinned(await clipFrames(job, "play.mp4"));
    const previews: Built["previews"] = {};
    const stride = await packFrames(job, { idle, walk, fall, play }, previews);
    return { job, previews, stride };
  });
}

// Codex only: stills, no video. Walking falls back to the CSS bounce.
export async function createStill(
  job: string,
  sourcePath: string,
  inst: Instrument,
  useGrok: boolean,
  onStep: OnStep,
): Promise<Built> {
  const key = await chooseKey(sourcePath);
  await normalizeSource(job, sourcePath);
  const P = stillPrompts(inst, key);
  const image = (prompt: string, refs: string[], out: string) =>
    useGrok
      ? grokCall<void>("creator_grok_image", { job, prompt, refs, out })
      : invoke<void>("creator_codex_image", { job, prompt, refs, out });
  await runStep("side", onStep, () => image(P.side, ["ref.png"], "side.png"));
  await runStep("play", onStep, () => image(P.play, ["side.png", "ref.png"], "play.png"));
  return runStep("pack", onStep, async () => {
    const side = (await keyedStill(job, "side.png")).img;
    const play = (await keyedStill(job, "play.png")).img;
    const previews: Built["previews"] = {};
    await packFrames(job, { idle: [side], walk: null, fall: null, play: [play] }, previews);
    return { job, previews };
  });
}
