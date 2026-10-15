import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
globalThis.Worker = class { postMessage() {} terminate() {} };
const { TrainingGround, trainingState } = await import('../src/game/training.js');
const { duelState } = await import('../src/game/duel.js');
const { derive } = await import('../src/game/state.js');
const { Player, EYE } = await import('../src/game/player.js');
const { BeastManager } = await import('../src/game/beasts.js');
const { Game } = await import('../src/game/game.js');
const { Combat } = await import('../src/game/combat.js');

function fixture(weapon = 'blade') {
  globalThis.document = {
    createElement: () => ({ getContext: () => ({ createRadialGradient: () => ({ addColorStop() {} }), fillRect() {} }) }),
    getElementById: () => ({ classList: { toggle() {} } }),
  };
  const root = new THREE.Group(), projectiles = [], banners = [];
  const particles = { emit() {}, burst() {} };
  const combat = { clear() { projectiles.length = 0; }, flash() {}, shockwave() {}, explosion() {}, debris() {},
    enemyShot(...args) { projectiles.push(args); } };
  const frame = { terrain: true, floorRadius: () => 1000, collide() {} };
  const state = trainingState(2, 0);
  const g = { state, stats: derive(state), mode: 'playing', time: 0, frame, system: { planets: [frame] },
    localRoot: root, player: new Player(root, particles), camQuat: new THREE.Quaternion(),
    rt: { hp: 10, energy: 10, spirit: 10, cooldowns: {}, invuln: 0, lastHurt: -99, undyingCd: 0 },
    particles, combat, swords: { clearPhantoms() {}, reset() {} }, arts: { reset() {}, slowAt: () => 1, defend: (amount) => ({ amount }) },
    pets: { despawn() {} }, loot: { clear() {} }, statics: new Map(),
    menus: { closePanel() {} }, input: { lock() {} },
    resume() { this.input.lock(); },
    hud: { banner: (...args) => banners.push(args) },
    denied(message) { return message; }, dismount() {}, isSolid: () => false,
    spawnAtSettlement() { this.player.placeAt(new THREE.Vector3(0, 1000 + EYE, 0), new THREE.Vector3(0, 1000 + EYE, -20), new THREE.Vector3(0, 1, 0)); },
    hurtPlayer(amount) { this.damageTaken = (this.damageTaken || 0) + amount; },
  };
  g.beasts = new BeastManager(root, particles, combat, { explosion() {} });
  g.beasts.onKill = (b) => Game.prototype.onBeastKilled.call(g, b);
  g.training = new TrainingGround(g);
  g.training.active = true;
  g.training.options.duelWeapon = weapon;
  return { g, duel: g.training.duel, projectiles, banners };
}

test('matched opponent build copies progression without sharing mutable state', () => {
  const state = trainingState(5, 2);
  state.gear.armor = 3;
  const rival = duelState(state, { duelMirror: true, duelRealm: 0, duelStage: 0, duelWeapon: 'bow' });
  assert.equal(rival.realm, 5);
  assert.equal(rival.stage, 2);
  assert.equal(rival.weapon, 'bow');
  assert.equal(rival.gear.armor, 3);
  rival.skills.g_vital = 0;
  rival.gear.armor = 0;
  assert.notEqual(state.skills.g_vital, 0);
  assert.equal(state.gear.armor, 3);
  const custom = duelState(state, { duelMirror: false, duelRealm: 1, duelStage: 3, duelWeapon: 'fist' });
  assert.equal(custom.realm, 1);
  assert.equal(custom.stage, 3);
});

test('fair duel creates a humanoid target, disables cheats, and restores them on stop', () => {
  const { g, duel } = fixture();
  const initial = { ...g.training.options };
  duel.start();
  assert.equal(duel.active, true);
  assert.equal(g.beasts.beasts.length, 1);
  assert.equal(duel.opponent.duelist, true);
  assert.ok(duel.fighter instanceof Player);
  assert.equal(g.rt.hp, g.stats.maxHp);
  assert.equal(g.training.options.god, false);
  assert.equal(g.training.options.infinite, false);
  const mesh = duel.opponent.mesh;
  let geometryDisposed = false;
  duel.fighter.shield.geometry.addEventListener('dispose', () => { geometryDisposed = true; });
  duel.stop();
  assert.equal(g.training.options.god, initial.god);
  assert.equal(g.training.options.infinite, initial.infinite);
  assert.equal(g.beasts.beasts.length, 0);
  assert.equal(mesh.parent, null);
  assert.equal(geometryDisposed, true);
});

