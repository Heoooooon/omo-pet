#!/usr/bin/env node
// Build the web overlay (the pet walking over a web page) into dist-overlay/:
//   overlay.js   one IIFE, no dependencies (src/overlay/main.ts)
//   overlay.css  src/overlay/base.css + the sprite rules of src/style.css
//   packs/       the overlay packs' sprites and a packs.json with their states
//
//   node scripts/build-overlay.mjs [outDir]
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { build } from "vite";
import { scopeCss } from "./overlay-css.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const out = resolve(process.argv[2] ?? join(ROOT, "dist-overlay"));
// Only packs we may ship (see LICENSED_PACKS in check-bundle.mjs): OmO and
// Jabdori are licensed from Sisyphus Labs, Omo (omo-cat) is our own.
const OVERLAY_PACKS = ["omo", "omo-cat", "jabdori"];
const STATES = /^(idle|walk|edge|fall|fall-open|fall-glide|fall-land|rocket|jet|jet-climb)\.apng$/;

rmSync(out, { recursive: true, force: true });
await build({
  root: ROOT,
  configFile: false,
  logLevel: "warn",
  build: {
    outDir: out,
    emptyOutDir: false,
    target: "es2022",
    minify: "esbuild",
    lib: {
      entry: join(ROOT, "src/overlay/main.ts"),
      formats: ["iife"],
      name: "omopetOverlay",
      fileName: () => "overlay.js",
    },
  },
});

const css = readFileSync(join(ROOT, "src/overlay/base.css"), "utf8") + "\n" + scopeCss(readFileSync(join(ROOT, "src/style.css"), "utf8"));
writeFileSync(join(out, "overlay.css"), css);

const all = JSON.parse(readFileSync(join(ROOT, "public/packs/packs.json"), "utf8"));
const manifest = [];
for (const id of OVERLAY_PACKS) {
  const info = all.find((p) => p.id === id);
  const dir = join(ROOT, "public/packs", id);
  if (!info || !existsSync(dir)) throw new Error(`overlay pack missing: ${id}`);
  const files = readdirSync(dir).filter((f) => STATES.test(f));
  if (!files.includes("idle.apng")) throw new Error(`overlay pack ${id} has no idle.apng`);
  mkdirSync(join(out, "packs", id), { recursive: true });
  for (const f of files) copyFileSync(join(dir, f), join(out, "packs", id, f));
  manifest.push({
    id,
    name: info.names?.ko ?? info.name,
    stride: info.stride ?? 43,
    states: files.map((f) => f.replace(/\.apng$/, "")).sort(),
  });
}
writeFileSync(join(out, "packs/packs.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`overlay built: ${out} (${manifest.map((p) => `${p.id}:${p.states.length}`).join(", ")})`);
