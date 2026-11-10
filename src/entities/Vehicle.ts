import * as THREE from 'three';
import { mergeBoxes, carPaintMaterial, vertexColorMaterial, wreckMaterial, BoxPart } from '../core/geo';
import { City } from '../world/City';
import { BOUND, clamp, damp, angleDiff } from '../config';
import { buildLivery } from './Livery';
import { patrolCarParts, patrolCarLivery, ambulanceParts, ambulanceLivery, fireTruckParts, fireTruckLivery } from './Emergency';
import { mcvHullParts, mcvTurretParts, mcvLivery, MCV_TURRET_AT, MCV_MUZZLE } from './Mcv';

export type VehicleKind = 'prius' | 'alphard' | 'taxi' | 'police' | 'ambulance' | 'firetruck' | 'mcv';
export interface VehicleSpec {
  name: string;
  shape: 'prius' | 'alphard' | 'patrol' | 'ambulance' | 'firetruck' | 'mcv';
  wheel: number; // tyre diameter
  len: number;
  wid: number;
  maxSpeed: number; // m/s
  accel: number;
  grip: number;
  colors: number[];
  /** Divides incoming damage (armoured vehicles). */
  armor?: number;
}
const PRIUS_COLORS = [0xd9dde2, 0xf4f4f2, 0x1b1c1f, 0x2a4f8f, 0x9a1c26, 0x7d868c, 0xe6c94a];
export const SPECS: Record<VehicleKind, VehicleSpec> = {
  prius: { name: 'プリウス', shape: 'prius', wheel: 0.68, len: 4.6, wid: 1.8, maxSpeed: 40, accel: 10.5, grip: 7.6, colors: PRIUS_COLORS },
  alphard: { name: 'アルファード', shape: 'alphard', wheel: 0.74, len: 5.0, wid: 1.9, maxSpeed: 34, accel: 8.2, grip: 6.6, colors: [0xf6f5f0, 0xf6f5f0, 0x17181b, 0xc4c8cc, 0x3b3f46] },
  taxi: { name: 'プリウス タクシー', shape: 'prius', wheel: 0.68, len: 4.6, wid: 1.8, maxSpeed: 38, accel: 10, grip: 7.4, colors: [0xf7c21a] },
  police: { name: 'パトカー', shape: 'patrol', wheel: 0.68, len: 4.85, wid: 1.8, maxSpeed: 46, accel: 13, grip: 8, colors: [0xf2f2f2] },
  ambulance: { name: '救急車', shape: 'ambulance', wheel: 0.78, len: 5.6, wid: 1.95, maxSpeed: 38, accel: 9, grip: 6.8, colors: [0xf4f4f1] },
  mcv: { name: '16式機動戦闘車', shape: 'mcv', wheel: 1.24, len: 8.0, wid: 2.7, maxSpeed: 29, accel: 7.5, grip: 6.4, colors: [0x4c5439], armor: 6 },
  firetruck: { name: '消防車', shape: 'firetruck', wheel: 1.02, len: 7.6, wid: 2.35, maxSpeed: 31, accel: 6.2, grip: 6, colors: [0xd3191c] },
};

const GLASS = 0x18222c, TRIM = 0x1b1d21, LAMP = 0xfff3cf, TAIL = 0xff1a1a;

