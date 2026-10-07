// Where the web overlay pet may stand. Everything is in viewport CSS px with
// y growing downward; a pet is described by its feet line (y), its horizontal
// center (cx), the half width of the widest standing sprite and its height.
// Surfaces are the viewport floor, any page element marked as a platform, and
// the top of every "avoid" rect (the chat composer): the pet may stand on an
// avoid rect but never overlap it.

export type Rect = Readonly<{ left: number; top: number; right: number; bottom: number }>;
export type Segment = Readonly<{ x1: number; x2: number; y: number }>;
export type World = Readonly<{
  width: number;
  height: number;
  platforms: readonly Segment[];
  avoid: readonly Rect[];
}>;
export type Body = Readonly<{ half: number; height: number }>;
export type RangeEnd = "wall" | "drop" | "blocked";
export type WalkRange = Readonly<{ min: number; max: number; minEnd: RangeEnd; maxEnd: RangeEnd }>;

const SAME_Y = 2;
const STEP = 4;

function blocks(a: Rect, cx: number, y: number, body: Body): boolean {
  return cx + body.half > a.left && cx - body.half < a.right && y - body.height < a.bottom && y > a.top + SAME_Y;
}

function supports(world: World, cx: number): number[] {
  const ys = [world.height];
  for (const p of world.platforms) if (cx >= p.x1 && cx <= p.x2) ys.push(p.y);
  for (const a of world.avoid) if (cx >= a.left && cx <= a.right) ys.push(a.top);
  return ys;
}

// The feet line the pet comes to rest on when it drops from feetY at cx:
// the highest surface at or below its feet, lifted onto any avoid rect the
// body would otherwise overlap.
export function restingY(world: World, cx: number, feetY: number, body: Body): number {
  let y = world.height;
  for (const s of supports(world, cx)) if (s >= feetY - SAME_Y && s < y) y = s;
  for (let lifted = true; lifted; ) {
    lifted = false;
    for (const a of world.avoid) {
      if (blocks(a, cx, y, body)) {
        y = a.top;
        lifted = true;
      }
    }
  }
  return y;
}

export function clear(world: World, cx: number, y: number, body: Body): boolean {
  return !world.avoid.some((a) => blocks(a, cx, y, body));
}

function supported(world: World, cx: number, y: number): boolean {
  return supports(world, cx).some((s) => Math.abs(s - y) <= SAME_Y);
}

// The contiguous stretch of centers the pet can walk to without leaving the
// surface at feet line y or walking into an avoid rect, and why each end ends.
export function walkRange(world: World, cx: number, y: number, body: Body): WalkRange {
  const lo = body.half;
  const hi = world.width - body.half;
  const scan = (dir: -1 | 1): [number, RangeEnd] => {
    let x = Math.min(hi, Math.max(lo, cx));
    for (;;) {
      const next = x + dir * STEP;
      if (dir === -1 ? next < lo : next > hi) return [dir === -1 ? lo : hi, "wall"];
      if (!supported(world, next, y)) return [x, "drop"];
      if (!clear(world, next, y, body)) return [x, "blocked"];
      x = next;
    }
  };
  const [min, minEnd] = scan(-1);
  const [max, maxEnd] = scan(1);
  return { min, max, minEnd, maxEnd };
}

// Highest feet line a straight horizontal flight from x1 to x2 may use so the
// body stays above every avoid rect it passes over.
export function flightCeiling(world: World, x1: number, x2: number, body: Body): number {
  const left = Math.min(x1, x2) - body.half;
  const right = Math.max(x1, x2) + body.half;
  let y = world.height;
  for (const a of world.avoid) if (a.right > left && a.left < right) y = Math.min(y, a.top);
  return y;
}
