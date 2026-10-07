// Geometry shared by the web overlay and the desktop pet for the handoff
// between a browser tab and the desktop. Screen values are logical points
// with the origin at the primary display's top-left: what Chrome reports in
// window.screenX and what the desktop app's monitors use (logicalRect).

export type ScreenRect = Readonly<{ left: number; top: number; right: number; bottom: number }>;
export type WindowMetrics = Readonly<{
  screenX: number;
  screenY: number;
  outerWidth: number;
  outerHeight: number;
  innerWidth: number;
  innerHeight: number;
}>;
/** The page viewport on screen: its top-left in points and points per CSS px. */
export type Viewport = Readonly<{ left: number; top: number; zoom: number }>;
export type MonitorRect = Readonly<{ x: number; y: number; w: number; h: number }>;

// Chrome's page zoom steps. outer/inner width is the zoom plus a few points
// of window border on some systems; snapping drops the border.
const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];

export function pageZoom(m: WindowMetrics): number {
  if (!(m.innerWidth > 0 && m.outerWidth > 0)) return 1;
  const ratio = m.outerWidth / m.innerWidth;
  return ZOOM_STEPS.reduce((best, z) => (Math.abs(z - ratio) < Math.abs(best - ratio) ? z : best), 1);
}

// Toolbars sit on top; any side border is split evenly and assumed at the
// bottom as well.
export function viewportOnScreen(m: WindowMetrics): Viewport {
  const zoom = pageZoom(m);
  const border = Math.max(0, (m.outerWidth - m.innerWidth * zoom) / 2);
  return {
    left: m.screenX + border,
    top: m.screenY + Math.max(0, m.outerHeight - m.innerHeight * zoom - border),
    zoom,
  };
}

export function toScreen(v: Viewport, x: number, y: number): { x: number; y: number } {
  return { x: v.left + x * v.zoom, y: v.top + y * v.zoom };
}

export function toViewport(v: Viewport, x: number, y: number): { x: number; y: number } {
  return { x: (x - v.left) / v.zoom, y: (y - v.top) / v.zoom };
}

export function viewportRect(v: Viewport, width: number, height: number): ScreenRect {
  return { left: v.left, top: v.top, right: v.left + width * v.zoom, bottom: v.top + height * v.zoom };
}

function monitorAt(monitors: readonly MonitorRect[], x: number, y: number): MonitorRect | undefined {
  const inside = monitors.find((m) => x >= m.x && x < m.x + m.w && y >= m.y && y <= m.y + m.h);
  if (inside) return inside;
  const distance = (m: MonitorRect) =>
    Math.hypot(Math.max(m.x - x, 0, x - (m.x + m.w)), Math.max(m.y - y, 0, y - (m.y + m.h)));
  return [...monitors].sort((a, b) => distance(a) - distance(b))[0];
}

/**
 * Where the desktop pet window appears for a pet that left a page at screen
 * point (x, feetY) heading dir, and how far it may carry on: the window is
 * centered on the crossing point, kept on the display just past the page
 * edge, and its run ends at most `run` points further or at that display's side.
 */
export function arrivalSpot(
  monitors: readonly MonitorRect[],
  at: Readonly<{ x: number; feetY: number; dir: -1 | 1 }>,
  win: Readonly<{ w: number; h: number }>,
  run: number,
): { x: number; y: number; endX: number } | null {
  const m = monitorAt(monitors, at.x + at.dir, at.feetY);
  if (!m) return null;
  const minX = m.x;
  const maxX = m.x + m.w - win.w;
  const clampX = (v: number) => Math.min(maxX, Math.max(minX, v));
  const x = clampX(at.x - win.w / 2);
  const feet = Math.min(m.y + m.h, Math.max(m.y + win.h, at.feetY));
  return { x, y: feet - win.h, endX: clampX(x + at.dir * run) };
}

/** A pet center/feet point inside the page area of a browser window. */
export function insideView(view: ScreenRect, cx: number, feetY: number): boolean {
  return cx > view.left && cx < view.right && feetY > view.top && feetY <= view.bottom + 24;
}

/**
 * The page edge a desktop pet walking from prevCx to cx at feetY crosses
 * into the page through, or null.
 */
export function entersView(view: ScreenRect, prevCx: number, cx: number, feetY: number): "left" | "right" | null {
  if (!insideView(view, cx, feetY) || insideView(view, prevCx, feetY)) return null;
  return prevCx <= view.left ? "left" : "right";
}
