import { test } from "node:test";
import assert from "node:assert/strict";
import { clear, flightCeiling, restingY, walkRange, type World } from "./geometry.ts";

// A 1440x900 chat page: list column on the left, composer across the bottom right.
const composer = { left: 424, top: 774, right: 1440, bottom: 900 };
const page: World = { width: 1440, height: 900, platforms: [], avoid: [composer] };
const body = { half: 80, height: 200 };

test("a pet dropped over the composer lands on top of it, not behind it", () => {
  const y = restingY(page, 900, 300, body);
  assert.equal(y, composer.top);
  assert.ok(clear(page, 900, y, body));
});

test("a pet beside the composer stays on the floor but cannot overlap its edge", () => {
  assert.equal(restingY(page, 200, 300, body), 900);
  // Body would poke into the composer from the left: lifted onto it instead.
  assert.equal(restingY(page, composer.left - body.half / 2, 300, body), composer.top);
});

test("walking on the floor stops before the composer and at the viewport edge", () => {
  const range = walkRange(page, 200, 900, body);
  assert.equal(range.min, body.half);
  assert.equal(range.minEnd, "wall");
  assert.equal(range.maxEnd, "blocked");
  assert.ok(range.max + body.half <= composer.left);
});

test("walking on the composer ends where its top ends", () => {
  const range = walkRange(page, 900, composer.top, body);
  assert.equal(range.minEnd, "drop");
  assert.ok(range.min >= composer.left - 4 && range.min <= composer.left + 4);
  assert.equal(range.maxEnd, "wall");
});

test("a flight over the composer cruises above it", () => {
  assert.equal(flightCeiling(page, 100, 1300, body), composer.top);
  assert.equal(flightCeiling(page, 100, 300, body), 900);
});
