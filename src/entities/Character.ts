import * as THREE from 'three';
import { person, personMaterial, policeOverlay, type PersonAsset, type PersonName } from './People';

export interface Outfit {
  /** Which scanned person. */
  model: PersonName;
  /** Recolour the top / the bottoms; undefined keeps the clothes in the photographs. */
  top?: number;
  bottom?: number;
  /** Stature relative to the scanned person. */
  scale?: number;
  /** Peaked cap of this colour (police). */
  cap?: number;
  /** Osaka Prefectural Police uniform painted over the clothes: vest with lettering, trousers, black shoes. */
  police?: boolean;
}

const TOPS = [undefined, undefined, 0xc8414f, 0x2f78b8, 0xe2b545, 0x3a9c78, 0xf2f2f0, 0x7a52b8, 0xe07a3a, 0x2c2f36, 0xe58aa6, 0x6f8f4e];
const BOTTOMS = [undefined, undefined, 0x25344d, 0x34343a, 0x6b5a45, 0x1c2428, 0xb9a98c, 0x44587a, 0x8a8f96];
const pick = <T>(a: T[]) => a[Math.floor(Math.random() * a.length)];
export const randomOutfit = (): Outfit => ({
  model: Math.random() < 0.5 ? 'man' : 'woman',
  top: pick(TOPS),
  bottom: pick(BOTTOMS),
  scale: 0.96 + Math.random() * 0.08,
});

const damp = (a: number, b: number, k: number, dt: number) => a + (b - a) * (1 - Math.exp(-k * dt));
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
/** Distances (m) beyond which the next coarser mesh is shown. */
const LOD_AT = [11, 34];
const capMaterials = new Map<number, THREE.Material>();
let capGeo: THREE.BufferGeometry[] | null = null;

/**
 * A scanned person on an 18-bone skeleton. The mesh, texture and rest pose come from People.ts; the motion is
 * procedural: idle (breathing, shifting weight, looking about), walk, run, jump, aiming a weapon and a punch,
 * blended by speed so one gait flows into the next.
 */
export class Character {
  readonly group = new THREE.Group();
  private asset: PersonAsset;
  private rig = new THREE.Group();
  private meshes: THREE.SkinnedMesh[] = [];
  private bone: Record<string, THREE.Bone> = {};
  private rest: Record<string, THREE.Vector3> = {};
  private level = -1;
  private phase = Math.random() * 6;
  private clock = Math.random() * 40;
  private walk = 0; // 0 standing .. 1 walking
  private run = 0; // 0 walking .. 1 running
  private air = 0;
  private aimK = 0;
  private hand = new THREE.Group();
  private prop: THREE.Mesh | null = null;
  punchT = 0;
  /** Right arm held forward (aiming a weapon). */
  aim = false;

