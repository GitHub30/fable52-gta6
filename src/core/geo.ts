import * as THREE from 'three';

export interface BoxPart {
  size: [number, number, number];
  pos: [number, number, number];
  color: number;
  rot?: [number, number, number];
  /** >1 multiplies the vertex colour so the part stays bright at night (lamps). */
  glow?: number;
  /** Render as a cylinder lying along X: size = [width, diameter, diameter]. Used for wheels. */
  cyl?: boolean;
}

/** Merge coloured boxes into a single vertex-coloured geometry (one draw call). */
export function mergeBoxes(parts: BoxPart[]): THREE.BufferGeometry {
  const pos: number[] = [], nor: number[] = [], col: number[] = [], idx: number[] = [];
  const c = new THREE.Color();
  const e = new THREE.Euler();
  const m = new THREE.Matrix4();
  for (const p of parts) {
    const g: THREE.BufferGeometry = p.cyl
      ? new THREE.CylinderGeometry(p.size[1] / 2, p.size[1] / 2, p.size[0], 16).rotateZ(Math.PI / 2)
      : new THREE.BoxGeometry(p.size[0], p.size[1], p.size[2]);
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
    const gi = g.index!.array;
    for (let i = 0; i < gi.length; i++) idx.push(base + gi[i]);
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  out.setIndex(idx);
  out.computeBoundingSphere();
  return out;
}

export const vertexColorMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.05 });
export const carPaintMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.45 });
