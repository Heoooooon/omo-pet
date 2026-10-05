#!/usr/bin/env node
// Release guard: the built frontend (what Tauri bundles into the app) may
// carry only our original character packs and the characters we have a
// license for. Vite copies everything under public/ into dist/, so a
// git-ignored local pack would otherwise ship.
//
//   node scripts/check-bundle.mjs [distDir]   (default: dist)
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ORIGINAL_PACKS = ["omo-cat", "dalli", "bara", "dochi", "rupa"];
// Third-party characters shipped with the owner's permission. Each entry must
// say whose character it is and on what terms; anything else stays blocked.
const LICENSED_PACKS = {
  jabdori: "잡도리 © Sisyphus Labs (OmO Native), 허락 받아 사용 (permission from 김연규, 2026-10-05)",
};
const ALLOWED_PACKS = [...ORIGINAL_PACKS, ...Object.keys(LICENSED_PACKS)];
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
  console.error("Bundle check FAILED - only original or licensed packs may ship:");
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`Bundle check OK: ${ORIGINAL_PACKS.join(", ")}`);
for (const [id, note] of Object.entries(LICENSED_PACKS)) console.log(`  licensed: ${id} - ${note}`);
