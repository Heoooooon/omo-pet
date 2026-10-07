"""Head-size metrics per pack (rotation/yaw tolerant), in the image's own pixels.

omo      (OmO):      height of the glowing lime "O" eye ring (closed-eye arcs: arc spacing / ARC_RATIO)
omo-cat  (Omo):      ear tip to scarf top (earscarf, from the omopet-size-omo work)
jabdori:             sqrt(area) of the largest charcoal floppy ear
croissant-mouse:     sqrt(area) of the largest compact pink inner ear (build_pack.ear_size)
"""
from __future__ import annotations

import numpy as np
from PIL import Image
from scipy import ndimage

import sys
sys.path.insert(0, str(__import__("pathlib").Path(__file__).parent))
from earscarf import ear_to_scarf  # noqa: E402
from eye import eyes  # noqa: E402

ARC_RATIO = None  # filled by calibrate_arcs(); spacing between eye centres / ring height


def lime(a):
    r, g, b, al = a[..., 0], a[..., 1], a[..., 2], a[..., 3]
    return (al > 200) & (g > 150) & (r > 110) & (b < 120) & (g > b + 80)


def omo_rings(a):
    rgb = a[..., :3].astype(np.uint8)
    c = eyes(rgb, "omo", a[..., 3])
    return c


def omo_ring_height(a):
    c = omo_rings(a)
    if not c:
        return None
    return float(max(c, key=lambda e: e["area"])["h"])


def omo_eye_spacing(a, rings=True):
    """Distance between the two eye glyph centres (rings, or arcs when rings=False)."""
    m = lime(a)
    lab, n = ndimage.label(ndimage.binary_closing(m, iterations=1))
    comps = []
    for i, sl in enumerate(ndimage.find_objects(lab)):
        area = int((lab[sl] == i + 1).sum())
        h, w = sl[0].stop - sl[0].start, sl[1].stop - sl[1].start
        if area < 12:
            continue
        comps.append(dict(area=area, h=h, w=w, cx=(sl[1].start + sl[1].stop) / 2, cy=(sl[0].start + sl[0].stop) / 2))
    if len(comps) < 2:
        return None
    # the face glyph is the three/two biggest lime blobs sitting on one row; eyes are the outer two
    comps.sort(key=lambda c: -c["area"])
    top = comps[:4]
    best = None
    for i in range(len(top)):
        for j in range(i + 1, len(top)):
            p, q = top[i], top[j]
            dy = abs(p["cy"] - q["cy"])
            dx = abs(p["cx"] - q["cx"])
            size = max(p["w"], q["w"])
            if dy > 0.6 * size or dx < 1.5 * size:
                continue
            sim = min(p["area"], q["area"]) / max(p["area"], q["area"])
            if sim < 0.4:
                continue
            if best is None or dx > best:
                best = dx
    return best


def omo_arc_width(a):
    m = ndimage.binary_closing(lime(a), iterations=1)
    lab, n = ndimage.label(m)
    comps = []
    for i, sl in enumerate(ndimage.find_objects(lab)):
        h, w = sl[0].stop - sl[0].start, sl[1].stop - sl[1].start
        if w >= 6:
            comps.append(dict(w=w, h=h, cx=(sl[1].start + sl[1].stop) / 2, cy=(sl[0].start + sl[0].stop) / 2))
    best = None
    for p in comps:
        if p["w"] < 8 or p["w"] < 1.3 * p["h"]:
            continue
        near = [q for q in comps if q is not p and abs(q["cx"] - p["cx"]) < 2.5 * p["w"] and abs(q["cy"] - p["cy"]) < p["w"]]
        if near and (best is None or p["w"] > best):
            best = p["w"]
    return float(best) if best else None


def frontal_ring_ratio(a):
    c = [e for e in omo_rings(a) if e["h"] >= 10]
    if len(c) < 2:
        return None
    c = sorted(c, key=lambda e: -e["area"])[:2]
    if min(e["w"] / e["h"] for e in c) < 0.75:
        return None
    return float(np.mean([e["w"] / e["h"] for e in c]))


def omo_head(a):
    h = omo_ring_height(a)
    if h:
        return h
    if ARC_RATIO:
        w = omo_arc_width(a)
        if w:
            return w / ARC_RATIO
    return None


def jabdori_ear(a):
    rgb = a[..., :3].astype(int)
    al = a[..., 3]
    mx, mn = rgb.max(-1), rgb.min(-1)
    m = (al > 200) & (mx < 115) & (mx > 35) & (mx - mn < 28)
    m = ndimage.binary_opening(m, iterations=max(1, a.shape[1] // 300))
    lab, n = ndimage.label(m)
    best = 0
    for i, sl in enumerate(ndimage.find_objects(lab)):
        comp = lab[sl] == i + 1
        area = int(comp.sum())
        h, w = sl[0].stop - sl[0].start, sl[1].stop - sl[1].start
        if area / (h * w) < 0.35:
            continue
        best = max(best, area)
    return float(np.sqrt(best)) if best else None


def jabdori_face(a):
    rgb = a[..., :3].astype(int)
    al = a[..., 3]
    mn, mx = rgb.min(-1), rgb.max(-1)
    m = (al > 200) & (mn > 205) & ((mx - mn) < 45)
    m = ndimage.binary_opening(m, iterations=1)
    lab, n = ndimage.label(m)
    if n == 0:
        return None
    objs = ndimage.find_objects(lab)
    sizes = ndimage.sum(m, lab, range(1, n + 1))
    cands = [(objs[i][0].start, i) for i in range(n) if sizes[i] > 0.004 * m.size]
    if not cands:
        return None
    _, i = min(cands)
    sl = objs[i]
    comp = ndimage.binary_fill_holes(lab[sl] == i + 1)
    ys, xs = np.nonzero(comp)
    return float(xs.max() - xs.min() + 1)


def cat_head(a):
    r = ear_to_scarf(a)
    return r["h"] if r else None


def mouse_ear(a):
    r, g, b, al = (a[..., k].astype(int) for k in range(4))
    m = (al > 200) & (r > 190) & (r - g > 30) & (b > 110) & (g > 110) & (r - b > 25)
    lab, _ = ndimage.label(ndimage.binary_opening(m, iterations=1))
    best = 0
    for i, sl in enumerate(ndimage.find_objects(lab)):
        area = int((lab[sl] == i + 1).sum())
        h, w = sl[0].stop - sl[0].start, sl[1].stop - sl[1].start
        if area >= 30 and area / (h * w) >= 0.45 and max(h, w) / max(1, min(h, w)) <= 2.6:
            best = max(best, area)
    return float(np.sqrt(best)) if best else None


METRIC = {"omo": omo_head, "omo-cat": cat_head, "jabdori": jabdori_face, "mouse": mouse_ear, "croissant-mouse": mouse_ear}


def measure(pack: str, im: Image.Image, up: int = 1):
    """Metric in the image's own pixels; `up` upsamples small sprites first."""
    im = im.convert("RGBA")
    if up > 1:
        im = im.resize((im.width * up, im.height * up), Image.Resampling.LANCZOS)
    v = METRIC[pack](np.asarray(im))
    return v / up if v else None
