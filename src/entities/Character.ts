import * as THREE from 'three';

const SKIN = [0xf1c9a5, 0xd9a47a, 0xa8754f, 0x7a5236, 0xf5d6ba];
const SHIRT = [0xe94f64, 0x2f8fd0, 0xf2c14e, 0x3fb68b, 0xffffff, 0x8d5bd6, 0xff8a3c, 0x30343c, 0xf48fb1];
const PANTS = [0x2c3e58, 0x3b3b3f, 0x6b5a45, 0x1f2a30, 0xc9b79a, 0x4a5d7a];
const HAIR = [0x1c1612, 0x3a2416, 0x6b4423, 0xc9a45c, 0x8a8a8a, 0xb5422c];

export interface Outfit {
  skin: number;
  shirt: number;
  pants: number;
  hair: number;
  /** 0 cropped, 1 full, 2 long (to the shoulders). */
  hairStyle?: number;
  longSleeves?: boolean;
  /** Peaked cap of this colour (police). */
  cap?: number;
  /** Stature and breadth relative to the standard 1.76 m figure. */
  height?: number;
  build?: number;
}
const pick = <T>(a: T[]) => a[Math.floor(Math.random() * a.length)];
export const randomOutfit = (): Outfit => ({
  skin: pick(SKIN),
  shirt: pick(SHIRT),
  pants: pick(PANTS),
  hair: pick(HAIR),
  hairStyle: Math.floor(Math.random() * 3),
  longSleeves: Math.random() < 0.45,
  height: 0.93 + Math.random() * 0.12,
  build: 0.92 + Math.random() * 0.2,
});

// ------------------------------------------------------------------ skeleton
// rest pose in metres: feet on y = 0, facing +Z, +X is the figure's left
const enum B { Root, Hips, Spine, Chest, Head, ArmL, ForeL, ArmR, ForeR, ThighL, ShinL, FootL, ThighR, ShinR, FootR }
const SHOULDER_X = 0.215, SHOULDER_Y = 1.45, ELBOW_Y = 1.16, HIP_X = 0.1, HIP_Y = 0.92, KNEE_Y = 0.5, ANKLE_Y = 0.08;
/** [parent, x, y, z] at rest, in model space. */
const REST: [number, number, number, number][] = [
  [-1, 0, 0, 0],
  [B.Root, 0, 0.95, 0],
  [B.Hips, 0, 1.1, 0],
  [B.Spine, 0, 1.28, 0],
  [B.Chest, 0, 1.52, 0],
  [B.Chest, SHOULDER_X, SHOULDER_Y, 0],
  [B.ArmL, SHOULDER_X, ELBOW_Y, 0],
  [B.Chest, -SHOULDER_X, SHOULDER_Y, 0],
  [B.ArmR, -SHOULDER_X, ELBOW_Y, 0],
  [B.Hips, HIP_X, HIP_Y, 0],
  [B.ThighL, HIP_X, KNEE_Y, 0],
  [B.ShinL, HIP_X, ANKLE_Y, 0],
  [B.Hips, -HIP_X, HIP_Y, 0],
  [B.ThighR, -HIP_X, KNEE_Y, 0],
  [B.ShinR, -HIP_X, ANKLE_Y, 0],
];

// ------------------------------------------------------------------ body geometry
type Weights = [number, number, number]; // bone a, bone b, share of b
interface Ring {
  y: number;
  rx: number;
  rz: number;
  x?: number;
  z?: number;
  color: number;
  w: Weights;
}
const tint = new THREE.Color();
const smooth = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Collects skinned, vertex-coloured parts into one geometry. */
class Body {
  pos: number[] = [];
  nor: number[] = [];
  col: number[] = [];
  si: number[] = [];
  sw: number[] = [];
  idx: number[] = [];

  private vert(x: number, y: number, z: number, color: number, w: Weights, n?: [number, number, number]) {
    this.pos.push(x, y, z);
    this.nor.push(n ? n[0] : 0, n ? n[1] : 0, n ? n[2] : 0);
    tint.setHex(color);
    this.col.push(tint.r, tint.g, tint.b);
    this.si.push(w[0], w[1], 0, 0);
    this.sw.push(1 - w[2], w[2], 0, 0);
    return this.pos.length / 3 - 1;
  }

