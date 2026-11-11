import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { ModelDetail, modelDetail, onModelDetail } from '../../core/geo';

/**
 * Road-car construction kit. A car is one skinned mesh:
 *  - the body is a lofted skin (cross-sections along the length) wrapped in a painted atlas whose
 *    alpha channel cuts the window and wheel-arch openings, so their outlines are as sharp as the drawing;
 *  - glass is a second, transparent layer just inside the skin, and a dark lining sits inside that;
 *  - doors and wheels are bones, so they swing, slide, spin and steer without extra draw calls.
 * Models face +Z with the ground at y = 0; +X is the car's left.
 */

export type V3 = [number, number, number];
export type CRM = [number, number, number];
export type View = 'L' | 'R' | 'top' | 'front' | 'rear';
type Ctx = CanvasRenderingContext2D;
export type Path = (c: Ctx) => void;

/** Surface finishes: clear coat, roughness, metalness. */
export const FIN = {
  paint: [1, 0.5, 0.04] as CRM,
  metallic: [1, 0.42, 0.55] as CRM,
  gloss: [1, 0.25, 0] as CRM,
  plastic: [0, 0.62, 0] as CRM,
  rubber: [0, 0.93, 0] as CRM,
  chrome: [0, 0.08, 1] as CRM,
  alloy: [0.3, 0.3, 0.85] as CRM,
  lens: [1, 0.1, 0] as CRM,
  fabric: [0, 1, 0] as CRM,
  steel: [0, 0.45, 0.7] as CRM,
};
export type Finish = keyof typeof FIN;
const FINS = Object.keys(FIN) as Finish[];

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Smooth monotone curve through (z, value) knots given in ascending z; constant beyond the ends. */
export function curve(k: [number, number][]): (z: number) => number {
  const n = k.length, d: number[] = [], m: number[] = new Array(n);
  for (let i = 0; i < n - 1; i++) d.push((k[i + 1][1] - k[i][1]) / (k[i + 1][0] - k[i][0]));
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (2 * d[i - 1] * d[i]) / (d[i - 1] + d[i]);
  return (z) => {
    if (z <= k[0][0]) return k[0][1];
    if (z >= k[n - 1][0]) return k[n - 1][1];
    let i = 0;
    while (z > k[i + 1][0]) i++;
    const h = k[i + 1][0] - k[i][0], t = (z - k[i][0]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * k[i][1] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * k[i + 1][1] + (t3 - t2) * h * m[i + 1];
  };
}

// ------------------------------------------------------------------ atlas
export interface Extent {
  z0: number; // rear end
  z1: number; // nose
  hw: number; // half width
  h: number; // height
  /** Both flanks share one drawing (no lettering that would read backwards). */
  mirror: boolean;
}
interface Rect { x: number; y: number; w: number; h: number }
const GAP = 0.06, SWATCH = 0.14;

/** Where each view of the car lives in the texture, in metres, so UVs do not depend on the resolution. */
export class Atlas {
  readonly W: number;
  readonly H: number;
  readonly rect = {} as Record<View, Rect>;
  private swY: number;

  constructor(readonly ext: Extent) {
    const len = ext.z1 - ext.z0, wid = ext.hw * 2, h = ext.h;
    const sw = FINS.length * (SWATCH + GAP);
    const sides = ext.mirror ? 1 : 2;
    const aW = Math.max(len, wid * 2 + GAP, sw), aH = h * sides + wid + h + GAP * (sides + 2) + SWATCH;
    const bW = Math.max(len * sides + GAP * (sides - 1), len + wid * 2 + GAP * 2, sw), bH = h + Math.max(wid, h) + GAP * 2 + SWATCH;
    const r = this.rect;
    if (Math.max(aW, aH) <= Math.max(bW, bH)) {
      r.L = { x: 0, y: 0, w: len, h };
      r.R = ext.mirror ? r.L : { x: 0, y: h + GAP, w: len, h };
      const yTop = (h + GAP) * sides;
      r.top = { x: 0, y: yTop, w: len, h: wid };
      const yF = yTop + wid + GAP;
      r.front = { x: 0, y: yF, w: wid, h };
      r.rear = { x: wid + GAP, y: yF, w: wid, h };
      this.swY = yF + h + GAP;
      this.W = aW;
      this.H = aH;
    } else {
      r.L = { x: 0, y: 0, w: len, h };
      r.R = ext.mirror ? r.L : { x: len + GAP, y: 0, w: len, h };
      const y2 = h + GAP;
      r.top = { x: 0, y: y2, w: len, h: wid };
      r.front = { x: len + GAP, y: y2, w: wid, h };
      r.rear = { x: len + GAP * 2 + wid, y: y2, w: wid, h };
      this.swY = y2 + Math.max(wid, h) + GAP;
      this.W = bW;
      this.H = bH;
    }
  }

  /** Texture coordinate of a point in a view: (z, y) on the flanks, (z, x) from above, (x, y) on the ends. */
  uv(view: View, a: number, b: number): [number, number] {
    const r = this.rect[view], e = this.ext;
    let x: number, y: number;
    if (view === 'L' || (view === 'R' && e.mirror)) { x = r.x + (e.z1 - a); y = r.y + (e.h - b); }
    else if (view === 'R') { x = r.x + (a - e.z0); y = r.y + (e.h - b); }
    else if (view === 'top') { x = r.x + (a - e.z0); y = r.y + (e.hw - b); }
    else if (view === 'front') { x = r.x + (a + e.hw); y = r.y + (e.h - b); }
    else { x = r.x + (e.hw - a); y = r.y + (e.h - b); }
    return [x / this.W, 1 - y / this.H];
  }
  swatch(f: Finish): [number, number] {
    return [(FINS.indexOf(f) * (SWATCH + GAP) + SWATCH / 2) / this.W, 1 - (this.swY + SWATCH / 2) / this.H];
  }
  swatchRect(i: number): Rect {
    return { x: i * (SWATCH + GAP), y: this.swY, w: SWATCH, h: SWATCH };
  }
}

// ------------------------------------------------------------------ painting
/** Texture alpha: 0 = opening, TINT_A = takes the car's paint colour, 1 = drawn colour as is. */
const TINT_A = 0.6;
const crmCss = (f: CRM) => `rgb(${Math.round(f[0] * 255)},${Math.round(f[1] * 255)},${Math.round(f[2] * 255)})`;

export const rect = (a: number, b: number, w: number, h: number, r = 0): Path => (c) => {
  if (r) c.roundRect(a, b, w, h, r);
  else c.rect(a, b, w, h);
};
export const circle = (a: number, b: number, r: number): Path => (c) => {
  c.moveTo(a + r, b);
  c.arc(a, b, r, 0, Math.PI * 2);
};
export const poly = (pts: [number, number][], close = true): Path => (c) => {
  pts.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])));
  if (close) c.closePath();
};

