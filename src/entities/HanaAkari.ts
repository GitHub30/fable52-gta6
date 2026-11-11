import * as THREE from 'three';
import { Surf, xf, at, range } from './A321';

/**
 * JR West "Hana Akari" sightseeing train (KiHa 189 series): lacquer-dark cars with gold arabesque
 * along the skirt line and a gold band beneath it. Three cars: cab car, intermediate car, cab car.
 * Modelled in real metres, each car centred on its own origin with the cab towards +Z and the
 * rail head at y = 0. The shell is one lofted surface per side, wrapped in a painted livery.
 */

type V3 = [number, number, number];
export const CAR_LEN = 20.8;
export const CAR_PITCH = 21.3; // centre to centre, including the gangway
export const BOGIE = 7.1; // bogie centres from the middle of the car
const HALF = CAR_LEN / 2, HW = 1.45;
const SILL = 0.95, EAVE = 3.15, CROWN = 3.74; // heights above the rail
const WALL = EAVE - SILL, CURVE = (Math.PI / 2) * 0.45, ROOF = 1.02;
const GIRTH = WALL + CURVE + ROOF; // half the unrolled cross-section
const PPM = 96;
const GOLD = '#e6b312', BODY = '#231a15';
const SANS = 'Arial, "Helvetica Neue", Helvetica, sans-serif';
const BRUSH = '"Yu Mincho","YuMincho","Hiragino Mincho ProN","HGS行書体","MS PMincho",serif';

/** Half cross-section: distance `a` along the skin from the sill up to the roof centre line -> [x, y]. */
function profile(a: number): [number, number] {
  if (a <= WALL) return [HW, SILL + a];
  if (a <= WALL + CURVE) {
    const t = (a - WALL) / 0.45;
    return [HW - 0.45 + 0.45 * Math.cos(t), EAVE + 0.45 * Math.sin(t)];
  }
  const f = Math.min(1, (a - WALL - CURVE) / ROOF);
  return [(HW - 0.45) * (1 - f), EAVE + 0.45 + (CROWN - EAVE - 0.45) * (1 - (1 - f) * (1 - f))];
}
/** How far the shell is drawn in at station z: the cab end is rounded in plan and falls away at the roof. */
function inset(z: number, cab: boolean) {
  const t = (z - (HALF - 0.3)) / 0.3;
  return cab && t > 0 ? 0.2 * (1 - Math.sqrt(Math.max(0, 1 - t * t))) : 0;
}
function shell(side: number, z: number, a: number, cab: boolean): V3 {
  const [x, y] = profile(a), k = inset(z, cab);
  return [side * x * (1 - k / HW), y - k * 0.7 * Math.max(0, (y - 2.9) / (CROWN - 2.9)), z];
}

// ------------------------------------------------------------------ painting
/** Draws in metres (y up) on the colour canvas and on the mask of what glows at night. */
class Paint {
  readonly c: CanvasRenderingContext2D;
  readonly m: CanvasRenderingContext2D;
  constructor(readonly canvas: HTMLCanvasElement, readonly mask: HTMLCanvasElement) {
    this.c = canvas.getContext('2d')!;
    this.m = mask.getContext('2d')!;
  }
  /** Map metres to pixels: `ox`, `oy` are the pixel position of the origin, `flip` mirrors x. */
  frame(ox: number, oy: number, flip = false) {
    for (const ctx of [this.c, this.m]) ctx.setTransform(flip ? -PPM : PPM, 0, 0, -PPM, ox, oy);
  }
  rect(x: number, y: number, w: number, h: number, color: string | CanvasGradient, glow = 0, radius = 0) {
    const v = Math.round(glow * 255);
    for (const [ctx, fill] of [[this.c, color], [this.m, `rgb(${v},${v},${v})`]] as [CanvasRenderingContext2D, string | CanvasGradient][]) {
      ctx.beginPath();
      if (radius) ctx.roundRect(x, y, w, h, radius);
      else ctx.rect(x, y, w, h);
      ctx.fillStyle = fill;
      ctx.fill();
    }
  }
  grad(y0: number, y1: number, bottom: string, top: string) {
    const g = this.c.createLinearGradient(0, y0, 0, y1);
    g.addColorStop(0, bottom);
    g.addColorStop(1, top);
    return g;
  }
  /** Upright text centred on (x, y); `vertical` stacks the characters downwards. Text is never mirrored. */
  text(str: string, x: number, y: number, size: number, color: string, font: string, vertical = false) {
    const c = this.c, t = c.getTransform();
    const px = t.a * x + t.e, py = t.d * y + t.f;
    c.save();
    c.setTransform(1, 0, 0, 1, px, py);
    c.font = font.replace('#', String(size * PPM));
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = color;
    if (vertical) [...str].forEach((ch, i) => c.fillText(ch, 0, i * size * PPM * 1.02));
    else c.fillText(str, 0, 0);
    c.restore();
  }
}