  /** Elliptical tube through the rings (given bottom to top), closed at both ends. */
  tube(rings: Ring[], seg = 14) {
    const base = this.pos.length / 3;
    for (const r of rings)
      for (let j = 0; j < seg; j++) {
        const a = (j / seg) * Math.PI * 2;
        this.vert((r.x ?? 0) + Math.cos(a) * r.rx, r.y, (r.z ?? 0) + Math.sin(a) * r.rz, r.color, r.w);
      }
    for (let i = 0; i < rings.length - 1; i++)
      for (let j = 0; j < seg; j++) {
        const a = base + i * seg + j, b = base + i * seg + ((j + 1) % seg);
        this.idx.push(a, a + seg, b + seg, a, b + seg, b);
      }
    const cap = (i: number, up: boolean) => {
      const r = rings[i], c = this.vert(r.x ?? 0, r.y, r.z ?? 0, r.color, r.w);
      for (let j = 0; j < seg; j++) {
        const a = base + i * seg + j, b = base + i * seg + ((j + 1) % seg);
        if (up) this.idx.push(c, b, a);
        else this.idx.push(c, a, b);
      }
    };
    cap(0, false);
    cap(rings.length - 1, true);
  }

  /** Ellipsoid, or the part of one between two polar angles (hair caps). Its normals are exact, so it has no seam. */
  blob(c: [number, number, number], r: [number, number, number], color: number, w: Weights, theta0 = 0, theta1 = Math.PI, tilt = 0) {
    const g = new THREE.SphereGeometry(1, 18, 12, 0, Math.PI * 2, theta0, theta1 - theta0);
    if (tilt) g.rotateX(tilt);
    const p = g.attributes.position, base = this.pos.length / 3;
    for (let i = 0; i < p.count; i++) {
      const nx = p.getX(i) / r[0], ny = p.getY(i) / r[1], nz = p.getZ(i) / r[2], l = Math.hypot(nx, ny, nz) || 1;
      this.vert(c[0] + p.getX(i) * r[0], c[1] + p.getY(i) * r[1], c[2] + p.getZ(i) * r[2], color, w, [nx / l, ny / l, nz / l]);
    }
    const index = g.index!;
    for (let i = 0; i < index.count; i++) this.idx.push(base + index.getX(i));
    g.dispose();
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    // keep the exact normals of the ellipsoids
    const n = g.attributes.normal;
    for (let i = 0; i < n.count; i++) if (this.nor[i * 3] || this.nor[i * 3 + 1] || this.nor[i * 3 + 2]) n.setXYZ(i, this.nor[i * 3], this.nor[i * 3 + 1], this.nor[i * 3 + 2]);
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.sw, 4));
    g.computeBoundingSphere();
    g.boundingSphere!.radius += 0.6; // limbs swing outside the rest pose
    return g;
  }
}

