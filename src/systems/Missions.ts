import * as THREE from 'three';
import type { Game } from '../Game';
import type { Blip } from '../ui/Hud';
import { PITCH, BLOCK, ROAD, roadCoord, rand, blockIndex } from '../config';

interface Objective {
  kind: 'goto' | 'evade';
  x: number;
  z: number;
  radius: number;
  text: string;
  needVehicle?: boolean;
}
interface MissionDef {
  id: string;
  name: string;
  intro: string;
  giver: { x: number; z: number };
  reward: number;
  time: number;
  objectives: Objective[];
  onStart?: (g: Game) => void;
}
interface Pickup {
  id: string;
  x: number;
  z: number;
  mesh: THREE.Mesh;
  value: number;
  ttl: number; // Infinity for hidden packages
}

const node = (i: number, j: number) => ({ x: roadCoord(i), z: roadCoord(j) });
const go = (p: { x: number; z: number }, text: string, needVehicle = false, radius = 6.5): Objective => ({ kind: 'goto', x: p.x, z: p.z, radius, text, needVehicle });

/** Missions (start markers, objectives, timer, rewards) plus world pickups and random cash-drop events. */
export class Missions {
  readonly defs: MissionDef[];
  readonly completed = new Set<string>();
  readonly collected = new Set<string>();
  active: { def: MissionDef; index: number; timeLeft: number } | null = null;
  nearStart: MissionDef | null = null;
  private startMarkers: THREE.Mesh[] = [];
  private goal: THREE.Mesh;
  private pickups: Pickup[] = [];
  private pickupGeo = new THREE.OctahedronGeometry(0.55);
  private supplies: { x: number; z: number; kind: 'ammo' | 'health'; mesh: THREE.Mesh; cool: number }[] = [];
  private eventT = 70;
  private spin = 0;
  static readonly PACKAGE_COUNT = 12;

