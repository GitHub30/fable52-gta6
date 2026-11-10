import * as THREE from 'three';
import type { Game } from '../Game';
import { Character, randomOutfit } from '../entities/Character';
import { N, blockIndex, angleDiff, rand } from '../config';

export interface Ped {
  char: Character;
  pos: THREE.Vector3;
  heading: number;
  bi: number;
  bj: number;
  corner: number;
  dir: 1 | -1;
  tx: number;
  tz: number;
  pace: number;
  state: 'walk' | 'idle' | 'flee' | 'down' | 'fight';
  brave: boolean;
  atkT: number;
  t: number;
  health: number;
  vx: number;
  vz: number;
}

const PED_COUNT = 42;
const c = { x: 0, z: 0 };
// crossing table: [corner][0 = across X, 1 = across Z] -> [di, dj, new corner]
const CROSS: [number, number, number][][] = [
  [[-1, 0, 1], [0, -1, 3]],
  [[1, 0, 0], [0, -1, 2]],
  [[1, 0, 3], [0, 1, 1]],
  [[-1, 0, 2], [0, 1, 0]],
];

/** Sidewalk pedestrians: stroll around blocks, cross streets, flee from danger, get knocked down. */
export class Pedestrians {
  readonly list: Ped[] = [];
  private tick = 0;

  constructor(private game: Game) {
    for (let k = 0; k < PED_COUNT; k++) {
      const ped: Ped = {
        char: new Character(randomOutfit()),
        pos: new THREE.Vector3(),
        heading: 0, bi: 0, bj: 0, corner: 0, dir: 1, tx: 0, tz: 0,
        pace: rand(1.2, 1.9), state: 'walk', t: 0, health: 100, vx: 0, vz: 0, brave: Math.random() < 0.3, atkT: 0,
      };
      this.list.push(ped);
      game.scene.add(ped.char.group);
      this.respawn(ped, 10, 170);
    }
  }

  private setTarget(p: Ped) {
    const t = this.game.city.blockCorner(p.bi, p.bj, p.corner);
    // small offset so pedestrians do not walk in single file
    p.tx = t.x + rand(-0.9, 0.9);
    p.tz = t.z + rand(-0.9, 0.9);
  }

  respawn(p: Ped, minD: number, maxD: number) {
    const pl = this.game.player.pos;
    for (let tries = 0; tries < 12; tries++) {
      const x = pl.x + rand(-maxD, maxD), z = pl.z + rand(-maxD, maxD);
      p.bi = blockIndex(x);
      p.bj = blockIndex(z);
      p.corner = Math.floor(Math.random() * 4);
      const a = this.game.city.blockCorner(p.bi, p.bj, p.corner);
      const d = Math.max(Math.abs(a.x - pl.x), Math.abs(a.z - pl.z));
      if (d < minD || d > maxD) continue;
      p.dir = Math.random() < 0.5 ? 1 : -1;
      const next = (p.corner + p.dir + 4) % 4;
      const b = this.game.city.blockCorner(p.bi, p.bj, next);
      const f = Math.random();
      p.pos.set(a.x + (b.x - a.x) * f, 0.15, a.z + (b.z - a.z) * f);
      p.corner = next;
      this.setTarget(p);
      p.state = 'walk';
      p.health = 100;
      p.vx = p.vz = 0;
      p.char.group.rotation.x = 0;
      p.heading = Math.atan2(p.tx - p.pos.x, p.tz - p.pos.z);
      return;
    }
  }

  /** Spawn-in-place helper for ejected drivers: they run for the nearest sidewalk. */
  eject(x: number, z: number) {
    let best: Ped | null = null, bd = 0;
    const pl = this.game.player.pos;
    for (const p of this.list) {
      const d = (p.pos.x - pl.x) ** 2 + (p.pos.z - pl.z) ** 2;
      if (d > bd) { bd = d; best = p; }
    }
    if (!best) return;
    const p = best;
    p.pos.set(x, 0, z);
    p.bi = blockIndex(x);
    p.bj = blockIndex(z);
    let near = 0, nd = Infinity;
    for (let k = 0; k < 4; k++) {
      const a = this.game.city.blockCorner(p.bi, p.bj, k);
      const d = (a.x - x) ** 2 + (a.z - z) ** 2;
      if (d < nd) { nd = d; near = k; }
    }
    p.corner = near;
    this.setTarget(p);
    p.health = 100;
    p.char.group.rotation.x = 0;
    this.scare(p, 10);
  }

  scare(p: Ped, seconds: number) {
    if (p.state === 'down') return;
    p.state = 'flee';
    p.t = seconds;
  }
  /** Everyone within `radius` of a crime runs. */
  scareAround(x: number, z: number, radius: number) {
    for (const p of this.list) if ((p.pos.x - x) ** 2 + (p.pos.z - z) ** 2 < radius * radius) this.scare(p, rand(5, 9));
  }

  knockDown(p: Ped, vx: number, vz: number) {
    p.state = 'down';
    p.t = 14;
    p.brave = Math.random() < 0.3;
    p.health = 0;
    p.vx = vx;
    p.vz = vz;
    p.char.group.rotation.x = -Math.PI / 2;
  }

  private nextTarget(p: Ped) {
    // sometimes cross the street to a neighbouring block, otherwise keep circling
    if (Math.random() < 0.4) {
      const opt = CROSS[p.corner][Math.random() < 0.5 ? 0 : 1];
      const ni = p.bi + opt[0], nj = p.bj + opt[1];
      if (ni >= 0 && ni < N && nj >= 0 && nj < N) {
        p.bi = ni;
        p.bj = nj;
        p.corner = opt[2];
        this.setTarget(p);
        return;
      }
    }
    if (Math.random() < 0.1) p.dir = -p.dir as 1 | -1;
    p.corner = (p.corner + p.dir + 4) % 4;
    this.setTarget(p);
    if (p.state === 'walk' && Math.random() < 0.18) {
      p.state = 'idle';
      p.t = rand(2, 6);
    }
  }