function flower(c: CanvasRenderingContext2D, x: number, y: number, r: number) {
  c.beginPath();
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2 + 0.3;
    c.moveTo(x + Math.cos(a) * r * 0.55 + r * 0.5, y + Math.sin(a) * r * 0.55);
    c.arc(x + Math.cos(a) * r * 0.55, y + Math.sin(a) * r * 0.55, r * 0.5, 0, Math.PI * 2);
  }
  c.fill();
  c.save();
  c.fillStyle = BODY;
  c.beginPath();
  c.arc(x, y, r * 0.22, 0, Math.PI * 2);
  c.fill();
  c.restore();
}
function leaf(c: CanvasRenderingContext2D, x: number, y: number, r: number, ang: number) {
  c.save();
  c.translate(x, y);
  c.rotate(ang);
  c.beginPath();
  c.moveTo(0, 0);
  c.quadraticCurveTo(r * 0.55, r * 0.5, r, 0);
  c.quadraticCurveTo(r * 0.55, -r * 0.5, 0, 0);
  c.fill();
  c.restore();
}
/** A curl of stem that winds inwards from (x, y). */
function curl(c: CanvasRenderingContext2D, x: number, y: number, r: number, turn: number, start: number) {
  c.beginPath();
  for (let k = 0; k <= 26; k++) {
    const u = k / 26, a = start + turn * u * 4.4, q = r * (1 - u * 0.82);
    const px = x + Math.cos(a) * q - Math.cos(start) * r, py = y + Math.sin(a) * q - Math.sin(start) * r;
    if (k) c.lineTo(px, py);
    else c.moveTo(px, py);
  }
  c.stroke();
}
/** Gold arabesque standing on y = base between x0 and x1: paired scrolls with blossoms, as on the real cars. */
function arabesque(c: CanvasRenderingContext2D, x0: number, x1: number, base: number, h: number, seed: number) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  c.save();
  c.strokeStyle = c.fillStyle = GOLD;
  c.lineCap = 'round';
  const step = h * 0.7; // scrolls stand close enough to interlock
  for (let x = x0 + step / 2; x < x1; x += step) {
    const k = 0.85 + rnd() * 0.3;
    c.lineWidth = h * 0.05;
    // stem with two scrolls turning away from each other
    c.beginPath();
    c.moveTo(x, base);
    c.quadraticCurveTo(x + h * 0.04, base + h * 0.3 * k, x, base + h * 0.5 * k);
    c.stroke();
    curl(c, x, base + h * 0.5 * k, h * 0.2 * k, 1, Math.PI);
    curl(c, x, base + h * 0.5 * k, h * 0.2 * k, -1, 0);
    c.lineWidth = h * 0.035;
    curl(c, x - h * 0.3, base + h * 0.05, h * 0.13, -1, 0);
    curl(c, x + h * 0.3, base + h * 0.05, h * 0.13, 1, Math.PI);
    flower(c, x, base + h * (0.72 + rnd() * 0.16) * k, h * 0.11);
    leaf(c, x - h * 0.06, base + h * 0.22, h * 0.2, 2.4);
    leaf(c, x + h * 0.06, base + h * 0.3, h * 0.2, 0.7);
    if (rnd() < 0.6) flower(c, x + step * 0.5, base + h * (0.2 + rnd() * 0.25), h * 0.07);
    leaf(c, x + step * 0.5, base, h * 0.16, Math.PI / 2 + (rnd() - 0.5));
  }
  c.restore();
}
/** A tall flowering stem rising from (x, base). */
function sprig(c: CanvasRenderingContext2D, x: number, base: number, h: number, lean: number) {
  c.save();
  c.strokeStyle = c.fillStyle = GOLD;
  c.lineCap = 'round';
  c.lineWidth = 0.022;
  c.beginPath();
  c.moveTo(x, base);
  c.bezierCurveTo(x + lean * 0.5, base + h * 0.3, x - lean * 0.6, base + h * 0.6, x + lean * 0.25, base + h);
  c.stroke();
  flower(c, x + lean * 0.25, base + h + 0.05, 0.085);
  flower(c, x - lean * 0.25, base + h * 0.62, 0.065);
  leaf(c, x + lean * 0.15, base + h * 0.3, 0.16, lean > 0 ? 0.5 : 2.6);
  leaf(c, x - lean * 0.1, base + h * 0.78, 0.12, lean > 0 ? 2.4 : 0.7);
  c.restore();
}

