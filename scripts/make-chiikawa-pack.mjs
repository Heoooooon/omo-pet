#!/usr/bin/env node
// Fan-made Chiikawa series packs, built on YOUR computer.
//
// Turns official LINE STORE animated-sticker previews into local character
// packs under public/packs/<id>/, and (with --generate) draws every state the
// stickers don't cover with sprite-gen, using the character's own stickers
// and goods photos as the reference. The artwork is never committed:
// public/packs/* (except omo-cat) and public/packs/local.json are git-ignored.
//
// Fan-made, unofficial, non-commercial. Chiikawa © nagano / chiikawa committee.
//
// Usage:
//   node scripts/make-chiikawa-pack.mjs                       # sticker-only packs (quick)
//   node scripts/make-chiikawa-pack.mjs --generate            # every state, all 7 characters
//   node scripts/make-chiikawa-pack.mjs --chars usagi,momonga --generate
//   node scripts/make-chiikawa-pack.mjs --chars usagi --generate --regen walk,jet
//   node scripts/make-chiikawa-pack.mjs --remove              # delete the local packs again
//
// Needs ffmpeg. --generate also needs a sprite-gen checkout (SPRITE_GEN_DIR,
// default ~/.cache/sprite-gen, with its .venv installed) and a logged-in
// `codex` CLI (your ChatGPT subscription; no API key). Generated frames are
// cached in .cache/chiikawa/gen/<id>/ and reused on the next run, so a run
// without --generate still uses states you generated before.

import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PACKS_DIR = join(ROOT, "public", "packs");
const LOCAL_INDEX = join(PACKS_DIR, "local.json");
const CACHE_DIR = join(ROOT, ".cache", "chiikawa");

const ANIMATED_URL = (id) =>
  `https://stickershop.line-scdn.net/stickershop/v1/sticker/${id}/iPhone/sticker_animation@2x.png`;
const STILL_URL = (id) =>
  `https://stickershop.line-scdn.net/stickershop/v1/sticker/${id}/iPhone/sticker@2x.png`;

// Every state the app plays (src/main.ts ALL_STATES + EXTRA_SPRITES).
const STATES = [
  "idle", "walk", "drag", "react", "edge", "rocket", "jet",
  "fall", "fall-open", "fall-glide", "fall-land",
];
const ONCE = new Set(["edge", "fall", "fall-open", "fall-land"]);

// Every file is drawn on the same canvas as the pet window (240×320) with the
// feet on the bottom edge, so the body reads the same size in every state.
// BODY is the standing body height; prop states get room for the prop.
const CANVAS = { w: 240, h: 320 };
const BODY = 170;
const SIZE = { rocket: 1.45, jet: 1.1 };

