import * as THREE from 'three';
import type { Game } from '../Game';
import { Character, randomOutfit } from '../entities/Character';
import type { Edge } from '../world/WorldData';
import { angleDiff, rand } from '../config';

export interface Ped {
  char: Character;
  pos: THREE.Vector3;
  heading: number;
  edge: Edge; // road or path being walked
  i: number; // index of the point being walked towards
  dir: 1 | -1;
  side: 1 | -1; // which side of the road
  lat: number; // -1..1 position across pedestrian streets
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

const PED_COUNT = 46;
const c = { x: 0, z: 0 };

/** Pedestrians on the real street network: they walk beside roads and along paths, flee from danger, get knocked down. */
export class Pedestrians {
  readonly list: Ped[] = [];
  private tick = 0;

  constructor(private game: Game) {
    for (let k = 0; k < PED_COUNT; k++) {
      const ped: Ped = {
        char: new Character(randomOutfit()),
        pos: new THREE.Vector3(),
        heading: 0, edge: game.city.data.edges[0], i: 1, dir: 1, side: Math.random() < 0.5 ? 1 : -1, lat: rand(-1, 1), tx: 0, tz: 0,
        pace: rand(1.2, 1.9), state: 'walk', t: 0, health: 100, vx: 0, vz: 0, brave: Math.random() < 0.3, atkT: 0,
      };
      this.list.push(ped);
      game.scene.add(ped.char.group);
      this.respawn(ped, 10, 170);
    }
  }

  /** Sideways distance from the road centre line for this pedestrian (positive = left of a -> b). */
  private offset(p: Ped) {
    const e = p.edge;
    if (e.k >= 5) return p.lat * e.w * 0.35; // pedestrian streets and paths: anywhere across
    return p.side * (e.k <= 2 ? e.w / 2 + 1.3 : Math.max(0.4, e.w / 2 - 0.7)); // beside the carriageway
  }

  private setTarget(p: Ped) {
    const q = p.edge.pts, n = q.length / 2;
    const i = Math.max(0, Math.min(n - 1, p.i));
    const i0 = Math.max(0, i - 1), i1 = Math.min(n - 1, i + 1);
    const dx = q[i1 * 2] - q[i0 * 2], dz = q[i1 * 2 + 1] - q[i0 * 2 + 1], l = Math.hypot(dx, dz) || 1;
    let off = this.offset(p);
    let x = q[i * 2] + (dz / l) * off, z = q[i * 2 + 1] - (dx / l) * off;
    if (this.game.city.collision.pointBlocked(x, 0, z, 0.3)) {
      // a building hugs the road here: walk at the kerb instead
      off = Math.sign(off) * Math.max(0.3, p.edge.w / 2 - 0.6);
      x = q[i * 2] + (dz / l) * off;
      z = q[i * 2 + 1] - (dx / l) * off;
    }
    p.tx = x + rand(-0.3, 0.3);
    p.tz = z + rand(-0.3, 0.3);
  }

  /** Put a pedestrian onto the road nearest to (x,z). */
  private attach(p: Ped, x: number, z: number, snap: boolean) {
    const h = this.game.city.nearestRoad(x, z, () => true, 120);
    if (!h) return false;
    p.edge = h.edge;
    p.dir = Math.random() < 0.5 ? 1 : -1;
    p.i = p.dir > 0 ? h.seg + 1 : h.seg;
    if (snap) {
      const off = this.offset(p);
      p.pos.set(h.x + h.dz * off, 0, h.z - h.dx * off);
    }
    this.setTarget(p);
    return true;
  }

  respawn(p: Ped, minD: number, maxD: number) {
    const pl = this.game.player.pos;
    for (let tries = 0; tries < 12; tries++) {
      p.side = Math.random() < 0.5 ? 1 : -1;
      p.lat = rand(-1, 1);
      if (!this.attach(p, pl.x + rand(-maxD, maxD), pl.z + rand(-maxD, maxD), true)) continue;
      const d = Math.max(Math.abs(p.pos.x - pl.x), Math.abs(p.pos.z - pl.z));
      if (d < minD || d > maxD) continue;
      p.state = 'walk';
      p.health = 100;
      p.vx = p.vz = 0;
      p.char.setDown(false);
      p.heading = Math.atan2(p.tx - p.pos.x, p.tz - p.pos.z);
      return;
    }
  }

  /** Spawn-in-place helper for ejected drivers: they run off along the nearest street. */
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
    this.attach(p, x, z, false);
    p.health = 100;
    p.state = 'walk';
    p.char.setDown(false);
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
    p.char.setDown(true);
  }

  private nextTarget(p: Ped) {
    p.i += p.dir;
    const n = p.edge.pts.length / 2;
    if (p.i < 0 || p.i >= n) {
      // reached the end of this street: take another one from the junction (or turn back at a dead end)
      const d = this.game.city.data, node = p.dir > 0 ? p.edge.b : p.edge.a;
      const opts = d.adj[node].filter((id) => id !== p.edge.id);
      if (opts.length) {
        const e = d.edges[opts[Math.floor(Math.random() * opts.length)]];
        p.edge = e;
        p.dir = e.a === node ? 1 : -1;
        p.i = p.dir > 0 ? 1 : e.pts.length / 2 - 2;
        if (Math.random() < 0.3) p.side = -p.side as 1 | -1;
      } else {
        p.dir = -p.dir as 1 | -1;
        p.i = Math.max(0, Math.min(n - 1, p.i + p.dir * 2));
      }
    }
    this.setTarget(p);
    if (p.state === 'walk' && Math.random() < 0.08) {
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
        grp.position.set(p.pos.x, g.city.roadHeight(p.pos.x, p.pos.z), p.pos.z);
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

      grp.position.set(p.pos.x, g.city.roadHeight(p.pos.x, p.pos.z), p.pos.z);
      grp.rotation.y = p.heading;
      p.char.lod(g.camera.position.distanceTo(grp.position));
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
