import * as THREE from 'three';

/**
 * Vietjet Air Airbus A321: a smooth lofted airframe (not the box kit the cars use) with a painted livery.
 * Modelled in real metres, nose towards +Z, wheels on y = 0, main gear at z = 0; the owner scales the group.
 */

const AX = 3.45; // height of the fuselage axis
const R = 2.0; // fuselage radius
const NOSE = 22.2, TAIL = -22.3, LEN = NOSE - TAIL;
const NOSE_LEN = 5.7, TAIL_FROM = -8.5;
const RED = 0xe0211b, WING = 0xcdd2d6, STAB = 0xd3d7da;
const ENGINE_X = 5.75, ENGINE_Y = AX - 2.05, ENGINE_Z = 7.45;
// fin texture window (side view)
const FIN_Z0 = -20.5, FIN_Z1 = -11.5, FIN_Y0 = AX + 1.0, FIN_Y1 = AX + 8.2;

type V3 = [number, number, number];
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const range = (a: number, b: number, n: number) => Array.from({ length: n + 1 }, (_, i) => a + ((b - a) * i) / n);

// ------------------------------------------------------------------ surface builder
interface GridOpt {
  flip?: boolean;
  color?: number | ((a: number, b: number) => number);
  uv?: (a: number, b: number, p: V3) => [number, number];
}
const tint = new THREE.Color();

/** Collects parametric surfaces and stock geometries into one vertex-coloured, UV-mapped geometry. */
class Surf {
  private pos: number[] = [];
  private nor: number[] = [];
  private col: number[] = [];
  private uv: number[] = [];
  private idx: number[] = [];

  /** Surface P(a, b) sampled on a grid. Normals come from finite differences of P, so adjoining grids meet without a crease. */
  grid(as: number[], bs: number[], P: (a: number, b: number) => V3, opt: GridOpt = {}) {
    const base = this.pos.length / 3, nb = bs.length, sign = opt.flip ? -1 : 1;
    const a0 = as[0], a1 = as[as.length - 1], b0 = bs[0], b1 = bs[nb - 1];
    const ea = (a1 - a0) * 1e-3, eb = (b1 - b0) * 1e-3;
    const normal = (a: number, b: number): V3 | null => {
      const pa = P(a + ea, b), qa = P(a - ea, b), pb = P(a, b + eb), qb = P(a, b - eb);
      const ux = pa[0] - qa[0], uy = pa[1] - qa[1], uz = pa[2] - qa[2];
      const vx = pb[0] - qb[0], vy = pb[1] - qb[1], vz = pb[2] - qb[2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz);
      return l > 1e-9 ? [(nx / l) * sign, (ny / l) * sign, (nz / l) * sign] : null;
    };
    for (const a of as)
      for (const b of bs) {
        const p = P(a, b);
        // poles and trailing edges are degenerate: take the normal from just inside the patch
        const ain = a + ((a0 + a1) / 2 - a) * 0.02, bin = b + ((b0 + b1) / 2 - b) * 0.02;
        const n = normal(a, b) ?? normal(a, bin) ?? normal(ain, b) ?? normal(ain, bin) ?? [0, 1, 0];
        this.pos.push(p[0], p[1], p[2]);
        this.nor.push(n[0], n[1], n[2]);
        tint.setHex(typeof opt.color === 'function' ? opt.color(a, b) : (opt.color ?? 0xffffff));
        this.col.push(tint.r, tint.g, tint.b);
        const t = opt.uv ? opt.uv(a, b, p) : [0, 0];
        this.uv.push(t[0], t[1]);
      }
    for (let i = 0; i < as.length - 1; i++)
      for (let j = 0; j < nb - 1; j++) {
        const p00 = base + i * nb + j, p10 = p00 + nb, p01 = p00 + 1, p11 = p10 + 1;
        if (opt.flip) this.idx.push(p00, p11, p10, p00, p01, p11);
        else this.idx.push(p00, p10, p11, p00, p11, p01);
      }
    return this;
  }

