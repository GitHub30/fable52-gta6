import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { City } from './City';

/**
 * Abeno pedestrian bridge (阿倍野歩道橋): the "a"-shaped deck over the Abenobashi crossing between
 * Tennoji station and Abeno Harukas, with its white tubular truss and folded membrane roof.
 * The plan is the real one, traced from OpenStreetMap (ways 170695802, 654260864, 424210527 and the
 * stairs around them, (c) OpenStreetMap contributors); heights and sections are estimated from photos.
 * The deck and stairs are walkable: see `height()`.
 */

type XZ = [number, number];
interface Path {
  pts: XZ[];
  width: number;
  closed?: boolean;
  roof?: boolean;
}

// local metres (x east, z south), the same frame as map.json
const DECKS: Path[] = [
  // the loop of the "a"
  { closed: true, roof: true, width: 6.4, pts: [[293, 374], [294, 361], [293, 349], [295, 336], [300, 327], [308, 320], [315, 316], [323, 314], [330, 315], [336, 318], [341, 323], [345, 331], [346, 335], [344, 351], [342, 360], [333, 360], [324, 360], [315, 362], [306, 366], [299, 371]] },
  // its tail: two arms that meet in front of the station
  { roof: true, width: 5.2, pts: [[346, 335], [358, 338], [370, 341]] },
  { roof: true, width: 5.2, pts: [[342, 360], [349, 361], [359, 357], [365, 351], [370, 341], [374, 340], [378, 338], [379, 335]] },
  { roof: true, width: 4.4, pts: [[349, 361], [353, 366], [364, 370]] }, // into Abeno Harukas
  { width: 4, pts: [[300, 327], [287, 318], [283, 316]] },
  { width: 4, pts: [[336, 359], [334, 371]] },
  { width: 4, pts: [[310, 363], [310, 371], [308, 382]] },
];
// (the links that run on into Hoop and Harukas at deck level are left out: those buildings are solid blocks here)
// stairs, from the pavement up to the deck
const STAIRS: XZ[][] = [
  [[268, 312], [281, 315], [283, 316]],
  [[312, 304], [311, 313], [305, 317], [308, 320]],
  [[359, 327.5], [345, 331]],
  [[279, 350.7], [291, 354], [294, 355]],
  [[329, 378], [332, 363], [333, 360]],
  [[305, 399], [308, 382]],
  [[372.5, 327], [368, 338], [370, 341]],
];
const ELEVATORS: XZ[] = [[315, 369], [380, 333]];
const CLEAR = 5.8; // deck above the road
const STAIR_W = 3;
const WHITE = 0xd4d6d8; // kept under the bloom threshold in full sun

interface Sample {
  x: number;
  z: number;
  nx: number; // unit normal, to the left of travel
  nz: number;
  s: number; // distance along the path
}
/** A walkable strip: a capsule around a segment, with a surface height at each end. */
interface Seg {
  ax: number; az: number; bx: number; bz: number;
  ha: number; hb: number;
  hw: number;
  path: number;
}

function sample(pts: XZ[], closed: boolean, step: number): Sample[] {
  const curve = new THREE.CatmullRomCurve3(pts.map(([x, z]) => new THREE.Vector3(x, 0, z)), closed, 'centripetal');
  const n = Math.max(2, Math.round(curve.getLength() / step));
  const p = curve.getSpacedPoints(n), out: Sample[] = [];
  let s = 0;
  for (let i = 0; i <= n; i++) {
    const a = p[closed ? (i - 1 + n) % n : Math.max(0, i - 1)], b = p[closed ? (i + 1) % n : Math.min(n, i + 1)];
    const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    if (i) s += Math.hypot(p[i].x - p[i - 1].x, p[i].z - p[i - 1].z);
    out.push({ x: p[i].x, z: p[i].z, nx: (b.z - a.z) / l, nz: -(b.x - a.x) / l, s });
  }
  return out;
}

