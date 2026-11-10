import * as THREE from 'three';
import { mergeBoxes, carPaintMaterial, BoxPart } from '../core/geo';
import { City } from '../world/City';
import { WORLD_BOUND, clamp, damp } from '../config';

export type VehicleKind = 'prius' | 'alphard' | 'taxi' | 'police';
export interface VehicleSpec {
  name: string;
  shape: 'prius' | 'alphard';
  len: number;
  wid: number;
  maxSpeed: number; // m/s
  accel: number;
  grip: number;
  colors: number[];
}
const PRIUS_COLORS = [0xd9dde2, 0xf4f4f2, 0x1b1c1f, 0x2a4f8f, 0x9a1c26, 0x7d868c, 0xe6c94a];
export const SPECS: Record<VehicleKind, VehicleSpec> = {
  prius: { name: 'プリウス', shape: 'prius', len: 4.6, wid: 1.8, maxSpeed: 40, accel: 10.5, grip: 7.6, colors: PRIUS_COLORS },
  alphard: { name: 'アルファード', shape: 'alphard', len: 5.0, wid: 1.9, maxSpeed: 34, accel: 8.2, grip: 6.6, colors: [0xf6f5f0, 0xf6f5f0, 0x17181b, 0xc4c8cc, 0x3b3f46] },
  taxi: { name: 'プリウス タクシー', shape: 'prius', len: 4.6, wid: 1.8, maxSpeed: 38, accel: 10, grip: 7.4, colors: [0xf7c21a] },
  police: { name: 'パトカー', shape: 'prius', len: 4.6, wid: 1.8, maxSpeed: 46, accel: 13, grip: 8, colors: [0xf2f2f2] },
};

const GLASS = 0x18222c, TRIM = 0x1b1d21, LAMP = 0xfff3cf, TAIL = 0xff1a1a;

/** Low wedge-shaped liftback: sloping bonnet, steep windscreen, long fastback tail. Returns the roof height. */
function priusParts(parts: BoxPart[], W: number, L: number, color: number, twoTone: boolean): number {
  const h = L / 2;
  const side = twoTone ? 0x15171a : color;
  parts.push(
    { size: [W, 0.5, L], pos: [0, 0.55, 0], color },
    { size: [W + 0.02, 0.3, L * 0.36], pos: [0, 0.58, -0.2], color: side }, // door panel (black on patrol cars)
    // bonnet slopes down to a low nose
    { size: [W * 0.96, 0.12, 1.35], pos: [0, 0.84, h - 0.78], color, rot: [0.1, 0, 0] },
    // cabin: glass core, raked windscreen, roof
    { size: [W * 0.88, 0.5, 1.5], pos: [0, 1.05, -0.25], color: GLASS },
    { size: [W * 0.86, 0.26, 0.5], pos: [0, 0.93, 0.7], color: GLASS },
    { size: [W * 0.86, 0.07, 1.16], pos: [0, 1.07, 0.85], color: GLASS, rot: [0.48, 0, 0] },
    { size: [W * 0.87, 0.07, 1.34], pos: [0, 1.335, -0.3], color },
    { size: [W * 0.89, 0.5, 0.1], pos: [0, 1.05, -0.05], color }, // B pillar
    // fastback: rear glass then a painted deck, both on the same slope
    { size: [W * 0.85, 0.07, 0.78], pos: [0, 1.24, -1.3], color: GLASS, rot: [-0.258, 0, 0] },
    { size: [W * 0.87, 0.07, 0.62], pos: [0, 1.065, -1.97], color, rot: [-0.258, 0, 0] },
    { size: [W * 0.88, 0.32, 0.82], pos: [0, 0.95, -1.36], color },
    { size: [W * 0.92, 0.2, 0.56], pos: [0, 0.88, -2.0], color },
    // nose: slim lamps, dark lower intake
    { size: [0.56, 0.07, 0.1], pos: [W / 2 - 0.36, 0.76, h + 0.01], color: LAMP, glow: 3 },
    { size: [0.56, 0.07, 0.1], pos: [-W / 2 + 0.36, 0.76, h + 0.01], color: LAMP, glow: 3 },
    { size: [W * 0.5, 0.04, 0.08], pos: [0, 0.74, h + 0.01], color: TRIM },
    { size: [W * 0.78, 0.16, 0.08], pos: [0, 0.42, h + 0.01], color: TRIM },
    // tail: full-width light bar over a black lower bumper
    { size: [W * 0.92, 0.06, 0.08], pos: [0, 0.96, -h - 0.01], color: TAIL, glow: 1.6 },
    { size: [W * 0.94, 0.1, 0.08], pos: [0, 0.89, -h - 0.01], color: TRIM },
    { size: [W * 0.9, 0.2, 0.08], pos: [0, 0.42, -h - 0.01], color: TRIM },
  );
  return 1.37;
}

