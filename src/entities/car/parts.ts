import * as THREE from 'three';
import { CarBuilder, Paint, Path, FIN, Sect, V3, rect, circle, poly, GOTHIC, SANS } from './CarKit';

/** Parts shared by the road cars: wheels, seats, mirrors, and the drawing helpers for their painted skins. */

type Fn = (z: number) => number;
/** Body shape as curves along the length: roof line, belt line, plan outline, roof width and underside. */
export interface Body {
  z0: number;
  z1: number;
  top: Fn;
  belt: Fn;
  halfW: Fn;
  roofW: Fn;
  floor: Fn;
  /** How far the roof (or bonnet) edge sits below its centre line. */
  crown: number;
  /** How far the belt line is drawn in from the widest point. */
  tuck: number;
  rb?: number;
  re?: number;
}
export const sectOf = (B: Body) => (z: number): Sect => {
  const w = B.halfW(z), yt = B.top(z), ye = yt - B.crown, ys = Math.min(B.belt(z), ye - 0.02), ws = w - B.tuck;
  return { yb: Math.min(B.floor(z), ys - 0.1), wb: w - 0.05, w, ys, ws, ye, we: Math.min(B.roofW(z), ws - 0.03), yt, rb: B.rb ?? 0.06, re: B.re ?? 0.05 };
};

const M4 = () => new THREE.Matrix4();
const INK = 'rgba(0,0,0,0.82)';

// ------------------------------------------------------------------ wheels
export interface WheelSpec {
  d: number; // tyre diameter
  w: number; // tyre width
  rim: number; // rim diameter
  style: 'alloy' | 'twin' | 'steel' | 'truck';
  /** Twin tyres on a dished wheel (lorry rear axle). */
  dual?: boolean;
}

/** A wheel centred on `at` with its outer face towards `side`; every vertex follows the spin bone. */
export function wheel(b: CarBuilder, at: V3, side: number, bone: number, s: WheelSpec) {
  const m = M4().makeRotationY(side > 0 ? 0 : Math.PI).setPosition(at[0], at[1], at[2]);
  const R = s.d / 2, rr = s.rim / 2, hw = s.w / 2, xF = hw * 0.5;
  const tyre = (dx: number): [number, number][] => [
    [rr, dx - hw * 0.8], [rr + (R - rr) * 0.55, dx - hw], [R - 0.028, dx - hw * 0.9], [R, dx - hw * 0.62],
    [R, dx + hw * 0.62], [R - 0.028, dx + hw * 0.9], [rr + (R - rr) * 0.55, dx + hw], [rr, dx + hw * 0.8],
  ];
  b.revolve(tyre(0), { color: 0x151517, fin: 'rubber', bone, m });
  if (s.dual) b.revolve(tyre(-s.w - 0.04), { color: 0x151517, fin: 'rubber', bone, m });
  // tread grooves: thin darker rings standing just proud of the tread
  for (const gx of [-0.3, 0, 0.3]) b.revolve([[R + 0.001, (gx - 0.035) * s.w], [R + 0.001, (gx + 0.035) * s.w]], { color: 0x060607, fin: 'rubber', bone, m, face: [1, 0] });
  b.revolve([[rr, -hw * 0.8], [rr, hw * 0.8]], { color: 0x33363b, fin: 'alloy', bone, m, face: [-1, 0] }); // barrel
  b.revolve([[rr - 0.03, hw * 0.74], [rr - 0.008, hw * 0.84], [rr + 0.004, hw * 0.8]], { color: s.style === 'steel' || s.style === 'truck' ? 0xd2d5d8 : 0xc4c8ce, fin: 'alloy', bone, m, face: [0, 1] }); // lip

  const spoke = (ang: number, r0: number, r1: number, wid: number, x: number, color: number, thick = 0.028) =>
    b.add(new THREE.BoxGeometry(thick, r1 - r0, wid), { color, fin: 'alloy', bone }, M4().copy(m).multiply(M4().makeRotationX(ang)).multiply(M4().makeTranslation(x, (r0 + r1) / 2, 0)));
  if (s.style === 'alloy' || s.style === 'twin') {
    const twin = s.style === 'twin', n = twin ? 5 : 10;
    b.revolve([[0.04, xF - 0.06], [rr * 0.74, xF - 0.06]], { color: 0x4a4d52, fin: 'steel', bone, m, face: [0, 1] }); // brake disc
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      if (twin) {
        // machined twin spokes over dark pockets
        spoke(a - 0.13, 0.05, rr * 0.985, 0.036, xF, 0xd4d7db);
        spoke(a + 0.13, 0.05, rr * 0.985, 0.036, xF, 0xd4d7db);
        spoke(a, 0.05, rr * 0.9, 0.1, xF - 0.012, 0x232528);
      } else spoke(a, 0.05, rr * 0.985, 0.05, xF, 0xc9ccd1);
    }
    b.revolve([[0, xF + 0.03], [0.055, xF + 0.03], [0.085, xF + 0.012], [0.09, xF - 0.02]], { color: twin ? 0x2a2c30 : 0xc9ccd1, fin: 'alloy', bone, m, face: [0.3, 1] });
  } else if (s.style === 'steel') {
    b.revolve([[0.05, xF + 0.035], [rr * 0.4, xF + 0.035], [rr * 0.55, xF - 0.015], [rr * 0.9, xF - 0.01], [rr - 0.02, xF + 0.03]], { color: 0xcfd2d6, fin: 'steel', bone, m, face: [0, 1] });
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      b.add(new THREE.CylinderGeometry(0.026, 0.026, 0.01, 10).rotateZ(Math.PI / 2), { color: 0x101113, fin: 'rubber', bone },
        M4().copy(m).multiply(M4().makeRotationX(a)).multiply(M4().makeTranslation(xF - 0.008, rr * 0.73, 0)));
    }
    b.revolve([[0, xF + 0.075], [0.05, xF + 0.068], [0.085, xF + 0.035]], { color: 0xe4e6e8, fin: 'chrome', bone, m, face: [0.3, 1] });
  } else {
    // lorry: the front wheel carries a proud hub, the twin rear wheel is dished inwards
    const o = s.dual ? -hw * 0.9 : xF + 0.04;
    b.revolve([[0.16, o], [rr * 0.62, o - 0.01], [rr * 0.92, xF - 0.04], [rr - 0.02, xF + 0.02]], { color: 0xd3d6d9, fin: 'steel', bone, m, face: [0, 1] });
    b.revolve([[0, o + 0.13], [0.1, o + 0.13], [0.13, o + 0.09], [0.16, o]], { color: s.dual ? 0x8c1416 : 0xc9ccd0, fin: 'paint', bone, m, face: [0.4, 1] });
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      b.add(new THREE.CylinderGeometry(0.018, 0.018, 0.04, 8).rotateZ(Math.PI / 2), { color: 0xe2e4e6, fin: 'chrome', bone },
        M4().copy(m).multiply(M4().makeRotationX(a)).multiply(M4().makeTranslation(o + 0.02, 0.215, 0)));
    }
  }
}

