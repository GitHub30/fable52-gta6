import * as THREE from 'three';
import { Character } from './Character';
import { Input } from '../core/Input';
import { City } from '../world/City';
import { WORLD_BOUND, clamp, angleDiff } from '../config';
import type { Vehicle } from './Vehicle';

const WALK = 4.2, RUN = 7.6, JUMP = 6.8, GRAVITY = 21, RADIUS = 0.38;
const push = { x: 0, z: 0 };

export class Player {
  readonly char = new Character({ skin: 0xd9a47a, shirt: 0x1fb5a6, pants: 0x2c3e58, hair: 0x1c1612 });
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  heading = 0;
  onGround = true;
  health = 100;
  vehicle: Vehicle | null = null;
  dead = false;
  inHeli = false; // position is driven by the helicopter while true
  stepTimer = 0;
  onStep: () => void = () => {};
  onJump: () => void = () => {};

  get group() {
    return this.char.group;
  }

  update(dt: number, input: Input, camFwd: { x: number; z: number }, city: City, frozen: boolean) {
    if (this.inHeli) return;
    if (this.vehicle) {
      this.pos.copy(this.vehicle.pos);
      this.heading = this.vehicle.heading;
      return;
    }
    let mx = 0, mz = 0;
    if (!frozen && !this.dead) {
      const f = input.axis('KeyS', 'KeyW'), s = input.axis('KeyA', 'KeyD');
      // camera-relative: right = (-fz, fx) rotated so D moves screen-right
      mx = camFwd.x * f - camFwd.z * s;
      mz = camFwd.z * f + camFwd.x * s;
      const l = Math.hypot(mx, mz);
      if (l > 0) { mx /= l; mz /= l; }
    }
    const run = input.isDown('ShiftLeft') || input.isDown('ShiftRight');
    const top = run ? RUN : WALK;
    const accel = this.onGround ? 14 : 3;
    const k = 1 - Math.exp(-accel * dt);
    this.vel.x += (mx * top - this.vel.x) * k;
    this.vel.z += (mz * top - this.vel.z) * k;

    if (!frozen && !this.dead && this.onGround && input.wasPressed('Space')) {
      this.vel.y = JUMP;
      this.onGround = false;
      this.onJump();
    }
    this.vel.y -= GRAVITY * dt;

    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.pos.y += this.vel.y * dt;

    // static collision, then world bounds (the shoreline)
    if (city.collision.resolveCircle(this.pos, RADIUS, this.pos.y + 0.3, push)) {
      const vn = this.vel.x * push.x + this.vel.z * push.z;
      if (vn < 0) { this.vel.x -= push.x * vn; this.vel.z -= push.z * vn; }
    }
    this.pos.x = clamp(this.pos.x, -WORLD_BOUND, WORLD_BOUND);
    this.pos.z = clamp(this.pos.z, -WORLD_BOUND, WORLD_BOUND);

    const ground = city.groundHeight(this.pos.x, this.pos.z);
    if (this.pos.y <= ground) {
      this.pos.y = ground;
      this.vel.y = 0;
      this.onGround = true;
    } else if (this.pos.y > ground + 0.25) this.onGround = false;
    else if (this.vel.y <= 0) { this.pos.y = ground; this.vel.y = 0; this.onGround = true; } // step down a curb

    const sp = Math.hypot(this.vel.x, this.vel.z);
    if (sp > 0.4 && (mx !== 0 || mz !== 0)) {
      const want = Math.atan2(this.vel.x, this.vel.z);
      this.heading += angleDiff(want, this.heading) * (1 - Math.exp(-14 * dt));
    }
    if (this.onGround && sp > 1) {
      this.stepTimer -= dt * sp;
      if (this.stepTimer <= 0) { this.stepTimer = 2.4; this.onStep(); }
    }
    this.char.animate(dt, sp, !this.onGround);
    this.syncMesh();
  }

  syncMesh() {
    this.group.position.copy(this.pos);
    this.group.rotation.y = this.heading;
    this.group.visible = !this.vehicle && !this.inHeli;
  }

  get speed() {
    return Math.hypot(this.vel.x, this.vel.z);
  }
}