test('countdown prevents damage and attacks; ranged AI pays energy and attacks afterward', () => {
  const { g, duel, projectiles } = fixture('bow');
  duel.start();
  assert.equal(duel.reduceIncoming(100, 'bolt'), 0);
  duel.update(1);
  assert.equal(projectiles.length, 0);
  assert.equal(duel.countdown, 2);
  for (let i = 0; i < 160; i++) { g.time += 0.05; duel.update(0.05); }
  assert.ok(projectiles.length > 0);
  assert.ok(duel.energy >= 0 && duel.energy <= duel.stats.maxEnergy);
  assert.ok(Number.isFinite(duel.fighter.pos.length()));
  duel.stop();
});

test('opponent guard respects facing and dodge blocks hits', () => {
  const { g, duel } = fixture();
  duel.start();
  duel.countdown = 0;
  duel.guardT = 0.5;
  const expected = 100 * (1 - duel.stats.armor);
  assert.ok(Math.abs(duel.reduceIncoming(100, 'saber') - expected * 0.3) < 0.001);
  g.player.pos.copy(duel.opponent.pos).addScaledVector(duel.fighter.forward(), -10);
  assert.equal(duel.reduceIncoming(100, 'saber'), expected);
  duel.dodgeT = 0.2;
  assert.equal(duel.reduceIncoming(100, 'saber'), 0);
  duel.stop();
});

test('killing the rival awards a duel win without cultivation rewards or leaked targets', () => {
  const { g, duel } = fixture();
  duel.start();
  const coins = g.state.coins;
  g.beasts.damage(duel.opponent, duel.opponent.maxHp + 1, g.time);
  assert.equal(duel.wins, 1);
  assert.equal(duel.active, false);
  assert.equal(g.state.kills, 0);
  assert.equal(g.state.xp, 0);
  assert.equal(g.state.coins, coins);
  assert.equal(g.beasts.beasts.length, 0);
});

test('lethal incoming damage ends a duel safely instead of killing the player', () => {
  const { g, duel } = fixture();
  duel.start();
  duel.countdown = 0;
  g.rt.hp = 3;
  Game.prototype.hurtPlayer.call(g, 999, null, null, true);
  assert.equal(duel.losses, 1);
  assert.equal(duel.active, false);
  assert.ok(g.rt.hp > 0);
  assert.equal(g.mode, 'playing');
  assert.equal(g.training.options.god, true);
});

test('blocked sight prevents attacks and leaving the arena cancels a round', () => {
  const { g, duel, projectiles } = fixture('mind');
  duel.start();
  duel.countdown = 0;
  g.isSolid = () => true;
  for (let i = 0; i < 60; i++) duel.update(0.05);
  assert.equal(projectiles.length, 0);
  g.frame = null;
  duel.update(0.05);
  assert.equal(duel.active, false);
  assert.equal(duel.wins + duel.losses, 0);
  assert.match(duel.result, /cancelled/);
});

test('changing a loadout cancels an active round and restores training rules', () => {
  const { g, duel } = fixture();
  duel.start();
  g.training.set('duelWeapon', 'bow');
  assert.equal(duel.active, false);
  assert.equal(g.training.options.duelWeapon, 'bow');
  assert.equal(g.training.options.god, true);
});

test('lethal projectile callbacks finish safely before combat cleanup runs', () => {
  const { g, duel } = fixture();
  g.combat = new Combat(g.localRoot, g.particles, { enemyShot() {} });
  duel.start();
  duel.countdown = 0;
  g.rt.hp = 1;
  g.combat.enemyShot(g.player.pos.clone(), new THREE.Vector3(0, 0, 1), 1, 999, 0x3ef2ff, 0.35);
  // Another shot exercises the remainder of the loop after the round ends.
  g.combat.enemyShot(g.player.pos.clone().add(new THREE.Vector3(50, 0, 0)), new THREE.Vector3(0, 0, 1), 1, 999, 0x3ef2ff, 0.35);
  assert.doesNotThrow(() => g.combat.update(0.01, {
    beasts: g.beasts.beasts, player: g.player, playerAlive: true, solid: () => false,
    hurtPlayer: (amount, pos, shot) => Game.prototype.hurtPlayer.call(g, amount, pos, null, false, shot),
  }));
  assert.equal(duel.losses, 1);
  assert.equal(duel.pendingClear, true);
  duel.flush();
  assert.equal(g.combat.shots.length, 0);
});
