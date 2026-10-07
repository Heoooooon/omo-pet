# 눈 높이(세로 지름) 검출: 고개 돌림(yaw)에 둔감한 크기 지표.
# omo: 네온 "O" 글자(구멍 있는 고리), omo-cat: 갈색 홍채(+동공 채움).
import numpy as np
from scipy import ndimage


def _mask(rgb, pack):
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    if pack == "omo":
        return (g > 150) & (r > 110) & (b < 120) & (g > b + 80)
    # omo-cat 홍채: 갈색~주황
    return (r > 110) & (r > g + 20) & (g > b + 15) & (r < 252)


def eyes(img, pack, alpha=None):
    """img: HxWx3 uint8 (배경 합성된 RGB). 눈 후보 [(h,w,cx,cy)] 반환."""
    rgb = np.asarray(img)[..., :3].astype(int)
    m = _mask(rgb, pack)
    if alpha is not None:
        m &= alpha > 200
    filled = ndimage.binary_fill_holes(m)
    lab, n = ndimage.label(filled)
    out = []
    for i, sl in enumerate(ndimage.find_objects(lab)):
        comp = lab[sl] == i + 1
        h = sl[0].stop - sl[0].start
        w = sl[1].stop - sl[1].start
        area = comp.sum()
        ring = m[sl][comp].sum()
        if h < 5 or w < 3:
            continue
        if not (0.9 <= h / w <= 2.6):
            continue
        # 타원 채움률
        if area / (h * w) < 0.55:
            continue
        if pack == "omo" and ring / area > 0.85:  # 네온 O는 가운데가 비어야 함
            continue
        out.append(dict(h=h, w=w, cx=(sl[1].start + sl[1].stop) / 2, cy=(sl[0].start + sl[0].stop) / 2, area=int(area)))
    return out


def eye_height(img, pack, alpha=None, hmax=None):
    c = eyes(img, pack, alpha)
    if hmax:
        c = [e for e in c if e["h"] <= hmax]
    if not c:
        return None
    # 가장 큰 눈(가까운 쪽 눈)의 세로 지름
    e = max(c, key=lambda e: e["area"])
    return e