  /** A stock three.js geometry, optionally transformed. The geometry is consumed. */
  add(g: THREE.BufferGeometry, color: number, m?: THREE.Matrix4) {
    if (m) g.applyMatrix4(m);
    const base = this.pos.length / 3, gp = g.attributes.position, gn = g.attributes.normal, gu = g.attributes.uv;
    tint.setHex(color);
    for (let i = 0; i < gp.count; i++) {
      this.pos.push(gp.getX(i), gp.getY(i), gp.getZ(i));
      this.nor.push(gn.getX(i), gn.getY(i), gn.getZ(i));
      this.col.push(tint.r, tint.g, tint.b);
      this.uv.push(gu ? gu.getX(i) : 0, gu ? gu.getY(i) : 0);
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) this.idx.push(base + g.index.getX(i));
    else for (let i = 0; i < gp.count; i++) this.idx.push(base + i);
    g.dispose();
    return this;
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

const at = (x: number, y: number, z: number) => new THREE.Matrix4().makeTranslation(x, y, z);
const xf = (pos: V3, rot: V3 = [0, 0, 0], scale: V3 = [1, 1, 1]) =>
  new THREE.Matrix4().compose(new THREE.Vector3(...pos), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)), new THREE.Vector3(...scale));

// ------------------------------------------------------------------ airframe shape
/** Fuselage radius and the height of its centre above the axis at station z. */
function section(z: number): [number, number] {
  if (z > NOSE - NOSE_LEN) {
    const t = Math.max(0, (NOSE - z) / NOSE_LEN);
    return [R * Math.pow(1 - Math.pow(1 - t, 2.2), 0.62), -0.55 * (1 - t) ** 2];
  }
  if (z < TAIL_FROM) {
    const k = Math.pow(Math.min(1, (TAIL_FROM - z) / (TAIL_FROM - TAIL)), 1.5);
    return [R * (1 - 0.9 * k), R * 0.68 * k];
  }
  return [R, 0];
}

interface Rib {
  le: V3; // leading edge
  chord: number;
  t: number; // thickness ratio
  cant: number; // 0 = flat wing, PI/2 = vertical surface
  color: number;
}

/** Aerofoil skin through the ribs. Parameter c runs -1 (lower trailing edge) .. 0 (leading edge) .. 1 (upper trailing edge). */
function loft(s: Surf, ribs: Rib[], opt: { mirror?: boolean; camber?: number; sub?: number; uv?: (p: V3, upper: boolean) => [number, number] } = {}) {
  const n = ribs.length - 1, m = opt.camber ?? 0, sx = opt.mirror ? -1 : 1;
  const ca = new THREE.Color(), cb = new THREE.Color();
  const P = (a: number, c: number): V3 => {
    const q = clamp(a, 0, n), i = Math.min(n - 1, Math.floor(q)), f = q - i, A = ribs[i], B = ribs[i + 1];
    const chord = lerp(A.chord, B.chord, f), cant = lerp(A.cant, B.cant, f), x = (1 - Math.cos(Math.PI * c)) / 2;
    const yt = 5 * lerp(A.t, B.t, f) * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
    const h = (4 * m * x * (1 - x) + (c < 0 ? -yt : yt)) * chord;
    return [sx * (lerp(A.le[0], B.le[0], f) - Math.sin(cant) * h), lerp(A.le[1], B.le[1], f) + Math.cos(cant) * h, lerp(A.le[2], B.le[2], f) - x * chord];
  };
  const color = (a: number) => {
    const i = Math.min(n - 1, Math.floor(a)), f = a - i;
    return ca.setHex(ribs[i].color).lerp(cb.setHex(ribs[i + 1].color), f).getHex();
  };
  const as = range(0, n, n * (opt.sub ?? 3));
  const uv = opt.uv;
  if (!uv) return s.grid(as, range(-1, 1, 44), P, { flip: opt.mirror, color });
  // textured surfaces are split at the leading edge so each side can use its own half of the texture
  s.grid(as, range(-1, 0, 22), P, { flip: opt.mirror, color, uv: (_a, _c, p) => uv(p, false) });
  return s.grid(as, range(0, 1, 22), P, { flip: opt.mirror, color, uv: (_a, _c, p) => uv(p, true) });
}

const WING_Y = AX - 1.3;
function wingRibs(): Rib[] {
  const ribs: Rib[] = [
    { le: [1.2, WING_Y, 5.6], chord: 7.4, t: 0.13, cant: 0, color: WING },
    { le: [6.4, WING_Y + 0.46, 2.85], chord: 3.95, t: 0.12, cant: 0, color: WING },
    { le: [16.6, WING_Y + 1.37, -2.35], chord: 1.6, t: 0.1, cant: 0, color: WING },
  ];
  // sharklet: the tip curls up through a tight arc, then runs straight
  let [x, y, z] = ribs[2].le;
  const steps = 10, dl = 2.9 / steps;
  for (let k = 1; k <= steps; k++) {
    const u = k / steps, cant = 1.43 * Math.min(1, u / 0.4);
    x += Math.cos(cant) * dl;
    y += Math.sin(cant) * dl;
    z -= dl * 0.62;
    ribs.push({ le: [x, y, z], chord: lerp(1.6, 0.5, u), t: 0.09, cant, color: k === 1 ? WING : RED });
  }
  return ribs;
}
/** Leading edge, chord and height of the wing at span station x. */
function wingAt(x: number) {
  const r = wingRibs(), i = x < r[1].le[0] ? 0 : 1, f = (x - r[i].le[0]) / (r[i + 1].le[0] - r[i].le[0]);
  return { z: lerp(r[i].le[2], r[i + 1].le[2], f), chord: lerp(r[i].chord, r[i + 1].chord, f), y: lerp(r[i].le[1], r[i + 1].le[1], f) };
}

