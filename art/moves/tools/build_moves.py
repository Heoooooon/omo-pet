"""Build the new move APNGs of a bundled pack at the idle sprite's head scale.

usage: build_moves.py <pack> <gen dir> <repo> [states]
Prints the CSS width each state needs (idle CSS width x cell width / idle cell width).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageSequence

sys.path.insert(0, str(Path(__file__).parent))
import metrics  # noqa: E402

IDLE_CSS = {"omo": 120, "omo-cat": 100, "jabdori": 97}
# The rocket rides set the size (rocket/jet CSS widths). Omo's scarf metric cannot see the rocket pose,
# so Omo keeps its idle head, which PR #11 already matched to the rides.
RIDES = {"omo": {"rocket": 160, "jet": 238}, "jabdori": {"rocket": 160, "jet": 221}, "omo-cat": {"idle": 100}}
SPEC = {
    "wake": {"src": "frames/keyed", "seconds": 1.0, "plays": 1, "measure_tail": 0.35},
    "sleep": {"src": "loop/cycle", "seconds": 3, "plays": 0, "match_start_of": "wake"},
    "stretch": {"src": "frames/keyed", "seconds": 3, "plays": 1},
    "climb": {"src": "loop/cycle", "seconds": 2, "plays": 0},
    "climb-slide": {"src": "loop/cycle", "seconds": 2, "plays": 0},
    "typing": {"src": "loop/cycle", "seconds": 2, "plays": 0},
}
# Side views where Jabdori's face is foreshortened: measure the big floppy ear instead, calibrated on idle.
EAR_STATES = {"jabdori": {"climb", "typing"}}
FPS = 24
PAD = 8


def apng(path):
    with Image.open(path) as im:
        return [f.convert("RGBA").copy() for f in ImageSequence.Iterator(im)]


def alpha_box(frames, threshold=16):
    box = None
    for f in frames:
        b = f.getchannel("A").point(lambda v: 255 if v > threshold else 0).getbbox()
        if b:
            box = b if box is None else (min(box[0], b[0]), min(box[1], b[1]), max(box[2], b[2]), max(box[3], b[3]))
    return box


def sample(frames, n):
    if n >= len(frames):
        return frames
    return [frames[round(i * (len(frames) - 1) / (n - 1))] for i in range(n)]


def defringe(cell):
    """Magenta key bleeding into warm edges (Omo's orange shoes): pull its blue down to green."""
    a = np.asarray(cell).copy()
    r, g, b = (a[..., k].astype(int) for k in range(3))
    spill = (a[..., 3] > 0) & (((r - g > 100) & (b - g > 35)) | ((r - g > 120) & (b - g > 15)))
    a[..., 2][spill] = a[..., 1][spill]
    return Image.fromarray(a, "RGBA")


def save_apng(cells, dst, seconds, plays):
    width, height = cells[0].size
    mosaic = Image.new("RGBA", (width, height * len(cells)))
    for i, c in enumerate(cells):
        mosaic.paste(c, (0, i * height))
    q = mosaic.quantize(colors=256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE)
    pal = q.getpalette("RGBA")
    for i in range(3, len(pal), 4):
        pal[i] = 255 if pal[i] >= 240 else (0 if pal[i] <= 16 else pal[i])
    q.putpalette(pal, "RGBA")
    frames = [q.crop((0, i * height, width, (i + 1) * height)) for i in range(len(cells))]
    frames[0].save(dst, format="PNG", save_all=True, append_images=frames[1:],
                   duration=round(1000 * seconds / len(frames)), disposal=0, blend=0, loop=plays)


def head_of(pack, frames, up=1):
    vals = [v for v in (metrics.measure(pack, f, up=up) for f in frames) if v]
    return (float(np.median(vals)) if vals else None), len(vals)


def calibrate_arcs(gen: Path):
    """OmO's closed-eye arcs are as wide as its rings: ring width / height on front-facing frames."""
    ratios = []
    for st in ("wake", "stretch"):
        for p in sorted((gen / "custom" / st / "frames" / "keyed").glob("*.png"))[::2]:
            r = metrics.frontal_ring_ratio(np.asarray(Image.open(p).convert("RGBA")))
            if r:
                ratios.append(r)
    return float(np.median(ratios)) if ratios else None


def main():
    pack, gen, repo = sys.argv[1], Path(sys.argv[2]), Path(sys.argv[3])
    states = sys.argv[4].split(",") if len(sys.argv) > 4 else list(SPEC)
    idle = apng(repo / "public/packs" / pack / "idle.apng")
    idle_w = idle[0].width
    css_heads = []
    for ride, width in RIDES[pack].items():
        fr = apng(repo / "public/packs" / pack / f"{ride}.apng")
        h, _ = head_of(pack, fr[:: max(1, len(fr) // 12)], up=4)
        css_heads.append(h * width / fr[0].width)
    target_css = float(np.mean(css_heads))
    ref = target_css * idle_w / IDLE_CSS[pack]
    feet = idle[0].height - alpha_box(idle)[3]
    if pack == "omo":
        metrics.ARC_RATIO = calibrate_arcs(gen)
    ear_to_head = None
    if pack == "jabdori":
        sel = idle[:: max(1, len(idle) // 12)]
        up = [f.resize((f.width * 4, f.height * 4), Image.Resampling.LANCZOS) for f in sel]
        ears = [v for v in (metrics.jabdori_ear(np.asarray(f)) for f in up) if v]
        faces = [v for v in (metrics.jabdori_face(np.asarray(f)) for f in up) if v]
        ear_to_head = float(np.median(faces)) / float(np.median(ears))
    report = {"pack": pack, "target_head_css": target_css, "ride_heads_css": css_heads, "ref_cellpx": ref, "idle_feet_px": feet, "arc_ratio": metrics.ARC_RATIO, "states": {}}
    for st in states:
        item = SPEC[st]
        paths = sorted((gen / "custom" / st / item["src"]).glob("*.png"))
        src = [Image.open(p).convert("RGBA") for p in paths]
        src = sample(src, max(2, round(item["seconds"] * FPS)))
        if "match_start_of" in item:
            # Same still as the first frame of that clip: carry its scale over by the pose's size.
            other = item["match_start_of"]
            first = Image.open(sorted((gen / "custom" / other / "frames" / "keyed").glob("*.png"))[0]).convert("RGBA")
            mine = Image.open(sorted((gen / "custom" / st / "frames" / "keyed").glob("*.png"))[0]).convert("RGBA")
            a, b = alpha_box([first]), alpha_box([mine])
            ratio = ((a[2] - a[0]) / (b[2] - b[0]) + (a[3] - a[1]) / (b[3] - b[1])) / 2
            k = report["states"][other]["scale"] * ratio
            h, found = ref / k, "from " + other
        else:
            tail = item.get("measure_tail")
            probe = src[-max(1, round(len(src) * tail)):] if tail else src
            if st in EAR_STATES.get(pack, ()):
                ear = [v for v in (metrics.jabdori_ear(np.asarray(f)) for f in probe) if v]
                h = float(np.median(ear)) * ear_to_head if ear else None
                found = f"ear {len(ear)}/{len(probe)}"
            else:
                h, found = head_of(pack, probe)
            if not h:
                raise SystemExit(f"{st}: head not found")
            k = ref / h
        box = alpha_box(src)
        cw = int(np.ceil((box[2] - box[0]) * k)) + 2 * PAD
        cw += cw % 2
        ch = int(np.ceil((box[3] - box[1]) * k)) + PAD + feet
        cells = []
        for f in src:
            c = f.crop(box).convert("RGBa")
            c = c.resize((max(1, round(c.width * k)), max(1, round(c.height * k))), Image.Resampling.LANCZOS).convert("RGBA")
            cell = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
            cell.alpha_composite(c, ((cw - c.width) // 2, ch - feet - c.height))
            cells.append(defringe(cell))
        out = repo / "public/packs" / pack / f"{st}.apng"
        save_apng(cells, out, item["seconds"], item["plays"])
        css = round(IDLE_CSS[pack] * cw / idle_w, 1)
        report["states"][st] = {"src_head": h, "found": f"{found}/{len(src)}", "scale": k, "cell": [cw, ch], "css_width": css, "frames": len(cells)}
        print(st, json.dumps(report["states"][st]), flush=True)
    (gen / f"build-{pack}.json").write_text(json.dumps(report, indent=1))


if __name__ == "__main__":
    main()
