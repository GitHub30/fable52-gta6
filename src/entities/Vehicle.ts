import * as THREE from 'three';
import { mergeBoxes, carPaintMaterial, BoxPart } from '../core/geo';
import { City } from '../world/City';
import { WORLD_BOUND, clamp, damp } from '../config';

export type VehicleKind = 'sedan' | 'sports' | 'van' | 'taxi' | 'police';
export interface VehicleSpec {
  name: string;
  len: number;
  wid: number;
  body: number; // body height
  cabin: number; // cabin height
  maxSpeed: number; // m/s
  accel: number;
  grip: number;
  colors: number[];
}
export const SPECS: Record<VehicleKind, VehicleSpec> = {
  sedan: { name: 'セダン', len: 4.5, wid: 1.9, body: 0.6, cabin: 0.5, maxSpeed: 34, accel: 9, grip: 7, colors: [0xb8bcc2, 0x2d3f66, 0x7a1f24, 0x1e1f22, 0xe8e4da, 0x3a6b52, 0x8a6d3b] },
  sports: { name: 'スポーツカー', len: 4.3, wid: 1.95, body: 0.5, cabin: 0.38, maxSpeed: 52, accel: 15, grip: 8.5, colors: [0xff3b3b, 0xffc400, 0x19c5d6, 0xff5fa2, 0xf5f5f5, 0x7c3aed] },
  van: { name: 'バン', len: 5.2, wid: 2.1, body: 0.8, cabin: 0.9, maxSpeed: 27, accel: 6.5, grip: 6, colors: [0xf0f0f0, 0x4a6fa5, 0x9a9a9a, 0xd9822b] },
  taxi: { name: 'タクシー', len: 4.5, wid: 1.9, body: 0.6, cabin: 0.5, maxSpeed: 36, accel: 9.5, grip: 7, colors: [0xf7c21a] },
  police: { name: 'パトカー', len: 4.6, wid: 1.95, body: 0.6, cabin: 0.5, maxSpeed: 46, accel: 13, grip: 8, colors: [0xf2f2f2] },
};

const geoCache = new Map<string, THREE.BufferGeometry>();
function vehicleGeometry(kind: VehicleKind, color: number) {
  const key = kind + color;
  let g = geoCache.get(key);
  if (g) return g;
  const s = SPECS[kind];
  const { len: L, wid: W } = s;
  const y0 = 0.32; // ground clearance
  const cabLen = kind === 'van' ? L * 0.72 : L * 0.5;
  const cabZ = kind === 'van' ? -L * 0.1 : -L * 0.06;
  const top = y0 + s.body + s.cabin;
  const parts: BoxPart[] = [
    { size: [W, s.body, L], pos: [0, y0 + s.body / 2, 0], color },
    { size: [W * 0.86, s.cabin, cabLen], pos: [0, y0 + s.body + s.cabin / 2, cabZ], color: 0x18222c },
    { size: [W * 0.88, 0.07, cabLen * 0.94], pos: [0, top + 0.035, cabZ], color },
    // pillars so the cabin does not read as a black brick
    { size: [W * 0.89, s.cabin, 0.12], pos: [0, y0 + s.body + s.cabin / 2, cabZ + cabLen / 2 - 0.5], color: kind === 'police' ? 0x15171a : color },
    { size: [W * 0.89, s.cabin, 0.12], pos: [0, y0 + s.body + s.cabin / 2, cabZ - cabLen / 2 + 0.4], color: kind === 'police' ? 0x15171a : color },
    // bumpers and lamps
    { size: [W + 0.06, 0.2, 0.2], pos: [0, y0 + 0.14, L / 2], color: 0x202226 },
    { size: [W + 0.06, 0.2, 0.2], pos: [0, y0 + 0.14, -L / 2], color: 0x202226 },
    { size: [0.42, 0.16, 0.08], pos: [W / 2 - 0.3, y0 + s.body - 0.16, L / 2 + 0.01], color: 0xfff3cf, glow: 3 },
    { size: [0.42, 0.16, 0.08], pos: [-W / 2 + 0.3, y0 + s.body - 0.16, L / 2 + 0.01], color: 0xfff3cf, glow: 3 },
    { size: [0.42, 0.14, 0.08], pos: [W / 2 - 0.3, y0 + s.body - 0.16, -L / 2 - 0.01], color: 0xff1a1a, glow: 1.5 },
    { size: [0.42, 0.14, 0.08], pos: [-W / 2 + 0.3, y0 + s.body - 0.16, -L / 2 - 0.01], color: 0xff1a1a, glow: 1.5 },
  ];
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const p: [number, number, number] = [sx * (W / 2 - 0.1), 0.34, sz * L * 0.31];
      parts.push({ size: [0.26, 0.5, 0.5], pos: p, color: 0x0e0e10 });
      parts.push({ size: [0.26, 0.5, 0.5], pos: p, color: 0x0e0e10, rot: [Math.PI / 4, 0, 0] });
      parts.push({ size: [0.28, 0.26, 0.26], pos: p, color: 0x9a9da3 });
    }
  if (kind === 'police') {
    parts.push({ size: [W + 0.02, s.body * 0.55, L * 0.34], pos: [0, y0 + s.body * 0.5, 0], color: 0x15171a });
    parts.push({ size: [0.5, 0.14, 0.26], pos: [0.3, top + 0.14, cabZ], color: 0x2a5cff, glow: 4 });
    parts.push({ size: [0.5, 0.14, 0.26], pos: [-0.3, top + 0.14, cabZ], color: 0xff2020, glow: 4 });
  } else if (kind === 'taxi') {
    parts.push({ size: [0.6, 0.18, 0.24], pos: [0, top + 0.16, cabZ], color: 0xfff7c2, glow: 2 });
    parts.push({ size: [W + 0.02, 0.12, L * 0.5], pos: [0, y0 + s.body * 0.5, 0], color: 0x1b1b1b });
  } else if (kind === 'sports') {
    parts.push({ size: [W * 0.9, 0.06, 0.34], pos: [0, y0 + s.body + 0.22, -L / 2 + 0.2], color: 0x18181b });
    parts.push({ size: [0.08, 0.2, 0.2], pos: [W * 0.36, y0 + s.body + 0.1, -L / 2 + 0.2], color: 0x18181b });
    parts.push({ size: [0.08, 0.2, 0.2], pos: [-W * 0.36, y0 + s.body + 0.1, -L / 2 + 0.2], color: 0x18181b });
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
