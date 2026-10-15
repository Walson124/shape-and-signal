import { settings } from './settings.js';

// Keyboard + pointer-lock mouse input with per-frame "pressed" edges.
// Mouse buttons are tracked as codes Mouse0..Mouse4 so they can be bound
// to any action like keys.
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set();
    this.released = new Set();
    this.downAt = new Map();
    this.dx = 0;
    this.dy = 0;
    this.wheel = 0;
    this.locked = false;
    this.onLockChange = null;
    this.onKey = null;
    this.capture = null;
    this.time = 0;
    this.wantLock = false;
    this.lockPending = null;

    const press = (code) => {
      if (!this.keys.has(code)) {
        this.pressed.add(code);
        this.downAt.set(code, performance.now());
      }
      this.keys.add(code);
    };
    const release = (code) => {
      if (this.keys.has(code)) this.released.add(code);
      this.keys.delete(code);
    };

    window.addEventListener('keydown', (e) => {
      if (this.capture) {
        e.preventDefault();
        const cb = this.capture;
        this.capture = null;
        cb(e.code === 'Escape' ? null : e.code);
        return;
      }
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
      if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'AltLeft', 'AltRight'].includes(e.code)) e.preventDefault();
      if (this.locked && (e.ctrlKey || e.code.startsWith('Control'))) e.preventDefault();
      press(e.code);
      if (!e.repeat && this.onKey) this.onKey(e.code, e);
    });
    window.addEventListener('keyup', (e) => release(e.code));
    window.addEventListener('blur', () => {
      for (const k of [...this.keys]) release(k);
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      // guard against the occasional huge spike some browsers emit on lock
      const mx = e.movementX || 0, my = e.movementY || 0;
      if (Math.abs(mx) > 400 || Math.abs(my) > 400) return;
      this.dx += mx;
      this.dy += my;
    });
    window.addEventListener('mousedown', (e) => {
      if (this.capture) {
        e.preventDefault();
        const cb = this.capture;
        this.capture = null;
        cb(`Mouse${e.button}`);
        return;
      }
      if (!this.locked) return;
      press(`Mouse${e.button}`);
      if (this.onKey) this.onKey(`Mouse${e.button}`, e);
    });
    window.addEventListener('mouseup', (e) => release(`Mouse${e.button}`));
    window.addEventListener('wheel', (e) => {
      if (this.locked) this.wheel += Math.sign(e.deltaY);
    }, { passive: true });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (this.locked && !this.wantLock) { document.exitPointerLock(); return; }
      if (!this.locked) for (let b = 0; b < 5; b++) release(`Mouse${b}`);
      if (this.onLockChange) this.onLockChange(this.locked);
    });
  }

  // ---- raw codes
  down(code) {
    return this.keys.has(code);
  }

  // ---- actions (see bindings.js)
  act(action) {
    return this.keys.has(settings.key(action));
  }

  hit(action) {
    return this.pressed.has(settings.key(action));
  }

  rel(action) {
    return this.released.has(settings.key(action));
  }

  // Seconds an action's key has been held (0 if up).
  held(action) {
    const code = settings.key(action);
    if (!this.keys.has(code)) return 0;
    return (performance.now() - (this.downAt.get(code) || performance.now())) / 1000;
  }

  // Seconds the action's key was held when it was released this frame.
  heldFor(action) {
    const code = settings.key(action);
    return (performance.now() - (this.downAt.get(code) || performance.now())) / 1000;
  }

  get left() { return this.act('fire'); }
  get right() { return this.act('focus'); }

  // Next key or mouse button goes to cb (null on Escape).
  captureNext(cb) {
    this.capture = cb;
  }

  lock() {
    this.wantLock = true;
    if (this.locked) return Promise.resolve(true);
    if (this.lockPending) return this.lockPending;
    this.lockPending = (async () => {
      try {
        try {
          await this.canvas.requestPointerLock({ unadjustedMovement: true });
        } catch (error) {
          if (!this.wantLock || error?.name !== 'NotSupportedError') return false;
          await this.canvas.requestPointerLock();
        }
        return this.wantLock && document.pointerLockElement === this.canvas;
      } catch {
        return false;
      }
    })();
    this.lockPending.finally(() => { this.lockPending = null; });
    return this.lockPending;
  }

  unlock() {
    this.wantLock = false;
    if (document.pointerLockElement) document.exitPointerLock();
  }

  clear() {
    this.keys.clear();
    this.pressed.clear();
    this.released.clear();
    this.downAt.clear();
    this.dx = this.dy = this.wheel = 0;
  }

  consumeMouse() {
    const d = { x: this.dx, y: this.dy };
    this.dx = 0;
    this.dy = 0;
    return d;
  }

  endFrame() {
    this.pressed.clear();
    this.released.clear();
    this.wheel = 0;
  }
}