// Stickers: LINE STORE 「アニメ『ちいかわ』動くLINEスタンプ」 (動画工房)
//   vol.1 32367501 · vol.2 32855985 · vol.3 32855981 · vol.4 33799640
//   https://store.line.me/stickershop/product/<id>
// Only stickers with the character alone and in full body are used; floating
// effect text (「エッ」…), notes and sparkles are erased (see cleanFrame).
// Extra ids per state become variants (<state>.2.apng …).
// refs: pictures sprite-gen draws the character from —
//   { anim } an animated sticker (cleaned middle frame), { still } a static
//   LINE sticker, { url } an official goods photo (chiikawamarket.jp).
const CHARACTERS = {
  chiikawa: {
    name: "Chiikawa",
    emoji: "🤍",
    hint: "Chiikawa, a tiny round white bear-like creature with small round ears, pink cheeks, dot eyes, stubby arms and legs",
    chute: "pink",
    // 805188756 (イヤッ tantrum) would fit drag, but its text touches the body.
    stickers: { idle: [816451476], react: [805188757] },
    refs: [{ anim: 816451476 }, { anim: 805188756 }],
  },
  hachiware: {
    name: "Hachiware",
    emoji: "🐱",
    hint: "Hachiware, a small round white cat with a blue-gray split (hachiware) pattern on top of its head, pointed ears, pink cheeks, dot eyes, stubby arms and legs, a blue-gray tail",
    chute: "light blue",
    // vol.1–4 only show Hachiware as a close-up or with props: all drawn.
    stickers: {},
    refs: [{ still: 737443193 }, { anim: 805188751 }],
  },
  usagi: {
    name: "Usagi",
    emoji: "🐰",
    hint: "Usagi, a small round cream-yellow rabbit with long upright ears with pink inner ear, pink cheeks, dot eyes, stubby arms and legs, a tiny round white tail",
    chute: "yellow",
    stickers: { idle: [816451484, 805188761], react: [838685751], drag: [816451338] },
    refs: [{ anim: 816451484 }, { anim: 816451338 }],
  },
  momonga: {
    name: "Momonga",
    emoji: "🐿️",
    hint: "Momonga, a small round white flying squirrel with big round ears, big sparkly eyes, a light-blue nose, pink cheeks, stubby arms and legs and a big fluffy light-blue tail",
    chute: "light blue",
    // 816451469 / 805188766 / 805188765 / 816451468 / 838685765 would fit too,
    // but their effect text touches the body.
    stickers: { idle: [816451466], react: [838685749], drag: [816451485] },
    refs: [{ anim: 816451466 }, { anim: 838685749 }],
  },
  kurimanju: {
    name: "Kurimanju",
    emoji: "🌰",
    hint: "Kurimanju, a small round chestnut-bun creature: pale tan round body, a darker brown chestnut-shaped cap on top of the head, tiny dot eyes, a small mouth, pink cheeks, tiny stubby arms and feet",
    chute: "brown",
    // Only close-ups with drinks or snacks in the animated packs: all drawn.
    stickers: {},
    refs: [{ still: 806221122 }, { url: "https://cdn.shopify.com/s/files/1/0626/7142/1681/files/4988104172419_1.jpg" }],
  },
  yoroi: {
    name: "Yoroi-san",
    emoji: "🛡️",
    hint: "Yoroi-san, a short chibi knight in full light-gray plate armor: rounded helmet with a dark horizontal visor slit and a grille mouth guard, round armored body, stubby armored arms and legs",
    chute: "gray",
    stickers: { react: [838685761] },
    size: { rocket: 1.2 }, // the drawn rocket is small next to the helmet
    refs: [{ anim: 838685761 }, { url: "https://cdn.shopify.com/s/files/1/0626/7142/1681/files/4571609398745_1.jpg" }],
  },
  yusangyun: {
    name: "Muchauman",
    emoji: "🥛",
    hint: "Muchauman, a small yogurt-jar hero: white cylindrical yogurt-jar head and body with a rounded lid rim on top, small dot eyes, a light-blue M mark on the chest, light-blue gloves and boots and a short light-blue cape",
    chute: "light blue",
    // No LINE stickers exist for him: drawn from the official plush photo.
    stickers: {},
    refs: [{ url: "https://cdn.shopify.com/s/files/1/0626/7142/1681/files/4571609351603_1_cb808b0a-126a-47d8-8dc5-c072d6ddd36e.jpg" }],
  },
};

// sprite-gen recipes for the states stickers don't cover. "fall" is not drawn
// separately: it is the deploy row followed by one glide loop.
const STYLE =
  "match the attached base reference image EXACTLY: same soft hand-drawn dark-brown outline, same flat pastel colours and pink cheeks, same body proportions, same level of detail. Any prop (rocket, parachute) is drawn in the same simple hand-drawn pastel style. Do not restyle, no text, no speech bubbles, no sound effects, no other characters.";
