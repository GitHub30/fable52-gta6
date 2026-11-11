import * as THREE from 'three';
import { mergeBoxes, vertexColorMaterial, wreckMaterial } from '../core/geo';
import { City } from '../world/City';
import { BOUND, clamp, damp, angleDiff } from '../config';
import { buildLivery } from './Livery';
import { mcvHullParts, mcvTurretParts, mcvLivery, MCV_TURRET_AT, MCV_MUZZLE } from './Mcv';
import { carAssets, rigMesh, CarAssets, DoorRole } from './car/CarKit';
import { carDef } from './car/models';

export type VehicleKind = 'prius' | 'alphard' | 'taxi' | 'police' | 'ambulance' | 'firetruck' | 'mcv';
export interface VehicleSpec {
  name: string;
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
  prius: { name: 'プリウス', wheel: 0.68, len: 4.6, wid: 1.8, maxSpeed: 40, accel: 10.5, grip: 7.6, colors: PRIUS_COLORS },
  alphard: { name: 'アルファード', wheel: 0.74, len: 5.0, wid: 1.9, maxSpeed: 34, accel: 8.2, grip: 6.6, colors: [0xf6f5f0, 0xf6f5f0, 0x17181b, 0xc4c8cc, 0x3b3f46] },
  taxi: { name: 'プリウス タクシー', wheel: 0.68, len: 4.6, wid: 1.8, maxSpeed: 38, accel: 10, grip: 7.4, colors: [0xf7c21a] },
  police: { name: 'パトカー', wheel: 0.68, len: 4.85, wid: 1.8, maxSpeed: 46, accel: 13, grip: 8, colors: [0xf2f2f2] },
  ambulance: { name: '救急車', wheel: 0.78, len: 5.6, wid: 1.95, maxSpeed: 38, accel: 9, grip: 6.8, colors: [0xf4f4f1] },
  mcv: { name: '16式機動戦闘車', wheel: 1.24, len: 8.0, wid: 2.7, maxSpeed: 29, accel: 7.5, grip: 6.4, colors: [0x4c5439], armor: 6 },
  firetruck: { name: '消防車', wheel: 1.02, len: 7.6, wid: 2.35, maxSpeed: 31, accel: 6.2, grip: 6, colors: [0xd3191c] },
};

