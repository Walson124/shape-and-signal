import '../platform/base.css';
import './mines.css';
import { topbar, toast, copyText, savedName, saveName, esc, store, css } from '../platform/shell.js';
import { PRESETS, STUN_MS, makeBoard, newPlayerBoard, applyMove, isCleared, progress, fmtTime, randomSeed, HIDDEN, OPEN, FLAG, BOOM } from './core.js';
import { BoardView, drawSketch } from './board-view.js';
import { Link, newRoomCode } from './link.js';

topbar('Minesweeper Duel');

const $ = (id) => document.getElementById(id);
const EMOTES = { gg: 'gg', nice: 'nice!', oops: 'oops', hurry: 'hurry up', wow: 'wow', 'rematch?': 'rematch?' };
const BEST_KEY = (p) => `sas:mines:best:${p}`;

// ------------------------------------------------------------------ state

const S = {
  screen: 'home',
  link: null,
  code: null,
  me: null,               // my player id in the room
  room: null,             // last 'room' message
  opps: new Map(),        // id -> { name, prog, booms, stun, out, done, sk, el }
  // the round being played (duel or solo)
  solo: false,
  soloPreset: store.get('sas:mines:solo') || 'beginner',
  board: null, pb: null, n: 0,
  startAt: 0, endAt: 0, stunUntil: 0, out: false, cleared: false, over: false,
  cfg: null,
  results: null,
};

const view = new BoardView($('board-wrap'), { onMove: playMove });

function show(screen) {
  S.screen = screen;
  for (const id of ['home', 'lobby', 'game']) $(id).classList.toggle('hidden', id !== screen);
  window.scrollTo(0, 0);
}

function netbar(text, kind = '') {
  const el = $('netbar');
  el.className = `netbar ${kind}`;
  el.textContent = text || '';
  el.classList.toggle('hidden', !text);
}

// ------------------------------------------------------------------ home

$('name').value = savedName().slice(0, 16);
const params = new URLSearchParams(location.search);
if (params.get('room')) $('code').value = params.get('room').toUpperCase();

function myName() {
  const n = $('name').value.trim();
  if (!n) { $('name').focus(); toast('Pick a name first'); return null; }
  saveName(n);
  return n;
}

$('create').addEventListener('click', () => {
  const name = myName();
  if (name) enterRoom(newRoomCode(), name);
});
$('join-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const code = $('code').value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length < 4) { $('code').focus(); toast('Enter the room code'); return; }
  const name = myName();
  if (name) enterRoom(code, name);
});

function segment(el, options, value, onPick) {
  el.innerHTML = options.map(([v, label]) => `<button type="button" data-v="${v}" aria-pressed="${v === value}">${esc(label)}</button>`).join('');
  el.onclick = (e) => {
    const b = e.target.closest('button[data-v]');
    if (!b || b.disabled) return;
    onPick(b.dataset.v);
  };
}
const presetOptions = Object.entries(PRESETS).map(([k, p]) => [k, `${p.label} · ${p.w}×${p.h}`]);
const setPressed = (el, v) => el.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === v)));

segment($('solo-preset'), presetOptions, S.soloPreset, (v) => {
  S.soloPreset = v;
  store.set('sas:mines:solo', v);
  setPressed($('solo-preset'), v);
});
$('solo').addEventListener('click', () => startSolo());

function drawBests() {
  $('bests').innerHTML = Object.entries(PRESETS).map(([k, p]) => {
    const b = Number(store.get(BEST_KEY(k)));
    return `<div><dt>${p.label}</dt><dd class="mono">${b ? fmtTime(b) : '–'}</dd></div>`;
  }).join('');
}
drawBests();

// auto-join from an invite link when we already know the player's name
if (params.get('room') && savedName()) {
  const code = params.get('room').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length >= 4) enterRoom(code, savedName().slice(0, 16));
}

// ------------------------------------------------------------------ room