/** Draws one view at a time, in metres with y up, onto the colour canvas and the finish (clear coat / roughness / metal) canvas. */
export class Paint {
  private c: Ctx;
  private m: Ctx;
  private cur: View = 'L';
  constructor(readonly atlas: Atlas, color: HTMLCanvasElement, crm: HTMLCanvasElement, private ppm: number, private ppmM: number) {
    this.c = color.getContext('2d')!;
    this.m = crm.getContext('2d')!;
    this.c.clearRect(0, 0, color.width, color.height);
    this.m.fillStyle = crmCss(FIN.plastic);
    this.m.fillRect(0, 0, crm.width, crm.height);
    FINS.forEach((f, i) => {
      const r = atlas.swatchRect(i), g = GAP / 3;
      this.c.fillStyle = `rgba(255,255,255,${TINT_A})`;
      this.c.fillRect((r.x - g) * ppm, (r.y - g) * ppm, (r.w + g * 2) * ppm, (r.h + g * 2) * ppm);
      this.m.fillStyle = crmCss(FIN[f]);
      this.m.fillRect((r.x - g) * ppmM, (r.y - g) * ppmM, (r.w + g * 2) * ppmM, (r.h + g * 2) * ppmM);
    });
    this.c.save();
    this.m.save();
  }

  /** Switch to a view; drawing is clipped to its patch of the atlas. */
  view(v: View) {
    this.cur = v;
    const r = this.atlas.rect[v], e = this.atlas.ext;
    for (const [ctx, s] of [[this.c, this.ppm], [this.m, this.ppmM]] as [Ctx, number][]) {
      ctx.restore();
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.beginPath();
      ctx.rect(r.x * s, r.y * s, r.w * s, r.h * s);
      ctx.clip();
      const fy = (r.y + (v === 'top' ? e.hw : e.h)) * s;
      if (v === 'L' || (v === 'R' && e.mirror)) ctx.setTransform(-s, 0, 0, -s, (r.x + e.z1) * s, fy);
      else if (v === 'R' || v === 'top') ctx.setTransform(s, 0, 0, -s, (r.x - e.z0) * s, fy);
      else if (v === 'front') ctx.setTransform(s, 0, 0, -s, (r.x + e.hw) * s, fy);
      else ctx.setTransform(-s, 0, 0, -s, (r.x + e.hw) * s, fy);
    }
    return this;
  }
  /** Fill a shape. `tint` marks it as body paint, which is multiplied by the car's own colour. */
  put(path: Path, color: string | CanvasGradient, fin?: CRM, tint = false) {
    const c = this.c;
    c.beginPath();
    path(c);
    if (tint) {
      c.globalCompositeOperation = 'destination-out';
      c.fillStyle = '#000';
      c.fill();
      c.globalCompositeOperation = 'source-over';
      c.globalAlpha = TINT_A;
    }
    c.fillStyle = color;
    c.fill();
    c.globalAlpha = 1;
    if (fin) {
      this.m.beginPath();
      path(this.m);
      this.m.fillStyle = crmCss(fin);
      this.m.fill();
    }
    return this;
  }
  /** Cut an opening through the skin. */
  hole(path: Path) {
    const c = this.c;
    c.beginPath();
    path(c);
    c.globalCompositeOperation = 'destination-out';
    c.fillStyle = '#000';
    c.fill();
    c.globalCompositeOperation = 'source-over';
    return this;
  }
  /** Darken or lighten what is already there without changing openings or the paint mask. */
  shade(path: Path, color: string | CanvasGradient) {
    const c = this.c;
    c.beginPath();
    path(c);
    c.globalCompositeOperation = 'source-atop';
    c.fillStyle = color;
    c.fill();
    c.globalCompositeOperation = 'source-over';
    return this;
  }
  line(path: Path, width: number, color: string, fin?: CRM) {
    for (const [ctx, style] of [[this.c, color], [this.m, fin ? crmCss(fin) : null]] as [Ctx, string | null][]) {
      if (!style) continue;
      ctx.beginPath();
      path(ctx);
      ctx.lineWidth = width;
      ctx.lineJoin = ctx.lineCap = 'round';
      ctx.strokeStyle = style;
      ctx.stroke();
    }
    return this;
  }
  grad(a0: number, b0: number, a1: number, b1: number, stops: [number, string][]) {
    const g = this.c.createLinearGradient(a0, b0, a1, b1);
    for (const [t, col] of stops) g.addColorStop(t, col);
    return g;
  }
  /** Upright text centred on (a, b); it is never mirrored, whichever way the view runs. `size` is the cap height in metres. */
  text(str: string, a: number, b: number, size: number, color: string, o: { font?: string; weight?: number; italic?: boolean; spread?: number; maxW?: number; squeeze?: number } = {}) {
    const c = this.c, t = c.getTransform();
    c.save();
    c.setTransform(1, 0, 0, 1, t.a * a + t.e, t.d * b + t.f);
    if (o.squeeze) c.scale(o.squeeze, 1);
    const px = size * this.ppm * 1.36;
    c.font = `${o.italic ? 'italic ' : ''}${o.weight ?? 700} ${px}px ${o.font ?? SANS}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = color;
    if (o.spread) {
      const chars = [...str], pitch = o.spread * this.ppm;
      chars.forEach((ch, i) => c.fillText(ch, (i - (chars.length - 1) / 2) * pitch, 0));
    } else c.fillText(str, 0, 0, o.maxW ? o.maxW * this.ppm : undefined);
    c.restore();
    return this;
  }
  get current() {
    return this.cur;
  }
  done() {
    this.c.restore();
    this.m.restore();
  }
}
export const SANS = '"Arial","Helvetica Neue","Helvetica",sans-serif';
export const GOTHIC = '"Yu Gothic","YuGothic","Meiryo","Hiragino Kaku Gothic ProN","Noto Sans JP","Noto Sans CJK JP",sans-serif';

// ------------------------------------------------------------------ rig
export type DoorKind = 'swing' | 'slide' | 'lift';
export type DoorRole = 'driver' | 'front' | 'rear' | 'hatch';
export interface DoorRig { bone: number; kind: DoorKind; side: number; role: DoorRole; amount: number }
export interface WheelRig { spin: number; steer: number; r: number }

/** Bones of a car: 0 is the body, the rest are doors, steering knuckles and wheels. */
export class Rig {
  readonly bones: { parent: number; pos: V3 }[] = [{ parent: -1, pos: [0, 0, 0] }];
  readonly wheels: WheelRig[] = [];
  readonly doors: DoorRig[] = [];
  /** Where the driver sits; people get in and out level with it. */
  seat: V3 = [-0.37, 0.6, 0];
  /** Bone carrying the driver figure, hidden while nobody is at the wheel. */
  driver = -1;

  bone(pos: V3, parent = 0) {
    this.bones.push({ parent, pos });
    return this.bones.length - 1;
  }
  /** Returns the bone that spins with the wheel. */
  wheel(at: V3, d: number, steered: boolean) {
    const steer = steered ? this.bone(at) : -1;
    const spin = this.bone(at, steered ? steer : 0);
    this.wheels.push({ spin, steer, r: d / 2 });
    return spin;
  }
  /** `amount` is the opening angle in radians, or the travel in metres for a sliding door. */
  door(hinge: V3, kind: DoorKind, side: number, role: DoorRole, amount: number) {
    const bone = this.bone(hinge);
    this.doors.push({ bone, kind, side, role, amount });
    return bone;
  }
}

// ------------------------------------------------------------------ geometry
export interface PartOpt {
  color: number;
  fin?: Finish;
  /** >1 keeps the part bright at night (lamps). */
  glow?: number;
  bone?: number;
  /** 0 = body, 1 = glass. */
  group?: 0 | 1;
  alpha?: number;
}
export interface Sect {
  yb: number; // underside
  wb: number; // half width at the sill
  w: number; // widest half width, half way up the flank
  ys: number; // belt line
  ws: number; // half width at the belt
  ye: number; // roof edge
  we: number; // half width at the roof edge
  yt: number; // roof at the centre line
  rb?: number;
  re?: number;
}
export interface DoorCut { za: number; zb: number; side: number; bone: number }
export interface CapDef {
  /** How far the end face swells outwards at (x, y). */
  bulge?: (x: number, y: number) => number;
  /** Plain colour instead of the drawn front / rear view. */
  plain?: number;
  glass?: boolean;
  inner?: boolean;
  /** Rows above yMin belong to a tailgate bone. */
  door?: { bone: number; yMin: number };
}
export interface HullDef {
  z0: number;
  z1: number;
  sect: (z: number) => Sect;
  /** Vertex colour of the skin: the paint colour, or white where the drawing carries the colours. */
  color: number;
  /** Stations that must exist (door edges). */
  breaks?: number[];
  capFront?: CapDef;
  capRear?: CapDef;
  doors?: DoorCut[];
  glassSide?: [number, number];
  glassTop?: [number, number][];
  /** Tint colour and opacity of the glass at z. */
  glass?: (z: number, top: boolean) => [number, number];
  /** Range that gets an inner lining (it shows through the windows and open doors). */
  cabin?: [number, number];
  trim?: number;
  headliner?: number;
  density?: number;
}

interface Counts { nB: number; nC: number; nS: number; nG: number; nE: number; nR: number }
const RING: Counts[] = [
  { nB: 2, nC: 2, nS: 4, nG: 3, nE: 2, nR: 3 },
  { nB: 2, nC: 4, nS: 7, nG: 5, nE: 4, nR: 5 },
  { nB: 3, nC: 4, nS: 10, nG: 7, nE: 6, nR: 8 },
];
const CAP_COLS = [[1, 0.6, 0.25, 0], [1, 0.82, 0.55, 0.28, 0], [1, 0.88, 0.7, 0.48, 0.24, 0]];
const UNDER = 0x0d0e10, INNER_A = 0.25;
const VIEW_ID: Record<View, number> = { L: 1, R: 2, top: 3, front: 4, rear: 5 };

/** Half cross-section from the keel, round the sill, up the flank and over the roof to the centre line. */
function ring(s: Sect, c: Counts, xs: number[], ys: number[]) {
  let n = 0;
  const put = (x: number, y: number) => {
    xs[n] = Math.max(0, x);
    ys[n++] = y;
  };
  const hgt = Math.max(1e-3, s.ys - s.yb);
  const cut = Math.min(s.rb ?? 0.06, s.wb * 0.45, hgt * 0.45);
  const bulge = Math.max(0, s.w - (s.wb + s.ws) / 2);
  const side = (u: number): [number, number] => [s.wb + (s.ws - s.wb) * u + bulge * Math.sin(Math.PI * u) ** 0.9, s.yb + hgt * u];
  const u0 = cut / hgt, [bx, by] = side(u0);
  for (let k = 0; k <= c.nB; k++) put(((s.wb - cut) * k) / c.nB, s.yb);
  for (let k = 1; k <= c.nC; k++) {
    const t = k / c.nC, a = (1 - t) * (1 - t), b = 2 * t * (1 - t), d = t * t;
    put(a * (s.wb - cut) + b * s.wb + d * bx, a * s.yb + b * s.yb + d * by);
  }
  for (let k = 1; k <= c.nS; k++) {
    const [x, y] = side(u0 + (1 - u0) * (1 - (1 - k / c.nS) ** 1.5));
    put(x, y);
  }
  // flank above the belt, the roof rail and the roof
  let dx = s.we - s.ws, dy = s.ye - s.ys;
  const gl = Math.hypot(dx, dy) || 1e-6;
  dx /= gl;
  dy /= gl;
  const slope = (2 * (s.yt - s.ye)) / Math.max(0.05, s.we), rl = Math.hypot(1, slope);
  const ce = Math.min(s.re ?? 0.05, gl * 0.45, s.we * 0.45);
  const e1x = s.we - dx * ce, e1y = s.ye - dy * ce, e2x = s.we - ce / rl, e2y = s.ye + (slope * ce) / rl;
  for (let k = 1; k <= c.nG; k++) {
    const t = 0.5 - 0.5 * Math.cos((Math.PI * k) / c.nG);
    put(lerp(s.ws, e1x, t), lerp(s.ys, e1y, t));
  }
  for (let k = 1; k <= c.nE; k++) {
    const t = k / c.nE, a = (1 - t) * (1 - t), b = 2 * t * (1 - t), d = t * t;
    put(a * e1x + b * s.we + d * e2x, a * e1y + b * s.ye + d * e2y);
  }
  const rise = Math.max(0, s.yt - e2y), pw = rise > 1e-4 ? clamp((slope * e2x) / rise, 1.2, 4) : 2;
  for (let k = 1; k <= c.nR; k++) {
    const f = 1 - k / c.nR;
    put(e2x * f, s.yt - rise * f ** pw);
  }
}

function stations(def: HullDef, q: number) {
  const base = 1 / ([5, 10, 15][q] * (def.density ?? 1));
  const zs = [def.z0];
  for (let z = def.z0; ; ) {
    const step = base * (Math.min(z - def.z0, def.z1 - z) < 0.3 ? 0.4 : 1);
    z += step;
    if (z >= def.z1 - step * 0.5) break;
    zs.push(z);
  }
  zs.push(def.z1);
  for (const b of def.breaks ?? []) {
    let k = 1;
    for (let i = 1; i < zs.length - 1; i++) if (Math.abs(zs[i] - b) < Math.abs(zs[k] - b)) k = i;
    if (Math.abs(zs[k] - b) < base * 0.6) zs[k] = b;
    else zs.push(b);
    zs.sort((a, c) => a - c);
  }
  return zs.filter((z, i) => i === 0 || z - zs[i - 1] > 1e-4);
}

const tint = new THREE.Color();
const mat3 = new THREE.Matrix3();
const v3 = new THREE.Vector3();

/** Collects a car into one geometry: positions, normals, RGBA vertex colours, atlas UVs, one bone per vertex, two material groups. */
export class CarBuilder {
  private pos: number[] = [];
  private nor: number[] = [];
  private col: number[] = [];
  private uvs: number[] = [];
  private skin: number[] = [];
  private idx: [number[], number[]] = [[], []];
  /** Detail level: 0 coarse, 1 fine, 2 finest. */
  readonly q: number;

  constructor(readonly atlas: Atlas, detail: ModelDetail) {
    this.q = detail;
  }

  private vert(x: number, y: number, z: number, nx: number, ny: number, nz: number, hex: number, glow: number, a: number, uv: [number, number], bone: number) {
    tint.setHex(hex);
    this.pos.push(x, y, z);
    this.nor.push(nx, ny, nz);
    this.col.push(tint.r * glow, tint.g * glow, tint.b * glow, a);
    this.uvs.push(uv[0], uv[1]);
    this.skin.push(bone);
    return this.skin.length - 1;
  }
  /** Adds a triangle, wound so that it faces the way its vertex normals point. */
  private tri(group: 0 | 1, a: number, b: number, c: number) {
    const p = this.pos, n = this.nor;
    const ux = p[b * 3] - p[a * 3], uy = p[b * 3 + 1] - p[a * 3 + 1], uz = p[b * 3 + 2] - p[a * 3 + 2];
    const vx = p[c * 3] - p[a * 3], vy = p[c * 3 + 1] - p[a * 3 + 1], vz = p[c * 3 + 2] - p[a * 3 + 2];
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
    if (fx * fx + fy * fy + fz * fz < 1e-16) return;
    const d = fx * (n[a * 3] + n[b * 3] + n[c * 3]) + fy * (n[a * 3 + 1] + n[b * 3 + 1] + n[c * 3 + 1]) + fz * (n[a * 3 + 2] + n[b * 3 + 2] + n[c * 3 + 2]);
    if (d < 0) this.idx[group].push(a, c, b);
    else this.idx[group].push(a, b, c);
  }

  /** A stock three.js geometry, optionally transformed. The geometry is consumed. */
  add(g: THREE.BufferGeometry, o: PartOpt, m?: THREE.Matrix4) {
    if (m) g.applyMatrix4(m);
    const gp = g.attributes.position, gn = g.attributes.normal, uv = this.atlas.swatch(o.fin ?? 'plastic');
    const base = this.skin.length;
    for (let i = 0; i < gp.count; i++)
      this.vert(gp.getX(i), gp.getY(i), gp.getZ(i), gn.getX(i), gn.getY(i), gn.getZ(i), o.color, o.glow ?? 1, o.alpha ?? 1, uv, o.bone ?? 0);
    const out = this.idx[o.group ?? 0];
    if (g.index) for (let i = 0; i < g.index.count; i++) out.push(base + g.index.getX(i));
    else for (let i = 0; i < gp.count; i++) out.push(base + i);
    g.dispose();
    return this;
  }
  /** Box (bevelled above the lowest detail), or with `cyl` a cylinder lying along X: size = [width, diameter, diameter]. */
  box(size: V3, pos: V3, o: PartOpt & { rot?: V3; round?: number; cyl?: boolean }) {
    const [w, h, d] = size, min = Math.min(w, h, d);
    let g: THREE.BufferGeometry;
    if (o.cyl) g = new THREE.CylinderGeometry(h / 2, h / 2, w, [14, 24, 36][this.q]).rotateZ(Math.PI / 2);
    else if (this.q === 0 || (min < 0.03 && o.round === undefined)) g = new THREE.BoxGeometry(w, h, d);
    else g = new RoundedBoxGeometry(w, h, d, this.q + 1, o.round !== undefined ? (min / 2) * o.round : Math.min(0.03, min * 0.3));
    const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...(o.rot ?? [0, 0, 0]))).setPosition(pos[0], pos[1], pos[2]);
    return this.add(g, o, m);
  }
  /**
   * Surface of revolution about the X axis from a profile of [radius, x] points.
   * Normals point away from the profile's centroid, or along `face` ([radial, axial]) when given.
   */
  revolve(profile: [number, number][], o: PartOpt & { segs?: number; face?: [number, number]; m?: THREE.Matrix4; arc?: [number, number] }) {
    const segs = o.segs ?? [16, 28, 40][this.q], n = profile.length;
    let cr = 0, ca = 0;
    for (const p of profile) { cr += p[0] / n; ca += p[1] / n; }
    // per-point normal in (radial, axial) space, averaged over the adjoining segments
    const nr: number[] = [], na: number[] = [];
    for (let i = 0; i < n; i++) {
      const p0 = profile[Math.max(0, i - 1)], p1 = profile[Math.min(n - 1, i + 1)];
      let r = p1[1] - p0[1], a = -(p1[0] - p0[0]);
      const l = Math.hypot(r, a) || 1;
      r /= l;
      a /= l;
      const want = o.face ? r * o.face[0] + a * o.face[1] : r * (profile[i][0] - cr) + a * (profile[i][1] - ca);
      if (want < 0) { r = -r; a = -a; }
      nr.push(r);
      na.push(a);
    }
    const uv = this.atlas.swatch(o.fin ?? 'plastic'), base = this.skin.length;
    if (o.m) mat3.getNormalMatrix(o.m);
    for (let s = 0; s <= segs; s++) {
      // angle 0 is straight up; `arc` limits the sweep (wheel housings only cover the top of the wheel)
      const th = o.arc ? lerp(o.arc[0], o.arc[1], s / segs) : (s / segs) * Math.PI * 2, cs = Math.cos(th), sn = Math.sin(th);
      for (let i = 0; i < n; i++) {
        let x = profile[i][1], y = profile[i][0] * cs, z = profile[i][0] * sn;
        let nx = na[i], ny = nr[i] * cs, nz = nr[i] * sn;
        if (o.m) {
          v3.set(x, y, z).applyMatrix4(o.m);
          x = v3.x; y = v3.y; z = v3.z;
          v3.set(nx, ny, nz).applyMatrix3(mat3).normalize();
          nx = v3.x; ny = v3.y; nz = v3.z;
        }
        this.vert(x, y, z, nx, ny, nz, o.color, o.glow ?? 1, o.alpha ?? 1, uv, o.bone ?? 0);
      }
    }
    for (let s = 0; s < segs; s++)
      for (let i = 0; i < n - 1; i++) {
        const a = base + s * n + i, b = a + n;
        this.tri(o.group ?? 0, a, b, b + 1);
        this.tri(o.group ?? 0, a, b + 1, a + 1);
      }
    return this;
  }

  /** Lofted body shell with its end faces, glass layer and inner lining. */
  hull(def: HullDef) {
    const zs = stations(def, this.q), N = zs.length, cnt = RING[this.q];
    const M = cnt.nB + cnt.nC + cnt.nS + cnt.nG + cnt.nE + cnt.nR, M1 = M + 1;
    const jSill = cnt.nB + cnt.nC / 2, jBelt = cnt.nB + cnt.nC + cnt.nS, jTop = jBelt + cnt.nG + cnt.nE / 2;
    const X: number[][] = [], Y: number[][] = [];
    for (let i = 0; i < N; i++) {
      X.push([]);
      Y.push([]);
      ring(def.sect(zs[i]), cnt, X[i], Y[i]);
    }
    const NX: number[][] = [], NY: number[][] = [], NZ: number[][] = [];
    for (let i = 0; i < N; i++) {
      NX.push([]); NY.push([]); NZ.push([]);
      const i0 = Math.max(i - 1, 0), i1 = Math.min(i + 1, N - 1);
      for (let j = 0; j <= M; j++) {
        const ux = X[i1][j] - X[i0][j], uy = Y[i1][j] - Y[i0][j], uz = zs[i1] - zs[i0];
        // across the centre line the neighbour is the mirror image
        const vx = (j === M ? -X[i][M - 1] : X[i][j + 1]) - (j === 0 ? -X[i][1] : X[i][j - 1]);
        const vy = (j === M ? Y[i][M - 1] : Y[i][j + 1]) - (j === 0 ? Y[i][1] : Y[i][j - 1]);
        let nx = vy * uz, ny = -vx * uz, nz = vx * uy - vy * ux;
        const l = Math.hypot(nx, ny, nz);
        if (l > 1e-9) { nx /= l; ny /= l; nz /= l; }
        else if (j > 0) { nx = NX[i][j - 1]; ny = NY[i][j - 1]; nz = NZ[i][j - 1]; }
        else { nx = 0; ny = -1; nz = 0; }
        NX[i].push(nx); NY[i].push(ny); NZ[i].push(nz);
      }
    }

    // end faces: each ring point is joined to the centre line at its own height
    const cols = CAP_COLS[this.q], K = cols.length;
    const caps = (['rear', 'front'] as const).map((end) => {
      const e = end === 'front' ? N - 1 : 0, dir = end === 'front' ? 1 : -1;
      const cd: CapDef = (end === 'front' ? def.capFront : def.capRear) ?? {};
      const fn = cd.bulge ?? (() => 0);
      const P: V3[][] = [], Nn: V3[][] = [];
      for (let j = 0; j <= M; j++) {
        P.push(cols.map((s) => [X[e][j] * s, Y[e][j], zs[e] + dir * (fn(X[e][j] * s, Y[e][j]) - fn(X[e][j], Y[e][j]))] as V3));
      }
      for (let j = 0; j <= M; j++) {
        Nn.push([]);
        for (let k = 0; k < K; k++) {
          const a = P[Math.min(j + 1, M)][k], b = P[Math.max(j - 1, 0)][k], c = P[j][Math.min(k + 1, K - 1)], d = P[j][Math.max(k - 1, 0)];
          const ux = a[0] - b[0], uy = a[1] - b[1], uz = a[2] - b[2], vx = c[0] - d[0], vy = c[1] - d[1], vz = c[2] - d[2];
          let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
          const l = Math.hypot(nx, ny, nz);
          if (l < 1e-9) { nx = 0; ny = 0; nz = dir; }
          else {
            const s = (nz * dir < 0 ? -1 : 1) / l;
            nx *= s; ny *= s; nz *= s;
          }
          if (k === 0) {
            // the edge is shared with the skin: blend the two normals so the corner shades as a soft radius
            nx += NX[e][j]; ny += NY[e][j]; nz += NZ[e][j];
            const b2 = Math.hypot(nx, ny, nz) || 1;
            nx /= b2; ny /= b2; nz /= b2;
            NX[e][j] = nx; NY[e][j] = ny; NZ[e][j] = nz;
          }
          Nn[j].push([nx, ny, nz]);
        }
      }
      return { end, e, cd, P, Nn };
    });

    const inRange = (z: number, r?: [number, number]) => !!r && z > r[0] && z < r[1];
    const cache = new Map<number, number>();
    type Style = { layer: number; group: 0 | 1; bone: number; view: View | null; fin: Finish; hex: number; alpha: number; off: number; flip: boolean };
    const corner = (sgn: number, id: number, p: V3, n: V3, a: number, b: number, st: Style) => {
      const key = ((st.layer * 2 + (sgn > 0 ? 1 : 0)) * 200000 + id) * 512 + st.bone * 8 + (st.view ? VIEW_ID[st.view] : 0);
      let v = cache.get(key);
      if (v === undefined) {
        const f = st.flip ? -1 : 1;
        // (a, b) are the view's own coordinates; from above b is the half-section's x, which the mirror image flips
        const uv = st.view ? this.atlas.uv(st.view, a, st.view === 'top' ? b * sgn : b) : this.atlas.swatch(st.fin);
        v = this.vert((p[0] - n[0] * st.off) * sgn, p[1] - n[1] * st.off, p[2] - n[2] * st.off, n[0] * f * sgn, n[1] * f, n[2] * f, st.hex, 1, st.alpha, uv, st.bone);
        cache.set(key, v);
      }
      return v;
    };
    const glassOf = (z: number, top: boolean) => def.glass?.(z, top) ?? [0x16212a, 0.5];

    for (const sgn of [1, -1]) {
      // --- skin
      for (let i = 0; i < N - 1; i++) {
        const zm = (zs[i] + zs[i + 1]) / 2;
        for (let j = 0; j < M; j++) {
          const bottom = j < jSill, top = j >= jTop;
          let bone = 0;
          if (!bottom && !top) for (const d of def.doors ?? []) if (d.side === sgn && zm > d.za && zm < d.zb) bone = d.bone;
          const view: View | null = bottom ? null : top ? 'top' : sgn > 0 ? 'L' : 'R';
          const styles: Style[] = [{ layer: 0, group: 0, bone, view, fin: 'plastic', hex: bottom ? UNDER : def.color, alpha: 1, off: 0, flip: false }];
          if ((top && (def.glassTop ?? []).some((r) => inRange(zm, r))) || (!top && j >= jBelt && inRange(zm, def.glassSide))) {
            const [hex, alpha] = glassOf(zm, top);
            styles.push({ layer: 1, group: 1, bone, view: null, fin: 'lens', hex, alpha, off: 0.012, flip: false });
          }
          if (!bottom && inRange(zm, def.cabin))
            styles.push({ layer: 2, group: 0, bone, view, fin: 'plastic', hex: top ? (def.headliner ?? 0x8f8f8a) : (def.trim ?? 0x1c1d20), alpha: INNER_A, off: 0.035, flip: true });
          for (const st of styles) {
            const q = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]].map(([a, b]) =>
              corner(sgn, a * M1 + b, [X[a][b], Y[a][b], zs[a]], [NX[a][b], NY[a][b], NZ[a][b]], zs[a], top ? X[a][b] : Y[a][b], st));
            this.tri(st.group, q[0], q[1], q[2]);
            this.tri(st.group, q[0], q[2], q[3]);
          }
        }
      }
      // --- end faces
      for (const cp of caps) {
        const { cd, P, Nn, end } = cp;
        for (let j = 0; j < M; j++) {
          const bone = cd.door && Math.min(P[j][0][1], P[j + 1][0][1]) >= cd.door.yMin ? cd.door.bone : 0;
          const view: View | null = cd.plain !== undefined ? null : end;
          const lay = end === 'front' ? 3 : 6;
          const styles: Style[] = [{ layer: lay, group: 0, bone, view, fin: 'paint', hex: cd.plain ?? def.color, alpha: 1, off: 0, flip: false }];
          if (cd.glass) {
            const [hex, alpha] = glassOf(P[j][0][2], false);
            styles.push({ layer: lay + 1, group: 1, bone, view: null, fin: 'lens', hex, alpha, off: 0.012, flip: false });
          }
          if (cd.inner) styles.push({ layer: lay + 2, group: 0, bone, view, fin: 'plastic', hex: def.trim ?? 0x1c1d20, alpha: INNER_A, off: 0.035, flip: true });
          for (const st of styles)
            for (let k = 0; k < K - 1; k++) {
              const q = [[j, k], [j + 1, k], [j + 1, k + 1], [j, k + 1]].map(([a, b]) => corner(sgn, a * K + b, P[a][b], Nn[a][b], P[a][b][0] * sgn, P[a][b][1], st));
              this.tri(st.group, q[0], q[1], q[2]);
              this.tri(st.group, q[0], q[2], q[3]);
            }
        }
      }
    }
    return this;
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 4));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    const n = this.skin.length, si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      si[i * 4] = this.skin[i];
      sw[i * 4] = 1;
    }
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    g.setIndex(this.idx[0].concat(this.idx[1]));
    g.addGroup(0, this.idx[0].length, 0);
    g.addGroup(this.idx[0].length, this.idx[1].length, 1);
    g.computeBoundingSphere();
    return g;
  }
}

// ------------------------------------------------------------------ assets
export interface CarDef {
  /** Kinds with the same key share their textures (the Prius and the taxi). */
  key: string;
  extent: Extent;
  rig: Rig;
  paint(p: Paint): void;
  build(b: CarBuilder, color: number): void;
}
export interface CarAssets {
  geometry: THREE.BufferGeometry;
  materials: THREE.Material[];
  wreck: THREE.Material[];
  rig: Rig;
  sphere: THREE.Sphere;
}

const TEX_MAX = [1024, 2048, 3072];
/** Tinted glass, shared by every car: per-vertex colour and opacity. */
export const glassMaterial = new THREE.MeshPhysicalMaterial({
  vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, roughness: 0.04, metalness: 0, envMapIntensity: 2.2,
});
const hidden = new THREE.MeshBasicMaterial({ visible: false });

interface Skin {
  def: CarDef;
  atlas: Atlas;
  color: HTMLCanvasElement;
  crm: HTMLCanvasElement;
  map: THREE.CanvasTexture;
  crmMap: THREE.CanvasTexture;
  shell: THREE.MeshPhysicalMaterial;
  wreck: THREE.MeshStandardMaterial;
}
const skins = new Map<string, Skin>();
const built = new Map<string, { def: CarDef; color: number; assets: CarAssets }>();

function drawSkin(s: Skin) {
  const max = TEX_MAX[modelDetail()], a = s.atlas;
  const ppm = Math.min(max / Math.max(a.W, a.H), 460), ppmM = ppm / 2;
  s.color.width = Math.round(a.W * ppm);
  s.color.height = Math.round(a.H * ppm);
  s.crm.width = Math.round(a.W * ppmM);
  s.crm.height = Math.round(a.H * ppmM);
  const p = new Paint(a, s.color, s.crm, ppm, ppmM);
  s.def.paint(p);
  p.done();
}

function shellMaterial(map: THREE.Texture, crm: THREE.Texture) {
  const m = new THREE.MeshPhysicalMaterial({
    vertexColors: true, map, roughnessMap: crm, metalnessMap: crm, clearcoatMap: crm,
    roughness: 1, metalness: 1, clearcoat: 1, clearcoatRoughness: 0.06, alphaTest: 0.3, alphaToCoverage: true,
  });
  // texture alpha between the cut-off and 1 says how much of the car's own paint colour to take;
  // vertex alpha below 0.5 marks the inner lining, which keeps its own flat colour
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <color_fragment>', `
        float paintMask = clamp( ( 1.0 - diffuseColor.a ) * 2.5, 0.0, 1.0 );
        bool lining = vColor.a < 0.5;
        diffuseColor.rgb = lining ? vColor.rgb : diffuseColor.rgb * mix( vec3( 1.0 ), vColor.rgb, paintMask );`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n if ( lining ) roughnessFactor = 0.92;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n if ( lining ) metalnessFactor = 0.0;')
      .replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\n #ifdef USE_CLEARCOAT\n if ( lining ) material.clearcoat = 0.0;\n #endif');
  };
  return m;
}

function skinOf(def: CarDef): Skin {
  let s = skins.get(def.key);
  if (s) return s;
  const color = document.createElement('canvas'), crm = document.createElement('canvas');
  const map = new THREE.CanvasTexture(color), crmMap = new THREE.CanvasTexture(crm);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  crmMap.anisotropy = 4;
  s = {
    def, atlas: new Atlas(def.extent), color, crm, map, crmMap,
    shell: shellMaterial(map, crmMap),
    wreck: new THREE.MeshStandardMaterial({ vertexColors: true, map, color: 0x2b2826, roughness: 1, metalness: 0, alphaTest: 0.3 }),
  };
  drawSkin(s);
  tune(s);
  skins.set(def.key, s);
  return s;
}
/** Without sky reflections (lowest quality) metal and clear coat would only go dark. */
function tune(s: Skin) {
  const d = modelDetail();
  s.shell.metalness = d ? 1 : 0.3;
  s.shell.clearcoat = d ? 1 : 0;
  s.shell.needsUpdate = true;
}

function geometryOf(def: CarDef, color: number, atlas: Atlas) {
  const b = new CarBuilder(atlas, modelDetail());
  def.build(b, color);
  const g = b.build();
  // doors swing outside the rest shape
  g.boundingSphere!.radius += 1.3;
  return g;
}

/** Geometry, materials and rig of a car; shared by every car of that kind and colour. */
export function carAssets(def: CarDef, variant: string, color: number): CarAssets {
  const key = variant + '#' + color;
  let e = built.get(key);
  if (!e) {
    const s = skinOf(def), geometry = geometryOf(def, color, s.atlas);
    e = { def, color, assets: { geometry, materials: [s.shell, glassMaterial], wreck: [s.wreck, hidden], rig: def.rig, sphere: geometry.boundingSphere!.clone() } };
    built.set(key, e);
  }
  return e.assets;
}

/** A skinned mesh of the car with its own skeleton (bone order follows the rig). */
export function rigMesh(a: CarAssets) {
  const mesh = new THREE.SkinnedMesh(a.geometry, a.materials);
  const bones = a.rig.bones.map(() => new THREE.Bone());
  const inverses = a.rig.bones.map((d, i) => {
    const par = d.parent < 0 ? null : a.rig.bones[d.parent];
    bones[i].position.set(d.pos[0] - (par ? par.pos[0] : 0), d.pos[1] - (par ? par.pos[1] : 0), d.pos[2] - (par ? par.pos[2] : 0));
    (par ? bones[d.parent] : mesh).add(bones[i]);
    return new THREE.Matrix4().makeTranslation(-d.pos[0], -d.pos[1], -d.pos[2]);
  });
  mesh.bind(new THREE.Skeleton(bones, inverses), new THREE.Matrix4());
  // the default would walk every vertex through its bone on first draw; the rest pose (plus door swing) is enough
  mesh.boundingSphere = a.sphere;
  mesh.castShadow = true;
  return { mesh, bones };
}

onModelDetail(() => {
  for (const s of skins.values()) {
    drawSkin(s);
    for (const t of [s.map, s.crmMap]) {
      t.dispose(); // the size changes, so the GPU texture has to be recreated
      t.needsUpdate = true;
    }
    tune(s);
  }
  for (const e of built.values()) {
    const fresh = geometryOf(e.def, e.color, skinOf(e.def).atlas), g = e.assets.geometry;
    g.dispose();
    for (const name of Object.keys(fresh.attributes)) g.setAttribute(name, fresh.attributes[name]);
    g.setIndex(fresh.index);
    g.clearGroups();
    for (const gr of fresh.groups) g.addGroup(gr.start, gr.count, gr.materialIndex);
    g.boundingSphere = fresh.boundingSphere;
  }
});
