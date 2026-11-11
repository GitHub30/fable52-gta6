import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { strip } from './Footbridge';
import type { WorldData } from './WorldData';
import type { City } from './City';

/**
 * The Osaka Loop Line through the map: two running lines traced from OpenStreetMap
 * (public/osaka/tracks.json, see tools/fetch_tracks.py), with ballasted track, the viaduct that
 * carries it over Shinsekai, and the Tennoji platforms. Trains (entities/Train.ts) run along `lines`.
 *
 * The elevation model has no viaducts in it and shows the road bridges over the cutting as humps,
 * so the rail level is rebuilt: it follows the floor of the cutting east of the plateau edge and
 * holds that level westwards, where the ground falls away and the line stands on its viaduct.
 */

const STEP = 4; // spacing of the samples along a line
const RAIL = 0.34; // rail head above the formation
const GAUGE = 1.067;

/** One running line, sampled every STEP metres in the direction of travel. */
export class Line {
  readonly x: number[] = [];
  readonly z: number[] = [];
  /** Height of the rail head. */
  readonly y: number[] = [];
  readonly length: number;
  /** Where the middle of a train stands at the Tennoji platform. */
  stop = 0;

  constructor(readonly name: string, pts: ArrayLike<number>) {
    const curve = new THREE.CatmullRomCurve3(Array.from({ length: pts.length / 2 }, (_v, i) => new THREE.Vector3(pts[i * 2], 0, pts[i * 2 + 1])), false, 'centripetal');
    const n = Math.round(curve.getLength() / STEP);
    for (const p of curve.getSpacedPoints(n)) {
      this.x.push(p.x);
      this.z.push(p.z);
    }
    this.length = n * STEP;
  }

  /** Position on the line at distance s (clamped to its ends). */
  at(s: number, out: THREE.Vector3) {
    const f = Math.max(0, Math.min(this.x.length - 1.001, s / STEP)), i = Math.floor(f), t = f - i;
    return out.set(this.x[i] + (this.x[i + 1] - this.x[i]) * t, this.y[i] + (this.y[i + 1] - this.y[i]) * t, this.z[i] + (this.z[i + 1] - this.z[i]) * t);
  }
}

function texture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 16;
  return t;
}
let seed = 5;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

/** Ballast with concrete sleepers: 3.4 m across (u), four sleepers along (v). */
function trackBed() {
  return texture(256, 256, (ctx) => {
    ctx.fillStyle = '#6f675e';
    ctx.fillRect(0, 0, 256, 256);
    for (let k = 0; k < 16000; k++) {
      const v = 70 + Math.floor(rnd() * 80);
      ctx.fillStyle = `rgb(${v + 8},${v},${v - 8})`;
      ctx.fillRect(rnd() * 256, rnd() * 256, 2 + rnd() * 2, 2 + rnd() * 2);
    }
    const x0 = (0.5 - 1.2 / 3.4) * 256, w = (2.4 / 3.4) * 256;
    for (let k = 0; k < 4; k++) {
      ctx.fillStyle = '#a9a69e';
      ctx.fillRect(x0, k * 64 + 20, w, 24);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(x0, k * 64 + 42, w, 2);
    }
    // rust staining under the rails
    ctx.fillStyle = 'rgba(96,58,34,0.35)';
    for (const s of [-1, 1]) ctx.fillRect(128 + (s * (GAUGE / 2) / 3.4) * 256 - 9, 0, 18, 256);
  });
}
function concrete() {
  return texture(256, 256, (ctx) => {
    ctx.fillStyle = '#aaa59c';
    ctx.fillRect(0, 0, 256, 256);
    for (let k = 0; k < 7000; k++) {
      const v = Math.floor(rnd() * 60);
      ctx.fillStyle = `rgba(${v},${v},${v},0.07)`;
      ctx.fillRect(rnd() * 256, rnd() * 256, 3, 3);
    }
    ctx.fillStyle = 'rgba(40,36,30,0.14)'; // water streaks
    for (let k = 0; k < 26; k++) ctx.fillRect(rnd() * 256, 0, 2 + rnd() * 5, 60 + rnd() * 196);
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.fillRect(0, 0, 256, 2);
  });
}
/** Platform surface: asphalt with the yellow tactile line and the white edge by the track (u = 0 at the edge). */
function platformTop() {
  return texture(256, 64, (ctx) => {
    ctx.fillStyle = '#6b6b6d';
    ctx.fillRect(0, 0, 256, 64);
    for (let k = 0; k < 2500; k++) {
      const v = 80 + Math.floor(rnd() * 60);
      ctx.fillStyle = `rgba(${v},${v},${v},0.25)`;
      ctx.fillRect(rnd() * 256, rnd() * 64, 2, 2);
    }
    ctx.fillStyle = '#e9e7df';
    ctx.fillRect(0, 0, 7, 64);
    ctx.fillStyle = '#e2b200';
    ctx.fillRect(36, 0, 20, 64);
  });
}

