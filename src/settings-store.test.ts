import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DEFAULTS, loadSettings } from "./settings-store.ts";

const store = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  },
});

const bundled: { id: string; pack?: string }[] = JSON.parse(
  readFileSync(new URL("../public/packs/packs.json", import.meta.url), "utf8"),
);
const shownOnLaunch = (s: { pack: string; companions: string[] }) => [s.pack, ...s.companions];

test("first launch shows Omo and Jabdori, both free", () => {
  store.clear();
  const shown = shownOnLaunch(loadSettings());
  assert.deepEqual(shown, ["omo-cat", "jabdori"]);
  for (const id of shown) {
    const info = bundled.find((p) => p.id === id);
    assert.ok(info, `${id} is bundled`);
    assert.equal(info.pack, undefined, `${id} needs no paid pack`);
  }
});

test("settings saved before Jabdori existed still bring Jabdori along", () => {
  store.clear();
  store.set("omo-pet-settings", JSON.stringify({ pack: "omo-cat", size: 0.8 }));
  assert.deepEqual(shownOnLaunch(loadSettings()), ["omo-cat", "jabdori"]);
});

test("a user who hid Jabdori keeps it hidden", () => {
  store.clear();
  store.set("omo-pet-settings", JSON.stringify({ pack: "omo-cat", companions: [] }));
  assert.deepEqual(shownOnLaunch(loadSettings()), ["omo-cat"]);
  assert.deepEqual(DEFAULTS.companions, ["jabdori"], "loading never mutates the defaults");
});
