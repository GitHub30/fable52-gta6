import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

export interface BoxPart {
  size: [number, number, number];
  pos: [number, number, number];
  color: number;
  rot?: [number, number, number];
  /** >1 multiplies the vertex colour so the part stays bright at night (lamps). */
  glow?: number;
  /** Render as a cylinder lying along X: size = [width, diameter, diameter]. Used for wheels. */
  cyl?: boolean;
  /** High-detail models only: corner radius as a fraction of the smallest half-extent (1 = fully round). */
  round?: number;
}

/** Model detail: 0 = low-poly boxes, 1 = bevelled high-poly, 2 = the same with denser tessellation. */
export type ModelDetail = 0 | 1 | 2;
let detail: ModelDetail = 0;
/** Every merged geometry and the parts it was built from, so the detail level can be changed while running. */
const registry: { geo: THREE.BufferGeometry; parts: BoxPart[] }[] = [];

function partGeometry(p: BoxPart): THREE.BufferGeometry {
  const [w, h, d] = p.size;
  if (p.cyl) return new THREE.CylinderGeometry(h / 2, h / 2, w, detail === 0 ? 16 : detail === 1 ? 28 : 40).rotateZ(Math.PI / 2);
  const min = Math.min(w, h, d);
  // slivers (seams, stripes, lenses) stay plain boxes: bevelling them costs triangles nobody sees
  if (detail === 0 || (min < 0.05 && p.round === undefined)) return new THREE.BoxGeometry(w, h, d);
  const radius = p.round !== undefined ? (min / 2) * p.round : Math.min(0.14, min * 0.32);
  const segments = (min < 0.2 && p.round === undefined ? 1 : 2) + (detail === 2 ? 1 : 0);
  return new RoundedBoxGeometry(w, h, d, segments, radius);
}

function fill(out: THREE.BufferGeometry, parts: BoxPart[]) {
  const pos: number[] = [], nor: number[] = [], col: number[] = [], idx: number[] = [];
  const c = new THREE.Color();
  const e = new THREE.Euler();
  const m = new THREE.Matrix4();
  for (const p of parts) {
    const g = partGeometry(p);
    if (p.rot) g.applyMatrix4(m.makeRotationFromEuler(e.set(p.rot[0], p.rot[1], p.rot[2])));
    g.translate(p.pos[0], p.pos[1], p.pos[2]);
    const base = pos.length / 3;
    const gp = g.attributes.position.array, gn = g.attributes.normal.array;
    c.setHex(p.color).multiplyScalar(p.glow ?? 1);
    for (let i = 0; i < gp.length; i += 3) {
      pos.push(gp[i], gp[i + 1], gp[i + 2]);
      nor.push(gn[i], gn[i + 1], gn[i + 2]);
      col.push(c.r, c.g, c.b);
    }
    const gi = g.index?.array;
    if (gi) for (let i = 0; i < gi.length; i++) idx.push(base + gi[i]);
    else for (let i = 0; i < gp.length / 3; i++) idx.push(base + i); // rounded boxes are not indexed
    g.dispose();
  }
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  out.setIndex(idx);
  out.computeBoundingSphere();
}

/** Merge coloured boxes into a single vertex-coloured geometry (one draw call). */
export function mergeBoxes(parts: BoxPart[]): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  fill(out, parts);
  registry.push({ geo: out, parts });
  return out;
}

/** Rebuild every merged model at another detail level. Meshes keep their geometry objects, so nothing else changes. */
export function setModelDetail(d: ModelDetail) {
  if (d === detail) return;
  detail = d;
  for (const r of registry) {
    r.geo.dispose(); // frees the old GPU buffers; they are re-uploaded on the next draw
    fill(r.geo, r.parts);
  }
  // clear coat and a glossier base only where there are reflections to show
  carPaintMaterial.clearcoat = d ? 1 : 0;
  carPaintMaterial.roughness = d ? 0.28 : 0.35;
  carPaintMaterial.metalness = d ? 0.55 : 0.45;
  carPaintMaterial.needsUpdate = true;
}

export const vertexColorMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.05 });
/** Burnt-out wrecks: the vertex colours are multiplied down to soot. */
export const wreckMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, color: 0x2b2826, roughness: 1, metalness: 0 });
export const carPaintMaterial = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.45, clearcoat: 0, clearcoatRoughness: 0.08 });
