import * as THREE from 'three';
import { settings } from '../core/settings.js';
import { REALMS } from '../game/data.js';
import { loadPlayerModel, SkinnedFigure } from '../game/player-model.js';
import { Ship } from '../game/ship.js';

// Multiplayer presence: everyone in the same star system and on the same world shares
// a room (a Durable Object behind /api/room). Each player sends where they are and how
// their body is moving a few times a second; the others are drawn as the same animated
// cultivator (or their ship), smoothed between updates, with a name over their head.
// Positions are in the world's own frame (a planet's surface, or the star system), so
// they mean the same place for everyone whatever the local time of day.

const SEND_MS = 100;       // while moving
const IDLE_MS = 1000;      // heartbeat while still
const DELAY_MS = 140;      // render this far behind the latest update, to always have two to blend
const tA = new THREE.Vector3(), tQ = new THREE.Quaternion();
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function defaultName() {
  return `Cultivator-${Math.floor(1000 + Math.random() * 9000)}`;
}

class RemotePlayer {
  constructor(root, id, name, realm) {
    this.id = id;
    this.name = name;
    this.realm = realm;
    this.snaps = [];
    this.root = new THREE.Group();
    this.figure = new THREE.Group();
    this.root.add(this.figure);
    root.add(this.root);
    this.parent = root;
    this.shipTier = -1;
    this.ship = null;
    this.said = null; // { text, until }
    loadPlayerModel().then((source) => {
      if (!source || this.gone) return;
      this.skin = new SkinnedFigure(source, this.figure);
      this.setRealm(this.realm);
      if (this.pendingBase) this.skin.setBase(...this.pendingBase);
    });
  }

  setRealm(realm) {
    this.realm = realm;
    const r = REALMS[Math.min(REALMS.length - 1, realm)] || REALMS[0];
    this.skin?.setGlow(new THREE.Color(r.color), 0.35 + realm * 0.07);
  }

  push(s, now) {
    this.snaps.push({ t: now, p: new THREE.Vector3(...s.p), q: new THREE.Quaternion(...s.q).normalize(), fy: s.fy, tl: s.tl, bk: s.bk });
    if (this.snaps.length > 12) this.snaps.shift();
    if (s.realm !== this.realm) this.setRealm(s.realm);
    if (this.skin) this.skin.setBase(s.b || {}, s.r || {});
    else this.pendingBase = [s.b || {}, s.r || {}];
    if (this.skin) for (const [name, speed, full] of s.ev || []) this.skin.play(name, { speed, full });
    this.mode = s.m;
    if (s.sh !== this.shipTier) {
      this.shipTier = s.sh;
      if (this.ship) { this.ship.dispose(); this.ship = null; }
      if (s.sh >= 0) this.ship = new Ship(this.parent, s.sh);
    }
  }

  // where they were DELAY_MS ago, blended between the two updates around then
  update(dt, now) {
    const S = this.snaps;
    if (!S.length) return;
    const t = now - DELAY_MS;
    let a = S[0], b = S[0];
    for (let i = 0; i < S.length - 1; i++) {
      if (S[i].t <= t && S[i + 1].t >= t) { a = S[i]; b = S[i + 1]; break; }
      if (S[i + 1].t < t) { a = b = S[i + 1]; }
    }
    const k = b.t > a.t ? THREE.MathUtils.clamp((t - a.t) / (b.t - a.t), 0, 1) : 1;
    const pos = tA.copy(a.p).lerp(b.p, k);
    const q = tQ.copy(a.q).slerp(b.q, k);
    const inShip = this.shipTier >= 0 && this.ship;
    this.root.visible = !inShip;
    if (inShip) {
      this.ship.pos.copy(pos);
      this.ship.quat.copy(q);
      this.ship.sync();
      this.ship.model.setThrust?.(0.6);
    } else {
      this.root.position.copy(pos);
      this.root.quaternion.copy(q);
      this.figure.position.y = THREE.MathUtils.lerp(a.fy, b.fy, k);
      this.figure.rotation.set(-THREE.MathUtils.lerp(a.tl, b.tl, k), THREE.MathUtils.lerp(a.bk, b.bk, k), 0, 'XYZ');
      this.skin?.update(dt);
    }
    this.at = inShip ? this.ship.pos : this.root.position;
  }

  dispose() {
    this.gone = true;
    this.parent.remove(this.root);
    // the body's materials are shared with your own; only its skeleton (a GPU bone texture) is its own
    this.root.traverse((o) => { if (o.isSkinnedMesh && o.skeleton) o.skeleton.dispose(); });
    if (this.ship) { this.ship.dispose(); this.ship = null; }
  }
}

