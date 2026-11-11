import * as THREE from 'three';
import { mulberry32 } from '../config';
import type { WorldData, StoreKind } from './WorldData';
import type { City } from './City';

/**
 * Chain-store shopfronts at their real locations (public/osaka/stores.json, baked from OpenStreetMap).
 * Each shop is fitted to the wall of the real building that faces the street: a painted frontage
 * (glazing, interior, fascia sign) with real depth for the fascia, canopy and projecting sign.
 */

const PPM = 160; // texture pixels per metre
const STRIP = 1.3; // extra canvas width to the right of the frontage, holding the projecting sign's face
const SANS = 'Arial, "Helvetica Neue", Helvetica, sans-serif';
const JP = '"Yu Gothic","YuGothic","Meiryo","Hiragino Kaku Gothic ProN","Noto Sans JP",sans-serif';

interface Spec {
  height: number; // frontage height (m)
  maxWidth: number;
  /** Paints the frontage in metres: x from the left edge, h up from the pavement. */
  paint: (p: Painter, w: number) => void;
  /** Volumes that stand proud of the wall, as [x0, x1, h0, h1, depth]; the painted frontage wraps around them. */
  boxes: (w: number) => [number, number, number, number, number][];
}

/** Draws on the colour canvas and, in step, on the mask of what glows at night. */
class Painter {
  readonly c: CanvasRenderingContext2D;
  readonly m: CanvasRenderingContext2D;
  readonly rng: () => number;
  constructor(readonly canvas: HTMLCanvasElement, readonly mask: HTMLCanvasElement, readonly H: number, seed: number) {
    this.c = canvas.getContext('2d')!;
    this.m = mask.getContext('2d')!;
    this.rng = mulberry32(seed);
    for (const ctx of [this.c, this.m]) {
      ctx.setTransform(PPM, 0, 0, -PPM, 0, H * PPM); // metres, y up
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, canvas.width / PPM, H);
    }
  }
  rect(x: number, h: number, w: number, d: number, color: string | CanvasGradient, glow = 0) {
    this.c.fillStyle = color;
    this.c.fillRect(x, h, w, d);
    const v = Math.round(glow * 255);
    this.m.fillStyle = `rgb(${v},${v},${v})`;
    this.m.fillRect(x, h, w, d);
  }
  /** Vertical gradient from the bottom colour to the top colour. */
  grad(h0: number, h1: number, bottom: string, top: string) {
    const g = this.c.createLinearGradient(0, h0, 0, h1);
    g.addColorStop(0, bottom);
    g.addColorStop(1, top);
    return g;
  }
  /** Upright text centred on (x, h) and squeezed into `width` if it is longer. Not masked: call `glowRect` behind it for lit signs. */
  text(str: string, x: number, h: number, size: number, color: string, font: string, width = Infinity) {
    const c = this.c;
    c.save();
    c.translate(x, h);
    c.scale(1 / PPM, -1 / PPM);
    c.font = font.replace('#', String(size * PPM));
    const sx = Math.min(1, (width * PPM) / c.measureText(str).width);
    c.scale(sx, 1);
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = color;
    c.fillText(str, 0, 0);
    c.restore();
  }
  /** Path helper in metres for both canvases. */
  shape(points: [number, number][], color: string, glow = 0) {
    const v = Math.round(glow * 255);
    for (const [ctx, fill] of [[this.c, color], [this.m, `rgb(${v},${v},${v})`]] as [CanvasRenderingContext2D, string][]) {
      ctx.beginPath();
      points.forEach(([x, h], i) => (i ? ctx.lineTo(x, h) : ctx.moveTo(x, h)));
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
    }
  }
  /** Soft shadow under an overhang. */
  shade(x: number, h: number, w: number, d: number, strength = 0.35) {
    const g = this.c.createLinearGradient(0, h, 0, h - d);
    g.addColorStop(0, `rgba(0,0,0,${strength})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    this.c.fillStyle = g;
    this.c.fillRect(x, h - d, w, d);
  }
}

// ------------------------------------------------------------------ shared pieces
const goods = ['#c9463e', '#e0b83a', '#3f86bd', '#4a9a5f', '#d98a3a', '#f4f2ec', '#c0608f', '#6f58a8', '#27355f', '#9cc7d8', '#efe6cf', '#7b3f2a'];

/** Convenience-store interior seen through the glass. */
function salesFloor(p: Painter, x0: number, x1: number, top: number) {
  const w = x1 - x0, rng = p.rng;
  // sales floor: ceiling with light fittings, back wall, chiller cabinets and gondola shelving
  p.rect(x0, 0, w, top, p.grad(0, top, '#cfc9bc', '#f4f2ea'), 0.8);
  p.rect(x0, top - 0.42, w, 0.42, '#fbfbf6', 0.9);
  for (let x = x0 + 0.3; x < x1 - 0.9; x += 1.5) p.rect(x, top - 0.2, 1.1, 0.07, '#ffffff', 1);
  p.rect(x0, 0, w, 0.32, '#b8b2a4', 0.5); // floor
  const shelf = (sx: number, sw: number, h0: number, h1: number, rows: number, dark: boolean) => {
    p.rect(sx, h0, sw, h1 - h0, dark ? '#2a2d31' : '#e9e6dc', dark ? 0.5 : 0.75);
    const rh = (h1 - h0) / rows;
    for (let r = 0; r < rows; r++) {
      for (let x = sx + 0.03; x < sx + sw - 0.06; ) {
        const iw = 0.05 + rng() * 0.07;
        p.rect(x, h0 + r * rh + 0.03, iw, rh * (0.55 + rng() * 0.3), goods[Math.floor(rng() * goods.length)], dark ? 0.75 : 0.8);
        x += iw + 0.012;
      }
      p.rect(sx, h0 + r * rh, sw, 0.025, dark ? '#55595e' : '#bdb9ad', 0.5);
    }
  };
  shelf(x0, w, 1.25, top - 0.45, 3, true); // chillers along the back wall
  for (let x = x0 + 0.25; x < x1 - 1.4; x += 1.75) shelf(x, 1.45, 0.3, 1.18, 4, false);
  // magazine rack against the glass
  if (w > 5) shelf(x0 + 0.1, Math.min(2.2, w * 0.3), 0.28, 1.05, 3, false);

  // aisles recede into shade between the gondolas
  p.c.fillStyle = 'rgba(18,24,32,0.16)';
  p.c.fillRect(x0, 0, w, top);
}

/** Restaurant interior: menu boards over the counter at the back, tables and pendant lamps in front. */
function diningRoom(p: Painter, x0: number, x1: number, top: number) {
  const w = x1 - x0, rng = p.rng;
  p.rect(x0, 0, w, top, p.grad(0, top, '#6b5646', '#3a2f28'), 0.55);
  p.rect(x0, top - 0.3, w, 0.3, '#2b2623', 0.4);
  p.rect(x0, 0, w, 0.3, '#8a7a68', 0.45); // floor
  // counter with lit menu boards above it
  const cw = Math.min(w * 0.55, 5.5), cx = x0 + w * 0.5 - cw / 2;
  p.rect(cx, 0.3, cw, 0.8, p.grad(0.3, 1.1, '#4a3528', '#7a5a40'), 0.5);
  p.rect(cx, 1.08, cw, 0.05, '#e8e2d6', 0.7);
  for (let k = 0, n = Math.max(2, Math.round(cw / 1.2)); k < n; k++) {
    const bx = cx + (k * cw) / n + 0.05, bw = cw / n - 0.1;
    p.rect(bx, 1.75, bw, 0.6, '#1a1412', 0.9);
    p.rect(bx + 0.05, 1.8, bw * 0.42, 0.5, ['#c8442c', '#d99a2b', '#8a5a2c'][k % 3], 1);
    for (let l = 0; l < 4; l++) p.rect(bx + bw * 0.52, 1.84 + l * 0.12, bw * (0.25 + rng() * 0.15), 0.035, '#f6efe0', 1);
  }
  // tables, chairs and people-height shapes nearer the glass
  for (let x = x0 + 0.5; x < x1 - 1.2; x += 1.9) {
    if (x > cx - 0.8 && x < cx + cw) continue;
    p.rect(x + 0.35, 0.3, 0.07, 0.42, '#2b2623', 0.4);
    p.rect(x, 0.72, 0.78, 0.05, '#d8c8ae', 0.6);
    for (const c of [x - 0.42, x + 0.86]) {
      p.rect(c, 0.3, 0.36, 0.44, ['#b23a2a', '#d9a23a', '#5a4638'][Math.floor(rng() * 3)], 0.5);
      p.rect(c + (c < x ? 0 : 0.3), 0.74, 0.06, 0.4, '#3a2f28', 0.4);
    }
  }
  for (let x = x0 + 0.8; x < x1 - 0.4; x += 1.6) {
    p.rect(x, top - 0.75, 0.012, 0.45, '#111', 0.3);
    p.shape([[x - 0.16, top - 0.92], [x + 0.17, top - 0.92], [x + 0.09, top - 0.75], [x - 0.08, top - 0.75]], '#ffe2a8', 1);
  }
}
/** Glazed shopfront with the lit sales floor behind it. `stripe` is the chain's safety band across the glass. */
function glazing(p: Painter, x0: number, x1: number, top: number, stripe: string[], doorAt: number, frame = '#b9bdc2', cafe = false) {
  const w = x1 - x0, rng = p.rng;
  if (cafe) diningRoom(p, x0, x1, top);
  else salesFloor(p, x0, x1, top);
  // glass: sky reflection, falling to clear at eye level
  const sheen = p.c.createLinearGradient(0, top, 0, 0);
  sheen.addColorStop(0, 'rgba(150,190,225,0.5)');
  sheen.addColorStop(0.4, 'rgba(170,205,230,0.14)');
  sheen.addColorStop(0.75, 'rgba(70,80,90,0.16)');
  sheen.addColorStop(1, 'rgba(60,66,72,0.3)');
  p.c.fillStyle = sheen;
  p.c.fillRect(x0, 0, w, top);
  for (let x = x0 - 1; x < x1; x += 1.9) p.shape([[x, 0], [x + 0.5, 0], [x + 1.5, top], [x + 1.0, top]], 'rgba(255,255,255,0.06)', 0.8);

  // posters and notices taped inside the glass
  for (let x = x0 + 0.35; x < x1 - 0.8; x += 1.1 + rng() * 1.6) {
    if (Math.abs(x + 0.3 - doorAt) < 1.35) continue;
    const pw = 0.42 + rng() * 0.25, ph = pw * (1.25 + rng() * 0.3), h = 1.2 + rng() * 0.5;
    p.rect(x, h, pw, ph, goods[Math.floor(rng() * goods.length)], 0.45);
    p.rect(x + 0.04, h + ph * 0.55, pw - 0.08, ph * 0.3, 'rgba(255,255,255,0.85)', 0.5);
    for (let l = 0; l < 3; l++) p.rect(x + 0.05, h + 0.06 + l * ph * 0.13, pw * (0.5 + rng() * 0.4), 0.018, 'rgba(20,20,30,0.7)', 0.3);
  }
  // chain band across the glass at hand height
  stripe.forEach((color, i) => p.rect(x0, 0.98 + i * 0.05, w, 0.05, color, 0.6));

  // aluminium frame: sill, transom, mullions, and the sliding doors
  p.rect(x0, 0, w, 0.2, p.grad(0, 0.2, '#8d9196', frame));
  p.rect(x0, top - 0.5, w, 0.06, frame);
  p.rect(x0, top - 0.07, w, 0.07, frame);
  for (let x = x0; x <= x1 + 0.01; x += w / Math.max(2, Math.round(w / 1.7))) if (Math.abs(x - doorAt) > 1.1) p.rect(Math.min(x1 - 0.07, x) - (x > x0 ? 0.035 : 0), 0, 0.07, top, frame);
  const d0 = doorAt - 1.0;
  p.rect(d0, 0, 2.0, top - 0.5, p.grad(0, top, 'rgba(225,235,240,0.35)', 'rgba(170,205,230,0.3)'), 0.85);
  p.rect(d0, 0, 2.0, 0.06, '#6f7378');
  for (const x of [d0, doorAt - 0.03, d0 + 1.94]) p.rect(x, 0, 0.06, top - 0.5, '#8f949a');
  p.rect(d0 - 0.09, 0, 0.09, top - 0.44, frame);
  p.rect(d0 + 2.0, 0, 0.09, top - 0.44, frame);
  p.rect(doorAt - 0.34, 1.34, 0.68, 0.11, '#1f7a3c', 0.5); // "automatic door" sticker
  p.text('自動ドア', doorAt, 1.395, 0.075, '#ffffff', `700 #px ${JP}`, 0.6);
  p.rect(d0 + 0.2, 0, 1.6, 0.035, '#3b3f3a'); // door mat edge
}

/** Tiled or brick pier and plinth around the glazing. */
function masonry(p: Painter, x: number, h: number, w: number, d: number, tile: string, joint: string, tw: number, th: number, brick = false) {
  p.rect(x, h, w, d, joint);
  for (let r = 0, y = h; y < h + d; y += th, r++)
    for (let tx = x - (brick && r % 2 ? tw / 2 : 0); tx < x + w; tx += tw) {
      const a = Math.max(x, tx + 0.006), b = Math.min(x + w, tx + tw - 0.006);
      if (b <= a) continue;
      const k = 0.94 + p.rng() * 0.1;
      p.c.fillStyle = tile;
      p.c.globalAlpha = k > 1 ? 1 : k;
      p.c.fillRect(a, y + 0.006, b - a, Math.min(th, h + d - y) - 0.012);
      p.c.globalAlpha = 1;
    }
}

function arches(p: Painter, cx: number, base: number, size: number, color = '#ffc72c') {
  const c = p.c, w = size * 1.16;
  for (const ctx of [c, p.m]) {
    ctx.save();
    ctx.lineWidth = size * 0.15;
    ctx.lineCap = 'butt';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = ctx === c ? color : '#fff';
    for (const [a, b] of [[cx - w / 2, cx + w * 0.07], [cx - w * 0.07, cx + w / 2]]) {
      ctx.beginPath();
      for (let k = 0; k <= 40; k++) {
        const u = k / 40, y = base + size * (1 - Math.pow(Math.abs(2 * u - 1), 2.3));
        if (k) ctx.lineTo(a + (b - a) * u, y);
        else ctx.moveTo(a + (b - a) * u, y);
      }
      ctx.stroke();
    }
    ctx.restore();
  }
}

/** The seven-and-ELEVEN mark inside a white box of side `s` whose lower-left corner is (x, h). */
function sevenMark(p: Painter, x: number, h: number, s: number) {
  p.rect(x, h, s, s, '#ffffff', 1);
  const X = (u: number) => x + u * s, Y = (v: number) => h + v * s;
  p.shape([[X(0.2), Y(0.9)], [X(0.82), Y(0.9)], [X(0.82), Y(0.7)], [X(0.2), Y(0.7)]], '#f58220', 1);
  p.shape([[X(0.6), Y(0.7)], [X(0.82), Y(0.7)], [X(0.52), Y(0.1)], [X(0.3), Y(0.1)]], '#ee1c25', 1);
  p.rect(X(0.08), Y(0.36), s * 0.84, s * 0.2, '#ffffff', 1);
  p.text('ELEVEN', X(0.5), Y(0.455), s * 0.2, '#008061', `900 #px ${SANS}`, s * 0.8);
}

function familyMark(p: Painter, x: number, h: number, s: number) {
  p.rect(x, h, s, s, '#ffffff', 1);
  p.rect(x, h + s * 0.56, s, s * 0.44, '#00a54f', 1);
  p.rect(x, h, s, s * 0.44, '#0086cd', 1);
}

// ------------------------------------------------------------------ chains
const CONV_H = 3.7, GLASS = 2.6; // convenience stores: glazing to 2.6 m, fascia sign above

function convenience(fascia: (p: Painter, w: number) => void, wall: (p: Painter, w: number) => void, stripe: string[], blade: (p: Painter, x: number) => void): Spec {
  return {
    height: CONV_H,
    maxWidth: 10,
    paint: (p, w) => {
      wall(p, w);
      glazing(p, 0.45, w - 0.45, GLASS, stripe, w * 0.5);
      fascia(p, w);
      p.shade(0, GLASS, w, 0.5);
      blade(p, w + 0.15);
    },
    boxes: (w) => [[-0.05, w + 0.05, GLASS, CONV_H, 0.55]],
  };
}

const SPECS: Record<StoreKind, Spec> = {
  famima: convenience(
    (p, w) => {
      p.rect(0, GLASS, w, 1.1, p.grad(GLASS, CONV_H, '#eef0f1', '#ffffff'), 1);
      p.rect(0, CONV_H - 0.34, w, 0.34, '#00a54f', 1);
      p.rect(0, GLASS + 0.06, w, 0.17, '#0086cd', 1);
      for (let x = 2; x < w; x += 2) p.rect(x, GLASS, 0.012, 1.1, 'rgba(0,0,0,0.12)');
      const s = 0.36, tw = Math.min(3.1, w * 0.5), cx = w / 2;
      p.rect(cx - tw / 2 - s - 0.3, GLASS + 0.26, tw + s + 0.6, 0.48, '#ffffff', 1);
      familyMark(p, cx - tw / 2 - s - 0.12, GLASS + 0.32, s);
      p.text('FamilyMart', cx + 0.08, GLASS + 0.5, 0.42, '#0079c2', `900 #px ${SANS}`, tw);
    },
    (p, w) => masonry(p, 0, 0, w, GLASS, '#6b4a38', '#4d3628', 0.9, 0.13),
    ['#00a54f', '#ffffff', '#0086cd'],
    (p, x) => {
      p.rect(x, CONV_H - 1.3, 1.0, 1.3, '#ffffff', 1);
      p.rect(x, CONV_H - 0.3, 1.0, 0.3, '#00a54f', 1);
      p.rect(x, CONV_H - 1.3, 1.0, 0.2, '#0086cd', 1);
      familyMark(p, x + 0.32, CONV_H - 0.78, 0.36);
      p.text('FamilyMart', x + 0.5, CONV_H - 0.95, 0.17, '#0079c2', `900 #px ${SANS}`, 0.9);
    },
  ),
  lawson: convenience(
    (p, w) => {
      p.rect(0, GLASS, w, 1.1, '#ffffff', 1);
      const n = Math.max(3, Math.round(w / 1.9) | 1), pw = w / n; // odd count so a panel sits over the door
      for (let k = 0; k < n; k++) {
        p.rect(k * pw + 0.04, GLASS + 0.36, pw - 0.08, 0.7, p.grad(GLASS + 0.36, GLASS + 1.06, '#0a72c4', '#1586dc'), 1);
        p.rect(k * pw + 0.04, GLASS + 0.27, pw - 0.08, 0.035, '#ea5a9c', 1);
      }
      const cx = w / 2, lw = Math.min(pw - 0.2, 2.0);
      p.rect(cx - lw / 2 - 0.05, GLASS + 0.44, lw + 0.1, 0.54, '#ffffff', 1);
      p.rect(cx - lw / 2, GLASS + 0.49, lw, 0.44, '#0a72c4', 1);
      p.text('LAWSON', cx, GLASS + 0.705, 0.3, '#ffffff', `700 #px Georgia, "Times New Roman", serif`, lw - 0.16);
    },
    (p, w) => masonry(p, 0, 0, w, GLASS, '#f1f1ee', '#c9c9c4', 0.2, 0.1),
    ['#0a72c4', '#ffffff'],
    (p, x) => {
      p.rect(x, CONV_H - 1.3, 1.0, 1.3, '#0a72c4', 1);
      p.rect(x + 0.06, CONV_H - 1.24, 0.88, 1.18, '#ffffff', 1);
      p.rect(x + 0.1, CONV_H - 1.2, 0.8, 1.1, '#0a72c4', 1);
      p.text('LAWSON', x + 0.5, CONV_H - 0.52, 0.2, '#ffffff', `700 #px Georgia, "Times New Roman", serif`, 0.72);
      p.text('STATION', x + 0.5, CONV_H - 0.86, 0.1, '#ffffff', `700 #px ${SANS}`, 0.6);
    },
  ),
  lawson100: convenience(
    (p, w) => {
      p.rect(0, GLASS, w, 1.1, p.grad(GLASS, CONV_H, '#00863d', '#0a9a4a'), 1);
      p.rect(0, GLASS + 0.05, w, 0.1, '#ffffff', 1);
      const cx = w / 2, tw = Math.min(4.6, w * 0.7);
      p.text('LAWSON STORE', cx - tw * 0.16, GLASS + 0.62, 0.38, '#ffffff', `700 #px Georgia, "Times New Roman", serif`, tw * 0.66);
      p.text('100', cx + tw * 0.36, GLASS + 0.62, 0.56, '#ffe100', `900 italic #px ${SANS}`, tw * 0.26);
    },
    (p, w) => masonry(p, 0, 0, w, GLASS, '#e9e7e1', '#bdbbb4', 0.3, 0.15),
    ['#00863d', '#ffffff'],
    (p, x) => {
      p.rect(x, CONV_H - 1.3, 1.0, 1.3, '#00863d', 1);
      p.text('LAWSON', x + 0.5, CONV_H - 0.36, 0.19, '#ffffff', `700 #px Georgia, serif`, 0.84);
      p.text('STORE', x + 0.5, CONV_H - 0.62, 0.17, '#ffffff', `700 #px Georgia, serif`, 0.7);
      p.text('100', x + 0.5, CONV_H - 0.98, 0.36, '#ffe100', `900 italic #px ${SANS}`, 0.8);
    },
  ),
  seven: convenience(
    (p, w) => {
      p.rect(0, GLASS, w, 1.1, p.grad(GLASS, CONV_H, '#f1f1ee', '#ffffff'), 1);
      p.rect(0, GLASS + 0.66, w, 0.17, '#f58220', 1);
      p.rect(0, GLASS + 0.46, w, 0.2, '#008061', 1);
      p.rect(0, GLASS + 0.28, w, 0.18, '#ee1c25', 1);
      for (let x = 2.4; x < w; x += 2.4) p.rect(x - 0.02, GLASS, 0.04, 1.1, '#ffffff', 1);
      const s = 0.98, cx = w / 2;
      p.rect(cx - s / 2 - 0.1, GLASS + 0.04, s + 0.2, 1.04, '#ffffff', 1);
      sevenMark(p, cx - s / 2, GLASS + 0.07, s);
    },
    (p, w) => masonry(p, 0, 0, w, GLASS, '#a8623f', '#7c5a48', 0.22, 0.07, true),
    ['#f58220', '#008061', '#ee1c25'],
    (p, x) => {
      p.rect(x, CONV_H - 1.3, 1.0, 1.3, '#ffffff', 1);
      p.rect(x, CONV_H - 0.2, 1.0, 0.07, '#f58220', 1);
      p.rect(x, CONV_H - 0.27, 1.0, 0.07, '#008061', 1);
      p.rect(x, CONV_H - 0.34, 1.0, 0.07, '#ee1c25', 1);
      sevenMark(p, x + 0.12, CONV_H - 1.2, 0.76);
    },
  ),
  mcd: {
    height: 6.6,
    maxWidth: 12,
    paint: (p, w) => {
      const tx = Math.max(0.3, w * 0.3 - 1.2), tw = 2.4, canopy = 3.05;
      // upper storey: dark grey lap siding
      p.rect(0, canopy, w, 6.6 - canopy, '#5a5c5f');
      for (let h = canopy; h < 6.6; h += 0.34) {
        p.rect(0, h, w, 0.3, p.grad(h, h + 0.3, '#56585b', '#6a6c70'));
        p.rect(0, h + 0.3, w, 0.04, '#34363a');
      }
      for (let x = 3; x < w; x += 3) p.rect(x, canopy, 0.02, 6.6 - canopy, 'rgba(0,0,0,0.25)');
      p.rect(0, 6.45, w, 0.15, '#2f3134');
      const lx = tx + tw + (w - tx - tw) / 2;
      p.text("McDonald's", lx, 4.85, 0.62, '#ffffff', `900 #px ${SANS}`, w - tx - tw - 0.8);
      // ground floor: glazing, then the timber McCafe panel at the right-hand end
      const cafe = Math.min(2.6, w * 0.24);
      p.rect(0, 0, w, canopy, '#3b3d40');
      glazing(p, 0.25, w - cafe - 0.15, 2.75, ['#ffc72c'], Math.max(tx + tw + 1.3, (tx + tw + w - cafe) / 2), '#3d4044', true);
      p.rect(w - cafe, 0, cafe, canopy, '#5b3a2a');
      for (let h = 0; h < canopy; h += 0.16) p.rect(w - cafe, h, cafe, 0.012, 'rgba(0,0,0,0.3)');
      p.text('McCafé', w - cafe / 2, 1.9, 0.5, '#ffffff', `italic 700 #px Georgia, "Times New Roman", serif`, cafe - 0.4);
      // white canopy slab between the storeys
      p.rect(0, canopy, w, 0.26, p.grad(canopy, canopy + 0.26, '#d9dbdd', '#f6f6f6'), 0.25);
      p.shade(0, canopy, w, 0.7, 0.4);
      // red tower with the arches
      p.rect(tx, 0, tw, 6.6, p.grad(0, 6.6, '#c9241a', '#e02a1d'), 0.55);
      for (let h = 1.1; h < 6.6; h += 1.1) p.rect(tx, h, tw, 0.018, 'rgba(0,0,0,0.28)');
      for (const x of [tx + tw / 3, tx + (tw * 2) / 3]) p.rect(x, 0, 0.014, 6.6, 'rgba(0,0,0,0.22)');
      arches(p, tx + tw / 2, 4.55, 1.25);
      // projecting sign face
      const bx = w + 0.15;
      p.rect(bx, 6.6 - 1.3, 1.0, 1.3, '#da291c', 1);
      arches(p, bx + 0.5, 6.6 - 1.02, 0.62);
      p.text("McDonald's", bx + 0.5, 6.6 - 1.15, 0.13, '#ffffff', `900 #px ${SANS}`, 0.86);
    },
    boxes: (w) => {
      const tx = Math.max(0.3, w * 0.3 - 1.2);
      return [
        [-0.05, w + 0.05, 3.31, 6.6, 0.3], // upper storey cladding
        [-0.05, w + 0.05, 3.05, 3.31, 1.1], // canopy
        [tx, tx + 2.4, 0, 6.6, 0.75], // tower
      ];
    },
  },
};

// ------------------------------------------------------------------ geometry
class Mesher {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  idx: number[] = [];
  quad(p: number[][], n: number[], t: number[][]) {
    const base = this.pos.length / 3;
    for (let k = 0; k < 4; k++) {
      this.pos.push(p[k][0], p[k][1], p[k][2]);
      this.nor.push(n[0], n[1], n[2]);
      this.uv.push(t[k][0], t[k][1]);
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

interface Site {
  x: number; // centre of the frontage on the wall
  z: number;
  y: number; // pavement level
  nx: number; // outward normal of the wall
  nz: number;
  width: number;
  tall: boolean; // the building rises above the frontage, so a projecting sign fits
}

export class Stores {
  readonly group = new THREE.Group();
  /** Where each shop ended up, for the minimap and for tests. */
  readonly placed: { kind: StoreKind; x: number; z: number; nx: number; nz: number; name: string }[] = [];
  private mats: THREE.MeshStandardMaterial[] = [];

  constructor(data: WorldData, city: City) {
    const used = new Set<string>();
    const batches = new Map<string, { kind: StoreKind; width: number; mesh: Mesher }>();
    for (const s of data.stores) {
      const site = this.fit(data, city, s.x, s.z, SPECS[s.kind], used);
      if (!site) continue;
      const key = s.kind + site.width;
      let b = batches.get(key);
      if (!b) batches.set(key, (b = { kind: s.kind, width: site.width, mesh: new Mesher() }));
      this.frontage(b.mesh, SPECS[s.kind], site);
      this.placed.push({ kind: s.kind, x: site.x + site.nx * 2, z: site.z + site.nz * 2, nx: site.nx, nz: site.nz, name: s.name });
    }
    let seed = 91;
    for (const b of batches.values()) {
      const spec = SPECS[b.kind];
      const canvas = document.createElement('canvas'), mask = document.createElement('canvas');
      canvas.width = mask.width = Math.round((b.width + STRIP) * PPM);
      canvas.height = mask.height = Math.round(spec.height * PPM);
      spec.paint(new Painter(canvas, mask, spec.height, seed++), b.width);
      // night map = the painting, kept only where the mask says it is lit
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
      const mat = new THREE.MeshStandardMaterial({ map: tex(canvas), emissiveMap: tex(mask), emissive: 0xffffff, emissiveIntensity: 0.12, roughness: 0.42, metalness: 0.08 });
      this.mats.push(mat);
      const mesh = new THREE.Mesh(b.mesh.build(), mat);
      mesh.castShadow = mesh.receiveShadow = true;
      this.group.add(mesh);
    }
  }

  /** Interiors are lit all day; the signs take over after dark. */
  setNight(n: number) {
    for (const m of this.mats) m.emissiveIntensity = 0.12 + n * 0.55; // white fascias would bloom out their lettering if driven harder
  }

  /** Choose the wall for a shop mapped at (x, z): the nearest wall of the nearest building that looks onto a street. */
  private fit(data: WorldData, city: City, x: number, z: number, spec: Spec, used: Set<string>): Site | null {
    const pick: { site: Site | null; key: string } = { site: null, key: '' };
    let bestScore = 40;
    data.buildings.forEach((bd, bi) => {
      const p = bd.pts, n = p.length / 2;
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
      for (let i = 0; i < p.length; i += 2) {
        x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]);
        z0 = Math.min(z0, p[i + 1]); z1 = Math.max(z1, p[i + 1]);
      }
      if (x < x0 - 30 || x > x1 + 30 || z < z0 - 30 || z > z1 + 30 || bd.h > 200) return;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n, ax = p[i * 2], az = p[i * 2 + 1], ex = p[j * 2] - ax, ez = p[j * 2 + 1] - az;
        const len = Math.hypot(ex, ez), key = bi + ':' + i;
        if (len < 4.4 || used.has(key)) continue;
        const width = Math.min(spec.maxWidth, Math.floor((len - 0.3) / 2) * 2);
        const t = Math.max(width / 2 + 0.15, Math.min(len - width / 2 - 0.15, ((x - ax) * ex + (z - az) * ez) / len));
        const qx = ax + (ex / len) * t, qz = az + (ez / len) * t;
        const nx = ez / len, nz = -ex / len; // outward for counter-clockwise footprints
        let score = Math.hypot(x - qx, z - qz) - width * 0.4;
        // the frontage must look onto a street and must not be buried in the neighbouring building
        const road = city.nearestRoad(qx + nx * 2, qz + nz * 2, (e) => e.k <= 5, 16);
        if (!road || (road.x - qx) * nx + (road.z - qz) * nz < 0.5) score += 30;
        else score += road.dist * 0.3;
        let buried = false;
        for (const s of [-0.4, 0, 0.4]) if (city.collision.pointBlocked(qx + nx * 1.3 + (ex / len) * width * s, 0, qz + nz * 1.3 + (ez / len) * width * s, 0.2)) buried = true;
        if (buried || score >= bestScore) continue;
        let y = Infinity;
        for (const s of [-0.5, 0, 0.5]) y = Math.min(y, city.groundHeight(qx + (ex / len) * width * s + nx * 0.6, qz + (ez / len) * width * s + nz * 0.6));
        bestScore = score;
        pick.key = key;
        pick.site = { x: qx, z: qz, y, nx, nz, width, tall: bd.h > spec.height + 2.2 };
      }
    });
    if (pick.site) used.add(pick.key);
    return pick.site;
  }

  /** Emit the frontage: the flat painted wall, the proud volumes wrapped in the same painting, and the projecting sign. */
  private frontage(m: Mesher, spec: Spec, s: Site) {
    const W = s.width, H = spec.height, TW = W + STRIP;
    const rx = s.nz, rz = -s.nx; // the viewer's right when facing the wall
    const P = (x: number, h: number, d: number) => [s.x + rx * (x - W / 2) + s.nx * d, s.y + h, s.z + rz * (x - W / 2) + s.nz * d];
    const U = (x: number, h: number) => [x / TW, h / H];
    const N = [s.nx, 0, s.nz], R = [rx, 0, rz], L = [-rx, 0, -rz];
    const e = 0.01;
    const box = (x0: number, x1: number, h0: number, h1: number, d0: number, d1: number, side?: [number, number], drop = 0) => {
      const a = Math.max(e, x0), b = Math.min(W - e, x1); // texture span of the front face
      m.quad([P(x0, h0, d1), P(x1, h0, d1), P(x1, h1, d1), P(x0, h1, d1)], N, [U(a, h0), U(b, h0), U(b, h1), U(a, h1)]);
      m.quad([P(x0, h1, d1), P(x1, h1, d1), P(x1, h1, d0), P(x0, h1, d0)], [0, 1, 0], [U(a, h1 - e), U(b, h1 - e), U(b, h1 - e), U(a, h1 - e)]);
      m.quad([P(x0, h0, d0), P(x1, h0, d0), P(x1, h0, d1), P(x0, h0, d1)], [0, -1, 0], [U(a, h0 + e), U(b, h0 + e), U(b, h0 + e), U(a, h0 + e)]);
      // the ends repeat the edge of the painting, or show their own picture (the projecting sign)
      const l = side ?? [a, a], r = side ?? [b, b];
      const v0 = h0 - drop, v1 = h1 - drop;
      m.quad([P(x0, h0, d0), P(x0, h0, d1), P(x0, h1, d1), P(x0, h1, d0)], L, [U(l[0], v0), U(l[1], v0), U(l[1], v1), U(l[0], v1)]);
      m.quad([P(x1, h0, d1), P(x1, h0, d0), P(x1, h1, d0), P(x1, h1, d1)], R, [U(r[0], v0), U(r[1], v0), U(r[1], v1), U(r[0], v1)]);
    };
    // the flat frontage, carried below the pavement so sloping ground never shows a gap
    m.quad([P(0, -1, 0.1), P(W, -1, 0.1), P(W, H, 0.1), P(0, H, 0.1)], N, [U(e, -1), U(W - e, -1), U(W - e, H - e), U(e, H - e)]);
    for (const [x0, x1, h0, h1, d] of spec.boxes(W)) box(x0, x1, h0 > 0 ? h0 : -1, h1, 0, d);
    // projecting sign above the fascia, double-sided, on the left-hand end
    if (s.tall) box(0.25, 0.43, H + 0.5, H + 1.8, 0.15, 1.15, [W + 0.15, W + 1.15], 1.8);
  }
}