/** Dark housing over a wheel, so the arch opening does not look into the cabin. */
export function wheelWell(b: CarBuilder, side: number, at: V3, r: number, depth: number) {
  const m = M4().makeRotationY(side > 0 ? 0 : Math.PI).setPosition(at[0], at[1], at[2]);
  b.revolve([[r, -depth], [r, 0.0]], { color: 0x0b0b0c, fin: 'rubber', m, face: [-1, 0], arc: [-1.9, 1.9], segs: [10, 16, 22][b.q] });
  b.box([0.02, r * 1.5, r * 2], [at[0] - side * depth, at[1] + r * 0.3, at[2]], { color: 0x0b0b0c, fin: 'rubber' });
}

// ------------------------------------------------------------------ cabin
export function seat(b: CarBuilder, x: number, y: number, z: number, color: number, w = 0.5, bone = 0) {
  b.box([w, 0.15, 0.5], [x, y, z], { color, fin: 'fabric', round: 0.7, bone });
  b.box([w, 0.62, 0.14], [x, y + 0.34, z - 0.29], { color, fin: 'fabric', round: 0.7, rot: [-0.2, 0, 0], bone });
  b.box([w * 0.5, 0.19, 0.1], [x, y + 0.75, z - 0.38], { color, fin: 'fabric', round: 0.8, rot: [-0.1, 0, 0], bone });
}