  constructor(private game: Game) {
    const c = game.city;
    const mid = (i: number, j: number, dx: number, dz: number) => ({ x: roadCoord(i) + (dx * PITCH) / 2, z: roadCoord(j) + (dz * PITCH) / 2 });
    this.defs = [
      {
        id: 'delivery', name: 'ホット・デリバリー', intro: '怪しい小包をビーチのホテルまで。時間厳守だ。', giver: c.blockCorner(5, 6, 1), reward: 600, time: 170,
        objectives: [go(mid(2, 3, 0, 1), '住宅街で<b>小包</b>を受け取れ'), go(mid(10, 8, 1, 0), 'ベラ・ビーチの<b>届け先</b>へ急げ')],
      },
      {
        id: 'race', name: 'ストリート・スプリント', intro: '街を一周するチェックポイントレース。車に乗って挑め。', giver: c.blockCorner(7, 4, 2), reward: 900, time: 135,
        objectives: [[4, 4], [8, 4], [8, 8], [4, 8], [4, 6], [2, 6], [2, 2], [6, 2]].map(([i, j], k, a) => go(node(i, j), `チェックポイント <b>${k + 1}/${a.length}</b> を通過せよ`, true, 8)),
      },
      {
        id: 'getaway', name: 'クリーン・ゲッタウェイ', intro: '通報された！手配度★3から逃げ切れ。', giver: c.blockCorner(4, 8, 0), reward: 1500, time: 240,
        objectives: [{ kind: 'evade', x: 0, z: 0, radius: 0, text: '警察を<b>振り切れ</b>（視界から消えて隠れ続ける）' }],
        onStart: (g) => g.wanted.set(3),
      },
      {
        id: 'taxi', name: 'ナイトシフト・タクシー', intro: '客を2組、目的地まで送り届けろ。', giver: c.blockCorner(8, 7, 3), reward: 800, time: 210,
        objectives: [
          go(mid(9, 5, 0, 1), '<b>1人目の客</b>を拾え', true), go(mid(3, 2, 1, 0), '客を<b>ミッドタウン</b>へ送れ', true),
          go(mid(1, 6, 0, 1), '<b>2人目の客</b>を拾え', true), go(mid(6, 11, 1, 0), '客を<b>サウスポート</b>へ送れ', true),
        ],
      },
      {
        id: 'crates', name: '港の落とし物', intro: '工業地帯に散らばった密輸品の木箱を5つ回収しろ。', giver: c.blockCorner(5, 10, 0), reward: 700, time: 190,
        objectives: [[2, 10], [0, 11], [4, 12], [8, 11], [9, 10]].map(([i, j], k) => go(mid(i, j, 1, 0), `木箱 <b>${k + 1}/5</b> を回収せよ`, false, 5)),
      },
    ];

    const ringGeo = new THREE.CylinderGeometry(1.5, 1.5, 3.2, 20, 1, true);
    ringGeo.translate(0, 1.6, 0);
    for (const d of this.defs) {
      const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xff4fa0, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false, fog: false }));
      m.position.set(d.giver.x, 0.15, d.giver.z);
      this.startMarkers.push(m);
      game.scene.add(m);
    }
    // respawning supplies: ammo crates (orange) and medkits (red)
    const box = new THREE.BoxGeometry(0.7, 0.5, 0.5);
    const place = (kind: 'ammo' | 'health', spots: [number, number, number][]) => {
      for (const [i, j, k] of spots) {
        const at = c.blockCorner(i, j, k, 1.2);
        const color = kind === 'ammo' ? 0xff9a2e : 0xff3b4e;
        const mesh = new THREE.Mesh(box, new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.6 }));
        mesh.position.set(at.x, 0.9, at.z);
        game.scene.add(mesh);
        this.supplies.push({ x: at.x, z: at.z, kind, mesh, cool: 0 });
      }
    };
    place('ammo', [[6, 6, 1], [2, 2, 0], [9, 9, 2], [4, 10, 1], [10, 3, 3], [7, 2, 2]]);
    place('health', [[3, 5, 0], [7, 7, 2], [1, 8, 1], [9, 1, 0], [5, 2, 3], [10, 10, 0]]);

    const goalGeo = new THREE.CylinderGeometry(1, 1, 34, 20, 1, true);
    goalGeo.translate(0, 17, 0);
    this.goal = new THREE.Mesh(goalGeo, new THREE.MeshBasicMaterial({ color: 0xffd23c, transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false, fog: false }));
    this.goal.visible = false;
    game.scene.add(this.goal);
  }

  // ------------------------------------------------------------------ pickups
  /** Hidden packages sit in parks and out on the beaches. Call after loading a save. */
  placePackages() {
    for (const p of this.pickups) this.game.scene.remove(p.mesh);
    this.pickups.length = 0;
    const spots: [number, number][] = [];
    for (const [i, j] of [[3, 7], [3, 8], [8, 3], [6, 9], [1, 4]]) spots.push([roadCoord(i) + ROAD / 2 + BLOCK / 2 + 9, roadCoord(j) + ROAD / 2 + BLOCK / 2 + 9]);
    spots.push([492, 492], [-492, 492], [492, -492], [-492, -492], [0, 498], [498, 30], [-498, -40]);
    spots.forEach(([x, z], k) => {
      const id = 'pkg' + k;
      if (!this.collected.has(id)) this.addPickup(id, x, z, 200, Infinity, 0x39e6ff);
    });
  }
  private addPickup(id: string, x: number, z: number, value: number, ttl: number, color: number) {
    const mesh = new THREE.Mesh(this.pickupGeo, new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.9, roughness: 0.3 }));
    mesh.position.set(x, this.game.city.groundHeight(x, z) + 1.1, z);
    this.game.scene.add(mesh);
    this.pickups.push({ id, x, z, mesh, value, ttl });
  }
  private updateSupplies(dt: number) {
    const g = this.game, p = g.player.pos;
    for (const s of this.supplies) {
      if (s.cool > 0) {
        if ((s.cool -= dt) <= 0) s.mesh.visible = true;
        continue;
      }
      s.mesh.rotation.y = this.spin;
      if (g.player.vehicle || (s.x - p.x) ** 2 + (s.z - p.z) ** 2 > 2.6) continue;
      if (s.kind === 'health') {
        if (g.player.health >= 100) continue;
        g.player.health = Math.min(100, g.player.health + 60);
        g.hud.notify('救急キットで回復した', 'good');
      } else g.giveAmmo(24);
      g.audio.cash();
      g.effects.sparkle(s.x, 1.1, s.z, 2.5, 1.4, 0.4);
      s.mesh.visible = false;
      s.cool = 90;
    }
  }
  private updatePickups(dt: number) {
    const g = this.game, p = g.player.pos;
    this.spin += dt * 2;
    this.updateSupplies(dt);
    for (let k = this.pickups.length - 1; k >= 0; k--) {
      const pk = this.pickups[k];
      pk.mesh.rotation.y = this.spin;
      pk.mesh.position.y = g.city.groundHeight(pk.x, pk.z) + 1.1 + Math.sin(this.spin * 1.3 + k) * 0.15;
      pk.ttl -= dt;
      const got = (pk.x - p.x) ** 2 + (pk.z - p.z) ** 2 < (g.player.vehicle ? 9 : 2.6);
      if (!got && pk.ttl > 0) continue;
      g.scene.remove(pk.mesh);
      this.pickups.splice(k, 1);
      if (!got) {
        g.hud.notify('現金バッグは誰かに持ち去られた…');
        continue;
      }
      g.addMoney(pk.value);
      g.audio.cash();
      g.effects.sparkle(pk.x, 1.2, pk.z, 0.4, 2, 2.4);
      if (pk.ttl === Infinity) {
        this.collected.add(pk.id);
        g.hud.notify(`隠しパッケージ ${this.collected.size}/${Missions.PACKAGE_COUNT} — +$${pk.value}`, 'good');
        if (this.collected.size === Missions.PACKAGE_COUNT) {
          g.addMoney(5000);
          g.hud.banner('COMPLETE', '全パッケージ回収ボーナス +$5,000', '#39e6ff');
        }
        g.save();
      } else g.hud.notify(`現金バッグを回収 — +$${pk.value}`, 'good');
    }
    // random event: a cash bag appears somewhere nearby for a limited time
    if (!this.active && (this.eventT -= dt) <= 0) {
      this.eventT = rand(80, 140);
      const c = g.city.blockCorner(blockIndex(p.x + rand(-220, 220)), blockIndex(p.z + rand(-220, 220)), Math.floor(Math.random() * 4), 1.5);
      if (Math.hypot(c.x - p.x, c.z - p.z) > 50) {
        this.addPickup('drop', c.x, c.z, Math.round(rand(150, 420) / 10) * 10, 95, 0x7dff6b);
        g.hud.notify('📦 イベント: 近くに<b>現金バッグ</b>が落ちている！（緑のマーカー）');
        g.audio.blip(880, 0.15, 'triangle');
      }
    }
  }

  // ------------------------------------------------------------------ missions
  get objective(): Objective | null {
    return this.active ? this.active.def.objectives[this.active.index] : null;
  }
  get objectiveText() {
    return this.active ? `<b style="color:#ff8fc4">${this.active.def.name}</b> — ${this.objective!.text}` : null;
  }

  start(def: MissionDef) {
    const g = this.game;
    this.active = { def, index: 0, timeLeft: def.time };
    this.nearStart = null;
    for (const m of this.startMarkers) m.visible = false;
    g.hud.banner(def.name, def.intro, '#ff8fc4', 3600);
    g.audio.checkpoint();
    def.onStart?.(g);
    this.syncGoal();
  }
  private syncGoal() {
    const o = this.objective;
    this.goal.visible = !!o && o.kind === 'goto';
    if (o && o.kind === 'goto') {
      this.goal.position.set(o.x, 0, o.z);
      this.goal.scale.set(o.radius, 1, o.radius);
    }
  }
  private end() {
    this.active = null;
    this.goal.visible = false;
    for (const m of this.startMarkers) m.visible = true;
  }
  fail(reason: string) {
    if (!this.active) return;
    const g = this.game;
    g.hud.banner('MISSION FAILED', reason, '#ff5a5a');
    g.audio.fail();
    this.end();
  }
  private complete() {
    const g = this.game, def = this.active!.def;
    const first = !this.completed.has(def.id);
    const reward = first ? def.reward : Math.round(def.reward * 0.6);
    this.completed.add(def.id);
    g.addMoney(reward);
    g.hud.banner('MISSION PASSED', `${def.name} — +$${reward.toLocaleString('en-US')}${first ? '' : '（リピート報酬）'}`, '#ffd23c', 4200);
    g.audio.success();
    this.end();
    g.save();
  }

  update(dt: number) {
    const g = this.game, p = g.player.pos;
    this.updatePickups(dt);
    const pulse = 0.38 + Math.sin(this.spin * 2) * 0.12;

    if (!this.active) {
      this.nearStart = null;
      if (!g.player.vehicle)
        for (const d of this.defs) if ((d.giver.x - p.x) ** 2 + (d.giver.z - p.z) ** 2 < 4) this.nearStart = d;
      for (const m of this.startMarkers) (m.material as THREE.MeshBasicMaterial).opacity = pulse;
      return;
    }
    const a = this.active;
    (this.goal.material as THREE.MeshBasicMaterial).opacity = pulse;
    a.timeLeft -= dt;
    if (a.timeLeft <= 0) return this.fail('時間切れ');
    const o = this.objective!;
    let done = false;
    if (o.kind === 'goto') {
      const inside = (o.x - p.x) ** 2 + (o.z - p.z) ** 2 < o.radius * o.radius;
      done = inside && (!o.needVehicle || !!g.player.vehicle);
      if (inside && !done) g.prompt = ['!', '車に乗って来る必要がある'];
    } else done = g.wanted.level === 0;
    if (done) {
      a.index++;
      if (a.index >= a.def.objectives.length) this.complete();
      else {
        g.audio.checkpoint();
        g.effects.sparkle(o.x, 1.5, o.z, 3, 2.4, 0.5, 20);
        this.syncGoal();
      }
    }
  }

  blips(out: Blip[]) {
    if (this.active) {
      const o = this.objective!;
      if (o.kind === 'goto') out.push({ x: o.x, z: o.z, color: '#ffd23c', shape: 'diamond', size: 6, clampEdge: true });
    } else for (const d of this.defs) out.push({ x: d.giver.x, z: d.giver.z, color: this.completed.has(d.id) ? '#b98aa3' : '#ff4fa0', shape: 'diamond', size: 5, clampEdge: true });
    for (const s of this.supplies)
      if (s.cool <= 0) out.push({ x: s.x, z: s.z, color: s.kind === 'ammo' ? '#ff9a2e' : '#ff3b4e', shape: 'square', size: 3.2 });
    for (const pk of this.pickups) {
      if (pk.ttl === Infinity) out.push({ x: pk.x, z: pk.z, color: '#39e6ff', shape: 'dot', size: 3 });
      else out.push({ x: pk.x, z: pk.z, color: '#7dff6b', shape: 'dot', size: 5, clampEdge: true });
    }
  }
}