/** Tall boxy luxury minivan: upright nose with a huge grille, long flat roof, vertical tail. Returns the roof height. */
function alphardParts(parts: BoxPart[], W: number, L: number, color: number): number {
  const h = L / 2;
  parts.push(
    { size: [W, 0.78, L], pos: [0, 0.69, 0], color },
    // glass band with painted pillars and roof
    { size: [W * 0.94, 0.56, 3.9], pos: [0, 1.36, -0.45], color: GLASS },
    { size: [W * 0.96, 0.56, 0.14], pos: [0, 1.36, 0.6], color },
    { size: [W * 0.96, 0.56, 0.12], pos: [0, 1.36, -0.85], color: TRIM },
    { size: [W * 0.96, 0.56, 0.16], pos: [0, 1.36, -2.34], color },
    { size: [W * 0.97, 0.1, 3.96], pos: [0, 1.69, -0.45], color },
    { size: [W * 0.9, 0.06, 0.34], pos: [0, 1.72, -2.52], color }, // roof spoiler
    // short raked windscreen
    { size: [W * 0.92, 0.07, 0.84], pos: [0, 1.36, 1.8], color: GLASS, rot: [0.8, 0, 0] },
    { size: [W * 0.92, 0.3, 0.34], pos: [0, 1.22, 1.62], color: GLASS },
    // the signature grille: tall dark panel with bright slats
    { size: [W * 0.78, 0.66, 0.08], pos: [0, 0.72, h + 0.01], color: TRIM },
    { size: [W * 0.76, 0.03, 0.1], pos: [0, 0.94, h + 0.02], color: 0xb9bec6 },
    { size: [W * 0.76, 0.03, 0.1], pos: [0, 0.8, h + 0.02], color: 0xb9bec6 },
    { size: [W * 0.76, 0.03, 0.1], pos: [0, 0.66, h + 0.02], color: 0xb9bec6 },
    { size: [W * 0.76, 0.03, 0.1], pos: [0, 0.52, h + 0.02], color: 0xb9bec6 },
    { size: [0.5, 0.08, 0.1], pos: [W / 2 - 0.27, 1.0, h + 0.01], color: LAMP, glow: 3 },
    { size: [0.5, 0.08, 0.1], pos: [-W / 2 + 0.27, 1.0, h + 0.01], color: LAMP, glow: 3 },
    { size: [0.07, 0.3, 0.1], pos: [W / 2 - 0.1, 0.62, h + 0.01], color: LAMP, glow: 2.5 },
    { size: [0.07, 0.3, 0.1], pos: [-W / 2 + 0.1, 0.62, h + 0.01], color: LAMP, glow: 2.5 },
    // tail: light bar with drooping ends, vertical reflectors
    { size: [W * 0.96, 0.1, 0.08], pos: [0, 1.1, -h - 0.01], color: TAIL, glow: 1.6 },
    { size: [0.1, 0.24, 0.08], pos: [W / 2 - 0.12, 0.98, -h - 0.01], color: TAIL, glow: 1.6 },
    { size: [0.1, 0.24, 0.08], pos: [-W / 2 + 0.12, 0.98, -h - 0.01], color: TAIL, glow: 1.6 },
    { size: [0.05, 0.26, 0.08], pos: [W / 2 - 0.14, 0.52, -h - 0.01], color: TAIL },
    { size: [0.05, 0.26, 0.08], pos: [-W / 2 + 0.14, 0.52, -h - 0.01], color: TAIL },
    { size: [W * 0.4, 0.14, 0.08], pos: [0, 0.98, -h - 0.01], color: TRIM },
    { size: [W * 0.9, 0.04, 0.1], pos: [0, 0.36, -h - 0.02], color: 0xb9bec6 },
  );
  return 1.74;
}