/** Dashboard, steering wheel on the right (Japan drives on the left) and the driver, who rides on their own bone. */
export function cockpit(b: CarBuilder, o: { seat: V3; dashZ: number; dashY: number; hw: number; driver: number; color?: number }) {
  const [sx, sy, sz] = o.seat, dark = o.color ?? 0x17181b;
  b.box([o.hw * 2, 0.26, 0.42], [0, o.dashY, o.dashZ], { color: dark, fin: 'plastic', round: 0.5 });
  b.box([0.34, 0.1, 0.05], [sx, o.dashY + 0.16, o.dashZ - 0.14], { color: 0x0b0c0e, fin: 'plastic', round: 0.5 }); // instrument binnacle
  b.box([0.3, 0.18, 0.03], [0, o.dashY + 0.12, o.dashZ - 0.2], { color: 0x10202c, fin: 'lens', round: 0.2, glow: 1.4 }); // centre screen
  const wz = o.dashZ - 0.3, wy = o.dashY + 0.1;
  // the column runs forwards and down, so the rim leans away from the driver at the top
  const m = new THREE.Matrix4().makeRotationX(0.42).multiply(new THREE.Matrix4().makeRotationY(-Math.PI / 2)).setPosition(sx, wy, wz);
  const tube: [number, number][] = [];
  for (let k = 0; k <= 8; k++) tube.push([0.175 + 0.017 * Math.cos((k / 8) * Math.PI * 2), 0.017 * Math.sin((k / 8) * Math.PI * 2)]);
  b.revolve(tube, { color: 0x0d0e10, fin: 'plastic', m, segs: [12, 20, 28][b.q] });
  b.box([0.34, 0.035, 0.03], [sx, wy, wz], { color: 0x0d0e10, fin: 'plastic', rot: [0.42, 0, 0] });
  b.box([0.07, 0.07, 0.26], [sx, wy - 0.05, wz + 0.12], { color: 0x0d0e10, fin: 'plastic', rot: [0.42, 0, 0] });
  // driver: torso, head, hair and arms reaching for the wheel
  const d = o.driver;
  if (d < 0) return;
  b.box([0.42, 0.5, 0.24], [sx, sy + 0.4, sz - 0.14], { color: 0x2c3644, fin: 'fabric', round: 0.6, rot: [-0.14, 0, 0], bone: d });
  b.add(new THREE.SphereGeometry(0.105, 14, 10), { color: 0xd9a47a, fin: 'fabric', bone: d }, new THREE.Matrix4().makeTranslation(sx, sy + 0.8, sz - 0.16));
  b.add(new THREE.SphereGeometry(0.11, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), { color: 0x16130f, fin: 'fabric', bone: d }, new THREE.Matrix4().makeRotationX(-0.35).setPosition(sx, sy + 0.815, sz - 0.175));
  for (const s of [-1, 1]) {
    const len = Math.hypot(wy - (sy + 0.52), wz - sz + 0.1), ang = Math.atan2(wy - (sy + 0.52), wz - sz + 0.1);
    b.box([0.085, 0.085, len], [sx + s * 0.19, (sy + 0.52 + wy) / 2, (sz - 0.1 + wz) / 2], { color: 0x2c3644, fin: 'fabric', round: 0.8, rot: [-ang, 0, 0], bone: d });
  }
  b.box([0.34, 0.14, 0.42], [sx, sy + 0.12, sz + 0.12], { color: 0x1b1f28, fin: 'fabric', round: 0.7, bone: d }); // thighs
}

/** Door mirror on its foot; it follows the door. */
export function mirror(b: CarBuilder, side: number, at: V3, bone: number, color: number, size: V3 = [0.2, 0.13, 0.09]) {
  b.box([0.1, 0.03, 0.07], [at[0] + side * 0.04, at[1] - 0.05, at[2]], { color: 0x0b0c0e, fin: 'plastic', bone });
  b.box(size, [at[0] + side * (0.05 + size[0] / 2), at[1], at[2]], { color, fin: 'paint', round: 0.8, bone });
  b.box([size[0] * 0.82, size[1] * 0.74, 0.01], [at[0] + side * (0.05 + size[0] / 2), at[1], at[2] - size[2] / 2 - 0.002], { color: 0xaab4bc, fin: 'chrome', bone });
}

/** A row of short lamp segments following a curved nose or tail: z is given as a function of x. */
export function lampStrip(b: CarBuilder, x0: number, x1: number, y: number, z: (x: number) => number, size: [number, number], color: number, glow: number, n = 4, fin: 'lens' | 'chrome' | 'gloss' = 'lens') {
  for (let k = 0; k < n; k++) {
    const xa = x0 + ((x1 - x0) * k) / n, xb = x0 + ((x1 - x0) * (k + 1)) / n, xm = (xa + xb) / 2;
    const len = Math.hypot(xb - xa, z(xb) - z(xa));
    b.box([len * 1.04, size[0], size[1]], [xm, y, z(xm)], { color, fin, glow, rot: [0, -Math.atan2(z(xb) - z(xa), xb - xa), 0] });
  }
}

