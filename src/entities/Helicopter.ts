import * as THREE from 'three';
import { mergeBoxes, carPaintMaterial } from '../core/geo';
import { Input } from '../core/Input';
import { City } from '../world/City';
import { BOUND, clamp, damp } from '../config';
import { buildLivery } from './Livery';
import { uh60jBody, uh60jRotor, uh60jTailRotor, uh60jLivery, ROTOR_AT, TAIL_ROTOR_AT } from './Uh60j';

const push = { x: 0, z: 0 };
let bodyGeo: THREE.BufferGeometry | null = null;
let rotorGeo: THREE.BufferGeometry | null = null;
let tailGeo: THREE.BufferGeometry | null = null;
let livery: THREE.Mesh | null = null;

/** Flyable JASDF UH-60J: W/S fly forward/back, A/D turn, Space climb, Shift descend. Lands on streets and rooftops. */
export class Helicopter {
  readonly group = new THREE.Group();
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  heading = 0;
  health = 100;
  spin = 0; // rotor speed 0..1
  piloted = false;
  destroyed = false;
  respawnT = 0;
  impact = 0;
  private rotor: THREE.Mesh;
  private tailRotor: THREE.Mesh;
  private pitch = 0;
  private roll = 0;
  readonly radius = 2.1;
  readonly title = 'UH-60J';
  readonly help = '🚁 <b>Space</b> 上昇 / <b>Shift</b> 下降 / <b>W A S D</b> 飛行。着陸して <b>E</b> で降りる。';
  readonly music = false;
  readonly camDist = 0;
  readonly camLift = 0;
  readonly exitSide = 2.4;
  readonly exitFwd = 0;

  constructor(readonly home: { x: number; z: number; heading: number }, private city: City) {
    bodyGeo ??= mergeBoxes(uh60jBody());
    rotorGeo ??= mergeBoxes(uh60jRotor());
    tailGeo ??= mergeBoxes(uh60jTailRotor());
    livery ??= buildLivery(uh60jLivery());
    const body = new THREE.Mesh(bodyGeo, carPaintMaterial);
    this.rotor = new THREE.Mesh(rotorGeo, carPaintMaterial);
    this.rotor.position.set(...ROTOR_AT);
    this.tailRotor = new THREE.Mesh(tailGeo, carPaintMaterial);
    this.tailRotor.position.set(...TAIL_ROTOR_AT);
    this.group.add(body, this.rotor, this.tailRotor);
    this.group.traverse((m) => ((m as THREE.Mesh).castShadow = true));
    this.group.add(livery.clone()); // lettering: added after the shadow pass so it casts none
    this.group.rotation.order = 'YXZ';
    this.reset();
  }

  reset() {
    this.pos.set(this.home.x, this.city.groundHeight(this.home.x, this.home.z), this.home.z);
    this.vel.set(0, 0, 0);
    this.heading = this.home.heading;
    this.health = 100;
    this.spin = 0;
    this.piloted = false;
    this.destroyed = false;
    this.group.visible = true;
    this.sync();
  }

  canBoard(p: THREE.Vector3) {
    return this.pos.distanceToSquared(p) < 22;
  }
  get airspeed() {
    return Math.hypot(this.vel.x, this.vel.z);
  }
  /** Height above whatever is directly below (street, sidewalk or a roof). */
  altitude(city: City) {
    return this.pos.y - this.floor(city);
  }
  private floor(city: City) {
    return Math.max(city.groundHeight(this.pos.x, this.pos.z), city.collision.topBelow(this.pos.x, this.pos.z, this.pos.y + 0.6));
  }

  update(dt: number, input: Input | null, city: City) {
    this.impact = 0;
    if (this.destroyed) return;
    const flying = this.piloted && this.health > 0 && input;
    this.spin = damp(this.spin, flying ? 1 : 0, flying ? 1.1 : 0.5, dt);
    const lift = flying && this.spin > 0.8;
    const onGround = this.altitude(city) < 0.05;
    if (!lift && onGround && this.vel.lengthSq() < 1e-4) {
      // parked: only the rotor winds down
      this.rotor.rotation.y += this.spin * 26 * dt;
      this.tailRotor.rotation.x += this.spin * 40 * dt;
      return;
    }

    let turn = 0, fwd = 0;
    if (lift) {
      turn = input!.axis('KeyD', 'KeyA');
      fwd = input!.axis('KeyS', 'KeyW');
      const climb = (input!.isDown('Space') ? 1 : 0) - (input!.isDown('ShiftLeft') || input!.isDown('ShiftRight') ? 1 : 0);
      this.heading += turn * 1.5 * dt;
      const sp = fwd > 0 ? 32 : 12;
      const tx = Math.sin(this.heading) * fwd * sp, tz = Math.cos(this.heading) * fwd * sp;
      const k = 1 - Math.exp(-(onGround ? 0.4 : 1.1) * dt);
      this.vel.x += (tx - this.vel.x) * k;
      this.vel.z += (tz - this.vel.z) * k;
      this.vel.y = damp(this.vel.y, climb > 0 ? 11 : climb * 8, 3, dt); // descents are gentle enough to land without damage
    } else {
      this.vel.y -= 13 * dt; // no lift: it drops
      const k = Math.exp(-0.4 * dt);
      this.vel.x *= k;
      this.vel.z *= k;
    }
    this.pos.addScaledVector(this.vel, dt);

    // walls: anything taller than the skids' height pushes the airframe out
    if (city.collision.resolveCircle(this.pos, this.radius, this.pos.y + 0.4, push)) {
      const vn = this.vel.x * push.x + this.vel.z * push.z;
      if (vn < 0) {
        this.vel.x -= push.x * vn * 1.4;
        this.vel.z -= push.z * vn * 1.4;
        this.impact = -vn;
      }
    }
    this.pos.x = clamp(this.pos.x, -BOUND.x - 900, BOUND.x + 900);
    this.pos.z = clamp(this.pos.z, -BOUND.z - 900, BOUND.z + 900);
    if (this.pos.y > 420) {
      this.pos.y = 420;
      this.vel.y = Math.min(0, this.vel.y);
    }
    const floor = this.floor(city);
    if (this.pos.y <= floor) {
      if (this.vel.y < -9.5) this.impact = Math.max(this.impact, -this.vel.y); // only a free fall is a hard landing
      this.pos.y = floor;
      this.vel.y = Math.max(0, this.vel.y);
      const k = Math.exp(-5 * dt);
      this.vel.x *= k;
      this.vel.z *= k;
    }
    if (this.impact > 4) this.health = Math.max(0, this.health - (this.impact - 4) * 2.5);

    const vf = this.vel.x * Math.sin(this.heading) + this.vel.z * Math.cos(this.heading);
    this.pitch = damp(this.pitch, clamp(vf * 0.011, -0.2, 0.35), 3, dt);
    this.roll = damp(this.roll, -turn * 0.22 * clamp(this.airspeed / 12, 0, 1), 3, dt);
    this.rotor.rotation.y += this.spin * 26 * dt;
    this.tailRotor.rotation.x += this.spin * 40 * dt;
    this.sync();
  }

  sync() {
    this.group.position.copy(this.pos);
    this.group.rotation.set(this.pitch, this.heading, this.roll);
  }
}
