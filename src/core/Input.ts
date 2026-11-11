/** Keyboard + mouse state. Mouse look uses pointer lock, with drag-to-look as a fallback. */
export class Input {
  private down = new Set<string>();
  private pressed = new Set<string>();
  mouseDX = 0;
  mouseDY = 0;
  wheel = 0;
  locked = false;
  /** Analogue stick of the touch controls, each axis -1..1 (x right, y forward). Adds to W A S D. */
  stickX = 0;
  stickY = 0;
  private dragging = false;
  onLockChange: (locked: boolean) => void = () => {};

  constructor(private canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', (e) => {
      if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      if (!e.repeat) this.pressed.add(e.code);
      this.down.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.down.clear());
    canvas.addEventListener('mousedown', (e) => {
      if (!this.locked) this.dragging = true;
      this.pressed.add('Mouse' + e.button);
      this.down.add('Mouse' + e.button);
    });
    window.addEventListener('mouseup', (e) => {
      this.dragging = false;
      this.down.delete('Mouse' + e.button);
    });
    window.addEventListener('mousemove', (e) => {
      if (this.locked || this.dragging) {
        this.mouseDX += e.movementX;
        this.mouseDY += e.movementY;
      }
    });
    canvas.addEventListener('wheel', (e) => (this.wheel += Math.sign(e.deltaY)), { passive: true });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      this.onLockChange(this.locked);
    });
  }

  lock() {
    try {
      const p = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch {
      /* pointer lock unavailable: drag-to-look still works */
    }
  }
  unlock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  isDown(code: string) {
    return this.down.has(code);
  }
  wasPressed(code: string) {
    return this.pressed.has(code);
  }
  axis(neg: string, pos: string) {
    return this.amount(pos) - this.amount(neg);
  }
  /** How far a movement key is "pressed": 1 for the key itself, otherwise the stick's share in that direction. */
  private amount(code: string) {
    if (this.down.has(code)) return 1;
    const v = code === 'KeyW' ? this.stickY : code === 'KeyS' ? -this.stickY : code === 'KeyD' ? this.stickX : code === 'KeyA' ? -this.stickX : 0;
    return v > 0.12 ? v : 0; // dead zone
  }
  /** Camera movement from a touch drag, in the same units as mouse pixels. */
  look(dx: number, dy: number) {
    this.mouseDX += dx;
    this.mouseDY += dy;
  }
  /** Call once at the end of every frame. */
  endFrame() {
    this.pressed.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
  }
  /** Hold or release a key from code: the touch buttons and tests. */
  setKey(code: string, isDown: boolean) {
    if (isDown) {
      if (!this.down.has(code)) this.pressed.add(code);
      this.down.add(code);
    } else this.down.delete(code);
  }
}
