import * as THREE from 'three';
import { Input } from './core/Input';
import { CameraRig } from './core/CameraRig';
import { GameAudio } from './core/Audio';
import { City, DISTRICT_NAMES } from './world/City';
import { Environment, WEATHER_LABEL, Weather } from './world/Environment';
import { Effects } from './world/Effects';
import { Player } from './entities/Player';
import { Vehicle, VehicleKind, collideVehicles } from './entities/Vehicle';
import { Helicopter } from './entities/Helicopter';
import { mergeBoxes, vertexColorMaterial } from './core/geo';
import { Traffic } from './ai/Traffic';
import { Pedestrians, Ped } from './ai/Pedestrians';
import { Officers } from './ai/Officers';
import { Wanted } from './systems/Wanted';
import { Missions } from './systems/Missions';
import { Save } from './systems/Save';
import { Hud, Blip } from './ui/Hud';
import { N, BLOCK, PITCH, PARK_OFFSET, WORLD_BOUND, roadCoord, mulberry32, rand, clamp } from './config';

export type GameState = 'menu' | 'playing' | 'paused';
const camFwd = { x: 0, z: 0 };
const tmp = { x: 0, z: 0 };
const WEATHER_ORDER: Weather[] = ['clear', 'cloudy', 'rain', 'fog'];
const QUALITY_STEPS = [1.5, 1.25, 1, 0.8];