function glass(p: Paint, x: number, y: number, w: number, h: number, lit: number, curtains = true) {
  p.rect(x - 0.035, y - 0.035, w + 0.07, h + 0.07, '#0c0a09', 0, 0.1); // gasket
  p.rect(x, y, w, h, p.grad(y, y + h, '#3b3327', '#151d24'), lit, 0.07);
  if (curtains) {
    // drawn-back curtains, table lamps and seat backs: what shows of the saloon from outside
    p.rect(x, y, w * 0.12, h, '#b8a78a', lit * 0.9, 0.05);
    p.rect(x + w * 0.88, y, w * 0.12, h, '#b8a78a', lit * 0.9, 0.05);
    p.rect(x + w * 0.2, y, w * 0.6, h * 0.3, '#5b3a2a', lit * 0.7);
    p.rect(x + w * 0.46, y + h * 0.3, w * 0.08, h * 0.16, '#ffdc9a', 1, 0.03);
  }
  const sheen = p.c.createLinearGradient(0, y + h, 0, y);
  sheen.addColorStop(0, 'rgba(170,200,225,0.34)');
  sheen.addColorStop(0.55, 'rgba(120,150,175,0.06)');
  sheen.addColorStop(1, 'rgba(40,50,60,0.2)');
  p.c.fillStyle = sheen;
  p.c.fillRect(x, y, w, h);
}

/** One flank of a car, in metres from the car centre (x) and above the rail (y). `fwd` is +1 where +x is the cab end. */
function paintFlank(p: Paint, cab: boolean, seed: number) {
  const c = p.c;
  p.rect(-HALF, SILL, CAR_LEN, GIRTH, BODY);
  // roof: a flatter, dustier brown with seams
  p.rect(-HALF, EAVE + 0.25, CAR_LEN, GIRTH, '#2c2622');
  for (let x = -HALF + 1; x < HALF; x += 1.3) p.rect(x, EAVE + 0.3, 0.02, GIRTH, 'rgba(0,0,0,0.3)');
  // waist highlight of the lacquer
  const gloss = c.createLinearGradient(0, SILL, 0, EAVE + 0.3);
  gloss.addColorStop(0, 'rgba(0,0,0,0.25)');
  gloss.addColorStop(0.55, 'rgba(120,90,70,0.10)');
  gloss.addColorStop(1, 'rgba(0,0,0,0.12)');
  c.fillStyle = gloss;
  c.fillRect(-HALF, SILL, CAR_LEN, WALL + 0.3);
  // gold band and the arabesque standing on it
  p.rect(-HALF, SILL, CAR_LEN, 0.27, p.grad(SILL, SILL + 0.27, '#a87a00', '#f2c628'));
  p.rect(-HALF, SILL + 0.25, CAR_LEN, 0.02, '#7a5800');
  arabesque(c, -HALF, HALF, SILL + 0.3, 0.62, seed);
  arabesque(c, -HALF + 0.22, HALF, SILL + 0.28, 0.36, seed + 3); // undergrowth between the tall scrolls

  const door = (x: number, w: number) => {
    c.strokeStyle = 'rgba(0,0,0,0.75)';
    c.lineWidth = 0.03;
    c.strokeRect(x - w / 2, SILL + 0.29, w, 1.92);
    c.strokeStyle = 'rgba(190,150,70,0.35)';
    c.lineWidth = 0.012;
    c.strokeRect(x - w / 2 + 0.03, SILL + 0.32, w - 0.06, 1.86);
    glass(p, x - w / 2 + 0.16, 2.02, w - 0.32, 0.86, 0.5, false);
    p.rect(x + w / 2 - 0.13, 1.75, 0.035, 0.5, '#c9ccd0'); // grab handle
  };
  const band = (x0: number, x1: number, n: number) => {
    const pitch = (x1 - x0) / n, w = pitch - 0.3;
    for (let k = 0; k < n; k++) glass(p, x0 + k * pitch + 0.15, 1.98, w, 0.95, 0.75);
  };
  if (cab) {
    // cab end at +x: cab side window, crew door, the name in brush script between two stems, then the saloon
    glass(p, HALF - 1.0, 2.25, 0.62, 0.72, 0.25, false);
    door(HALF - 1.75, 0.72);
    sprig(c, HALF - 2.55, SILL + 0.75, 1.55, 0.22);
    sprig(c, HALF - 3.95, SILL + 0.75, 1.35, -0.2);
    p.text('はなあかり', HALF - 3.25, 2.98, 0.2, GOLD, `700 #px ${BRUSH}`, true);
    p.text('Hana Akari', HALF - 3.25, 1.93, 0.07, GOLD, `italic 400 #px Georgia, serif`);
    p.text('JR', HALF - 5.9, 3.1, 0.12, GOLD, `900 #px ${SANS}`);
    p.text('WEST JAPAN', HALF - 5.9, 3.015, 0.035, GOLD, `700 #px ${SANS}`);
    glass(p, HALF - 5.15, 1.98, 0.62, 0.95, 0.7);
    band(-6.6, HALF - 5.5, 6);
    door(-HALF + 1.25, 0.95);
  } else {
    door(HALF - 1.25, 0.95);
    band(-HALF + 2.1, HALF - 2.1, 9);
    door(-HALF + 1.25, 0.95);
    sprig(c, HALF - 2.05, SILL + 0.75, 1.2, 0.16);
    sprig(c, -HALF + 2.05, SILL + 0.75, 1.2, -0.16);
  }
  // number and class marks
  p.text(cab ? 'キハ189-7005' : 'キハ188-7001', -HALF + 3.1, 1.72, 0.06, GOLD, `700 #px ${SANS}`);
}

