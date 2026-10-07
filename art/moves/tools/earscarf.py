# 오모(omo-cat) 머리 높이 = 귀 끝 ~ 목도리 윗선. 세로 길이라 고개 돌림에 둔감하다.
import numpy as np
from scipy import ndimage


def ear_to_scarf(rgba):
    a = np.asarray(rgba).astype(int)
    r, g, b, al = a[..., 0], a[..., 1], a[..., 2], a[..., 3]
    scarf = (al > 200) & (g > r + 25) & (g > b + 5) & (g > 110)
    lab, n = ndimage.label(scarf)
    if n == 0:
        return None
    sizes = ndimage.sum(scarf, lab, range(1, n + 1))
    k = int(np.argmax(sizes)) + 1
    ys, xs = np.nonzero(lab == k)
    if sizes[k - 1] < 60:
        return None
    x0, x1 = np.percentile(xs, 5), np.percentile(xs, 95)
    cx = (x0 + x1) / 2
    half = max(30, (x1 - x0) * 0.7)
    cols = slice(int(max(0, cx - half)), int(min(a.shape[1], cx + half)))
    mx = a[..., :3].max(-1)
    mn = a[..., :3].min(-1)
    fur = (al > 200) & (mx < 140) & (mx > 25) & (mx - mn < 30)
    fur = ndimage.binary_opening(fur, iterations=1)
    lab2, _ = ndimage.label(fur)
    sub = fur[:, cols]
    # 목도리 바로 위 털에 닿는 털 덩어리(머리)만 남겨 낙하산·로켓 조각을 뺀다
    top_scarf = int(np.percentile(ys, 3))
    probe = lab2[max(0, top_scarf - 4):top_scarf, cols]
    ids = [i for i in np.unique(probe) if i]
    if not ids:
        return None
    head = np.isin(lab2[:, cols], ids) & sub
    rows = np.nonzero(head.any(1))[0]
    rows = rows[rows < top_scarf]
    if len(rows) == 0:
        return None
    return dict(h=float(top_scarf - rows.min()), top=int(rows.min()), scarf=top_scarf, cx=float(cx))
