"""Build the photo-scanned human models in public/people/ from the reference sheets in tools/people/.

Each sheet shows one person from five angles on a studio background. The front, side and back panels are
used the way a body scanner uses its cameras:

  shape    Every image row becomes one cross-section. The front view gives its width and the side view its
           depth, separately for the trunk (head, neck, torso), each arm and each leg (silhouette.py).
           The nose and chin come from the profile, the ears are taken off the head outline.
  texture  The photographs are projected back onto that surface and blended by the way the surface faces:
           front and back everywhere, the profile on the head and legs. The result is one atlas per person.
  rig      18 bones placed from the measured landmarks (crotch, shoulders, hands, soles) and body
           proportions, with skin weights blended across every joint.

Output per person, in public/people/:
  <name>.json   bones, atlas size, clothing tint references, and the layout of the .bin
  <name>.bin    three levels of detail: quantised positions, normals, uvs, skin indices/weights, indices
  <name>.jpg    colour atlas          <name>_mask.png   R = top, G = bottoms (for recolouring outfits)

Run:  python tools/build_people.py [--preview DIR]      (needs numpy, scipy, Pillow)
"""
import json, os, sys
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, 'people'))
from silhouette import segment, Facing, Profile, fill_nan, smooth  # noqa: E402

OUT = os.path.join(os.path.dirname(HERE), 'public', 'people')
SS = 2  # atlas texels per photo pixel
GUTTER = 8

PEOPLE = {
    'man': dict(
        height=1.74,
        panels=dict(front=(20, 340), side=(690, 880), back=(1225, 1536)),
        facing=1,
        seg=dict(thresh=16, foot_from=0.835, textured_feet=True),
        hand_end=dict(front=577, back=570),
        ankle=0.105, foot_len=0.305, neck=152,
        cloth=dict(kind='dark', waist=490),
    ),
    'woman': dict(
        height=1.6,
        panels=dict(front=(30, 320), side=(690, 880), back=(1255, 1530)),
        facing=-1,
        seg=dict(thresh=9, foot_from=0.9, foot_thresh=26),
        fill=dict(front=[(55, 180, 195, 345), (40, 380, 250, 512)], side=[(20, 180, 140, 345), (20, 380, 160, 520)],
                  back=[(55, 180, 200, 345), (40, 380, 250, 524)]),
        strict=dict(front=[(68, 238, 90, 400, 26), (208, 238, 232, 400, 26)], back=[(58, 238, 80, 400, 26), (190, 238, 212, 400, 26)]),
        ankle=0.07, foot_len=0.24, neck=156,
        hair_rows=(140, 186),
        cloth=dict(kind='pale', top=(183, 346), bottom=(384, 548)),
    ),
}

BONES = ['root', 'hips', 'spine', 'chest', 'neck', 'head', 'armL', 'foreL', 'handL', 'armR', 'foreR', 'handR',
         'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR']
PARENT = [-1, 0, 1, 2, 3, 4, 3, 6, 7, 3, 9, 10, 1, 12, 13, 1, 15, 16]
# rows x segments of each part, per level of detail (trunk, leg, arm)
LODS = [dict(step=3.0, seg=(48, 28, 20)), dict(step=6.5, seg=(30, 18, 14)), dict(step=14.0, seg=(16, 10, 8))]