  update(dt: number) {
    const g = this.game, pl = g.player;
    const car = pl.vehicle;
    const carFast = car ? Math.abs(car.speed) > 9 : false;
    const doRespawn = (this.tick -= dt) <= 0;
    if (doRespawn) this.tick = 0.5;

    for (const p of this.list) {
      const dxp = p.pos.x - pl.pos.x, dzp = p.pos.z - pl.pos.z;
      const far = Math.max(Math.abs(dxp), Math.abs(dzp));
      if (doRespawn && far > 210) this.respawn(p, 70, 190);
      const grp = p.char.group;
      grp.visible = far < 190;
      if (far > 230) continue;

      if (p.state === 'down') {
        p.pos.x += p.vx * dt;
        p.pos.z += p.vz * dt;
        const k = Math.exp(-4 * dt);
        p.vx *= k;
        p.vz *= k;
        if ((p.t -= dt) <= 0) this.respawn(p, 80, 190);
        grp.position.set(p.pos.x, g.city.groundHeight(p.pos.x, p.pos.z) + 0.18, p.pos.z);
        continue;
      }

      // a fast car bearing down on them is scary
      if (carFast && far < 11 && p.state !== 'flee') this.scare(p, 5);

      let speed = 0;
      if (p.state === 'fight') {
        // brave pedestrians chase the player and throw punches for a while
        const d = Math.hypot(dxp, dzp);
        if ((p.t -= dt) <= 0 || car || d > 25 || pl.dead) p.state = 'walk';
        else {
          p.heading += angleDiff(Math.atan2(-dxp, -dzp), p.heading) * (1 - Math.exp(-12 * dt));
          if (d > 1.15) {
            speed = 4.6;
            p.pos.x += Math.sin(p.heading) * speed * dt;
            p.pos.z += Math.cos(p.heading) * speed * dt;
          } else if ((p.atkT -= dt) <= 0) {
            p.atkT = 0.9;
            p.char.punchT = 0.3;
            g.damagePlayer(6);
            g.audio.punch();
          }
        }
      } else if (p.state === 'idle') {
        if ((p.t -= dt) <= 0) p.state = 'walk';
      } else {
        if (p.state === 'flee' && (p.t -= dt) <= 0) p.state = 'walk';
        speed = p.state === 'flee' ? 5.4 : p.pace;
        const tx = p.tx - p.pos.x, tz = p.tz - p.pos.z;
        const d = Math.hypot(tx, tz);
        if (d < 0.5) this.nextTarget(p);
        else {
          const want = Math.atan2(tx, tz);
          p.heading += angleDiff(want, p.heading) * (1 - Math.exp(-10 * dt));
          p.pos.x += Math.sin(p.heading) * speed * dt;
          p.pos.z += Math.cos(p.heading) * speed * dt;
        }
      }

      // vehicles: fast ones knock pedestrians down, slow ones shove them aside
      for (const v of g.vehicles) {
        const vdx = p.pos.x - v.pos.x, vdz = p.pos.z - v.pos.z;
        if (vdx * vdx + vdz * vdz > 14) continue;
        for (let i = 0; i < 2; i++) {
          v.circle(i, c);
          let nx = p.pos.x - c.x, nz = p.pos.z - c.z;
          const r = v.radius + 0.3, d2 = nx * nx + nz * nz;
          if (d2 >= r * r || d2 < 1e-6) continue;
          const d = Math.sqrt(d2);
          nx /= d;
          nz /= d;
          p.pos.x += nx * (r - d);
          p.pos.z += nz * (r - d);
          const closing = v.vx * nx + v.vz * nz;
          if (closing > 3.5) {
            this.knockDown(p, v.vx * 0.8 + nx * 3, v.vz * 0.8 + nz * 3);
            g.onPedRunOver(p, v, closing);
          }
          break;
        }
        if ((p.state as string) === 'down') break;
      }
      if ((p.state as string) === 'down') continue;

      // the player on foot is solid too
      if (!car && far < 1) {
        const d = Math.hypot(dxp, dzp);
        if (d < 0.7 && d > 1e-4) {
          p.pos.x += (dxp / d) * (0.7 - d);
          p.pos.z += (dzp / d) * (0.7 - d);
        }
      }

      grp.position.set(p.pos.x, g.city.groundHeight(p.pos.x, p.pos.z), p.pos.z);
      grp.rotation.y = p.heading;
      if (far < 90) p.char.animate(dt, speed);
    }
  }

  /** A punched pedestrian with some nerve turns on the player. */
  provoke(p: Ped) {
    if (p.state === 'down' || !p.brave) return false;
    p.state = 'fight';
    p.t = 12;
    p.atkT = 0.5;
    return true;
  }

  /** Nearest standing pedestrian in front of a point (used for punches). */
  findInFront(x: number, z: number, heading: number, reach: number) {
    const fx = Math.sin(heading), fz = Math.cos(heading);
    let best: Ped | null = null, bd = reach;
    for (const p of this.list) {
      if (p.state === 'down') continue;
      const dx = p.pos.x - x, dz = p.pos.z - z;
      const d = Math.hypot(dx, dz);
      if (d < bd && dx * fx + dz * fz > d * 0.3) { bd = d; best = p; }
    }
    return best;
  }
}
