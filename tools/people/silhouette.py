"""Reads a five-view reference sheet and measures the figure row by row.

The front, side and back panels are segmented from the studio background, then every image row is
split into the spans that belong to the trunk (head, neck, torso), each arm and each leg. Those spans
are the raw material of the body model: the front view gives widths, the side view depths.
"""
import numpy as np
from scipy import ndimage as ndi


def segment(panel, thresh, foot_from=0.9, foot_thresh=None, textured_feet=False, fill=(), strict=(), min_hole=40):
    """Foreground mask of one panel: pixels that differ from the row's background colour.

    Below `foot_from` (a fraction of the panel height) the floor carries soft shadows, so the feet get
    their own threshold, or - for pale shoes on a pale floor - are found by their texture instead.
    """
    h = panel.shape[0]
    edge = np.concatenate([panel[:, :6], panel[:, -6:]], 1)
    bg = ndi.gaussian_filter1d(np.median(edge, 1), 8, axis=0)
    d = np.abs(panel - bg[:, None, :]).max(2)
    fg = d > thresh
    # `strict` boxes (x0, y0, x1, y1, thresh) raise the threshold where a narrow gap lies in shadow
    for x0, y0, x1, y1, t in strict:
        fg[y0:y1, x0:x1] = d[y0:y1, x0:x1] > t
    # pale clothing drops out against a pale background: `fill` lists boxes (x0, y0, x1, y1) where every
    # enclosed hole belongs to the figure; elsewhere only pin holes are closed, so real gaps survive
    holes = ndi.binary_fill_holes(fg) & ~fg
    lab, n = ndi.label(holes)
    if n:
        idx = range(1, n + 1)
        size = ndi.sum(holes, lab, idx)
        cy, cx = np.array(ndi.center_of_mass(holes, lab, idx)).T
        boxed = np.zeros(n, bool)
        for x0, y0, x1, y1 in fill:
            boxed |= (cx >= x0) & (cx < x1) & (cy >= y0) & (cy < y1)
        fg |= np.isin(lab, 1 + np.nonzero((size < min_hole) | boxed)[0])
    y0 = int(h * foot_from)
    if textured_feet:
        lum = panel.mean(2)
        grad = np.hypot(ndi.sobel(lum, 0), ndi.sobel(lum, 1))
        tex = ndi.binary_closing(np.pad(grad > 45, 12), iterations=8)[12:-12, 12:-12]
        tex = ndi.binary_opening(ndi.binary_fill_holes(tex), iterations=2)
        # white socks vanish against the floor: bridge the leg to the shoe below it
        low = np.pad(tex | (d > 60), ((40, 40), (0, 0)))
        fg[y0:] = ndi.binary_closing(low, structure=np.ones((35, 1), bool))[40:-40][y0:]
    elif foot_thresh:
        fg[y0:] = (d > foot_thresh)[y0:]
    lab, n = ndi.label(fg)
    size = ndi.sum(fg, lab, range(1, n + 1))
    return lab == 1 + int(np.argmax(size)), d


def spans(row, min_len=3):
    """[x0, x1) runs of True in a boolean row."""
    d = np.diff(np.concatenate([[0], row.astype(np.int8), [0]]))
    a, b = np.nonzero(d == 1)[0], np.nonzero(d == -1)[0]
    return [(int(s), int(e)) for s, e in zip(a, b) if e - s >= min_len]


def fill_nan(v):
    """Linear interpolation across NaN gaps; the ends hold their nearest value."""
    v = np.array(v, float)
    ok = ~np.isnan(v)
    if ok.sum() == 0:
        return v
    idx = np.arange(len(v))
    return np.interp(idx, idx[ok], v[ok])


def smooth(v, sigma):
    return ndi.gaussian_filter1d(np.asarray(v, float), sigma, mode='nearest') if sigma > 0 else np.asarray(v, float)


