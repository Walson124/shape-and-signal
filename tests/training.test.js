import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
globalThis.Worker = class { postMessage() {} terminate() {} };
const { TrainingGround, TRAINING_STAR, trainingState } = await import('../src/game/training.js');
const { generateSystem } = await import('../src/world/systemgen.js');
const { newState, derive } = await import('../src/game/state.js');
const { Game } = await import('../src/game/game.js');
const { ALL_NODES, PATH_IDS } = await import('../src/game/paths.js');

test('training generates exactly one non-Terra world with a hub and discoveries', () => {
  const sys = generateSystem(TRAINING_STAR);
  assert.equal(sys.bodies.length, 1);
  const body = sys.bodies[0];
  assert.equal(body.type, 'crystal');
  assert.notEqual(body.name, 'Terra');
  assert.ok(body.sites.city.main);
  assert.ok(body.pois.length > 0);
  assert.equal(sys.boss, null);
});

test('training loadout owns every weapon, skill and crafting grade independently', () => {
  const original = newState();
  const s = trainingState(7, 3);
  assert.equal(s.realm, 7);
  assert.equal(s.stage, 3);
  for (const id of PATH_IDS) assert.ok(id === 'fist' || s.weapons.includes(id));
  for (const node of ALL_NODES) assert.equal(s.skills[node.id], node.max);
  assert.equal(s.ring.tier, 4);
  assert.equal(s.ring.items.tent.qty, 99);
  assert.ok(Object.values(s.ring.items).some((it) => it.grade === 9));
  assert.deepEqual(original.weapons, []);
  assert.deepEqual(original.ring.items, {});
});

test('training refuses autosave before touching real storage or character location', () => {
  let written = false;
  globalThis.localStorage = { setItem() { written = true; } };
  const state = trainingState();
  assert.equal(Game.prototype.save.call({ training: { active: true }, state }), false);
  assert.equal(written, false);
  assert.equal(state.loc, null);
  delete globalThis.localStorage;
});

test('training controls clamp invalid settings and ignore unknown options', () => {
  const t = new TrainingGround({});
  t.set('realm', 999);
  assert.equal(t.options.realm, 9);
  t.set('count', -4);
  assert.equal(t.options.count, 1);
  t.set('count', 'bad');
  assert.equal(t.options.count, 1);
  t.set('weapon', 'invalid');
  assert.equal(t.options.weapon, 'fist');
  t.set('surprise', 10);
  assert.equal(t.options.surprise, undefined);
});

function fixture() {
  const elements = new Map();
  globalThis.document = { getElementById(id) {
    if (!elements.has(id)) elements.set(id, { classList: { add() {}, remove() {}, toggle() {} } });
    return elements.get(id);
  } };
  const writes = [];
  globalThis.localStorage = { setItem(key, value) { writes.push(JSON.parse(value)); } };
  const source = { star: { key: 'home' }, root: new THREE.Group() };
  const state = newState();
  state.coins = 321;
  const g = {
    mode: 'virtual', state, system: source, star: source.star, frame: null,
    scene: new THREE.Scene(), localRoot: new THREE.Group(),
    player: { pos: new THREE.Vector3(1, 2, 3), quat: new THREE.Quaternion(), mode: 'ground', setRealm() {} },
    rt: { hp: 77, energy: 23, spirit: 41, cooldowns: { punch: 0.3 }, blinkCd: 1, undyingCd: 2 },
    menus: { closePanel() {}, showLoading() {} }, input: { unlock() {} },
    campaign: { cleanup() {}, resume() {} }, pets: { despawn() {} }, arts: { reset() {} },
    post: { renderPass: {} }, camera: {}, flare: {},
    locationLabel: () => 'Home', hud: { notify() {} },
    save() { return Game.prototype.save.call(this); }, dismount() {}, endTribulation() {},
    freshRuntime() { return { hp: this.stats.maxHp, energy: this.stats.maxEnergy, spirit: this.stats.maxSpirit, cooldowns: {} }; },
    buildSystem: async () => ({ star: TRAINING_STAR, root: new THREE.Group() }),
    installSystem(sys) { if (this.system) this.system.disposed = true; this.system = sys; this.star = sys.star; },
    spawnAtSettlement() { this.player.pos.set(50, 60, 70); }, applyWeapon() {},
    warmTerrain: async () => {}, startPlaying() { this.mode = 'playing'; }, togglePanel() {},
    exitVirtual() { this.mode = 'playing'; }, enterVirtual() { this.mode = 'virtual'; },
    restoreLocation() { this.player.pos.fromArray(this.state.loc.pos); },
  };
  g.stats = derive(state);
  g.training = new TrainingGround(g);
  g.training.createPhysicalBody = () => null;
  g.training.createPhysicalBody = () => null;
  // Lifecycle tests advance the transfer immediately; animation is tested separately.
  g.training.transfer = { begin() { g.mode = 'transferring'; }, arrive: async () => {}, end() {} };
  return { g, source, state, writes };
}