function figure(o: Outfit) {
  const b = new Body();
  const shoe = 0x1b1b1e, belt = 0x17171a;

  // trunk: hips to the base of the neck, bending through two spine joints
  const trunk = (y: number): Weights => (y < 1.0 ? [B.Hips, B.Spine, 0] : y < 1.2 ? [B.Hips, B.Spine, smooth(1.0, 1.14, y)] : [B.Spine, B.Chest, smooth(1.2, 1.34, y)]);
  const torso: [number, number, number, number][] = [
    [0.87, 0.12, 0.1, o.pants], [0.93, 0.168, 0.118, o.pants], [1.0, 0.172, 0.12, o.pants], [1.035, 0.165, 0.116, belt], [1.05, 0.162, 0.113, o.shirt],
    [1.12, 0.15, 0.105, o.shirt], [1.2, 0.162, 0.11, o.shirt], [1.3, 0.186, 0.124, o.shirt], [1.38, 0.196, 0.124, o.shirt], [1.44, 0.185, 0.11, o.shirt],
    [1.475, 0.12, 0.085, o.shirt], [1.495, 0.062, 0.062, o.shirt],
  ];
  b.tube(torso.map(([y, rx, rz, color]) => ({ y, rx, rz, color, w: trunk(y) })), 16);

  // neck and head
  const head: Weights = [B.Head, B.Head, 0];
  b.tube([{ y: 1.47, rx: 0.052, rz: 0.055, color: o.skin, w: [B.Chest, B.Head, 0.3] }, { y: 1.56, rx: 0.048, rz: 0.052, color: o.skin, w: head }], 10);
  b.blob([0, 1.645, 0.005], [0.098, 0.123, 0.112], o.skin, head);
  b.blob([0, 1.598, 0.03], [0.076, 0.062, 0.085], o.skin, head); // jaw
  b.blob([0, 1.635, 0.113], [0.015, 0.024, 0.02], o.skin, head); // nose
  for (const s of [1, -1]) {
    b.blob([s * 0.1, 1.64, -0.005], [0.014, 0.03, 0.02], o.skin, head); // ear
    b.blob([s * 0.038, 1.662, 0.098], [0.013, 0.0085, 0.009], 0x17120f, head); // eye
    b.blob([s * 0.038, 1.684, 0.1], [0.021, 0.0045, 0.007], o.hair, head); // brow
  }
  // hair
  const style = o.hairStyle ?? 1;
  b.blob([0, 1.662, -0.012], [0.109, 0.122, 0.126], o.hair, head, 0, style ? 1.62 : 1.38, -0.36);
  if (style === 2) b.tube([{ y: 1.47, rx: 0.1, rz: 0.05, z: -0.07, color: o.hair, w: head }, { y: 1.6, rx: 0.106, rz: 0.075, z: -0.055, color: o.hair, w: head }, { y: 1.7, rx: 0.1, rz: 0.08, z: -0.04, color: o.hair, w: head }], 12);
  if (o.cap !== undefined) {
    b.tube([{ y: 1.705, rx: 0.112, rz: 0.125, color: o.cap, w: head }, { y: 1.76, rx: 0.118, rz: 0.13, color: o.cap, w: head }, { y: 1.785, rx: 0.1, rz: 0.11, color: o.cap, w: head }], 16);
    b.blob([0, 1.707, 0.1], [0.085, 0.008, 0.07], 0x0a0a0c, head); // peak
    b.blob([0, 1.74, 0.127], [0.018, 0.018, 0.006], 0xd9b23a, head); // badge
  }

  for (const s of [1, -1]) {
    // arm: sleeve, bare forearm, hand
    const up = s > 0 ? B.ArmL : B.ArmR, fore = s > 0 ? B.ForeL : B.ForeR, x = s * SHOULDER_X;
    const arm = (y: number): Weights => [up, fore, smooth(ELBOW_Y + 0.07, ELBOW_Y - 0.07, y)];
    const cuff = o.longSleeves ? 0.9 : 1.25;
    const limb: [number, number][] = [[0.845, 0.03], [0.9, 0.034], [1.0, 0.04], [1.1, 0.042], [1.16, 0.043], [1.22, 0.047], [1.3, 0.052], [1.4, 0.056], [1.455, 0.05]];
    b.tube(limb.map(([y, r]) => ({ x, y, rx: r, rz: r * 1.04, color: y >= cuff ? o.shirt : o.skin, w: arm(y) })), 12);
    b.blob([x - s * 0.012, SHOULDER_Y - 0.012, 0], [0.052, 0.05, 0.058], o.shirt, [up, up, 0]);
    b.blob([x, 0.8, 0.008], [0.022, 0.058, 0.04], o.skin, [fore, fore, 0]);
    b.blob([x - s * 0.012, 0.825, 0.036], [0.012, 0.03, 0.014], o.skin, [fore, fore, 0]); // thumb

    // leg: trouser leg, shoe
    const thigh = s > 0 ? B.ThighL : B.ThighR, shin = s > 0 ? B.ShinL : B.ShinR, foot = s > 0 ? B.FootL : B.FootR, lx = s * HIP_X;
    const leg = (y: number): Weights => (y > 0.3 ? [thigh, shin, smooth(KNEE_Y + 0.08, KNEE_Y - 0.08, y)] : [shin, foot, smooth(ANKLE_Y + 0.05, ANKLE_Y - 0.03, y)]);
    const hose: [number, number, number][] = [[0.065, 0.047, 0.052], [0.12, 0.05, 0.055], [0.3, 0.06, 0.064], [0.44, 0.058, 0.062], [0.5, 0.062, 0.066], [0.58, 0.069, 0.073], [0.75, 0.083, 0.088], [0.88, 0.088, 0.094], [0.95, 0.07, 0.085]];
    b.tube(hose.map(([y, rx, rz]) => ({ x: lx, y, rx, rz, color: o.pants, w: leg(y) })), 12);
    const sole: Weights = [foot, foot, 0];
    b.blob([lx, 0.05, 0.045], [0.05, 0.05, 0.128], shoe, sole);
    b.blob([lx, 0.016, 0.045], [0.054, 0.016, 0.132], 0xdadada, sole);
  }
  return b.build();
}

