"""Build the local 크로아상쥐 (croissant-mouse) fan pack from sprite-gen cycles.

The pack is imported through Settings > My character > Import a pack, so it gets the
generic sprite widths from src/style.css (176 px, the level jet 216 px) and no
pack-specific CSS. To keep one character size in every state, the size is baked
into the cells instead: every frame is scaled so the inner ear (largest compact
pink blob, sqrt of its area) measures the same in display pixels.

    uv run --no-project --with pillow --with numpy --with scipy \
      python art/croissant-mouse/build_pack.py --cycles <gen root> --out <pack dir>
"""
from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

HERE = Path(__file__).resolve().parent
# Display width (logical px) the app gives each state of an imported pack (src/style.css).
DISPLAY_WIDTH = {"jet": 216}
DEFAULT_WIDTH = 176
DPR = 2  # cells are drawn at 2x so the sprite stays sharp on Retina screens
EAR_DISPLAY = 14.5  # inner-ear size in display px; puts the standing mouse about 100 px tall
BOTTOM_MARGIN = 16 / 192  # feet 16 px above the bottom of a 192-px-wide cell, like the bundled packs
TOP_MARGIN = 0.04


def ear_size(im: Image.Image) -> float | None:
    a = np.asarray(im.convert("RGBA")).astype(int)
    r, g, b, al = a[..., 0], a[..., 1], a[..., 2], a[..., 3]
    m = (al > 200) & (r > 190) & (r - g > 30) & (b > 110) & (g > 110) & (r - b > 25)
    lab, _ = ndimage.label(ndimage.binary_opening(m, iterations=1))
    best = 0
    for i, sl in enumerate(ndimage.find_objects(lab)):
        area = int((lab[sl] == i + 1).sum())
        h, w = sl[0].stop - sl[0].start, sl[1].stop - sl[1].start
        if area >= 30 and area / (h * w) >= 0.45 and max(h, w) / max(1, min(h, w)) <= 2.6:
            best = max(best, area)
    return float(np.sqrt(best)) if best else None


def frame_sizes(frames: list[Image.Image], per_frame: bool, measure: str) -> list[float]:
    raw = [ear_size(f) for f in frames]
    known = [(i, s) for i, s in enumerate(raw) if s]
    if measure == "end":  # raised arms hide the ear early in the climb; the camera does not move
        known = [(i, s) for i, s in known if i >= len(frames) * 3 // 4]
    if not known:
        raise SystemExit("no ear found")
    if not per_frame:
        return [float(np.median([s for _, s in known]))] * len(frames)
    # Fill frames where the ear is hidden by interpolating between its neighbours.
    xs, ys = zip(*known)
    return [float(v) for v in np.interp(range(len(frames)), xs, ys)]


def alpha_box(im: Image.Image) -> tuple[int, int, int, int]:
    box = im.getchannel("A").point(lambda v: 255 if v > 16 else 0).getbbox()
    if box is None:
        raise SystemExit("empty frame")
    return box


def build_state(frames: list[Image.Image], item: dict, state: str) -> list[Image.Image]:
    display = DISPLAY_WIDTH.get(state, DEFAULT_WIDTH)
    width = display * DPR
    target = EAR_DISPLAY * DPR
    sizes = frame_sizes(frames, item.get("per_frame", False), item.get("measure", "all"))
    boxes = [alpha_box(f) for f in frames]
    # One anchor for the whole clip (bottom centre of the union box), so motion inside the clip survives.
    ax = (min(b[0] for b in boxes) + max(b[2] for b in boxes)) / 2
    ay = max(b[3] for b in boxes)
    placed = []
    for f, s, b in zip(frames, sizes, boxes):
        k = target / s
        crop = f.crop(b).convert("RGBa")
        crop = crop.resize((max(1, round(crop.width * k)), max(1, round(crop.height * k))), Image.Resampling.LANCZOS)
        placed.append((crop.convert("RGBA"), (b[0] - ax) * k, (b[1] - ay) * k))
    left = min(dx for _, dx, _ in placed)
    right = max(dx + c.width for c, dx, _ in placed)
    top = min(dy for _, _, dy in placed)
    if right - left > width:
        raise SystemExit(f"{state}: {right - left:.0f} px wide does not fit the {width} px cell")
    bottom = round(width * BOTTOM_MARGIN) if item.get("feet", True) else round(width * 0.02)
    height = round(-top + bottom + width * TOP_MARGIN)
    cx = width / 2 - (left + right) / 2
    cells = []
    for c, dx, dy in placed:
        cell = Image.new("RGBA", (width, height), (0, 0, 0, 0))
        cell.alpha_composite(c, (round(cx + dx), round(height - bottom + dy)))
        cells.append(cell)
    return cells


def sample(frames: list[Image.Image], n: int) -> list[Image.Image]:
    if n >= len(frames):
        return frames
    return [frames[round(i * (len(frames) - 1) / (n - 1))] for i in range(n)]


def save_apng(cells: list[Image.Image], dst: Path, seconds: float, plays: int) -> None:
    width, height = cells[0].size
    mosaic = Image.new("RGBA", (width, height * len(cells)))
    for i, c in enumerate(cells):
        mosaic.paste(c, (0, i * height))
    quantized = mosaic.quantize(colors=256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE)
    palette = quantized.getpalette("RGBA")
    if palette is None:
        raise SystemExit("quantize returned no palette")
    for i in range(3, len(palette), 4):  # octree rounds opaque alpha to 254; near-clear key specks drop: snap the ends
        palette[i] = 255 if palette[i] >= 240 else (0 if palette[i] <= 16 else palette[i])
    quantized.putpalette(palette, "RGBA")
    frames = [quantized.crop((0, i * height, width, (i + 1) * height)) for i in range(len(cells))]
    frames[0].save(dst, format="PNG", save_all=True, append_images=frames[1:],
                   duration=round(1000 * seconds / len(frames)), disposal=0, blend=0, loop=plays)


def main() -> None:
    parser = argparse.ArgumentParser(description="Build the croissant-mouse import pack.")
    parser.add_argument("--cycles", type=Path, required=True, help="sprite-gen output root")
    parser.add_argument("--cycles-v1", type=Path, help="first generation's output root (the croissant-rocket rides)")
    parser.add_argument("--out", type=Path, required=True, help="pack folder to write")
    parser.add_argument("--states", default="")
    parser.add_argument("--zip", action="store_true", help="also write <out>.zip for Import a pack")
    args = parser.parse_args()
    spec = json.loads((HERE / "states.json").read_text(encoding="utf-8"))
    args.out.mkdir(parents=True, exist_ok=True)
    for state in [s for s in args.states.split(",") if s] or list(spec):
        item = spec[state]
        root = args.cycles_v1 if item.get("gen") == "v1" else args.cycles
        if root is None:
            raise SystemExit(f"{state}: needs --cycles-v1")
        paths = sorted((root / item["cycle"]).glob("*.png"))
        skip = set(item.get("skip", []))
        paths = [p for i, p in enumerate(paths) if i not in skip]
        frames = sample([Image.open(p).convert("RGBA") for p in paths], max(2, round(item["seconds"] * item["fps"])))
        cells = build_state(frames, item, state)
        save_apng(cells, args.out / f"{state}.apng", item["seconds"], item["plays"])
        print(state, len(cells), "frames", cells[0].size)
    shutil.copy(HERE / "pack.json", args.out / "pack.json")
    if args.zip:
        shutil.make_archive(str(args.out), "zip", args.out)


if __name__ == "__main__":
    main()