test('enter, experiment and leave restore the original world, character and save', async () => {
  const { g, source, state, writes } = fixture();
  await g.training.enter();
  assert.equal(g.training.active, true);
  assert.notEqual(g.state, state);
  assert.equal(source.disposed, undefined);
  const simulation = g.system;
  g.training.set('realm', 8);
  g.state.coins = 1;
  g.state.kills = 999;
  g.save();
  assert.equal(writes.length, 1);
  assert.equal(writes[0].coins, 321);
  g.training.leave();
  assert.equal(g.mode, 'virtual');
  assert.equal(g.state, state);
  assert.equal(g.system, source);
  assert.equal(simulation.disposed, true);
  assert.equal(g.state.realm, 0);
  assert.equal(g.state.coins, 321);
  assert.equal(g.state.kills, 0);
  assert.equal(g.rt.hp, 77);
  assert.equal(g.rt.energy, 23);
  assert.deepEqual(g.player.pos.toArray(), [1, 2, 3]);
  assert.equal(g.training.active, false);
  delete globalThis.document;
  delete globalThis.localStorage;
});

test('generation failure rolls back to the real character', async () => {
  const { g, state, source } = fixture();
  g.buildSystem = async () => { throw new Error('test generation failure'); };
  const oldError = console.error;
  console.error = () => {};
  try { await g.training.enter(); } finally { console.error = oldError; }
  assert.equal(g.state, state);
  assert.equal(g.system, source);
  assert.equal(g.training.active, false);
  assert.equal(g.training.busy, false);
  assert.equal(g.mode, 'virtual');
  delete globalThis.document;
  delete globalThis.localStorage;
});

test('training can prepare the final breakthrough without granting a boss trophy', async () => {
  const { g } = fixture();
  await g.training.enter();
  g.training.set('realm', 8);
  g.training.readyBreakthrough();
  assert.equal(g.state.stage, 3);
  assert.equal(g.state.xp, g.stats.xpNeed);
  assert.equal(Game.prototype.breakthroughStatus.call(g).ready, true);
  assert.deepEqual(g.state.bosses, []);
  g.training.leave();
  delete globalThis.document;
  delete globalThis.localStorage;
});

test('entry reuses background preparation without opening a loading screen', async () => {
  const { g } = fixture();
  let builds = 0;
  g.buildSystem = async () => { builds++; return { star: TRAINING_STAR, root: new THREE.Group() }; };
  g.menus.showLoading = () => { throw new Error('Training must not show a loading screen'); };
  const prepared = g.training.prepare();
  assert.equal(g.training.prepare(), prepared);
  await prepared;
  await g.training.enter();
  assert.equal(builds, 1);
  assert.equal(g.training.active, true);
  g.training.leave();
  delete globalThis.document;
  delete globalThis.localStorage;
});

test('training protections block damage, XP and interstellar warp', () => {
  const g = { training: { active: true, options: { god: true } }, denied: (message) => message };
  assert.equal(Game.prototype.hurtPlayer.call(g, 999), null);
  assert.equal(Game.prototype.addXp.call(g, 999), undefined);
  assert.match(Game.prototype.tryWarp.call(g, {}, 1), /Prism/);
});
