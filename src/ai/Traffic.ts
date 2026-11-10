import * as THREE from 'three';
import type { Game } from '../Game';
import { Vehicle, VehicleKind } from '../entities/Vehicle';
import { N, ROAD, PITCH, LANE, roadCoord, nearestRoad, clamp, angleDiff, rand } from '../config';

/** Per-vehicle route state: driving from node (ai,aj) to (bi,bj) along (dx,dz). */
interface Route {
  bi: number;
  bj: number;
  dx: number;
  dz: number;
  sx: number; // lane start point
  sz: number;
  len: number; // lane length from start to stop line
  phase: 'turn' | 'seg';
  cruise: number;
  blockedT: number;
  ignoreT: number;
  panicT: number;
  stuckT: number;
  reverseT: number;
  direct: boolean; // police: steering straight at the player
  honkT: number;
}

const DIRS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const START_OFF = ROAD / 2 + 2;
const STOP_OFF = ROAD / 2 + 5;
const CYCLE = 22, GREEN = 9, YELLOW = 2;
const AI_COUNT = 34;
const col = new THREE.Color();

/** Ambient traffic, traffic lights and police pursuit driving. */
export class Traffic {
  private lamps: THREE.InstancedMesh;
  private lampInfo: { i: number; j: number; ns: boolean }[] = [];
  private lampTick = 0;
  private respawnTick = 0;
  time = 0;
  readonly police: Vehicle[] = [];

  constructor(private game: Game) {
    // ---- traffic lights: one mast per approach, lamp hangs over the incoming lane
    const mastGeo = new THREE.CylinderGeometry(0.1, 0.13, 5.6, 6);
    mastGeo.translate(0, 2.8, 0);
    const armLen = ROAD / 2 - LANE + 0.7;
    const armGeo = new THREE.BoxGeometry(armLen, 0.12, 0.12);
    armGeo.translate(armLen / 2, 5.5, 0);
    const lampGeo = new THREE.BoxGeometry(0.42, 1.0, 0.42);
    lampGeo.translate(armLen, 5.0, 0);
    const approaches: { x: number; z: number; rot: number; i: number; j: number; ns: boolean }[] = [];
    for (let i = 0; i <= N; i++)
      for (let j = 0; j <= N; j++)
        for (const [dx, dz] of DIRS) {
          const pi = i - dx, pj = j - dz; // node the traffic comes from
          if (pi < 0 || pi > N || pj < 0 || pj > N) continue;
          const rx = -dz, rz = dx; // right of travel
          const x = roadCoord(i) - dx * (ROAD / 2 + 1.2) + rx * (ROAD / 2 + 0.7);
          const z = roadCoord(j) - dz * (ROAD / 2 + 1.2) + rz * (ROAD / 2 + 0.7);
          approaches.push({ x, z, rot: Math.atan2(rz, -rx), i, j, ns: dz !== 0 });
        }
    const dark = new THREE.MeshStandardMaterial({ color: 0x2c2f33, roughness: 0.6 });
    const masts = new THREE.InstancedMesh(mastGeo, dark, approaches.length);
    const arms = new THREE.InstancedMesh(armGeo, dark, approaches.length);
    this.lamps = new THREE.InstancedMesh(lampGeo, new THREE.MeshBasicMaterial(), approaches.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1);
    approaches.forEach((a, k) => {
      q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, a.rot);
      m.compose(new THREE.Vector3(a.x, 0.15, a.z), q, one);
      masts.setMatrixAt(k, m);
      arms.setMatrixAt(k, m);
      this.lamps.setMatrixAt(k, m);
      this.lamps.setColorAt(k, col.setHex(0xff0000));
      this.lampInfo.push({ i: a.i, j: a.j, ns: a.ns });
    });
    for (const im of [masts, arms, this.lamps]) im.frustumCulled = false;
    game.scene.add(masts, arms, this.lamps);