export class Net {
  constructor(game) {
    this.game = game;
    this.ws = null;
    this.key = null;
    this.id = null;
    this.peers = new Map();
    this.retryAt = 0;
    this.backoff = 2000;
    this.sentAt = 0;
    this.last = null;
    if (!settings.get('playerName')) settings.set('playerName', defaultName());
    this.buildChat();
    settings.onChange((k) => {
      if (k === 'online' && !settings.get('online')) this.disconnect();
      if (k === 'playerName' && this.ws) this.disconnect(); // reconnect under the new name
    });
  }

  get online() { return !!(this.ws && this.ws.readyState === 1 && this.id); }
  get count() { return this.peers.size; }

  // which room you belong in right now, or null for none
  roomKey() {
    const g = this.game;
    if (!settings.get('online') || !g.star) return null;
    if (g.mode !== 'playing' && g.mode !== 'dead') return null;
    const f = g.frame;
    return `${g.star.key}:${f ? f.body.id : 'space'}`;
  }

  connect(key) {
    this.disconnect();
    this.key = key;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    let ws;
    try { ws = new WebSocket(`${proto}://${location.host}/api/room?key=${encodeURIComponent(key)}`); } catch { this.fail(); return; }
    this.ws = ws;
    ws.onopen = () => {
      ws.send(JSON.stringify({ t: 'hi', name: settings.get('playerName'), realm: this.game.state.realm }));
    };
    ws.onmessage = (e) => { try { this.receive(JSON.parse(e.data)); } catch { /* ignore a bad message */ } };
    ws.onclose = () => { if (this.ws === ws) { this.clearPeers(); this.ws = null; this.id = null; this.fail(); } };
    ws.onerror = () => { /* onclose follows */ };
  }

  fail() {
    this.retryAt = performance.now() + this.backoff;
    this.backoff = Math.min(60000, this.backoff * 2);
  }

  disconnect() {
    const ws = this.ws;
    this.ws = null;
    this.id = null;
    this.key = null;
    this.clearPeers();
    if (ws) { try { ws.close(1000, 'leaving'); } catch { /* closed */ } }
  }

  clearPeers() {
    for (const p of this.peers.values()) p.dispose();
    this.peers.clear();
  }

  addPeer(id, name, realm) {
    let p = this.peers.get(id);
    if (!p) { p = new RemotePlayer(this.game.localRoot, id, name, realm); this.peers.set(id, p); }
    return p;
  }

  receive(m) {
    const now = performance.now();
    if (m.t === 'w') {
      this.id = m.id;
      this.backoff = 2000;
      for (const peer of m.peers) {
        const p = this.addPeer(peer.id, peer.name, peer.realm);
        if (peer.s) p.push(peer.s, now);
      }
      if (m.peers.length) this.game.hud.notify(`${m.peers.length === 1 ? '<b>1</b> other cultivator is' : `<b>${m.peers.length}</b> other cultivators are`} here. Press <kbd>Enter</kbd> to talk.`, 'chat');
    } else if (m.t === 'j') {
      this.addPeer(m.id, m.name, m.realm);
      this.game.hud.notify(`<b>${esc(m.name)}</b> arrived.`, 'chat');
    } else if (m.t === 's') {
      const p = this.peers.get(m.id) || this.addPeer(m.id, '…', m.realm);
      p.push(m, now);
    } else if (m.t === 'c') {
      const p = this.peers.get(m.id);
      if (p) p.said = { text: m.text, until: now + 7000 };
      if (settings.get('chat')) this.game.hud.notify(`<b>${esc(m.name)}</b>: ${esc(m.text)}`, 'chat');
    } else if (m.t === 'l') {
      const p = this.peers.get(m.id);
      if (p) { this.game.hud.notify(`<b>${esc(p.name)}</b> left.`, 'chat'); p.dispose(); this.peers.delete(m.id); }
    } else if (m.t === 'full') {
      this.game.hud.notify('This world is full of cultivators right now; you are on your own here.', 'chat');
      this.backoff = 60000;
    }
  }