/** Both flanks of one car, unrolled: port side in the upper half (cab on the left), starboard below. */
function flankTextures(cab: boolean, seed: number) {
  const canvas = document.createElement('canvas'), mask = document.createElement('canvas');
  const hh = Math.ceil(GIRTH * PPM);
  canvas.width = mask.width = Math.round(CAR_LEN * PPM);
  canvas.height = mask.height = hh * 2;
  const p = new Paint(canvas, mask);
  p.m.fillStyle = '#000';
  p.m.fillRect(0, 0, mask.width, mask.height);
  for (const lower of [false, true]) {
    for (const ctx of [p.c, p.m]) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.beginPath();
      ctx.rect(0, lower ? hh : 0, canvas.width, hh);
      ctx.clip();
    }
    // port: +x of the painting (the cab) is on the left; starboard: on the right
    p.frame(canvas.width / 2, (lower ? 2 * hh : hh) + SILL * PPM, !lower);
    paintFlank(p, cab, seed + (lower ? 5 : 0));
    for (const ctx of [p.c, p.m]) ctx.restore();
  }
  return finish(canvas, mask);
}
function flankUV(side: number, z: number, a: number): [number, number] {
  const v = (side > 0 ? 0.5 : 0) + 0.5 * Math.min(0.995, Math.max(0.005, a / GIRTH));
  return [(side > 0 ? HALF - z : z + HALF) / CAR_LEN, v];
}