const geoCache = new Map<string, THREE.BufferGeometry>();
function vehicleGeometry(kind: VehicleKind, color: number) {
  const key = kind + color;
  let g = geoCache.get(key);
  if (g) return g;
  const s = SPECS[kind];
  const { len: L, wid: W } = s;
  const parts: BoxPart[] = [];
  const top = s.shape === 'prius' ? priusParts(parts, W, L, color, kind === 'police') : alphardParts(parts, W, L, color);
  // wheels: four boxes fanned through 90 degrees read as a round tyre, plus a hub
  const r = s.shape === 'alphard' ? 0.56 : 0.52;
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const at: [number, number, number] = [sx * (W / 2 - 0.1), r * 0.66, sz * L * 0.3];
      for (let k = 0; k < 4; k++) parts.push({ size: [0.26, r, r], pos: at, color: 0x0e0e10, rot: [(k * Math.PI) / 8, 0, 0] });
      parts.push({ size: [0.28, r * 0.52, r * 0.52], pos: at, color: 0x9a9da3 });
    }
  if (kind === 'police') {
    parts.push({ size: [0.5, 0.14, 0.26], pos: [0.3, top + 0.1, -0.3], color: 0x2a5cff, glow: 4 });
    parts.push({ size: [0.5, 0.14, 0.26], pos: [-0.3, top + 0.1, -0.3], color: 0xff2020, glow: 4 });
  } else if (kind === 'taxi') {
    parts.push({ size: [0.6, 0.18, 0.24], pos: [0, top + 0.12, -0.3], color: 0xfff7c2, glow: 2 });
    parts.push({ size: [W + 0.02, 0.1, L * 0.5], pos: [0, 0.6, 0], color: 0x1b1b1b });
  }
  g = mergeBoxes(parts);
  geoCache.set(key, g);
  return g;
}

export type Driver = 'none' | 'player' | 'ai' | 'police';
const push = { x: 0, z: 0 };
const probe = { x: 0, z: 0 };

/** Arcade car: bicycle steering + lateral grip, collides as two circles. */
export class Vehicle {
  readonly mesh: THREE.Mesh;
  readonly pos = new THREE.Vector3();
  readonly spec: VehicleSpec;
  vx = 0;
  vz = 0;
  heading = 0;
  steerAngle = 0;
  throttle = 0; // -1..1
  steer = 0; // -1..1 (positive = left)
  handbrake = false;
  driver: Driver = 'none';
  health = 100;
  impact = 0; // strongest hit this frame (m/s), read by effects/audio/damage
  ai: any = null; // owned by Traffic
  roll = 0;
  readonly radius: number;

  constructor(readonly kind: VehicleKind, color?: number) {
    this.spec = SPECS[kind];
    const c = color ?? this.spec.colors[Math.floor(Math.random() * this.spec.colors.length)];
    this.mesh = new THREE.Mesh(vehicleGeometry(kind, c), carPaintMaterial);
    this.mesh.castShadow = true;
    this.mesh.rotation.order = 'YXZ';
    this.radius = this.spec.wid * 0.5 + 0.12;
  }

  get speed() {
    return this.vx * Math.sin(this.heading) + this.vz * Math.cos(this.heading);
  }
  get wrecked() {
    return this.health <= 0;
  }
  place(x: number, z: number, heading: number) {
    this.pos.set(x, 0, z);
    this.heading = heading;
    this.vx = this.vz = 0;
    this.steerAngle = 0;
    this.sync();
  }
  /** Centre of collision circle i (0 = front, 1 = rear). */
  circle(i: number, out: { x: number; z: number }) {
    const o = (i === 0 ? 1 : -1) * this.spec.len * 0.27;
    out.x = this.pos.x + Math.sin(this.heading) * o;
    out.z = this.pos.z + Math.cos(this.heading) * o;
    return out;
  }

