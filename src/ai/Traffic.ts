import * as THREE from 'three';
import type { Game } from '../Game';
import { Vehicle, VehicleKind } from '../entities/Vehicle';
import type { Edge } from '../world/WorldData';
import { clamp, angleDiff, rand } from '../config';

/** Per-vehicle route state: following a lane polyline towards the node at its end. */
interface Route {
  edge: Edge;
  dir: 1 | -1;
  path: Float32Array; // lane points (x,z)
  i: number; // index of the point being driven towards
  cruise: number;
  blockedT: number;
  ignoreT: number;
  panicT: number;
  stuckT: number;
  reverseT: number;
  direct: boolean; // police: steering straight at the player
  honkT: number;
  deadEnd: boolean;
}

const AI_COUNT = 36;
const CRUISE = [13, 11, 9.5, 7, 6, 5, 5];

/** Ambient traffic on the real road graph (left-hand traffic) and police pursuit driving. */
export class Traffic {
  private respawnTick = 0;
  time = 0;
  readonly police: Vehicle[] = [];

  constructor(private game: Game) {
    for (let k = 0; k < AI_COUNT; k++) this.spawnTraffic(true);
  }

  // ------------------------------------------------------------------ routes
  private newRoute(): Route {
    const e = this.game.city.aiEdges[0];
    return { edge: e, dir: 1, path: this.game.city.lane(e, 1), i: 1, cruise: 10, blockedT: 0, ignoreT: 0, panicT: 0, stuckT: 0, reverseT: 0, direct: false, honkT: 0, deadEnd: false };
  }
  private setEdge(r: Route, e: Edge, dir: 1 | -1, i = 0) {
    r.edge = e;
    r.dir = dir;
    r.path = this.game.city.lane(e, dir);
    r.i = i;
    r.cruise = CRUISE[e.k] * rand(0.9, 1.1);
    r.deadEnd = false;
  }
  private endNode(r: Route) {
    return r.dir > 0 ? r.edge.b : r.edge.a;
  }

  /** Pick the next edge at the end of the current one. */
  private advance(r: Route, chase: { x: number; z: number } | null, heading: number) {
    const d = this.game.city.data, node = this.endNode(r);
    let best: Edge | null = null, bestDir: 1 | -1 = 1, bestScore = Infinity;
    for (const id of d.adj[node]) {
      const e = d.edges[id];
      if (e === r.edge || !(chase ? e.car : e.ai)) continue;
      const dir: 1 | -1 | 0 = e.a === node ? 1 : e.oneway ? 0 : -1;
      if (!dir) continue;
      const far = dir > 0 ? e.b : e.a;
      let score: number;
      if (chase) score = Math.hypot(d.nodes[far * 2] - chase.x, d.nodes[far * 2 + 1] - chase.z);
      else {
        // prefer carrying straight on, with some randomness so traffic spreads out
        const p = this.game.city.lane(e, dir);
        const turn = Math.abs(angleDiff(Math.atan2(p[2] - p[0], p[3] - p[1]), heading));
        score = turn + Math.random() * 1.6 + (far === node ? 9 : 0);
      }
      if (score < bestScore) { bestScore = score; best = e; bestDir = dir; }
    }
    if (best) return this.setEdge(r, best, bestDir);
    // dead end (usually the map edge): police turn round, traffic gets recycled
    if (!r.edge.oneway) this.setEdge(r, r.edge, -r.dir as 1 | -1);
    else r.i = r.path.length / 2 - 1;
    r.deadEnd = true;
  }

  private spotFree(x: number, z: number, radius = 9) {
    for (const v of this.game.vehicles) if ((v.pos.x - x) ** 2 + (v.pos.z - z) ** 2 < radius * radius) return false;
    return true;
  }