def sstep(a, b, v):
    t = np.clip((np.asarray(v, float) - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def round_end(n, k):
    """Factor that rounds off the first k of n sections into a dome instead of a flat cut."""
    f = np.ones(n)
    i = (np.arange(k) + 0.35) / k
    f[:k] = np.sqrt(1 - (1 - i) ** 2)
    return f


def pad_colours(img, mask, d):
    """Spread the figure's colours over the background, so sampling at the outline never picks it up.

    The outline itself is not trusted either: it is blended with the background and may include a
    shadow the figure casts, so colours come from pixels that are clearly figure or well inside it.
    """
    core = (ndi.binary_erosion(mask, iterations=2) & (d > 40)) | ndi.binary_erosion(mask, iterations=6)
    idx = ndi.distance_transform_edt(~core, return_distances=False, return_indices=True)
    return img[idx[0], idx[1]]


def sample(img, py, px):
    """Bicubic lookup of an RGB image at fractional pixel positions."""
    coords = np.stack([py.ravel(), px.ravel()])
    out = np.stack([ndi.map_coordinates(img[..., c], coords, order=3, mode='nearest') for c in range(3)], -1)
    return out.reshape(py.shape + (3,))


class Part:
    """A stack of cross-sections, one per front-view row, with the data needed to texture and skin it."""

    def __init__(self, name, r0, n):
        self.name, self.r0, self.N = name, r0, n
        self.side_w = np.zeros(n)  # how much the profile photo contributes, per row
        self.exp = np.full(n, 2.0)  # superellipse exponent: 2 = ellipse, larger = boxier
        self.bump = np.zeros(n)  # profile detail on the midline (nose, lips, chin)
        self.inset = np.ones(n)
        self.af = None

    def at(self, v, t):
        return np.interp(t, np.arange(self.N), v)[:, None]

    def surface(self, t, phi):
        """World positions of the surface at rows t (fractional index) and angles phi (0 = back, pi = front)."""
        s, c = np.sin(phi)[None], np.cos(phi)[None]
        e = 2 / self.at(self.exp, t)
        sx, cz = np.sign(s) * np.abs(s) ** e, np.sign(c) * np.abs(c) ** e
        a, cx = self.at(self.a, t), self.at(self.cx, t)
        if self.af is not None:  # narrower in front than behind: a neck with hair falling behind it
            k = sstep(-0.1, 0.75, -c)
            a = a + (self.at(self.af, t) - a) * k
            cx = cx + (self.at(self.cxf, t) - cx) * k
        ins = self.at(self.inset, t)
        x = cx + a * sx * ins
        z = self.at(self.zc, t) - self.at(self.b, t) * cz * ins
        z = z + self.at(self.bump, t) * np.exp(-((x - cx) / 0.015) ** 2) * np.maximum(0, -c) ** 2
        y = np.broadcast_to(self.at(self.y, t), x.shape)
        return x, y, z

    def normals(self, t, phi):
        d = 0.02
        xa, ya, za = self.surface(t, phi - d)
        xb, yb, zb = self.surface(t, phi + d)
        # a long baseline down the rows: pixel-level wobble of the outline must not show up as ridges in the lighting
        tlo, thi = np.clip(t - 4, 0, self.N - 1), np.clip(t + 4, 0, self.N - 1)
        xc, yc, zc = self.surface(tlo, phi)
        xd, yd, zd = self.surface(thi, phi)
        u = np.stack([xb - xa, yb - ya, zb - za], -1)
        v = np.stack([xd - xc, yd - yc, zd - zc], -1)
        n = np.cross(v, u)
        # the very top and bottom rows shrink to a point; fall back to the section's own outline normal there
        flat = np.stack([-(zb - za), np.zeros_like(xa), xb - xa], -1) * -1
        n = np.where(np.linalg.norm(n, axis=-1, keepdims=True) < 1e-9, flat, n)
        n /= np.linalg.norm(n, axis=-1, keepdims=True) + 1e-12
        cxyz = np.stack([np.broadcast_to(self.at(self.cx, t), xa.shape), ya, np.broadcast_to(self.at(self.zc, t), xa.shape)], -1)
        x, y, z = self.surface(t, phi)
        out = np.sum(n * (np.stack([x, y, z], -1) - cxyz), -1, keepdims=True)
        return n * np.where(out < 0, -1, 1)


class Person:
    def __init__(self, name, cfg):
        self.name, self.cfg = name, cfg
        img = np.asarray(Image.open(os.path.join(HERE, 'people', name + '.webp')).convert('RGB')).astype(np.float32)
        self.img, self.mask = {}, {}
        for view, (x0, x1) in cfg['panels'].items():
            p = img[:, x0:x1]
            m, d = segment(p, fill=cfg.get('fill', {}).get(view, ()), strict=cfg.get('strict', {}).get(view, ()), **cfg['seg'])
            self.mask[view] = m
            self.img[view] = pad_colours(p, m, d)
        he = cfg.get('hand_end', {})
        self.F = Facing(self.mask['front'], dict(hand_end=he.get('front')))
        self.B = Facing(self.mask['back'], dict(hand_end=he.get('back')))
        self.P = Profile(self.mask['side'], cfg['facing'])
        F = self.F
        F.neck = cfg.get('neck', F.neck)  # the row under the chin, where the head turns
        self.scale = (F.bottom - F.top) / cfg['height']  # pixels per metre
        self.H = cfg['height']
        self.parts = []
        self.measure_side()
        self.build_stack()
        for s in (0, 1):
            self.build_arm(s)
            self.build_leg(s)
        self.place_bones()

    # ---------------------------------------------------------------- measurements
    def y_of(self, r):
        return (self.F.bottom - np.asarray(r, float)) / self.scale

    def row_of(self, y):
        return self.F.bottom - y * self.scale

    def side_row(self, r):
        F, P = self.F, self.P
        return P.top + (np.asarray(r, float) - F.top) * (P.bottom - P.top) / (F.bottom - F.top)

    def measure_side(self):
        """Depth extent of the profile in metres, z = 0 on the ankle."""
        P, f = self.P, self.cfg['facing']
        lo, hi = fill_nan(P.ext[:, 0]), fill_nan(P.ext[:, 1])
        ankle = int(self.side_row(self.row_of(self.cfg['ankle'] + 0.03)))
        self.z0 = (lo[ankle] + hi[ankle]) / 2
        front, back = (hi, lo) if f > 0 else (lo, hi)
        self.zf_px, self.zb_px = front, back

    def z_of(self, px):
        return self.cfg['facing'] * (px - self.z0) / self.scale

    def z_px(self, z):
        return self.z0 + self.cfg['facing'] * z * self.scale

    def side_ext(self, r):
        rs = self.side_row(r)
        idx = np.arange(len(self.zf_px))
        return self.z_of(np.interp(rs, idx, self.zb_px)), self.z_of(np.interp(rs, idx, self.zf_px))

    # ---------------------------------------------------------------- parts
    def build_stack(self):
        F, B, sc = self.F, self.B, self.scale
        rows = np.arange(F.top, F.crotch)
        p = Part('trunk', F.top, len(rows))
        xl, xr = F.trunk[rows, 0], F.trunk[rows, 1]
        p.xl, p.xr = xl, xr
        head = rows < F.neck
        a = (xr - xl) / 2 / sc
        # ears stick out of the head outline: take them off the shape (the profile photo paints them back)
        a[head] = ndi.grey_opening(a[head], size=int(0.042 * (F.bottom - F.top)))
        p.a = np.maximum(smooth(a, 1.5), 0.002)
        p.cx = smooth(((xl + xr) / 2 - F.mid) / sc, 3)
        dome = round_end(len(rows), int(0.022 * sc))
        p.a = p.a * dome
        zb, zf = self.side_ext(rows)
        # the profile is the outline of the nose, lips and chin, which only exist near the midline: the head
        # as a whole follows the profile smoothed, and the difference is added back as relief down the middle
        base = zf.copy()
        base[head] = smooth(zf, 0.034 * sc)[head]
        fade = sstep(F.top + 0.05 * sc, F.top + 0.09 * sc, rows) * sstep(F.neck + 2, F.neck - 0.02 * sc, rows)
        base = zf + (base - zf) * fade
        p.bump = smooth(zf - base, 0.8)
        zb, base = smooth(zb, 1.5), smooth(base, 1.5)
        p.zc, p.b = (zb + base) / 2, np.maximum((base - zb) / 2 * dome, 0.002)
        p.y = self.y_of(rows)
        sh = np.mean(F.shoulder)
        # boxier through the chest and hips, round at the neck and head
        p.exp = 2.1 + 0.55 * sstep(sh - 6, sh + 40, rows) + 0.5 * sstep(F.crotch - 0.14 * sc, F.crotch - 0.02 * sc, rows)
        p.side_w = sstep(sh + 2, F.neck + 4, rows)
        hr = self.cfg.get('hair_rows')
        if hr:
            # hair hangs beside and behind the neck: the front of each section is only as wide as the skin
            lum = self.img['front'].mean(2)
            af, cxf = p.a.copy(), p.cx.copy()
            m = int(round(F.mid))
            for i, r in enumerate(rows):
                if hr[0] <= r < hr[1]:
                    skin = lum[r] > 120
                    l = m
                    while l > 0 and skin[l - 1]:
                        l -= 1
                    q = m
                    while q < len(skin) - 1 and skin[q + 1]:
                        q += 1
                    k = sstep(hr[0], hr[0] + 12, r) * sstep(hr[1], hr[1] - 6, r)
                    af[i] = p.a[i] + ((q - l + 1) / 2 / sc + 0.006 - p.a[i]) * k
                    cxf[i] = p.cx[i] + (((l + q + 1) / 2 - F.mid) / sc - p.cx[i]) * k
            p.af, p.cxf = np.minimum(smooth(af, 2), p.a), smooth(cxf, 2)
        fsh, bsh = np.mean(F.shoulder), np.mean(B.shoulder)
        p.rb = np.interp(rows, [F.top, fsh, F.crotch], [B.top, bsh, B.crotch])
        p.bspan = (fill_nan(B.trunk[:, 0]), fill_nan(B.trunk[:, 1]))
        p.kind = 'trunk'
        self.trunk = p
        self.parts.append(p)

    def build_arm(self, s):
        F, B, sc = self.F, self.B, self.scale
        ys, x0, x1 = F.arm(s)
        p = Part('arm' + 'RL'[s], int(ys[0]), len(ys))
        p.xl, p.xr = x0, x1
        frac = np.linspace(0, 1, len(ys))
        p.a = np.maximum(smooth((x1 - x0) / 2 / sc, 1.5), 0.002)
        p.cx = smooth(((x0 + x1) / 2 - F.mid) / sc, 2)
        # round through the arm, flatter at the hand, which hangs edge-on to the camera
        p.a = np.maximum(p.a * round_end(len(ys), int(0.02 * sc)) * round_end(len(ys), int(0.012 * sc))[::-1], 0.002)
        p.b = p.a * (1.02 - 0.3 * sstep(0.74, 0.86, frac))
        t = self.trunk
        i = int(np.clip(ys[0] + 0.05 * sc - t.r0, 0, t.N - 1))
        z_top = t.zc[i] + self.cfg.get('arm_dz', 0.0)
        p.zc = z_top + self.cfg.get('arm_fwd', 0.025) * frac
        p.y = self.y_of(ys)
        o = 1 - s
        p.rb = np.interp(ys, [F.shoulder[s], F.hand_end[s]], [B.shoulder[o], B.hand_end[o]])
        lo, hi = np.full(B.h, np.nan), np.full(B.h, np.nan)
        bys, bx0, bx1 = B.arm(o)
        lo[bys], hi[bys] = bx0, bx1
        p.bspan = (fill_nan(lo), fill_nan(hi))
        p.kind, p.s = 'arm', s
        self.parts.append(p)

    def build_leg(self, s):
        F, B, sc = self.F, self.B, self.scale
        ext = int(0.1 * sc)
        rows = np.arange(F.crotch - ext, F.bottom)
        mid_c = F.leg_mid[F.crotch]

        def span(V, r):
            lo, hi = np.full(V.h, np.nan), np.full(V.h, np.nan)
            ys, a, b = V.leg(r)
            lo[ys], hi[ys] = a, b
            m = V.leg_mid[V.crotch]
            for y in range(V.crotch - int(0.14 * sc), V.crotch):
                e = V.trunk[y, r]
                lo[y], hi[y] = min(e, m), max(e, m)
            return fill_nan(lo), fill_nan(hi)

        lo, hi = span(F, s)
        p = Part('leg' + 'RL'[s], int(rows[0]), len(rows))
        x0, x1 = lo[rows], hi[rows]
        p.xl, p.xr = x0, x1
        p.a = np.maximum(smooth((x1 - x0) / 2 / sc, 1.5), 0.002)
        p.cx = smooth(((x0 + x1) / 2 - F.mid) / sc, 2)
        zb, zf = self.side_ext(rows)
        # the profile shows both feet, one ahead of the other: keep one foot's length from the heel
        zf = np.minimum(zf, zb + self.cfg['foot_len'])
        zb, zf = smooth(zb, 1.5), smooth(zf, 1.5)
        p.zc, p.b = (zb + zf) / 2, np.maximum((zf - zb) / 2, 0.002)
        p.y = self.y_of(rows)
        # the top of the thigh hides inside the hips
        p.inset = 0.72 + 0.28 * sstep(F.crotch - 8, F.crotch + 1, rows)
        # in the profile the hanging hand covers the top of the thigh: no profile texture until below it
        hand = max(F.hand_end)
        p.side_w = sstep(hand + 4, hand + 26, rows)
        p.rb = B.crotch + (rows - F.crotch) * (B.bottom - B.crotch) / (F.bottom - F.crotch)
        p.bspan = span(B, 1 - s)
        p.kind, p.s = 'leg', s
        self.parts.append(p)

    # ---------------------------------------------------------------- skeleton
    def place_bones(self):
        F, H, sc = self.F, self.H, self.scale
        t = self.trunk
        yc = float(self.y_of(F.crotch))
        ysh = float(self.y_of(np.mean(F.shoulder)))
        L = {}

        def trunk_at(y):
            i = int(np.clip(self.row_of(y) - t.r0, 0, t.N - 1))
            return [0.0, y, float(t.zc[i])]

        def on(part, y):
            i = int(np.clip(self.row_of(y) - part.r0, 0, part.N - 1))
            return [float(part.cx[i]), y, float(part.zc[i])]

        self.j = j = dict(crotch=yc, hip=yc + 0.045 * H, spine=yc + 0.1 * H, chest=yc + 0.19 * H, neckbase=ysh + 0.035,
                          head=float(self.y_of(F.neck)) + 0.025, knee=0.287 * H, ankle=self.cfg['ankle'])
        L['root'] = [0, 0, 0]
        L['hips'] = trunk_at(j['hip'] + 0.02)
        L['spine'] = trunk_at(j['spine'])
        L['chest'] = trunk_at(j['chest'])
        L['neck'] = trunk_at(j['neckbase'])
        L['head'] = trunk_at(j['head'])
        # keep the neck pivots off the hair and the nose: under the ear, as on a real spine
        L['neck'][2] = L['head'][2] = L['chest'][2] - 0.01
        for p in self.parts:
            side = 'L' if p.cx.mean() > 0 else 'R'
            if p.kind == 'arm':
                top = float(p.y[0])
                ysj = top - 0.045
                span = ysj - float(p.y[-1])
                yel, ywr = ysj - 0.43 * span, ysj - 0.795 * span
                L['arm' + side], L['fore' + side], L['hand' + side] = on(p, ysj), on(p, yel), on(p, ywr)
                p.j = dict(sj=ysj, el=yel, wr=ywr)
            if p.kind == 'leg':
                L['thigh' + side], L['shin' + side], L['foot' + side] = on(p, j['hip']), on(p, j['knee']), on(p, j['ankle'])
                # the ankle sits over the heel end of the foot, not the middle of the shoe
                i = int(np.clip(self.row_of(j['ankle'] + 0.04) - p.r0, 0, p.N - 1))
                L['foot' + side][2] = float(p.zc[i])
        self.bones = [L[b] for b in BONES]

    def weights(self, p, x, y):
        """Skin weights of surface points: (n, 18) array, rows sum to 1."""
        j, H = self.j, self.H
        w = np.zeros(x.shape + (len(BONES),))
        I = {b: i for i, b in enumerate(BONES)}
        if p.kind == 'trunk':
            k1 = sstep(j['spine'] - 0.04, j['spine'] + 0.04, y)
            k2 = sstep(j['chest'] - 0.05, j['chest'] + 0.05, y)
            k3 = sstep(j['neckbase'] - 0.03, j['neckbase'] + 0.025, y)
            k4 = sstep(j['head'] - 0.03, j['head'] + 0.02, y)
            w[..., I['head']] = k4
            w[..., I['neck']] = k3 * (1 - k4)
            w[..., I['chest']] = k2 * (1 - k3)
            w[..., I['spine']] = k1 * (1 - k2)
            w[..., I['hips']] = 1 - k1
            # the seat follows the thighs a little, each side its own
            k = 0.55 * sstep(j['hip'] + 0.04, j['crotch'], y)
            sl = sstep(-0.035, 0.035, x)
            w *= (1 - k)[..., None]
            w[..., I['thighL']] = k * sl
            w[..., I['thighR']] = k * (1 - sl)
        elif p.kind == 'leg':
            side = 'L' if p.cx.mean() > 0 else 'R'
            kt = np.where(y >= j['crotch'], 0.55 * sstep(j['hip'] + 0.04, j['crotch'], y), 0.55 + 0.45 * sstep(j['crotch'], j['crotch'] - 0.07 * H, y))
            ks = sstep(j['knee'] + 0.04 * H, j['knee'] - 0.04 * H, y)
            kf = sstep(j['ankle'] + 0.035, j['ankle'] - 0.02, y)
            w[..., I['foot' + side]] = kf
            w[..., I['shin' + side]] = ks * (1 - kf)
            w[..., I['thigh' + side]] = kt * (1 - ks)
            w[..., I['hips']] = (1 - kt) * (1 - ks)
        else:
            side = 'L' if p.cx.mean() > 0 else 'R'
            ka = sstep(p.j['sj'] + 0.055, p.j['sj'] - 0.05, y)
            ke = sstep(p.j['el'] + 0.03 * H, p.j['el'] - 0.03 * H, y)
            kw = sstep(p.j['wr'] + 0.022, p.j['wr'] - 0.022, y)
            w[..., I['hand' + side]] = kw
            w[..., I['fore' + side]] = ke * (1 - kw)
            w[..., I['arm' + side]] = ka * (1 - ke)
            w[..., I['chest']] = (1 - ka) * (1 - ke)
        return w / w.sum(-1, keepdims=True)

    # ---------------------------------------------------------------- texture
    def layout(self):
        widths = dict(trunk=992, leg=280, arm=184)
        x = GUTTER
        h = 0
        for p in self.parts:
            p.cw, p.ch = widths[p.kind], (p.N - 1) * SS + 1
            p.cx0, p.cy0 = x, GUTTER
            x += p.cw + 2 * GUTTER
            h = max(h, p.ch)
        self.aw, self.ah = 2048, int(np.ceil((h + 2 * GUTTER) / 64) * 64)
        assert x <= self.aw, x

    def bake(self):
        F, sc = self.F, self.scale
        self.layout()
        atlas = np.zeros((self.ah, self.aw, 3), np.float32)
        ids = np.zeros((self.ah, self.aw), np.uint8)
        ys_all = np.zeros((self.ah, self.aw), np.float32)
        for pi, p in enumerate(self.parts):
            t = np.arange(p.ch) / SS
            phi = (np.arange(p.cw) + 0.5) / p.cw * 2 * np.pi
            x, y, z = p.surface(t, phi)
            n = p.normals(t, phi)
            # which camera sees a texel depends on its direction around the body, not on how the surface leans
            n = n * [1, 0, 1]
            n /= np.linalg.norm(n, axis=-1, keepdims=True) + 1e-9
            r = p.r0 + t[:, None] + 0 * x
            # sample a little inside the outline: the last pixels before the edge are foreshortened and noisy
            cxr = p.at(p.cx, t)
            q = np.abs(np.sin(phi))[None] ** 3
            xs = cxr + (x - cxr) * (1 - 0.07 * q)
            # front: the photo the shape was measured from, at true scale
            col_f = sample(self.img['front'], r, F.mid + xs * sc)
            # back: mirrored and stretched row by row onto this part's outline in the back view
            xl, xr = p.at(p.xl, t), p.at(p.xr, t)
            u = np.clip((F.mid + xs * sc - xl) / np.maximum(xr - xl, 1e-3), 0.03, 0.97)
            rb = p.at(p.rb, t)
            idx = np.arange(self.B.h)
            bl, br = np.interp(rb, idx, p.bspan[0]), np.interp(rb, idx, p.bspan[1])
            col_b = sample(self.img['back'], rb + 0 * x, br - u * (br - bl))
            wf = sstep(-0.32, 0.32, n[..., 2])[..., None]
            col = col_b + (col_f - col_b) * wf
            # where the surface turns edge-on to both cameras each row repeats its edge colour: smooth down the rows
            graze = sstep(0.72, 0.96, np.abs(n[..., 0]))[..., None]
            col = col + (ndi.gaussian_filter(col, (4 * SS, 0, 0)) - col) * graze
            ws = p.at(p.side_w, t) * sstep(0.8, 0.97, np.abs(n[..., 0]))
            if ws.max() > 0:
                col_s = sample(self.img['side'], self.side_row(r), self.z_px(z))
                col = col + (col_s - col) * ws[..., None]
            p.grid = (x, y, z, col)
            y0, x0 = p.cy0, p.cx0
            atlas[y0:y0 + p.ch, x0:x0 + p.cw] = col
            ids[y0:y0 + p.ch, x0:x0 + p.cw] = pi + 1
            ys_all[y0:y0 + p.ch, x0:x0 + p.cw] = y
            # gutters: wrap around the seam, repeat the first and last rows
            g = GUTTER
            atlas[y0:y0 + p.ch, x0 - g:x0] = col[:, -g:]
            atlas[y0:y0 + p.ch, x0 + p.cw:x0 + p.cw + g] = col[:, :g]
            atlas[y0 - g:y0, x0 - g:x0 + p.cw + g] = atlas[y0, x0 - g:x0 + p.cw + g]
            atlas[y0 + p.ch:y0 + p.ch + g, x0 - g:x0 + p.cw + g] = atlas[y0 + p.ch - 1, x0 - g:x0 + p.cw + g]
        # light unsharp mask: the photos were enlarged
        blur = ndi.gaussian_filter(atlas, (1.2, 1.2, 0))
        atlas = np.clip(atlas + 0.45 * (atlas - blur), 0, 255)
        self.atlas = atlas
        self.masks(ids, ys_all)

    def masks(self, ids, ys):
        """Which texels are the top and which the bottoms, so outfits can be recoloured."""
        a = self.atlas
        lum = a.mean(2)
        sat = a.max(2) - a.min(2)
        c = self.cfg['cloth']
        kind = np.zeros(ids.shape, np.uint8)
        for pi, p in enumerate(self.parts):
            kind[ids == pi + 1] = dict(trunk=1, arm=2, leg=3)[p.kind]
        if c['kind'] == 'dark':
            cloth = (a[..., 2] - a[..., 0] > 2) & (lum < 105) & (ids > 0)
            # hair is dark too: only below the collar
            cloth &= ys < self.y_of(np.mean(self.F.shoulder)) + 0.05
            waist = self.y_of(c['waist'])
            top = cloth & (ys > waist) & (kind != 3)
            bottom = cloth & ((ys <= waist) | (kind == 3)) & (kind != 2)
        else:
            y0, y1 = self.y_of(c['top'][1]), self.y_of(c['top'][0])
            top = (kind == 1) & (ys > y0) & (ys < y1) & (sat < 30) & (lum > 150)
            y0, y1 = self.y_of(c['bottom'][1]), self.y_of(c['bottom'][0])
            bottom = (kind != 2) & (ys > y0) & (ys < y1) & (sat < 26) & (lum > 110)
        soft = lambda m: ndi.gaussian_filter(ndi.binary_opening(m, iterations=1).astype(np.float32), 1.0)
        self.mask_rgb = np.stack([soft(top), soft(bottom), np.zeros_like(lum)], -1)
        self.ref = [float(np.median(lum[top])) / 255 if top.any() else 0.5, float(np.median(lum[bottom])) / 255 if bottom.any() else 0.5]

    # ---------------------------------------------------------------- mesh
    def mesh(self, lod):
        pos, nor, uv, wts, idx = [], [], [], [], []
        base = 0
        for p in self.parts:
            seg = lod['seg'][dict(trunk=0, leg=1, arm=2)[p.kind]]
            nr = max(6, int(round((p.N - 1) / lod['step'])) + 1)
            t = np.linspace(0, p.N - 1, nr)
            phi = np.linspace(0, 2 * np.pi, seg + 1)
            x, y, z = p.surface(t, phi)
            n = p.normals(t, phi)
            n[:, -1] = n[:, 0]
            w = self.weights(p, x, y)
            u = (p.cx0 + phi / (2 * np.pi) * p.cw)[None] + 0 * x
            v = (p.cy0 + t * SS + 0.5)[:, None] + 0 * x
            P = np.stack([x, y, z], -1).reshape(-1, 3)
            cols = seg + 1
            g = np.arange(nr * cols).reshape(nr, cols)
            a, b, c, d = g[:-1, :-1], g[:-1, 1:], g[1:, :-1], g[1:, 1:]
            tri = np.concatenate([np.stack([a, c, b], -1).reshape(-1, 3), np.stack([b, c, d], -1).reshape(-1, 3)])
            # end caps: a fan around the centre of the first and last sections
            extra_p, extra_n, extra_uv, extra_w, fans = [], [], [], [], []
            for row, up in ((0, 1), (nr - 1, -1)):
                ci = nr * cols + len(extra_p)
                centre = np.array([p.cx[0 if row == 0 else -1], y[row, 0], p.zc[0 if row == 0 else -1]])
                extra_p.append(centre)
                extra_n.append([0, up, 0])
                extra_uv.append([u[row].mean(), v[row, 0]])
                extra_w.append(self.weights(p, centre[None, 0], centre[None, 1])[0])
                ring = g[row]
                f = np.stack([np.full(seg, ci), ring[:-1], ring[1:]], -1)
                fans.append(f if up > 0 else f[:, ::-1])
            tri = np.concatenate([tri] + fans)
            P = np.concatenate([P, np.array(extra_p)])
            N = np.concatenate([n.reshape(-1, 3), np.array(extra_n, float)])
            UV = np.concatenate([np.stack([u, v], -1).reshape(-1, 2), np.array(extra_uv)])
            W = np.concatenate([w.reshape(-1, len(BONES)), np.array(extra_w)])
            # make every triangle face outwards
            fn = np.cross(P[tri[:, 1]] - P[tri[:, 0]], P[tri[:, 2]] - P[tri[:, 0]])
            flip = np.sum(fn * (N[tri[:, 0]] + N[tri[:, 1]] + N[tri[:, 2]]), -1) < 0
            tri[flip] = tri[flip][:, ::-1]
            pos.append(P); nor.append(N); uv.append(UV); wts.append(W); idx.append(tri + base)
            base += len(P)
        pos, nor, uv, wts, idx = map(np.concatenate, (pos, nor, uv, wts, idx))
        # four strongest bones per vertex, as bytes that sum to 255
        order = np.argsort(-wts, 1)[:, :4]
        top = np.take_along_axis(wts, order, 1)
        top = top / top.sum(1, keepdims=True)
        wb = np.floor(top * 255 + 0.5).astype(np.int32)
        wb[:, 0] += 255 - wb.sum(1)
        uv = uv / [self.aw, self.ah]
        uv[:, 1] = 1 - uv[:, 1]
        return dict(pos=pos, nor=nor, uv=uv, si=order.astype(np.uint8), sw=wb.astype(np.uint8), idx=idx)

    def write(self):
        os.makedirs(OUT, exist_ok=True)
        blob = bytearray()
        POS = 8192.0

        def put(arr):
            while len(blob) % 4:
                blob.append(0)
            off = len(blob)
            blob.extend(arr.tobytes())
            return off

        lods = []
        for lod in LODS:
            m = self.mesh(lod)
            n = len(m['pos'])
            lods.append(dict(
                verts=n, tris=len(m['idx']),
                pos=put(np.round(m['pos'] * POS).astype('<i2')),
                nor=put(np.round(m['nor'] * 127).astype('i1')),
                uv=put(np.round(np.clip(m['uv'], 0, 1) * 65535).astype('<u2')),
                si=put(m['si']), sw=put(m['sw']),
                idx=put(m['idx'].astype('<u4' if n > 65535 else '<u2')), wide=n > 65535,
            ))
        t = self.trunk
        i = int(np.clip(self.row_of(self.H - 0.05) - t.r0, 0, t.N - 1))
        crown = [round(float(v), 4) for v in (t.zc[i], t.y[i], t.a[i], t.b[i])]  # where a cap sits: z, y, half width, half depth
        # what a uniform painted over the atlas needs: where each part's chart lies, and the chest's cross-section
        ysh = float(self.y_of(np.mean(self.F.shoulder)))
        c = self.cfg['cloth']
        waist = float(self.y_of(c['waist'] if 'waist' in c else c['bottom'][0]))
        i = int(np.clip(self.row_of(ysh - 0.13) - t.r0, 0, t.N - 1))
        charts = {p.name: [p.cx0, p.cy0, p.cw, p.ch, round(float(p.y[0]), 4)] for p in self.parts}
        paint = dict(charts=charts, pxPerM=round(SS * self.scale, 2), shoulder=round(ysh, 4), waist=round(waist, 4),
                     chest=[round(float(t.a[i]), 4), round(float(t.exp[i]), 3)])
        meta = dict(height=self.H, posScale=POS, crown=crown, paint=paint, atlas=[self.aw, self.ah], ref=self.ref,
                    bones=[dict(name=b, parent=PARENT[i], pos=[round(float(v), 4) for v in self.bones[i]]) for i, b in enumerate(BONES)],
                    lods=lods)
        with open(os.path.join(OUT, self.name + '.bin'), 'wb') as f:
            f.write(blob)
        with open(os.path.join(OUT, self.name + '.json'), 'w') as f:
            json.dump(meta, f, separators=(',', ':'))
        Image.fromarray(self.atlas.astype(np.uint8)).save(os.path.join(OUT, self.name + '.jpg'), quality=90, subsampling=0)
        Image.fromarray((self.mask_rgb * 255).astype(np.uint8)).save(os.path.join(OUT, self.name + '_mask.png'), optimize=True)
        print(self.name, 'verts', [l['verts'] for l in lods], 'tris', [l['tris'] for l in lods], 'bin', len(blob), 'atlas', self.aw, self.ah, 'ref', self.ref)

    # ---------------------------------------------------------------- preview
    def preview(self, path, yaws=(0, 40, 90, 140, 180, 270)):
        """Point-splat the textured surface from a few angles, to check shape and seams without the game."""
        hpx = 900
        sc = hpx / (self.H * 1.04)
        w = int(0.95 * sc)
        out = []
        for yaw in yaws:
            a = np.radians(yaw)
            img = np.full((hpx, w, 3), 90, np.uint8)
            xs, ys, ds, cs = [], [], [], []
            for p in self.parts:
                x, y, z, col = p.grid
                xs.append((x * np.cos(a) + z * np.sin(a)).ravel())
                ds.append((-x * np.sin(a) + z * np.cos(a)).ravel())
                ys.append(y.ravel())
                cs.append(col.reshape(-1, 3))
            xs, ys, ds, cs = map(np.concatenate, (xs, ys, ds, cs))
            px = np.clip((w / 2 + xs * sc).astype(int), 0, w - 1)
            py = np.clip((hpx - 10 - ys * sc).astype(int), 0, hpx - 1)
            o = np.argsort(ds)
            img[py[o], px[o]] = np.clip(cs[o], 0, 255).astype(np.uint8)
            out.append(img)
        Image.fromarray(np.concatenate(out, 1)).save(path)


def main():
    prev = sys.argv[sys.argv.index('--preview') + 1] if '--preview' in sys.argv else None
    for name, cfg in PEOPLE.items():
        person = Person(name, cfg)
        person.bake()
        person.write()
        if prev:
            person.preview(os.path.join(prev, name + '_preview.png'))
            Image.fromarray(person.atlas.astype(np.uint8)).save(os.path.join(prev, name + '_atlas.png'))


if __name__ == '__main__':
    main()