/** Quads between two rails of points, with u across and v along. `keep(i)` drops quads (openings at junctions). */
export function strip(a: THREE.Vector3[], b: THREE.Vector3[], v: number[], keep: (i: number) => boolean = () => true, u0 = 0, u1 = 1) {
  const pos: number[] = [], uv: number[] = [];
  for (let i = 0; i < a.length - 1; i++) {
    if (!keep(i)) continue;
    const q = [a[i], b[i], b[i + 1], a[i], b[i + 1], a[i + 1]], t = [u0, v[i], u1, v[i], u1, v[i + 1], u0, v[i], u1, v[i + 1], u0, v[i + 1]];
    for (const p of q) pos.push(p.x, p.y, p.z);
    uv.push(...t);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals(); // not indexed, so every facet is flat
  return g;
}

const up = new THREE.Vector3(0, 1, 0);
export function tube(a: THREE.Vector3, b: THREE.Vector3, r: number, sides = 10) {
  const d = b.clone().sub(a), len = d.length();
  const g = new THREE.CylinderGeometry(r, r, len, sides, 1, true).toNonIndexed();
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, d.divideScalar(len)));
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return g;
}

function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void) {
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

/** Pink granite paving across the deck (u) with the tactile guide strip down the middle; repeats every metre along it. */
function paving() {
  return canvasTexture(1024, 160, (ctx) => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const tw = 1024 / 13, th = 80;
    for (let r = 0; r < 2; r++)
      for (let c = -1; c < 14; c++) {
        const k = 0.9 + rnd() * 0.18;
        ctx.fillStyle = `rgb(${Math.round(196 * k)},${Math.round(160 * k)},${Math.round(146 * k)})`;
        ctx.fillRect(c * tw + (r ? tw / 2 : 0), r * th, tw, th);
      }
    for (let k = 0; k < 9000; k++) {
      const v = Math.floor(rnd() * 90);
      ctx.fillStyle = `rgba(${v + 60},${v + 40},${v + 40},0.16)`;
      ctx.fillRect(rnd() * 1024, rnd() * 160, 2, 2);
    }
    ctx.fillStyle = 'rgba(70,50,45,0.5)';
    for (let r = 0; r < 2; r++) {
      ctx.fillRect(0, r * th, 1024, 1.5);
      for (let c = 0; c < 14; c++) ctx.fillRect(c * tw + (r ? tw / 2 : 0), r * th, 1.5, th);
    }
    // tactile paving: a grey band of raised bars
    ctx.fillStyle = '#8f8f8c';
    ctx.fillRect(512 - 24, 0, 48, 160);
    ctx.fillStyle = '#b4b4b0';
    for (let x = 0; x < 4; x++) ctx.fillRect(512 - 20 + x * 11, 0, 6, 160);
    // drainage channels at both edges
    ctx.fillStyle = '#6f6d6a';
    ctx.fillRect(14, 0, 10, 160);
    ctx.fillRect(1000, 0, 10, 160);
  });
}

/** Stainless railing, 1.6 m of it: posts, top and bottom rails and pickets on a transparent ground. */
function railing() {
  return canvasTexture(256, 184, (ctx) => {
    ctx.clearRect(0, 0, 256, 184);
    const steel = ctx.createLinearGradient(0, 0, 0, 184);
    steel.addColorStop(0, '#e9ebed');
    steel.addColorStop(1, '#a9adb1');
    ctx.fillStyle = steel;
    ctx.fillRect(0, 0, 256, 12); // handrail
    ctx.fillRect(0, 26, 256, 6);
    ctx.fillRect(0, 164, 256, 8);
    for (let x = 8; x < 256; x += 16) ctx.fillRect(x, 26, 4, 140);
    ctx.fillStyle = '#c9cdd1';
    ctx.fillRect(0, 0, 9, 184); // post
  });
}

export class Footbridge {
  readonly group = new THREE.Group();
  /** Absolute height of the deck surface. */
  readonly deckY: number;
  private segs: Seg[] = [];
  private membrane: THREE.MeshStandardMaterial;
  private lamp: THREE.MeshStandardMaterial;