/** Half width of the skin at height y on station z (the flank, then the glasshouse above the belt). */
export function flankX(sect: (z: number) => Sect, z: number, y: number) {
  const s = sect(z);
  if (y >= s.ys) return s.ws + (s.we - s.ws) * Math.min(1, (y - s.ys) / Math.max(1e-3, s.ye - s.ys));
  const u = Math.max(0, (y - s.yb) / Math.max(1e-3, s.ys - s.yb));
  return s.wb + (s.ws - s.wb) * u + Math.max(0, s.w - (s.wb + s.ws) / 2) * Math.sin(Math.PI * u) ** 0.9;
}
/** Lamp segments laid on the flank from za to zb at height y(z): the part of a lamp that wraps round the corner. */
export function flankStrip(b: CarBuilder, sect: (z: number) => Sect, side: number, za: number, zb: number, y: (z: number) => number, size: [number, number], color: number, glow: number, n = 3, fin: 'lens' | 'chrome' | 'gloss' = 'lens') {
  const at = (z: number) => side * (flankX(sect, z, y(z)) + size[1] * 0.3);
  for (let k = 0; k < n; k++) {
    const z0 = za + ((zb - za) * k) / n, z1 = za + ((zb - za) * (k + 1)) / n, zm = (z0 + z1) / 2;
    const dx = at(z1) - at(z0), dz = z1 - z0;
    b.box([Math.hypot(dx, dz) * 1.04, size[0], size[1]], [at(zm), y(zm), zm], { color, fin, glow, rot: [0, Math.atan2(-dz, dx), 0] });
  }
}

// ------------------------------------------------------------------ drawing
/** Closed band between `lo` above the belt line and `hi` below the roof edge, from za to zb (side windows). */
export function sideBand(sect: (z: number) => Sect, za: number, zb: number, lo: number, hi: number, maxY = Infinity): Path {
  return (c) => {
    const n = 40;
    for (let k = 0; k <= n; k++) {
      const z = za + ((zb - za) * k) / n, s = sect(z);
      if (k) c.lineTo(z, s.ys + lo);
      else c.moveTo(z, s.ys + lo);
    }
    for (let k = n; k >= 0; k--) {
      const z = za + ((zb - za) * k) / n, s = sect(z);
      c.lineTo(z, Math.max(Math.min(s.ye - hi, maxY), s.ys + lo));
    }
    c.closePath();
  };
}
/** Screen outline seen from above: between za and zb, `inset` inside the roof edge on both sides. */
export function topBand(sect: (z: number) => Sect, za: number, zb: number, inset: number): Path {
  return (c) => {
    const n = 24;
    for (let k = 0; k <= n; k++) {
      const z = za + ((zb - za) * k) / n, x = sect(z).we - inset;
      if (k) c.lineTo(z, x);
      else c.moveTo(z, x);
    }
    for (let k = n; k >= 0; k--) {
      const z = za + ((zb - za) * k) / n;
      c.lineTo(z, -(sect(z).we - inset));
    }
    c.closePath();
  };
}
/** Strip along the underside between za and zb, `h` tall (sills, bumper valances). */
export function sillBand(sect: (z: number) => Sect, za: number, zb: number, h: number): Path {
  return (c) => {
    const n = 24;
    for (let k = 0; k <= n; k++) {
      const z = za + ((zb - za) * k) / n;
      if (k) c.lineTo(z, sect(z).yb - 0.02);
      else c.moveTo(z, sect(z).yb - 0.02);
    }
    for (let k = n; k >= 0; k--) {
      const z = za + ((zb - za) * k) / n;
      c.lineTo(z, sect(z).yb + h);
    }
    c.closePath();
  };
}
/** Opening with its rubber seal. */
export function windowCut(p: Paint, path: Path, seal = 0.035) {
  p.line(path, seal, '#07080a', FIN.rubber);
  p.hole(path);
}
/** Wheel-arch opening, optionally with a black moulding round it. */
export function arch(p: Paint, z: number, y: number, r: number, lip = 0) {
  if (lip) p.put(circle(z, y, r + lip), '#0b0b0c', FIN.plastic);
  p.hole(circle(z, y, r));
}
/** Shut line between panels. */
export function seam(p: Paint, pts: [number, number][], w = 0.009) {
  p.line(poly(pts, false), w, INK);
}
/** Japanese number plate centred on (x, y). */
export function plate(p: Paint, x: number, y: number, top: string, kana: string, num: string, o: { big?: boolean; green?: boolean } = {}) {
  const w = o.big ? 0.44 : 0.33, h = o.big ? 0.22 : 0.165, ink = o.green ? '#f1f1ea' : '#0f4a2c';
  p.put(rect(x - w / 2 - 0.006, y - h / 2 - 0.006, w + 0.012, h + 0.012, 0.014), '#6f7276', FIN.steel);
  p.put(rect(x - w / 2, y - h / 2, w, h, 0.01), o.green ? '#0f5a34' : '#f4f4ee', FIN.plastic);
  p.text(top, x, y + h * 0.27, h * 0.17, ink, { font: GOTHIC });
  p.text(kana, x - w * 0.39, y - h * 0.15, h * 0.17, ink, { font: GOTHIC });
  p.text(num, x + w * 0.06, y - h * 0.15, h * 0.36, ink, { font: SANS });
}