export type Weapon = 'fist' | 'pistol' | 'ak47' | 'rocket';
const WEAPON_KEYS: Weapon[] = ['fist', 'pistol', 'ak47', 'rocket'];
const WEAPON_NAME: Record<Weapon, string> = { fist: '素手', pistol: 'ピストル', ak47: 'AK-47', rocket: 'ロケットランチャー' };
/** Bullet weapons: seconds between shots, damage to pedestrians / officers / vehicles, spread (radians), full-auto. */
const GUNS = {
  pistol: { interval: 0.3, ped: 60, cop: 50, veh: 8, spread: 0, auto: false, shake: 0.12 },
  ak47: { interval: 0.1, ped: 40, cop: 34, veh: 6, spread: 0.03, auto: true, shake: 0.08 },
};
const ROCKET_SPEED = 46, BLAST_RADIUS = 9;
const rocketGeo = new THREE.BoxGeometry(0.16, 0.16, 0.9);
const rocketMat = new THREE.MeshStandardMaterial({ color: 0x4b5a34, emissive: 0xff7a2a, emissiveIntensity: 0.6 });
// weapon models hang from the right hand: the arm's local -Y axis points forward while aiming
const PROPS: Record<Exclude<Weapon, 'fist'>, THREE.BufferGeometry> = {
  pistol: mergeBoxes([
    { size: [0.07, 0.3, 0.1], pos: [0, -0.74, 0.04], color: 0x1c1c1f },
    { size: [0.07, 0.1, 0.16], pos: [0, -0.62, -0.04], color: 0x1c1c1f },
  ]),
  ak47: mergeBoxes([
    { size: [0.07, 0.9, 0.1], pos: [0, -0.92, 0.05], color: 0x232326 },
    { size: [0.08, 0.34, 0.15], pos: [0, -0.5, 0.05], color: 0x7a4a22 },
    { size: [0.08, 0.26, 0.12], pos: [0, -1.0, 0.05], color: 0x7a4a22 },
    { size: [0.06, 0.12, 0.3], pos: [0, -0.8, -0.14], color: 0x232326 },
  ]),
  rocket: mergeBoxes([
    { size: [0.17, 1.25, 0.17], pos: [0, -0.62, 0.16], color: 0x4b5a34 },
    { size: [0.22, 0.2, 0.22], pos: [0, -1.3, 0.16], color: 0x2a2c2a },
    { size: [0.2, 0.12, 0.2], pos: [0, 0.04, 0.16], color: 0x2a2c2a },
    { size: [0.07, 0.12, 0.2], pos: [0, -0.66, -0.02], color: 0x1c1c1f },
  ]),
};

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
  weapon: Weapon = 'pistol'; // the player starts armed
  readonly ammoBy = { pistol: 36, ak47: 90, rocket: 6 };
  readonly helis: Helicopter[] = [];
  heli: Helicopter | null = null; // the one being flown
  private nearHeli: Helicopter | null = null;
  private rockets: { mesh: THREE.Mesh; vx: number; vz: number; life: number }[] = [];
  private shownProp = '';
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
    // helicopters: one in the park south of downtown, two on the beaches
    for (const home of [{ x: 24, z: 252, heading: Math.PI }, { x: 30, z: 492, heading: Math.PI / 2 }, { x: 492, z: -30, heading: 0 }]) {
      const h = new Helicopter(home);
      this.helis.push(h);
      this.scene.add(h.group);
    }

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
    const kinds: VehicleKind[] = ['prius', 'prius', 'prius', 'alphard', 'alphard', 'taxi'];
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
    // emergency vehicles: an ambulance outside the hospital, a fire engine one block east of the spawn
    const specials: [VehicleKind, number, number][] = [
      ['ambulance', roadCoord(4) - PARK_OFFSET, roadCoord(5) + 24],
      ['firetruck', roadCoord(7) - PARK_OFFSET - 0.2, roadCoord(6) + 34],
    ];
    for (const [kind, x, z] of specials) {
      for (const v of this.vehicles.filter((o) => Math.abs(o.pos.x - x) < 4 && Math.abs(o.pos.z - z) < 11)) this.removeVehicle(v);
      this.addVehicle(kind, x, z, 0);
    }
    // a guaranteed starter car next to the spawn point
    this.addVehicle('prius', roadCoord(6) + PARK_OFFSET, roadCoord(6) + 26, Math.PI, 0xd9dde2);
  }

  resetPlayer(x?: number, z?: number, heading = Math.PI) {
    const c = this.city.blockCorner(6, 6, 0);
    const p = this.player;
    if (this.heli) this.leaveHeli();
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
      ammo: this.ammoBy.pistol,
      ammoAk: this.ammoBy.ak47,
      ammoRocket: this.ammoBy.rocket,
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
    // saves from before a weapon existed get its starting load
    this.ammoBy.pistol = d.ammo ?? 36;
    this.ammoBy.ak47 = d.ammoAk ?? 90;
    this.ammoBy.rocket = d.ammoRocket ?? 6;
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
    const near = p.vehicle || this.heli ? null : this.nearestVehicle(p.pos.x, p.pos.z, 4.2);
    this.nearHeli = null;
    if (!p.vehicle && !this.heli)
      for (const h of this.helis) if (!h.destroyed && h.pos.distanceToSquared(p.pos) < 22) this.nearHeli = h;
    if (!frozen) {
      if (input.wasPressed('KeyE')) {
        if (this.heli) this.exitHeli();
        else if (p.vehicle) this.exitVehicle();
        else if (this.nearHeli) this.enterHeli(this.nearHeli);
        else if (near) this.enterVehicle(near);
      }
      const act = input.wasPressed('KeyF') || (input.locked && input.wasPressed('Mouse0'));
      const held = input.isDown('KeyF') || (input.locked && input.isDown('Mouse0'));
      for (let k = 0; k < WEAPON_KEYS.length; k++) if (input.wasPressed('Digit' + (k + 1))) this.weapon = WEAPON_KEYS[k];
      if (!p.vehicle && !this.heli) {
        if (act && this.missions.nearStart && input.wasPressed('KeyF')) {
          this.missions.start(this.missions.nearStart);
          this.fireT = 0.6; // the same key press must not also fire
        } else if (this.weapon === 'fist') {
          if (act) this.punch();
        } else if (this.weapon === 'rocket') {
          if (act) this.fireRocket();
        } else if (act || (held && GUNS[this.weapon].auto)) this.shoot();
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
    this.updateHelis(dt, frozen, smokeNow);
    this.updateRockets(dt);
    p.update(dt, input, camFwd, this.city, frozen);
    if (this.heli) {
      p.pos.copy(this.heli.pos);
      p.heading = this.heli.heading;
    }
    if (!p.vehicle && !this.heli) this.pushPlayerFromVehicles();
    this.syncProp();
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
    const ride = this.heli;
    this.rig.update(dt, input, p.pos, car ? car.heading : ride ? ride.heading : null, car ? car.speed : ride ? ride.airspeed : p.speed, this.city.collision);
    this.updateHeadlight(car);
    let siren = Infinity;
    for (const v of this.traffic.police) if (v.driver === 'police') siren = Math.min(siren, Math.hypot(v.pos.x - p.pos.x, v.pos.z - p.pos.z));
    this.audio.update(!!car || !!ride, car ? car.speed : ride ? ride.spin * (16 + ride.airspeed * 0.4) : 0, car ? car.throttle : ride ? ride.spin : 0, siren, this.env.rain);

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
      if (this.heli) {
        if (this.heli.pos.y < 0.6 && this.heli.airspeed < 3) this.prompt = ['E', 'ヘリから降りる'];
      } else if (this.nearHeli) this.prompt = ['E', 'ヘリコプターに乗る'];
      else if (car) {
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
      speedKmh: car ? Math.round(Math.abs(car.speed) * 3.6) : this.heli ? Math.round(this.heli.airspeed * 3.6) : null,
      carHealth: car ? Math.round(car.health) : this.heli ? Math.round(this.heli.health) : 0,
      carName: car ? car.spec.name : this.heli ? 'ヘリコプター  高度 ' + Math.round(this.heli.pos.y) + 'm' : '',
      objective: m.objectiveText,
      timer: m.active ? Math.ceil(m.active.timeLeft) : null,
      fps: this.fps,
      weapon: this.weapon === 'fist' ? '素手' : WEAPON_NAME[this.weapon] + '  ' + this.ammoBy[this.weapon] + '発',
      aim: this.weapon !== 'fist' && !car && !this.heli,
    });
    if (++this.mapTick % 2 === 0) {
      this.blips.length = 0;
      this.collectBlips(this.blips);
      this.hud.drawMinimap(p.pos.x, p.pos.z, p.heading, this.rig.yaw, this.blips, this.heli ? 0.3 : car ? 0.42 : 0.6);
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
    for (const h of this.helis) if (!h.destroyed && h !== this.heli) out.push({ x: h.pos.x, z: h.pos.z, color: '#ffffff', shape: 'diamond', size: 4, clampEdge: true });
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
    this.ammoBy.pistol += n;
    this.ammoBy.ak47 += n * 2;
    if (n >= 24) this.ammoBy.rocket += 2;
    this.hud.notify(n >= 24 ? '弾薬を補給した（ピストル・AK-47・ロケット）' : '弾薬を拾った', 'good');
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

  private dryFire() {
    this.fireT = 0.4;
    this.audio.blip(140, 0.05, 'square');
    this.hud.notify('弾切れ（オレンジの弾薬箱で補給）', 'warn');
  }

  /** Show the equipped weapon in the player's hand. */
  private syncProp() {
    const key = this.player.vehicle || this.heli ? 'fist' : this.weapon;
    if (key === this.shownProp) return;
    this.shownProp = key;
    this.player.char.setProp(key === 'fist' ? null : new THREE.Mesh(PROPS[key], vertexColorMaterial));
  }

  /** Pistol / AK-47: hitscan along the camera direction with a little aim assist. */
  private shoot() {
    const p = this.player;
    if (this.fireT > 0 || this.weapon === 'fist' || this.weapon === 'rocket') return;
    const gun = GUNS[this.weapon];
    if (this.ammoBy[this.weapon] <= 0) return this.dryFire();
    this.fireT = gun.interval;
    this.ammoBy[this.weapon]--;
    this.rig.forward(camFwd);
    const aim = Math.atan2(camFwd.x, camFwd.z);
    const ang = aim + (Math.random() - 0.5) * 2 * gun.spread;
    const fx = Math.sin(ang), fz = Math.cos(ang);
    p.heading = aim;
    const ox = p.pos.x, oz = p.pos.z;
    const RANGE = 60;
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
    this.effects.tracer(ox + fx * 0.9, 1.35, oz + fz * 0.9, ox + fx * reach, 1.2, oz + fz * reach);
    this.audio.shot(0);
    this.rig.shake = Math.max(this.rig.shake, gun.shake);
    this.peds.scareAround(ox, oz, 28);
    if (!target) {
      if (this.peds.list.some((q) => Math.abs(q.pos.x - ox) < 35 && Math.abs(q.pos.z - oz) < 35)) this.wanted.crime(1, 2, '発砲');
      return;
    }
    if (kind === 1) {
      if (this.officers.hurt(target, gun.cop, fx, fz)) this.onOfficerDown('警官を銃撃');
      else this.wanted.crime(3, 4, '警官を銃撃');
    } else if (kind === 2) this.hurtPed(target, gun.ped, fx, fz, true);
    else {
      const v = target as Vehicle;
      v.health = Math.max(0, v.health - gun.veh);
      if (v.driver === 'police') this.wanted.crime(2, 4, 'パトカーを銃撃');
      else if (v.driver === 'ai') {
        this.traffic.panic(v);
        this.wanted.crime(1, 3, '車両を銃撃');
      }
    }
  }

  // ------------------------------------------------------------------ rockets / explosions
  private fireRocket() {
    const p = this.player;
    if (this.fireT > 0) return;
    if (this.ammoBy.rocket <= 0) return this.dryFire();
    this.fireT = 1.1;
    this.ammoBy.rocket--;
    this.rig.forward(camFwd);
    p.heading = Math.atan2(camFwd.x, camFwd.z);
    const mesh = new THREE.Mesh(rocketGeo, rocketMat);
    mesh.position.set(p.pos.x + camFwd.x * 1.2, p.pos.y + 1.4, p.pos.z + camFwd.z * 1.2);
    mesh.rotation.y = p.heading;
    this.scene.add(mesh);
    this.rockets.push({ mesh, vx: camFwd.x * ROCKET_SPEED, vz: camFwd.z * ROCKET_SPEED, life: 2.6 });
    this.audio.rocket();
    this.rig.shake = 0.3;
    this.peds.scareAround(p.pos.x, p.pos.z, 20);
  }

  private updateRockets(dt: number) {
    for (let k = this.rockets.length - 1; k >= 0; k--) {
      const r = this.rockets[k], m = r.mesh.position;
      m.x += r.vx * dt;
      m.z += r.vz * dt;
      r.life -= dt;
      this.effects.smoke(m.x, m.y, m.z, 0.3);
      let hit = r.life <= 0 || this.city.collision.pointBlocked(m.x, m.y, m.z) || Math.abs(m.x) > WORLD_BOUND + 60 || Math.abs(m.z) > WORLD_BOUND + 60;
      if (!hit) for (const v of this.vehicles) if ((v.pos.x - m.x) ** 2 + (v.pos.z - m.z) ** 2 < (v.radius + 1.1) ** 2) { hit = true; break; }
      if (!hit) for (const q of this.peds.list) if (q.state !== 'down' && (q.pos.x - m.x) ** 2 + (q.pos.z - m.z) ** 2 < 1) { hit = true; break; }
      if (!hit) for (const o of this.officers.list) if (!o.down && (o.pos.x - m.x) ** 2 + (o.pos.z - m.z) ** 2 < 1) { hit = true; break; }
      if (!hit) for (const h of this.helis) if (!h.destroyed && h !== this.heli && h.pos.distanceToSquared(m) < 12) { hit = true; break; }
      if (!hit) continue;
      this.scene.remove(r.mesh);
      this.rockets.splice(k, 1);
      this.explode(m.x, m.y, m.z);
    }
  }

  /** Blast: wrecks and throws vehicles, knocks people down, hurts the player if close. */
  explode(x: number, y: number, z: number) {
    const p = this.player, R = BLAST_RADIUS;
    const dist = Math.hypot(p.pos.x - x, p.pos.z - z);
    this.effects.explosion(x, y, z);
    this.audio.boom(dist);
    this.rig.shake = Math.max(this.rig.shake, clamp(1.3 - dist / 35, 0, 1.3));
    for (const v of this.vehicles) {
      const dx = v.pos.x - x, dz = v.pos.z - z, d = Math.hypot(dx, dz);
      if (d >= R) continue;
      const f = 1 - d / R, inv = d > 0.01 ? 1 / d : 0;
      v.health = Math.max(0, v.health - 140 * f);
      v.vx += dx * inv * 16 * f;
      v.vz += dz * inv * 16 * f;
      if (v.driver === 'ai') {
        if (v.wrecked) v.driver = 'none';
        else this.traffic.panic(v);
      }
    }
    let knocked = 0, cops = 0;
    for (const q of this.peds.list) {
      const dx = q.pos.x - x, dz = q.pos.z - z, d = Math.hypot(dx, dz);
      if (q.state === 'down' || d >= R - 1) continue;
      const inv = d > 0.01 ? 1 / d : 0;
      this.peds.knockDown(q, dx * inv * 9, dz * inv * 9);
      knocked++;
    }
    for (const o of this.officers.list) {
      const dx = o.pos.x - x, dz = o.pos.z - z, d = Math.hypot(dx, dz);
      if (o.down || d >= R - 1) continue;
      const inv = d > 0.01 ? 1 / d : 0;
      if (this.officers.hurt(o, 300, dx * inv, dz * inv)) cops++;
    }
    for (const h of this.helis) {
      const d = Math.hypot(h.pos.x - x, h.pos.y - y, h.pos.z - z);
      if (!h.destroyed && d < R) h.health = Math.max(0, h.health - 260 * (1 - d / R)); // a direct hit brings it down
    }
    if (!p.inHeli && !p.dead && dist < R && Math.abs(p.pos.y - y) < 6) {
      const f = 1 - dist / R, inv = dist > 0.01 ? 1 / dist : 0;
      this.damagePlayer((p.vehicle ? 40 : 90) * f);
      if (!p.vehicle) {
        p.vel.x += (p.pos.x - x) * inv * 10 * f;
        p.vel.z += (p.pos.z - z) * inv * 10 * f;
        p.vel.y = 5;
        p.onGround = false;
      }
    }
    this.peds.scareAround(x, z, 45);
    this.stats.knockouts += knocked;
    if (cops) this.onOfficerDown('警官を爆破');
    else this.wanted.crime(knocked ? 3 : 2, 5, '爆破');
  }

  // ------------------------------------------------------------------ helicopters
  private updateHelis(dt: number, frozen: boolean, smokeNow: boolean) {
    const p = this.player;
    for (const h of this.helis) {
      if (h.destroyed) {
        if ((h.respawnT -= dt) <= 0) h.reset();
        continue;
      }
      h.update(dt, h === this.heli && !frozen ? this.input : null, this.city);
      if (h.impact > 4) {
        this.audio.crash(h.impact, h.pos.distanceTo(p.pos));
        if (h === this.heli) this.rig.shake = 0.5;
      }
      if (smokeNow && h.health < 40) this.effects.smoke(h.pos.x, h.pos.y + 2, h.pos.z, 1 - h.health / 40);
      // a dead helicopter falls; it blows up when it reaches the ground
      if (h.health <= 0 && h.altitude(this.city) < 0.3) {
        const mine = h === this.heli;
        h.destroyed = true;
        h.respawnT = 30;
        h.group.visible = false;
        this.explode(h.pos.x, h.pos.y + 1, h.pos.z);
        if (mine) {
          this.leaveHeli();
          this.damagePlayer(70);
        }
      }
    }
  }

  enterHeli(h: Helicopter) {
    const p = this.player;
    this.heli = h;
    h.piloted = true;
    p.inHeli = true;
    p.vel.set(0, 0, 0);
    p.syncMesh();
    this.audio.door();
    this.hud.notify('🚁 <b>Space</b> 上昇 / <b>Shift</b> 下降 / <b>W A S D</b> 飛行。着陸して <b>E</b> で降りる。');
  }

  /** Normal exit: only when landed at street level. */
  exitHeli() {
    const h = this.heli;
    if (!h) return;
    if (h.pos.y > 0.6) return this.hud.notify(h.altitude(this.city) < 0.3 ? '屋上では降りられない。地上に着陸しよう' : '着陸してから降りよう', 'warn');
    if (h.airspeed > 3) return this.hud.notify('止まってから降りよう', 'warn');
    if (Math.abs(h.pos.x) > WORLD_BOUND - 2 || Math.abs(h.pos.z) > WORLD_BOUND - 2) return this.hud.notify('海の上では降りられない', 'warn');
    this.leaveHeli();
    this.audio.door();
  }

  /** Put the player back on their feet beside the helicopter (also used when it is destroyed). */
  private leaveHeli() {
    const h = this.heli, p = this.player;
    if (!h) return;
    h.piloted = false;
    this.heli = null;
    p.inHeli = false;
    const lx = Math.cos(h.heading), lz = -Math.sin(h.heading);
    for (const s of [1, -1]) {
      const x = clamp(h.pos.x + lx * 2.4 * s, -WORLD_BOUND, WORLD_BOUND), z = clamp(h.pos.z + lz * 2.4 * s, -WORLD_BOUND, WORLD_BOUND);
      if (!this.city.collision.pointBlocked(x, h.pos.y + 0.5, z, 0.4) || s === -1) {
        p.pos.set(x, Math.max(h.pos.y, this.city.groundHeight(x, z)), z);
        break;
      }
    }
    p.vel.set(0, 0, 0);
    p.heading = h.heading;
    p.syncMesh();
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
    if (this.heli) this.leaveHeli();
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