const FACE = 3.0; // the cab face is painted on a square this many metres across, centred on the car
function faceTextures() {
  const canvas = document.createElement('canvas'), mask = document.createElement('canvas');
  canvas.width = canvas.height = mask.width = mask.height = Math.round(FACE * PPM * 1.6);
  const p = new Paint(canvas, mask), c = p.c;
  for (const ctx of [p.c, p.m]) ctx.setTransform(PPM * 1.6, 0, 0, -PPM * 1.6, canvas.width / 2, canvas.height + (SILL - 0.1) * PPM * 1.6);
  p.rect(-2, 0, 4, 5, BODY);
  p.rect(-2, 0, 4, SILL + 0.27, p.grad(SILL, SILL + 0.27, '#a87a00', '#f2c628'));
  p.rect(-2, SILL + 0.25, 4, 0.02, '#7a5800');
  arabesque(c, -1.45, -0.45, SILL + 0.3, 0.6, 31);
  arabesque(c, 0.45, 1.45, SILL + 0.3, 0.6, 47);
  sprig(c, -0.98, SILL + 0.7, 0.75, 0.2);
  sprig(c, 1.0, SILL + 0.7, 0.55, -0.22);
  // windscreens with their brow, and the gangway door between them
  for (const s of [-1, 1]) {
    const x = s > 0 ? 0.5 : -1.34;
    p.rect(x - 0.04, 2.06, 0.92, 1.0, '#0b0908', 0, 0.06);
    p.rect(x, 2.1, 0.84, 0.92, p.grad(2.1, 3.02, '#1d252c', '#5b6b76'), 0.12, 0.04);
    c.strokeStyle = '#090909';
    c.lineWidth = 0.022;
    c.beginPath(); // wiper
    c.moveTo(x + 0.42 - s * 0.2, 2.1);
    c.lineTo(x + 0.42 + s * 0.12, 2.72);
    c.stroke();
    p.rect(x + 0.1, 1.88, 0.62, 0.025, '#3a302a'); // grab rail under the screen
  }
  c.strokeStyle = 'rgba(0,0,0,0.8)';
  c.lineWidth = 0.035;
  c.strokeRect(-0.43, SILL + 0.3, 0.86, 2.33);
  p.rect(-0.31, 2.12, 0.62, 0.98, '#0b0908', 0, 0.05);
  p.rect(-0.28, 2.15, 0.56, 0.92, p.grad(2.15, 3.07, '#141a1f', '#46535c'), 0.1, 0.04);
  p.rect(-0.39, 1.66, 0.1, 0.035, '#d0d3d6');
  // head mark: gold oval with the name
  for (const [ctx, fill] of [[p.c, GOLD], [p.m, '#666']] as [CanvasRenderingContext2D, string][]) {
    ctx.beginPath();
    ctx.ellipse(0, 1.72, 0.23, 0.31, 0, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
  }
  c.strokeStyle = '#7a5800';
  c.lineWidth = 0.012;
  c.beginPath();
  c.ellipse(0, 1.72, 0.2, 0.28, 0, 0, Math.PI * 2);
  c.stroke();
  p.text('はな', -0.02, 1.83, 0.12, '#3a2a10', `700 #px ${BRUSH}`);
  p.text('あかり', 0.01, 1.69, 0.11, '#3a2a10', `700 #px ${BRUSH}`);
  p.text('Hana Akari', 0, 1.56, 0.04, '#3a2a10', `italic 400 #px Georgia, serif`);
  // lamp housings in the brow
  for (const x of [-1.13, -0.86, 0.86, 1.13]) {
    for (const ctx of [p.c, p.m]) {
      ctx.beginPath();
      ctx.arc(x, 3.4, 0.135, 0, Math.PI * 2);
      ctx.fillStyle = ctx === p.c ? '#0d0b0a' : '#000';
      ctx.fill();
    }
  }
  return finish(canvas, mask);
}
function faceUV(x: number, y: number): [number, number] {
  return [0.5 + x / FACE, (y - SILL + 0.1) / FACE];
}

function finish(canvas: HTMLCanvasElement, mask: HTMLCanvasElement) {
  const m = mask.getContext('2d')!;
  m.setTransform(1, 0, 0, 1, 0, 0);
  m.globalCompositeOperation = 'multiply';
  m.drawImage(canvas, 0, 0);
  const tex = (c: HTMLCanvasElement) => {
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 16;
    return t;
  };
  return { map: tex(canvas), glow: tex(mask) };
}

// ------------------------------------------------------------------ geometry
/** Shell of one car: flanks and roof in `skin`, the cab face in `face`, everything unpainted in `dark` and `grey`. */
function carGeometry(cab: boolean) {
  const skin = new Surf(), face = new Surf(), parts = new Surf();
  const zs = [...range(HALF, HALF - 0.3, 8), ...range(HALF - 0.3, -HALF, 14).slice(1)];
  const as = [...range(0, WALL, 6), ...range(WALL, WALL + CURVE, 8).slice(1), ...range(WALL + CURVE, GIRTH, 6).slice(1)];
  for (const side of [1, -1])
    skin.grid(zs, as, (z, a) => shell(side, z, a, cab), { flip: side < 0, uv: (z, a) => flankUV(side, z, a) });

  // ends: a fan from the middle of the section out to its outline
  const outline = (u: number, z: number, cabEnd: boolean): V3 => {
    const q = u < 0.5 ? 1 : -1, a = (u < 0.5 ? u * 2 : 2 - u * 2) * GIRTH; // up the port side, down the starboard side
    return shell(q, z, a, cabEnd);
  };
  const us = [...range(0, 1, 60)];
  for (const end of [1, -1]) {
    const z = end * HALF, isCab = cab && end > 0;
    const target = isCab ? face : parts;
    target.grid([0, 1], us, (r, u) => {
      const o = outline(u, z, isCab);
      return [o[0] * r, 2.3 + (o[1] - 2.3) * r, z];
    }, { flip: end < 0, color: isCab ? 0xffffff : 0x1a1614, uv: (_r, _u, p) => faceUV(p[0], p[1]) });
    // floor edge: close the section along the sill
    target.grid([0, 1], [-1, 1], (r, s) => [HW * s * (1 - inset(z, isCab) / HW), SILL + (2.3 - SILL) * (1 - r), z], { flip: end > 0, color: isCab ? 0xffffff : 0x1a1614, uv: (_r, _u, p) => faceUV(p[0], p[1]) });
    if (!isCab) parts.add(new THREE.BoxGeometry(1.9, 2.25, 0.5), 0x2b2b2d, at(0, 2.1, z + end * 0.25)); // gangway bellows
  }

  // underframe
  const GREY = 0x8a8d90, DARKG = 0x2e2f31, STEEL = 0x55585c;
  parts.add(new THREE.BoxGeometry(2.7, 0.14, CAR_LEN - 0.3), 0x1b1715, at(0, SILL - 0.07, 0)); // floor pan
  for (const zb of [BOGIE, -BOGIE]) {
    parts.add(new THREE.BoxGeometry(2.25, 0.3, 3.0), DARKG, at(0, 0.52, zb));
    parts.add(new THREE.BoxGeometry(2.4, 0.16, 0.5), STEEL, at(0, 0.72, zb)); // bolster
    for (const sx of [-1, 1]) {
      parts.add(new THREE.BoxGeometry(0.16, 0.34, 2.9), 0x77797c, at(sx * 1.02, 0.5, zb)); // side frame
      parts.add(new THREE.CylinderGeometry(0.17, 0.17, 0.3, 14), 0x9a9da0, at(sx * 1.02, 0.84, zb)); // air spring
      for (const zw of [-1.05, 1.05]) {
        parts.add(new THREE.CylinderGeometry(0.43, 0.43, 0.13, 30), 0x3d3f42, xf([sx * 0.6, 0.43, zb + zw], [0, 0, Math.PI / 2]));
        parts.add(new THREE.CylinderGeometry(0.2, 0.2, 0.16, 16), 0xa4a7aa, xf([sx * 1.04, 0.43, zb + zw], [0, 0, Math.PI / 2])); // axle box
      }
    }
    for (const zw of [-1.05, 1.05]) parts.add(new THREE.CylinderGeometry(0.09, 0.09, 1.3, 12), STEEL, xf([0, 0.43, zb + zw], [0, 0, Math.PI / 2]));
  }
  // engine, transmission, radiators, tanks and boxes slung between the bogies
  const gear: [number, number, number, number, number, number][] = [
    [-0.75, 3.6, 0.9, 0.62, 2.2, GREY], [0.8, 3.9, 0.85, 0.55, 1.5, 0x9c9fa2], [0.75, 1.8, 1.0, 0.6, 1.8, DARKG],
    [-0.8, 1.2, 0.8, 0.5, 1.4, 0x6f7275], [0, -0.6, 1.3, 0.58, 1.6, 0x4a4c4f], [-0.85, -2.6, 0.75, 0.6, 1.9, GREY],
    [0.85, -2.4, 0.8, 0.52, 1.3, 0x9c9fa2], [0, -4.3, 2.3, 0.4, 1.0, DARKG],
  ];
  for (const [x, z, w, h, l, color] of gear) parts.add(new THREE.BoxGeometry(w, h, l), color, at(x, SILL - 0.14 - h / 2, z));
  for (const x of [-0.9, 0.9]) parts.add(new THREE.CylinderGeometry(0.2, 0.2, 1.5, 16), 0x77797c, xf([x, 0.55, -1.0], [Math.PI / 2, 0, 0])); // air reservoirs

  // roof: air-conditioning units, exhaust and aerial
  for (const z of [4.6, -4.6]) {
    parts.add(new THREE.BoxGeometry(1.75, 0.3, 3.4), 0x3b3835, at(0, CROWN + 0.1, z));
    parts.add(new THREE.BoxGeometry(1.5, 0.05, 3.0), 0x57534f, at(0, CROWN + 0.27, z));
  }
  parts.add(new THREE.BoxGeometry(0.9, 0.2, 1.2), 0x2a2725, at(0, CROWN + 0.06, 0.2));
  if (cab) {
    parts.add(new THREE.CylinderGeometry(0.06, 0.08, 0.3, 10), 0x1a1a1a, at(0.25, CROWN + 0.1, HALF - 1.0));
    // skirt, coupler and the number plate under the buffer beam
    parts.add(new THREE.BoxGeometry(2.72, 0.72, 0.7), 0x1d1613, at(0, 0.55, HALF - 0.42));
    parts.add(new THREE.BoxGeometry(2.3, 0.2, 0.5), 0x15110f, xf([0, 0.2, HALF - 0.2], [0.35, 0, 0]));
    parts.add(new THREE.BoxGeometry(0.42, 0.34, 0.75), 0x8f9295, at(0, 0.82, HALF + 0.2));
    parts.add(new THREE.BoxGeometry(0.62, 0.26, 0.3), 0xb6b9bc, at(0, 0.52, HALF + 0.05));
    for (const x of [-0.95, 0.95]) parts.add(new THREE.BoxGeometry(0.5, 0.07, 0.16), 0xd9a800, at(x, SILL + 0.06, HALF + 0.03)); // steps
  }
  return { skin: skin.build(), face: face.build(), parts: parts.build() };
}

/** The three-car set. Each entry of `cars` is a group to place on the track; the cab cars carry lamps. */
export class HanaAkariModel {
  readonly cars: THREE.Group[] = [];
  private lit: THREE.MeshPhysicalMaterial[] = [];

  constructor() {
    const gloss = { roughness: 0.3, metalness: 0.2, clearcoat: 0.8, clearcoatRoughness: 0.1, side: THREE.DoubleSide, emissive: 0xffffff, emissiveIntensity: 0.1 };
    const partMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.25, side: THREE.DoubleSide });
    const mat = (t: { map: THREE.Texture; glow: THREE.Texture }) => {
      const m = new THREE.MeshPhysicalMaterial({ ...gloss, map: t.map, emissiveMap: t.glow });
      this.lit.push(m);
      return m;
    };
    const cabGeo = carGeometry(true), midGeo = carGeometry(false);
    const cabMat = mat(flankTextures(true, 11)), midMat = mat(flankTextures(false, 23)), faceMat = mat(faceTextures());
    const lens = new THREE.CylinderGeometry(0.105, 0.105, 0.05, 20).rotateX(Math.PI / 2);
    const lamp = (rgb: [number, number, number]) => new THREE.MeshBasicMaterial({ color: new THREE.Color(...rgb) });
    const white = lamp([5, 4.8, 4.2]), amber = lamp([4, 1.6, 0.25]), red = lamp([4, 0.12, 0.08]), off = lamp([0.25, 0.22, 0.2]);

    const car = (geo: typeof cabGeo, flank: THREE.Material, role: 'head' | 'mid' | 'tail') => {
      const g = new THREE.Group();
      for (const [geometry, material] of [[geo.skin, flank], [geo.face, faceMat], [geo.parts, partMat]] as [THREE.BufferGeometry, THREE.Material][]) {
        if (!geometry.attributes.position.count) continue;
        const mesh = new THREE.Mesh(geometry, material);
        mesh.castShadow = mesh.receiveShadow = true;
        g.add(mesh);
      }
      if (role !== 'mid')
        for (const x of [-1.13, -0.86, 0.86, 1.13]) {
          const outer = Math.abs(x) > 1;
          // leading cab: white headlamps outside, amber markers inside; trailing cab: red tail lamps
          const m = new THREE.Mesh(lens, role === 'head' ? (outer ? white : amber) : outer ? off : red);
          m.position.set(x * (1 - 0.2 / HW), 3.4 - 0.05, HALF + 0.005);
          g.add(m);
        }
      this.cars.push(g);
      return g;
    };
    car(cabGeo, cabMat, 'head');
    car(midGeo, midMat, 'mid');
    car(cabGeo, cabMat, 'tail').userData.reversed = true; // same shell, turned end for end
  }

  /** The saloon lamps are on all day; after dark the windows glow. */
  setNight(n: number) {
    for (const m of this.lit) m.emissiveIntensity = 0.1 + n * 0.9;
  }
}