    for (let k = 0; k < AI_COUNT; k++) this.spawnTraffic(true);
  }

  // ------------------------------------------------------------------ lights
  /** 0 = green, 1 = yellow, 2 = red for traffic moving along Z (ns) or X at node (i,j). */
  light(i: number, j: number, ns: boolean) {
    let t = (this.time + ((i * 7 + j * 13) % 4) * 5.5) % CYCLE;
    if (!ns) t = (t + CYCLE / 2) % CYCLE;
    return t < GREEN ? 0 : t < GREEN + YELLOW ? 1 : 2;
  }
  private updateLamps() {
    const hex = [0x22ff55, 0xffcc22, 0xff2a2a];
    for (let k = 0; k < this.lampInfo.length; k++) {
      const a = this.lampInfo[k];
      this.lamps.setColorAt(k, col.setHex(hex[this.light(a.i, a.j, a.ns)]));
    }
    this.lamps.instanceColor!.needsUpdate = true;
  }

  // ------------------------------------------------------------------ routes
  private setSegment(r: Route, ai: number, aj: number, dx: number, dz: number) {
    r.bi = ai + dx;
    r.bj = aj + dz;
    r.dx = dx;
    r.dz = dz;
    r.sx = roadCoord(ai) + dx * START_OFF - dz * LANE;
    r.sz = roadCoord(aj) + dz * START_OFF + dx * LANE;
    r.len = PITCH - START_OFF - STOP_OFF;
    r.phase = 'turn';
  }
  private newRoute(): Route {
    return { bi: 0, bj: 0, dx: 1, dz: 0, sx: 0, sz: 0, len: 0, phase: 'seg', cruise: rand(9, 13), blockedT: 0, ignoreT: 0, panicT: 0, stuckT: 0, reverseT: 0, direct: false, honkT: 0 };
  }
  private validDirs(i: number, j: number, fromDx: number, fromDz: number) {
    return DIRS.filter(([dx, dz]) => !(dx === -fromDx && dz === -fromDz) && i + dx >= 0 && i + dx <= N && j + dz >= 0 && j + dz <= N);
  }
  /** Pick the next segment at the end of the current one. */
  private advance(r: Route, chase: { x: number; z: number } | null) {
    const opts = this.validDirs(r.bi, r.bj, r.dx, r.dz);
    let choice = opts[0];
    if (chase) {
      let best = Infinity;
      for (const o of opts) {
        const d = Math.hypot(roadCoord(r.bi + o[0]) - chase.x, roadCoord(r.bj + o[1]) - chase.z);
        if (d < best) { best = d; choice = o; }
      }
    } else {
      const straight = opts.find(([dx, dz]) => dx === r.dx && dz === r.dz);
      choice = straight && Math.random() < 0.55 ? straight : opts[Math.floor(Math.random() * opts.length)];
    }
    this.setSegment(r, r.bi, r.bj, choice[0], choice[1]);
  }

  private spotFree(x: number, z: number, r = 9) {
    for (const v of this.game.vehicles) if ((v.pos.x - x) ** 2 + (v.pos.z - z) ** 2 < r * r) return false;
    return true;
  }

  /** Find a lane position between minD and maxD from the player. */
  private pickSpawn(minD: number, maxD: number, r: Route) {
    const p = this.game.player.pos;
    for (let tries = 0; tries < 14; tries++) {
      const i = nearestRoad(p.x + rand(-maxD, maxD)), j = nearestRoad(p.z + rand(-maxD, maxD));
      const opts = this.validDirs(i, j, 0, 0);
      const [dx, dz] = opts[Math.floor(Math.random() * opts.length)];
      this.setSegment(r, i, j, dx, dz);
      const s = rand(0, r.len - 6);
      const x = r.sx + dx * s, z = r.sz + dz * s;
      const d = Math.max(Math.abs(x - p.x), Math.abs(z - p.z));
      if (d < minD || d > maxD || !this.spotFree(x, z)) continue;
      r.phase = 'seg';
      return { x, z, heading: Math.atan2(dx, dz) };
    }
    return null;
  }

  private spawnTraffic(initial: boolean, reuse?: Vehicle) {
    const r: Route = reuse?.ai ?? this.newRoute();
    const s = this.pickSpawn(initial ? 20 : 110, initial ? 240 : 270, r);
    if (!s) return;
    const kinds: VehicleKind[] = ['sedan', 'sedan', 'sedan', 'sedan', 'van', 'taxi', 'taxi', 'sports'];
    const v = reuse ?? this.game.addVehicle(kinds[Math.floor(Math.random() * kinds.length)], s.x, s.z, s.heading);
    v.place(s.x, s.z, s.heading);
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
    const s = this.pickSpawn(90, 190, r);
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
      v.driver = 'ai';
      (v.ai as Route).direct = false;
      (v.ai as Route).cruise = 11;
      this.reanchor(v, null);
    }
  }
  private reanchor(v: Vehicle, chase: { x: number; z: number } | null) {
    const r = v.ai as Route;
    const i = nearestRoad(v.pos.x), j = nearestRoad(v.pos.z);
    r.bi = i;
    r.bj = j;
    r.dx = 0;
    r.dz = 0;
    this.advance(r, chase);
  }
  lineOfSight(ax: number, az: number, bx: number, bz: number) {
    const w = this.game.city.collision;
    for (let k = 1; k < 10; k++) {
      const t = k / 10;
      if (w.pointBlocked(ax + (bx - ax) * t, 1, az + (bz - az) * t, 1.2)) return false;
    }
    return true;
  }

  // ------------------------------------------------------------------ update
  update(dt: number) {
    const g = this.game, p = g.player;
    this.time += dt;
    if ((this.lampTick -= dt) <= 0) {
      this.lampTick = 0.25;
      this.updateLamps();
    }

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
        if (v.driver === 'ai' && far > 300 && recycled < 3) {
          this.spawnTraffic(false, v);
          recycled++;
        } else if (v.driver === 'none' && far > 260 && aiCount < AI_COUNT && recycled < 3) {
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
      target = 19 + g.wanted.level * 2.5;
    }

    if (chase && r.direct) {
      tx = chase.x;
      tz = chase.z;
      const dist = Math.hypot(tx - px, tz - pz);
      const playerSpeed = g.player.vehicle ? Math.abs(g.player.vehicle.speed) : g.player.speed;
      // close in hard, but do not plough through a stopped or walking suspect
      if (dist < 16 && playerSpeed < 9) target = dist < 5.5 ? 0 : 5;
    } else if (r.phase === 'turn') {
      tx = r.sx;
      tz = r.sz;
      target = Math.min(target, chase ? 9 : 5.5);
      if ((px - r.sx) * r.dx + (pz - r.sz) * r.dz > -2) r.phase = 'seg';
    } else {
      const s = (px - r.sx) * r.dx + (pz - r.sz) * r.dz;
      const look = Math.min(s + 7 + vf * 0.3, r.len + 1);
      tx = r.sx + r.dx * look;
      tz = r.sz + r.dz * look;
      const toEnd = r.len - s;
      if (toEnd < 0.8) {
        this.advance(r, chase);
        tx = r.sx;
        tz = r.sz;
      } else if (!chase && r.panicT <= 0) {
        const state = this.light(r.bi, r.bj, r.dz !== 0);
        const stopDist = (vf * vf) / 14 + 2.5;
        if (state === 2 && toEnd < stopDist + 3) target = 0;
        else if (state === 1 && toEnd < stopDist + 3 && toEnd > stopDist - 1) target = 0;
        else if (toEnd < 12) target = Math.min(target, 8);
      } else if (toEnd < 14) target = Math.min(target, 10);
    }

    // obstacle look-ahead (other vehicles, the player, pedestrians)
    if (r.ignoreT > 0) r.ignoreT -= dt;
    if (r.panicT > 0) {
      r.panicT -= dt;
      target = Math.max(target, 17);
    }
    if (!chase && r.ignoreT <= 0) {
      const reach = 5.5 + Math.max(0, vf) * 0.9;
      let blocked = false;
      for (const o of g.vehicles) {
        if (o === v) continue;
        const rx = o.pos.x - px, rz = o.pos.z - pz;
        const fd = rx * fx + rz * fz;
        if (fd <= 0 || fd > reach + 2.5) continue;
        if (Math.abs(rx * fz - rz * fx) < 1.9) { blocked = true; break; }
      }
      if (!blocked && !g.player.vehicle) blocked = this.ahead(g.player.pos.x - px, g.player.pos.z - pz, fx, fz, reach);
      if (!blocked) for (const ped of g.peds.list) {
        if (ped.state !== 'down' && this.ahead(ped.pos.x - px, ped.pos.z - pz, fx, fz, reach)) { blocked = true; break; }
      }
      if (blocked) {
        target = 0;
        r.blockedT += dt;
        if (r.blockedT > 6) { r.blockedT = 0; r.ignoreT = 2.2; }
        if (r.blockedT > 2.5 && (r.honkT -= dt) <= 0) {
          r.honkT = rand(3, 7);
          g.audio.horn(Math.hypot(px - g.player.pos.x, pz - g.player.pos.z));
        }
      } else r.blockedT = Math.max(0, r.blockedT - dt * 2);
    } else if (r.ignoreT > 0) target = Math.min(target, 3);

    // steering towards the target point
    const want = Math.atan2(tx - px, tz - pz);
    const diff = angleDiff(want, v.heading);
    v.steer = clamp(diff * 2.4, -1, 1);
    if (Math.abs(diff) > 0.7) target = Math.min(target, 7);

    // police un-stick: back off when wedged against something
    if (chase) {
      if (r.reverseT > 0) {
        r.reverseT -= dt;
        v.throttle = -1;
        v.steer = -v.steer;
        return;
      }
      if (target > 1 && Math.abs(vf) < 1) {
        r.stuckT += dt;
        if (r.stuckT > 1.1) { r.stuckT = 0; r.reverseT = 1.2; }
      } else r.stuckT = 0;
    }

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
