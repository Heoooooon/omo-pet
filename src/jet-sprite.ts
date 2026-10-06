// Which sprite a jet ride shows: the level "jet" loop, or the diagonal
// "jet-climb" loop when the pack ships one and the flight path climbs
// steeply. Packs without jet-climb keep the level jet for every path.
export type JetSprite = "jet" | "jet-climb";

// Climb angle above horizontal (degrees) from which the diagonal loop reads
// better than the level one.
export const JET_CLIMB_MIN_ANGLE = 20;

// dx, dy: window travel in screen px (y grows downward, so a climb is dy < 0).
export function jetSpriteFor(
  dx: number,
  dy: number,
  has: (key: string) => boolean,
): JetSprite {
  if (!has("jet-climb")) return "jet";
  const climb = -dy;
  if (climb <= 0) return "jet";
  const angle = (Math.atan2(climb, Math.abs(dx)) * 180) / Math.PI;
  return angle > JET_CLIMB_MIN_ANGLE ? "jet-climb" : "jet";
}
