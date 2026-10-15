import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

globalThis.Worker = class { postMessage() {} terminate() {} };
const { BeastManager } = await import('../src/game/beasts.js');
const { Campaign, ACT1 } = await import('../src/game/campaign.js');
const { Game } = await import('../src/game/game.js');
const { DEFAULT_BINDINGS } = await import('../src/core/bindings.js');
const { newState } = await import('../src/game/state.js');

const noop = () => {};

test('a hunting beast keeps its wounds while the player is briefly invulnerable', () => {
  const scene = new THREE.Group();
  const particles = { burst: noop, emit: noop, converge: noop };
  const sound = new Proxy({}, { get: () => noop });
  const combat = { explosion: noop, debris: noop, shockwave: noop, fireEnemyBolt: noop, enemyShots: [] };
  const beasts = new BeastManager(scene, particles, combat, sound);
  beasts.species.set('w', { id: 'w', name: 'Wolf', arch: 'quad', variant: 'wolf', color: 0x555555, accent: 0x77aaff, radius: 2, hp: 0.5, dmg: 0.4, speed: 60, behavior: 'swarm', aggro: 240, walker: false, footing: 0.7 });
  const b = beasts.spawn('w', new THREE.Vector3(0, 0, -20), 0, { aggro: true });
  b.hp = b.maxHp * 0.2;
  const player = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), radius: 0.5 };
  // the game passes playerAlive: true during a dodge now (hurtPlayer ignores the hits itself)
  beasts.update(0.016, { player, playerAlive: true, time: 1, hurtPlayer: noop });
  assert.equal(b.aggro, true);
  assert.ok(b.hp < b.maxHp * 0.25, 'the beast must not heal back to full');
});

test('a save that finished the old Act I resumes the first new mission instead of getting stuck', () => {
  const mi = ACT1.findIndex((m) => m.id === 'worldbreaker');
  const st = { mi, si: 6, p: 0, wave: 0, started: true, done: ['tide'], act1Done: true };
  let started = 0;
  const c = Object.create(Campaign.prototype);
  Object.defineProperty(c, 'st', { get: () => st });
  c.startStep = () => { started++; };
  c.render = noop;
  c.planetary = {};
  c.resume();
  assert.equal(st.si, 0);
  assert.ok(c.step, 'the current step must exist');
  assert.equal(started, 1);
});

test('dodge is not bound to Ctrl, so Ctrl+W can never close the tab mid-fight', () => {
  assert.notEqual(DEFAULT_BINDINGS.dodge, 'ControlLeft');
  assert.notEqual(DEFAULT_BINDINGS.dodge, 'ControlRight');
  assert.equal(DEFAULT_BINDINGS.blink, undefined, 'Star Step shares the dodge key');
});

test('Escape on the pause screen points at Resume instead of failing to recapture the mouse', () => {
  let flashed = 0, resumed = 0;
  const g = {
    mode: 'playing', inGame: true, training: { busy: false, active: false },
    menus: { $: () => ({ classList: { contains: () => true } }), panelOpen: false, pauseOpen: true, flashPauseHint: () => { flashed++; } },
    resume: () => { resumed++; }, pause: noop,
  };
  Game.prototype.onKey.call(g, 'Escape');
  assert.equal(flashed, 1);
  assert.equal(resumed, 0);
});

test('a delivery received aboard a ship still counts for the story', () => {
  const events = [];
  const s = newState();
  const d = { id: 'd1', item: 'ore10', label: 'Star metal crate', due: 0 };
  s.deliveries = [d];
  const g = { state: s, pods: [], campaign: { event: (k) => events.push(k) }, sound: { pickup: noop }, hud: { notify: noop }, save: noop, removePod: noop };
  Game.prototype.receiveDelivery.call(g, d, true);
  assert.deepEqual(events, ['pod']);
  assert.equal(s.deliveries.length, 0);
});

test('a radar order with nothing better to install is refunded and cleared', () => {
  const s = newState();
  s.radar = 4;
  const coins = s.coins;
  const d = { id: 'd2', item: 'radar', label: 'Unknown Radar', radarTier: 9, price: 500, due: 0 };
  s.deliveries = [d];
  const g = { state: s, pods: [], campaign: { event: noop }, sound: { pickup: noop }, hud: { notify: noop }, save: noop, removePod: noop };
  Game.prototype.receiveDelivery.call(g, d, false);
  assert.equal(s.deliveries.length, 0);
  assert.equal(s.coins, coins + 500);
});