const RECIPES = {
  idle: {
    cell: [192, 256, 18, 16], frames: 4, fps: 4, fit: ["foot-centroid", "bottom"],
    action: "standing idle in a 3/4 view facing right, relaxed, gentle breathing loop, blinking once mid-cycle; frames form a smooth loop back to frame 1; only the chest rise and eyes change, pose and feet stay fixed",
  },
  walk: {
    cell: [192, 208, 18, 14], frames: 6, fps: 8, fit: ["foot-centroid", "bottom"],
    action: "side-view walk cycle facing right: short stubby legs alternate with clear foot contact, a little body bounce, arms swing slightly; the body scale is identical in all six frames",
  },
  react: {
    cell: [192, 256, 18, 16], frames: 4, fps: 8, fit: ["foot-centroid", "bottom"],
    action: "delighted reaction to being poked, facing the viewer: frame 1 standing surprised with wide eyes, frame 2 a small happy hop with both arms up and a big open-mouth smile, frame 3 landing with a wiggle, frame 4 standing happy; feet return to the same ground line; same body scale in every frame",
  },
  drag: {
    cell: [192, 256, 18, 16], frames: 4, fps: 8, fit: ["centroid", "bottom"],
    action: "being picked up and dangling in mid-air, facing the viewer: arms and legs flailing playfully, a worried wobbly face, body swaying a little left and right; no hand or other character holding it is visible; same body scale in every frame",
  },
  edge: {
    cell: [192, 256, 18, 16], frames: 4, fps: 6, fit: ["centroid", "bottom"], once: true,
    action: "climbing onto a ledge corner and sitting, side view facing right: grabs the invisible ledge edge, pulls itself up, ends sitting relaxed on the corner with legs dangling; the final frame is a steady sitting hold",
  },
  rocket: {
    cell: [192, 256, 18, 8], frames: 4, fps: 10, fit: ["centroid", "center"],
    action: "riding a small cartoon rocket flying straight upward, front-facing. Its body is LARGE, filling roughly two thirds of the cell height, same body scale as a standing pose; the rocket is short and stubby beneath it with only a compact orange flame below, flame flickering differently in each frame; gripping the rocket with both hands, excited open-mouth face; only the flame changes between frames, pose stays fixed",
  },
  jet: {
    cell: [256, 192, 14, 10], frames: 4, fps: 10, fit: ["centroid", "center"],
    action: "sitting astride a small horizontal cartoon rocket flying to the right like riding a horse, side view. Its body is LARGE, filling most of the cell height, same body scale as a standing pose; the rocket is short and stubby beneath it, bright orange flame trailing behind flickering differently in each frame; leaning forward holding the nose; only the flame changes between frames, pose stays fixed",
  },
  "fall-open": {
    cell: [192, 256, 18, 8], frames: 4, fps: 10, fit: ["centroid", "bottom"], once: true,
    action: "parachute deployment sequence, front-facing, body LARGE filling two thirds of the cell height: frame 1 free-falling with arms up, frame 2 a small CHUTE pack bursts open above its head, frame 3 the compact CHUTE canopy half inflated on short lines, frame 4 the compact round CHUTE canopy fully open and taut, hanging relaxed on the straps; same body scale in every frame",
  },
  "fall-glide": {
    cell: [192, 256, 18, 8], frames: 4, fps: 8, fit: ["centroid", "bottom"],
    action: "gliding down under a fully open compact round CHUTE parachute on short lines, front-facing, body LARGE filling two thirds of the cell height, holding the straps, calm happy face; the frames form a smooth loop of a gentle left-right pendulum sway; only the sway angle changes between frames, the canopy stays open and identical",
  },
  "fall-land": {
    cell: [192, 256, 18, 16], frames: 4, fps: 10, fit: ["foot-centroid", "bottom"], once: true,
    action: "landing recovery, front-facing, NO parachute anywhere in any frame. Frame 1 feet just touching the ground with knees slightly bent and arms out for balance, frame 2 deep knee bend absorbing the impact, frame 3 rising back up, frame 4 standing fully upright and cheerful with arms relaxed. Feet stay planted on the same ground line; the body scale is identical in all four frames and matches the reference standing pose",
  },
};

// --- small process helpers --------------------------------------------------

