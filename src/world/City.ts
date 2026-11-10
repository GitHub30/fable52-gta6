import * as THREE from 'three';
import { BOUND, mulberry32 } from '../config';
import { CollisionWorld } from './Collision';
import { WorldData, Edge, terrainHeight } from './WorldData';
import { mergeBoxes, vertexColorMaterial, BoxPart } from '../core/geo';

/** Named places (local metres: x east, z south) used for district names, missions and spawn points. */
export const PLACES = {
  tsutenkaku: { x: -287, z: -305, name: '新世界・通天閣' },
  ebisucho: { x: -300, z: -545, name: '恵美須町' },
  shinImamiya: { x: -660, z: -5, name: '新今宮' },
  dobutsuenMae: { x: -458, z: 84, name: '動物園前' },
  zoo: { x: -92, z: -150, name: '天王寺動物園' },
  tenshiba: { x: 137, z: 72, name: 'てんしば・天王寺公園' },
  isshinji: { x: 100, z: -128, name: '一心寺・茶臼山' },
  tennojiSta: { x: 412, z: 260, name: '天王寺駅前' },
  harukas: { x: 426, z: 433, name: 'あべのハルカス' },
  abeno: { x: 300, z: 620, name: '阿倍野' },
  shitennoji: { x: 620, z: -470, name: '四天王寺' },
  teradacho: { x: 690, z: 180, name: '寺田町方面' },
  yuhigaoka: { x: 480, z: -610, name: '夕陽丘' },
};

