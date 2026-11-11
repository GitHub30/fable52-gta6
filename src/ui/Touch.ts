import { Input } from '../core/Input';

export type TouchMode = 'foot' | 'car' | 'air';

const LOOK = 2.4; // one pixel of drag counts as this many pixels of mouse movement
const RADIUS = 56; // stick travel in CSS pixels

interface Button {
  el: HTMLElement;
  code: string | null; // key held while the button is down
  label: Partial<Record<TouchMode, string>>; // text per mode; a missing mode hides the button
}

/**
 * On-screen controls for touch devices: a floating stick on the left half, drag-to-look on the
 * right half and action buttons whose meaning follows what the player is doing. They feed the same
 * Input the keyboard does, so nothing else in the game knows about touch.
 * Dormant until the first touch (or on a device whose primary pointer is coarse).
 */
export class TouchControls {
  private root = document.createElement('div');
  private base = document.createElement('div');
  private knob = document.createElement('div');
  private buttons: Button[] = [];
  private mode: TouchMode | '' = '';
  private stickId = -1;
  private ox = 0;
  private oy = 0;
  private running = false;
  enabled = false;

  constructor(private host: HTMLElement, private input: Input, actions: { weapon: () => void }) {
    this.root.className = 'touch hidden';
    const move = this.zone('t-move'), look = this.zone('t-look');
    this.base.className = 't-base hidden';
    this.knob.className = 't-knob';
    this.base.append(this.knob);
    this.root.append(move, look, this.base);

    // ---- stick: appears where the thumb lands
    move.addEventListener('pointerdown', (e) => {
      if (this.stickId >= 0) return;
      this.stickId = e.pointerId;
      move.setPointerCapture(e.pointerId);
      this.ox = e.clientX;
      this.oy = e.clientY;
      this.base.style.left = e.clientX + 'px';
      this.base.style.top = e.clientY + 'px';
      this.base.classList.remove('hidden');
      this.stick(0, 0);
    });
    move.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.stickId) return;
      let dx = e.clientX - this.ox, dy = e.clientY - this.oy;
      const d = Math.hypot(dx, dy);
      if (d > RADIUS) {
        dx *= RADIUS / d;
        dy *= RADIUS / d;
      }
      this.stick(dx / RADIUS, -dy / RADIUS);
    });
    const release = (e: PointerEvent) => {
      if (e.pointerId !== this.stickId) return;
      this.stickId = -1;
      this.base.classList.add('hidden');
      this.stick(0, 0);
    };
    move.addEventListener('pointerup', release);
    move.addEventListener('pointercancel', release);

    // ---- look: every finger on the right half turns the camera
    const last = new Map<number, [number, number]>();
    look.addEventListener('pointerdown', (e) => {
      look.setPointerCapture(e.pointerId);
      last.set(e.pointerId, [e.clientX, e.clientY]);
    });
    look.addEventListener('pointermove', (e) => {
      const p = last.get(e.pointerId);
      if (!p) return;
      input.look((e.clientX - p[0]) * LOOK, (e.clientY - p[1]) * LOOK);
      p[0] = e.clientX;
      p[1] = e.clientY;
    });
    const drop = (e: PointerEvent) => last.delete(e.pointerId);
    look.addEventListener('pointerup', drop);
    look.addEventListener('pointercancel', drop);

    // ---- buttons
    this.button('t-fire', 'KeyF', { foot: '攻撃', car: '発砲' });
    this.button('t-a', 'Space', { foot: 'ジャンプ', car: 'ブレーキ', air: '▲ 上昇' });
    this.button('t-b', 'ShiftLeft', { air: '▼ 下降' });
    this.button('t-use', 'KeyE', { foot: '乗る', car: '降りる', air: '降りる' });
    this.button('t-weapon', null, { foot: '武器' }, actions.weapon);
    this.button('t-horn', 'KeyH', { car: '♪' });
    this.button('t-pause', 'Escape', { foot: 'Ⅱ', car: 'Ⅱ', air: 'Ⅱ' });
    host.append(this.root);

    const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    if (coarse) this.enable();
    else window.addEventListener('touchstart', () => this.enable(), { once: true, passive: true });
  }

  private zone(cls: string) {
    const z = document.createElement('div');
    z.className = cls;
    return z;
  }

  private button(cls: string, code: string | null, label: Button['label'], tap?: () => void) {
    const el = document.createElement('button');
    el.className = 't-btn ' + cls;
    const hold = (down: boolean) => {
      el.classList.toggle('on', down);
      if (code) this.input.setKey(code, down);
    };
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      hold(true);
      tap?.();
    });
    el.addEventListener('pointerup', () => hold(false));
    el.addEventListener('pointercancel', () => hold(false));
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    this.buttons.push({ el, code, label });
    this.root.append(el);
  }

  private stick(x: number, y: number) {
    this.input.stickX = x;
    this.input.stickY = y;
    this.knob.style.transform = `translate(${x * RADIUS}px, ${-y * RADIUS}px)`;
    // on foot a full push runs; in vehicles Shift means something else and has its own button
    const run = this.mode === 'foot' && Math.hypot(x, y) > 0.82;
    if (run !== this.running) {
      this.running = run;
      this.input.setKey('ShiftLeft', run);
    }
  }

  private enable() {
    if (this.enabled) return;
    this.enabled = true;
    this.host.classList.add('touch-on');
  }

  /** Called every frame: shows the controls while playing and relabels the buttons for the current mode. */
  update(mode: TouchMode, playing: boolean) {
    if (!this.enabled) return;
    const show = playing ? mode : '';
    if (show === this.mode) return;
    if (this.running) {
      this.running = false;
      this.input.setKey('ShiftLeft', false);
    }
    this.mode = show;
    this.root.classList.toggle('hidden', !playing);
    if (!playing) {
      // nothing may stay held behind a menu
      this.stickId = -1;
      this.base.classList.add('hidden');
      this.input.stickX = this.input.stickY = 0;
      for (const b of this.buttons) {
        b.el.classList.remove('on');
        if (b.code) this.input.setKey(b.code, false);
      }
      return;
    }
    for (const b of this.buttons) {
      const text = b.label[mode];
      b.el.classList.toggle('hidden', !text);
      if (text) b.el.textContent = text;
    }
  }
}