function run(cmd, args, { input, log } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
    const out = [];
    const err = [];
    child.stdout.on("data", (d) => out.push(d));
    child.stderr.on("data", (d) => err.push(d));
    child.on("error", reject);
    child.on("close", async (code) => {
      const stdout = Buffer.concat(out);
      const stderr = Buffer.concat(err).toString();
      if (log) await writeFile(log, `$ ${cmd} ${args.join(" ")}\n${stdout}\n${stderr}`, { flag: "a" });
      if (code === 0) resolve(stdout);
      else reject(new Error(`${cmd} exited ${code}${log ? ` (log: ${log})` : ""}\n${stderr.slice(-800)}`));
    });
    child.stdin.on("error", () => {}); // reported through the exit code
    child.stdin.end(input);
  });
}

function limiter(n) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= n || !queue.length) return;
    active++;
    const { fn, resolve, reject } = queue.shift();
    fn().then(resolve, reject).finally(() => {
      active--;
      next();
    });
  };
  return (fn) => new Promise((resolve, reject) => {
    queue.push({ fn, resolve, reject });
    next();
  });
}

async function cached(url, file) {
  if (existsSync(file)) return readFile(file);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, buf);
  return buf;
}

// --- frames ---------------------------------------------------------------
// A clip is { w, h, fps, frames: Buffer[] } with RGBA frames.

function pngSize(buf) {
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

// Average frame rate from the APNG fcTL delays.
function apngFps(buf) {
  let off = 8;
  let n = 0;
  let total = 0;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    if (buf.toString("latin1", off + 4, off + 8) === "fcTL") {
      const num = buf.readUInt16BE(off + 8 + 20);
      const den = buf.readUInt16BE(off + 8 + 22) || 100;
      total += num / den;
      n++;
    }
    off += 12 + len;
  }
  if (!n) throw new Error("not an animated PNG (no fcTL chunk)");
  return n / (total || n / 10);
}

async function decode(inputArgs, { w, h }, fps) {
  const raw = await run("ffmpeg", [
    "-v", "error", ...inputArgs, "-fps_mode", "passthrough", "-f", "rawvideo", "-pix_fmt", "rgba", "-",
  ]);
  const size = w * h * 4;
  const frames = [];
  for (let off = 0; off + size <= raw.length; off += size) frames.push(raw.subarray(off, off + size));
  return { w, h, fps, frames };
}

async function stickerClip(id) {
  const buf = await cached(ANIMATED_URL(id), join(CACHE_DIR, `${id}.png`));
  const file = join(CACHE_DIR, `${id}.png`);
  const clip = await decode(["-i", file], pngSize(buf), apngFps(buf));
  clip.frames = clip.frames.map((f) => cleanFrame(f, clip.w, clip.h));
  return clip;
}