class Facing:
    """Row-by-row spans of a front or back view. Side 0 is image-left, side 1 image-right."""

    def __init__(self, mask, cfg):
        h, w = mask.shape
        rows = np.nonzero(mask.sum(1) > 2)[0]
        self.top, self.bottom = int(rows[0]), int(rows[-1]) + 1
        self.h, self.w = h, w
        T, B = self.top, self.bottom
        H = B - T
        # the head fixes the midline
        head = [spans(mask[y]) for y in range(T + 5, T + int(H * 0.1))]
        self.mid = float(np.median([(s[0][0] + s[-1][1]) / 2 for s in head if s]))
        m = int(round(self.mid))

        outer = np.full((h, 2), np.nan)
        for y in range(T, B):
            xs = np.nonzero(mask[y])[0]
            if len(xs):
                outer[y] = xs[0], xs[-1] + 1
        self.outer = outer

        # the crotch: first row where background opens up around the midline and stays open
        def gap_at(y):
            best = None
            sp = spans(mask[y])
            for (a0, a1), (b0, b1) in zip(sp, sp[1:]):
                c = (a1 + b0) / 2
                if abs(c - m) < H * 0.05 and (best is None or abs(c - m) < abs(best[2] - m)):
                    best = (a1, b0, c)
            return best

        y = T + int(H * 0.42)
        while y < B and not all(gap_at(k) for k in range(y, min(B, y + 8))):
            y += 1
        self.crotch = y

        # arms: the outermost span on each side once a gap separates it from the trunk
        self.armpit, self.hand_end, self.shoulder = [0, 0], [0, 0], [0, 0]
        arm_in = np.full((h, 2), np.nan)
        neck = T + int(np.argmin([outer[k, 1] - outer[k, 0] for k in range(T + int(H * 0.1), T + int(H * 0.2))])) + int(H * 0.1)
        self.neck = neck
        for s in (0, 1):
            sign = 1 if s == 0 else -1  # direction from the outer edge towards the midline

            def inner_gap(y):
                sp = spans(mask[y])
                if len(sp) < 2:
                    return None
                a, b = (sp[0], sp[1]) if s == 0 else (sp[-1], sp[-2])
                edge = a[1] if s == 0 else a[0]
                # the arm span must stay clear of the midline
                if (m - edge) * sign < H * 0.04 or abs(a[1] - a[0]) > H * 0.085:
                    return None
                return edge

            y = neck
            while y < B and not all(inner_gap(k) is not None for k in range(y, y + 6)):
                y += 1
            self.armpit[s] = y
            # the hand ends where the outline jumps in to the thigh
            k = y + int(H * 0.12)
            while k < B - 7 and (outer[k + 6, s] - outer[k, s]) * sign < H * 0.012:
                k += 1
            self.hand_end[s] = cfg.get('hand_end') or k + 4
            self.hand_end[s] = min(self.hand_end[s], B - 1)
            for k in range(self.armpit[s], self.hand_end[s]):
                g = inner_gap(k)
                if g is not None:
                    arm_in[k, s] = g
            valid = np.nonzero(~np.isnan(arm_in[:, s]))[0]
            last = valid[-1]
            # where the hand rests on the thigh the arm keeps the width it had above
            width = np.median(np.abs(arm_in[last - 6:last + 1, s] - outer[last - 6:last + 1, s]))
            for k in range(last + 1, self.hand_end[s]):
                arm_in[k, s] = outer[k, s] + sign * min(width, abs(outer[k, s] - m) * 0.5)
            arm_in[self.armpit[s]:self.hand_end[s], s] = fill_nan(arm_in[self.armpit[s]:self.hand_end[s], s])
            # above the armpit the arm is cut from the trunk by a line rising from the armpit
            lean = cfg.get('shoulder_lean', 0.0)
            x_ap = arm_in[self.armpit[s], s]
            k = self.armpit[s] - 1
            while k > neck:
                cut = x_ap - sign * lean * (self.armpit[s] - k)
                if (cut - outer[k, s]) * sign < 2.5:
                    break
                arm_in[k, s] = cut
                k -= 1
            self.shoulder[s] = k + 1
        self.arm_in = arm_in

        # trunk edges: the outline, cut back to the arm line wherever an arm exists
        trunk = outer.copy()
        for s in (0, 1):
            sign = 1 if s == 0 else -1
            for y in range(self.shoulder[s], self.hand_end[s]):
                sp = spans(mask[y])
                if y >= self.armpit[s] and len(sp) >= 2:
                    # a true gap: the arm is the outermost span and the trunk starts at the next one
                    arm_edge = sp[0][1] if s == 0 else sp[-1][0]
                    if abs(arm_edge - arm_in[y, s]) <= 2:
                        trunk[y, s] = sp[1][0] if s == 0 else sp[-2][1]
                        continue
                trunk[y, s] = arm_in[y, s]
        self.trunk = trunk

        # legs: split at the gap, or at its interpolated position where the legs touch
        gl = np.full(h, np.nan)
        gr = np.full(h, np.nan)
        for y in range(self.crotch, B):
            g = gap_at(y)
            if g:
                gl[y], gr[y] = g[0], g[1]
        c = fill_nan(np.where(np.isnan(gl), np.nan, (gl + gr) / 2)[self.crotch:B])
        for y in range(self.crotch, B):
            if np.isnan(gl[y]):
                gl[y] = gr[y] = c[y - self.crotch]
        self.leg_in = np.stack([gl, gr], 1)
        self.leg_mid = np.concatenate([np.full(self.crotch, np.nan), c, np.full(h - B, np.nan)])

    def arm(self, s):
        """(rows, x0, x1) of an arm, x0 < x1."""
        ys = np.arange(self.shoulder[s], self.hand_end[s])
        a, b = self.outer[ys, s], self.arm_in[ys, s]
        return ys, np.minimum(a, b), np.maximum(a, b)

    def leg(self, s):
        ys = np.arange(self.crotch, self.bottom)
        a, b = self.trunk[ys, s], self.leg_in[ys, s]
        return ys, np.minimum(a, b), np.maximum(a, b)

    def stack(self):
        ys = np.arange(self.top, self.crotch)
        return ys, self.trunk[ys, 0], self.trunk[ys, 1]


class Profile:
    """Row-by-row depth extent of the side view. `front` is +1 when the figure faces image-right."""

    def __init__(self, mask, front):
        h, w = mask.shape
        rows = np.nonzero(mask.sum(1) > 2)[0]
        self.top, self.bottom = int(rows[0]), int(rows[-1]) + 1
        self.front = front
        ext = np.full((h, 2), np.nan)
        for y in range(self.top, self.bottom):
            xs = np.nonzero(mask[y])[0]
            if len(xs):
                ext[y] = xs[0], xs[-1] + 1
        self.ext = ext