export class Railway {
  readonly group = new THREE.Group();
  readonly lines: Line[];

  constructor(data: WorldData, private city: City) {
    this.lines = data.tracks.map((t) => new Line(t.name, t.pts));
    if (!this.lines.length) return;
    const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    const ground = (x: number, z: number) => city.groundHeight(x, z);

    // ---- rail level
    const floors = this.lines.map((l) => {
      // the lowest ground within reach: that is the floor of the cutting, not the bridges over it
      const g = l.x.map((x, i) => ground(x, l.z[i]));
      return g.map((_v, i) => Math.min(...g.slice(Math.max(0, i - 22), i + 23)));
    });
    const cutting = floors.flatMap((f, k) => f.filter((_v, i) => this.lines[k].x[i] > 0 && this.lines[k].x[i] < 260)).sort((a, b) => a - b);
    const level = cutting[Math.floor(cutting.length / 2)] ?? 0;
    this.lines.forEach((l, k) => {
      let y = floors[k].map((v) => Math.max(v, level));
      for (let pass = 0; pass < 3; pass++) y = y.map((_v, i) => { const w = y.slice(Math.max(0, i - 8), i + 9); return w.reduce((a, b) => a + b, 0) / w.length; });
      l.y.push(...y.map((v) => v + RAIL));
      // the platform is where the line passes closest to the station
      let best = Infinity;
      l.x.forEach((x, i) => {
        const d = Math.hypot(x - 470, l.z[i] - (k ? 300 : 272));
        if (d < best) { best = d; l.stop = i * STEP; }
      });
    });

    // ---- geometry
    const bed: THREE.BufferGeometry[] = [], steel: THREE.BufferGeometry[] = [], deck: THREE.BufferGeometry[] = [], plat: THREE.BufferGeometry[] = [], roof: THREE.BufferGeometry[] = [];
    this.lines.forEach((l, k) => {
      const n = l.x.length, other = this.lines[1 - k];
      const nx: number[] = [], nz: number[] = [];
      for (let i = 0; i < n; i++) {
        const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1), d = Math.hypot(l.x[b] - l.x[a], l.z[b] - l.z[a]) || 1;
        nx.push((l.z[b] - l.z[a]) / d); // to the left of travel
        nz.push(-(l.x[b] - l.x[a]) / d);
      }
      const side = (off: number, dy: number) => l.x.map((x, i) => V(x + nx[i] * off, l.y[i] + dy, l.z[i] + nz[i] * off));
      const along = l.x.map((_x, i) => (i * STEP) / 2.4);
      const metres = l.x.map((_x, i) => (i * STEP) / 6);
      bed.push(strip(side(1.7, -RAIL + 0.04), side(-1.7, -RAIL + 0.04), along));
      for (const s of [-1, 1]) {
        const c = (s * GAUGE) / 2;
        steel.push(strip(side(c + 0.035, 0), side(c - 0.035, 0), along));
        steel.push(strip(side(c + 0.035, 0), side(c + 0.06, -0.16), along), strip(side(c - 0.035, 0), side(c - 0.06, -0.16), along));
      }

      // viaduct wherever the formation stands clear of the ground
      const raised = l.x.map((x, i) => l.y[i] - RAIL - ground(x, l.z[i]) > 1.3);
      const up = (i: number) => raised[i] || raised[i + 1];
      if (raised.some(Boolean)) {
        const slab = -RAIL - 0.02;
        deck.push(strip(side(2.3, slab), side(-2.3, slab), metres, up));
        deck.push(strip(side(2.3, slab - 1.3), side(-2.3, slab - 1.3), metres, up));
        for (const s of [-1, 1]) {
          deck.push(strip(side(s * 2.3, slab + 1.0), side(s * 2.3, slab - 1.3), metres, up)); // parapet and girder face
          deck.push(strip(side(s * 2.3, slab + 1.0), side(s * 2.1, slab + 1.0), metres, up), strip(side(s * 2.1, slab + 1.0), side(s * 2.1, slab), metres, up));
        }
        for (let i = 2; i < n - 2; i += 4) {
          if (!raised[i]) continue;
          const x = l.x[i], z = l.z[i], road = city.nearestRoad(x, z, (e) => e.car, 24);
          if ((road && road.dist < road.edge.w / 2 + 1.4) || city.collision.pointBlocked(x, 0, z, 1)) continue; // roads run through under the spans
          const y0 = ground(x, z) - 0.5, y1 = l.y[i] - RAIL - 1.3;
          const pier = new THREE.BoxGeometry(1.5, y1 - y0, 3.4).toNonIndexed();
          pier.rotateY(Math.atan2(nx[i], nz[i]) + Math.PI / 2);
          pier.translate(x, (y0 + y1) / 2, z);
          deck.push(pier);
          city.collision.add({ x0: x - 0.9, z0: z - 0.9, x1: x + 0.9, z1: z + 0.9, top: y1 });
        }
      }

      // Tennoji platform on the side away from the other line, with a canopy
      const mid = Math.round(l.stop / STEP), from = Math.max(1, mid - 19), to = Math.min(n - 2, mid + 19);
      let sgn = 1;
      if (other) {
        let d = Infinity, j = 0;
        other.x.forEach((x, i) => { const q = Math.hypot(x - l.x[mid], other.z[i] - l.z[mid]); if (q < d) { d = q; j = i; } });
        sgn = (other.x[j] - l.x[mid]) * nx[mid] + (other.z[j] - l.z[mid]) * nz[mid] > 0 ? -1 : 1;
      }
      const on = (i: number) => i >= from && i < to;
      const edge = sgn * 1.62, back = sgn * 6.6, top = 0.92 - 0.0;
      plat.push(strip(side(edge, top), side(back, top), l.x.map((_x, i) => (i * STEP) / 1.2), on));
      deck.push(strip(side(edge, top), side(edge, -RAIL), metres, on), strip(side(back, top), side(back, -RAIL), metres, on));
      roof.push(strip(side(sgn * 1.2, top + 3.5), side(sgn * 4.1, top + 3.9), metres, on), strip(side(sgn * 4.1, top + 3.9), side(sgn * 7.0, top + 3.5), metres, on));
      for (let i = from + 1; i < to; i += 2) {
        const x = l.x[i] + nx[i] * sgn * 4.1, z = l.z[i] + nz[i] * sgn * 4.1;
        const post = new THREE.CylinderGeometry(0.12, 0.12, 3.9, 10).toNonIndexed();
        post.translate(x, l.y[i] + top + 1.95, z);
        steel.push(post);
      }
    });

    const both = THREE.DoubleSide;
    const add = (parts: THREE.BufferGeometry[], mat: THREE.Material, shadow: boolean) => {
      if (!parts.length) return;
      const mesh = new THREE.Mesh(mergeGeometries(parts), mat);
      mesh.castShadow = shadow;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      for (const g of parts) g.dispose();
    };
    add(bed, new THREE.MeshStandardMaterial({ map: trackBed(), roughness: 0.95, side: both }), false);
    add(steel, new THREE.MeshStandardMaterial({ color: 0x8b8e92, roughness: 0.35, metalness: 0.85, side: both }), false);
    add(deck, new THREE.MeshStandardMaterial({ map: concrete(), roughness: 0.92, side: both }), true);
    add(plat, new THREE.MeshStandardMaterial({ map: platformTop(), roughness: 0.85, side: both }), false);
    add(roof, new THREE.MeshStandardMaterial({ color: 0x8a8e91, roughness: 0.7, metalness: 0.3, side: both }), true);
  }
}