async function framesClip(files, fps) {
  const first = await readFile(files[0]);
  const list = join(dirname(files[0]), "..", `concat-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
  await writeFile(list, files.map((f) => `file '${f}'`).join("\n"));
  try {
    return await decode(["-f", "concat", "-safe", "0", "-i", list], pngSize(first), fps);
  } finally {
    await rm(list, { force: true });
  }
}

// Erases what floats around the character: effect text, notes, sparkles,
// sweat drops. Keeps the largest blob, anything big, and small pieces next to
// it that carry the dark-brown/gray outline the characters are drawn with
// (effect text is drawn in flat colours without it).
function cleanFrame(frame, w, h) {
  const out = Buffer.from(frame);
  const label = new Int32Array(w * h).fill(-1);
  const comps = [];
  const stack = [];
  for (let start = 0; start < w * h; start++) {
    if (label[start] !== -1 || out[start * 4 + 3] <= 8) continue;
    const c = { id: comps.length, area: 0, dark: 0, x0: w, y0: h, x1: 0, y1: 0 };
    comps.push(c);
    label[start] = c.id;
    stack.push(start);
    while (stack.length) {
      const p = stack.pop();
      const x = p % w;
      const y = (p - x) / w;
      c.area++;
      const [r, g, b] = [out[p * 4], out[p * 4 + 1], out[p * 4 + 2]];
      if (Math.max(r, g, b) < 110 && b <= r + 12 && out[p * 4 + 3] > 128) c.dark++;
      if (x < c.x0) c.x0 = x;
      if (x > c.x1) c.x1 = x;
      if (y < c.y0) c.y0 = y;
      if (y > c.y1) c.y1 = y;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const q = ny * w + nx;
          if (label[q] === -1 && out[q * 4 + 3] > 8) {
            label[q] = c.id;
            stack.push(q);
          }
        }
      }
    }
  }
  if (!comps.length) return out;
  const main = comps.reduce((a, b) => (b.area > a.area ? b : a));
  const mx = (main.x1 - main.x0) * 0.06;
  const my = (main.y1 - main.y0) * 0.06;
  const keep = new Set(
    comps
      .filter(
        (c) =>
          c.area >= main.area * 0.25 ||
          (c.dark >= c.area * 0.15 &&
            c.x0 >= main.x0 - mx && c.x1 <= main.x1 + mx && c.y0 >= main.y0 - my && c.y1 <= main.y1 + my),
      )
      .map((c) => c.id),
  );
  for (let p = 0; p < w * h; p++) {
    if (!keep.has(label[p])) out.writeUInt32BE(0, p * 4);
  }
  return out;
}

function bbox(frame, w, h) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (frame[(y * w + x) * 4 + 3] > 16) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}

// Body width: the widest row (in opaque pixels, so thin parachute lines don't
// count) in the lower 40% of the frame, where the body and legs are.
function bodyWidth(frame, w, box) {
  let best = 0;
  const from = Math.round(box.y1 - (box.y1 - box.y0) * 0.4);
  for (let y = from; y <= box.y1; y++) {
    let n = 0;
    for (let x = box.x0; x <= box.x1; x++) if (frame[(y * w + x) * 4 + 3] > 64) n++;
    if (n > best) best = n;
  }
  return best;
}

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

// Copies box (scaled by s) onto a CANVAS-sized frame at (left, top), with
// area-averaged sampling on premultiplied alpha.
function place(frame, w, h, box, s, left, top) {
  const out = Buffer.alloc(CANVAS.w * CANVAS.h * 4);
  const k = Math.max(1, Math.ceil(1 / s));
  for (let oy = Math.max(0, top); oy < CANVAS.h; oy++) {
    for (let ox = 0; ox < CANVAS.w; ox++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < k; sy++) {
        const y = Math.floor(box.y0 + (oy - top + (sy + 0.5) / k) / s);
        if (y < box.y0 || y > box.y1 || y >= h) continue;
        for (let sx = 0; sx < k; sx++) {
          const x = Math.floor(box.x0 + (ox - left + (sx + 0.5) / k) / s);
          if (x < box.x0 || x > box.x1 || x >= w) continue;
          const i = (y * w + x) * 4;
          const al = frame[i + 3];
          r += frame[i] * al;
          g += frame[i + 1] * al;
          b += frame[i + 2] * al;
          a += al;
        }
      }
      if (!a) continue;
      const o = (oy * CANVAS.w + ox) * 4;
      out[o] = Math.round(r / a);
      out[o + 1] = Math.round(g / a);
      out[o + 2] = Math.round(b / a);
      out[o + 3] = Math.round(a / (k * k));
    }
  }
  return out;
}

// Parachute states: the model draws the body at a different size in the
// free-fall and canopy frames, so each frame is scaled on its own to the body
// width of the idle pose.
const PER_FRAME = new Set(["fall", "fall-open", "fall-glide"]);
// Drawn hops and landings drift in size the same way; the hop itself is
// added back by the app's CSS.
const PER_FRAME_DRAWN = new Set(["react", "fall-land"]);

// Puts the clip on the canvas with the feet on the bottom edge. Most states
// get one scale and one crop for all frames (keeps the drawn motion), sized so
// the typical frame height matches the state's target; parachute states match
// the idle body width (bodyW) frame by frame. Returns the idle body width.
async function writeState(clip, state, size, out, bodyW, perFrame) {
  const boxes = clip.frames.map((f) => bbox(f, clip.w, clip.h));
  if (!boxes.some(Boolean)) throw new Error(`${out}: every frame is empty`);
  let canvas;
  let s;
  if (perFrame && bodyW) {
    canvas = clip.frames.map((f, i) => {
      const b = boxes[i];
      if (!b) return Buffer.alloc(CANVAS.w * CANVAS.h * 4);
      const bw = b.x1 - b.x0 + 1;
      const bh = b.y1 - b.y0 + 1;
      const fs = Math.min(bodyW / Math.max(1, bodyWidth(f, clip.w, b)), (CANVAS.w - 4) / bw, (CANVAS.h - 4) / bh);
      return place(f, clip.w, clip.h, b, fs, Math.round((CANVAS.w - bw * fs) / 2), Math.round(CANVAS.h - 2 - bh * fs));
    });
  } else {
    const u = {
      x0: Math.min(...boxes.filter(Boolean).map((b) => b.x0)),
      y0: Math.min(...boxes.filter(Boolean).map((b) => b.y0)),
      x1: Math.max(...boxes.filter(Boolean).map((b) => b.x1)),
      y1: Math.max(...boxes.filter(Boolean).map((b) => b.y1)),
    };
    const typical = median(boxes.filter(Boolean).map((b) => b.y1 - b.y0 + 1));
    const cw = u.x1 - u.x0 + 1;
    const ch = u.y1 - u.y0 + 1;
    const target = BODY * size;
    s = Math.min(target / typical, (CANVAS.w - 4) / cw, (CANVAS.h - 4) / ch);
    const left = Math.round((CANVAS.w - cw * s) / 2);
    const top = Math.round(CANVAS.h - 2 - ch * s);
    canvas = clip.frames.map((f) => place(f, clip.w, clip.h, u, s, left, top));
  }
  await run(
    "ffmpeg",
    [
      "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${CANVAS.w}x${CANVAS.h}`,
      "-framerate", String(clip.fps), "-i", "-",
      "-pix_fmt", "rgba", "-plays", ONCE.has(state) ? "1" : "0", "-f", "apng", out,
    ],
    { input: Buffer.concat(canvas) },
  );
  if (state !== "idle") return bodyW;
  return s * median(clip.frames.map((f, i) => (boxes[i] ? bodyWidth(f, clip.w, boxes[i]) : 0)).filter(Boolean));
}

