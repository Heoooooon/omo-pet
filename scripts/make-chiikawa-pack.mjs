#!/usr/bin/env node
// Fan-made Chiikawa packs, built on YOUR computer.
//
// Downloads the official LINE STORE animated-sticker previews listed below
// and turns them into local character packs under public/packs/<id>/.
// The artwork is never committed: public/packs/* (except omo-cat) and
// public/packs/local.json are git-ignored.
//
// Fan-made, unofficial, non-commercial. Chiikawa © nagano / chiikawa committee.
//
// Usage:
//   node scripts/make-chiikawa-pack.mjs                 # chiikawa, hachiware, usagi
//   node scripts/make-chiikawa-pack.mjs usagi           # one character
//   node scripts/make-chiikawa-pack.mjs --generate-walk # also draw a walk cycle with sprite-gen
//   node scripts/make-chiikawa-pack.mjs --remove        # delete the local packs again
//
// --generate-walk needs ffmpeg, a sprite-gen checkout (SPRITE_GEN_DIR, default
// ~/.cache/sprite-gen, with its .venv installed) and a logged-in `codex` CLI
// (your ChatGPT subscription; no API key).

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PACKS_DIR = join(ROOT, "public", "packs");
const LOCAL_INDEX = join(PACKS_DIR, "local.json");
const CACHE_DIR = join(ROOT, ".cache", "chiikawa");

const STICKER_URL = (id) =>
  `https://stickershop.line-scdn.net/stickershop/v1/sticker/${id}/iPhone/sticker_animation@2x.png`;

// Sticker sources: LINE STORE 「アニメ『ちいかわ』動くLINEスタンプ」
//   vol.1 https://store.line.me/stickershop/product/32367501
//   vol.3 https://store.line.me/stickershop/product/32855981
//   vol.4 https://store.line.me/stickershop/product/33799640
// Each state maps to one or more sticker ids; extra ids become variants
// (<state>.2.apng …). States left out fall back to idle in the app.
// `once` states play a single time and hold the last frame.
const CHARACTERS = {
  chiikawa: {
    name: "Chiikawa",
    emoji: "🤍",
    walkHint:
      "Chiikawa, a tiny round white bear-like creature with small round ears, pink cheeks, dot eyes, stubby arms and legs",
    states: {
      idle: [805188757],
      react: [816451352],
      drag: [805188756],
      jet: [805188768],
    },
  },
  hachiware: {
    name: "Hachiware",
    emoji: "🐱",
    walkHint:
      "Hachiware, a small round white cat with a blue-gray hachiware (split) pattern on top of its head, pointed ears, pink cheeks, dot eyes, stubby arms and legs, blue-gray tail",
    states: {
      idle: [805188752],
      react: [805188751],
      drag: [816451347],
      edge: [838685745],
    },
  },
  usagi: {
    name: "Usagi",
    emoji: "🐰",
    walkHint:
      "Usagi, a small round cream-yellow rabbit with long upright ears with pink inner ear, pink cheeks, dot eyes, stubby arms and legs, tiny round tail",
    states: {
      idle: [805188761, 816451353],
      react: [816451339],
      drag: [816451338],
      jet: [816451360],
    },
  },
};
const ONCE = new Set(["edge", "fall"]);

// --- APNG helpers (no dependencies) ------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// Rewrites acTL.num_plays (0 = loop forever). Throws if the file is not an APNG.
function setPlays(png, plays) {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!sig.every((b, i) => png[i] === b)) throw new Error("not a PNG file");
  let off = 8;
  while (off + 8 <= png.length) {
    const len = png.readUInt32BE(off);
    const type = png.toString("latin1", off + 4, off + 8);
    if (type === "acTL") {
      png.writeUInt32BE(plays, off + 12);
      const crc = crc32(png.subarray(off + 4, off + 8 + len));
      png.writeUInt32BE(crc, off + 8 + len);
      return png;
    }
    if (type === "IDAT") break; // acTL must come before the image data
    off += 12 + len;
  }
  throw new Error("not an animated PNG (no acTL chunk)");
}

