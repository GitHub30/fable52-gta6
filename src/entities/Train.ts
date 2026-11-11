import * as THREE from 'three';
import type { Line } from '../world/Railway';
import { HanaAkariModel, CAR_PITCH, CAR_LEN, BOGIE } from './HanaAkari';

const CRUISE = 19; // m/s, about 70 km/h
const ACCEL = 0.9, BRAKE = 1.0;
const DWELL = 16; // seconds at the platform
const a = new THREE.Vector3(), b = new THREE.Vector3();

/**
 * A three-car train running along one line of the railway: it enters at the edge of the map,
 * calls at Tennoji, leaves at the far edge and comes round again after a pause.
 */
export class Train {
  readonly group = new THREE.Group();
  readonly model = new HanaAkariModel();
  /** Distance of the middle of the train along the line. */
  s: number;
  speed = 0;
  private wait = 0; // dwell at the platform, or time off the map before the next run
  private called = false; // already stopped at the station on this run
  private readonly span = CAR_PITCH * 3;

  constructor(readonly line: Line, startAt: number) {
    this.s = startAt;
    this.called = startAt > line.stop;
    for (const car of this.model.cars) this.group.add(car);
    this.place();
  }

  update(dt: number) {
    if (this.wait > 0) {
      this.wait -= dt;
      return;
    }
    const toStop = this.line.stop - this.s;
    if (!this.called && toStop <= 0.05) {
      this.s = this.line.stop;
      this.speed = 0;
      this.called = true;
      this.wait = DWELL;
      this.place();
      return;
    }
    // run up to line speed, but never faster than a steady brake application can stop from by the platform
    const limit = this.called ? CRUISE : Math.min(CRUISE, Math.sqrt(2 * BRAKE * toStop) + 0.35);
    this.speed = Math.min(limit, this.speed + ACCEL * dt);
    this.s += this.speed * dt;
    if (this.s - this.span / 2 > this.line.length) {
      // gone: start the next run from the other edge at line speed
      this.s = -this.span / 2;
      this.speed = CRUISE;
      this.called = false;
      this.wait = 20 + Math.random() * 25;
    }
    this.place();
  }

  private place() {
    this.model.cars.forEach((car, k) => {
      const mid = this.s + (1 - k) * CAR_PITCH;
      // each car rides on its two bogies, so it follows curves and gradients as a chord
      this.line.at(mid + BOGIE, a);
      this.line.at(mid - BOGIE, b);
      car.position.copy(a).add(b).multiplyScalar(0.5);
      const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
      car.rotation.order = 'YXZ';
      car.rotation.set(-Math.atan2(dy, Math.hypot(dx, dz)), Math.atan2(dx, dz), 0);
      if (car.userData.reversed) {
        car.rotation.y += Math.PI;
        car.rotation.x *= -1;
      }
      car.visible = mid > -CAR_LEN && mid < this.line.length + CAR_LEN;
    });
  }

  /** True if (x, y, z) is inside a car, with `margin` to spare: for running people down. */
  hits(p: THREE.Vector3, margin = 0.3) {
    for (const car of this.model.cars) {
      if (!car.visible) continue;
      const dx = p.x - car.position.x, dz = p.z - car.position.z, h = car.rotation.y;
      const along = dx * Math.sin(h) + dz * Math.cos(h), across = dx * Math.cos(h) - dz * Math.sin(h);
      if (Math.abs(along) < CAR_LEN / 2 + margin && Math.abs(across) < 1.45 + margin && p.y - car.position.y > -1 && p.y - car.position.y < 3.8) return true;
    }
    return false;
  }
}