async function writePng(clip, index, out) {
  await run(
    "ffmpeg",
    ["-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${clip.w}x${clip.h}`, "-i", "-", "-frames:v", "1", out],
    { input: clip.frames[index] },
  );
}

// --- sprite-gen -----------------------------------------------------------

function spriteGen() {
  const dir = process.env.SPRITE_GEN_DIR ?? join(homedir(), ".cache", "sprite-gen");
  const bin = join(dir, ".venv", "bin", "sprite-gen");
  if (!existsSync(bin)) {
    throw new Error(
      `sprite-gen not found at ${bin}. Clone https://github.com/aldegad/sprite-gen to ${dir} ` +
        `and run: python3 -m venv .venv && .venv/bin/pip install -e .  (or set SPRITE_GEN_DIR)`,
    );
  }
  return bin;
}

async function refImages(id, char, genDir) {
  const files = [];
  for (const [i, ref] of char.refs.entries()) {
    const file = join(genDir, `ref-${i + 1}.${ref.url ? "jpg" : "png"}`);
    if (ref.anim) {
      const clip = await stickerClip(ref.anim);
      await writePng(clip, Math.floor(clip.frames.length / 2), file);
    } else {
      await cached(ref.still ? STILL_URL(ref.still) : ref.url, file);
    }
    files.push(file);
  }
  return files;
}

async function generateBase(id, char, genDir, sg, regen) {
  const base = join(genDir, "base.png");
  if (existsSync(base) && !regen) return base;
  const refs = await refImages(id, char, genDir);
  const prompt =
    `${char.hint}. Full body, standing in a 3/4 view facing right, whole body visible head to toe, arms relaxed. ` +
    `Draw it in the soft hand-drawn style of the attached official references: thin dark-brown outline, flat pastel colours, pink cheeks, simple shapes. ` +
    `Match the character's look and palette exactly. No text, no speech bubbles, no props, no other characters. Transparent background.`;
  await run(sg, ["gen", "--provider", "codex", "--prompt", prompt, ...refs.flatMap((r) => ["--ref", r]),
    // With refs, sprite-gen defaults to chroma keying, but codex answers on a
    // black background that keys out to nothing; native alpha works.
    "--transparent", "--alpha-mode", "native", "--trim-alpha", "--out", base], { log: join(genDir, "base.log") });
  return base;
}

async function generateState(id, char, state, base, genDir, sg) {
  const r = RECIPES[state];
  const runDir = join(genDir, state);
  const [cw, ch, mx, my] = r.cell;
  const request = {
    cell: { shape: "rect", width: cw, height: ch, safe_margin_x: mx, safe_margin_y: my },
    states: { [state]: { frames: r.frames, fps: r.fps, loop: !r.once, action: r.action.replaceAll("CHUTE", char.chute) } },
    style: STYLE,
    motion_phase_guides: false,
    fit: { align_x: r.fit[0], align_y: r.fit[1] },
  };
  const log = join(genDir, `${state}.log`);
  await rm(log, { force: true });
  await run(sg, ["prepare", "--out-dir", runDir, "--character-id", `${id}-${state}`, "--base-image", base,
    "--description", char.hint, "--chroma-key", "auto", "--request-json", JSON.stringify(request), "--force"], { log });
  await run(sg, ["gen-set", "--run-dir", runDir, "--provider", "codex"], { log });
  await run(sg, ["extract", "--run-dir", runDir], { log });
}

async function generatedFrames(genDir, state) {
  const dir = join(genDir, state, "frames", state);
  if (!existsSync(dir)) return null;
  const names = (await readdir(dir)).filter((f) => /^frame-\d+\.png$/.test(f));
  if (!names.length) return null;
  names.sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
  return names.map((f) => join(dir, f));
}

// --- main -----------------------------------------------------------------

async function readIndex() {
  try {
    return JSON.parse(await readFile(LOCAL_INDEX, "utf8"));
  } catch {
    return [];
  }
}

function parseArgs(argv) {
  const opts = { chars: [], generate: false, remove: false, regen: new Set(), jobs: 3 };
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = argv[i].split("=", 2);
    const value = () => inline ?? argv[++i] ?? "";
    if (flag === "--chars") opts.chars.push(...value().split(",").filter(Boolean));
    else if (flag === "--generate") opts.generate = true;
    else if (flag === "--remove") opts.remove = true;
    else if (flag === "--regen") for (const s of value().split(",").filter(Boolean)) opts.regen.add(s);
    else if (flag === "--jobs") opts.jobs = Math.max(1, Number(value()) || 1);
    else if (flag === "--help" || flag === "-h") opts.help = true;
    else if (!flag.startsWith("-")) opts.chars.push(flag);
    else opts.bad = flag;
  }
  return opts;
}