// limb geometries are shared between figures that look the same
const cache = new Map<string, THREE.BufferGeometry>();
const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0.02 });
const damp = (a: number, b: number, k: number, dt: number) => a + (b - a) * (1 - Math.exp(-k * dt));

/**
 * Human figure: one skinned mesh on a 15-bone skeleton, animated procedurally (idle, walk, run, jump,
 * aim, punch). Elbows and knees bend through blended skin, so there are no rigid blocks.
 */
export class Character {
  readonly group = new THREE.Group();
  private bones: THREE.Bone[] = [];
  private phase = Math.random() * 6;
  private clock = Math.random() * 20;
  private walk = 0; // 0 standing .. 1 walking
  private run = 0; // 0 walking .. 1 running
  private air = 0;
  private aimK = 0;
  private hand = new THREE.Group();
  punchT = 0;
  /** Right arm held forward (aiming a weapon). */
  aim = false;
  private prop: THREE.Mesh | null = null;

  constructor(o: Outfit) {
    const key = [o.skin, o.shirt, o.pants, o.hair, o.hairStyle ?? 1, o.longSleeves ? 1 : 0, o.cap ?? -1].join('_');
    let geo = cache.get(key);
    if (!geo) cache.set(key, (geo = figure(o)));
    const mesh = new THREE.SkinnedMesh(geo, material);
    mesh.castShadow = true;
    for (const [parent, x, y, z] of REST) {
      const bone = new THREE.Bone();
      if (parent < 0) bone.position.set(x, y, z);
      else {
        bone.position.set(x - REST[parent][1], y - REST[parent][2], z - REST[parent][3]);
        this.bones[parent].add(bone);
      }
      bone.rotation.order = 'YXZ';
      this.bones.push(bone);
    }
    mesh.add(this.bones[B.Root]);
    mesh.bind(new THREE.Skeleton(this.bones));
    // a held weapon is modelled hanging from the shoulder along a straight arm; the forearm carries it
    this.hand.position.y = SHOULDER_Y - ELBOW_Y;
    this.bones[B.ForeR].add(this.hand);
    const scale = new THREE.Group();
    scale.scale.set(o.build ?? 1, o.height ?? 1, o.build ?? 1);
    scale.add(mesh);
    this.group.add(scale);
    this.animate(0, 0);
  }

