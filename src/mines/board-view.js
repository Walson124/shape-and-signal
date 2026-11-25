import { HIDDEN, OPEN, FLAG, BOOM } from './core.js';

// Draws one player's board as a grid of cells and turns clicks and taps into moves.
//   mouse: left opens (or chords an open number), right flags, middle chords
//   touch: tap opens, long-press flags (tap flags instead while flag mode is on)
//   keyboard: Space flags the cell under the pointer, or chords an open number

const LONG_PRESS_MS = 330;

export class BoardView {
  constructor(root, { onMove }) {
    this.root = root;
    this.onMove = onMove;
    this.enabled = false;
    this.flagMode = false;
    this.hover = -1;
    this.board = null;
    this.grid = document.createElement('div');
    this.grid.className = 'grid';
    root.append(this.grid);
    this.bind();
    new ResizeObserver(() => {
      if (!this.board) return;
      const want = this.board.w > this.board.h && window.innerHeight > window.innerWidth;
      if (want !== this.turned && this.root.clientWidth < this.board.w * 26 + 24) this.layout();
      else this.fit();
    }).observe(root);
  }

  setBoard(board, pb) {
    this.board = board;
    this.pb = pb;
    this.shown = false;
    this.layout();
  }

  // On a narrow portrait screen a wide board is shown on its side (rows become columns),
  // so Expert fits a phone without sideways scrolling. Cells keep their real index.
  layout() {
    const { w, h } = this.board;
    const minCs = matchMedia('(pointer: coarse)').matches ? 26 : 20;
    const turn = w > h && this.root.clientWidth < w * minCs + 24 && window.innerHeight > window.innerWidth;
    this.turned = turn;
    const cols = turn ? h : w;
    this.grid.style.gridTemplateColumns = `repeat(${cols}, var(--cs))`;
    this.cells = new Array(w * h);
    const frag = document.createDocumentFragment();
    const rows = turn ? w : h;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = turn ? c * w + r : r * w + c;
        const el = document.createElement('div');
        el.dataset.i = i;
        this.cells[i] = el;
        frag.append(el);
      }
    }
    this.grid.replaceChildren(frag);
    this.fit();
    this.drawAll();
  }

  fit() {
    if (!this.board) return;
    const cols = this.turned ? this.board.h : this.board.w, rows = this.turned ? this.board.w : this.board.h;
    const availW = this.root.clientWidth - 24;
    const availH = Math.max(260, window.innerHeight - 250);
    // shrink to fit before scrolling sideways; below 18px it scrolls instead
    const cs = Math.max(18, Math.min(46, Math.floor(availW / cols) - 2, Math.floor(availH / rows) - 2));
    this.grid.style.setProperty('--cs', `${cs}px`);
    this.grid.style.setProperty('--fs', `${Math.round(cs * 0.56)}px`);
  }

  draw(i) {
    const c = this.cells[i], st = this.pb.cell[i], b = this.board;
    let cls = 'c', txt = '';
    if (st === OPEN) {
      cls = 'o';
      const n = b.adj[i];
      if (n) { cls += ` n${n}`; txt = n; }
    } else if (st === FLAG) {
      cls = this.shown && !b.mine[i] ? 'c f wf' : 'c f';
    } else if (st === BOOM) {
      cls = 'o x';
    } else if (this.shown && b.mine[i]) {
      cls = 'o m';
    }
    if (c.className !== cls) c.className = cls;
    if (c.textContent !== String(txt)) c.textContent = txt;
  }

  drawAll() { for (let i = 0; i < this.cells.length; i++) this.draw(i); }
  drawSome(list) { for (const i of list) this.draw(i); }

  // after the round: show every mine and mark wrong flags
  showMines() { this.shown = true; this.drawAll(); }

  flash(kind) {
    this.root.classList.remove('flash-boom', 'flash-win');
    void this.root.offsetWidth;
    this.root.classList.add(`flash-${kind}`);
  }

  cellAt(target) {
    const el = target?.closest?.('[data-i]');
    return el && this.grid.contains(el) ? Number(el.dataset.i) : -1;
  }

  move(a, i) {
    if (!this.enabled || i < 0) return;
    this.onMove({ a, i });
  }

  // a left click or tap on a cell: open it, or chord if it's an open number
  primary(i) {
    const st = this.pb.cell[i];
    if (this.flagMode && st !== OPEN) return this.move('f', i);
    if (st === FLAG) return;
    this.move(st === OPEN ? 'c' : 'r', i);
  }

  bind() {
    const g = this.grid;
    g.addEventListener('contextmenu', (e) => e.preventDefault());
    let touch = null; // { i, x, y, timer, fired }
    let pressed = -1;
    const press = (i) => {
      if (pressed >= 0) this.cells[pressed]?.classList.remove('down');
      pressed = i;
      if (i >= 0 && this.enabled && this.pb.cell[i] === HIDDEN) this.cells[i].classList.add('down');
    };
    g.addEventListener('pointerdown', (e) => {
      const i = this.cellAt(e.target);
      if (i < 0) return;
      if (e.pointerType === 'touch') {
        touch = { i, x: e.clientX, y: e.clientY, fired: false };
        touch.timer = setTimeout(() => {
          if (!touch) return;
          touch.fired = true;
          if (this.pb.cell[touch.i] === OPEN) this.move('c', touch.i);
          else this.move('f', touch.i);
          navigator.vibrate?.(15);
        }, LONG_PRESS_MS);
        press(i);
        return;
      }
      if (e.button === 2) { e.preventDefault(); const st = this.pb.cell[i]; this.move(st === OPEN ? 'c' : 'f', i); return; }
      if (e.button === 1) { e.preventDefault(); this.move('c', i); return; }
      if (e.button === 0) press(i);
    });
    g.addEventListener('pointermove', (e) => {
      const i = this.cellAt(document.elementFromPoint(e.clientX, e.clientY));
      this.hover = i;
      if (touch && Math.hypot(e.clientX - touch.x, e.clientY - touch.y) > 12) { clearTimeout(touch.timer); touch = null; press(-1); }
      else if (pressed >= 0 && e.pointerType !== 'touch' && e.buttons & 1) press(i);
    });
    g.addEventListener('pointerleave', () => { this.hover = -1; if (!touch) press(-1); });
    g.addEventListener('pointercancel', () => { if (touch) { clearTimeout(touch.timer); touch = null; } press(-1); });
    window.addEventListener('pointerup', (e) => {
      if (touch && e.pointerType === 'touch') {
        clearTimeout(touch.timer);
        if (!touch.fired) this.primary(touch.i);
        touch = null;
        press(-1);
        return;
      }
      if (pressed < 0 || e.button !== 0) return;
      const i = this.cellAt(e.target);
      press(-1);
      if (i >= 0) this.primary(i);
    });
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'Space' || this.hover < 0 || !this.enabled) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLButtonElement) return;
      e.preventDefault();
      this.move(this.pb.cell[this.hover] === OPEN ? 'c' : 'f', this.hover);
    });
  }
}

// A small picture of someone else's board from its sketch string (see core.sketch).
export function drawSketch(canvas, w, h, sk, colors) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const box = Math.min(canvas.closest('.opp')?.clientWidth - 26 || 200, 230);
  const cs = Math.max(2, Math.floor(box / w));
  canvas.width = w * cs * dpr;
  canvas.height = h * cs * dpr;
  canvas.style.width = `${w * cs}px`;
  canvas.style.height = `${h * cs}px`;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  for (let i = 0; i < w * h; i++) {
    const ch = sk ? sk[i] : 'h';
    ctx.fillStyle = ch === 'o' ? colors.open : ch === 'f' ? colors.flag : ch === 'x' ? colors.boom : colors.hidden;
    ctx.fillRect((i % w) * cs, Math.floor(i / w) * cs, cs - (cs > 3 ? 1 : 0), cs - (cs > 3 ? 1 : 0));
  }
}