const USAGE = `usage: node scripts/make-chiikawa-pack.mjs [--chars ${Object.keys(CHARACTERS).join(",")}]
       [--generate] [--regen base,walk,...|all] [--jobs N] [--remove]`;

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help || opts.bad) {
    if (opts.bad) console.error(`unknown option ${opts.bad}`);
    console.log(USAGE);
    process.exit(opts.bad ? 2 : 0);
  }
  for (const n of opts.chars) {
    if (!CHARACTERS[n]) throw new Error(`unknown character "${n}" (choose: ${Object.keys(CHARACTERS).join(", ")})`);
  }
  for (const s of opts.regen) {
    if (s !== "all" && s !== "base" && !RECIPES[s]) throw new Error(`--regen: unknown state "${s}"`);
  }
  const ids = opts.chars.length ? opts.chars : Object.keys(CHARACTERS);
  let index = (await readIndex()).filter((p) => !ids.includes(p.id));

  if (opts.remove) {
    for (const id of ids) await rm(join(PACKS_DIR, id), { recursive: true, force: true });
    await writeFile(LOCAL_INDEX, JSON.stringify(index, null, 2) + "\n");
    console.log(`removed: ${ids.join(", ")}`);
    return;
  }

  const sg = opts.generate ? spriteGen() : null;
  const slot = limiter(opts.jobs);
  const regen = (s) => opts.regen.has("all") || opts.regen.has(s);

  const results = await Promise.allSettled(
    ids.map(async (id) => {
      const char = CHARACTERS[id];
      const genDir = join(CACHE_DIR, "gen", id);
      await mkdir(genDir, { recursive: true });
      const sources = {}; // state -> "sticker" | "generated"

      // Generate (or reuse) every state the stickers don't cover.
      const drawn = Object.keys(RECIPES).filter((s) => !char.stickers[s]);
      if (sg) {
        const base = await slot(() => generateBase(id, char, genDir, sg, regen("base")));
        const failed = [];
        await Promise.all(
          drawn.map((state) =>
            slot(async () => {
              if (!regen(state) && (await generatedFrames(genDir, state))) return;
              console.log(`${id}: drawing ${state} with sprite-gen…`);
              await generateState(id, char, state, base, genDir, sg);
            }).catch((err) => failed.push(`${state}: ${err.message.split("\n")[0]}`)),
          ),
        );
        if (failed.length) console.error(`${id}: some states failed to draw:\n  ${failed.join("\n  ")}`);
      }

      const dir = join(PACKS_DIR, id);
      await rm(dir, { recursive: true, force: true });
      await mkdir(dir, { recursive: true });
      const jobs = []; // { state, file, clip: () => Promise<clip>, source }
      for (const [state, stickers] of Object.entries(char.stickers)) {
        for (const [i, sticker] of stickers.entries()) {
          const file = i === 0 ? `${state}.apng` : `${state}.${i + 1}.apng`;
          jobs.push({ state, file, clip: () => stickerClip(sticker), source: "sticker" });
        }
      }
      for (const state of drawn) {
        const files = await generatedFrames(genDir, state);
        if (files) jobs.push({ state, file: `${state}.apng`, clip: () => framesClip(files, RECIPES[state].fps), source: "generated" });
      }
      // fall = parachute deploy, then one glide loop (played once).
      const open = await generatedFrames(genDir, "fall-open");
      const glide = await generatedFrames(genDir, "fall-glide");
      if (open && glide) {
        jobs.push({ state: "fall", file: "fall.apng", clip: () => framesClip([...open, ...glide], 8), source: "generated" });
      }
      // idle first: its body width sizes the parachute states.
      jobs.sort((a, b) => (b.file === "idle.apng") - (a.file === "idle.apng"));
      let bodyW;
      for (const job of jobs) {
        const perFrame = PER_FRAME.has(job.state) || (job.source === "generated" && PER_FRAME_DRAWN.has(job.state));
        const size = char.size?.[job.state] ?? SIZE[job.state] ?? 1;
        const w = await writeState(await job.clip(), job.state, size, join(dir, job.file), bodyW, perFrame);
        if (job.file === "idle.apng") bodyW = w;
        sources[job.state] = job.source;
      }

      if (!sources.idle) {
        await rm(dir, { recursive: true, force: true });
        throw new Error("no idle sprite: this character has no full-body sticker, run with --generate");
      }
      const missing = STATES.filter((s) => !sources[s]);
      index.push({ id, name: char.name, emoji: char.emoji, fanmade: true });
      console.log(
        `${id}: ${Object.keys(sources).length}/${STATES.length} states` +
          (missing.length ? ` (missing, shown as idle: ${missing.join(", ")})` : "") + ` → ${dir}`,
      );
      return { id, sources };
    }),
  );

  index.sort((a, b) => a.id.localeCompare(b.id));
  await writeFile(LOCAL_INDEX, JSON.stringify(index, null, 2) + "\n");
  const failed = results
    .map((r, i) => (r.status === "rejected" ? `${ids[i]}: ${r.reason.message}` : null))
    .filter(Boolean);
  if (failed.length) {
    console.error(`skipped:\n  ${failed.join("\n  ")}`);
    if (failed.length === ids.length) process.exit(1);
  }
  console.log("Done. Open Settings (right-click the pet) and pick the character.");
}

main().catch((err) => {
  console.error(`error: ${err.message}`);
  process.exit(1);
});