let hullGeo: THREE.BufferGeometry | null = null;
let hullLivery: THREE.Mesh | null = null;
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
  /** Skinned road cars: bones, how far each door is open (0..1) and where it is heading. */
  private car: { assets: CarAssets; bones: THREE.Bone[]; open: Float32Array; want: Float32Array; closeT: number; spin: number; steer: number; crewed: boolean } | null = null;

  constructor(readonly kind: VehicleKind, color?: number) {
    this.spec = SPECS[kind];
    const c = color ?? this.spec.colors[Math.floor(Math.random() * this.spec.colors.length)];
    const def = carDef(kind);
    if (def) {
      const assets = carAssets(def, kind, c), { mesh, bones } = rigMesh(assets), n = assets.rig.doors.length;
      this.mesh = mesh;
      this.car = { assets, bones, open: new Float32Array(n), want: new Float32Array(n), closeT: 0, spin: 0, steer: 0, crewed: true };
      this.mesh.rotation.order = 'YXZ';
      this.radius = this.spec.wid * 0.5 + 0.12;
      this.animate(0);
      return;
    }
    // the 16式 is still built from merged boxes: hull, printed markings and a turret that traverses
    hullGeo ??= mergeBoxes(mcvHullParts(this.spec.wid, this.spec.len, this.spec.wheel));
    hullLivery ??= buildLivery(mcvLivery(this.spec.wid, this.spec.len));
    this.mesh = new THREE.Mesh(hullGeo, vertexColorMaterial);
    this.mesh.castShadow = true;
    this.mesh.add(hullLivery.clone());
    turretGeo ??= mergeBoxes(mcvTurretParts());
    this.turret = new THREE.Mesh(turretGeo, vertexColorMaterial);
    this.turret.castShadow = true;
    this.turret.position.set(...MCV_TURRET_AT);
    this.mesh.add(this.turret);
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
    return -Math.atan2(city.roadHeight(this.pos.x + fx, this.pos.z + fz) - city.roadHeight(this.pos.x - fx, this.pos.z - fz), 3);
  }
  /** Sit on the terrain immediately (after spawning or teleporting). */
  settle(city: City) {
    this.pos.y = city.roadHeight(this.pos.x, this.pos.z);
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
    this.pos.y = damp(this.pos.y, city.roadHeight(this.pos.x, this.pos.z), 14, dt);
    this.pitch = damp(this.pitch, this.slope(city), 8, dt);
    this.roll = damp(this.roll, clamp(-this.steerAngle * vf * 0.012 + (slide > 2 ? Math.sign(vl) * 0.03 : 0), -0.09, 0.09), 6, dt);
    this.sync();
  }

  sync() {
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.set(this.pitch, this.heading, this.roll);
  }

  /** Open or close the doors with a role ('all' = every door and the tailgate). With `holdFor` they shut again by themselves. */
  setDoors(role: DoorRole | 'all', open: boolean, holdFor = 0) {
    const c = this.car;
    if (!c || this.exploded) return;
    c.assets.rig.doors.forEach((d, i) => {
      if (role === 'all' || d.role === role) c.want[i] = open ? 1 : 0;
    });
    c.closeT = open ? holdFor : 0;
  }
  get hasDoors() {
    return !!this.car;
  }
  get doorsOpen() {
    return !!this.car && this.car.want.some((w) => w > 0);
  }
  /** Side (+1 left, -1 right) and distance along the car at which the driver gets in and out. */
  get driverDoor() {
    const seat = this.car?.assets.rig.seat;
    return seat ? { side: Math.sign(seat[0]) || 1, z: seat[2] - 0.15 } : { side: 1, z: 0 };
  }

  /** Wheels, steering, doors and the figure at the wheel. Runs every frame, also for parked cars. */
  animate(dt: number) {
    const c = this.car;
    if (!c) return;
    const rig = c.assets.rig, sp = this.speed;
    if (sp !== 0 || c.steer !== this.steerAngle || dt === 0) {
      c.spin = (c.spin + sp * dt) % 1000;
      c.steer = this.steerAngle;
      for (const w of rig.wheels) {
        c.bones[w.spin].rotation.x = c.spin / w.r;
        if (w.steer >= 0) c.bones[w.steer].rotation.y = c.steer;
      }
    }
    // doors never stay open on a moving car
    if ((c.closeT > 0 && (c.closeT -= dt) <= 0) || Math.abs(sp) > 3) c.want.fill(0);
    rig.doors.forEach((d, i) => {
      if (c.open[i] === c.want[i] && dt > 0) return;
      const t = (c.open[i] += clamp(c.want[i] - c.open[i], -dt * 2.4, dt * 2.4));
      const e = t * t * (3 - 2 * t), bone = c.bones[d.bone], rest = rig.bones[d.bone].pos;
      if (d.kind === 'swing') bone.rotation.y = -d.side * d.amount * e;
      else if (d.kind === 'lift') bone.rotation.x = d.amount * e;
      else {
        // sliding door: pops out of its frame first, then runs back along the flank
        const out = Math.min(1, t * 3.5), back = clamp((t - 0.18) / 0.82, 0, 1);
        bone.position.set(rest[0] + d.side * 0.13 * out * out * (3 - 2 * out), rest[1], rest[2] - d.amount * back * back * (3 - 2 * back));
      }
    });
    const crewed = this.driver !== 'none' && !this.exploded;
    if (crewed !== c.crewed || dt === 0) {
      c.crewed = crewed;
      if (rig.driver >= 0) c.bones[rig.driver].scale.setScalar(crewed ? 1 : 1e-4);
    }
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
    if (this.car) {
      // burnt-out shell: soot over the same cut-out skin, no glass left
      this.mesh.material = this.car.assets.wreck;
      return;
    }
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
    if (this.car) {
      this.mesh.material = this.car.assets.materials;
      return;
    }
    this.mesh.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m === this.mesh || m === this.turret) m.material = vertexColorMaterial;
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
