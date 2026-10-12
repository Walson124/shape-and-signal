// Keyboard + pointer-lock mouse input with per-frame "pressed" edges.
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set();
    this.released = new Set();
    this.left = false;
    this.right = false;
    this.leftPressed = false;
    this.rightPressed = false;
    this.dx = 0;
    this.dy = 0;
    this.wheel = 0;
    this.locked = false;
    this.onLockChange = null;
    this.onKey = null;

    window.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
      if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'AltLeft', 'AltRight'].includes(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      if (this.onKey) this.onKey(e.code, e);
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      this.released.add(e.code);
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.left = false;
      this.right = false;
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      // guard against the occasional huge spike some browsers emit on lock
      const mx = e.movementX || 0, my = e.movementY || 0;
      if (Math.abs(mx) > 400 || Math.abs(my) > 400) return;
      this.dx += mx;
      this.dy += my;
    });
    canvas.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      if (e.button === 0) { this.left = true; this.leftPressed = true; }
      if (e.button === 2) { this.right = true; this.rightPressed = true; }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.left = false;
      if (e.button === 2) this.right = false;
    });
    window.addEventListener('wheel', (e) => {
      if (this.locked) this.wheel += Math.sign(e.deltaY);
    }, { passive: true });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked) {
        this.left = false;
        this.right = false;
      }
      if (this.onLockChange) this.onLockChange(this.locked);
    });
  }

  lock() {
    if (this.locked) return;
    try {
      const p = this.canvas.requestPointerLock({ unadjustedMovement: true });
      if (p && p.catch) {
        p.catch(() => {
          try {
            const q = this.canvas.requestPointerLock();
            if (q && q.catch) q.catch(() => {});
          } catch { /* ignore */ }
        });
      }
    } catch {
      /* the pause screen asks the player to click */
    }
  }

  unlock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  down(code) {
    return this.keys.has(code);
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
    this.leftPressed = false;
    this.rightPressed = false;
    this.wheel = 0;
  }
}