/** Accumulates triangles into one BufferGeometry (one draw call per material). */
class GeoBuilder {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  idx: number[] = [];
  vert(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number, c: THREE.Color) {
    this.pos.push(x, y, z);
    this.nor.push(nx, ny, nz);
    this.uv.push(u, v);
    this.col.push(c.r, c.g, c.b);
    return this.pos.length / 3 - 1;
  }
  quad(a: number, b: number, c: number, d: number) {
    this.idx.push(a, b, c, a, c, d);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

function canvasTexture(size: number, draw: (ctx: CanvasRenderingContext2D, s: number) => void, srgb = true) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d')!, size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Facade tile: 8 bays x 8 floors (3.2 m each). Returns the colour map and the night-time window map. */
function facade(style: number, rng: () => number) {
  const S = 512, C = 64;
  const lit = document.createElement('canvas');
  lit.width = lit.height = S;
  const lctx = lit.getContext('2d')!;
  lctx.fillStyle = '#000';
  lctx.fillRect(0, 0, S, S);
  const warm = ['#ffd58a', '#ffe9b8', '#cfe4ff', '#ffc070'];
  const map = canvasTexture(S, (ctx) => {
    ctx.fillStyle = ['#d8d2c6', '#cfcfca', '#c9ccd0', '#9fb4c8'][style];
    ctx.fillRect(0, 0, S, S);
    // surface grain so walls are not flat colour
    for (let k = 0; k < 5000; k++) {
      const v = Math.floor(rng() * 50);
      ctx.fillStyle = `rgba(${v},${v},${v},0.06)`;
      ctx.fillRect(rng() * S, rng() * S, 2, 2);
    }
    for (let fl = 0; fl < 8; fl++)
      for (let bay = 0; bay < 8; bay++) {
        const x = bay * C, y = fl * C;
        let wx = 10, wy = 14, ww = 44, wh = 34;
        if (style === 0) {
          // low-rise: small irregular windows, siding lines
          ctx.fillStyle = 'rgba(0,0,0,0.07)';
          for (let l = 0; l < 4; l++) ctx.fillRect(x, y + l * 16, C, 1);
          if (rng() < 0.3) continue;
          ww = 26 + Math.floor(rng() * 14); wh = 24; wx = 8 + Math.floor(rng() * 16); wy = 18;
        } else if (style === 1) {
          // apartments: balcony slab and railing, wide sliding doors
          ctx.fillStyle = '#8f8f8a';
          ctx.fillRect(x, y + 50, C, 4);
          ctx.fillStyle = 'rgba(70,74,80,0.55)';
          ctx.fillRect(x + 2, y + 36, C - 4, 14);
          ctx.fillStyle = 'rgba(0,0,0,0.25)';
          ctx.fillRect(x, y, 2, C);
          wx = 8; wy = 8; ww = 48; wh = 30;
        } else if (style === 2) {
          // offices: ribbon glazing between spandrel panels
          ctx.fillStyle = 'rgba(0,0,0,0.12)';
          ctx.fillRect(x, y + 54, C, 2);
          wx = 2; wy = 12; ww = 60; wh = 36;
        } else {
          // curtain wall: glass everywhere, thin mullions
          wx = 1; wy = 1; ww = 62; wh = 62;
        }
        const g = ctx.createLinearGradient(0, y + wy, 0, y + wy + wh);
        const b = style === 3 ? 95 + Math.floor(rng() * 50) : 38 + Math.floor(rng() * 30);
        g.addColorStop(0, `rgb(${b + 30},${b + 48},${b + 66})`);
        g.addColorStop(1, `rgb(${b - 14},${b},${b + 20})`);
        ctx.fillStyle = g;
        ctx.fillRect(x + wx, y + wy, ww, wh);
        ctx.fillStyle = style === 3 ? 'rgba(40,50,60,0.8)' : 'rgba(235,235,235,0.75)';
        ctx.fillRect(x + wx + ww / 2 - 1, y + wy, 2, wh); // mullion
        if (style !== 3 && rng() < 0.35) {
          ctx.fillStyle = 'rgba(230,225,210,0.5)'; // curtain
          ctx.fillRect(x + wx, y + wy, ww * (0.3 + rng() * 0.3), wh);
        }
        if (rng() < (style === 3 ? 0.3 : 0.42)) {
          lctx.fillStyle = warm[Math.floor(rng() * warm.length)];
          lctx.fillRect(x + wx, y + wy, ww, wh);
        }
      }
  });
  const emissive = new THREE.CanvasTexture(lit);
  emissive.wrapS = emissive.wrapT = THREE.RepeatWrapping;
  emissive.colorSpace = THREE.SRGBColorSpace;
  return { map, emissive };
}

export interface RoadHit {
  edge: Edge;
  seg: number; // index of the segment's first point
  x: number;
  z: number;
  dx: number; // unit direction of the segment (a -> b)
  dz: number;
  dist: number;
}

/** The Tsutenkaku / Tennoji map: terrain, aerial photo, real roads and building footprints, landmarks. */
export class City {
  readonly group = new THREE.Group();
  readonly collision = new CollisionWorld();
  private facadeMats: THREE.MeshStandardMaterial[] = [];
  private lampGlow!: THREE.MeshBasicMaterial;
  private lampBulb!: THREE.MeshStandardMaterial;
  private glows!: THREE.InstancedMesh;
  private markMats: THREE.MeshStandardMaterial[] = [];
  private segHash = new Map<number, number[]>(); // (edge << 12 | segment) per 40 m cell
  private lanes = new Map<number, Float32Array>();
  readonly aiEdges: Edge[];
  buildingCount = 0;

  constructor(readonly data: WorldData) {
    BOUND.x = data.hx - 8;
    BOUND.z = data.hz - 8;
    this.aiEdges = data.edges.filter((e) => e.ai && e.len > 12);
    const rng = mulberry32(20261110);
    const col = new THREE.Color();
    const white = new THREE.Color(1, 1, 1);
    const H = (x: number, z: number) => terrainHeight(data, x, z);
    const { hx, hz } = data;

    const photo = new THREE.Texture(data.ground);
    photo.colorSpace = THREE.SRGBColorSpace;
    photo.anisotropy = 16;
    photo.needsUpdate = true;
    const U = (x: number) => (x + hx) / (2 * hx), V = (z: number) => 1 - (z + hz) / (2 * hz);

    // ---------- terrain draped with the aerial photo
    {
      // every second survey cell is enough for the mesh; height queries still use the full grid
      const step = 2, cell = data.cell * step;
      const nx = Math.floor((data.nx - 1) / step) + 1, nz = Math.floor((data.nz - 1) / step) + 1;
      const pos = new Float32Array(nx * nz * 3), uv = new Float32Array(nx * nz * 2), uv1 = new Float32Array(nx * nz * 2);
      for (let j = 0; j < nz; j++)
        for (let i = 0; i < nx; i++) {
          const o = j * nx + i, x = -hx + i * cell, z = -hz + j * cell;
          pos[o * 3] = x; pos[o * 3 + 1] = data.dem[j * step * data.nx + i * step] * 0.01; pos[o * 3 + 2] = z;
          uv[o * 2] = U(x); uv[o * 2 + 1] = V(z);
          uv1[o * 2] = x / 5; uv1[o * 2 + 1] = z / 5;
        }
      const idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
      let k = 0;
      for (let j = 0; j < nz - 1; j++)
        for (let i = 0; i < nx - 1; i++) {
          const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
          idx[k++] = a; idx[k++] = c; idx[k++] = b; idx[k++] = b; idx[k++] = c; idx[k++] = d;
        }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      g.setAttribute('uv1', new THREE.BufferAttribute(uv1, 2));
      g.setIndex(new THREE.BufferAttribute(idx, 1));
      g.computeVertexNormals();
      // fine tiling grain: the aerial photo is ~0.5 m per pixel, so close-up ground needs its own detail
      const grain = canvasTexture(256, (ctx, s) => {
        ctx.fillStyle = '#808080';
        ctx.fillRect(0, 0, s, s);
        for (let k = 0; k < 9000; k++) {
          const v = 70 + Math.floor(rng() * 110);
          ctx.fillStyle = `rgba(${v},${v},${v},0.5)`;
          ctx.fillRect(rng() * s, rng() * s, 1 + rng() * 2, 1 + rng() * 2);
        }
      }, false);
      grain.channel = 1;
      const terrain = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: photo, roughness: 1, bumpMap: grain, bumpScale: 1.6, aoMap: grain, aoMapIntensity: 0.55 }));
      terrain.receiveShadow = true;
      this.group.add(terrain);

      // surroundings: a coarse skirt that continues the edge heights, textured with a wide aerial photo
      const far = new THREE.Texture(data.far);
      far.colorSpace = THREE.SRGBColorSpace;
      far.needsUpdate = true;
      const fs = data.farScale, n = 72;
      const fg = new THREE.PlaneGeometry(2 * hx * fs, 2 * hz * fs, n, n);
      fg.rotateX(-Math.PI / 2);
      const fp = fg.attributes.position;
      for (let q = 0; q < fp.count; q++) {
        const x = fp.getX(q), z = fp.getZ(q);
        const insideMap = Math.abs(x) < hx - 1 && Math.abs(z) < hz - 1;
        fp.setY(q, H(x, z) - (insideMap ? 3 : 0.4));
      }
      fg.computeVertexNormals();
      this.group.add(new THREE.Mesh(fg, new THREE.MeshStandardMaterial({ map: far, roughness: 1 })));
    }