  constructor(private city: City) {
    const ground = (x: number, z: number) => city.groundHeight(x, z);
    const Y = (this.deckY = ground(320, 340) + CLEAR);
    const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

    // ---- walkable strips first: the rest of the model asks them where decks overlap
    const decks = DECKS.map((d) => sample(d.pts, !!d.closed, 1.75)); // two samples per roof bay
    decks.forEach((sm, k) => {
      for (let i = 0; i < sm.length - 1; i++) this.segs.push({ ax: sm[i].x, az: sm[i].z, bx: sm[i + 1].x, bz: sm[i + 1].z, ha: Y, hb: Y, hw: DECKS[k].width / 2, path: k });
    });
    const onDeck = (x: number, z: number, margin: number, except = -1) => this.segs.some((s) => s.path !== except && s.path < DECKS.length && this.reach(s, x, z) < s.hw - margin);
    // stairs climb at a constant slope and stop where they meet a deck
    const stairs = STAIRS.map((pts) => {
      const sm = sample(pts, false, 0.3);
      const end = sm.findIndex((p) => onDeck(p.x, p.z, 0.5));
      return end > 0 ? sm.slice(0, end + 1) : sm;
    });
    const stairY = stairs.map((sm) => {
      const y0 = ground(sm[0].x, sm[0].z), len = sm[sm.length - 1].s;
      return (s: number) => y0 + (Y - y0) * Math.min(1, s / len);
    });
    stairs.forEach((sm, k) => {
      for (let i = 0; i < sm.length - 1; i++)
        this.segs.push({ ax: sm[i].x, az: sm[i].z, bx: sm[i + 1].x, bz: sm[i + 1].z, ha: stairY[k](sm[i].s), hb: stairY[k](sm[i + 1].s), hw: STAIR_W / 2, path: DECKS.length + k });
    });
    /** True where another deck or stair already occupies (x, z): railings and columns leave an opening there. */
    const taken = (x: number, z: number, self: number) => this.segs.some((s) => s.path !== self && this.reach(s, x, z) < s.hw - 0.15);

    const steel: THREE.BufferGeometry[] = [], floor: THREE.BufferGeometry[] = [], rails: THREE.BufferGeometry[] = [];
    const roof: THREE.BufferGeometry[] = [], lamps: THREE.BufferGeometry[] = [], concrete: THREE.BufferGeometry[] = [], glass: THREE.BufferGeometry[] = [];
    const side = (sm: Sample[], off: number, y: number | ((i: number) => number)) => sm.map((p, i) => V(p.x + p.nx * off, typeof y === 'number' ? y : y(i), p.z + p.nz * off));

    // ---- decks
    decks.forEach((sm, k) => {
      const d = DECKS[k], hw = d.width / 2, lift = k * 0.012; // overlapping decks must not be coplanar
      const along = sm.map((p) => p.s);
      const L = side(sm, hw, Y + lift), R = side(sm, -hw, Y + lift);
      floor.push(strip(L, R, along));
      steel.push(strip(side(sm, hw, Y - 0.85), side(sm, -hw, Y - 0.85), along)); // soffit
      for (const sgn of [1, -1]) {
        const open = (i: number) => !taken(sm[i].x + sm[i].nx * sgn * (hw + 0.05), sm[i].z + sm[i].nz * sgn * (hw + 0.05), k) || !taken(sm[i + 1].x + sm[i + 1].nx * sgn * (hw + 0.05), sm[i + 1].z + sm[i + 1].nz * sgn * (hw + 0.05), k);
        const edge = sgn * (hw + 0.06);
        steel.push(strip(side(sm, edge, Y + 0.14 + lift), side(sm, edge, Y - 0.85), along, open)); // fascia girder
        steel.push(strip(side(sm, edge, Y + 0.14 + lift), side(sm, edge - sgn * 0.22, Y + 0.14 + lift), along, open)); // kerb
        const inner = sgn * (hw - 0.12);
        rails.push(strip(side(sm, inner, Y + 1.25), side(sm, inner, Y + 0.1), along.map((s) => s / 1.6), open));
      }
      if (!d.closed)
        for (const i of [0, sm.length - 1]) {
          // end plate under an open end
          const p = sm[i];
          if (taken(p.x, p.z, k)) continue;
          steel.push(strip([V(p.x + p.nx * hw, Y + 0.14, p.z + p.nz * hw), V(p.x - p.nx * hw, Y + 0.14, p.z - p.nz * hw)], [V(p.x + p.nx * hw, Y - 0.85, p.z + p.nz * hw), V(p.x - p.nx * hw, Y - 0.85, p.z - p.nz * hw)], [0, 1]));
        }

      // piers on the pavement and traffic islands, never in a carriageway
      for (let i = 4; i < sm.length - 3; i += 9) {
        const p = sm[i], road = city.nearestRoad(p.x, p.z, (e) => e.car, 20);
        if ((road && road.dist < road.edge.w / 2 + 0.9) || city.collision.pointBlocked(p.x, 0, p.z, 0.8)) continue;
        const y0 = ground(p.x, p.z) - 0.5;
        const g = new THREE.CylinderGeometry(0.5, 0.5, Y - 0.85 - y0, 28).toNonIndexed();
        g.translate(p.x, (Y - 0.85 + y0) / 2, p.z);
        concrete.push(g);
        city.collision.add({ x0: p.x - 0.45, z0: p.z - 0.45, x1: p.x + 0.45, z1: p.z + 0.45, top: Y - 0.85 });
      }
      if (!d.roof) return;

      // ---- roof: a folded membrane on eave tubes, carried by raking tubular columns in V pairs
      const bays = sm.filter((_p, i) => i % 2 === 0 || i === sm.length - 1), rw = hw + 0.9;
      const eaveY = Y + 4.15, v = bays.map((p) => p.s / 4);
      const EL = side(bays, rw, eaveY), ER = side(bays, -rw, eaveY);
      const ridge = side(bays, 0, (i) => eaveY + (i % 2 ? 0.95 : 0.3));
      roof.push(strip(EL, ridge, v, undefined, 0, 0.5), strip(ridge, ER, v, undefined, 0.5, 1));
      for (let i = 0; i < bays.length - 1; i++) {
        steel.push(tube(EL[i], EL[i + 1], 0.15), tube(ER[i], ER[i + 1], 0.15), tube(ridge[i], ridge[i + 1], 0.07, 6));
        steel.push(tube(EL[i], ridge[i], 0.085, 6), tube(ridge[i], ER[i], 0.085, 6)); // rafters under the folds
        if (i % 2) steel.push(tube(EL[i], ER[i], 0.11, 8)); // tie across at every other bay
      }
      for (const sgn of [1, -1]) {
        const E = sgn > 0 ? EL : ER;
        for (let i = 0; i < bays.length; i += 2) {
          const p = bays[i], fx = p.x + p.nx * sgn * (hw - 0.3), fz = p.z + p.nz * sgn * (hw - 0.3);
          if (taken(fx, fz, k)) continue; // no column in the mouth of a branch
          const foot = V(fx, Y, fz);
          if (i > 0) steel.push(tube(foot, E[i - 1], 0.135));
          if (i < bays.length - 1) steel.push(tube(foot, E[i + 1], 0.135));
        }
      }
      // pendant lamps under every other fold
      for (let i = 1; i < bays.length; i += 2) {
        const p = bays[i];
        const g = new THREE.CylinderGeometry(0.42, 0.34, 0.1, 20).toNonIndexed();
        g.translate(p.x, eaveY - 0.75, p.z);
        lamps.push(g);
        steel.push(tube(V(p.x, eaveY - 0.7, p.z), V(p.x, ridge[i].y, p.z), 0.02, 5));
      }
    });

    // ---- stairs
    stairs.forEach((sm, k) => {
      const y = stairY[k], id = DECKS.length + k, hw = STAIR_W / 2, len = sm[sm.length - 1].s;
      const at = (s: number) => {
        const i = Math.min(sm.length - 2, Math.floor((s / len) * (sm.length - 1))), f = (s - sm[i].s) / (sm[i + 1].s - sm[i].s || 1), a = sm[i], b = sm[i + 1];
        return { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f, nx: a.nx, nz: a.nz };
      };
      const y0 = y(0), n = Math.max(2, Math.round((Y - y0) / 0.165)), run = len / n, rise = (Y - y0) / n;
      for (let i = 0; i < n; i++) {
        const a = at(i * run), b = at((i + 1) * run), h0 = y0 + i * rise, h1 = h0 + rise;
        const aL = V(a.x + a.nx * hw, h0, a.z + a.nz * hw), aR = V(a.x - a.nx * hw, h0, a.z - a.nz * hw);
        const aL1 = aL.clone().setY(h1), aR1 = aR.clone().setY(h1);
        concrete.push(strip([aL, aL1], [aR, aR1], [0, 1])); // riser
        concrete.push(strip([aL1, V(b.x + b.nx * hw, h1, b.z + b.nz * hw)], [aR1, V(b.x - b.nx * hw, h1, b.z - b.nz * hw)], [0, 1])); // tread
      }
      const open = (i: number) => !taken(sm[i].x, sm[i].z, id);
      const slope = (off: number, dy: number) => side(sm, off, (i) => y(sm[i].s) + dy);
      const along = sm.map((p) => p.s);
      steel.push(strip(slope(hw, -0.75), slope(-hw, -0.75), along, open)); // underside
      for (const sgn of [1, -1]) {
        steel.push(strip(slope(sgn * (hw + 0.04), 0.3), slope(sgn * (hw + 0.04), -0.75), along, open)); // stringer
        rails.push(strip(slope(sgn * (hw - 0.06), 1.35), slope(sgn * (hw - 0.06), 0.2), along.map((s) => s / 1.6), open));
      }
      // one pier under the middle of the flight
      const mid = at(len * 0.55), top = y(len * 0.55) - 0.75, base = ground(mid.x, mid.z) - 0.4;
      if (top - base > 1.2) {
        const g = new THREE.CylinderGeometry(0.28, 0.28, top - base, 20).toNonIndexed();
        g.translate(mid.x, (top + base) / 2, mid.z);
        concrete.push(g);
      }
    });

    // ---- lift towers: glazed shafts with a steel cap
    for (const [x, z] of ELEVATORS) {
      const y0 = ground(x, z) - 0.3, top = Y + 3.2;
      const shaft = new THREE.BoxGeometry(2.6, top - y0, 2.6).toNonIndexed();
      shaft.translate(x, (top + y0) / 2, z);
      glass.push(shaft);
      const cap = new THREE.BoxGeometry(2.9, 0.3, 2.9).toNonIndexed();
      cap.translate(x, top + 0.15, z);
      steel.push(cap);
      for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) steel.push(tube(V(x + sx * 1.3, y0, z + sz * 1.3), V(x + sx * 1.3, top, z + sz * 1.3), 0.07, 6));
      city.collision.add({ x0: x - 1.3, z0: z - 1.3, x1: x + 1.3, z1: z + 1.3, top });
    }