/** Low wedge-shaped liftback: sloping bonnet, steep windscreen, long fastback tail. Returns the roof height. */
function priusParts(parts: BoxPart[], W: number, L: number, color: number): number {
  const h = L / 2;
  parts.push(
    { size: [W, 0.5, L], pos: [0, 0.55, 0], color },
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
  const parts: BoxPart[] = s.shape === 'mcv' ? mcvHullParts(W, L, s.wheel) : [];
  const top = s.shape === 'mcv' ? 0 :
    s.shape === 'prius' ? priusParts(parts, W, L, color)
    : s.shape === 'patrol' ? patrolCarParts(parts, W, L, s.wheel)
    : s.shape === 'alphard' ? alphardParts(parts, W, L, color)
    : s.shape === 'ambulance' ? ambulanceParts(parts, W, L)
    : fireTruckParts(parts, W, L);
  // wheels: a tyre cylinder with a slightly wider hub so the rim shows from the side
  const d = s.wheel;
  if (s.shape !== 'mcv') for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const at: [number, number, number] = [sx * (W / 2 - 0.1), d / 2, sz * L * 0.3];
      parts.push({ size: [0.26, d, d], pos: at, color: 0x0e0e10, cyl: true });
      parts.push({ size: [0.28, d * 0.6, d * 0.6], pos: at, color: 0xb4b7bd, cyl: true });
      parts.push({ size: [0.285, d * 0.46, d * 0.46], pos: at, color: 0x5d6168, cyl: true });
      parts.push({ size: [0.3, d * 0.2, d * 0.2], pos: at, color: 0xc9ccd2, cyl: true });
    }
  if (kind === 'taxi') {
    parts.push({ size: [0.6, 0.18, 0.24], pos: [0, top + 0.12, -0.3], color: 0xfff7c2, glow: 2 });
    parts.push({ size: [W + 0.02, 0.1, L * 0.5], pos: [0, 0.6, 0], color: 0x1b1b1b });
  }
  g = mergeBoxes(parts);
  geoCache.set(key, g);
  return g;
}

const liveryCache = new Map<VehicleKind, THREE.Mesh | null>();
/** Printed lettering for emergency vehicles; geometry and texture are shared between cars of a kind. */
function vehicleLivery(kind: VehicleKind): THREE.Mesh | null {
  let m = liveryCache.get(kind);
  if (m === undefined) {
    const { len: L, wid: W } = SPECS[kind];
    const l = kind === 'mcv' ? mcvLivery(W, L) : kind === 'police' ? patrolCarLivery(W, L) : kind === 'ambulance' ? ambulanceLivery(W, L) : kind === 'firetruck' ? fireTruckLivery(W, L) : null;
    m = l ? buildLivery(l) : null;
    liveryCache.set(kind, m);
  }
  return m ? m.clone() : null;
}

