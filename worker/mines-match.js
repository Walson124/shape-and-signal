import { PRESETS, STUN_MS, makeBoard, newPlayerBoard, applyMove, isCleared, progress, sketch, randomSeed } from '../src/mines/core.js';

// One Minesweeper Duel match: 2-4 players race to clear a board. The server holds every
// board and replays each player's moves on it, so it alone decides who won (clients
// play ahead on their own copy for instant feedback, and resync if the server disagrees).
// No Cloudflare APIs here: worker/mines-room.js plugs it into a Durable Object, and the
// tests drive it directly.
//
// Client -> server:
//   { t: 'hi', name, id?, key? }          join (id + key rejoin a seat after a dropped connection)
//   { t: 'cfg', preset, boards, onMine }  host only, between rounds
//   { t: 'ready', on }                    ready up; the round starts when everyone (2+) is ready
//   { t: 'mv', a: 'r'|'f'|'c', i, n }     a move on your board; n counts your moves this round
//   { t: 'emote', e }                     a quick reaction
// Server -> client:
//   { t: 'welcome', you, key }            your seat
//   { t: 'room', ... }                    who's here, settings, phase (sent on every change)
//   { t: 'start', in, seed, n }           a round starts in `in` ms on the board for `seed`
//   { t: 'p', id, prog, booms, stun, out, done, time, sk? }   a player's progress
//   { t: 'rej', n, cells }                your move n was refused: here is your board as the server has it
//   { t: 'end', winner, results }         the round is over
//   { t: 'emote', id, e }
//   { t: 'err', text }

export const MAX_PLAYERS = 4;
export const MAX_MESSAGE = 512;
export const COUNTDOWN_MS = 3000;
export const REJOIN_MS = 20000;
const MOVES_PER_SEC = 30;
const EMOTES = ['gg', 'nice', 'oops', 'hurry', 'wow', 'rematch?'];

