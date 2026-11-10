import * as THREE from 'three';
import { N, BLOCK, ROAD, PITCH, HALF, CITY_EDGE, WORLD_BOUND, CURB, roadCoord, mulberry32 } from '../config';
import { CollisionWorld } from './Collision';

export type District = 'downtown' | 'commercial' | 'residential' | 'industrial' | 'beach' | 'park';

export const DISTRICT_NAMES: Record<District, string> = {
  downtown: 'セントラル・ダウンタウン',
  commercial: 'ミッドタウン商業区',
  residential: 'ウェストサイド住宅街',
  industrial: 'サウスポート工業地帯',
  beach: 'ベラ・ビーチ',
  park: 'パルメラ公園',
};
export const DISTRICT_MAP_COLOR: Record<District, string> = {
  downtown: '#8d95a8',
  commercial: '#a89f8d',
  residential: '#9bb08a',
  industrial: '#8a8580',
  beach: '#d9c9a0',
  park: '#5fa35c',
};

/** Accumulates quads into one BufferGeometry (one draw call for the whole city). */
class GeoBuilder {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  idx: number[] = [];
  quad(p: number[], n: [number, number, number], u0: number, v0: number, u1: number, v1: number, c: THREE.Color) {
    const base = this.pos.length / 3;
    this.pos.push(...p);
    for (let i = 0; i < 4; i++) {
      this.nor.push(n[0], n[1], n[2]);
      this.col.push(c.r, c.g, c.b);
    }
    this.uv.push(u0, v0, u1, v0, u1, v1, u0, v1);
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
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
  t.anisotropy = 4;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class City {
  readonly group = new THREE.Group();
  readonly collision = new CollisionWorld();
  readonly districts: District[][] = [];
  readonly wallMaterial: THREE.MeshStandardMaterial;
  private lampGlow: THREE.MeshBasicMaterial;
  private lampBulb: THREE.MeshStandardMaterial;
  buildingCount = 0;
  private markMats: THREE.MeshBasicMaterial[] = [];

  constructor() {
    const rng = mulberry32(20261110);
    const R = (a: number, b: number) => a + rng() * (b - a);

    // ---------- districts ----------
    const parks = new Set(['3,7', '3,8', '8,3', '6,9', '1,4']);
    for (let i = 0; i < N; i++) {
      this.districts.push([]);
      for (let j = 0; j < N; j++) {
        const dc = Math.max(Math.abs(i - 5.5), Math.abs(j - 5.5));
        let d: District;
        if (parks.has(`${i},${j}`)) d = 'park';
        else if (i >= 10) d = 'beach';
        else if (dc <= 1.5) d = 'downtown';
        else if (j >= 10) d = 'industrial';
        else if (i <= 2) d = 'residential';
        else d = 'commercial';
        this.districts[i].push(d);
      }
    }

    // ---------- ground ----------
    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(6000, 6000),
      new THREE.MeshStandardMaterial({ color: 0x1b6f8f, roughness: 0.25, metalness: 0.3 }),
    );
    water.rotation.x = -Math.PI / 2;
    water.position.y = -0.7;
    this.group.add(water);

    const sandSize = (WORLD_BOUND + 30) * 2;
    const sand = new THREE.Mesh(
      new THREE.BoxGeometry(sandSize, 2, sandSize),
      new THREE.MeshStandardMaterial({ color: 0xd8c690, roughness: 1 }),
    );
    sand.position.y = -1.03;
    sand.receiveShadow = true;
    this.group.add(sand);

    const asphaltTex = canvasTexture(128, (ctx, s) => {
      ctx.fillStyle = '#6a6d74';
      ctx.fillRect(0, 0, s, s);
      for (let k = 0; k < 900; k++) {
        const v = 80 + Math.floor(rng() * 50);
        ctx.fillStyle = `rgba(${v},${v},${v + 4},0.5)`;
        ctx.fillRect(rng() * s, rng() * s, 1.5, 1.5);
      }
    });
    asphaltTex.repeat.set(CITY_EDGE / 4, CITY_EDGE / 4);
    const asphalt = new THREE.Mesh(
      new THREE.PlaneGeometry(CITY_EDGE * 2, CITY_EDGE * 2),
      new THREE.MeshStandardMaterial({ map: asphaltTex, roughness: 0.92 }),
    );
    asphalt.rotation.x = -Math.PI / 2;
    asphalt.receiveShadow = true;
    this.group.add(asphalt);

    // ---------- road markings ----------
    const laneTex = canvasTexture(128, (ctx, s) => {
      ctx.clearRect(0, 0, s, s);
      ctx.fillStyle = '#e3b93c';
      ctx.fillRect(s / 2 - 1.2, 0, 2.4, s * 0.55); // centre dash
      ctx.fillStyle = 'rgba(235,235,235,0.75)';
      const px = (4.6 / ROAD) * s;
      ctx.fillRect(s / 2 - px - 0.8, 0, 1.6, s); // parking lines
      ctx.fillRect(s / 2 + px - 0.8, 0, 1.6, s);
    });
    const laneGeo = new THREE.PlaneGeometry(ROAD, BLOCK - 10);
    laneGeo.rotateX(-Math.PI / 2);
    const luv = laneGeo.attributes.uv;
    for (let k = 0; k < luv.count; k++) luv.setY(k, luv.getY(k) * 7);
    const markMat = (tex: THREE.Texture) => {
      const m = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      this.markMats.push(m);
      return m;
    };
    const lanes = new THREE.InstancedMesh(laneGeo, markMat(laneTex), 2 * N * (N + 1));
    const crossTex = canvasTexture(64, (ctx, s) => {
      ctx.clearRect(0, 0, s, s);
      ctx.fillStyle = 'rgba(240,240,240,0.9)';
      for (let k = 0; k < 8; k++) ctx.fillRect(k * 8 + 1.5, 0, 5, s);
    });
    const crossGeo = new THREE.PlaneGeometry(ROAD - 1, 3);
    crossGeo.rotateX(-Math.PI / 2);
    const cuv = crossGeo.attributes.uv;
    for (let k = 0; k < cuv.count; k++) cuv.setX(k, cuv.getX(k) * 1.5);
    const crosses = new THREE.InstancedMesh(crossGeo, markMat(crossTex), 4 * N * (N + 1));
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const qY90 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
    const one = new THREE.Vector3(1, 1, 1);
    let li = 0, ci = 0;
    for (let a = 0; a <= N; a++)
      for (let b = 0; b < N; b++) {
        const line = roadCoord(a), mid = roadCoord(b) + PITCH / 2;
        // road running along Z at x=line
        lanes.setMatrixAt(li++, m4.compose(new THREE.Vector3(line, 0.03, mid), q.identity(), one));
        // road running along X at z=line
        lanes.setMatrixAt(li++, m4.compose(new THREE.Vector3(mid, 0.03, line), qY90, one));
        for (const s of [-1, 1]) {
          const off = mid + s * (BLOCK / 2 - 2.5);
          crosses.setMatrixAt(ci++, m4.compose(new THREE.Vector3(line, 0.035, off), q.identity(), one));
          crosses.setMatrixAt(ci++, m4.compose(new THREE.Vector3(off, 0.035, line), qY90, one));
        }
      }
    this.group.add(lanes, crosses);

    // ---------- blocks, buildings, props ----------
    const walls = new GeoBuilder();
    const roofs = new GeoBuilder();
    const slabGeo = new THREE.BoxGeometry(1, 1, 1);
    const slabs = new THREE.InstancedMesh(slabGeo, new THREE.MeshStandardMaterial({ roughness: 0.95 }), N * N * 2 + 8);
    slabs.receiveShadow = true;
    let si = 0;
    const col = new THREE.Color();
    const addSlab = (cx: number, cz: number, w: number, d: number, y: number, h: number, hex: number) => {
      slabs.setMatrixAt(si, m4.compose(new THREE.Vector3(cx, y + h / 2, cz), q.identity(), new THREE.Vector3(w, h, d)));
      slabs.setColorAt(si++, col.setHex(hex));
    };

    const treeSpots: { x: number; z: number; s: number; palm: boolean }[] = [];
    const lampSpots: { x: number; z: number; rot: number }[] = [];
    const roofCones: { x: number; z: number; y: number; w: number; d: number; h: number; c: number }[] = [];

    const addBuilding = (cx: number, cz: number, w: number, d: number, h: number, hex: number, y0 = 0, collide = true) => {
      const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2, y1 = y0 + h;
      const c = new THREE.Color(hex);
      const uo = Math.floor(rng() * 8) / 8, vo = Math.floor(rng() * 8) / 8;
      const uw = Math.max(1, Math.round(w / 3)) / 8, ud = Math.max(1, Math.round(d / 3)) / 8, vh = Math.max(1, Math.round(h / 3.2)) / 8;
      walls.quad([x1, y0, z1, x1, y0, z0, x1, y1, z0, x1, y1, z1], [1, 0, 0], uo, vo, uo + ud, vo + vh, c);
      walls.quad([x0, y0, z0, x0, y0, z1, x0, y1, z1, x0, y1, z0], [-1, 0, 0], uo, vo, uo + ud, vo + vh, c);
      walls.quad([x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1], [0, 0, 1], uo, vo, uo + uw, vo + vh, c);
      walls.quad([x1, y0, z0, x0, y0, z0, x0, y1, z0, x1, y1, z0], [0, 0, -1], uo, vo, uo + uw, vo + vh, c);
      roofs.quad([x0, y1, z1, x1, y1, z1, x1, y1, z0, x0, y1, z0], [0, 1, 0], 0, 0, 1, 1, c.clone().multiplyScalar(0.55));
      if (collide) {
        this.collision.add({ x0, z0, x1, z1, top: y1 });
        this.buildingCount++;
      }
    };

    const PASTEL = [0xf4b6c2, 0xa8e0d8, 0xfde4b0, 0xc9d8f5, 0xf7cfa6, 0xe8e2d4, 0xb9e3c6, 0xffffff];
    const GLASS = [0x9fb6cf, 0x8aa5b8, 0xb5c4d6, 0x7f93a8, 0xc8d2dc, 0xa6b4a8];
    const BRICK = [0xb9876a, 0xc9a98a, 0xd6c7ae, 0x9c8f86, 0xbfb4a8, 0xa6785e];
    const HOUSE = [0xf2e6d0, 0xe6d3b8, 0xd9e4ea, 0xf3d9d2, 0xdfe8cf, 0xfaf3e6];
    const ROOF = [0x9a4b3c, 0x6b4a3a, 0x4d5560, 0x7a3e36];
    const IND = [0x8f9499, 0x7b858c, 0xa39a8c, 0x6f7b80];
    const P = <T>(arr: T[]) => arr[Math.floor(rng() * arr.length)];

    for (let i = 0; i < N; i++)
      for (let j = 0; j < N; j++) {
        const d = this.districts[i][j];
        const bx = roadCoord(i) + ROAD / 2, bz = roadCoord(j) + ROAD / 2; // block min corner
        const cx = bx + BLOCK / 2, cz = bz + BLOCK / 2;
        addSlab(cx, cz, BLOCK, BLOCK, 0, CURB, d === 'beach' ? 0xd9d2c0 : 0x9c9c98);
        const lotColor = d === 'park' ? 0x4f9a4a : d === 'residential' ? 0x64a558 : d === 'industrial' ? 0x6e6e6c : d === 'beach' ? 0xe6d9ae : 0x86868a;
        addSlab(cx, cz, BLOCK - 8, BLOCK - 8, CURB, 0.02, lotColor);

        // lamps: 2 per side, close to the curb
        for (const t of [0.25, 0.75]) {
          lampSpots.push({ x: bx + BLOCK * t, z: bz + 0.8, rot: Math.PI });
          lampSpots.push({ x: bx + BLOCK * t, z: bz + BLOCK - 0.8, rot: 0 });
          lampSpots.push({ x: bx + 0.8, z: bz + BLOCK * t, rot: -Math.PI / 2 });
          lampSpots.push({ x: bx + BLOCK - 0.8, z: bz + BLOCK * t, rot: Math.PI / 2 });
        }
        // street trees at mid-side
        if (d === 'beach' || d === 'downtown' || (d === 'commercial' && rng() < 0.6)) {
          const palm = d !== 'commercial';
          for (const t of [0.08, 0.5, 0.92]) {
            treeSpots.push({ x: bx + BLOCK * t, z: bz + 1.1, s: R(0.9, 1.2), palm });
            treeSpots.push({ x: bx + BLOCK * t, z: bz + BLOCK - 1.1, s: R(0.9, 1.2), palm });
          }
        }

        const inner = BLOCK - 10; // buildable area (5 m in from the block edge)
        const ox = bx + 5, oz = bz + 5;
        const lots = (nx: number, nz: number, fn: (lx: number, lz: number, lw: number, ld: number) => void) => {
          const lw = inner / nx, ld = inner / nz;
          for (let a = 0; a < nx; a++) for (let b = 0; b < nz; b++) fn(ox + lw * (a + 0.5), oz + ld * (b + 0.5), lw, ld);
        };

        if (d === 'downtown') {
          lots(2, 2, (lx, lz, lw, ld) => {
            const w = R(16, lw - 2), dd = R(16, ld - 2), h = R(32, 70) + (rng() < 0.3 ? R(20, 60) : 0);
            const c = P(GLASS);
            addBuilding(lx, lz, w, dd, h, c);
            if (rng() < 0.55) addBuilding(lx, lz, w * 0.62, dd * 0.62, R(8, 26), c, h, false);
          });
        } else if (d === 'commercial') {
          lots(3, 2, (lx, lz, lw, ld) => {
            if (rng() < 0.08) return;
            addBuilding(lx, lz, R(11, lw - 1.5), R(16, ld - 2), R(8, 26), P(BRICK));
          });
        } else if (d === 'residential') {
          lots(3, 3, (lx, lz, lw, ld) => {
            if (rng() < 0.15) {
              treeSpots.push({ x: lx + R(-3, 3), z: lz + R(-3, 3), s: R(1, 1.5), palm: false });
              return;
            }
            const w = R(8, 11), dd = R(8, 11), h = R(3.6, 6.4);
            addBuilding(lx, lz, w, dd, h, P(HOUSE));
            roofCones.push({ x: lx, z: lz, y: h, w: w + 0.8, d: dd + 0.8, h: R(1.8, 2.8), c: P(ROOF) });
            if (rng() < 0.5) treeSpots.push({ x: lx + lw / 2 - 1, z: lz + ld / 2 - 1, s: R(0.8, 1.2), palm: false });
          });
        } else if (d === 'industrial') {
          lots(2, 1, (lx, lz, lw, ld) => {
            addBuilding(lx, lz, R(18, lw - 2), R(34, ld - 3), R(8, 15), P(IND));
          });
        } else if (d === 'beach') {
          lots(2, 2, (lx, lz, lw, ld) => {
            if (rng() < 0.2) {
              for (let k = 0; k < 3; k++) treeSpots.push({ x: lx + R(-8, 8), z: lz + R(-8, 8), s: R(1, 1.4), palm: true });
              return;
            }
            const w = R(14, lw - 3), dd = R(14, ld - 3), h = R(10, 34);
            const c = P(PASTEL);
            addBuilding(lx, lz, w, dd, h, c);
            if (rng() < 0.4) addBuilding(lx, lz, w * 0.7, dd * 0.7, R(4, 9), c, h, false);
          });
        } else {
          // park: trees and a central plaza
          for (let k = 0; k < 16; k++) {
            const tx = R(ox, ox + inner), tz = R(oz, oz + inner);
            if (Math.abs(tx - cx) < 7 && Math.abs(tz - cz) < 7) continue;
            treeSpots.push({ x: tx, z: tz, s: R(1, 1.8), palm: rng() < 0.25 });
          }
          addBuilding(cx, cz, 5, 5, 0.9, 0xbfc4c8); // fountain base
          addBuilding(cx, cz, 1.2, 1.2, 2.2, 0xd8dde0, 0.9, false);
        }
      }
    // palms on the sand around the island
    for (let k = 0; k < 90; k++) {
      const side = Math.floor(rng() * 4), t = R(-CITY_EDGE, CITY_EDGE), o = CITY_EDGE + R(6, 36);
      const x = side === 0 ? o : side === 1 ? -o : t, z = side === 2 ? o : side === 3 ? -o : t;
      treeSpots.push({ x, z, s: R(1, 1.5), palm: true });
    }
    slabs.count = si;
    slabs.instanceMatrix.needsUpdate = true;
    this.group.add(slabs);

    // ---------- building meshes ----------
    const winTex = canvasTexture(512, (ctx, s) => {
      ctx.fillStyle = '#dcdcdc';
      ctx.fillRect(0, 0, s, s);
      for (let a = 0; a < 8; a++)
        for (let b = 0; b < 8; b++) {
          const v = 45 + Math.floor(rng() * 30);
          ctx.fillStyle = `rgb(${v},${v + 14},${v + 34})`;
          ctx.fillRect(a * 64 + 9, b * 64 + 12, 46, 38);
          ctx.fillStyle = 'rgba(255,255,255,0.13)';
          ctx.fillRect(a * 64 + 9, b * 64 + 12, 46, 9);
        }
    });
    const litTex = canvasTexture(512, (ctx, s) => {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, s, s);
      const cols = ['#ffd58a', '#ffe9b8', '#cfe4ff', '#ffc070'];
      for (let a = 0; a < 8; a++)
        for (let b = 0; b < 8; b++) {
          if (rng() > 0.42) continue;
          ctx.fillStyle = cols[Math.floor(rng() * cols.length)];
          ctx.fillRect(a * 64 + 9, b * 64 + 12, 46, 38);
        }
    });
    this.wallMaterial = new THREE.MeshStandardMaterial({
      map: winTex,
      vertexColors: true,
      roughness: 0.75,
      emissive: 0xffffff,
      emissiveMap: litTex,
      emissiveIntensity: 0,
    });
    const wallMesh = new THREE.Mesh(walls.build(), this.wallMaterial);
    wallMesh.castShadow = wallMesh.receiveShadow = true;
    const roofMesh = new THREE.Mesh(roofs.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }));
    roofMesh.receiveShadow = true;
    this.group.add(wallMesh, roofMesh);

    // house roofs
    const coneGeo = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4);
    coneGeo.rotateY(Math.PI / 4);
    coneGeo.translate(0, 0.5, 0);
    const cones = new THREE.InstancedMesh(coneGeo, new THREE.MeshStandardMaterial({ roughness: 0.85, flatShading: true }), roofCones.length);
    roofCones.forEach((r, k) => {
      cones.setMatrixAt(k, m4.compose(new THREE.Vector3(r.x, r.y, r.z), q.identity(), new THREE.Vector3(r.w, r.h, r.d)));
      cones.setColorAt(k, col.setHex(r.c));
    });
    cones.castShadow = true;
    this.group.add(cones);

    // ---------- trees ----------
    const trunkGeo = new THREE.CylinderGeometry(0.16, 0.24, 1, 6);
    trunkGeo.translate(0, 0.5, 0);
    const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 1 }), treeSpots.length);
    const leafGeo = new THREE.IcosahedronGeometry(1, 1);
    const leaves = new THREE.InstancedMesh(leafGeo, new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true }), treeSpots.length);
    treeSpots.forEach((t, k) => {
      const y = this.groundHeight(t.x, t.z);
      const th = (t.palm ? 6.5 : 3) * t.s;
      trunks.setMatrixAt(k, m4.compose(new THREE.Vector3(t.x, y, t.z), q.identity(), new THREE.Vector3(t.palm ? 0.9 : 1.4, th, t.palm ? 0.9 : 1.4)));
      const ls = t.palm ? new THREE.Vector3(2.6 * t.s, 0.7 * t.s, 2.6 * t.s) : new THREE.Vector3(2.2 * t.s, 2.4 * t.s, 2.2 * t.s);
      leaves.setMatrixAt(k, m4.compose(new THREE.Vector3(t.x, y + th + (t.palm ? 0.1 : 1.2 * t.s), t.z), q.identity(), ls));
      leaves.setColorAt(k, col.setHSL(t.palm ? 0.27 : 0.3 + rng() * 0.06, 0.55, 0.28 + rng() * 0.1));
      this.collision.add({ x0: t.x - 0.3, z0: t.z - 0.3, x1: t.x + 0.3, z1: t.z + 0.3, top: y + 3 });
    });
    trunks.castShadow = leaves.castShadow = true;
    this.group.add(trunks, leaves);

    // ---------- street lamps ----------
    const poleGeo = new THREE.CylinderGeometry(0.07, 0.11, 6.5, 5);
    poleGeo.translate(0, 3.25, 0);
    const poles = new THREE.InstancedMesh(poleGeo, new THREE.MeshStandardMaterial({ color: 0x3c4046, roughness: 0.6 }), lampSpots.length);
    const bulbGeo = new THREE.BoxGeometry(0.5, 0.14, 1.5);
    bulbGeo.translate(0, 6.5, 0.6);
    this.lampBulb = new THREE.MeshStandardMaterial({ color: 0x55585c, emissive: 0xffe2a8, emissiveIntensity: 0 });
    const bulbs = new THREE.InstancedMesh(bulbGeo, this.lampBulb, lampSpots.length);
    const glowTex = canvasTexture(64, (ctx, s) => {
      const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      g.addColorStop(0, 'rgba(255,225,160,0.55)');
      g.addColorStop(1, 'rgba(255,225,160,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
    });
    const glowGeo = new THREE.PlaneGeometry(13, 13);
    glowGeo.rotateX(-Math.PI / 2);
    this.lampGlow = new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    const glows = new THREE.InstancedMesh(glowGeo, this.lampGlow, lampSpots.length);
    lampSpots.forEach((l, k) => {
      q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, l.rot);
      m4.compose(new THREE.Vector3(l.x, CURB, l.z), q, one);
      poles.setMatrixAt(k, m4);
      bulbs.setMatrixAt(k, m4);
      glows.setMatrixAt(k, m4.compose(new THREE.Vector3(l.x + Math.sin(l.rot) * 2.5, 0.05, l.z + Math.cos(l.rot) * 2.5), q.identity(), one));
    });
    glows.visible = false;
    this.glows = glows;
    this.group.add(poles, bulbs, glows);
    // instanced meshes span the whole city: skip per-object frustum culling
    for (const m of [lanes, crosses, slabs, cones, trunks, leaves, poles, bulbs, glows]) m.frustumCulled = false;
  }
  private glows: THREE.InstancedMesh;

  /** 0 (day) .. 1 (night): drives window and street-lamp emissives. */
  setNight(n: number) {
    this.wallMaterial.emissiveIntensity = n * 0.9;
    this.lampBulb.emissiveIntensity = n * 2.5;
    this.lampGlow.opacity = n * 0.8;
    this.glows.visible = n > 0.02;
    // unlit road paint would glare in the dark: dim it with the daylight
    for (const m of this.markMats) m.color.setScalar(1 - n * 0.72);
  }

  inBlock(x: number, z: number) {
    if (Math.abs(x) >= HALF || Math.abs(z) >= HALF) return false;
    const mx = (x + HALF) % PITCH, mz = (z + HALF) % PITCH;
    return mx > ROAD / 2 && mx < PITCH - ROAD / 2 && mz > ROAD / 2 && mz < PITCH - ROAD / 2;
  }
  groundHeight(x: number, z: number) {
    return this.inBlock(x, z) ? CURB : 0;
  }
  districtAt(x: number, z: number): District | null {
    if (Math.abs(x) > CITY_EDGE || Math.abs(z) > CITY_EDGE) return null;
    const i = Math.max(0, Math.min(N - 1, Math.floor((x + HALF) / PITCH)));
    const j = Math.max(0, Math.min(N - 1, Math.floor((z + HALF) / PITCH)));
    return this.districts[i][j];
  }
  /** Sidewalk corner k (0..3) of block (i,j), inset from the curb. */
  blockCorner(i: number, j: number, k: number, inset = 2.6) {
    const x0 = roadCoord(i) + ROAD / 2 + inset, z0 = roadCoord(j) + ROAD / 2 + inset;
    const x1 = x0 + BLOCK - inset * 2, z1 = z0 + BLOCK - inset * 2;
    return { x: k === 0 || k === 3 ? x0 : x1, z: k < 2 ? z0 : z1 };
  }
}
