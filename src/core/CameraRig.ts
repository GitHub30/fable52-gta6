import * as THREE from 'three';
import { Input } from './Input';
import { CollisionWorld } from '../world/Collision';
import { clamp, damp, angleDiff } from '../config';

/** Third-person orbit camera with wall avoidance and auto-follow behind vehicles. */
export class CameraRig {
  yaw = Math.PI;
  pitch = 0.28;
  private dist = 5;
  private idle = 0;
  private focus = new THREE.Vector3();
  private initialised = false;
  shake = 0;
  /** Terrain height lookup so the camera never dips below the ground. */
  groundAt: (x: number, z: number) => number = () => 0;

  constructor(readonly camera: THREE.PerspectiveCamera) {}

  /** Direction the camera looks along on the ground plane (unit x,z). */
  forward(out: { x: number; z: number }) {
    out.x = -Math.sin(this.yaw);
    out.z = -Math.cos(this.yaw);
    return out;
  }

  update(dt: number, input: Input, target: THREE.Vector3, vehicleHeading: number | null, speed: number, world: CollisionWorld) {
    const sens = 0.0024;
    if (input.mouseDX !== 0 || input.mouseDY !== 0) this.idle = 0;
    else this.idle += dt;
    this.yaw -= input.mouseDX * sens;
    this.pitch = clamp(this.pitch + input.mouseDY * sens, -0.25, 1.25);

    const driving = vehicleHeading !== null;
    if (driving && this.idle > 1.2 && Math.abs(speed) > 1.5) {
      // settle behind the car (or in front of the bonnet when reversing)
      const want = vehicleHeading! + Math.PI + (speed < -1.5 ? Math.PI : 0);
      this.yaw += angleDiff(want, this.yaw) * (1 - Math.exp(-2.6 * dt));
      this.pitch = damp(this.pitch, 0.24, 1.5, dt);
    }
    const wantDist = driving ? 8.5 + Math.min(4, Math.abs(speed) * 0.09) : 4.6;
    this.dist = damp(this.dist, wantDist, 4, dt);

    const head = driving ? 1.5 : 1.55;
    if (!this.initialised) {
      this.focus.set(target.x, target.y + head, target.z);
      this.initialised = true;
    }
    this.focus.x = damp(this.focus.x, target.x, 18, dt);
    this.focus.z = damp(this.focus.z, target.z, 18, dt);
    this.focus.y = damp(this.focus.y, target.y + head, 10, dt);

    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const dx = Math.sin(this.yaw) * cp, dy = sp, dz = Math.cos(this.yaw) * cp;
    // march outwards; stop before the first blocked sample so walls never hide the player
    let d = this.dist;
    const steps = 10;
    for (let i = 1; i <= steps; i++) {
      const t = (this.dist * i) / steps;
      if (world.pointBlocked(this.focus.x + dx * t, this.focus.y + dy * t, this.focus.z + dz * t, 0.35)) {
        d = Math.max(0.6, (this.dist * (i - 1)) / steps);
        break;
      }
    }
    const cam = this.camera;
    const camX = this.focus.x + dx * d, camZ = this.focus.z + dz * d;
    cam.position.set(camX, Math.max(this.groundAt(camX, camZ) + 0.4, this.focus.y + dy * d), camZ);
    if (this.shake > 0.001) {
      cam.position.x += (Math.random() - 0.5) * this.shake;
      cam.position.y += (Math.random() - 0.5) * this.shake;
      this.shake *= Math.exp(-6 * dt);
    }
    cam.lookAt(this.focus);
    const fov = 62 + Math.min(14, Math.abs(speed) * 0.35) * (driving ? 1 : 0.4);
    if (Math.abs(cam.fov - fov) > 0.05) {
      cam.fov = damp(cam.fov, fov, 3, dt);
      cam.updateProjectionMatrix();
    }
  }

  snap(target: THREE.Vector3, yaw: number) {
    this.yaw = yaw;
    this.initialised = false;
    this.focus.copy(target);
  }
}
