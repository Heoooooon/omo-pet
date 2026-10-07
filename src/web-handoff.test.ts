import { test } from "node:test";
import assert from "node:assert/strict";
import {
  arrivalSpot,
  entersView,
  insideView,
  pageZoom,
  toScreen,
  toViewport,
  viewportOnScreen,
  viewportRect,
} from "./web-handoff.ts";

// Chrome on macOS at 100%: no side borders, 87 pt of tabs and toolbar.
const mac = { screenX: 100, screenY: 40, outerWidth: 1200, outerHeight: 900, innerWidth: 1200, innerHeight: 813 };

test("the right edge of a mac browser page maps to the window's right edge on screen", () => {
  const v = viewportOnScreen(mac);
  assert.deepEqual(v, { left: 100, top: 127, zoom: 1 });
  assert.deepEqual(toScreen(v, 1200, 813), { x: 1300, y: 940 });
});

test("page zoom scales CSS px into screen points and survives a round trip", () => {
  const zoomed = { ...mac, innerWidth: 960, innerHeight: 650.4 }; // 125%
  assert.equal(pageZoom(zoomed), 1.25);
  const v = viewportOnScreen(zoomed);
  assert.equal(v.top, 127);
  const p = toScreen(v, 960, 650.4);
  assert.deepEqual([Math.round(p.x), Math.round(p.y)], [1300, 940]);
  const back = toViewport(v, p.x, p.y);
  assert.deepEqual([Math.round(back.x), Math.round(back.y * 10) / 10], [960, 650.4]);
});

test("window borders (Windows) are not mistaken for zoom and are kept off the page", () => {
  const win = { screenX: -8, screenY: -8, outerWidth: 1936, outerHeight: 1048, innerWidth: 1920, innerHeight: 961 };
  const v = viewportOnScreen(win);
  assert.equal(v.zoom, 1);
  assert.equal(v.left, 0);
  assert.equal(v.top, 71);
  assert.deepEqual(viewportRect(v, 1920, 961), { left: 0, top: 71, right: 1920, bottom: 1032 });
});

// A 2x built-in display with a 1x external to its right, both in points.
const builtIn = { x: 0, y: 0, w: 1512, h: 982 };
const external = { x: 1512, y: -200, w: 1920, h: 1080 };
const win = { w: 240, h: 320 };

test("leaving a page heading right, the desktop pet appears centered on the crossing point", () => {
  const s = arrivalSpot([builtIn, external], { x: 1300, feetY: 940, dir: 1 }, win, 140);
  assert.deepEqual(s, { x: 1180, y: 620, endX: 1272 });
});

test("a page on the display edge hands the pet to the neighbouring display", () => {
  const s = arrivalSpot([builtIn, external], { x: 1512, feetY: 860, dir: 1 }, win, 140);
  assert.ok(s);
  assert.equal(s.x, 1512); // whole window on the external display
  assert.equal(s.endX, 1652);
  const leftward = arrivalSpot([builtIn, external], { x: 1512, feetY: 860, dir: -1 }, win, 140);
  assert.ok(leftward);
  assert.equal(leftward.x, 1512 - 240);
});

test("a crossing below the floor or off every display is pulled back onto a display", () => {
  const s = arrivalSpot([builtIn], { x: 1600, feetY: 2000, dir: 1 }, win, 140);
  assert.deepEqual(s, { x: 1272, y: 662, endX: 1272 });
  assert.equal(arrivalSpot([], { x: 0, feetY: 0, dir: 1 }, win, 140), null);
});

test("a desktop pet entering a browser page is detected once, at the edge it came through", () => {
  const view = { left: 100, top: 127, right: 1300, bottom: 940 };
  assert.equal(entersView(view, 1350, 1290, 940), "right");
  assert.equal(entersView(view, 60, 120, 940), "left");
  assert.equal(entersView(view, 1290, 1280, 940), null); // already inside
  assert.equal(entersView(view, 1350, 1290, 1100), null); // walking on the floor below it
  assert.ok(insideView(view, 700, 500));
  assert.ok(!insideView(view, 700, 100)); // over the toolbar
});