  update(dt: number, city: City, gripScale: number) {
    this.impact = 0;
    const moving = this.vx * this.vx + this.vz * this.vz > 0.0004;
    if (this.driver === 'none' && !moving) return;

    const s = this.spec;
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    const sx = fz, sz = -fx; // side axis
    let vf = this.vx * fx + this.vz * fz;
    let vl = this.vx * sx + this.vz * sz;

    let thr = this.driver === 'none' || this.wrecked ? 0 : this.throttle;
    const offroad = Math.abs(this.pos.x) > WORLD_BOUND - 46 || Math.abs(this.pos.z) > WORLD_BOUND - 46; // sand
    const maxSpeed = s.maxSpeed * (offroad ? 0.55 : 1) * (this.health < 30 ? 0.7 : 1);
    if (thr > 0) {
      if (vf < -0.5) vf += 22 * dt * thr; // braking out of reverse
      else vf += s.accel * thr * Math.max(0, 1 - vf / maxSpeed) * dt;
    } else if (thr < 0) {
      if (vf > 0.5) vf += 24 * dt * thr; // brakes
      else vf += s.accel * 0.6 * thr * Math.max(0, 1 + vf / (maxSpeed * 0.3)) * dt;
    }
    // rolling resistance + drag
    const drag = (this.driver === 'none' ? 2.2 : 0.5) + Math.abs(vf) * 0.012 + (offroad ? 1.2 : 0);
    vf -= Math.sign(vf) * Math.min(Math.abs(vf), drag * dt);
    if (this.handbrake) vf -= Math.sign(vf) * Math.min(Math.abs(vf), 13 * dt);
    const grip = (this.handbrake ? 1.6 : s.grip) * gripScale;
    const slide = Math.abs(vl);
    vl *= Math.exp(-grip * dt);

    // steering: less lock at speed
    const lock = 0.62 - 0.46 * clamp(Math.abs(vf) / s.maxSpeed, 0, 1);
    this.steerAngle = damp(this.steerAngle, this.steer * lock, 9, dt);
    this.heading += ((vf * Math.tan(this.steerAngle)) / (s.len * 0.62)) * dt;

    this.vx = fx * vf + sx * vl;
    this.vz = fz * vf + sz * vl;
    this.pos.x += this.vx * dt;
    this.pos.z += this.vz * dt;

    // static collisions for both circles
    for (let i = 0; i < 2; i++) {
      this.circle(i, probe);
      const bx = probe.x, bz = probe.z;
      if (city.collision.resolveCircle(probe, this.radius, this.pos.y + 0.4, push)) {
        this.pos.x += probe.x - bx;
        this.pos.z += probe.z - bz;
        const vn = this.vx * push.x + this.vz * push.z;
        if (vn < 0) {
          this.vx -= push.x * vn * 1.25;
          this.vz -= push.z * vn * 1.25;
          this.impact = Math.max(this.impact, -vn);
          // glancing hits turn the nose along the wall
          const side = (i === 0 ? 1 : -1) * (push.x * sx + push.z * sz);
          this.heading += clamp(side * -vn * 0.02, -0.08, 0.08);
        }
      }
    }
    if (Math.abs(this.pos.x) > WORLD_BOUND || Math.abs(this.pos.z) > WORLD_BOUND) {
      this.pos.x = clamp(this.pos.x, -WORLD_BOUND, WORLD_BOUND);
      this.pos.z = clamp(this.pos.z, -WORLD_BOUND, WORLD_BOUND);
      this.vx *= 0.5;
      this.vz *= 0.5;
    }
    this.pos.y = damp(this.pos.y, city.groundHeight(this.pos.x, this.pos.z), 14, dt);
    this.roll = damp(this.roll, clamp(-this.steerAngle * vf * 0.012 + (slide > 2 ? Math.sign(vl) * 0.03 : 0), -0.09, 0.09), 6, dt);
    this.sync();
  }

  sync() {
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.set(0, this.heading, this.roll);
  }

  damage(impact: number) {
    if (impact > 5) this.health = Math.max(0, this.health - (impact - 5) * 2.2);
  }
}

const ca = { x: 0, z: 0 }, cb = { x: 0, z: 0 };
/** Pairwise vehicle collisions (two circles each). Returns nothing; sets `impact` on both. */
export function collideVehicles(list: Vehicle[], onHit?: (a: Vehicle, b: Vehicle, impact: number) => void) {
  for (let a = 0; a < list.length; a++) {
    const A = list[a];
    for (let b = a + 1; b < list.length; b++) {
      const B = list[b];
      const dx = A.pos.x - B.pos.x, dz = A.pos.z - B.pos.z;
      if (dx * dx + dz * dz > 49) continue;
      if (A.driver === 'none' && B.driver === 'none' && A.vx === 0 && A.vz === 0 && B.vx === 0 && B.vz === 0) continue;
      for (let i = 0; i < 2; i++)
        for (let j = 0; j < 2; j++) {
          A.circle(i, ca);
          B.circle(j, cb);
          let nx = ca.x - cb.x, nz = ca.z - cb.z;
          const rr = A.radius + B.radius;
          const d2 = nx * nx + nz * nz;
          if (d2 >= rr * rr || d2 < 1e-6) continue;
          const d = Math.sqrt(d2);
          nx /= d;
          nz /= d;
          const pen = (rr - d) / 2;
          A.pos.x += nx * pen; A.pos.z += nz * pen;
          B.pos.x -= nx * pen; B.pos.z -= nz * pen;
          const vn = (A.vx - B.vx) * nx + (A.vz - B.vz) * nz;
          if (vn < 0) {
            const jimp = -1.3 * vn * 0.5;
            A.vx += nx * jimp; A.vz += nz * jimp;
            B.vx -= nx * jimp; B.vz -= nz * jimp;
            A.impact = Math.max(A.impact, -vn);
            B.impact = Math.max(B.impact, -vn);
            if (onHit && -vn > 2) onHit(A, B, -vn);
            // off-centre hits spin the cars a little
            const spin = clamp(-vn * 0.012, 0, 0.08);
            A.heading += (i === 0 ? 1 : -1) * (nx * Math.cos(A.heading) - nz * Math.sin(A.heading)) * spin;
            B.heading -= (j === 0 ? 1 : -1) * (nx * Math.cos(B.heading) - nz * Math.sin(B.heading)) * spin;
          }
        }
    }
  }
}