// ------------------------------------------------------------------ livery
const BANDS: [number, string][] = [[1.0, '#ffd100'], [0.4, '#ffae00'], [0.4, '#ff7d1a'], [0.35, '#f2491c']];
const BAND_SUM = BANDS.reduce((s, b) => s + b[0], 0);
// boundaries of the red field as z(h), h = height on the fuselage side from -1 (keel) to 1 (crown)
const frontEdge = (h: number) => 6.0 + 4.0 * Math.pow((1 - h) / 2, 2.2);
const bandScale = (h: number) => 0.6 + 0.7 * ((1 - h) / 2);
const rearEdge = (h: number) => -17.8 + 11.5 * Math.pow((1 - h) / 2, 2.5);
const DOORS = [17.7, 7.9, -2.2, -17.0];
const TEXT = 'vietjetAir.com';
const SANS = 'Arial, "Helvetica Neue", Helvetica, sans-serif';

function star(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string) {
  ctx.beginPath();
  for (let k = 0; k < 10; k++) {
    const a = -Math.PI / 2 + (k * Math.PI) / 5, q = k % 2 ? r * 0.382 : r;
    ctx.lineTo(cx + Math.cos(a) * q, cy + Math.sin(a) * q);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

/**
 * One side of the fuselage, unrolled: x runs along the length, y around the half circumference (crown at the top).
 * `mirror` paints the starboard side, where the nose is on the right. `glow` paints only what lights up at night.
 */
function paintFuselage(ctx: CanvasRenderingContext2D, W: number, H: number, pad: number, mirror: boolean, glow: boolean) {
  const px = W / LEN; // pixels per metre along the length
  const X = (z: number) => (mirror ? z - TAIL : NOSE - z) * px;
  const Yt = (deg: number) => pad + (1 - deg / 180) * (H - 2 * pad);
  const Yh = (h: number) => Yt((Math.acos(clamp(-h, -1, 1)) * 180) / Math.PI);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, W, H);
  ctx.clip();
  ctx.fillStyle = glow ? '#000' : '#eceeef';
  ctx.fillRect(0, 0, W, H);

  if (!glow) {
    const hs = range(-1, 1, 48);
    const band = (za: (h: number) => number, zb: (h: number) => number, color: string) => {
      ctx.beginPath();
      ctx.moveTo(X(za(-1)), H);
      for (const h of hs) ctx.lineTo(X(za(h)), Yh(h));
      ctx.lineTo(X(za(1)), 0);
      ctx.lineTo(X(zb(1)), 0);
      for (let i = hs.length - 1; i >= 0; i--) ctx.lineTo(X(zb(hs[i])), Yh(hs[i]));
      ctx.lineTo(X(zb(-1)), H);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
    };
    // sweep behind the forward cabin: yellow fading through orange into the red field
    let off = 0;
    for (const [w, color] of BANDS) {
      const o = off;
      band((h) => frontEdge(h) - BAND_SUM * bandScale(h) - 0.05, (h) => frontEdge(h) - o * bandScale(h), color);
      off += w;
    }
    band((h) => rearEdge(h) - 2.4, (h) => rearEdge(h) + 0.05, '#ffd100'); // tail sweep that runs on into the fin
    band(rearEdge, (h) => frontEdge(h) - BAND_SUM * bandScale(h), '#e0211b');

    // skin joints
    ctx.strokeStyle = 'rgba(0,0,0,0.07)';
    ctx.lineWidth = Math.max(1, px * 0.012);
    for (let z = 20.4; z > -20; z -= 1.62) {
      ctx.beginPath();
      ctx.moveTo(X(z), 0);
      ctx.lineTo(X(z), H);
      ctx.stroke();
    }

    const label = (str: string, zc: number, h0: number, h1: number, width: number, color: string, weight = 'italic 900') => {
      const y0 = Yh(h1), y1 = Yh(h0);
      ctx.font = `${weight} ${(y1 - y0) / 0.72}px ${SANS}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = color;
      ctx.save();
      ctx.translate(X(zc), (y0 + y1) / 2);
      ctx.scale((width * px) / ctx.measureText(str).width, 1);
      ctx.fillText(str, 0, 0);
      ctx.restore();
    };
    label(TEXT, -7.6, -0.13, 0.6, 8.0, '#ffffff');
    label('Enjoy Flying!', -10.6, -0.56, -0.4, 2.3, '#ffffff', 'italic 700');
    label('VN-A516', -14.6, 0.6, 0.7, 1.5, '#ffffff', 'italic 700');

    // national flag below the cockpit side window
    const fx = X(18.3), fw = 0.62 * px, fy0 = Yh(0.06), fy1 = Yh(-0.14);
    ctx.fillStyle = '#da251d';
    ctx.fillRect(fx - fw / 2, fy0, fw, fy1 - fy0);
    star(ctx, fx, (fy0 + fy1) / 2, (fy1 - fy0) * 0.3, '#ffde00');
    ctx.strokeStyle = 'rgba(120,125,130,0.6)';
    ctx.lineWidth = 1;
    ctx.strokeRect(fx - fw / 2, fy0, fw, fy1 - fy0);

    // doors
    for (const z of DOORS) {
      const w = 0.86 * px, x = X(z) - w / 2, y0 = Yh(0.64), y1 = Yh(-0.5);
      ctx.strokeStyle = z > 6 || z < -16 ? 'rgba(70,74,82,0.6)' : 'rgba(255,232,224,0.75)';
      ctx.lineWidth = Math.max(1.5, px * 0.022);
      ctx.beginPath();
      ctx.roundRect(x, y0, w, y1 - y0, w * 0.16);
      ctx.stroke();
    }
  }

  // cabin windows
  const ww = 0.235 * px, wy0 = Yh(0.35), wy1 = Yh(0.17);
  const pane = (z: number, w: number) => {
    ctx.beginPath();
    ctx.roundRect(X(z) - w / 2, wy0, w, wy1 - wy0, w * 0.42);
    ctx.fillStyle = glow ? '#ffe9bd' : '#0c1116';
    ctx.fill();
    if (glow) return;
    ctx.strokeStyle = 'rgba(214,218,224,0.85)';
    ctx.lineWidth = Math.max(1, px * 0.016);
    ctx.stroke();
  };
  for (let z = 16.75; z > -16.3; z -= 0.533) if (!DOORS.some((d) => Math.abs(d - z) < 0.72)) pane(z, ww);
  for (const z of DOORS) pane(z, ww * 0.7);

  // flight deck glazing, as (z, degrees up from the keel)
  const glass: [number, number][][] = [
    [[19.15, 178], [20.05, 178], [19.85, 139], [19.0, 147]],
    [[18.94, 146], [19.8, 137], [19.55, 119], [18.5, 125]],
    [[18.44, 147], [18.88, 145], [18.44, 124], [17.9, 129], [17.9, 141]],
  ];
  for (const poly of glass) {
    ctx.beginPath();
    poly.forEach(([z, deg], i) => (i ? ctx.lineTo(X(z), Yt(deg)) : ctx.moveTo(X(z), Yt(deg))));
    ctx.closePath();
    if (glow) ctx.fillStyle = '#3a3122';
    else {
      const g = ctx.createLinearGradient(0, Yt(178), 0, Yt(119));
      g.addColorStop(0, '#22303f');
      g.addColorStop(1, '#070a0e');
      ctx.fillStyle = g;
    }
    ctx.fill();
    if (glow) continue;
    ctx.strokeStyle = '#30353c';
    ctx.lineWidth = Math.max(1.5, px * 0.03);
    ctx.lineJoin = 'round';
    ctx.stroke();
  }
  ctx.restore();
}

const TEX_PAD = 1 / 85; // unused strip at the crown and keel of each half, so mipmaps do not bleed across

function fuselageTexture(W: number, H: number, glow: boolean) {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const hh = H / 2, pad = hh * TEX_PAD;
  paintFuselage(ctx, W, hh, pad, false, glow); // port side in the upper half
  ctx.translate(0, hh);
  paintFuselage(ctx, W, hh, pad, true, glow);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 16;
  return map;
}
/** Texture coordinates of the fuselage paint at station z, `deg` degrees up from the keel. */
function fuselageUV(side: number, z: number, deg: number): [number, number] {
  const y = (side > 0 ? 0 : 0.5) + 0.5 * (TEX_PAD + (1 - deg / 180) * (1 - 2 * TEX_PAD));
  return [(side > 0 ? NOSE - z : z - TAIL) / LEN, 1 - y];
}

function finTexture() {
  const W = 4096, H = 1638, hw = W / 2;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const sx = hw / (FIN_Z1 - FIN_Z0), sy = H / (FIN_Y1 - FIN_Y0);
  for (const mirror of [false, true]) {
    ctx.save();
    ctx.translate(mirror ? hw : 0, 0);
    ctx.beginPath();
    ctx.rect(0, 0, hw, H);
    ctx.clip();
    const X = (z: number) => (mirror ? z - FIN_Z0 : FIN_Z1 - z) * sx, Y = (y: number) => (FIN_Y1 - y) * sy;
    ctx.fillStyle = '#e0211b';
    ctx.fillRect(0, 0, hw, H);
    // yellow wedge along the lower trailing edge, continuing the tail sweep of the fuselage
    ctx.beginPath();
    ctx.moveTo(X(-17.1), Y(FIN_Y0));
    ctx.lineTo(X(-19.33), Y(AX + 6.6));
    ctx.lineTo(X(FIN_Z0), Y(AX + 6.6));
    ctx.lineTo(X(FIN_Z0), Y(FIN_Y0));
    ctx.closePath();
    ctx.fillStyle = '#ffd100';
    ctx.fill();
    // lettering runs up the fin on the port side and down it on the starboard side
    ctx.translate(X(-16.25), Y(AX + 4.45));
    ctx.rotate(((mirror ? 62 : -62) * Math.PI) / 180);
    ctx.font = `italic 900 ${0.98 * sy}px ${SANS}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    ctx.scale((5.3 * sy) / ctx.measureText(TEXT).width, 1);
    ctx.fillText(TEXT, 0, 0);
    ctx.restore();
  }
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 16;
  return map;
}

function starTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  star(canvas.getContext('2d')!, 128, 136, 118, '#ffd400');
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  return map;
}

// ------------------------------------------------------------------ parts
function fuselage(s: Surf) {
  // stations: dense over the nose and the tail cone, sparse along the constant section
  const zs = [
    ...range(0, 1, 44).map((u) => NOSE - NOSE_LEN * u * u),
    ...range(NOSE - NOSE_LEN, TAIL_FROM, 26).slice(1),
    ...range(TAIL_FROM, TAIL, 34).slice(1),
  ];
  const ring = range(0, Math.PI, 40);
  for (const side of [1, -1]) {
    s.grid(zs, ring, (z, th) => {
      const [r, cy] = section(z);
      return [side * r * Math.sin(th), AX + cy - r * Math.cos(th), z];
    }, { flip: side < 0, uv: (z, th) => fuselageUV(side, z, (th * 180) / Math.PI) });
    // wing-to-body fairing: a shallow blister under the centre section, painted with the same livery
    const F0 = 9.0, F1 = -7.6;
    s.grid(range(F0, F1, 40), ring, (z, ph) => {
      const e = Math.pow(Math.max(0, 1 - Math.pow(Math.abs((2 * (z - F1)) / (F0 - F1) - 1), 2.6)), 0.45);
      return [side * 2.38 * e * Math.sin(ph), AX - 1.1 - 1.12 * e * Math.cos(ph), z];
    }, { flip: side < 0, uv: (z, _ph, p) => fuselageUV(side, z, (Math.acos(clamp(-(p[1] - AX) / R, -1, 1)) * 180) / Math.PI) });
  }
}

function tailSurfaces(paint: Surf, fin: Surf) {
  for (const mirror of [false, true])
    loft(paint, [
      { le: [0.4, AX + 0.9, -16.4], chord: 4.2, t: 0.1, cant: 0, color: STAB },
      { le: [6.2, AX + 1.45, -20.1], chord: 1.5, t: 0.09, cant: 0, color: STAB },
      { le: [6.26, AX + 1.46, -20.2], chord: 1.3, t: 0.01, cant: 0, color: STAB },
    ], { mirror });
  const up = Math.PI / 2;
  loft(fin, [
    { le: [0, AX + 1.2, -12.2], chord: 6.4, t: 0.1, cant: up, color: 0xffffff },
    { le: [0, AX + 7.9, -17.6], chord: 1.9, t: 0.09, cant: up, color: 0xffffff },
    { le: [0, AX + 7.96, -17.7], chord: 1.7, t: 0.01, cant: up, color: 0xffffff },
  ], {
    // the "upper" skin of a vertical surface faces starboard, which uses the right half of the texture
    uv: (p, starboard) => {
      const u = (starboard ? p[2] - FIN_Z0 : FIN_Z1 - p[2]) / (FIN_Z1 - FIN_Z0) / 2;
      return [starboard ? 0.5 + u : u, (p[1] - FIN_Y0) / (FIN_Y1 - FIN_Y0)];
    },
  });
}

function wings(paint: Surf) {
  const ribs = wingRibs();
  for (const mirror of [false, true]) {
    const sx = mirror ? -1 : 1;
    loft(paint, ribs, { mirror, camber: 0.02 });
    // flap track fairings
    for (const x of [3.9, 8.1, 12.0]) {
      const w = wingAt(x);
      paint.add(new THREE.SphereGeometry(1, 20, 14), WING, xf([sx * x, w.y - 0.34, w.z - w.chord + 0.75], [0.05, 0, 0], [0.19, 0.27, 1.75]));
    }
    // engine pylon
    const side = Math.PI / 2;
    loft(paint, [
      { le: [ENGINE_X, AX - 1.45, 6.5], chord: 5.2, t: 0.075, cant: side, color: RED },
      { le: [ENGINE_X, AX - 0.8, 5.5], chord: 5.2, t: 0.075, cant: side, color: RED },
    ], { mirror, sub: 1 });
  }
  // aerials
  for (const [y, z] of [[AX + R + 0.14, 10.2], [AX + R + 0.14, -1.5], [AX - R - 0.16, 13]]) paint.add(new THREE.BoxGeometry(0.035, 0.36, 0.5), 0xf1f2f3, xf([0, y, z], [y > AX ? -0.5 : 0.5, 0, 0]));
}

/** Nacelle, intake and exhaust for one engine, with the lip of the intake at the local origin. */
function engine(paint: Surf, metal: Surf, dark: Surf, x: number) {
  const m = xf([x, ENGINE_Y, ENGINE_Z], [Math.PI / 2, 0, 0]); // lathe axis -> nose
  const profile = new THREE.SplineCurve(
    [[0.97, -4.25], [1.07, -3.5], [1.17, -2.6], [1.2, -1.6], [1.17, -0.85], [1.1, -0.28], [1.03, -0.04], [0.97, 0.01], [0.92, -0.08], [0.895, -0.32], [0.88, -0.95]].map(([r, y]) => new THREE.Vector2(r, y)),
  ).getPoints(72);
  const i1 = profile.findIndex((p) => p.y > -0.3);
  const i2 = profile.findIndex((p, i) => i > i1 && p.y < -0.3);
  const SEG = 72;
  paint.add(new THREE.LatheGeometry(profile.slice(0, i1 + 1), SEG), RED, m.clone());
  metal.add(new THREE.LatheGeometry(profile.slice(i1, i2 + 1), SEG), 0xdfe3e8, m.clone()); // polished lip
  metal.add(new THREE.LatheGeometry(profile.slice(i2), SEG), 0x7c8187, m.clone()); // intake liner
  const v = (r: number, y: number) => new THREE.Vector2(r, y);
  dark.add(new THREE.LatheGeometry([v(0.6, -4.25), v(0.97, -4.25)], SEG), 0x0c0d0f, m.clone()); // bypass duct exit
  metal.add(new THREE.LatheGeometry([v(0.43, -5.05), v(0.55, -4.55), v(0.64, -3.9)], SEG), 0x8c9096, m.clone()); // core cowl
  metal.add(new THREE.LatheGeometry([v(0.001, -5.75), v(0.2, -5.2), v(0.29, -4.85)], SEG), 0x6f7378, m.clone()); // exhaust plug
  dark.add(new THREE.LatheGeometry([v(0.001, -4.95), v(0.43, -4.95)], SEG), 0x050506, m.clone());
  dark.add(new THREE.CircleGeometry(0.89, SEG), 0x040405, at(x, ENGINE_Y, ENGINE_Z - 0.92)); // behind the fan
}

/** Spinning fan and spinner, centred on its own origin and facing +Z. */
function fanGeometry() {
  const s = new Surf();
  for (let k = 0; k < 22; k++) {
    const blade = new THREE.BoxGeometry(0.035, 0.62, 0.3, 1, 6, 1);
    const p = blade.attributes.position;
    // twist: flat to the airflow at the root, turned at the tip
    for (let i = 0; i < p.count; i++) {
      const a = 0.55 + (p.getY(i) + 0.31) * 0.9, x = p.getX(i), z = p.getZ(i);
      p.setXYZ(i, x * Math.cos(a) - z * Math.sin(a), p.getY(i), x * Math.sin(a) + z * Math.cos(a));
    }
    blade.computeVertexNormals();
    s.add(blade, 0x3a3e45, xf([0, 0, 0], [0, 0, (k * Math.PI * 2) / 22]).multiply(at(0, 0.56, 0)));
  }
  s.add(new THREE.ConeGeometry(0.29, 0.6, 40), 0xd9dcdf, xf([0, 0, 0.22], [Math.PI / 2, 0, 0]));
  s.add(new THREE.SphereGeometry(0.05, 12, 8), 0xf4f4f4, at(0.17, 0, 0.3)); // spinner mark
  return s.build();
}

function wheel(dark: Surf, metal: Surf, x: number, y: number, z: number, d: number, w: number) {
  const r = d / 2, b = w * 0.2, v = (q: number, h: number) => new THREE.Vector2(q, h);
  const tyre = [v(r * 0.56, -w / 2), v(r - b, -w / 2), v(r - b * 0.3, -w / 2 + b * 0.3), v(r, -w / 2 + b), v(r, w / 2 - b), v(r - b * 0.3, w / 2 - b * 0.3), v(r - b, w / 2), v(r * 0.56, w / 2)];
  const m = xf([x, y, z], [0, 0, Math.PI / 2]);
  dark.add(new THREE.LatheGeometry(tyre, 40), 0x121213, m.clone());
  metal.add(new THREE.CylinderGeometry(r * 0.57, r * 0.57, w * 0.8, 32), 0xc4c8cd, m.clone());
  metal.add(new THREE.CylinderGeometry(r * 0.2, r * 0.2, w * 0.96, 20), 0x6e7277, m.clone());
}

/** One landing-gear leg hanging from its pivot at the local origin. */
function gearLeg(len: number, d: number, w: number, gap: number, strut: number) {
  const dark = new Surf(), metal = new Surf();
  const y = -len;
  metal.add(new THREE.CylinderGeometry(strut, strut, len * 0.62, 20), 0xd4d7db, at(0, -len * 0.31, 0));
  metal.add(new THREE.CylinderGeometry(strut * 0.62, strut * 0.62, len * 0.5, 20), 0xeef0f2, at(0, -len * 0.75, 0)); // oleo
  metal.add(new THREE.CylinderGeometry(strut * 0.7, strut * 0.7, gap + w, 16), 0x9da2a8, xf([0, y, 0], [0, 0, Math.PI / 2])); // axle
  metal.add(new THREE.CylinderGeometry(strut * 0.4, strut * 0.4, len * 0.8, 12), 0xb8bcc1, xf([0, -len * 0.42, -len * 0.26], [0.72, 0, 0])); // drag brace
  metal.add(new THREE.BoxGeometry(strut * 0.8, len * 0.3, strut * 2.4), 0xb8bcc1, xf([0, -len * 0.78, strut * 1.4], [0.5, 0, 0])); // torque link
  for (const sx of [-1, 1]) wheel(dark, metal, (sx * gap) / 2, y, 0, d, w);
  return { dark: dark.build(), metal: metal.build() };
}

/** Curved decal patch on the side of a nacelle. */
function starPatches() {
  const s = new Surf();
  const r = 1.212, half = 0.62;
  for (const x of [ENGINE_X, -ENGINE_X])
    for (const mid of [0, Math.PI])
      s.grid(range(ENGINE_Z - 2.3, ENGINE_Z - 1.0, 6), range(mid - 0.55, mid + 0.55, 14), (z, ph) => [x + r * Math.cos(ph), ENGINE_Y + r * Math.sin(ph), z], {
        flip: true,
        uv: (z, _ph, p) => [(z - (ENGINE_Z - 2.3)) / 1.3, 0.5 + (p[1] - ENGINE_Y) / (2 * half)],
      });
  return s.build();
}

// ------------------------------------------------------------------ assembly
export class A321Model {
  readonly group = new THREE.Group();
  private fans: THREE.Mesh[] = [];
  private legs: { g: THREE.Group; axis: 'x' | 'z'; sign: number }[] = [];
  private beacons: THREE.Mesh[] = [];
  private strobes: THREE.Mesh[] = [];
  private skin: THREE.MeshPhysicalMaterial;
  private clock = 0;

  /** `maxTexture` is the GPU's texture size limit; the fuselage paint uses up to 8192 px along the length. */
  constructor(maxTexture: number) {
    const big = Math.min(8192, maxTexture);
    const gloss = { roughness: 0.36, metalness: 0.1, clearcoat: 0.7, clearcoatRoughness: 0.12 };
    this.skin = new THREE.MeshPhysicalMaterial({
      ...gloss,
      map: fuselageTexture(big, big / 4, false),
      emissiveMap: fuselageTexture(2048, 512, true),
      emissive: 0xffffff,
      emissiveIntensity: 0,
    });
    const finMat = new THREE.MeshPhysicalMaterial({ ...gloss, map: finTexture() });
    const paintMat = new THREE.MeshPhysicalMaterial({ ...gloss, vertexColors: true });
    const metalMat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.22, metalness: 1, clearcoat: 0.3 });
    const darkMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.05 });
    const decalMat = new THREE.MeshPhysicalMaterial({
      ...gloss, map: starTexture(), transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });

    const body = new Surf(), fin = new Surf(), paint = new Surf(), metal = new Surf(), dark = new Surf();
    fuselage(body);
    tailSurfaces(paint, fin);
    wings(paint);
    for (const x of [ENGINE_X, -ENGINE_X]) engine(paint, metal, dark, x);
    dark.add(new THREE.CylinderGeometry(0.2, 0.17, 0.3, 24), 0x1b1c1e, xf([0, AX + section(TAIL)[1], TAIL - 0.05], [Math.PI / 2, 0, 0])); // APU exhaust

    const solid = (g: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D = this.group) => {
      const mesh = new THREE.Mesh(g, m);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      parent.add(mesh);
      return mesh;
    };
    solid(body.build(), this.skin);
    solid(fin.build(), finMat);
    solid(paint.build(), paintMat);
    solid(metal.build(), metalMat);
    solid(dark.build(), darkMat);

    const fan = fanGeometry();
    for (const x of [ENGINE_X, -ENGINE_X]) {
      const f = solid(fan, metalMat);
      f.position.set(x, ENGINE_Y, ENGINE_Z - 0.88);
      this.fans.push(f);
    }
    const stars = new THREE.Mesh(starPatches(), decalMat);
    stars.renderOrder = 1;
    this.group.add(stars);

    // landing gear: the mains fold inwards into the belly, the nose leg forwards
    const main = gearLeg(1.52, 1.17, 0.42, 0.93, 0.13), nose = gearLeg(1.17, 0.76, 0.22, 0.5, 0.085);
    const leg = (parts: typeof main, pos: V3, axis: 'x' | 'z', sign: number) => {
      const g = new THREE.Group();
      g.position.set(...pos);
      solid(parts.metal, metalMat, g);
      solid(parts.dark, darkMat, g);
      this.group.add(g);
      this.legs.push({ g, axis, sign });
    };
    leg(main, [3.8, 2.105, 0], 'z', -1);
    leg(main, [-3.8, 2.105, 0], 'z', 1);
    leg(nose, [0, 1.55, 17.1], 'x', -1);

    // lights: values above 1 so they bloom
    const lamp = (color: THREE.Color, pos: V3, r = 0.09) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 8), new THREE.MeshBasicMaterial({ color }));
      m.position.set(...pos);
      this.group.add(m);
      return m;
    };
    const tip = wingRibs()[3].le;
    lamp(new THREE.Color(5, 0.25, 0.15), [tip[0], tip[1], tip[2] - 0.1]);
    lamp(new THREE.Color(0.2, 5, 0.6), [-tip[0], tip[1], tip[2] - 0.1]);
    lamp(new THREE.Color(4, 4, 4), [0, AX + section(TAIL)[1] + 0.25, TAIL + 0.3], 0.07);
    lamp(new THREE.Color(5, 4.6, 3.6), [0, 1.0, 17.22], 0.08); // taxi light on the nose leg
    this.beacons.push(lamp(new THREE.Color(6, 0.2, 0.12), [0, AX + R + 0.05, 2.5], 0.11), lamp(new THREE.Color(6, 0.2, 0.12), [0, AX - 2.24, 1.5], 0.11));
    this.strobes.push(lamp(new THREE.Color(8, 8, 8), [tip[0], tip[1], tip[2] - 0.9], 0.07), lamp(new THREE.Color(8, 8, 8), [-tip[0], tip[1], tip[2] - 0.9], 0.07));
  }

  /** `spool` 0..1 turns the fans, `gearUp` 0..1 folds the gear away, `night` 0..1 lights the cabin. */
  animate(dt: number, spool: number, gearUp: number, night: number) {
    this.clock += dt;
    for (const f of this.fans) f.rotation.z -= spool * 38 * dt;
    for (const l of this.legs) {
      l.g.rotation[l.axis] = l.sign * gearUp * 1.5;
      l.g.visible = gearUp < 0.97;
    }
    const t = this.clock % 1.2;
    for (const b of this.beacons) b.visible = t < 0.14;
    for (const s of this.strobes) s.visible = (t > 0.6 && t < 0.66) || (t > 0.76 && t < 0.82);
    this.skin.emissiveIntensity = night * 1.6;
  }
}
