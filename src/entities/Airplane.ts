import * as THREE from 'three';
import { Input } from '../core/Input';
import { City } from '../world/City';
import { BOUND, clamp, damp, angleDiff } from '../config';
import { A321Model } from './A321';

const SCALE = 0.75; // like the helicopter, a little under full size so it fits the streets
const VMAX = 65, STALL = 24, ROTATE = 28; // m/s
const HALF = 12.5; // collision circles sit this far ahead of and behind the centre
const push = { x: 0, z: 0 };
const probe = { x: 0, z: 0 };

/**
 * Flyable Vietjet A321. W throttle up, S throttle down / brake, A/D steer (bank in the air),
 * Space pull up (lifts off above rotation speed), Shift push down. Shares the helicopter's
 * interface so the game treats both as aircraft.
 */
export class Airplane {
  readonly group = new THREE.Group();
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  heading = 0;
  health = 100;
  spin = 0; // engine spool 0..1
  speed = 0; // along the nose
  piloted = false;
  destroyed = false;
  respawnT = 0;
  impact = 0;
  night = 0;
  readonly radius = 2.4;
  readonly title = 'Vietjet A321';
  readonly help = '✈️ <b>W</b> 加速 / <b>S</b> 減速 / <b>A D</b> 旋回 / <b>Space</b> 機首上げ（110km/h 以上で離陸）/ <b>Shift</b> 機首下げ。着陸して止まり <b>E</b> で降りる。';
  readonly music = true;
  readonly camDist = 26;
  readonly camLift = 3;
  /** Where the pilot steps out: beside the forward door. */
  readonly exitSide = 3.6;
  readonly exitFwd = 11;
  private model: A321Model;
  private pitch = 0;
  private roll = 0;
  private gearUp = 0;

  constructor(readonly home: { x: number; z: number; heading: number }, private city: City, maxTexture: number) {
    this.model = new A321Model(maxTexture);
    this.model.group.scale.setScalar(SCALE);
    this.group.add(this.model.group);
    this.group.rotation.order = 'YXZ';
    this.reset();
  }

  reset() {
    this.pos.set(this.home.x, this.city.groundHeight(this.home.x, this.home.z), this.home.z);
    this.vel.set(0, 0, 0);
    this.heading = this.home.heading;
    this.health = 100;
    this.spin = this.speed = this.pitch = this.roll = this.gearUp = 0;
    this.piloted = false;
    this.destroyed = false;
    this.group.visible = true;
    this.model.animate(0, 0, 0, this.night);
    this.sync();
  }

  get airspeed() {
    return Math.abs(this.speed);
  }
  altitude(city: City) {
    return this.pos.y - this.floor(city);
  }
  private floor(city: City) {
    return Math.max(city.groundHeight(this.pos.x, this.pos.z), city.collision.topBelow(this.pos.x, this.pos.z, this.pos.y + 0.6));
  }
  /** True when `p` stands close enough to the fuselage to board. */
  canBoard(p: THREE.Vector3) {
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    const dx = p.x - this.pos.x, dz = p.z - this.pos.z;
    const along = clamp(dx * fx + dz * fz, -15, 15);
    return (dx - fx * along) ** 2 + (dz - fz * along) ** 2 < 30 && Math.abs(p.y - this.pos.y) < 4;
  }