async function download(id) {
  const cached = join(CACHE_DIR, `${id}.png`);
  if (existsSync(cached)) return readFile(cached);
  const res = await fetch(STICKER_URL(id));
  if (!res.ok) throw new Error(`sticker ${id}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(cached, buf);
  return buf;
}

// --- optional walk cycle via sprite-gen --------------------------------

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { stdio: ["ignore", "pipe", "pipe"], ...opts }).toString();
}

async function generateWalk(id, char) {
  const sgDir = process.env.SPRITE_GEN_DIR ?? join(homedir(), ".cache", "sprite-gen");
  const sg = join(sgDir, ".venv", "bin", "sprite-gen");
  if (!existsSync(sg)) {
    throw new Error(
      `sprite-gen not found at ${sg}. Clone https://github.com/aldegad/sprite-gen to ${sgDir} ` +
        `and run: python3 -m venv .venv && .venv/bin/pip install -e .  (or set SPRITE_GEN_DIR)`,
    );
  }
  const work = join(CACHE_DIR, `walk-${id}`);
  await mkdir(work, { recursive: true });
  // 1. a clean side-view still drawn from the idle sticker's first frame
  const refFrame = join(work, "ref.png");
  run("ffmpeg", ["-y", "-loglevel", "error", "-i", join(PACKS_DIR, id, "idle.apng"), "-frames:v", "1", refFrame]);
  const base = join(work, "base.png");
  if (!existsSync(base)) {
    const prompt =
      `${char.walkHint}. Full body, standing in a side view facing right, whole body visible. ` +
      `Match the attached reference character's look, palette and soft hand-drawn outline exactly. ` +
      `No text, no speech bubbles, no other characters. Transparent background.`;
    run(sg, ["gen", "--provider", "codex", "--prompt", prompt, "--ref", refFrame, "--transparent", "--out", base]);
  }
  // 2. a six-frame walk row on that still
  const runDir = join(work, "run");
  const request = {
    cell: { shape: "rect", width: 192, height: 192, safe_margin_x: 18, safe_margin_y: 14 },
    states: {
      walk: {
        frames: 6,
        fps: 8,
        loop: true,
        action:
          "side-view walk cycle facing right: short stubby legs alternate with clear foot contact, a little body bounce, arms swing slightly; no text; the body scale is identical in all six frames",
      },
    },
    style:
      "match the attached base reference image EXACTLY: same soft hand-drawn outline, same palette, same body proportions. Do not restyle, no text.",
    motion_phase_guides: false,
    fit: { align_x: "foot-centroid", align_y: "bottom" },
  };
  run(sg, [
    "prepare", "--out-dir", runDir, "--character-id", `${id}-walk`, "--base-image", base,
    "--description", char.walkHint, "--chroma-key", "auto", "--request-json", JSON.stringify(request), "--force",
  ]);
  run(sg, ["gen-set", "--run-dir", runDir, "--provider", "codex"]);
  run(sg, ["extract", "--run-dir", runDir]);
  run("ffmpeg", [
    "-y", "-loglevel", "error", "-framerate", "8", "-i", join(runDir, "frames", "walk", "frame-%d.png"),
    "-c:v", "apng", "-plays", "0", join(PACKS_DIR, id, "walk.apng"),
  ]);
}

// --- main ---------------------------------------------------------------

async function readIndex() {
  try {
    return JSON.parse(await readFile(LOCAL_INDEX, "utf8"));
  } catch {
    return [];
  }
}

async function main() {
  const args = process.argv.slice(2);
  const flags = new Set(args.filter((a) => a.startsWith("--")));
  const unknownFlags = [...flags].filter((f) => !["--generate-walk", "--remove", "--help"].includes(f));
  if (flags.has("--help") || unknownFlags.length) {
    console.log("usage: node scripts/make-chiikawa-pack.mjs [chiikawa|hachiware|usagi ...] [--generate-walk] [--remove]");
    process.exit(unknownFlags.length ? 2 : 0);
  }
  const names = args.filter((a) => !a.startsWith("--"));
  for (const n of names) {
    if (!CHARACTERS[n]) throw new Error(`unknown character "${n}" (choose: ${Object.keys(CHARACTERS).join(", ")})`);
  }
  const ids = names.length ? names : Object.keys(CHARACTERS);
  let index = (await readIndex()).filter((p) => !ids.includes(p.id));

  if (flags.has("--remove")) {
    for (const id of ids) await rm(join(PACKS_DIR, id), { recursive: true, force: true });
    await writeFile(LOCAL_INDEX, JSON.stringify(index, null, 2) + "\n");
    console.log(`removed: ${ids.join(", ")}`);
    return;
  }

  for (const id of ids) {
    const char = CHARACTERS[id];
    const dir = join(PACKS_DIR, id);
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    for (const [state, stickers] of Object.entries(char.states)) {
      for (const [i, sticker] of stickers.entries()) {
        const apng = setPlays(Buffer.from(await download(sticker)), ONCE.has(state) ? 1 : 0);
        const file = i === 0 ? `${state}.apng` : `${state}.${i + 1}.apng`;
        await writeFile(join(dir, file), apng);
      }
    }
    if (flags.has("--generate-walk")) {
      console.log(`${id}: drawing a walk cycle with sprite-gen (takes a few minutes)…`);
      await generateWalk(id, char);
    }
    index.push({ id, name: char.name, emoji: char.emoji, fanmade: true });
    console.log(`${id}: ${dir}`);
  }
  index.sort((a, b) => a.id.localeCompare(b.id));
  await writeFile(LOCAL_INDEX, JSON.stringify(index, null, 2) + "\n");
  console.log("Done. Open Settings (right-click the pet) and pick the character.");
}

main().catch((err) => {
  console.error(`error: ${err.message}`);
  process.exit(1);
});
