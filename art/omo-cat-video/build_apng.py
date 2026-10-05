"""Fit sprite-gen video-loop cycles into the previous pack's APNG cells (see README.md here)."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image, ImageSequence

HERE = Path(__file__).resolve().parent


def read_frames(path: Path) -> list[Image.Image]:
    with Image.open(path) as im:
        return [f.convert("RGBA").copy() for f in ImageSequence.Iterator(im)]


def union_bbox(frames: list[Image.Image], threshold: int = 16) -> tuple[int, int, int, int]:
    box = None
    for f in frames:
        b = f.getchannel("A").point([0] * (threshold + 1) + [255] * (255 - threshold)).getbbox()
        if b:
            box = b if box is None else (min(box[0], b[0]), min(box[1], b[1]), max(box[2], b[2]), max(box[3], b[3]))
    if box is None:
        raise SystemExit("no opaque pixels")
    return box


def sample(frames: list[Image.Image], n: int) -> list[Image.Image]:
    if n >= len(frames):
        return frames
    return [frames[round(i * (len(frames) - 1) / (n - 1))] for i in range(n)]


def fit_cells(src: list[Image.Image], reference: list[Image.Image],
              end_on: Image.Image | None = None, fit: str = "box") -> list[Image.Image]:
    width, height = reference[0].size
    box = union_bbox(src)
    if end_on is None:
        ref_box = union_bbox(reference)
        by_height = (ref_box[3] - ref_box[1]) / (box[3] - box[1])
        if fit == "height":  # longer prop than the reference: match height, stay inside the cell
            scale = min(by_height, width / (box[2] - box[0]))
        else:
            scale = min((ref_box[2] - ref_box[0]) / (box[2] - box[0]), by_height)
        centre_x, bottom = (ref_box[0] + ref_box[2]) / 2, ref_box[3]
    else:
        target, last = union_bbox([end_on]), union_bbox([src[-1]])
        scale = (target[3] - target[1]) / (last[3] - last[1])
        centre_x = (target[0] + target[2]) / 2 - ((last[0] + last[2]) / 2 - (box[0] + box[2]) / 2) * scale
        bottom = target[3] + (box[3] - last[3]) * scale
    cells = []
    for f in src:
        c = f.crop(box)
        c = c.convert("RGBa").resize((max(1, round(c.width * scale)), max(1, round(c.height * scale))), Image.Resampling.LANCZOS).convert("RGBA")
        x = min(max(0, round(centre_x - c.width / 2)), width - c.width)
        y = min(max(0, round(bottom - c.height)), height - c.height)
        cell = Image.new("RGBA", (width, height), (0, 0, 0, 0))
        cell.alpha_composite(c, (x, y))
        cells.append(cell)
    return cells


def defringe(cells: list[Image.Image]) -> list[Image.Image]:
    """Pull leftover magenta key out of red prop edges (rocket fins, flame): blue drops to green."""
    out = []
    for c in cells:
        r, g, b, a = c.split()
        rp, gp, bp, ap = r.load(), g.load(), b.load(), a.load()
        for y in range(c.height):
            for x in range(c.width):
                if ap[x, y] and rp[x, y] - gp[x, y] > 60 and bp[x, y] - gp[x, y] > 60:
                    bp[x, y] = gp[x, y]
        out.append(Image.merge("RGBA", (r, g, b, a)))
    return out


def save_apng(cells: list[Image.Image], dst: Path, seconds: float, plays: int) -> None:
    width, height = cells[0].size
    mosaic = Image.new("RGBA", (width, height * len(cells)))
    for i, c in enumerate(cells):
        mosaic.paste(c, (0, i * height))
    quantized = mosaic.quantize(colors=256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE)
    palette = quantized.getpalette("RGBA")
    if palette is None:
        raise SystemExit("quantize returned no palette")
    for i in range(3, len(palette), 4):  # octree rounds opaque alpha to 254: snap the ends
        palette[i] = 255 if palette[i] >= 240 else (0 if palette[i] <= 8 else palette[i])
    quantized.putpalette(palette, "RGBA")
    frames = [quantized.crop((0, i * height, width, (i + 1) * height)) for i in range(len(cells))]
    frames[0].save(dst, format="PNG", save_all=True, append_images=frames[1:],
                   duration=round(1000 * seconds / len(frames)), disposal=0, blend=0, loop=plays)


def main() -> None:
    parser = argparse.ArgumentParser(description="Fit sprite-gen video-loop cycles into omo-pet APNG cells.")
    parser.add_argument("--cycles", type=Path, required=True)
    parser.add_argument("--reference-pack", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--states", default="")
    parser.add_argument("--spec", type=Path, default=HERE / "states.json",
                        help="states.json of the pack being built (default: omo-cat's)")
    args = parser.parse_args()
    spec = json.loads(args.spec.read_text(encoding="utf-8"))
    wanted = [s for s in args.states.split(",") if s] or list(spec)
    for state in wanted:
        item = spec[state]
        cycle = sorted((args.cycles / item["cycle"]).glob("*.png"))
        skip = set(item.get("skip", []))  # source frames blurred into the chroma key
        cycle = [p for i, p in enumerate(cycle) if i not in skip]
        src = [Image.open(p).convert("RGBA") for p in cycle]
        src = sample(src, max(2, round(item["seconds"] * item["fps"])))
        end_on = read_frames(args.out / f"{item['end_on']}.apng")[0] if "end_on" in item else None
        cells = fit_cells(src, read_frames(args.reference_pack / f"{state}.apng"), end_on, item.get("fit", "box"))
        if item.get("defringe"):
            cells = defringe(cells)
        save_apng(cells, args.out / f"{state}.apng", item["seconds"], item["plays"])
        print(state, len(cells), "frames")


if __name__ == "__main__":
    main()
