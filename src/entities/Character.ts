import * as THREE from 'three';
import { mergeBoxes, vertexColorMaterial } from '../core/geo';

const SKIN = [0xf1c9a5, 0xd9a47a, 0xa8754f, 0x7a5236, 0xf5d6ba];
const SHIRT = [0xe94f64, 0x2f8fd0, 0xf2c14e, 0x3fb68b, 0xffffff, 0x8d5bd6, 0xff8a3c, 0x30343c, 0xf48fb1];
const PANTS = [0x2c3e58, 0x3b3b3f, 0x6b5a45, 0x1f2a30, 0xc9b79a, 0x4a5d7a];
const HAIR = [0x1c1612, 0x3a2416, 0x6b4423, 0xc9a45c, 0x8a8a8a, 0xb5422c];

export interface Outfit {
  skin: number;
  shirt: number;
  pants: number;
  hair: number;
}
export const randomOutfit = (): Outfit => ({
  skin: SKIN[Math.floor(Math.random() * SKIN.length)],
  shirt: SHIRT[Math.floor(Math.random() * SHIRT.length)],
  pants: PANTS[Math.floor(Math.random() * PANTS.length)],
  hair: HAIR[Math.floor(Math.random() * HAIR.length)],
});

// limb geometries are cached per colour, bodies per outfit key
const cache = new Map<string, THREE.BufferGeometry>();
function cached(key: string, make: () => THREE.BufferGeometry) {
  let g = cache.get(key);
  if (!g) cache.set(key, (g = make()));
  return g;
}

/** Blocky humanoid: 5 meshes (body + 4 limbs) with procedural walk animation. */
export class Character {
  readonly group = new THREE.Group();
  private armL: THREE.Mesh;
  private armR: THREE.Mesh;
  private legL: THREE.Mesh;
  private legR: THREE.Mesh;
  private phase = Math.random() * 6;
  punchT = 0;

  constructor(o: Outfit) {
    const body = new THREE.Mesh(
      cached(`b${o.skin}_${o.shirt}_${o.hair}_${o.pants}`, () =>
        mergeBoxes([
          { size: [0.52, 0.62, 0.28], pos: [0, 1.17, 0], color: o.shirt },
          { size: [0.48, 0.16, 0.27], pos: [0, 0.82, 0], color: o.pants },
          { size: [0.12, 0.08, 0.12], pos: [0, 1.51, 0], color: o.skin },
          { size: [0.3, 0.3, 0.3], pos: [0, 1.68, 0], color: o.skin },
          { size: [0.33, 0.12, 0.33], pos: [0, 1.82, -0.01], color: o.hair },
          { size: [0.33, 0.2, 0.1], pos: [0, 1.7, -0.13], color: o.hair },
        ]),
      ),
      vertexColorMaterial,
    );
    const arm = cached(`a${o.skin}_${o.shirt}`, () =>
      mergeBoxes([
        { size: [0.15, 0.3, 0.16], pos: [0, -0.13, 0], color: o.shirt },
        { size: [0.13, 0.36, 0.14], pos: [0, -0.44, 0], color: o.skin },
      ]),
    );
    const leg = cached(`l${o.pants}`, () =>
      mergeBoxes([
        { size: [0.2, 0.68, 0.22], pos: [0, -0.34, 0], color: o.pants },
        { size: [0.21, 0.1, 0.3], pos: [0, -0.71, 0.04], color: 0x1b1b1e },
      ]),
    );
    this.armL = new THREE.Mesh(arm, vertexColorMaterial);
    this.armR = new THREE.Mesh(arm, vertexColorMaterial);
    this.legL = new THREE.Mesh(leg, vertexColorMaterial);
    this.legR = new THREE.Mesh(leg, vertexColorMaterial);
    this.armL.position.set(0.34, 1.45, 0);
    this.armR.position.set(-0.34, 1.45, 0);
    this.legL.position.set(0.13, 0.76, 0);
    this.legR.position.set(-0.13, 0.76, 0);
    this.group.add(body, this.armL, this.armR, this.legL, this.legR);
    this.group.traverse((m) => ((m as THREE.Mesh).castShadow = true));
  }

  /** speed in m/s drives the walk cycle; airborne freezes a jump pose. */
  animate(dt: number, speed: number, airborne = false) {
    this.phase += dt * (4 + speed * 1.6);
    const amp = airborne ? 0.5 : Math.min(1, speed / 3.5) * 0.85;
    const s = airborne ? 1 : Math.sin(this.phase);
    this.legL.rotation.x = s * amp;
    this.legR.rotation.x = -s * amp;
    this.armL.rotation.x = -s * amp * 0.8;
    this.armR.rotation.x = s * amp * 0.8;
    if (this.punchT > 0) {
      this.punchT -= dt;
      this.armR.rotation.x = -1.7 * Math.sin(Math.min(1, this.punchT / 0.3) * Math.PI);
    }
  }

  /** Lying on the ground (knocked out). */
  setDown(down: boolean) {
    this.group.rotation.x = down ? -Math.PI / 2 : 0;
    this.group.position.y += down ? 0.2 : 0;
  }
}
