import * as THREE from 'three';
import { Input } from './core/Input';
import { CameraRig } from './core/CameraRig';
import { GameAudio } from './core/Audio';
import { City, DISTRICT_NAMES } from './world/City';
import { Environment, WEATHER_LABEL, Weather } from './world/Environment';
import { Effects } from './world/Effects';
import { Player } from './entities/Player';
import { Vehicle, VehicleKind, collideVehicles } from './entities/Vehicle';
import { Traffic } from './ai/Traffic';
import { Pedestrians, Ped } from './ai/Pedestrians';
import { Officers } from './ai/Officers';
import { Wanted } from './systems/Wanted';
import { Missions } from './systems/Missions';
import { Save } from './systems/Save';
import { Hud, Blip } from './ui/Hud';
import { N, BLOCK, PITCH, PARK_OFFSET, roadCoord, mulberry32, rand } from './config';

export type GameState = 'menu' | 'playing' | 'paused';
const camFwd = { x: 0, z: 0 };
const tmp = { x: 0, z: 0 };
const WEATHER_ORDER: Weather[] = ['clear', 'cloudy', 'rain', 'fog'];
const QUALITY_STEPS = [1.5, 1.25, 1, 0.8];

export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(62, 1, 0.3, 3000);
  readonly rig = new CameraRig(this.camera);
  readonly input: Input;
  readonly audio = new GameAudio();
  readonly city = new City();
  readonly env: Environment;
  readonly effects: Effects;
  readonly player = new Player();
  readonly hud: Hud;
  readonly vehicles: Vehicle[] = [];
  readonly peds: Pedestrians;
  readonly traffic: Traffic;
  readonly wanted: Wanted;
  readonly officers: Officers;
  readonly missions: Missions;
  readonly stats: Record<string, number> = { knockouts: 0, carsStolen: 0, busted: 0, wasted: 0 };

  state: GameState = 'menu';
  weapon: 'fist' | 'pistol' = 'pistol'; // the player starts armed
  hasPistol = true;
  ammo = 36;
  private fireT = 0;
  money = 250;
  playTime = 0;
  frozen = 0; // seconds during which the player cannot act (wasted / busted)
  fps = 0;
  private last = 0;
  private fpsFrames = 0;
  private fpsTime = 0;
  private mapTick = 0;
  private blips: Blip[] = [];
  private respawnT = 0;
  private respawnAt: { x: number; z: number; label: string } | null = null;
  private hurtT = 0; // time since last damage (for regeneration)
  private invulnT = 0;
  private policeHitT = 0;
  private autosaveT = 60;
  private smokeT = 0;
  private headlight = new THREE.SpotLight(0xfff1d0, 0, 70, 0.5, 0.6, 1.2);
  private quality = 0;
  private lowFpsT = 0;
  private cssW = 0;
  private cssH = 0;
  /** Prompt requested for this frame as [key, text]; applied once at the end of the frame. */
  prompt: [string, string] | null = null;

  constructor(readonly canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, QUALITY_STEPS[0]));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;

    this.input = new Input(canvas);
    this.env = new Environment(this.scene);
    this.effects = new Effects(this.scene);
    this.hud = new Hud(uiRoot, this.city);
    this.scene.add(this.city.group, this.player.group, this.headlight, this.headlight.target);
    this.player.onStep = () => this.audio.step();
    this.player.onJump = () => this.audio.jump();

    this.spawnParkedCars();
    this.resetPlayer();
    this.peds = new Pedestrians(this);
    this.traffic = new Traffic(this);
    this.wanted = new Wanted(this);
    this.officers = new Officers(this);
    this.missions = new Missions(this);
    this.missions.placePackages();

    window.addEventListener('resize', () => this.resize());
    this.resize();
    canvas.addEventListener('click', () => {
      if (this.state === 'playing') this.input.lock();
    });
    this.input.onLockChange = (locked) => {
      if (!locked && this.state === 'playing') this.pause();
    };
    this.hud.setVisible(false);
    this.showMenu();
  }

  // ------------------------------------------------------------------ setup
  private resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.cssW = w;
    this.cssH = h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  addVehicle(kind: VehicleKind, x: number, z: number, heading: number, color?: number) {
    const v = new Vehicle(kind, color);
    v.place(x, z, heading);
    this.vehicles.push(v);
    this.scene.add(v.mesh);
    return v;
  }
  removeVehicle(v: Vehicle) {
    const k = this.vehicles.indexOf(v);
    if (k >= 0) this.vehicles.splice(k, 1);
    this.scene.remove(v.mesh);
  }

  private spawnParkedCars() {
    const rng = mulberry32(777);
    const kinds: VehicleKind[] = ['sedan', 'sedan', 'sedan', 'sports', 'van', 'taxi'];
    for (let n = 0; n < 80; n++) {
      const alongZ = rng() < 0.5;
      const line = roadCoord(Math.floor(rng() * (N + 1)));
      const seg = Math.floor(rng() * N);
      const along = roadCoord(seg) + PITCH / 2 + (rng() - 0.5) * (BLOCK - 26);
      const side = rng() < 0.5 ? 1 : -1;
      const kind = kinds[Math.floor(rng() * kinds.length)];
      // parked facing the direction of travel on that side (right-hand traffic)
      if (alongZ) this.addVehicle(kind, line - side * PARK_OFFSET, along, side > 0 ? 0 : Math.PI);
      else this.addVehicle(kind, along, line + side * PARK_OFFSET, side > 0 ? Math.PI / 2 : -Math.PI / 2);
    }
    // a guaranteed starter car next to the spawn point
    this.addVehicle('sports', roadCoord(6) + PARK_OFFSET, roadCoord(6) + 26, Math.PI, 0xff3b6b);
  }

  resetPlayer(x?: number, z?: number, heading = Math.PI) {
    const c = this.city.blockCorner(6, 6, 0);
    const p = this.player;
    p.pos.set(x ?? c.x, 0.15, z ?? c.z + 14);
    p.pos.y = this.city.groundHeight(p.pos.x, p.pos.z);
    p.vel.set(0, 0, 0);
    p.heading = heading;
    p.health = 100;
    p.dead = false;
    if (p.vehicle) {
      p.vehicle.driver = 'none';
      p.vehicle.throttle = 0;
    }
    p.vehicle = null;
    p.group.rotation.x = 0;
    p.syncMesh();
    this.rig.snap(p.pos, heading + Math.PI);
  }

  // ------------------------------------------------------------------ menus / persistence
  showMenu() {
    this.state = 'menu';
    this.hud.showMenu(
      Save.has(),
      () => {
        Save.clear();
        this.beginPlay();
      },
      () => {
        this.load();
        this.beginPlay();
      },
    );
  }
  beginPlay() {
    this.audio.init();
    this.hud.hideOverlay();
    this.hud.setVisible(true);
    this.state = 'playing';
    this.input.lock();
    this.hud.notify('ようこそ、ベラ・ベイへ。<b>E</b> で車に乗り、<b>ピンクのマーカー</b>でミッション開始。');
  }
  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.input.unlock();
    this.audio.setPaused(true);
    const mins = Math.floor(this.playTime / 60);
    this.hud.showPause(
      () => this.resume(),
      () => this.hud.notify(this.save() ? 'セーブしました' : 'セーブできません（ミッション中・手配中は不可）', 'good'),
      () => {
        Save.clear();
        location.reload();
      },
      `プレイ時間 ${mins} 分 · 所持金 $${Math.floor(this.money).toLocaleString('en-US')} · ミッション ${this.missions.completed.size}/${this.missions.defs.length} · パッケージ ${this.missions.collected.size}/${Missions.PACKAGE_COUNT}`,
    );
  }
  resume() {
    if (this.state !== 'paused') return;
    this.hud.hideOverlay();
    this.state = 'playing';
    this.audio.setPaused(false);
    this.input.lock();
  }

  /** Persist progress. Refused mid-mission or while wanted so saves are always in a clean state. */
  save(): boolean {
    const p = this.player;
    if (this.missions.active || this.wanted.level > 0 || p.dead) return false;
    return Save.write({
      money: this.money,
      x: p.pos.x,
      z: p.pos.z,
      heading: p.heading,
      time: this.env.time,
      weather: this.env.weather,
      playTime: this.playTime,
      completed: [...this.missions.completed],
      collected: [...this.missions.collected],
      stats: this.stats,
      savedAt: Date.now(),
      ammo: this.ammo,
      hasPistol: this.hasPistol,
    });
  }
  load(): boolean {
    const d = Save.load();
    if (!d) return false;
    this.money = d.money;
    this.playTime = d.playTime || 0;
    this.env.time = d.time ?? 9;
    if (d.weather) this.env.setWeather(d.weather);
    this.missions.completed.clear();
    this.missions.collected.clear();
    (d.completed || []).forEach((id) => this.missions.completed.add(id));
    (d.collected || []).forEach((id) => this.missions.collected.add(id));
    Object.assign(this.stats, d.stats || {});
    this.ammo = d.ammo ?? 36; // saves from before the pistol was standard get a full load
    this.hasPistol = true;
    this.missions.placePackages();
    const blocked = this.city.collision.pointBlocked(d.x, 0.5, d.z, 0.6);
    if (blocked) this.resetPlayer();
    else this.resetPlayer(d.x, d.z, d.heading);
    return true;
  }
  addMoney(n: number) {
    this.money = Math.max(0, this.money + n);
  }

  // ------------------------------------------------------------------ loop
  start() {
    this.last = performance.now();
    const loop = (now: number) => {
      requestAnimationFrame(loop);
      const real = (now - this.last) / 1000;
      this.last = now;
      this.frame(Math.min(0.05, real));
      this.measure(real);
    };
    requestAnimationFrame(loop);
  }

  private measure(real: number) {
    this.fpsFrames++;
    this.fpsTime += real;
    if (this.fpsTime < 0.5) return;
    this.fps = Math.round(this.fpsFrames / this.fpsTime);
    this.fpsFrames = 0;
    this.fpsTime = 0;
    // adaptive resolution: step down when the GPU cannot hold ~40 fps
    if (this.state !== 'playing' || document.hidden || !document.hasFocus()) return; // unfocused tabs are throttled by the browser
    if (this.fps < 27) this.lowFpsT += 0.5; // below a 30 Hz cap, so capped displays do not trigger it
    else this.lowFpsT = Math.max(0, this.lowFpsT - 0.25);
    if (this.lowFpsT >= 3 && this.quality < QUALITY_STEPS.length - 1) {
      this.quality++;
      this.lowFpsT = 0;
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, QUALITY_STEPS[this.quality]));
      this.renderer.setSize(this.cssW, this.cssH, false);
      if (this.quality === QUALITY_STEPS.length - 1) {
        this.env.sun.shadow.mapSize.set(1024, 1024);
        this.env.sun.shadow.map?.dispose();
        this.env.sun.shadow.map = null as any;
      }
    }
  }

  /** One full frame: input → simulation → camera → render. Also used by tests via debugStep. */
  frame(dt: number) {
    if (window.innerWidth !== this.cssW || window.innerHeight !== this.cssH) this.resize();
    if (this.input.wasPressed('Escape') || this.input.wasPressed('KeyP')) {
      if (this.state === 'playing') this.pause();
      else if (this.state === 'paused') this.resume();
    }
    if (this.state === 'playing') this.step(dt);
    else if (this.state === 'menu') {
      this.rig.yaw += dt * 0.05;
      this.env.update(dt * 0.2, this.player.pos, this.camera);
      this.city.setNight(this.env.night);
      this.traffic.update(dt);
      for (const v of this.vehicles) v.update(dt, this.city, 1);
      this.peds.update(dt);
      this.rig.update(dt, this.input, this.player.pos, null, 0, this.city.collision);
    }
    this.renderer.render(this.scene, this.camera);
    this.input.endFrame();
  }

  private step(dt: number) {
    const p = this.player, input = this.input;
    this.playTime += dt;
    if (this.frozen > 0) this.frozen -= dt;
    const frozen = this.frozen > 0;
    this.hurtT += dt;
    this.invulnT -= dt;
    this.policeHitT -= dt;

    // --- respawn after wasted / busted
    if (this.respawnT > 0 && (this.respawnT -= dt) <= 0 && this.respawnAt) {
      this.resetPlayer(this.respawnAt.x, this.respawnAt.z);
      this.hud.setFade(false);
      this.hud.notify(`${this.respawnAt.label}から再出発`);
      this.respawnAt = null;
    }

    // --- interaction
    const near = p.vehicle ? null : this.nearestVehicle(p.pos.x, p.pos.z, 4.2);
    if (!frozen) {
      if (input.wasPressed('KeyE')) {
        if (p.vehicle) this.exitVehicle();
        else if (near) this.enterVehicle(near);
      }
      const act = input.wasPressed('KeyF') || (input.locked && input.wasPressed('Mouse0'));
      if (input.wasPressed('Digit1')) this.weapon = 'fist';
      if (input.wasPressed('Digit2')) {
        if (this.hasPistol) this.weapon = 'pistol';
        else this.hud.notify('ピストルを持っていない（オレンジの弾薬箱を探せ）', 'warn');
      }
      if (act && !p.vehicle) {
        if (this.missions.nearStart && input.wasPressed('KeyF')) this.missions.start(this.missions.nearStart);
        else if (this.weapon === 'pistol') this.shoot();
        else this.punch();
      }
      if (input.wasPressed('KeyM') && this.missions.active) this.missions.fail('ミッションを中止した');
      if (input.wasPressed('KeyH') && p.vehicle) {
        this.audio.horn(0);
        this.peds.scareAround(p.pos.x + Math.sin(p.heading) * 6, p.pos.z + Math.cos(p.heading) * 6, 7);
      }
      if (input.wasPressed('KeyR')) {
        this.audio.radioOn = !this.audio.radioOn;
        this.hud.notify(this.audio.radioOn ? '📻 ラジオ ON（運転中に再生）' : '📻 ラジオ OFF');
      }
      if (input.wasPressed('KeyT')) this.env.time = (this.env.time + 1) % 24;
      if (input.wasPressed('KeyY')) {
        this.env.setWeather(WEATHER_ORDER[(WEATHER_ORDER.indexOf(this.env.weather) + 1) % WEATHER_ORDER.length]);
        this.hud.notify(`天候: ${WEATHER_LABEL[this.env.weather]}`);
      }
    }

    // --- vehicles
    this.rig.forward(camFwd);
    const car = p.vehicle;
    if (car) {
      car.throttle = frozen ? 0 : input.axis('KeyS', 'KeyW');
      car.steer = frozen ? 0 : input.axis('KeyD', 'KeyA');
      car.handbrake = input.isDown('Space');
    }
    this.traffic.update(dt);
    const grip = this.env.grip;
    for (const v of this.vehicles) v.update(dt, this.city, grip);
    collideVehicles(this.vehicles, this.onVehicleHit);
    this.smokeT -= dt;
    const smokeNow = this.smokeT <= 0;
    if (smokeNow) this.smokeT = 0.08;
    for (const v of this.vehicles) {
      const dx = Math.abs(v.pos.x - p.pos.x), dz = Math.abs(v.pos.z - p.pos.z);
      v.mesh.visible = dx < 340 && dz < 340;
      if (v.impact > 0) {
        v.damage(v.impact);
        if (v.impact > 3 && dx < 90 && dz < 90) {
          this.audio.crash(v.impact, Math.hypot(dx, dz));
          this.effects.sparks(v.pos.x + Math.sin(v.heading) * 2, 0.7, v.pos.z + Math.cos(v.heading) * 2, Math.min(14, Math.round(v.impact)));
        }
        if (v === car) {
          this.rig.shake = Math.min(0.8, v.impact * 0.04);
          if (v.impact > 13) this.damagePlayer((v.impact - 13) * 1.6);
        }
        if (v.wrecked && v.driver === 'ai') v.driver = 'none';
      }
      if (smokeNow && v.health < 40 && dx < 120 && dz < 120)
        this.effects.smoke(v.pos.x + Math.sin(v.heading) * 1.6, 1, v.pos.z + Math.cos(v.heading) * 1.6, 1 - v.health / 40);
    }

    // --- characters
    p.update(dt, input, camFwd, this.city, frozen);
    if (!p.vehicle) this.pushPlayerFromVehicles();
    this.peds.update(dt);
    this.officers.update(dt);
    this.fireT -= dt;
    if (car && Math.abs(car.speed) > 14 && car.handbrake && Math.random() < 0.5) this.effects.dust(car.pos.x, car.pos.z);

    // --- systems
    this.wanted.update(dt);
    this.prompt = null;
    this.missions.update(dt);
    if (p.health <= 0 && !p.dead) this.wasted();
    if (!p.dead && this.hurtT > 8 && p.health < 100) p.health = Math.min(100, p.health + dt * 2.5);
    if ((this.autosaveT -= dt) <= 0) {
      this.autosaveT = 60;
      this.save();
    }

    // --- world, camera, audio
    this.env.update(dt, p.pos, this.camera);
    this.city.setNight(this.env.night);
    this.effects.update(dt);
    this.rig.update(dt, input, p.pos, car ? car.heading : null, car ? car.speed : p.speed, this.city.collision);
    this.updateHeadlight(car);
    let siren = Infinity;
    for (const v of this.traffic.police) if (v.driver === 'police') siren = Math.min(siren, Math.hypot(v.pos.x - p.pos.x, v.pos.z - p.pos.z));
    this.audio.update(!!car, car ? car.speed : 0, car ? car.throttle : 0, siren, this.env.rain);

    this.updateHud(near, car);
  }

  private updateHeadlight(car: Vehicle | null) {
    const h = this.headlight;
    h.intensity = car ? this.env.night * 220 : 0;
    if (!car || h.intensity < 1) return;
    const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
    h.position.set(car.pos.x + fx * 1.8, 1.1, car.pos.z + fz * 1.8);
    h.target.position.set(car.pos.x + fx * 24, 0, car.pos.z + fz * 24);
  }

  private updateHud(near: Vehicle | null, car: Vehicle | null) {
    const p = this.player, m = this.missions;
    if (this.frozen <= 0 && !this.prompt) {
      if (car) {
        if (Math.abs(car.speed) < 6) this.prompt = ['E', '降りる'];
      } else if (m.nearStart) this.prompt = ['F', `ミッション開始: ${m.nearStart.name}（報酬 $${m.nearStart.reward}）`];
      else if (near) this.prompt = ['E', near.driver === 'police' ? 'パトカー（ロック中）' : `${near.spec.name}に乗る${near.driver === 'ai' ? '（強奪）' : ''}`];
    }
    this.hud.setPrompt(this.prompt ? this.prompt[0] : null, this.prompt ? this.prompt[1] : '');
    const d = this.city.districtAt(p.pos.x, p.pos.z);
    this.hud.update({
      money: this.money,
      health: Math.round(p.health),
      wanted: this.wanted.level,
      wantedFlash: this.wanted.level > 0 && !this.wanted.seen,
      clock: this.env.clock,
      weather: WEATHER_LABEL[this.env.weather],
      district: d ? DISTRICT_NAMES[d] : 'ベラ海岸',
      speedKmh: car ? Math.round(Math.abs(car.speed) * 3.6) : null,
      carHealth: car ? Math.round(car.health) : 0,
      carName: car ? car.spec.name : '',
      objective: m.objectiveText,
      timer: m.active ? Math.ceil(m.active.timeLeft) : null,
      fps: this.fps,
      weapon: this.weapon === 'pistol' ? 'ピストル  ' + this.ammo + '発' : this.hasPistol ? '素手（2: ピストル）' : '素手',
      aim: this.weapon === 'pistol' && !car,
    });
    if (++this.mapTick % 2 === 0) {
      this.blips.length = 0;
      this.collectBlips(this.blips);
      this.hud.drawMinimap(p.pos.x, p.pos.z, p.heading, this.rig.yaw, this.blips, car ? 0.42 : 0.6);
    }
  }

  private collectBlips(out: Blip[]) {
    const p = this.player;
    const flash = Math.floor(this.playTime * 4) % 2 === 0;
    for (const v of this.vehicles) {
      if (v === p.vehicle) continue;
      if (v.driver === 'police') out.push({ x: v.pos.x, z: v.pos.z, color: flash ? '#ff3b3b' : '#3b7bff', shape: 'dot', size: 4.5, clampEdge: true });
      else if (Math.abs(v.pos.x - p.pos.x) < 160 && Math.abs(v.pos.z - p.pos.z) < 160)
        out.push({ x: v.pos.x, z: v.pos.z, color: v.driver === 'none' ? '#cfd6e0' : '#8fa0b5', shape: 'square', size: 2 });
    }
    for (const o of this.officers.list) if (!o.down) out.push({ x: o.pos.x, z: o.pos.z, color: '#3b7bff', shape: 'dot', size: 3.5 });
    this.missions.blips(out);
  }

  // ------------------------------------------------------------------ vehicles
  nearestVehicle(x: number, z: number, maxDist: number) {
    let best: Vehicle | null = null, bd = maxDist * maxDist;
    for (const v of this.vehicles) {
      const d = (v.pos.x - x) ** 2 + (v.pos.z - z) ** 2;
      if (d < bd) { bd = d; best = v; }
    }
    return best;
  }

  enterVehicle(v: Vehicle) {
    const p = this.player;
    if (v.driver === 'police') {
      this.hud.notify('パトカーはロックされている', 'warn');
      return;
    }
    if (v.driver === 'ai') {
      // carjacking: the driver is thrown out and runs
      const lx = Math.cos(v.heading), lz = -Math.sin(v.heading);
      this.peds.eject(v.pos.x + lx * 1.8, v.pos.z + lz * 1.8);
      this.wanted.crime(1, 2, '車両強盗');
      this.stats.carsStolen++;
      this.peds.scareAround(v.pos.x, v.pos.z, 12);
    }
    v.driver = 'player';
    p.vehicle = v;
    p.vel.set(0, 0, 0);
    p.syncMesh();
    this.audio.door();
  }

  exitVehicle(force = false) {
    const p = this.player, v = p.vehicle;
    if (!v || (!force && Math.abs(v.speed) > 6)) return;
    v.driver = 'none';
    v.throttle = 0;
    v.steer = 0;
    v.handbrake = false;
    p.vehicle = null;
    // step out on the driver's side (left); fall back to the right if a wall is there
    const lx = Math.cos(v.heading), lz = -Math.sin(v.heading);
    const off = v.spec.wid / 2 + 0.75;
    for (const s of [1, -1]) {
      const x = v.pos.x + lx * off * s, z = v.pos.z + lz * off * s;
      if (!this.city.collision.pointBlocked(x, 0.5, z, 0.4) || s === -1) {
        p.pos.set(x, this.city.groundHeight(x, z), z);
        break;
      }
    }
    p.vel.set(0, 0, 0);
    p.heading = v.heading;
    p.onGround = true;
    p.syncMesh();
    this.audio.door();
  }

  private onVehicleHit = (a: Vehicle, b: Vehicle, impact: number) => {
    const mine = this.player.vehicle;
    if (!mine || (a !== mine && b !== mine)) return;
    const other = a === mine ? b : a;
    if (other.driver === 'police') {
      if (impact > 6 && this.policeHitT <= 0) {
        this.policeHitT = 8;
        this.wanted.crime(2, 4, '警察車両への衝突');
      }
    } else if (other.driver === 'ai' && impact > 4) {
      this.traffic.panic(other);
      if (impact > 7) this.wanted.crime(1, 1, '当て逃げ');
    }
  };

  /** On foot: cars are solid; fast ones hurt. */
  private pushPlayerFromVehicles() {
    const p = this.player;
    for (const v of this.vehicles) {
      const dx = p.pos.x - v.pos.x, dz = p.pos.z - v.pos.z;
      if (dx * dx + dz * dz > 16 || p.pos.y > 1.6) continue;
      for (let i = 0; i < 2; i++) {
        v.circle(i, tmp);
        let nx = p.pos.x - tmp.x, nz = p.pos.z - tmp.z;
        const r = v.radius + 0.36;
        const d2 = nx * nx + nz * nz;
        if (d2 >= r * r || d2 < 1e-6) continue;
        const d = Math.sqrt(d2);
        nx /= d;
        nz /= d;
        p.pos.x += nx * (r - d);
        p.pos.z += nz * (r - d);
        const closing = v.vx * nx + v.vz * nz;
        if (closing > 4 && this.invulnT <= 0) {
          this.invulnT = 0.7;
          this.damagePlayer(closing * 2.4);
          p.vel.x += nx * closing * 0.9;
          p.vel.z += nz * closing * 0.9;
          p.vel.y = 3.5;
          p.onGround = false;
          this.rig.shake = 0.5;
          this.audio.punch();
        }
      }
    }
  }

  // ------------------------------------------------------------------ combat / consequences
  damagePlayer(amount: number) {
    const p = this.player;
    if (p.dead) return;
    p.health -= amount;
    this.hurtT = 0;
  }

  giveAmmo(n: number) {
    const first = !this.hasPistol;
    this.hasPistol = true;
    this.ammo += n;
    if (first) this.weapon = 'pistol';
    this.hud.notify(first ? 'ピストルを手に入れた（1: 素手 / 2: ピストル）' : '弾薬 +' + n, 'good');
  }

  /** Shared consequence of hurting a pedestrian with fists or bullets. */
  private hurtPed(ped: Ped, damage: number, nx: number, nz: number, gun: boolean) {
    ped.health -= damage;
    ped.pos.x += nx * 0.5;
    ped.pos.z += nz * 0.5;
    this.effects.sparkle(ped.pos.x, 1.4, ped.pos.z, 2, 1.6, 0.6, 5);
    this.peds.scareAround(ped.pos.x, ped.pos.z, gun ? 30 : 12);
    if (ped.health <= 0) {
      this.peds.knockDown(ped, nx * 4, nz * 4);
      const cash = Math.round(rand(10, 70));
      this.addMoney(cash);
      this.stats.knockouts++;
      this.hud.notify('通行人をノックアウト — +$' + cash, 'warn');
      this.wanted.crime(gun ? 2 : 1, gun ? 4 : 2, gun ? '銃撃' : '暴行');
    } else if (!gun && this.peds.provoke(ped)) this.hud.notify('相手が殴り返してきた！', 'warn');
    else this.wanted.crime(1, gun ? 3 : 1, gun ? '銃撃' : '暴行');
  }

  onOfficerDown(reason: string) {
    this.stats.knockouts++;
    this.giveAmmo(12);
    this.wanted.crime(3, 5, reason);
  }

  private punch() {
    const p = this.player;
    if (p.char.punchT > 0) return;
    p.char.punchT = 0.3;
    this.audio.punch();
    const nx = Math.sin(p.heading), nz = Math.cos(p.heading);
    const cop = this.officers.findInFront(p.pos.x, p.pos.z, p.heading, 1.8);
    if (cop) {
      this.effects.sparkle(cop.pos.x, 1.4, cop.pos.z, 2, 1.6, 0.6, 5);
      if (this.officers.hurt(cop, 34, nx, nz)) this.onOfficerDown('警官への暴行');
      else this.wanted.crime(2, 3, '警官への暴行');
      return;
    }
    const ped = this.peds.findInFront(p.pos.x, p.pos.z, p.heading, 1.8);
    if (ped) this.hurtPed(ped, 34, nx, nz, false);
  }

  /** Pistol: hitscan along the camera direction with a little aim assist. */
  private shoot() {
    const p = this.player;
    if (this.fireT > 0) return;
    if (this.ammo <= 0) {
      this.fireT = 0.4;
      this.audio.blip(140, 0.05, 'square');
      this.hud.notify('弾切れ（オレンジの弾薬箱で補給）', 'warn');
      return;
    }
    this.fireT = 0.3;
    this.ammo--;
    this.rig.forward(camFwd);
    const fx = camFwd.x, fz = camFwd.z;
    p.heading = Math.atan2(fx, fz);
    p.char.punchT = 0.25;
    const ox = p.pos.x, oz = p.pos.z;
    const RANGE = 55;
    // nearest thing inside a narrow cone: officers, pedestrians, vehicles
    let best = RANGE, kind = 0, target: any = null;
    const test = (x: number, z: number, radius: number, k: number, obj: any) => {
      const dx = x - ox, dz = z - oz;
      const along = dx * fx + dz * fz;
      if (along < 0.5 || along >= best) return;
      if (Math.abs(dx * fz - dz * fx) > radius + along * 0.05) return;
      best = along;
      kind = k;
      target = obj;
    };
    for (const o of this.officers.list) if (!o.down) test(o.pos.x, o.pos.z, 0.5, 1, o);
    for (const q of this.peds.list) if (q.state !== 'down') test(q.pos.x, q.pos.z, 0.5, 2, q);
    for (const v of this.vehicles) test(v.pos.x, v.pos.z, 1.4, 3, v);
    // walls stop bullets
    let reach = best;
    for (let d = 1.5; d < best; d += 1.5)
      if (this.city.collision.pointBlocked(ox + fx * d, 1.3, oz + fz * d)) {
        reach = d;
        target = null;
        break;
      }
    this.effects.tracer(ox + fx * 0.6, 1.35, oz + fz * 0.6, ox + fx * reach, 1.2, oz + fz * reach);
    this.audio.shot(0);
    this.rig.shake = 0.12;
    this.peds.scareAround(ox, oz, 28);
    if (!target) {
      if (this.peds.list.some((q) => Math.abs(q.pos.x - ox) < 35 && Math.abs(q.pos.z - oz) < 35)) this.wanted.crime(1, 2, '発砲');
      return;
    }
    if (kind === 1) {
      if (this.officers.hurt(target, 50, fx, fz)) this.onOfficerDown('警官を銃撃');
      else this.wanted.crime(3, 4, '警官を銃撃');
    } else if (kind === 2) this.hurtPed(target, 60, fx, fz, true);
    else {
      const v = target as Vehicle;
      v.health = Math.max(0, v.health - 8);
      if (v.driver === 'police') this.wanted.crime(2, 4, 'パトカーを銃撃');
      else if (v.driver === 'ai') {
        this.traffic.panic(v);
        this.wanted.crime(1, 3, '車両を銃撃');
      }
    }
  }

  onPedRunOver(_ped: Ped, v: Vehicle, closing: number) {
    const p = this.player;
    this.audio.crash(closing * 0.8, Math.hypot(v.pos.x - p.pos.x, v.pos.z - p.pos.z));
    if (v.driver !== 'player') return;
    this.stats.knockouts++;
    this.peds.scareAround(v.pos.x, v.pos.z, 18);
    this.wanted.crime(1, 3, 'ひき逃げ');
  }

  private takeDown(title: string, color: string, sub: string, at: { x: number; z: number; label: string }, penalty: number) {
    const p = this.player;
    this.missions.fail(title === 'BUSTED' ? '逮捕された' : '力尽きた');
    if (p.vehicle) this.exitVehicle(true);
    p.dead = true;
    p.group.rotation.x = -Math.PI / 2;
    this.frozen = 4.2;
    this.respawnT = 4;
    this.respawnAt = at;
    const lost = Math.floor(this.money * penalty);
    this.addMoney(-lost);
    this.hud.banner(title, `${sub}${lost > 0 ? ` — -$${lost.toLocaleString('en-US')}` : ''}`, color, 3800);
    this.hud.setFade(true);
    this.audio.fail();
    this.wanted.clear(true);
  }
  wasted() {
    this.stats.wasted++;
    const c = this.city.blockCorner(3, 5, 1);
    this.takeDown('WASTED', '#ff5a5a', '病院に搬送された', { ...c, label: 'ベラ総合病院' }, 0.1);
  }
  busted() {
    this.stats.busted++;
    const c = this.city.blockCorner(8, 6, 0);
    this.takeDown('BUSTED', '#5aa0ff', '逮捕された', { ...c, label: '中央警察署' }, 0.15);
  }

  // ------------------------------------------------------------------ test hooks
  /** Advance the simulation deterministically (used by automated browser checks). */
  debugStep(frames: number, dt = 1 / 60) {
    for (let i = 0; i < frames; i++) this.frame(dt);
  }
}