function enterRoom(code, name) {
  S.link?.close();
  S.code = code;
  S.me = null;
  S.room = null;
  S.opps.clear();
  history.replaceState(null, '', `?room=${code}`);
  $('room-code').textContent = code;
  S.link = new Link(code, name, { onMessage, onStatus });
  show('lobby');
  renderLobby();
}

function leaveRoom() {
  S.link?.close();
  S.link = null;
  S.code = null;
  S.room = null;
  S.solo = false;
  stopRound();
  history.replaceState(null, '', location.pathname);
  netbar('');
  show('home');
}
$('leave').addEventListener('click', leaveRoom);

function onStatus(s) {
  if (s === 'online') netbar('');
  else if (s === 'connecting') netbar('Connecting…');
  else if (s === 'reconnecting') netbar('Connection lost. Reconnecting…', 'warn');
  else if (s === 'unreachable') {
    netbar('');
    toast('Couldn\'t reach the game server. Practice mode still works.', 4000);
    leaveRoom();
  } else if (s === 'idle') {
    netbar('');
    toast('You left the room after 20 minutes without playing.', 5000);
    leaveRoom();
  } else if (s === 'lost') {
    netbar('');
    toast('Lost the connection to the room.', 4000);
    leaveRoom();
  }
}

const inviteUrl = () => `${location.origin}${location.pathname}?room=${S.code}`;
$('copy-link').addEventListener('click', async () => {
  toast(await copyText(inviteUrl()) ? 'Invite link copied' : inviteUrl(), 3000);
});
if (navigator.share) {
  $('share-link').classList.remove('hidden');
  $('share-link').addEventListener('click', () => navigator.share({ title: 'Minesweeper Duel', text: `Race me at Minesweeper! Room ${S.code}`, url: inviteUrl() }).catch(() => {}));
}

segment($('cfg-preset'), presetOptions.map(([k]) => [k, PRESETS[k].label]), 'intermediate', (v) => sendCfg({ preset: v }));
$('cfg-boards').onclick = (e) => { const b = e.target.closest('button[data-v]'); if (b && !b.disabled) sendCfg({ boards: b.dataset.v }); };
$('cfg-onmine').onclick = (e) => { const b = e.target.closest('button[data-v]'); if (b && !b.disabled) sendCfg({ onMine: b.dataset.v }); };
function sendCfg(part) {
  if (!S.room) return;
  S.link?.send({ t: 'cfg', ...S.room.cfg, ...part });
}

const meReady = () => !!S.room?.players.find((p) => p.id === S.me)?.ready;
$('ready').addEventListener('click', () => S.link?.send({ t: 'ready', on: !meReady() }));

function renderLobby() {
  const r = S.room;
  const isHost = r && r.host === S.me;
  const list = $('players');
  if (!r) {
    list.innerHTML = '<li class="empty">Joining…</li>';
    $('ready').disabled = true;
    return;
  }
  const slots = [];
  for (const p of r.players) {
    slots.push(`<li class="${p.online ? '' : 'away'}">
      <span class="avatar" style="--h:${hue(p.id)}">${esc(p.name.slice(0, 1).toUpperCase())}</span>
      <span class="pname">${esc(p.name)}${p.id === S.me ? ' <span class="muted">(you)</span>' : ''}${p.id === r.host ? ' <span class="pill accent">host</span>' : ''}</span>
      <span class="wins mono" title="Rounds won">${p.wins ? `${p.wins} 🏆` : ''}</span>
      <span class="pill ${p.ready ? 'good' : ''}">${p.online ? (p.ready ? 'Ready' : 'Not ready') : 'Away'}</span>
    </li>`);
  }
  for (let i = r.players.length; i < 4; i++) slots.push(`<li class="empty">${i === 1 ? 'Waiting for a friend… send them the code or link' : 'Open seat'}</li>`);
  list.innerHTML = slots.join('');

  setPressed($('cfg-preset'), r.cfg.preset);
  setPressed($('cfg-boards'), r.cfg.boards);
  setPressed($('cfg-onmine'), r.cfg.onMine);
  for (const el of document.querySelectorAll('#cfg-preset button, #cfg-boards button, #cfg-onmine button')) el.disabled = !isHost;
  $('host-note').textContent = isHost ? '' : '· the host picks';
  const pr = PRESETS[r.cfg.preset];
  $('cfg-blurb').textContent = `${pr.w}×${pr.h} with ${pr.mines} mines. ${r.cfg.boards === 'same'
    ? 'Everyone plays the same mines; you see each other\'s progress, not their boards.'
    : 'Everyone gets their own board; you can watch each other\'s boards fill in.'} ${r.cfg.onMine === 'stun'
    ? 'A mine freezes you for 5 seconds.' : 'A mine knocks you out; last one standing wins.'}`;

  const ready = meReady();
  $('ready').disabled = false;
  $('ready').textContent = ready ? 'Not ready' : 'Ready';
  $('ready').classList.toggle('primary', !ready);
  const here = r.players.filter((p) => p.online);
  const waiting = here.filter((p) => !p.ready).map((p) => p.name);
  $('lobby-status').textContent = here.length < 2 ? 'Need at least 2 players.'
    : waiting.length ? `Waiting for ${andList(waiting)}…` : 'Starting…';
}

