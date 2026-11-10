import * as THREE from 'three';
import { mergeBoxes, carPaintMaterial } from '../core/geo';
import { Input } from '../core/Input';
import { City } from '../world/City';
import { WORLD_BOUND, clamp, damp } from '../config';

const push = { x: 0, z: 0 };
const BODY = 0x2d6cdf, WHITE = 0xf2f2f2, DARK = 0x1b1d21, GLASS = 0x18222c;
let bodyGeo: THREE.BufferGeometry | null = null;
let rotorGeo: THREE.BufferGeometry | null = null;
let tailGeo: THREE.BufferGeometry | null = null;

/** Flyable helicopter: W/S fly forward/back, A/D turn, Space climb, Shift descend. Lands on streets and rooftops. */
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

  constructor(readonly home: { x: number; z: number; heading: number }) {
    bodyGeo ??= mergeBoxes([
      { size: [1.7, 1.5, 2.7], pos: [0, 1.3, 0.3], color: BODY },
      { size: [1.72, 0.3, 2.72], pos: [0, 1.0, 0.3], color: WHITE },
      { size: [1.5, 1.0, 0.9], pos: [0, 1.25, 1.85], color: GLASS },
      { size: [1.3, 0.5, 0.5], pos: [0, 0.85, 2.2], color: BODY },
      { size: [1.74, 0.6, 0.9], pos: [0, 1.55, 0.6], color: GLASS }, // side windows
      { size: [1.0, 0.4, 1.5], pos: [0, 2.2, 0.1], color: WHITE }, // engine housing
      { size: [0.16, 0.36, 0.16], pos: [0, 2.55, 0.1], color: DARK }, // mast
      { size: [0.36, 0.36, 3.7], pos: [0, 1.55, -2.85], color: BODY }, // tail boom
      { size: [0.12, 1.2, 0.7], pos: [0, 2.0, -4.5], color: WHITE }, // fin
      { size: [1.3, 0.08, 0.5], pos: [0, 1.6, -4.3], color: BODY }, // stabiliser
      { size: [0.12, 0.1, 3.0], pos: [0.85, 0.05, 0.3], color: DARK }, // skids
      { size: [0.12, 0.1, 3.0], pos: [-0.85, 0.05, 0.3], color: DARK },
      { size: [0.08, 0.55, 0.08], pos: [0.85, 0.32, 1.1], color: DARK },
      { size: [0.08, 0.55, 0.08], pos: [-0.85, 0.32, 1.1], color: DARK },
      { size: [0.08, 0.55, 0.08], pos: [0.85, 0.32, -0.5], color: DARK },
      { size: [0.08, 0.55, 0.08], pos: [-0.85, 0.32, -0.5], color: DARK },
    ]);
    rotorGeo ??= mergeBoxes([
      { size: [9.6, 0.06, 0.34], pos: [0, 0, 0], color: DARK },
      { size: [0.34, 0.06, 9.6], pos: [0, 0, 0], color: DARK },
    ]);
    tailGeo ??= mergeBoxes([
      { size: [0.05, 1.5, 0.16], pos: [0, 0, 0], color: DARK },
      { size: [0.05, 0.16, 1.5], pos: [0, 0, 0], color: DARK },
    ]);
    const body = new THREE.Mesh(bodyGeo, carPaintMaterial);
    this.rotor = new THREE.Mesh(rotorGeo, carPaintMaterial);
    this.rotor.position.set(0, 2.75, 0.1);
    this.tailRotor = new THREE.Mesh(tailGeo, carPaintMaterial);
    this.tailRotor.position.set(0.16, 2.0, -4.5);
    this.group.add(body, this.rotor, this.tailRotor);
    this.group.traverse((m) => ((m as THREE.Mesh).castShadow = true));
    this.group.rotation.order = 'YXZ';
    this.reset();
  }

  reset() {
    this.pos.set(this.home.x, 0, this.home.z);
    this.vel.set(0, 0, 0);
    this.heading = this.home.heading;
    this.health = 100;
    this.spin = 0;
    this.piloted = false;
    this.destroyed = false;
    this.group.visible = true;
    this.sync();
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
    const lim = WORLD_BOUND + 220;
    this.pos.x = clamp(this.pos.x, -lim, lim);
    this.pos.z = clamp(this.pos.z, -lim, lim);
    if (this.pos.y > 230) {
      this.pos.y = 230;
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