  // what your body is doing now, as the room expects it
  myState() {
    const g = this.game, p = g.player, rt = g.rt;
    const ship = rt.inShip && g.shipObj ? g.shipObj : null;
    const pos = ship ? ship.pos : p.root.position;
    const q = ship ? ship.quat : p.root.quaternion;
    const sk = p.skin;
    const r2 = (v) => Math.round(v * 100) / 100;
    const b = {}, r = {};
    if (sk && sk.lastBase) {
      const top = Object.entries(sk.lastBase).filter(([, w]) => w > 0.04).sort((x, y) => y[1] - x[1]).slice(0, 4);
      for (const [n, w] of top) { b[n] = r2(w); if (sk.lastRates?.[n] !== undefined) r[n] = r2(sk.lastRates[n]); }
    }
    const ev = sk && sk.events ? sk.events.splice(0, 4) : [];
    return {
      t: 's', p: [r2(pos.x), r2(pos.y), r2(pos.z)], q: [q.x, q.y, q.z, q.w].map((v) => Math.round(v * 1e4) / 1e4),
      fy: r2(p.figure.position.y), tl: r2(p.tilt || 0), bk: r2(p.bank || 0), b, r, ev,
      m: p.mode === 'ground' ? 'g' : p.mode === 'fly' ? 'f' : 's', sh: ship ? ship.tier : -1, realm: g.state.realm,
    };
  }

  update(dt) {
    const now = performance.now();
    const key = this.roomKey();
    if (key !== this.key || (!this.ws && key && now >= this.retryAt)) {
      if (!key) this.disconnect();
      else if (key !== this.key || !this.ws) { this.backoff = key !== this.key ? 2000 : this.backoff; this.connect(key); }
    }
    for (const p of this.peers.values()) p.update(dt, now);
    if (!this.online) return;
    const s = this.myState();
    const moved = !this.last || s.ev.length || Math.abs(s.p[0] - this.last.p[0]) + Math.abs(s.p[1] - this.last.p[1]) + Math.abs(s.p[2] - this.last.p[2]) > 0.03
      || Math.abs(s.q[0] - this.last.q[0]) + Math.abs(s.q[3] - this.last.q[3]) > 0.002 || JSON.stringify(s.b) !== JSON.stringify(this.last.b);
    if (now - this.sentAt >= (moved ? SEND_MS : IDLE_MS)) {
      this.ws.send(JSON.stringify(s));
      this.sentAt = now;
      this.last = s;
    } else if (s.ev.length) {
      // keep one-shot moves for the next send
      this.game.player.skin?.events?.unshift(...s.ev);
    }
  }

  // name tags for the HUD, nearest first
  markers(list, origin) {
    const g = this.game, now = performance.now();
    const near = [...this.peers.values()].filter((p) => p.at).map((p) => [p.at.distanceTo(origin), p]).sort((a, b) => a[0] - b[0]);
    for (const [d, p] of near.slice(0, 16)) {
      if (d > 4000) break;
      const up = tA.copy(p.at).normalize();
      const head = p.at.clone().addScaledVector(g.frame ? up : new THREE.Vector3(0, 1, 0), p.shipTier >= 0 ? 9 : 0.45);
      const r = REALMS[Math.min(REALMS.length - 1, p.realm)] || REALMS[0];
      const said = p.said && p.said.until > now ? `“${esc(p.said.text)}”` : `${esc(r.name.toUpperCase())} · ${Math.round(d)} M`;
      list.push({ key: `b:pl:${p.id}`, kind: 'player', label: esc(p.name), sub: said, pos: g.toWorld(head), dist: d, edge: false });
    }
  }

  // ---- chat
  buildChat() {
    const box = document.createElement('div');
    box.id = 'chat-box';
    box.className = 'hidden';
    box.innerHTML = '<input id="chat-input" type="text" maxlength="160" autocomplete="off" spellcheck="false" placeholder="Say something · Enter sends · Esc closes">';
    document.body.appendChild(box);
    this.chatBox = box;
    this.chatInput = box.querySelector('input');
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'Enter' || e.target === this.chatInput) return;
      if (!this.online || !settings.get('chat') || this.game.mode !== 'playing' || !this.game.input.locked) return;
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      e.preventDefault();
      this.openChat();
    });
    this.chatInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.code === 'Enter') {
        const text = this.chatInput.value.trim();
        if (text && this.online) {
          this.ws.send(JSON.stringify({ t: 'c', text }));
          this.game.hud.notify(`<b>${esc(settings.get('playerName'))}</b>: ${esc(text.slice(0, 160))}`, 'chat');
        }
        this.closeChat();
      } else if (e.code === 'Escape') this.closeChat();
    });
    this.chatInput.addEventListener('blur', () => this.closeChat());
  }

  openChat() {
    const inp = this.game.input;
    for (const k of [...inp.keys]) { inp.keys.delete(k); inp.released.add(k); }
    this.chatBox.classList.remove('hidden');
    this.chatInput.value = '';
    this.chatInput.focus();
  }

  closeChat() {
    if (this.chatBox.classList.contains('hidden')) return;
    this.chatBox.classList.add('hidden');
    this.chatInput.blur();
  }
}