let turretGeo: THREE.BufferGeometry | null = null;
const HOP = 0.75; // seconds a blown-up car spends in the air

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
  pitch = 0;
  readonly radius: number;
  /** Traversable gun turret (16式 only); its rotation.y is the traverse relative to the hull. */
  readonly turret: THREE.Mesh | null = null;
  gunT = 0; // seconds until the main gun is reloaded
  /** Seconds left before a wrecked car blows up; negative while the fuse is not lit. */
  fuse = -1;
  exploded = false;
  burnT = 0; // seconds the wreck keeps burning
  private hopT = 0;
  private hopSpin = 0;

  constructor(readonly kind: VehicleKind, color?: number) {
    this.spec = SPECS[kind];
    const c = color ?? this.spec.colors[Math.floor(Math.random() * this.spec.colors.length)];
    this.mesh = new THREE.Mesh(vehicleGeometry(kind, c), kind === 'mcv' ? vertexColorMaterial : carPaintMaterial);
    this.mesh.castShadow = true;
    const livery = vehicleLivery(kind);
    if (livery) this.mesh.add(livery);
    if (kind === 'mcv') {
      turretGeo ??= mergeBoxes(mcvTurretParts());
      this.turret = new THREE.Mesh(turretGeo, vertexColorMaterial);
      this.turret.castShadow = true;
      this.turret.position.set(...MCV_TURRET_AT);
      this.mesh.add(this.turret);
    }
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
  /** Nose-up/down angle of the ground under the car. */
  private slope(city: City) {
    const fx = Math.sin(this.heading) * 1.5, fz = Math.cos(this.heading) * 1.5;
    return -Math.atan2(city.groundHeight(this.pos.x + fx, this.pos.z + fz) - city.groundHeight(this.pos.x - fx, this.pos.z - fz), 3);
  }
  /** Sit on the terrain immediately (after spawning or teleporting). */
  settle(city: City) {
    this.pos.y = city.groundHeight(this.pos.x, this.pos.z);
    this.pitch = this.slope(city);
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
    const offroad = false;
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
    if (Math.abs(this.pos.x) > BOUND.x || Math.abs(this.pos.z) > BOUND.z) {
      this.pos.x = clamp(this.pos.x, -BOUND.x, BOUND.x);
      this.pos.z = clamp(this.pos.z, -BOUND.z, BOUND.z);
      this.vx *= 0.5;
      this.vz *= 0.5;
    }
    this.pos.y = damp(this.pos.y, city.groundHeight(this.pos.x, this.pos.z), 14, dt);
    this.pitch = damp(this.pitch, this.slope(city), 8, dt);
    this.roll = damp(this.roll, clamp(-this.steerAngle * vf * 0.012 + (slide > 2 ? Math.sign(vl) * 0.03 : 0), -0.09, 0.09), 6, dt);
    this.sync();
  }

  sync() {
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.set(this.pitch, this.heading, this.roll);
  }

  damage(impact: number) {
    if (impact > 5) this.hurt((impact - 5) * 2.2);
  }
  /** Blown up: the shell turns to soot, is thrown into the air and burns for a while. */
  blowUp() {
    this.exploded = true;
    this.health = 0;
    this.fuse = -1;
    this.burnT = 14;
    this.hopT = HOP;
    this.hopSpin = (Math.random() < 0.5 ? -1 : 1) * (0.25 + Math.random() * 0.35);
    this.driver = 'none';
    this.throttle = this.steer = 0;
    this.mesh.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m === this.mesh || m === this.turret) m.material = wreckMaterial;
      else m.visible = false; // lettering burns off
    });
  }
  /** Back to factory condition (traffic reuses abandoned cars). */
  restore() {
    this.health = 100;
    this.fuse = -1;
    this.burnT = this.hopT = 0;
    if (!this.exploded) return;
    this.exploded = false;
    const paint = this.kind === 'mcv' ? vertexColorMaterial : carPaintMaterial;
    this.mesh.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m === this.mesh || m === this.turret) m.material = paint;
      else m.visible = true;
    });
  }
  /** The blast tosses the wreck up and lets it drop back, rocking as it lands. */
  animateWreck(dt: number) {
    if (this.hopT <= 0) return;
    this.hopT = Math.max(0, this.hopT - dt);
    const t = 1 - this.hopT / HOP, arc = Math.sin(t * Math.PI);
    this.sync();
    this.mesh.position.y += arc * 1.5;
    this.mesh.rotation.z += arc * this.hopSpin;
    this.mesh.rotation.x += arc * 0.18;
    if (this.turret) this.turret.rotation.y += dt * 2.5 * (1 - t);
  }
  /** Lose health, scaled down by armour. */
  hurt(amount: number) {
    this.health = Math.max(0, this.health - amount / (this.spec.armor ?? 1));
  }
  /** Turn the turret towards a world heading, at a limited traverse rate. Returns the remaining error in radians. */
  aimTurret(worldYaw: number, dt: number) {
    const t = this.turret;
    if (!t) return 0;
    const diff = angleDiff(worldYaw - this.heading, t.rotation.y);
    t.rotation.y += clamp(diff, -1.4 * dt, 1.4 * dt);
    return Math.abs(diff);
  }
  /** Muzzle position and firing direction of the main gun (pitch and roll are ignored). */
  muzzle(out: { x: number; y: number; z: number; dx: number; dz: number }) {
    const a = this.heading + (this.turret?.rotation.y ?? 0);
    const tx = this.pos.x + Math.sin(this.heading) * MCV_TURRET_AT[2], tz = this.pos.z + Math.cos(this.heading) * MCV_TURRET_AT[2];
    out.dx = Math.sin(a);
    out.dz = Math.cos(a);
    out.x = tx + out.dx * MCV_MUZZLE.reach;
    out.z = tz + out.dz * MCV_MUZZLE.reach;
    out.y = this.pos.y + MCV_TURRET_AT[1] + MCV_MUZZLE.height;
    return out;
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
