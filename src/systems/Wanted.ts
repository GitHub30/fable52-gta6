import type { Game } from '../Game';

/** Wanted level: crimes raise stars, police units are dispatched, hiding long enough clears it. */
export class Wanted {
  level = 0;
  hiddenT = 0; // seconds without police contact
  private bustT = 0;
  private dispatchT = 0;
  seen = false;

  constructor(private game: Game) {}

  /** Raise to at least `min`, or add one star if already there (up to `cap`). */
  crime(min: number, cap = 5, reason = '') {
    const before = this.level;
    if (this.level < min) this.level = min;
    else if (this.level < cap) this.level++;
    this.hiddenT = 0;
    if (this.level > before) {
      this.game.hud.notify(`手配度 ★${this.level}${reason ? ' — ' + reason : ''}`, 'warn');
      this.game.audio.blip(220, 0.25, 'sawtooth');
    }
  }
  set(level: number) {
    this.level = level;
    this.hiddenT = 0;
  }
  clear(silent = false) {
    if (this.level === 0) return;
    this.level = 0;
    this.hiddenT = 0;
    this.bustT = 0;
    this.game.traffic.standDown();
    if (!silent) {
      this.game.hud.notify('警察を振り切った！', 'good');
      this.game.audio.blip(660, 0.2, 'triangle');
    }
  }
  get evadeTime() {
    return 10 + this.level * 4;
  }

  update(dt: number) {
    const g = this.game, p = g.player;
    if (this.level === 0) {
      this.seen = false;
      return;
    }
    const police = g.traffic.police;
    // dispatch units up to the wanted level
    let active = 0;
    for (const v of police) if (v.driver === 'police') active++;
    if ((this.dispatchT -= dt) <= 0 && active < this.level && police.length < 8) {
      this.dispatchT = 2.5;
      g.traffic.spawnPolice();
    }

    let nearest = Infinity, slowNear = false;
    for (const v of police) {
      if (v.driver !== 'police') continue;
      const d = Math.hypot(v.pos.x - p.pos.x, v.pos.z - p.pos.z);
      if (d < nearest) nearest = d;
      if (d < 7.5 && Math.abs(v.speed) < 4) slowNear = true;
    }
    this.seen = nearest < 95 || g.officers.nearest() < 70;
    if (this.seen) this.hiddenT = 0;
    else {
      this.hiddenT += dt;
      if (this.hiddenT > this.evadeTime) this.clear();
    }

    // busted: boxed in by a patrol car while (nearly) stationary
    const mySpeed = p.vehicle ? Math.abs(p.vehicle.speed) : p.speed;
    if (slowNear && mySpeed < 2.2 && !p.dead && !p.inHeli) {
      this.bustT += dt;
      if (this.bustT > 2.6) {
        this.bustT = 0;
        g.busted();
      }
    } else this.bustT = Math.max(0, this.bustT - dt);
  }
}
