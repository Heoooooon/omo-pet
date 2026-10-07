import { test } from "node:test";
import assert from "node:assert/strict";
import { JET_CLIMB_MIN_ANGLE, jetSpriteFor } from "./jet-sprite.ts";

const withClimb = (key: string) => key === "jet" || key === "jet-climb";
const jetOnly = (key: string) => key === "jet";

test("a steep climb uses jet-climb when the pack ships it", () => {
  assert.equal(jetSpriteFor(400, -400, withClimb), "jet-climb"); // 45°
  assert.equal(jetSpriteFor(-300, -300, withClimb), "jet-climb"); // leftward, same angle
  assert.equal(jetSpriteFor(0, -200, withClimb), "jet-climb"); // straight up
});

test("a shallow climb, level flight or a descent keeps the level jet", () => {
  assert.equal(jetSpriteFor(800, -100, withClimb), "jet"); // ~7°
  assert.equal(jetSpriteFor(800, 0, withClimb), "jet");
  assert.equal(jetSpriteFor(800, 300, withClimb), "jet");
});

test("the threshold is the documented angle", () => {
  const rad = (JET_CLIMB_MIN_ANGLE * Math.PI) / 180;
  assert.equal(jetSpriteFor(1000, -Math.tan(rad) * 1000 * 0.98, withClimb), "jet");
  assert.equal(jetSpriteFor(1000, -Math.tan(rad) * 1000 * 1.02, withClimb), "jet-climb");
});

test("a pack without jet-climb never asks for it", () => {
  assert.equal(jetSpriteFor(0, -500, jetOnly), "jet");
  assert.equal(jetSpriteFor(100, -400, () => false), "jet");
});