  /** speed in m/s drives the gait; airborne holds a jump pose. */
  animate(dt: number, speed: number, airborne = false) {
    const bone = this.bones;
    this.clock += dt;
    this.walk = damp(this.walk, Math.min(1, speed / 1.1), 9, dt);
    this.run = damp(this.run, Math.min(1, Math.max(0, (speed - 4.6) / 2.4)), 6, dt);
    this.air = damp(this.air, airborne ? 1 : 0, 12, dt);
    this.aimK = damp(this.aimK, this.aim ? 1 : 0, 14, dt);
    // one cycle is two steps; the stride lengthens with speed
    this.phase += (dt * Math.PI * 2 * speed) / (1.25 + 0.26 * speed);
    const w = this.walk, r = this.run, air = this.air, ground = 1 - air;
    const ph = this.phase, s = Math.sin(ph), t = this.clock;
    const mix = (a: number, b: number) => a + (b - a) * r;

    // pelvis and spine: bounce twice a cycle, counter-rotating hips and chest, a lean that grows into the run
    bone[B.Hips].position.y = 0.95 + ground * w * mix(0.014, 0.04) * Math.cos(ph * 2) - air * 0.03 - (1 - w) * 0.004 * (1 + Math.sin(t * 1.3));
    bone[B.Hips].rotation.set(w * mix(0.03, 0.12), ground * w * mix(0.1, 0.18) * s, ground * w * 0.04 * s);
    bone[B.Spine].rotation.set(w * mix(0.03, 0.14) + air * 0.1 + (1 - w) * 0.012 * Math.sin(t * 1.3), -ground * w * mix(0.12, 0.22) * s, 0);
    bone[B.Chest].rotation.set(w * mix(0.02, 0.08), -ground * w * mix(0.08, 0.16) * s - this.aimK * 0.25, 0);
    // the head stays level and looks about when standing
    bone[B.Head].rotation.set(-w * mix(0.07, 0.3) - air * 0.08, ground * w * mix(0.1, 0.2) * s + this.aimK * 0.25 + (1 - w) * 0.3 * Math.sin(t * 0.37) * Math.sin(t * 0.11), 0);

    // legs: the thigh swings, the knee folds while the leg comes forward, the foot rolls from heel to toe
    for (const side of [1, -1]) {
      const p = side > 0 ? ph : ph + Math.PI, sw = Math.sin(p), lift = Math.max(0, Math.cos(p));
      const thigh = bone[side > 0 ? B.ThighL : B.ThighR], shin = bone[side > 0 ? B.ShinL : B.ShinR], foot = bone[side > 0 ? B.FootL : B.FootR];
      const jump = side > 0 ? -0.75 : 0.2; // leading knee up, trailing leg back
      thigh.rotation.set(ground * w * (-mix(0.42, 0.7) * sw - mix(0.05, 0.25) * lift - mix(0.02, 0.12)) + air * jump, 0, side * 0.02);
      shin.rotation.x = ground * w * (mix(0.12, 0.25) + mix(0.85, 1.75) * lift * lift) + air * (side > 0 ? 0.95 : 0.45);
      foot.rotation.x = ground * w * (mix(0.3, 0.45) * sw - 0.25 * lift) + air * 0.5;
    }

    // arms swing against the legs, elbows folding up as the pace rises
    const swingL = ground * w * mix(0.4, 0.95) * s;
    this.arm(B.ArmL, B.ForeL, 1, swingL + air * -0.9, -(0.12 + w * mix(0.12, 1.25)) - air * 0.5);
    this.arm(B.ArmR, B.ForeR, -1, -swingL + air * 0.5, -(0.12 + w * mix(0.12, 1.25)) - air * 0.3);
    if (this.aimK > 0.001) {
      // weapon up: right arm straight out, left hand brought across to steady it
      const k = this.aimK, R = bone[B.ArmR], L = bone[B.ArmL];
      R.rotation.x += (-1.45 - R.rotation.x) * k;
      R.rotation.z += (0.1 - R.rotation.z) * k;
      bone[B.ForeR].rotation.x *= 1 - k;
      L.rotation.x += (-1.05 - L.rotation.x) * k;
      L.rotation.z += (-0.55 - L.rotation.z) * k;
      bone[B.ForeL].rotation.x += (-0.75 - bone[B.ForeL].rotation.x) * k;
    }
    if (this.punchT > 0) {
      // jab: the fist comes up beside the chin, then the arm snaps straight
      this.punchT -= dt;
      const k = Math.sin(Math.min(1, Math.max(0, this.punchT / 0.3)) * Math.PI);
      bone[B.ArmR].rotation.x = -1.55 * k;
      bone[B.ArmR].rotation.z = 0.12;
      bone[B.ForeR].rotation.x = -1.9 * (1 - k) * Math.min(1, this.punchT / 0.08 + 0.2);
      bone[B.Chest].rotation.y += 0.35 * k;
    }
  }

  private arm(upper: number, lower: number, side: number, swing: number, elbow: number) {
    this.bones[upper].rotation.set(swing, 0, side * 0.07);
    this.bones[lower].rotation.set(elbow, 0, 0);
  }

  /** Attach a weapon model to the right hand (null = empty hands). */
  setProp(mesh: THREE.Mesh | null) {
    if (this.prop) this.hand.remove(this.prop);
    this.prop = mesh;
    if (mesh) this.hand.add(mesh);
    this.aim = !!mesh;
  }

  /** Lying on the ground (knocked out). */
  setDown(down: boolean) {
    this.group.rotation.x = down ? -Math.PI / 2 : 0;
    this.group.position.y += down ? 0.2 : 0;
  }
}