  update(dt: number, input: Input | null, city: City) {
    this.impact = 0;
    if (this.destroyed) return;
    const alive = this.health > 0;
    const ctl = this.piloted && alive ? input : null;
    const onGround = this.altitude(city) < 0.05;

    let turn = 0, lift = 0, gas = 0;
    if (ctl) {
      turn = ctl.axis('KeyD', 'KeyA');
      gas = ctl.axis('KeyS', 'KeyW');
      lift = (ctl.isDown('Space') ? 1 : 0) - (ctl.isDown('ShiftLeft') || ctl.isDown('ShiftRight') ? 1 : 0);
      if (gas > 0) this.speed = Math.min(VMAX, this.speed + 9 * dt);
      else if (gas < 0) this.speed = Math.max(onGround ? -3 : 0, this.speed - (onGround ? 16 : 7) * dt);
      else if (onGround) this.speed -= Math.sign(this.speed) * Math.min(Math.abs(this.speed), 1.2 * dt); // rolling drag
    } else if (onGround) this.speed -= Math.sign(this.speed) * Math.min(Math.abs(this.speed), 12 * dt); // parking brake
    else this.speed *= Math.exp(-0.25 * dt);
    this.spin = damp(this.spin, ctl ? (gas > 0 ? 1 : 0.3 + 0.5 * (this.airspeed / VMAX)) : 0, 1.2, dt);
    this.model.animate(dt, this.spin, this.gearUp, this.night);
    if (!ctl && onGround && this.airspeed < 0.02) return; // parked

    // fly back towards the city when far outside the map
    const edge = Math.max(Math.abs(this.pos.x) - BOUND.x, Math.abs(this.pos.z) - BOUND.z);
    if (edge > 700 && !onGround) this.heading += clamp(angleDiff(Math.atan2(-this.pos.x, -this.pos.z), this.heading) * 2, -1, 1) * 0.9 * dt;
    else this.heading += turn * (onGround ? clamp(this.speed / 10, -1, 1) * 0.7 : 0.6) * dt;

    if (!alive) this.vel.y -= 13 * dt;
    else if (onGround) this.vel.y = lift > 0 && this.speed > ROTATE ? damp(this.vel.y, 9, 2.5, dt) : 0;
    else {
      // below stall speed the wing lets go and the aircraft sinks
      const target = this.speed < STALL ? -4 - (STALL - this.speed) * 0.5 : lift > 0 ? 16 * clamp((this.speed - STALL) / 12, 0, 1) : lift * 12;
      this.vel.y = damp(this.vel.y, target, 2, dt);
    }
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    this.vel.x = fx * this.speed;
    this.vel.z = fz * this.speed;
    this.pos.addScaledVector(this.vel, dt);

    // walls: the fuselage is three circles (nose, centre, tail); the wings pass over and through
    for (const off of [HALF, 0, -HALF]) {
      const ox = (probe.x = this.pos.x + fx * off), oz = (probe.z = this.pos.z + fz * off);
      if (!city.collision.resolveCircle(probe, this.radius, this.pos.y + 0.6, push)) continue;
      this.pos.x += probe.x - ox;
      this.pos.z += probe.z - oz;
      const c = fx * push.x + fz * push.z; // -1 = head-on
      const vn = c * this.speed;
      if (vn < 0) {
        this.impact = Math.max(this.impact, -vn);
        this.speed *= Math.max(0, 1 - c * c);
      }
    }
    this.pos.x = clamp(this.pos.x, -BOUND.x - 900, BOUND.x + 900);
    this.pos.z = clamp(this.pos.z, -BOUND.z - 900, BOUND.z + 900);
    if (this.pos.y > 500) {
      this.pos.y = 500;
      this.vel.y = Math.min(0, this.vel.y);
    }
    const floor = this.floor(city);
    if (this.pos.y <= floor) {
      if (this.vel.y < -13) this.impact = Math.max(this.impact, -this.vel.y); // a firm touchdown is fine, a stall onto the runway is not
      this.pos.y = floor;
      this.vel.y = Math.max(0, this.vel.y);
    }
    if (this.impact > 4) this.health = Math.max(0, this.health - (this.impact - 4) * 2.5);

    const air = this.pos.y - floor > 0.05;
    const nose = !alive ? 0.5 : air ? -clamp(Math.atan2(this.vel.y, Math.max(this.speed, 20)) + 0.03, -0.35, 0.4) : lift > 0 && this.speed > ROTATE * 0.85 ? -0.12 : 0;
    this.pitch = damp(this.pitch, nose, 2.5, dt);
    this.roll = damp(this.roll, air ? -turn * 0.5 * clamp(this.speed / STALL, 0, 1) : 0, 2.2, dt);
    const up = this.pos.y - floor > 10 ? 1 : 0;
    this.gearUp = clamp(this.gearUp + (up ? 0.4 : -0.5) * dt, 0, 1);
    this.sync();
  }

  sync() {
    this.group.position.copy(this.pos);
    this.group.rotation.set(this.pitch, this.heading, this.roll);
  }
}