  /** Find a lane position between minD and maxD from the player. */
  private pickSpawn(minD: number, maxD: number, r: Route) {
    const p = this.game.player.pos, edges = this.game.city.aiEdges;
    for (let tries = 0; tries < 30; tries++) {
      const e = edges[Math.floor(Math.random() * edges.length)];
      const dir: 1 | -1 = e.oneway || Math.random() < 0.5 ? 1 : -1;
      const path = this.game.city.lane(e, dir), n = path.length / 2;
      const i = 1 + Math.floor(Math.random() * (n - 1)), f = Math.random();
      const x = path[i * 2 - 2] + (path[i * 2] - path[i * 2 - 2]) * f, z = path[i * 2 - 1] + (path[i * 2 + 1] - path[i * 2 - 1]) * f;
      const d = Math.max(Math.abs(x - p.x), Math.abs(z - p.z));
      if (d < minD || d > maxD || !this.spotFree(x, z)) continue;
      this.setEdge(r, e, dir, i);
      return { x, z, heading: Math.atan2(path[i * 2] - path[i * 2 - 2], path[i * 2 + 1] - path[i * 2 - 1]) };
    }
    return null;
  }

  private spawnTraffic(initial: boolean, reuse?: Vehicle) {
    const r: Route = reuse?.ai ?? this.newRoute();
    const s = this.pickSpawn(initial ? 25 : 110, initial ? 420 : 300, r);
    if (!s) return;
    const kinds: VehicleKind[] = ['prius', 'prius', 'prius', 'prius', 'alphard', 'alphard', 'alphard', 'taxi', 'taxi', 'ambulance', 'firetruck'];
    const v = reuse ?? this.game.addVehicle(kinds[Math.floor(Math.random() * kinds.length)], s.x, s.z, s.heading);
    v.place(s.x, s.z, s.heading);
    v.settle(this.game.city);
    v.ai = r;
    v.driver = 'ai';
    v.health = 100;
    r.panicT = r.blockedT = r.ignoreT = 0;
    const sp = r.cruise * 0.7;
    v.vx = Math.sin(s.heading) * sp;
    v.vz = Math.cos(s.heading) * sp;
  }

  // ------------------------------------------------------------------ police
  spawnPolice() {
    const r = this.newRoute();
    const s = this.pickSpawn(90, 220, r);
    if (!s) return null;
    const v = this.game.addVehicle('police', s.x, s.z, s.heading);
    v.ai = r;
    v.driver = 'police';
    this.police.push(v);
    return v;
  }
  /** Cops give up: they turn into ordinary traffic and get removed once far away. */
  standDown() {
    for (const v of this.police) {
      if (v.driver !== 'police') continue;
      v.driver = 'ai';
      (v.ai as Route).direct = false;
      this.reanchor(v, null);
    }
  }
  /** Rejoin the road network from wherever the car is. */
  private reanchor(v: Vehicle, chase: { x: number; z: number } | null) {
    const r = v.ai as Route, city = this.game.city;
    const h = city.nearestRoad(v.pos.x, v.pos.z, (e) => e.ai, 300);
    if (!h) return;
    const e = h.edge;
    // face whichever way is closer to the current heading (or to the suspect)
    const along = Math.sin(v.heading) * h.dx + Math.cos(v.heading) * h.dz;
    let dir: 1 | -1 = e.oneway || along >= 0 ? 1 : -1;
    if (chase && !e.oneway) {
      const d = city.data.nodes;
      dir = Math.hypot(d[e.b * 2] - chase.x, d[e.b * 2 + 1] - chase.z) < Math.hypot(d[e.a * 2] - chase.x, d[e.a * 2 + 1] - chase.z) ? 1 : -1;
    }
    const n = e.pts.length / 2;
    this.setEdge(r, e, dir, clamp(dir > 0 ? h.seg + 1 : n - 1 - h.seg, 1, n - 1));
  }
  lineOfSight(ax: number, az: number, bx: number, bz: number) {
    const city = this.game.city, w = city.collision;
    for (let k = 1; k < 10; k++) {
      const t = k / 10, x = ax + (bx - ax) * t, z = az + (bz - az) * t;
      if (w.pointBlocked(x, city.groundHeight(x, z) + 1, z, 1.2)) return false;
    }
    return true;
  }

