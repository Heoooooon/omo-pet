"""Fit the band's sprite-gen video-loop cycles into omo-pet APNG cells (see README.md here).

Idle and walk share omo-cat's idle cell (192x256, body 224 px tall, feet 16 px above the
bottom) so friend packs display like the default pet. Play loops keep the same body
scale in a cell as wide as the instrument needs.
"""
from __future__ import annotations

import argparse
import json
import statistics
import sys
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "omo-cat-video"))
from build_apng import save_apng, union_bbox  # noqa: E402

CELL_W, CELL_H, BODY_H, FOOT_MARGIN = 192, 256, 224, 16
PLAY_MAX_W = 400


def alpha_box(frame: Image.Image, threshold: int = 16):
    return frame.getchannel("A").point([0] * (threshold + 1) + [255] * (255 - threshold)).getbbox()


def standing_height(frames: list[Image.Image]) -> float:
    return statistics.median(b[3] - b[1] for b in map(alpha_box, frames) if b)


def pin_to_ground(frames: list[Image.Image]) -> list[Image.Image]:
    """A walking body always has one foot down: put every frame's lowest opaque row on one
    ground line and its body centroid on one x, so the cycle neither bobs nor slides."""
    stats = []
    for f in frames:
        ys, xs = np.nonzero(np.asarray(f.getchannel("A")) > 128)
        stats.append((int(ys.max()) + 1, float(xs.mean())))
    ground = round(statistics.median(b for b, _ in stats))
    centre = statistics.fmean(c for _, c in stats)
    pinned = []
    for f, (bottom, cx) in zip(frames, stats):
        out = Image.new("RGBA", f.size, (0, 0, 0, 0))
        out.alpha_composite(f, (round(centre - cx), ground - bottom))
        pinned.append(out)
    return pinned


def fit(frames: list[Image.Image], scale: float, width: int) -> list[Image.Image]:
    box = union_bbox(frames)
    cells = []
    for f in frames:
        c = f.crop(box)
        c = c.convert("RGBa").resize((max(1, round(c.width * scale)), max(1, round(c.height * scale))),
                                      Image.Resampling.LANCZOS).convert("RGBA")
        cell = Image.new("RGBA", (width, CELL_H), (0, 0, 0, 0))
        x = round((width - c.width) / 2)
        y = CELL_H - FOOT_MARGIN - c.height
        if x < 0 or y < 0:
            raise SystemExit(f"cycle does not fit the {width}x{CELL_H} cell at scale {scale:.3f}")
        cell.alpha_composite(c, (x, y))
        cells.append(cell)
    return cells


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cycles", type=Path, required=True, help="generation root holding the cycle folders")
    parser.add_argument("--out", type=Path, required=True, help="public/packs")
    parser.add_argument("--packs", default="")
    args = parser.parse_args()
    spec = json.loads((HERE / "states.json").read_text(encoding="utf-8"))
    for pack in [p for p in args.packs.split(",") if p] or list(spec):
        out = args.out / pack
        out.mkdir(parents=True, exist_ok=True)
        states = spec[pack]
        loaded = {s: [Image.open(p).convert("RGBA") for p in sorted((args.cycles / item["cycle"]).glob("*.png"))]
                  for s, item in states.items()}
        for state, frames in loaded.items():
            item = states[state]
            frames = frames[: item.get("frames", len(frames))]
            if state == "walk":
                frames = pin_to_ground(frames)
            box = union_bbox(frames)
            scale = BODY_H * item.get("body", 1.0) / standing_height(frames)
            if state == "play":
                scale = min(scale, (PLAY_MAX_W - 16) / (box[2] - box[0]))
                width = min(PLAY_MAX_W, (round((box[2] - box[0]) * scale) + 16 + 1) // 2 * 2)
            else:
                scale = min(scale, (CELL_W - 8) / (box[2] - box[0]))
                width = CELL_W
            cells = fit(frames, scale, width)
            save_apng(cells, out / f"{state}.apng", len(cells) / 24, 0)
            print(pack, state, len(cells), "frames", f"{width}x{CELL_H}", f"scale {scale:.3f}")


if __name__ == "__main__":
    main()