  constructor(o: Outfit) {
    const a = (this.asset = person(o.model));
    const bones: THREE.Bone[] = [];
    for (const b of a.bones) {
      const bone = new THREE.Bone();
      bone.name = b.name;
      bone.rotation.order = 'YXZ';
      if (b.parent < 0) bone.position.fromArray(b.pos);
      else {
        const p = a.bones[b.parent].pos;
        bone.position.set(b.pos[0] - p[0], b.pos[1] - p[1], b.pos[2] - p[2]);
        bones[b.parent].add(bone);
      }
      bones.push(bone);
      this.bone[b.name] = bone;
      this.rest[b.name] = bone.position.clone();
    }
    // bind in model space, before the rig is scaled or placed
    bones[0].updateMatrixWorld(true);
    const skeleton = new THREE.Skeleton(bones);
    const material = personMaterial(a, o.top, o.bottom, o.police ? policeOverlay(a) : undefined);
    for (const geo of a.lods) {
      const mesh = new THREE.SkinnedMesh(geo, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.bind(skeleton, new THREE.Matrix4());
      mesh.visible = false;
      this.meshes.push(mesh);
      this.rig.add(mesh);
    }
    this.rig.add(bones[0]);
    this.rig.scale.setScalar(o.scale ?? 1);
    this.group.add(this.rig);
    // turn to the heading last, so a figure tipped over always lands on its back, whichever way it faced
    this.group.rotation.order = 'YXZ';
    this.lod(0);

    // weapons are modelled hanging from the shoulder of a straight arm, with the grip about 0.62 m down
    const arm = a.bones.find((b) => b.name === 'armR')!.pos, wrist = a.bones.find((b) => b.name === 'handR')!.pos;
    this.hand.position.set(0, 0.62 - 0.07, 0.02);
    this.hand.scale.setScalar(Math.min(1, (arm[1] - wrist[1] + 0.09) / 0.62));
    this.bone.handR.add(this.hand);
    if (o.cap !== undefined) this.addCap(o.cap);
    this.animate(0, 0);
  }

  /** Pick the mesh for a camera distance in metres. */
  lod(distance: number) {
    const level = distance < LOD_AT[0] ? 0 : distance < LOD_AT[1] ? 1 : 2;
    if (level === this.level) return;
    this.level = level;
    this.meshes.forEach((m, i) => (m.visible = i === level));
  }

  private addCap(color: number) {
    if (!capGeo) {
      const crown = new THREE.CylinderGeometry(1.12, 1.0, 0.05, 28).translate(0, 0.03, 0);
      const peak = new THREE.CylinderGeometry(1, 1, 0.012, 24, 1, false, -1.1, 2.2).scale(0.95, 1, 0.62).translate(0, 0.004, 0.72);
      capGeo = [crown, peak];
    }
    let mat = capMaterials.get(color);
    if (!mat) capMaterials.set(color, (mat = new THREE.MeshStandardMaterial({ color, roughness: 0.7 })));
    const head = this.asset.bones.find((b) => b.name === 'head')!.pos;
    const cap = new THREE.Group();
    for (const g of capGeo) {
      const m = new THREE.Mesh(g, mat);
      m.castShadow = true;
      cap.add(m);
    }
    const [cz, y, rx, rz] = this.asset.crown;
    cap.position.set(0, y - head[1], cz - head[2]);
    cap.scale.set(rx * 1.07, 1, rz * 1.07);
    this.bone.head.add(cap);
  }

  /** speed in m/s drives the gait; airborne holds a jump pose. */
  animate(dt: number, speed: number, airborne = false) {
    const b = this.bone, rest = this.rest;
    const size = this.asset.height / 1.74;
    this.clock += dt;
    this.walk = damp(this.walk, Math.min(1, speed / 1.1), 9, dt);
    this.run = damp(this.run, clamp01((speed - 4.4) / 2.4), 6, dt);
    this.air = damp(this.air, airborne ? 1 : 0, 12, dt);
    this.aimK = damp(this.aimK, this.aim ? 1 : 0, 14, dt);
    // one cycle is two steps; the stride lengthens with speed and with the legs
    this.phase += (dt * Math.PI * 2 * speed) / ((1.22 + 0.26 * speed) * size);
    const w = this.walk, r = this.run, air = this.air, ground = 1 - air, idle = (1 - w) * ground;
    const ph = this.phase, s = Math.sin(ph), t = this.clock;
    const mix = (a: number, c: number) => a + (c - a) * r;
    const sway = Math.sin(t * 0.55), breath = Math.sin(t * 1.5);

    // pelvis: drops and rises twice a cycle, rolls over the standing leg; standing still, the weight drifts from foot to foot
    const hips = b.hips;
    hips.position.set(
      rest.hips.x + idle * 0.014 * sway + ground * w * mix(0.012, 0.006) * s,
      rest.hips.y + ground * w * mix(0.016, 0.042) * size * Math.cos(ph * 2) - air * 0.03 - ground * w * mix(0.008, 0.03) - idle * 0.003 * (1 + breath),
      rest.hips.z,
    );
    hips.rotation.set(w * mix(0.035, 0.13), ground * w * mix(0.1, 0.18) * s, ground * w * mix(0.045, 0.03) * s + idle * 0.028 * sway);
    // spine: leans into the pace and counter-rotates against the hips; the chest lifts with each breath
    b.spine.rotation.set(w * mix(0.03, 0.13) + air * 0.1 + idle * 0.012 * breath, -ground * w * mix(0.11, 0.2) * s, -ground * w * 0.03 * s - idle * 0.022 * sway);
    b.chest.rotation.set(w * mix(0.02, 0.08) - idle * 0.014 * breath, -ground * w * mix(0.09, 0.17) * s - this.aimK * 0.25, -idle * 0.01 * sway);
    // the head stays level over all that, and looks about when standing
    const look = idle * 0.32 * Math.sin(t * 0.37) * Math.sin(t * 0.11 + 1);
    b.neck.rotation.set(-w * mix(0.035, 0.14) - air * 0.04, ground * w * mix(0.05, 0.1) * s + look * 0.45 + this.aimK * 0.1, 0);
    b.head.rotation.set(-w * mix(0.04, 0.17) - air * 0.05 + idle * 0.03 * Math.sin(t * 0.23), ground * w * mix(0.05, 0.1) * s + look * 0.55 + this.aimK * 0.15, idle * 0.012 * sway);

    // legs: the thigh swings, the knee folds while the leg comes through, the foot rolls from heel to toe
    for (const side of [1, -1]) {
      const p = side > 0 ? ph : ph + Math.PI, sw = Math.sin(p), lift = Math.max(0, Math.cos(p));
      const L = side > 0 ? 'L' : 'R';
      const jump = side > 0 ? -0.8 : 0.2; // leading knee up, trailing leg back
      b['thigh' + L].rotation.set(
        ground * w * (-mix(0.4, 0.72) * sw - mix(0.06, 0.28) * lift - mix(0.03, 0.14)) + air * jump,
        0,
        -ground * w * mix(0.045, 0.03) * s * 0.6 - idle * 0.028 * sway + side * idle * 0.012,
      );
      b['shin' + L].rotation.x = ground * w * (mix(0.1, 0.24) + mix(0.9, 1.85) * lift * lift) + air * (side > 0 ? 1.0 : 0.5);
      b['foot' + L].rotation.x = ground * w * (mix(0.3, 0.42) * sw - mix(0.22, 0.1) * lift) + air * 0.5;
    }

    // arms swing against the legs; the elbows fold up as the pace rises, the hands hang loose
    const swing = ground * w * mix(0.36, 0.95) * s;
    const fold = -(0.1 + w * mix(0.1, 1.3));
    const settle = idle * 0.02 * Math.sin(t * 0.9);
    this.arm('L', 1, swing + settle + air * -0.9, fold - air * 0.5 - Math.max(0, -swing) * mix(0.25, 0.3), r);
    this.arm('R', -1, -swing - settle + air * 0.5, fold - air * 0.3 - Math.max(0, swing) * mix(0.25, 0.3), r);
    if (this.aimK > 0.001) {
      // weapon up: right arm straight out, left hand brought across to steady it
      const k = this.aimK, R = b.armR, Lf = b.armL;
      R.rotation.x += (-1.45 - R.rotation.x) * k;
      R.rotation.z += (0.12 - R.rotation.z) * k;
      b.foreR.rotation.x *= 1 - k;
      b.handR.rotation.x *= 1 - k;
      Lf.rotation.x += (-1.05 - Lf.rotation.x) * k;
      Lf.rotation.z += (-0.55 - Lf.rotation.z) * k;
      b.foreL.rotation.x += (-0.75 - b.foreL.rotation.x) * k;
    }
    if (this.punchT > 0) {
      // jab: the fist comes up beside the chin, then the arm snaps straight with the shoulder behind it
      this.punchT -= dt;
      const k = Math.sin(clamp01(this.punchT / 0.3) * Math.PI);
      b.armR.rotation.x = -1.5 * k;
      b.armR.rotation.z = 0.14 * k;
      b.foreR.rotation.x = -1.9 * (1 - k) * Math.min(1, this.punchT / 0.08 + 0.2);
      b.handR.rotation.x = -0.5;
      b.chest.rotation.y += 0.38 * k;
      b.spine.rotation.y += 0.15 * k;
    }
  }

  private arm(L: string, side: number, swing: number, elbow: number, run: number) {
    const b = this.bone;
    // running tucks the elbows in towards the ribs
    b['arm' + L].rotation.set(swing, 0, side * (0.015 - run * 0.07));
    b['fore' + L].rotation.set(elbow, 0, 0);
    b['hand' + L].rotation.set(-0.12 + elbow * 0.12, 0, 0);
  }

  /** Attach a weapon model to the right hand (null = empty hands). */
  setProp(mesh: THREE.Mesh | null) {
    if (this.prop) this.hand.remove(this.prop);
    this.prop = mesh;
    if (mesh) this.hand.add(mesh);
    this.aim = !!mesh;
  }

  /** Lying on the ground (knocked out): on the back, raised by the depth of the body so it rests on the surface. */
  setDown(down: boolean) {
    this.group.rotation.x = down ? -Math.PI / 2 : 0;
    this.rig.position.z = down ? 0.12 : 0;
    const b = this.bone;
    if (!down) return;
    // limp: arms fall away from the sides, the head rolls over, one knee is drawn up a little
    this.animate(0, 0);
    b.armL.rotation.set(0.1, 0, 0.5);
    b.armR.rotation.set(-0.15, 0, -0.75);
    b.foreR.rotation.x = -0.5;
    b.head.rotation.set(0.1, 0.5, 0);
    b.thighL.rotation.set(-0.3, 0, 0.12);
    b.shinL.rotation.x = 0.55;
    b.footL.rotation.x = 0.4;
    b.footR.rotation.x = 0.5;
  }
}