  // ------------------------------------------------------------------ update
  update(dt: number) {
    const g = this.game, p = g.player;
    this.time += dt;
    let aiCount = 0;
    for (const v of g.vehicles) {
      if (v.driver === 'ai') {
        aiCount++;
        this.drive(v, dt, null);
      } else if (v.driver === 'police') this.drive(v, dt, p.pos);
    }

    if ((this.respawnTick -= dt) <= 0) {
      this.respawnTick = 0.4;
      // far-away traffic is recycled near the player; abandoned traffic cars are reused first
      let recycled = 0;
      for (let k = g.vehicles.length - 1; k >= 0; k--) {
        const v = g.vehicles[k];
        if (!v.ai || v === p.vehicle) continue;
        const far = Math.max(Math.abs(v.pos.x - p.pos.x), Math.abs(v.pos.z - p.pos.z));
        if (v.kind === 'police') {
          if (v.driver !== 'police' && far > 230) {
            g.removeVehicle(v);
            const pi = this.police.indexOf(v);
            if (pi >= 0) this.police.splice(pi, 1);
          }
          continue;
        }
        const gone = (v.ai as Route).deadEnd && far > 90;
        if (v.driver === 'ai' && (far > 330 || gone) && recycled < 3) {
          this.spawnTraffic(false, v);
          recycled++;
        } else if (v.driver === 'none' && far > 280 && aiCount < AI_COUNT && recycled < 3) {
          this.spawnTraffic(false, v);
          aiCount++;
          recycled++;
        }
      }
      if (aiCount < AI_COUNT && g.vehicles.length < 150) this.spawnTraffic(false);
    }
  }

