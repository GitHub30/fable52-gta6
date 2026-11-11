import * as THREE from 'three';
import type { Game } from '../Game';
import { Character } from '../entities/Character';
import { angleDiff, rand } from '../config';

export interface Officer {
  char: Character;
  pos: THREE.Vector3;
  heading: number;
  health: number;
  down: boolean;
  t: number; // time lying down / time since the heat ended
  shootT: number;
  arrestT: number;
  vx: number;
  vz: number;
}

const MAX_OFFICERS = 6;
const push = { x: 0, z: 0 };
const c = { x: 0, z: 0 };

/** Police on foot: they leave stopped patrol cars, chase, arrest at close range and open fire from ★3. */
export class Officers {
  readonly list: Officer[] = [];
  private deployT = 0;

  constructor(private game: Game) {}

  private deploy(x: number, z: number, heading: number) {
    const o: Officer = {
      char: new Character({ skin: 0xd9a47a, shirt: 0x1d2b4f, pants: 0x14192b, hair: 0x0c1020 }),
      pos: new THREE.Vector3(x, 0, z),
      heading, health: 100, down: false, t: 0, shootT: rand(0.6, 1.2), arrestT: 0, vx: 0, vz: 0,
    };
    this.list.push(o);
    this.game.scene.add(o.char.group);
  }
  private remove(o: Officer) {
    this.game.scene.remove(o.char.group);
    const k = this.list.indexOf(o);
    if (k >= 0) this.list.splice(k, 1);
  }

  /** Distance to the closest officer still on their feet. */
  nearest() {
    const p = this.game.player.pos;
    let best = Infinity;
    for (const o of this.list) if (!o.down) best = Math.min(best, Math.hypot(o.pos.x - p.x, o.pos.z - p.z));
    return best;
  }

  findInFront(x: number, z: number, heading: number, reach: number) {
    const fx = Math.sin(heading), fz = Math.cos(heading);
    let best: Officer | null = null, bd = reach;
    for (const o of this.list) {
      if (o.down) continue;
      const dx = o.pos.x - x, dz = o.pos.z - z, d = Math.hypot(dx, dz);
      if (d < bd && dx * fx + dz * fz > d * 0.3) { bd = d; best = o; }
    }
    return best;
  }

  /** Apply damage; returns true if the officer went down. */
  hurt(o: Officer, amount: number, nx: number, nz: number) {
    if (o.down) return false;
    o.health -= amount;
    o.pos.x += nx * 0.4;
    o.pos.z += nz * 0.4;
    if (o.health > 0) return false;
    this.knockDown(o, nx * 4, nz * 4);
    return true;
  }
  private knockDown(o: Officer, vx: number, vz: number) {
    o.down = true;
    o.t = 12;
    o.vx = vx;
    o.vz = vz;
    o.char.group.rotation.x = -Math.PI / 2;
  }

