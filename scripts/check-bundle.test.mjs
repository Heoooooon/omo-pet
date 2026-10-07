import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const script = join(import.meta.dirname, "check-bundle.mjs");

function check(packs, ids = packs) {
  const dist = mkdtempSync(join(tmpdir(), "omopet-dist-"));
  try {
    for (const id of packs) {
      mkdirSync(join(dist, "packs", id), { recursive: true });
      writeFileSync(join(dist, "packs", id, "idle.apng"), "");
    }
    writeFileSync(join(dist, "packs", "packs.json"), JSON.stringify(ids.map((id) => ({ id }))));
    return spawnSync(process.execPath, [script, dist], { encoding: "utf8" }).status;
  } finally {
    rmSync(dist, { recursive: true, force: true });
  }
}

test("ships the originals together with the licensed OmO and Jabdori packs", () => {
  assert.equal(check(["omo", "omo-cat", "jabdori", "dalli", "bara", "dochi", "rupa"]), 0);
});

test("blocks a third-party pack folder next to Jabdori", () => {
  assert.equal(check(["omo-cat", "jabdori", "chiikawa"]), 1);
});

test("blocks a third-party pack id in packs.json", () => {
  assert.equal(check(["omo-cat", "jabdori"], ["omo-cat", "jabdori", "hachiware"]), 1);
});