    // ---------- roads
    const asphalt = (marks: (ctx: CanvasRenderingContext2D, s: number) => void, base = '#5d6067') =>
      canvasTexture(256, (ctx, s) => {
        ctx.fillStyle = base;
        ctx.fillRect(0, 0, s, s);
        for (let k = 0; k < 2600; k++) {
          const v = 70 + Math.floor(rng() * 60);
          ctx.fillStyle = `rgba(${v},${v},${v + 3},0.35)`;
          ctx.fillRect(rng() * s, rng() * s, 1.6, 1.6);
        }
        marks(ctx, s);
      });
    const line = 'rgba(238,238,232,0.92)';
    const roadMat = (tex: THREE.Texture, offset: number) => {
      const m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.92, polygonOffset: true, polygonOffsetFactor: offset, polygonOffsetUnits: offset });
      this.markMats.push(m);
      return m;
    };
    const mats = [
      roadMat(asphalt((ctx, s) => { ctx.fillStyle = line; ctx.fillRect(6, 0, 4, s); ctx.fillRect(s - 10, 0, 4, s); ctx.fillRect(s / 2 - 2, 0, 4, s * 0.5); }), -4), // two-way
      roadMat(asphalt((ctx, s) => { ctx.fillStyle = line; ctx.fillRect(6, 0, 4, s); ctx.fillRect(s - 10, 0, 4, s); ctx.fillRect(s / 3 - 2, 0, 3, s * 0.45); ctx.fillRect((s * 2) / 3 - 2, 0, 3, s * 0.45); }), -4), // one-way, lanes
      roadMat(asphalt(() => {}), -3), // residential / service
      roadMat(asphalt((ctx, s) => { ctx.strokeStyle = 'rgba(90,80,70,0.5)'; for (let k = 0; k <= 8; k++) { ctx.strokeRect(k * 32, 0, 32, s); ctx.strokeRect(0, k * 32, s, 32); } }, '#b9aa98'), -2), // pedestrian street
      roadMat(asphalt(() => {}, '#a89f8f'), -1), // footpath
      roadMat(asphalt(() => {}), -5), // junction caps
    ];
    const rb = mats.map(() => new GeoBuilder());
    const tmp: number[] = [];
    for (const e of data.edges) {
      const b = rb[e.k >= 6 ? 4 : e.k === 5 ? 3 : e.k >= 3 ? 2 : e.oneway ? (e.w >= 9 ? 1 : 2) : 0];
      // resample so the ribbon follows the terrain
      tmp.length = 0;
      const p = e.pts;
      for (let i = 0; i < p.length - 2; i += 2) {
        const sx = p[i + 2] - p[i], sz = p[i + 3] - p[i + 1], n = Math.max(1, Math.ceil(Math.hypot(sx, sz) / 5));
        for (let s = 0; s < n; s++) tmp.push(p[i] + (sx * s) / n, p[i + 1] + (sz * s) / n);
      }
      tmp.push(p[p.length - 2], p[p.length - 1]);
      const m = tmp.length / 2, half = e.w / 2, lift = 0.07 + (6 - e.k) * 0.012;
      let run = 0, prevL = -1, prevR = -1;
      for (let i = 0; i < m; i++) {
        const i0 = Math.max(0, i - 1), i1 = Math.min(m - 1, i + 1);
        let dx = tmp[i1 * 2] - tmp[i0 * 2], dz = tmp[i1 * 2 + 1] - tmp[i0 * 2 + 1];
        const l = Math.hypot(dx, dz) || 1;
        dx /= l; dz /= l;
        if (i > 0) run += Math.hypot(tmp[i * 2] - tmp[i * 2 - 2], tmp[i * 2 + 1] - tmp[i * 2 - 1]);
        const x = tmp[i * 2], z = tmp[i * 2 + 1];
        const lx = x + dz * half, lz = z - dx * half, rx = x - dz * half, rz = z + dx * half;
        const L = b.vert(lx, H(lx, lz) + lift, lz, 0, 1, 0, 0, run / 10, white);
        const R = b.vert(rx, H(rx, rz) + lift, rz, 0, 1, 0, 1, run / 10, white);
        if (i > 0) b.quad(prevL, prevR, R, L);
        prevL = L; prevR = R;
      }
      // spatial hash of segments for nearest-road queries
      for (let i = 0; i < p.length - 2; i += 2) {
        const steps = Math.max(1, Math.ceil(Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]) / 30));
        for (let s = 0; s <= steps; s++) {
          const k = this.cellKey(p[i] + ((p[i + 2] - p[i]) * s) / steps, p[i + 1] + ((p[i + 3] - p[i + 1]) * s) / steps);
          let list = this.segHash.get(k);
          if (!list) this.segHash.set(k, (list = []));
          const code = e.id * 4096 + i / 2;
          if (list[list.length - 1] !== code) list.push(code);
        }
      }
    }
    // junction caps hide overlapping lane paint
    for (let n = 0; n < data.adj.length; n++) {
      const es = data.adj[n].map((id) => data.edges[id]).filter((e) => e.car);
      if (es.length < 3) continue;
      const r = Math.max(...es.map((e) => e.w)) * 0.56, x = data.nodes[n * 2], z = data.nodes[n * 2 + 1];
      const b = rb[5], c = b.vert(x, H(x, z) + 0.16, z, 0, 1, 0, 0.5, 0.5, white);
      let prev = -1, first = -1;
      for (let k = 0; k < 14; k++) {
        const a = (k / 14) * Math.PI * 2, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
        const v = b.vert(px, H(px, pz) + 0.16, pz, 0, 1, 0, 0.5 + Math.cos(a) * 0.4, 0.5 + Math.sin(a) * 0.4, white);
        if (prev >= 0) b.idx.push(c, v, prev);
        else first = v;
        prev = v;
      }
      b.idx.push(c, first, prev);
    }
    rb.forEach((b, k) => {
      if (!b.idx.length) return;
      const mesh = new THREE.Mesh(b.build(), mats[k]);
      mesh.receiveShadow = true;
      mesh.renderOrder = 1;
      this.group.add(mesh);
    });

    // ---------- buildings: extruded real footprints
    const styles = [0, 1, 2, 3].map((s) => facade(s, rng));
    const wallB = styles.map(() => new GeoBuilder());
    const roofB = new GeoBuilder();
    const TINT = [
      [0xe8e2d6, 0xd9cdb8, 0xcfc6ba, 0xe6d8c8, 0xbfb8ae, 0xd4d9dc, 0xc8b79f, 0xf0ece4],
      [0xe9e6df, 0xd8d2c8, 0xcdd3d6, 0xe4d9cc, 0xc4bdb2, 0xf2efe8],
      [0xdfe2e4, 0xcfd3d6, 0xe8e4dc, 0xbfc6cc, 0xd6cfc4],
      [0xbfd4e6, 0xa9c3d8, 0xcfe0ea, 0x9fb6c8, 0xd8e6ee],
    ];
    const extrude = (pts: ArrayLike<number>, base: number, top: number, style: number, tint: number, roof = true) => {
      const n = pts.length / 2, b = wallB[style];
      col.setHex(tint);
      let run = Math.floor(rng() * 8) * 3.2;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const ax = pts[i * 2], az = pts[i * 2 + 1], bx = pts[j * 2], bz = pts[j * 2 + 1];
        const len = Math.hypot(bx - ax, bz - az);
        if (len < 0.05) continue;
        const nxn = (bz - az) / len, nzn = -(bx - ax) / len; // outward for CCW footprints
        const bays = Math.max(1, Math.round(len / 3.2)), floors = Math.max(1, Math.round((top - base) / 3.2));
        const u0 = run / 25.6, u1 = u0 + bays / 8, v1 = floors / 8;
        run += bays * 3.2;
        const v0i = b.vert(ax, base, az, nxn, 0, nzn, u1, 0, col);
        const v1i = b.vert(bx, base, bz, nxn, 0, nzn, u0, 0, col);
        const v2i = b.vert(bx, top, bz, nxn, 0, nzn, u0, v1, col);
        const v3i = b.vert(ax, top, az, nxn, 0, nzn, u1, v1, col);
        b.quad(v1i, v0i, v3i, v2i);
      }
      if (!roof) return;
      const contour: THREE.Vector2[] = [];
      for (let i = 0; i < n; i++) contour.push(new THREE.Vector2(pts[i * 2], pts[i * 2 + 1]));
      const start = roofB.pos.length / 3;
      for (let i = 0; i < n; i++) roofB.vert(pts[i * 2], top, pts[i * 2 + 1], 0, 1, 0, U(pts[i * 2]), V(pts[i * 2 + 1]), white);
      for (const f of THREE.ShapeUtils.triangulateShape(contour, [])) roofB.idx.push(start + f[0], start + f[2], start + f[1]);
    };
    const scaled = (pts: Float32Array, s: number) => {
      let cx = 0, cz = 0;
      for (let i = 0; i < pts.length; i += 2) { cx += pts[i]; cz += pts[i + 1]; }
      cx /= pts.length / 2; cz /= pts.length / 2;
      return Float32Array.from(pts, (v, i) => (i % 2 ? cz + (v - cz) * s : cx + (v - cx) * s));
    };
    const T = PLACES.tsutenkaku;
    for (const bd of data.buildings) {
      const p = bd.pts;
      let lo = Infinity, hi = -Infinity, cx = 0, cz = 0;
      for (let i = 0; i < p.length; i += 2) {
        const h = H(p[i], p[i + 1]);
        lo = Math.min(lo, h); hi = Math.max(hi, h);
        cx += p[i]; cz += p[i + 1];
      }
      cx /= p.length / 2; cz /= p.length / 2;
      if (Math.hypot(cx - T.x, cz - T.z) < 26) continue; // replaced by the tower model below
      this.buildingCount++;
      const base = lo - 0.6;
      if (bd.h > 200) {
        // Abeno Harukas: three stepped glass volumes on the real footprint
        const tiers: [number, number][] = [[1, 82], [0.74, 158], [0.54, bd.h]];
        let from = base;
        for (const [s, top] of tiers) {
          const q = s === 1 ? p : scaled(p, s);
          extrude(q, from, hi + top, 3, 0xc4d8e8);
          this.collision.addPoly(q, hi + top);
          from = hi + top;
        }
        continue;
      }
      const top = hi + bd.h;
      const style = bd.h < 9.5 ? 0 : bd.h < 26 ? (rng() < 0.6 ? 1 : 2) : bd.h < 70 ? (rng() < 0.5 ? 2 : 3) : 3;
      const tints = TINT[style];
      extrude(p, base, top, style, tints[Math.floor(rng() * tints.length)]);
      this.collision.addPoly(p, top);
    }
    styles.forEach((s, k) => {
      const m = new THREE.MeshStandardMaterial({
        map: s.map, vertexColors: true, emissive: 0xffffff, emissiveMap: s.emissive, emissiveIntensity: 0,
        roughness: k === 3 ? 0.28 : 0.82, metalness: k === 3 ? 0.35 : 0,
      });
      this.facadeMats.push(m);
      const mesh = new THREE.Mesh(wallB[k].build(), m);
      mesh.castShadow = mesh.receiveShadow = true;
      this.group.add(mesh);
    });
    const roofMesh = new THREE.Mesh(roofB.build(), new THREE.MeshStandardMaterial({ map: photo, roughness: 0.95 }));
    roofMesh.receiveShadow = true;
    this.group.add(roofMesh);

    this.buildTsutenkaku(H(T.x, T.z));

    // ---------- trees: mapped ones plus a scatter inside parks and temple grounds
    const treeSpots: { x: number; z: number; s: number }[] = [];
    for (let i = 0; i < data.trees.length; i += 2) treeSpots.push({ x: data.trees[i], z: data.trees[i + 1], s: 0.9 + rng() * 0.6 });
    for (const g of data.green) {
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity, area = 0;
      for (let i = 0, j = g.length - 2; i < g.length; j = i, i += 2) {
        x0 = Math.min(x0, g[i]); x1 = Math.max(x1, g[i]); z0 = Math.min(z0, g[i + 1]); z1 = Math.max(z1, g[i + 1]);
        area += g[j] * g[i + 1] - g[i] * g[j + 1];
      }
      const want = Math.min(70, Math.floor(Math.abs(area) / 2 / 260));
      for (let k = 0, tries = 0; k < want && tries < want * 6; tries++) {
        const x = x0 + rng() * (x1 - x0), z = z0 + rng() * (z1 - z0);
        if (Math.abs(x) > hx - 6 || Math.abs(z) > hz - 6 || !this.inRing(g, x, z)) continue;
        if (this.collision.pointBlocked(x, 0, z, 1.5)) continue;
        const near = this.nearestRoad(x, z, () => true, 12);
        if (near && near.dist < near.edge.w / 2 + 1.5) continue;
        treeSpots.push({ x, z, s: 1 + rng() * 0.9 });
        k++;
      }
    }
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1);
    const trunkGeo = new THREE.CylinderGeometry(0.16, 0.24, 1, 6);
    trunkGeo.translate(0, 0.5, 0);
    const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: 0x5f4630, roughness: 1 }), treeSpots.length);
    const leaves = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true }), treeSpots.length);
    treeSpots.forEach((t, k) => {
      const y = H(t.x, t.z), th = 3.2 * t.s;
      trunks.setMatrixAt(k, m4.compose(new THREE.Vector3(t.x, y, t.z), q.identity(), new THREE.Vector3(1.4, th, 1.4)));
      leaves.setMatrixAt(k, m4.compose(new THREE.Vector3(t.x, y + th + 1.1 * t.s, t.z), q.identity(), new THREE.Vector3(2.3 * t.s, 2.5 * t.s, 2.3 * t.s)));
      leaves.setColorAt(k, col.setHSL(0.27 + rng() * 0.08, 0.5, 0.2 + rng() * 0.1));
      this.collision.add({ x0: t.x - 0.3, z0: t.z - 0.3, x1: t.x + 0.3, z1: t.z + 0.3, top: y + 3 });
    });
    trunks.castShadow = leaves.castShadow = true;

    // ---------- street lamps along the main roads
    const lampSpots: { x: number; z: number; gx: number; gz: number; rot: number }[] = [];
    for (const e of this.aiEdges) {
      const p = e.pts;
      let carry = 14 + rng() * 10, side = rng() < 0.5 ? 1 : -1;
      for (let i = 0; i < p.length - 2; i += 2) {
        const sx = p[i + 2] - p[i], sz = p[i + 3] - p[i + 1], len = Math.hypot(sx, sz);
        if (len < 0.1) continue;
        const dx = sx / len, dz = sz / len;
        while (carry < len) {
          const x = p[i] + dx * carry + dz * side * (e.w / 2 + 0.7), z = p[i + 1] + dz * carry - dx * side * (e.w / 2 + 0.7);
          if (!this.collision.pointBlocked(x, 0, z, 0.4))
            lampSpots.push({ x, z, gx: x - dz * side * 2.6, gz: z + dx * side * 2.6, rot: Math.atan2(-dz * side, dx * side) });
          carry += 38;
          side = -side;
        }
        carry -= len;
      }
    }
    const poleGeo = new THREE.CylinderGeometry(0.07, 0.11, 7, 5);
    poleGeo.translate(0, 3.5, 0);
    const poles = new THREE.InstancedMesh(poleGeo, new THREE.MeshStandardMaterial({ color: 0x6f747a, roughness: 0.5 }), lampSpots.length);
    const bulbGeo = new THREE.BoxGeometry(0.5, 0.14, 1.6);
    bulbGeo.translate(0, 7, 0.7);
    this.lampBulb = new THREE.MeshStandardMaterial({ color: 0x55585c, emissive: 0xffe2a8, emissiveIntensity: 0 });
    const bulbs = new THREE.InstancedMesh(bulbGeo, this.lampBulb, lampSpots.length);
    const glowTex = canvasTexture(64, (ctx, s) => {
      const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      g.addColorStop(0, 'rgba(255,225,160,0.55)');
      g.addColorStop(1, 'rgba(255,225,160,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
    });
    const glowGeo = new THREE.PlaneGeometry(15, 15);
    glowGeo.rotateX(-Math.PI / 2);
    this.lampGlow = new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0, polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -8 });
    this.glows = new THREE.InstancedMesh(glowGeo, this.lampGlow, lampSpots.length);
    lampSpots.forEach((l, k) => {
      q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, l.rot);
      m4.compose(new THREE.Vector3(l.x, H(l.x, l.z), l.z), q, one);
      poles.setMatrixAt(k, m4);
      bulbs.setMatrixAt(k, m4);
      this.glows.setMatrixAt(k, m4.compose(new THREE.Vector3(l.gx, H(l.gx, l.gz) + 0.25, l.gz), q.identity(), one));
    });
    this.glows.visible = false;
    this.glows.renderOrder = 2;
    this.group.add(trunks, leaves, poles, bulbs, this.glows);
    for (const m of [trunks, leaves, poles, bulbs, this.glows]) m.frustumCulled = false;
  }

  /** Lattice observation tower standing over the Shinsekai crossroads; traffic passes between its legs. */
  private buildTsutenkaku(ground: number) {
    const { x, z } = PLACES.tsutenkaku;
    const steel = 0x8f979f, deck = 0xe9e6e0, glass = 0x1c2630;
    const parts: BoxPart[] = [];
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        parts.push({ size: [2.6, 30, 2.6], pos: [sx * 8.6, 14, sz * 8.6], color: steel, rot: [sz * -0.13, 0, sx * 0.13] });
        this.collision.add({ x0: x + sx * 9.6 - 1.7, z0: z + sz * 9.6 - 1.7, x1: x + sx * 9.6 + 1.7, z1: z + sz * 9.6 + 1.7, top: ground + 28 });
      }
    for (const y of [9, 18]) {
      parts.push({ size: [19, 0.7, 0.7], pos: [0, y, 8.2], color: steel }, { size: [19, 0.7, 0.7], pos: [0, y, -8.2], color: steel });
      parts.push({ size: [0.7, 0.7, 19], pos: [8.2, y, 0], color: steel }, { size: [0.7, 0.7, 19], pos: [-8.2, y, 0], color: steel });
    }
    parts.push({ size: [17, 3.4, 17], pos: [0, 29.5, 0], color: deck }, { size: [17.2, 1.4, 17.2], pos: [0, 30, 0], color: glass });
    // shaft with neon edges
    parts.push({ size: [9, 50, 9], pos: [0, 56, 0], color: steel });
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) parts.push({ size: [0.5, 50, 0.5], pos: [sx * 4.6, 56, sz * 4.6], color: sx * sz > 0 ? 0x3fd0ff : 0xff5fb0, glow: 2.2 });
    for (let y = 36; y < 80; y += 6) parts.push({ size: [9.3, 0.5, 9.3], pos: [0, y, 0], color: 0x6f777f });
    // observation decks, crown and mast
    parts.push({ size: [14, 4, 14], pos: [0, 83, 0], color: deck }, { size: [14.2, 1.6, 14.2], pos: [0, 83.4, 0], color: glass });
    parts.push({ size: [16.5, 5.5, 16.5], pos: [0, 88, 0], color: deck }, { size: [16.7, 2.2, 16.7], pos: [0, 88.6, 0], color: glass });
    parts.push({ size: [16.9, 0.5, 16.9], pos: [0, 91, 0], color: 0xffd23c, glow: 2 });
    parts.push({ size: [10, 3.5, 10], pos: [0, 93, 0], color: deck }, { size: [3, 5, 3], pos: [0, 97, 0], color: steel }, { size: [0.8, 9, 0.8], pos: [0, 103.5, 0], color: 0xd33a2c });
    const tower = new THREE.Mesh(mergeBoxes(parts), vertexColorMaterial);
    tower.position.set(x, ground, z);
    tower.castShadow = true;
    this.group.add(tower);
  }

  // ------------------------------------------------------------------ queries
  private cellKey(x: number, z: number) {
    return (Math.floor(x / 40) + 512) * 1024 + (Math.floor(z / 40) + 512);
  }
  private inRing(g: Float32Array, x: number, z: number) {
    let c = false;
    for (let i = 0, j = g.length - 2; i < g.length; j = i, i += 2)
      if (g[i + 1] > z !== g[j + 1] > z && x < ((g[j] - g[i]) * (z - g[i + 1])) / (g[j + 1] - g[i + 1]) + g[i]) c = !c;
    return c;
  }

  /** 0 (day) .. 1 (night): drives window and street-lamp emissives. */
  setNight(n: number) {
    for (const m of this.facadeMats) m.emissiveIntensity = n * 0.9;
    this.lampBulb.emissiveIntensity = n * 2.5;
    this.lampGlow.opacity = n * 0.8;
    this.glows.visible = n > 0.02;
  }

  groundHeight(x: number, z: number) {
    return terrainHeight(this.data, x, z);
  }

  districtName(x: number, z: number) {
    let best = '', bd = Infinity;
    for (const p of Object.values(PLACES)) {
      const d = (p.x - x) ** 2 + (p.z - z) ** 2;
      if (d < bd) { bd = d; best = p.name; }
    }
    return best;
  }

  /** Closest point on a road that passes `accept`, searching up to `maxDist` metres. */
  nearestRoad(x: number, z: number, accept: (e: Edge) => boolean, maxDist = 400): RoadHit | null {
    let best: RoadHit | null = null, bd = maxDist;
    const reach = Math.ceil(maxDist / 40), cx = Math.floor(x / 40), cz = Math.floor(z / 40);
    for (let ring = 0; ring <= reach; ring++) {
      if (best && bd < (ring - 1) * 40) break;
      for (let i = cx - ring; i <= cx + ring; i++)
        for (let j = cz - ring; j <= cz + ring; j++) {
          if (Math.max(Math.abs(i - cx), Math.abs(j - cz)) !== ring) continue;
          const list = this.segHash.get((i + 512) * 1024 + (j + 512));
          if (!list) continue;
          for (const code of list) {
            const e = this.data.edges[Math.floor(code / 4096)], s = (code % 4096) * 2, p = e.pts;
            if (!accept(e)) continue;
            const ex = p[s + 2] - p[s], ez = p[s + 3] - p[s + 1], len2 = ex * ex + ez * ez || 1;
            const t = Math.max(0, Math.min(1, ((x - p[s]) * ex + (z - p[s + 1]) * ez) / len2));
            const qx = p[s] + ex * t, qz = p[s + 1] + ez * t, d = Math.hypot(x - qx, z - qz);
            if (d < bd) {
              const len = Math.sqrt(len2);
              bd = d;
              best = { edge: e, seg: s / 2, x: qx, z: qz, dx: ex / len, dz: ez / len, dist: d };
            }
          }
        }
    }
    return best;
  }

  /** A point on the carriageway near (x,z): used for mission targets and parked vehicles. */
  roadSpot(x: number, z: number) {
    const h = this.nearestRoad(x, z, (e) => e.car && e.k <= 3) ?? this.nearestRoad(x, z, (e) => e.car, 2000)!;
    return { x: h.x, z: h.z, heading: Math.atan2(h.dx, h.dz), hit: h };
  }

  /** A walkable spot beside a road near (x,z), clear of buildings: used for markers, pickups and spawns. */
  sideSpot(x: number, z: number, extra = 1.6) {
    const h = this.roadSpot(x, z).hit;
    for (const side of [1, -1])
      for (const off of [h.edge.w / 2 + extra, h.edge.w / 2 + 0.3, h.edge.w / 2 - 1]) {
        const px = h.x + h.dz * side * off, pz = h.z - h.dx * side * off;
        if (!this.collision.pointBlocked(px, 0, pz, 0.7)) return { x: px, z: pz, heading: Math.atan2(h.dx, h.dz) };
      }
    return { x: h.x, z: h.z, heading: Math.atan2(h.dx, h.dz) };
  }

  /** Nearest open ground to (x,z) with `margin` metres of clearance (for helicopters and packages). */
  clearSpot(x: number, z: number, margin: number) {
    for (let r = 0; r < 120; r += 4)
      for (let a = 0; a < 6.28; a += r ? 0.5 : 7) {
        const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
        if (Math.abs(px) < BOUND.x - 10 && Math.abs(pz) < BOUND.z - 10 && !this.collision.pointBlocked(px, 0, pz, margin)) return { x: px, z: pz };
      }
    return { x, z };
  }

  /**
   * Driving line for an edge in one direction (1: a -> b, -1: b -> a): the centre line
   * shifted to the left of travel on two-way roads (Japan drives on the left).
   */
  lane(e: Edge, dir: 1 | -1) {
    const key = e.id * 2 + (dir > 0 ? 0 : 1);
    let out = this.lanes.get(key);
    if (out) return out;
    const p = e.pts, n = p.length / 2, off = e.oneway ? 0 : e.w / 4;
    out = new Float32Array(p.length);
    for (let k = 0; k < n; k++) {
      const i = dir > 0 ? k : n - 1 - k;
      const i0 = Math.max(0, i - 1), i1 = Math.min(n - 1, i + 1);
      let dx = (p[i1 * 2] - p[i0 * 2]) * dir, dz = (p[i1 * 2 + 1] - p[i0 * 2 + 1]) * dir;
      const l = Math.hypot(dx, dz) || 1;
      dx /= l; dz /= l;
      out[k * 2] = p[i * 2] + dz * off; // left of travel = (dz, -dx)
      out[k * 2 + 1] = p[i * 2 + 1] - dx * off;
    }
    this.lanes.set(key, out);
    return out;
  }
}
