#!/usr/bin/env node
// Release guard: the built frontend (what Tauri bundles into the app) may
// carry only our original character packs. Vite copies everything under
// public/ into dist/, so a git-ignored local pack would otherwise ship.
//
//   node scripts/check-bundle.mjs [distDir]   (default: dist)
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ALLOWED_PACKS = ["omo-cat", "dalli", "bara", "dochi", "rupa"];
const ALLOWED_STATES = /^(idle|walk|fall|fall-open|fall-glide|fall-land|edge|rocket|jet|play)(\.[234])?\.apng$/;

const dist = process.argv[2] ?? "dist";
const packsDir = join(dist, "packs");
const problems = [];

if (!existsSync(packsDir)) problems.push(`${packsDir} is missing (run vite build first)`);
else {
  for (const name of readdirSync(packsDir)) {
    const path = join(packsDir, name);
    if (name === "packs.json") continue;
    if (!statSync(path).isDirectory()) {
      problems.push(`unexpected file: ${path}`);
    } else if (!ALLOWED_PACKS.includes(name)) {
      problems.push(`non-allowlisted pack bundled: ${name}`);
    } else {
      for (const file of readdirSync(path)) {
        if (!ALLOWED_STATES.test(file)) problems.push(`unexpected file: ${join(path, file)}`);
      }
    }
  }
  try {
    const ids = JSON.parse(readFileSync(join(packsDir, "packs.json"), "utf8")).map((p) => p.id);
    for (const id of ids) if (!ALLOWED_PACKS.includes(id)) problems.push(`non-allowlisted pack id in packs.json: ${id}`);
  } catch (e) {
    problems.push(`packs.json unreadable: ${e.message}`);
  }
}

if (problems.length) {
  console.error("Bundle check FAILED - only original packs may ship:");
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`Bundle check OK: ${ALLOWED_PACKS.join(", ")}`);