  private drive(v: Vehicle, dt: number, chase: THREE.Vector3 | null) {
    const g = this.game, r = v.ai as Route;
    const px = v.pos.x, pz = v.pos.z;
    const vf = v.speed;
    const fx = Math.sin(v.heading), fz = Math.cos(v.heading);
    let tx: number, tz: number, target = r.cruise;
    v.handbrake = false;

    if (chase) {
      const dist = Math.hypot(chase.x - px, chase.z - pz);
      const los = dist < 60 && this.lineOfSight(px, pz, chase.x, chase.z);
      if (los && !r.direct) r.direct = true;
      else if (!los && r.direct) {
        r.direct = false;
        this.reanchor(v, chase);
      }
      target = 18 + g.wanted.level * 2.5;
    }

    if (chase && r.direct) {
      tx = chase.x;
      tz = chase.z;
      const dist = Math.hypot(tx - px, tz - pz);
      const playerSpeed = g.player.vehicle ? Math.abs(g.player.vehicle.speed) : g.player.speed;
      // close in hard, but do not plough through a stopped or walking suspect
      if (dist < 16 && playerSpeed < 9) target = dist < 5.5 ? 0 : 5;
    } else {
      // advance along the lane: move on once the current point is reached or passed
      for (let guard = 0; guard < 4; guard++) {
        const path = r.path, n = path.length / 2;
        if (r.i >= n) {
          this.advance(r, chase, v.heading);
          if (r.deadEnd && r.edge.oneway) break;
          continue;
        }
        const qx = path[r.i * 2], qz = path[r.i * 2 + 1];
        const j = Math.max(0, r.i - 1);
        const sx = qx - path[j * 2], sz = qz - path[j * 2 + 1];
        const passed = r.i > 0 && (px - qx) * sx + (pz - qz) * sz > 0;
        if (passed || (px - qx) ** 2 + (pz - qz) ** 2 < 16) r.i++;
        else break;
      }
      const last = r.path.length / 2 - 1;
      const i = Math.min(r.i, last);
      tx = r.path[i * 2];
      tz = r.path[i * 2 + 1];
      // slow for the junction at the end of the edge, and give way to crossing traffic already nearer to it
      const ex = r.path[last * 2], ez = r.path[last * 2 + 1];
      const toEnd = Math.hypot(ex - px, ez - pz);
      if (toEnd < 16) {
        target = Math.min(target, chase ? 11 : 7);
        if (r.deadEnd && r.edge.oneway && toEnd < 6) target = 0;
        if (!chase && r.ignoreT <= 0 && toEnd > 4) {
          for (const o of g.vehicles) {
            if (o === v || o.driver === 'none') continue;
            const od = Math.hypot(o.pos.x - ex, o.pos.z - ez);
            if (od > 15 || od >= toEnd || Math.abs(o.speed) < 1.5) continue;
            if (Math.abs(angleDiff(o.heading, v.heading)) > 0.7) { target = 0; break; }
          }
        }
      }
    }

    // obstacle look-ahead (other vehicles, the player, pedestrians)
    if (r.ignoreT > 0) r.ignoreT -= dt;
    if (r.panicT > 0) {
      r.panicT -= dt;
      target = Math.max(target, 15);
    }
    if (!chase && r.ignoreT <= 0) {
      const reach = 5.5 + Math.max(0, vf) * 0.9;
      let blocked = target === 0;
      if (!blocked)
        for (const o of g.vehicles) {
          if (o === v) continue;
          const rx = o.pos.x - px, rz = o.pos.z - pz;
          const fd = rx * fx + rz * fz;
          if (fd <= 0 || fd > reach + 2.5) continue;
          if (Math.abs(rx * fz - rz * fx) < 1.9) { blocked = true; break; }
        }
      if (!blocked && !g.player.vehicle && !g.player.inHeli) blocked = this.ahead(g.player.pos.x - px, g.player.pos.z - pz, fx, fz, reach);
      if (!blocked) for (const ped of g.peds.list) {
        if (ped.state !== 'down' && this.ahead(ped.pos.x - px, ped.pos.z - pz, fx, fz, reach)) { blocked = true; break; }
      }
      if (blocked) {
        target = 0;
        r.blockedT += dt;
        if (r.blockedT > 5) { r.blockedT = 0; r.ignoreT = 2.4; }
        if (r.blockedT > 2.5 && (r.honkT -= dt) <= 0) {
          r.honkT = rand(3, 7);
          g.audio.horn(Math.hypot(px - g.player.pos.x, pz - g.player.pos.z));
        }
      } else r.blockedT = Math.max(0, r.blockedT - dt * 2);
    } else if (r.ignoreT > 0) target = Math.min(target, 3.5);

    // steering towards the target point
    const want = Math.atan2(tx - px, tz - pz);
    const diff = angleDiff(want, v.heading);
    v.steer = clamp(diff * 2.4, -1, 1);
    if (Math.abs(diff) > 0.7) target = Math.min(target, 6);

    // un-stick: back off when wedged against something
    if (r.reverseT > 0) {
      r.reverseT -= dt;
      v.throttle = -1;
      v.steer = -v.steer;
      return;
    }
    if (target > 1 && Math.abs(vf) < 0.8) {
      r.stuckT += dt;
      if (r.stuckT > (chase ? 1.1 : 2.5)) { r.stuckT = 0; r.reverseT = 1.2; }
    } else r.stuckT = 0;

    if (target <= 0.01) {
      v.throttle = vf > 0.4 ? -1 : 0;
      v.handbrake = vf <= 0.4;
    } else if (vf < target - 0.6) v.throttle = chase ? 1 : 0.55;
    else if (vf > target + 1.5) v.throttle = -0.6;
    else v.throttle = 0.12;
  }

  private ahead(rx: number, rz: number, fx: number, fz: number, reach: number) {
    const fd = rx * fx + rz * fz;
    return fd > 0 && fd < reach && Math.abs(rx * fz - rz * fx) < 1.5;
  }

  /** Called when the player rams or scares an AI driver. */
  panic(v: Vehicle) {
    if (v.driver === 'ai' && v.ai) (v.ai as Route).panicT = 9;
  }
}
