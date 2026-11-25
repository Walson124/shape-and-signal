// Minesweeper rules, shared by the browser and the match server (worker/mines-room.js).
// Pure functions over typed arrays and no DOM, so both sides replay the same moves to the
// same result: the browser shows a click at once, and the server decides who won.
//
// A board comes from (width, height, mines, seed). Every board starts with one empty
// area already opened (a cell with no mines around it, and everything it floods to),
// so nobody has to guess their first click and both players start equal.

export const PRESETS = {
  beginner: { label: 'Beginner', w: 9, h: 9, mines: 10 },
  intermediate: { label: 'Intermediate', w: 16, h: 16, mines: 40 },
  expert: { label: 'Expert', w: 30, h: 16, mines: 99 },
};

export const STUN_MS = 5000;

// cell states in PlayerBoard.cell
export const HIDDEN = 0, OPEN = 1, FLAG = 2, BOOM = 3;

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function neighbours(w, h, i) {
  const x = i % w, y = (i - x) / w, out = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < w && ny < h) out.push(ny * w + nx);
    }
  }
  return out;
}

// The board for a seed. Retries with derived seeds until it has a cell with no
// neighbouring mines to start from (always within a few tries for standard densities).
export function makeBoard(w, h, mines, seed) {
  const size = w * h;
  mines = Math.max(1, Math.min(size - 9, mines | 0));
  for (let attempt = 0; attempt < 64; attempt++) {
    const rand = rng((seed >>> 0) + attempt * 0x9e3779b9);
    const order = Array.from({ length: size }, (_, i) => i);
    for (let i = size - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    const mine = new Uint8Array(size);
    for (let k = 0; k < mines; k++) mine[order[k]] = 1;
    const adj = new Uint8Array(size);
    for (let i = 0; i < size; i++) {
      if (mine[i]) continue;
      let n = 0;
      for (const j of neighbours(w, h, i)) n += mine[j];
      adj[i] = n;
    }
    const zeros = [];
    for (let i = 0; i < size; i++) if (!mine[i] && adj[i] === 0) zeros.push(i);
    if (!zeros.length) continue;
    // prefer a start nearer the middle, so the opening isn't always jammed in a corner
    const cx = (w - 1) / 2, cy = (h - 1) / 2;
    zeros.sort((a, b) => {
      const da = Math.hypot((a % w) - cx, Math.floor(a / w) - cy), db = Math.hypot((b % w) - cx, Math.floor(b / w) - cy);
      return da - db;
    });
    const pick = zeros[Math.floor(rand() * Math.min(zeros.length, Math.max(3, Math.ceil(zeros.length / 3))))];
    return { w, h, mines, seed: seed >>> 0, mine, adj, start: pick };
  }
  throw new Error('Could not build a board with an opening');
}

// One player's view of a board: what they've opened and flagged.
export function newPlayerBoard(board) {
  const pb = { cell: new Uint8Array(board.w * board.h), opened: 0, flags: 0, booms: 0 };
  reveal(board, pb, board.start);
  return pb;
}

export const safeCells = (board) => board.w * board.h - board.mines;
export const isCleared = (board, pb) => pb.opened >= safeCells(board);
export const progress = (board, pb) => pb.opened / safeCells(board);

// open a cell; flood through empty ones. Returns the cells it opened and whether a mine went off.
function reveal(board, pb, i) {
  const opened = [];
  if (pb.cell[i] !== HIDDEN) return { opened, boom: -1 };
  if (board.mine[i]) {
    pb.cell[i] = BOOM;
    pb.booms++;
    return { opened: [i], boom: i };
  }
  const stack = [i];
  pb.cell[i] = OPEN;
  while (stack.length) {
    const c = stack.pop();
    opened.push(c);
    pb.opened++;
    if (board.adj[c] !== 0) continue;
    for (const n of neighbours(board.w, board.h, c)) {
      if (pb.cell[n] === HIDDEN && !board.mine[n]) {
        pb.cell[n] = OPEN;
        stack.push(n);
      }
    }
  }
  return { opened, boom: -1 };
}

// A move: { a: 'r' (reveal) | 'f' (toggle flag) | 'c' (chord: open around a satisfied number), i }.
// Returns { ok, opened: [...], boom: index or -1, flag: true/false/undefined }.
// A move that changes nothing (clicking an open cell, flagging an open one) is ok but empty.
export function applyMove(board, pb, move) {
  const i = move?.i;
  if (!Number.isInteger(i) || i < 0 || i >= board.w * board.h) return { ok: false, opened: [], boom: -1 };
  const st = pb.cell[i];
  if (move.a === 'f') {
    if (st === HIDDEN) { pb.cell[i] = FLAG; pb.flags++; return { ok: true, opened: [], boom: -1, flag: true }; }
    if (st === FLAG) { pb.cell[i] = HIDDEN; pb.flags--; return { ok: true, opened: [], boom: -1, flag: false }; }
    return { ok: true, opened: [], boom: -1 };
  }
  if (move.a === 'r') {
    if (st === OPEN) return applyMove(board, pb, { a: 'c', i });
    return { ok: true, ...reveal(board, pb, i) };
  }
  if (move.a === 'c') {
    if (st !== OPEN || board.adj[i] === 0) return { ok: true, opened: [], boom: -1 };
    const around = neighbours(board.w, board.h, i);
    // a set-off mine counts as marked, so play can go on around it
    const marked = around.filter((n) => pb.cell[n] === FLAG || pb.cell[n] === BOOM).length;
    if (marked !== board.adj[i]) return { ok: true, opened: [], boom: -1 };
    const opened = [];
    let boom = -1;
    for (const n of around) {
      if (pb.cell[n] !== HIDDEN) continue;
      const r = reveal(board, pb, n);
      opened.push(...r.opened);
      if (r.boom >= 0 && boom < 0) boom = r.boom;
    }
    return { ok: true, opened, boom };
  }
  return { ok: false, opened: [], boom: -1 };
}

// A compact picture of a player's board for the others: one character per cell
// (h hidden, o open, f flag, x set-off mine). Used for the opponents' mini-boards.
export function sketch(pb) {
  const ch = ['h', 'o', 'f', 'x'];
  let s = '';
  for (let i = 0; i < pb.cell.length; i++) s += ch[pb.cell[i]];
  return s;
}

// A random 32-bit seed (crypto where available).
export function randomSeed() {
  if (globalThis.crypto?.getRandomValues) return globalThis.crypto.getRandomValues(new Uint32Array(1))[0];
  return Math.floor(Math.random() * 2 ** 32);
}

// time as m:ss.t
export function fmtTime(ms) {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const s = ms / 1000, m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, '0')}`;
}