    // ---- meshes
    const both = THREE.DoubleSide;
    const pave = paving();
    this.membrane = new THREE.MeshStandardMaterial({ color: 0xcfd1d2, roughness: 1, side: both, emissive: 0xfff4dc, emissiveIntensity: 0 });
    this.lamp = new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.5, emissive: 0xfff0d0, emissiveIntensity: 0 });
    const add = (parts: THREE.BufferGeometry[], mat: THREE.Material, shadow = true) => {
      if (!parts.length) return;
      for (const g of parts) if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((g.attributes.position.count * 2) | 0), 2));
      const mesh = new THREE.Mesh(mergeGeometries(parts), mat);
      mesh.castShadow = shadow;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      for (const g of parts) g.dispose();
    };
    add(steel, new THREE.MeshStandardMaterial({ color: WHITE, roughness: 0.42, metalness: 0.25, side: both }));
    add(floor, new THREE.MeshStandardMaterial({ map: pave, roughness: 0.6, metalness: 0.05, side: both }));
    add(concrete, new THREE.MeshStandardMaterial({ color: 0xb9b6ae, roughness: 0.9, side: both }));
    add(rails, new THREE.MeshStandardMaterial({ map: railing(), alphaTest: 0.5, roughness: 0.3, metalness: 0.7, side: both }), false);
    add(roof, this.membrane);
    add(lamps, this.lamp, false);
    add(glass, new THREE.MeshStandardMaterial({ color: 0x9fc0cf, roughness: 0.08, metalness: 0.5, transparent: true, opacity: 0.45 }), false);
  }

  /** Distance from (x, z) to the segment's centre line. */
  private reach(s: Seg, x: number, z: number) {
    const ex = s.bx - s.ax, ez = s.bz - s.az;
    const t = Math.max(0, Math.min(1, ((x - s.ax) * ex + (z - s.az) * ez) / (ex * ex + ez * ez || 1)));
    return Math.hypot(x - s.ax - ex * t, z - s.az - ez * t);
  }

  /**
   * Height of the deck or stair under (x, z) that someone whose feet are at `y` can stand on:
   * anything up to one step above them. -Infinity where there is none, so walking underneath is unaffected.
   */
  height(x: number, z: number, y: number) {
    if (x < 255 || x > 392 || z < 295 || z > 425) return -Infinity;
    let best = -Infinity;
    for (const s of this.segs) {
      const ex = s.bx - s.ax, ez = s.bz - s.az;
      const t = Math.max(0, Math.min(1, ((x - s.ax) * ex + (z - s.az) * ez) / (ex * ex + ez * ez || 1)));
      if ((x - s.ax - ex * t) ** 2 + (z - s.az - ez * t) ** 2 > s.hw * s.hw) continue;
      const h = s.ha + (s.hb - s.ha) * t;
      if (h <= y + 0.6 && h > best) best = h;
    }
    return best;
  }

  /** After dark the membrane is lit from below and glows. */
  setNight(n: number) {
    this.membrane.emissiveIntensity = n * 0.5;
    this.lamp.emissiveIntensity = n * 3;
  }
}