function hue(id) {
  let h = 0;
  for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

function onMessage(m) {
  if (m.t === 'welcome') {
    S.me = m.you;
  } else if (m.t === 'room') {
    S.room = m;
    for (const p of m.players) {
      const o = S.opps.get(p.id);
      if (o) { o.name = p.name; o.online = p.online; }
    }
    if (S.screen === 'lobby') renderLobby();
    if (S.screen === 'game') { renderOpps(); renderResultWait(); }
  } else if (m.t === 'start') {
    startRound(m);
  } else if (m.t === 'p') {
    onProgress(m);
  } else if (m.t === 'rej') {
    resync(m);
  } else if (m.t === 'end') {
    endRound(m);
  } else if (m.t === 'emote') {
    showEmote(m.id, m.e);
  } else if (m.t === 'full') {
    toast('That room is full (4 players).', 3500);
    leaveRoom();
  } else if (m.t === 'busy') {
    toast('That room is mid-round. Try again in a minute.', 3500);
    leaveRoom();
  } else if (m.t === 'err') {
    toast(m.text);
  }
}

// ------------------------------------------------------------------ rounds

function setupBoard(preset, seed) {
  const { w, h, mines } = PRESETS[preset];
  S.board = makeBoard(w, h, mines, seed);
  S.pb = newPlayerBoard(S.board);
  S.n = 0;
  S.stunUntil = 0;
  S.out = false;
  S.cleared = false;
  S.over = false;
  S.results = null;
  S.endAt = 0;
  view.setBoard(S.board, S.pb);
  $('result').classList.add('hidden');
  $('board-wrap').classList.remove('blur', 'dead');
  updateHud();
}

function startRound(m) {
  S.solo = false;
  S.cfg = m.cfg;
  setupBoard(m.cfg.preset, m.seed);
  S.startAt = performance.now() + (m.in || 0) - (m.elapsed || 0);
  S.opps.clear();
  for (const p of S.room?.players || []) {
    if (p.id !== S.me) S.opps.set(p.id, { name: p.name, online: p.online, prog: 0, booms: 0, stun: 0, out: false, done: false, sk: null });
  }
  show('game');
  renderOpps();
  $('emotes').classList.remove('hidden');
  tick();
}

function startSolo() {
  S.link?.close();
  S.link = null;
  S.room = null;
  S.solo = true;
  S.cfg = { preset: S.soloPreset, boards: 'same', onMine: 'out' };
  S.opps.clear();
  setupBoard(S.soloPreset, randomSeed());
  S.startAt = performance.now() + 1500;
  show('game');
  renderOpps();
  $('emotes').classList.add('hidden');
  tick();
}

function stopRound() {
  S.board = null;
  view.enabled = false;
}

const playing = () => S.board && !S.over && !S.out && !S.cleared && performance.now() >= S.startAt;

function playMove(mv) {
  if (!playing()) return;
  if (performance.now() < S.stunUntil) return;
  const r = applyMove(S.board, S.pb, mv);
  if (!r.ok) return;
  const changed = r.opened.length > 0 || r.boom >= 0 || r.flag !== undefined;
  if (!changed) return;
  view.drawSome(r.opened.length ? r.opened : [mv.i]);
  if (!S.solo) S.link?.send({ t: 'mv', a: mv.a, i: mv.i, n: S.n });
  S.n++;
  if (r.boom >= 0) {
    view.flash('boom');
    navigator.vibrate?.(80);
    if (S.cfg.onMine === 'out') {
      S.out = true;
      S.endAt = performance.now();
      view.showMines();
      $('board-wrap').classList.add('dead');
      if (S.solo) soloOver(false);
    } else {
      S.stunUntil = performance.now() + STUN_MS;
    }
  }
  if (isCleared(S.board, S.pb)) {
    S.cleared = true;
    S.endAt = performance.now();
    view.flash('win');
    if (S.solo) soloOver(true);
  }
  updateHud();
}

// the server saw our board differently (a move during a freeze, a lost message): take its version
function resync(m) {
  if (!S.board || typeof m.cells !== 'string' || m.cells.length !== S.pb.cell.length) return;
  const map = { h: HIDDEN, o: OPEN, f: FLAG, x: BOOM };
  S.pb.opened = 0; S.pb.flags = 0; S.pb.booms = 0;
  for (let i = 0; i < m.cells.length; i++) {
    const c = map[m.cells[i]] ?? HIDDEN;
    S.pb.cell[i] = c;
    if (c === OPEN) S.pb.opened++;
    else if (c === FLAG) S.pb.flags++;
    else if (c === BOOM) S.pb.booms++;
  }
  S.n = m.n;
  if (m.stun) S.stunUntil = performance.now() + m.stun;
  S.cleared = isCleared(S.board, S.pb);
  view.drawAll();
  updateHud();
}

function updateHud() {
  if (!S.board) return;
  $('left').textContent = S.board.mines - S.pb.flags - S.pb.booms;
  $('my-bar').style.width = `${(progress(S.board, S.pb) * 100).toFixed(1)}%`;
}

function tick() {
  if (!S.board || S.screen !== 'game') return;
  const now = performance.now();
  const before = now < S.startAt;
  const cd = $('countdown');
  if (before) {
    cd.classList.remove('hidden');
    const sec = Math.ceil((S.startAt - now) / 1000);
    const span = cd.querySelector('span');
    if (span.textContent !== String(sec)) { span.textContent = sec; span.style.animation = 'none'; void span.offsetWidth; span.style.animation = ''; }
    $('board-wrap').classList.add('blur');
  } else if (!cd.classList.contains('hidden')) {
    cd.classList.add('hidden');
    $('board-wrap').classList.remove('blur');
  }
  const end = S.over || S.out || S.cleared ? (S.endAt || now) : now;
  $('timer').textContent = fmtTime(before ? 0 : end - S.startAt);
  const stunLeft = S.stunUntil - now;
  $('stun').classList.toggle('hidden', !(stunLeft > 0) || S.over);
  if (stunLeft > 0) $('stun').querySelector('span').textContent = `${(stunLeft / 1000).toFixed(1)} s`;
  view.enabled = playing() && stunLeft <= 0;
  for (const [, o] of S.opps) {
    if (!o.el) continue;
    const st = o.el.querySelector('.ostat');
    const txt = oppStatus(o, now);
    if (st.textContent !== txt) st.textContent = txt;
  }
  requestAnimationFrame(tick);
}

// ------------------------------------------------------------------ opponents

function oppStatus(o, now) {
  if (o.done) return `Cleared · ${fmtTime(o.time)}`;
  if (o.out) return 'Out';
  if (!o.online) return 'Away…';
  if (o.stunAt && now < o.stunAt) return `Frozen ${((o.stunAt - now) / 1000).toFixed(1)} s`;
  return `${Math.round(o.prog * 100)}%`;
}

function renderOpps() {
  const box = $('opps');
  if (S.solo) {
    const best = Number(store.get(BEST_KEY(S.cfg.preset)));
    box.innerHTML = `<div class="card opp solo-card"><div class="oname">Practice · ${PRESETS[S.cfg.preset].label}</div>
      <div class="muted small">Best: <span class="mono">${best ? fmtTime(best) : 'none yet'}</span></div>
      <div class="solo-actions"><button class="btn small" id="solo-restart">New board</button><button class="btn small ghost" id="solo-home">Back</button></div></div>`;
    $('solo-restart').onclick = () => startSolo();
    $('solo-home').onclick = () => { S.solo = false; stopRound(); show('home'); drawBests(); };
    return;
  }
  const showSketch = S.cfg?.boards === 'different';
  box.innerHTML = '';
  for (const [id, o] of S.opps) {
    const el = document.createElement('div');
    el.className = 'card opp';
    el.innerHTML = `
      <div class="ohead"><span class="avatar" style="--h:${hue(id)}">${esc(o.name.slice(0, 1).toUpperCase())}</span><span class="oname">${esc(o.name)}</span><span class="ostat mono"></span></div>
      <div class="bar"><i style="width:${(o.prog * 100).toFixed(1)}%"></i></div>
      ${showSketch || S.over ? '<div class="sketch"><canvas></canvas></div>' : ''}
      <div class="obubble hidden"></div>`;
    o.el = el;
    box.append(el);
    if (showSketch || S.over) paintSketch(o);
    el.classList.toggle('done', o.done);
    el.classList.toggle('out', o.out);
  }
  if (!S.opps.size) box.innerHTML = '<div class="muted small">No opponents left in the room.</div>';
}

const sketchColors = () => ({ hidden: css('--cell'), open: css('--surface-2'), flag: css('--warn'), boom: css('--bad') });
const andList = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
function paintSketch(o) {
  const cv = o.el?.querySelector('canvas');
  if (cv && S.board) drawSketch(cv, S.board.w, S.board.h, o.sk, sketchColors());
}

function onProgress(m) {
  if (m.id === S.me) return;
  const o = S.opps.get(m.id);
  if (!o) return;
  Object.assign(o, { prog: m.prog, booms: m.booms, out: m.out, done: m.done, time: m.time });
  if (m.stun > 0) o.stunAt = performance.now() + m.stun;
  if (m.sk) o.sk = m.sk;
  if (!o.el) return;
  o.el.querySelector('.bar i').style.width = `${(m.prog * 100).toFixed(1)}%`;
  o.el.classList.toggle('done', m.done);
  o.el.classList.toggle('out', m.out);
  if (m.sk) paintSketch(o);
}

// ------------------------------------------------------------------ emotes

$('emotes').innerHTML = Object.entries(EMOTES).map(([k, v]) => `<button class="btn small ghost" data-e="${k}">${esc(v)}</button>`).join('');
$('emotes').addEventListener('click', (e) => {
  const b = e.target.closest('[data-e]');
  if (!b) return;
  S.link?.send({ t: 'emote', e: b.dataset.e });
  showEmote(S.me, b.dataset.e);
});

function showEmote(id, e) {
  const text = EMOTES[e];
  if (!text) return;
  if (id === S.me) { toast(`You: ${text}`, 1200); return; }
  const o = S.opps.get(id);
  const bub = o?.el?.querySelector('.obubble');
  if (!bub) return;
  bub.textContent = text;
  bub.classList.remove('hidden');
  clearTimeout(o.bubT);
  o.bubT = setTimeout(() => bub.classList.add('hidden'), 2200);
}

// ------------------------------------------------------------------ results

function endRound(m) {
  S.over = true;
  if (!S.endAt) S.endAt = performance.now();
  view.enabled = false;
  view.showMines();
  S.results = m;
  for (const r of m.results) {
    const o = S.opps.get(r.id);
    if (o) Object.assign(o, { prog: r.prog, done: r.done, out: r.out, time: r.time, sk: r.sk });
  }
  renderOpps();
  const won = m.winner === S.me;
  const winner = m.results.find((r) => r.id === m.winner);
  $('result-title').textContent = won ? 'You win! 🎉' : winner ? `${winner.name} wins` : 'Nobody made it';
  $('result-sub').textContent = m.reason === 'cleared' ? (won ? 'First to clear the board.' : `${winner.name} cleared the board first.`)
    : m.reason === 'last' ? (won ? 'Everyone else hit a mine.' : `${winner.name} was the last one standing.`)
    : 'Everyone hit a mine.';
  const rows = [...m.results].sort((a, b) => (b.done - a.done) || (a.done ? a.time - b.time : b.prog - a.prog));
  $('result-table').innerHTML = `<thead><tr><th></th><th>Player</th><th>Time</th><th>Cleared</th><th>Mines hit</th></tr></thead><tbody>${rows.map((r, k) => `
    <tr class="${r.id === m.winner ? 'win' : ''}"><td class="mono">${k + 1}</td><td>${esc(r.name)}${r.id === S.me ? ' <span class="muted">(you)</span>' : ''}</td>
    <td class="mono">${r.done ? fmtTime(r.time) : '–'}</td><td class="mono">${Math.round(r.prog * 100)}%</td><td class="mono">${r.booms}</td></tr>`).join('')}</tbody>`;
  $('result-again').textContent = 'Play again';
  $('result-lobby').classList.remove('hidden');
  showResult();
  if (won) view.flash('win');
}

function soloOver(won) {
  S.over = true;
  const t = S.endAt - S.startAt;
  let sub = won ? `Cleared in ${fmtTime(t)}.` : `${Math.round(progress(S.board, S.pb) * 100)}% cleared before the mine.`;
  if (won) {
    const key = BEST_KEY(S.cfg.preset), best = Number(store.get(key));
    if (!best || t < best) { store.set(key, String(Math.round(t))); sub += best ? ' New best!' : ' That\'s your first best time.'; }
    else sub += ` Best: ${fmtTime(best)}.`;
  }
  $('result-title').textContent = won ? 'Cleared! 🎉' : 'Boom 💥';
  $('result-sub').textContent = sub;
  $('result-table').innerHTML = '';
  $('result-wait').textContent = '';
  $('result-again').textContent = 'New board';
  $('result-lobby').classList.add('hidden');
  setTimeout(showResult, won ? 500 : 900);
}

function showResult() {
  $('result').classList.remove('hidden');
  $('results-fab')?.remove();
  renderResultWait();
}

function renderResultWait() {
  if (S.solo || !S.over || !S.room) { $('result-wait').textContent = ''; return; }
  const ready = meReady();
  $('result-again').textContent = ready ? 'Waiting… (cancel)' : 'Play again';
  const here = S.room.players.filter((p) => p.online);
  const notReady = here.filter((p) => !p.ready).map((p) => (p.id === S.me ? 'you' : p.name));
  $('result-wait').textContent = here.length < 2 ? 'Everyone else left the room.' : notReady.length ? `Waiting for ${andList(notReady)} to play again.` : 'Starting…';
}

$('result-again').addEventListener('click', () => {
  if (S.solo) { startSolo(); return; }
  S.link?.send({ t: 'ready', on: !meReady() });
});
$('result-lobby').addEventListener('click', () => { show('lobby'); renderLobby(); });
$('result-close').addEventListener('click', () => {
  $('result').classList.add('hidden');
  const fab = document.createElement('button');
  fab.id = 'results-fab';
  fab.className = 'btn primary results-fab';
  fab.textContent = 'Results';
  fab.onclick = showResult;
  $('game').append(fab);
});

$('flag-mode').addEventListener('click', () => {
  view.flagMode = !view.flagMode;
  $('flag-mode').setAttribute('aria-pressed', String(view.flagMode));
});

window.addEventListener('themechange', () => { for (const [, o] of S.opps) paintSketch(o); });
