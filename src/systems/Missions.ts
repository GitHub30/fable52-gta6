import * as THREE from 'three';
import type { Game } from '../Game';
import type { Blip } from '../ui/Hud';
import { rand } from '../config';
import { PLACES } from '../world/City';

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
    const P = PLACES;
    const road = (p: { x: number; z: number }) => c.roadSpot(p.x, p.z);
    const side = (p: { x: number; z: number }, dx = 0, dz = 0) => c.sideSpot(p.x + dx, p.z + dz);
    this.defs = [
      {
        id: 'delivery', name: 'ホット・デリバリー', intro: '四天王寺で預かった小包を、あべのハルカスまで。時間厳守だ。', giver: side(P.tsutenkaku, 40, 70), reward: 600, time: 200,
        objectives: [go(road(P.shitennoji), '<b>四天王寺</b>で小包を受け取れ'), go(road(P.harukas), '<b>あべのハルカス</b>前の届け先へ急げ')],
      },
      {
        id: 'race', name: 'ストリート・スプリント', intro: '新世界から天王寺・阿倍野を回るチェックポイントレース。車に乗って挑め。', giver: side(P.ebisucho), reward: 900, time: 220,
        objectives: [P.ebisucho, P.shinImamiya, P.dobutsuenMae, P.tenshiba, P.tennojiSta, P.abeno, P.teradacho, P.yuhigaoka].map((p, k, a) =>
          go(road(p), `チェックポイント <b>${k + 1}/${a.length}</b>（${p.name}）を通過せよ`, true, 9)),
      },
      {
        id: 'getaway', name: 'クリーン・ゲッタウェイ', intro: '通報された！手配度★3から逃げ切れ。', giver: side(P.dobutsuenMae), reward: 1500, time: 240,
        objectives: [{ kind: 'evade', x: 0, z: 0, radius: 0, text: '警察を<b>振り切れ</b>（視界から消えて隠れ続ける）' }],
        onStart: (g) => g.wanted.set(3),
      },
      {
        id: 'taxi', name: 'ナイトシフト・タクシー', intro: '客を2組、目的地まで送り届けろ。', giver: side(P.tennojiSta), reward: 800, time: 260,
        objectives: [
          go(road(P.harukas), '<b>あべのハルカス</b>前で1人目の客を拾え', true), go(road(P.shitennoji), '客を<b>四天王寺</b>へ送れ', true),
          go(road(P.isshinji), '<b>一心寺</b>前で2人目の客を拾え', true), go(road(P.shinImamiya), '客を<b>新今宮</b>へ送れ', true),
        ],
      },
      {
        id: 'crates', name: '阿倍野の落とし物', intro: '阿倍野一帯に散らばった木箱を5つ回収しろ。', giver: side(P.abeno), reward: 700, time: 240,
        objectives: [[300, 640], [20, 600], [-300, 480], [600, 560], [690, 200]].map(([x, z], k) => go(road({ x, z }), `木箱 <b>${k + 1}/5</b> を回収せよ`, false, 5)),
      },
    ];

    const ringGeo = new THREE.CylinderGeometry(1.5, 1.5, 3.2, 20, 1, true);
    ringGeo.translate(0, 1.6, 0);
    for (const d of this.defs) {
      const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xff4fa0, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false, fog: false }));
      m.position.set(d.giver.x, c.groundHeight(d.giver.x, d.giver.z), d.giver.z);
      this.startMarkers.push(m);
      game.scene.add(m);
    }
    // respawning supplies: ammo crates (orange) and medkits (red)
    const box = new THREE.BoxGeometry(0.7, 0.5, 0.5);
    const place = (kind: 'ammo' | 'health', spots: { x: number; z: number }[]) => {
      for (const s of spots) {
        const at = c.sideSpot(s.x, s.z, 1.1);
        const color = kind === 'ammo' ? 0xff9a2e : 0xff3b4e;
        const mesh = new THREE.Mesh(box, new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.6 }));
        mesh.position.set(at.x, c.groundHeight(at.x, at.z) + 0.9, at.z);
        game.scene.add(mesh);
        this.supplies.push({ x: at.x, z: at.z, kind, mesh, cool: 0 });
      }
    };
    place('ammo', [{ x: P.tsutenkaku.x - 60, z: P.tsutenkaku.z + 30 }, P.shinImamiya, P.tennojiSta, P.abeno, P.shitennoji, P.teradacho]);
    place('health', [{ x: P.tsutenkaku.x + 70, z: P.tsutenkaku.z - 60 }, P.dobutsuenMae, P.isshinji, P.harukas, P.yuhigaoka, { x: 0, z: 560 }]);

    const goalGeo = new THREE.CylinderGeometry(1, 1, 34, 20, 1, true);
    goalGeo.translate(0, 17, 0);
    this.goal = new THREE.Mesh(goalGeo, new THREE.MeshBasicMaterial({ color: 0xffd23c, transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false, fog: false }));
    this.goal.visible = false;
    game.scene.add(this.goal);
  }

  // ------------------------------------------------------------------ pickups
  /** Hidden packages sit in the parks, temple grounds and back streets. Call after loading a save. */
  placePackages() {
    for (const p of this.pickups) this.game.scene.remove(p.mesh);
    this.pickups.length = 0;
    // the twelve largest green areas: parks, the zoo, temple grounds
    const greens = this.game.city.data.green
      .map((g) => {
        let a = 0, x = 0, z = 0;
        for (let i = 0, j = g.length - 2; i < g.length; j = i, i += 2) {
          a += g[j] * g[i + 1] - g[i] * g[j + 1];
          x += g[i];
          z += g[i + 1];
        }
        return { a: Math.abs(a), x: x / (g.length / 2), z: z / (g.length / 2) };
      })
      .sort((p, q) => q.a - p.a);
    const spots: [number, number][] = [];
    for (const g of greens) {
      if (spots.length >= Missions.PACKAGE_COUNT) break;
      const s = this.game.city.clearSpot(g.x, g.z, 1.5);
      if (spots.every(([x, z]) => Math.hypot(x - s.x, z - s.z) > 60)) spots.push([s.x, s.z]);
    }
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
      g.effects.sparkle(s.x, g.city.groundHeight(s.x, s.z) + 1.1, s.z, 2.5, 1.4, 0.4);
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
      g.effects.sparkle(pk.x, g.city.groundHeight(pk.x, pk.z) + 1.2, pk.z, 0.4, 2, 2.4);
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
      const c = g.city.sideSpot(p.x + rand(-220, 220), p.z + rand(-220, 220), 0.8);
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
      this.goal.position.set(o.x, this.game.city.groundHeight(o.x, o.z), o.z);
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
        g.effects.sparkle(o.x, g.city.groundHeight(o.x, o.z) + 1.5, o.z, 3, 2.4, 0.5, 20);
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