  update(dt: number) {
    const g = this.game, pl = g.player, level = g.wanted.level;
    const playerSpeed = pl.vehicle ? Math.abs(pl.vehicle.speed) : pl.speed;

    // officers step out of patrol cars that have pulled up next to the suspect
    if ((this.deployT -= dt) <= 0) {
      this.deployT = 0.5;
      if (level >= 2 && playerSpeed < 6 && !pl.dead)
        for (const v of g.traffic.police) {
          if (this.list.length >= MAX_OFFICERS) break;
          if (v.driver !== 'police' || v.kind === 'mcv' || Math.abs(v.speed) > 2) continue; // the 16式 crew stays buttoned up
          if (Math.hypot(v.pos.x - pl.pos.x, v.pos.z - pl.pos.z) > 18) continue;
          v.driver = 'none'; // the empty car stays where it stopped (and can be stolen)
          v.throttle = 0;
          // the officer climbs out of the driver's door, which swings shut behind them
          const door = v.driverDoor, lx = Math.cos(v.heading) * door.side, lz = -Math.sin(v.heading) * door.side;
          this.deploy(v.pos.x + lx * 1.9 + Math.sin(v.heading) * door.z, v.pos.z + lz * 1.9 + Math.cos(v.heading) * door.z, v.heading);
          v.setDoors('driver', true, 1.4);
        }
    }

    for (let k = this.list.length - 1; k >= 0; k--) {
      const o = this.list[k];
      const grp = o.char.group;
      const dx = pl.pos.x - o.pos.x, dz = pl.pos.z - o.pos.z;
      const d = Math.hypot(dx, dz);

      if (o.down) {
        o.pos.x += o.vx * dt;
        o.pos.z += o.vz * dt;
        const f = Math.exp(-4 * dt);
        o.vx *= f;
        o.vz *= f;
        if ((o.t -= dt) <= 0) { this.remove(o); continue; }
        grp.position.set(o.pos.x, g.city.groundHeight(o.pos.x, o.pos.z) + 0.18, o.pos.z);
        continue;
      }
      if (d > 120) { this.remove(o); continue; }

      let speed = 0;
      if (level === 0 || pl.dead) {
        // heat is off: stand around briefly, then leave
        o.t += dt;
        if (o.t > 6 || d > 60) { this.remove(o); continue; }
      } else {
        o.t = 0;
        const want = Math.atan2(dx, dz);
        o.heading += angleDiff(want, o.heading) * (1 - Math.exp(-10 * dt));
        const sight = d < 26 && g.traffic.lineOfSight(o.pos.x, o.pos.z, pl.pos.x, pl.pos.z);
        if (level >= 3 && sight && d < 20 && d > 2.2 && pl.pos.y < 25) {
          // hold position and fire
          if ((o.shootT -= dt) <= 0) {
            o.shootT = rand(1.0, 1.7);
            const chance = pl.vehicle ? 0.5 : pl.speed > 5 ? 0.25 : 0.5;
            const hit = Math.random() < chance;
            const miss = hit ? 0 : rand(0.8, 2) * (Math.random() < 0.5 ? -1 : 1);
            g.effects.tracer(o.pos.x, g.city.groundHeight(o.pos.x, o.pos.z) + 1.4, o.pos.z, pl.pos.x + (dz / d) * miss, pl.pos.y + 1.1, pl.pos.z - (dx / d) * miss);
            g.audio.shot(d);
            if (hit) {
              if (pl.vehicle) pl.vehicle.health = Math.max(0, pl.vehicle.health - 5);
              else if (g.heli) g.heli.health = Math.max(0, g.heli.health - 4);
              else g.damagePlayer(9);
            }
          }
        } else if (d > 1.2) {
          speed = 5.2;
          o.pos.x += Math.sin(o.heading) * speed * dt;
          o.pos.z += Math.cos(o.heading) * speed * dt;
          g.city.collision.resolveCircle(o.pos, 0.38, 0.3, push);
        }
        // arrest at arm's length
        if (d < 1.8 && !pl.vehicle && !pl.inHeli && pl.speed < 2.5) {
          o.arrestT += dt;
          if (o.arrestT > 1.3) { o.arrestT = 0; g.busted(); }
        } else o.arrestT = Math.max(0, o.arrestT - dt);
      }

      // run over by a car
      for (const v of g.vehicles) {
        const vdx = o.pos.x - v.pos.x, vdz = o.pos.z - v.pos.z;
        if (vdx * vdx + vdz * vdz > 14) continue;
        for (let i = 0; i < 2 && !o.down; i++) {
          v.circle(i, c);
          let nx = o.pos.x - c.x, nz = o.pos.z - c.z;
          const r = v.radius + 0.3, d2 = nx * nx + nz * nz;
          if (d2 >= r * r || d2 < 1e-6) continue;
          const dd = Math.sqrt(d2);
          nx /= dd;
          nz /= dd;
          o.pos.x += nx * (r - dd);
          o.pos.z += nz * (r - dd);
          const closing = v.vx * nx + v.vz * nz;
          if (closing > 4) {
            this.knockDown(o, v.vx * 0.8 + nx * 3, v.vz * 0.8 + nz * 3);
            if (v.driver === 'player') g.onOfficerDown('警官をはねた');
          }
        }
      }
      if (o.down) continue;

      grp.position.set(o.pos.x, g.city.groundHeight(o.pos.x, o.pos.z), o.pos.z);
      grp.rotation.y = o.heading;
      o.char.animate(dt, speed);
    }
  }
}
