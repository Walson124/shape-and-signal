import test from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS, makeBoard, newPlayerBoard, applyMove, isCleared, progress, sketch, neighbours, OPEN, FLAG, BOOM, HIDDEN, STUN_MS } from '../src/mines/core.js';
import { Match, COUNTDOWN_MS, REJOIN_MS, cleanCfg, cleanRoomCode } from '../worker/mines-match.js';

test('boards are deterministic, have the right mine count and open on a zero', () => {
  for (const [, p] of Object.entries(PRESETS)) {
    for (const seed of [1, 42, 123456789, 0xffffffff]) {
      const a = makeBoard(p.w, p.h, p.mines, seed), b = makeBoard(p.w, p.h, p.mines, seed);
      assert.deepEqual([...a.mine], [...b.mine]);
      assert.equal(a.mine.reduce((s, v) => s + v, 0), p.mines);
      assert.equal(a.mine[a.start], 0);
      assert.equal(a.adj[a.start], 0);
      const pb = newPlayerBoard(a);
      assert.ok(pb.opened >= 1);
      assert.equal(pb.booms, 0);
    }
  }
  const x = makeBoard(16, 16, 40, 7), y = makeBoard(16, 16, 40, 8);
  assert.notDeepEqual([...x.mine], [...y.mine]);
});

test('adjacency counts match the mines around each cell', () => {
  const b = makeBoard(30, 16, 99, 99);
  for (let i = 0; i < 30 * 16; i++) {
    if (b.mine[i]) continue;
    assert.equal(b.adj[i], neighbours(30, 16, i).filter((j) => b.mine[j]).length);
  }
});

function solve(board, pb, moves) {
  // open every safe cell one by one
  for (let i = 0; i < board.w * board.h; i++) {
    if (!board.mine[i] && pb.cell[i] === HIDDEN) {
      const r = applyMove(board, pb, { a: 'r', i });
      moves?.push({ a: 'r', i });
      assert.equal(r.boom, -1);
    }
  }
}

test('opening every safe cell clears the board; flags toggle; mines go off', () => {
  const b = makeBoard(9, 9, 10, 5);
  const pb = newPlayerBoard(b);
  const mine = b.mine.indexOf(1);
  assert.deepEqual(applyMove(b, pb, { a: 'f', i: mine }).flag, true);
  assert.equal(pb.cell[mine], FLAG);
  assert.equal(applyMove(b, pb, { a: 'r', i: mine }).opened.length, 0, 'flagged cells do not open');
  assert.deepEqual(applyMove(b, pb, { a: 'f', i: mine }).flag, false);
  const r = applyMove(b, pb, { a: 'r', i: mine });
  assert.equal(r.boom, mine);
  assert.equal(pb.cell[mine], BOOM);
  solve(b, pb);
  assert.ok(isCleared(b, pb));
  assert.equal(progress(b, pb), 1);
  assert.equal(applyMove(b, pb, { a: 'r', i: -1 }).ok, false);
  assert.equal(applyMove(b, pb, { a: 'z', i: 0 }).ok, false);
});

test('chording opens around a number once its mines are flagged', () => {
  const b = makeBoard(16, 16, 40, 31);
  const pb = newPlayerBoard(b);
  // find an open number on the edge of the opening with a hidden neighbour
  let target = -1;
  for (let i = 0; i < 256 && target < 0; i++) {
    if (pb.cell[i] === OPEN && b.adj[i] > 0 && neighbours(16, 16, i).some((n) => pb.cell[n] === HIDDEN && !b.mine[n])) target = i;
  }
  assert.ok(target >= 0);
  assert.equal(applyMove(b, pb, { a: 'c', i: target }).opened.length, 0, 'not enough flags: nothing happens');
  for (const n of neighbours(16, 16, target)) if (b.mine[n]) applyMove(b, pb, { a: 'f', i: n });
  const r = applyMove(b, pb, { a: 'c', i: target });
  assert.ok(r.opened.length > 0);
  assert.equal(r.boom, -1);
  assert.equal(sketch(pb).length, 256);
});

// ------------------------------------------------------------------ the match server

function harness() {
  let t = 1000;
  const timers = [];
  const inbox = new Map();
  let seedN = 100;
  const m = new Match({
    send: (conn, msg) => inbox.get(conn).push(msg),
    now: () => t,
    later: (fn, ms) => timers.push({ at: t + ms, fn }),
    seed: () => seedN++,
  });
  const conn = (name) => { const c = { name }; inbox.set(c, []); return c; };
  const advance = (ms) => {
    t += ms;
    for (const tm of timers.filter((x) => x.at <= t)) { timers.splice(timers.indexOf(tm), 1); tm.fn(); }
  };
  const last = (c, type) => [...inbox.get(c)].reverse().find((x) => x.t === type);
  return { m, conn, advance, inbox, last };
}

function startTwo(h, cfg = {}) {
  const a = h.conn('a'), b = h.conn('b');
  h.m.open(a, { t: 'hi', name: 'Ann' });
  h.m.open(b, { t: 'hi', name: 'Bob' });
  h.m.message(a, { t: 'cfg', preset: 'beginner', ...cfg });
  h.m.message(a, { t: 'ready', on: true });
  h.m.message(b, { t: 'ready', on: true });
  assert.equal(h.m.phase, 'countdown');
  h.advance(COUNTDOWN_MS);
  assert.equal(h.m.phase, 'playing');
  return { a, b };
}