export function cleanName(raw) {
  const s = String(raw ?? '').replace(/[\u0000-\u001f\u007f<>&"'`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16);
  return s.length >= 1 ? s : null;
}

export function cleanRoomCode(raw) {
  const s = String(raw ?? '').toUpperCase();
  return /^[A-Z0-9]{4,8}$/.test(s) ? s : null;
}

export function cleanCfg(m, prev) {
  return {
    preset: Object.hasOwn(PRESETS, m?.preset) ? m.preset : prev.preset,
    boards: m?.boards === 'same' || m?.boards === 'different' ? m.boards : prev.boards,
    onMine: m?.onMine === 'stun' || m?.onMine === 'out' ? m.onMine : prev.onMine,
  };
}

export class Match {
  // send(conn, msg) delivers to one connection; now() is ms; later(fn, ms) schedules
  constructor({ send, now = () => Date.now(), later = (fn, ms) => setTimeout(fn, ms), seed = randomSeed }) {
    this.sendTo = send;
    this.now = now;
    this.later = later;
    this.makeSeed = seed;
    this.players = [];          // seats, in join order
    this.cfg = { preset: 'intermediate', boards: 'same', onMine: 'stun' };
    this.phase = 'lobby';       // lobby | countdown | playing | over
    this.round = 0;
    this.startAt = 0;
    this.lastResult = null;
  }

  get host() { return this.players.find((p) => p.conn) || this.players[0] || null; }
  seatOf(conn) { return this.players.find((p) => p.conn === conn) || null; }

  send(p, msg) { if (p.conn) this.sendTo(p.conn, msg); }
  broadcast(msg, except) { for (const p of this.players) if (p !== except) this.send(p, msg); }

  roomMsg() {
    return {
      t: 'room',
      host: this.host?.id ?? null,
      cfg: this.cfg,
      phase: this.phase,
      round: this.round,
      players: this.players.map((p) => ({ id: p.id, name: p.name, ready: p.ready, wins: p.wins, online: !!p.conn })),
      last: this.lastResult,
    };
  }
  sync() { this.broadcast(this.roomMsg()); }

  // ---- connections

  open(conn, msg) {
    if (msg?.t !== 'hi') return;
    const name = cleanName(msg.name);
    if (!name) { this.sendTo(conn, { t: 'err', text: 'Pick a name first.' }); return; }
    // taking back a seat after a dropped connection
    const back = this.players.find((p) => p.id === msg.id && p.key === msg.key && !p.conn);
    if (back) {
      back.conn = conn;
      back.name = name;
      this.sendTo(conn, { t: 'welcome', you: back.id, key: back.key });
      this.sync();
      if (this.phase === 'playing' || this.phase === 'countdown') this.resend(back);
      return;
    }
    if (this.players.length >= MAX_PLAYERS) { this.sendTo(conn, { t: 'full' }); return 'close'; }
    if (this.phase !== 'lobby' && this.phase !== 'over') { this.sendTo(conn, { t: 'busy' }); return 'close'; }
    const p = {
      id: Math.random().toString(36).slice(2, 8), key: Math.random().toString(36).slice(2, 12),
      name, conn, ready: false, wins: 0, board: null, pb: null, moves: [], stunUntil: 0, out: false, doneAt: 0,
    };
    this.players.push(p);
    this.sendTo(conn, { t: 'welcome', you: p.id, key: p.key });
    this.sync();
  }

  close(conn) {
    const p = this.seatOf(conn);
    if (!p) return;
    p.conn = null;
    if (this.phase === 'lobby' || this.phase === 'over') {
      this.players.splice(this.players.indexOf(p), 1);
      this.sync();
      return;
    }
    // mid-round: hold the seat for a while, then they forfeit
    p.ready = false;
    this.sync();
    const round = this.round;
    this.later(() => {
      if (p.conn || this.round !== round || this.phase === 'over' || this.phase === 'lobby') return;
      p.out = true;
      this.broadcastProgress(p);
      this.checkEnd();
      if (!p.conn && this.players.includes(p) && (this.phase === 'over' || this.phase === 'lobby')) {
        this.players.splice(this.players.indexOf(p), 1);
        this.sync();
      }
    }, REJOIN_MS);
  }

  message(conn, msg) {
    const p = this.seatOf(conn);
    if (!p || !msg || typeof msg !== 'object') return;
    if (msg.t === 'cfg') {
      if (p !== this.host || (this.phase !== 'lobby' && this.phase !== 'over')) return;
      this.cfg = cleanCfg(msg, this.cfg);
      for (const q of this.players) q.ready = false;
      this.sync();
    } else if (msg.t === 'ready') {
      if (this.phase !== 'lobby' && this.phase !== 'over') return;
      p.ready = !!msg.on;
      this.sync();
      const here = this.players.filter((q) => q.conn);
      if (here.length >= 2 && here.every((q) => q.ready)) this.begin();
    } else if (msg.t === 'mv') {
      this.move(p, msg);
    } else if (msg.t === 'emote') {
      if (!EMOTES.includes(msg.e)) return;
      const t = this.now();
      if (t - (p.emoteAt || 0) < 800) return;
      p.emoteAt = t;
      this.broadcast({ t: 'emote', id: p.id, e: msg.e });
    }
  }

  // ---- rounds

  begin() {
    // anyone who left before the start sits this one out
    this.players = this.players.filter((q) => q.conn);
    const { w, h, mines } = PRESETS[this.cfg.preset];
    const shared = this.makeSeed();
    this.round++;
    this.phase = 'countdown';
    this.startAt = this.now() + COUNTDOWN_MS;
    for (const p of this.players) {
      const seed = this.cfg.boards === 'same' ? shared : this.makeSeed();
      p.board = makeBoard(w, h, mines, seed);
      p.pb = newPlayerBoard(p.board);
      p.moves = [];
      p.stunUntil = 0;
      p.out = false;
      p.doneAt = 0;
      p.ready = false;
      p.rate = [];
    }
    this.sync();
    for (const p of this.players) this.send(p, { t: 'start', in: COUNTDOWN_MS, seed: p.board.seed, round: this.round, cfg: this.cfg });
    const round = this.round;
    this.later(() => {
      if (this.round !== round || this.phase !== 'countdown') return;
      this.phase = 'playing';
      this.sync();
    }, COUNTDOWN_MS);
  }

  // a player who came back mid-round gets the round again, with their board as it stands
  resend(p) {
    const left = Math.max(0, this.startAt - this.now());
    this.send(p, { t: 'start', in: left, seed: p.board.seed, round: this.round, cfg: this.cfg, elapsed: Math.max(0, this.now() - this.startAt) });
    this.send(p, { t: 'rej', n: p.moves.length, cells: sketch(p.pb) });
    for (const q of this.players) this.send(p, this.progressMsg(q, q === p));
  }

  move(p, msg) {
    const t = this.now();
    if (!p.pb || p.out || p.doneAt) return;
    const n = Number.isInteger(msg.n) ? msg.n : -1;
    // n in a refusal is the move number the server expects next
    const refuse = () => this.send(p, { t: 'rej', n: p.moves.length, cells: sketch(p.pb), stun: Math.max(0, p.stunUntil - t) });
    // the countdown is the client's to enforce; a click a hair early (clock skew) still counts
    if (this.phase !== 'playing' && !(this.phase === 'countdown' && this.startAt - t < 250)) return refuse();
    if (n !== p.moves.length) return refuse();
    p.rate = (p.rate || []).filter((x) => t - x < 1000);
    if (p.rate.length >= MOVES_PER_SEC) return refuse();
    p.rate.push(t);
    // stunned: allow a little slack for the trip from the client
    if (t < p.stunUntil - 300) return refuse();
    const r = applyMove(p.board, p.pb, { a: msg.a, i: msg.i });
    if (!r.ok) return refuse();
    p.moves.push(msg.a + msg.i);
    if (r.boom >= 0) {
      if (this.cfg.onMine === 'out') p.out = true;
      else p.stunUntil = t + STUN_MS;
    }
    if (isCleared(p.board, p.pb)) p.doneAt = t;
    this.broadcastProgress(p);
    this.checkEnd();
  }

  progressMsg(p, self) {
    const t = this.now();
    const msg = {
      t: 'p', id: p.id,
      prog: p.pb ? Math.round(progress(p.board, p.pb) * 1000) / 1000 : 0,
      booms: p.pb?.booms ?? 0,
      stun: Math.max(0, p.stunUntil - t),
      out: p.out,
      done: !!p.doneAt,
      time: p.doneAt ? p.doneAt - this.startAt : null,
    };
    // on a shared board, others' open cells would give the game away
    if (p.pb && (self || this.cfg.boards === 'different')) msg.sk = sketch(p.pb);
    return msg;
  }

  broadcastProgress(p) {
    for (const q of this.players) this.send(q, this.progressMsg(p, q === p));
  }

  checkEnd() {
    if (this.phase !== 'playing' && this.phase !== 'countdown') return;
    const done = this.players.filter((p) => p.doneAt).sort((a, b) => a.doneAt - b.doneAt);
    const alive = this.players.filter((p) => !p.out && !p.doneAt);
    let winner = null, reason = null;
    if (done.length) { winner = done[0]; reason = 'cleared'; }
    else if (this.players.length >= 2 && alive.length === 1 && this.players.every((p) => p === alive[0] || p.out)) { winner = alive[0]; reason = 'last'; }
    else if (!alive.length) reason = 'all-out';
    else return;
    this.finish(winner, reason);
  }

  finish(winner, reason) {
    const t = this.now();
    this.phase = 'over';
    if (winner) winner.wins++;
    const results = this.players.map((p) => ({
      id: p.id, name: p.name,
      prog: p.pb ? Math.round(progress(p.board, p.pb) * 1000) / 1000 : 0,
      time: p.doneAt ? p.doneAt - this.startAt : t - this.startAt,
      booms: p.pb?.booms ?? 0,
      out: p.out, done: !!p.doneAt,
      seed: p.board?.seed,
      sk: p.pb ? sketch(p.pb) : '',
    }));
    this.lastResult = { winner: winner?.id ?? null, reason };
    this.broadcast({ t: 'end', winner: winner?.id ?? null, reason, results });
    // drop seats whose players never came back
    this.players = this.players.filter((p) => p.conn);
    for (const p of this.players) p.ready = false;
    this.sync();
  }
}