test('two players ready up, the first to clear wins', () => {
  const h = harness();
  const { a, b } = startTwo(h);
  const sa = h.last(a, 'start'), sb = h.last(b, 'start');
  assert.equal(sa.seed, sb.seed, 'same board by default');
  // Ann replays the board locally, exactly as the client would
  const board = makeBoard(9, 9, 10, sa.seed);
  const pb = newPlayerBoard(board);
  const moves = [];
  solve(board, pb, moves);
  moves.forEach((mv, n) => h.m.message(a, { t: 'mv', ...mv, n }));
  const end = h.last(b, 'end');
  assert.ok(end, 'round ended');
  assert.equal(end.winner, h.m.players[0].id);
  assert.equal(end.reason, 'cleared');
  assert.equal(h.m.players[0].wins, 1);
  assert.equal(h.m.phase, 'over');
  // on a shared board Bob never saw Ann's open cells mid-round
  assert.ok(h.inbox.get(b).filter((x) => x.t === 'p').every((x) => x.sk === undefined));
});

test('separate boards give each player their own seed and share sketches', () => {
  const h = harness();
  const { a, b } = startTwo(h, { boards: 'different' });
  assert.notEqual(h.last(a, 'start').seed, h.last(b, 'start').seed);
  const board = makeBoard(9, 9, 10, h.last(a, 'start').seed);
  const safe = [...board.mine.keys()].find((i) => !board.mine[i] && newPlayerBoard(board).cell[i] === HIDDEN);
  h.m.message(a, { t: 'mv', a: 'r', i: safe, n: 0 });
  assert.equal(typeof h.last(b, 'p').sk, 'string');
});

test('a mine freezes you; moves during the freeze are refused and resynced', () => {
  const h = harness();
  const { a } = startTwo(h);
  const board = makeBoard(9, 9, 10, h.last(a, 'start').seed);
  const mine = board.mine.indexOf(1);
  h.m.message(a, { t: 'mv', a: 'r', i: mine, n: 0 });
  assert.ok(h.last(a, 'p').stun > 0);
  const safe = [...board.mine.keys()].find((i) => !board.mine[i] && newPlayerBoard(board).cell[i] === HIDDEN);
  h.m.message(a, { t: 'mv', a: 'r', i: safe, n: 1 });
  const rej = h.last(a, 'rej');
  assert.ok(rej, 'refused while frozen');
  assert.equal(rej.n, 1);
  h.advance(STUN_MS);
  h.m.message(a, { t: 'mv', a: 'r', i: safe, n: 1 });
  assert.equal(h.m.players[0].moves.length, 2);
  // a move number out of step is refused too
  h.m.message(a, { t: 'mv', a: 'f', i: mine, n: 7 });
  assert.equal(h.last(a, 'rej').n, 2);
});

test('"out" mode: hitting a mine knocks you out and the other player wins', () => {
  const h = harness();
  const { a } = startTwo(h, { onMine: 'out' });
  const board = makeBoard(9, 9, 10, h.last(a, 'start').seed);
  h.m.message(a, { t: 'mv', a: 'r', i: board.mine.indexOf(1), n: 0 });
  const end = h.last(a, 'end');
  assert.equal(end.reason, 'last');
  assert.equal(end.winner, h.m.players[1].id);
});

test('only the host changes settings; a dropped player can rejoin mid-round, or forfeits', () => {
  const h = harness();
  const { a, b } = startTwo(h);
  h.m.message(b, { t: 'cfg', preset: 'expert' });
  assert.equal(h.m.cfg.preset, 'beginner');
  const seat = h.last(b, 'welcome');
  h.m.close(b);
  const b2 = h.conn('b2');
  h.m.open(b2, { t: 'hi', name: 'Bob', id: seat.you, key: seat.key });
  assert.ok(h.last(b2, 'start'), 'got the round back');
  assert.ok(h.last(b2, 'rej'), 'and its board');
  h.m.close(b2);
  h.advance(REJOIN_MS);
  assert.equal(h.last(a, 'end')?.winner, h.m.players[0].id);
});

test('room codes and settings are cleaned', () => {
  assert.equal(cleanRoomCode('ab12c'), 'AB12C');
  assert.equal(cleanRoomCode('a b'), null);
  assert.equal(cleanRoomCode('x'.repeat(20)), null);
  const prev = { preset: 'beginner', boards: 'same', onMine: 'stun' };
  assert.deepEqual(cleanCfg({ preset: 'nope', boards: 'different', onMine: 'x' }, prev), { preset: 'beginner', boards: 'different', onMine: 'stun' });
});

test('a fifth player is turned away', () => {
  const h = harness();
  for (let i = 0; i < 4; i++) h.m.open(h.conn(`p${i}`), { t: 'hi', name: `P${i}` });
  const late = h.conn('late');
  assert.equal(h.m.open(late, { t: 'hi', name: 'Late' }), 'close');
  assert.equal(h.last(late, 'full').t, 'full');
});
