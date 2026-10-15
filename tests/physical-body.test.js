import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
globalThis.Worker = class { postMessage() {} terminate() {} };
const { Game } = await import('../src/game/game.js');
const { TrainingGround, TRAINING_STAR, trainingState } = await import('../src/game/training.js');
const { newState, derive } = await import('../src/game/state.js');
const { Player, EYE } = await import('../src/game/player.js');
const { Particles } = await import('../src/game/particles.js');
const { Combat } = await import('../src/game/combat.js');
const { BeastManager } = await import('../src/game/beasts.js');
const { Loot } = await import('../src/game/loot.js');
const { Arts } = await import('../src/game/arts.js');
const { Ship } = await import('../src/game/ship.js');

function fixture() {
  const elements = new Map(), writes = [], warnings = [];
  globalThis.document = {
    createElement: () => ({ getContext: () => ({ createRadialGradient: () => ({ addColorStop() {} }), fillRect() {}, strokeRect() {} }) }),
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, { style: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => true } });
      return elements.get(id);
    },
  };
  globalThis.localStorage = { setItem(key, value) { writes.push(JSON.parse(value)); } };
  const frame = { body: { id: 'p2', name: 'Terra', landable: true, tier: 0, type: 'terran', amp: 0, seed: 1, sites: { city: null }, ocean: null },
    R: 1000, atmoR: 1200, terrain: { sea: null }, spin: new THREE.Group(),
    floorRadius: () => 1000, groundBelow: () => 1000, solidAt: (p) => p.length() < 1000, collide() {}, allSites: () => [] };
  const sourceSystem = { star: { key: 'home', name: 'Home', region: 0, tier: 0 }, root: new THREE.Group(), planets: [frame], stations: [], starRadius: 1, update() {} };
  sourceSystem.root.add(frame.spin);
  const g = Object.create(Game.prototype);
  Object.assign(g, { state: newState(), system: sourceSystem, star: sourceSystem.star, frame, time: 0,
    localRoot: new THREE.Group(), scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), camQuat: new THREE.Quaternion(), camMode: 'first',
    mode: 'virtual', deck: null, shipObj: null, particles: null, statics: new Map(),
    sound: { init() {}, hurt() {}, warn() { warnings.push('alarm'); }, explosion() {}, death() {}, enemyShot() {}, stageUp() {}, intercept() {} },
    hud: { notify(text) { warnings.push(text); }, physicalHit() { warnings.push('physical'); }, simulationHit() { warnings.push('simulation'); }, show() {}, banner() {}, setPrompt() {}, alert() {}, damageNumber() {} },
    input: { unlock() {}, lock: async () => true, clear() {} },
    menus: { closePanel() {}, showPause() {}, showDeath() {}, overlayOpen: false },
    viewmodel: { hit() {}, setVisible() {} }, nix: { event() {} }, campaign: { cleanup() {}, resume() {} }, pets: { despawn() {} },
    swords: { reset() {}, setup() {}, setVisible() {}, clearPhantoms() {} }, post: { fx: { damage: 0, glitch: 0 } },
    applyWeapon() {}, warmTerrain: async () => {},
    startPlaying() { this.mode = 'playing'; }, enterVirtual() { this.mode = 'virtual'; }, exitVirtual() {},
    spawnAtSettlement() { this.frame = this.system.planets[0]; this.frame.spin.add(this.localRoot); this.player.placeAt(new THREE.Vector3(0, 1000 + EYE, 0), new THREE.Vector3(10, 1000 + EYE, 0), new THREE.Vector3(0, 1, 0)); },
    installSystem(system) {
      this.combat.clear(); this.beasts.clear(); this.loot.clear(); this.particles.clear(); this.shipObj?.dispose(); this.shipObj = null;
      this.system = system; this.star = system.star; system.root.add(this.localRoot); this.frame = null;
    },
    restoreLocation() { this.frame = frame; frame.spin.add(this.localRoot); this.player.pos.fromArray(this.state.loc.pos); },
  });
  frame.spin.add(g.localRoot);
  g.localRoot.add(g.camera);
  g.stats = derive(g.state);
  g.rt = g.freshRuntime();
  g.particles = new Particles(g.localRoot, 100);
  g.combat = new Combat(g.localRoot, g.particles, g.sound);
  g.beasts = new BeastManager(g.localRoot, g.particles, g.combat, g.sound);
  g.beasts.onKill = (b) => g.onBeastKilled(b);
  g.loot = new Loot(g.localRoot, g.particles, g.sound);
  g.player = new Player(g.localRoot, g.particles);
  g.player.placeAt(new THREE.Vector3(0, 1000 + EYE, 0), new THREE.Vector3(10, 1000 + EYE, 0), new THREE.Vector3(0, 1, 0));
  g.arts = new Arts(g);
  g.env = g.computeEnv(g.player.pos);
  g.training = new TrainingGround(g);
  g.training.transfer = { begin() { g.mode = 'transferring'; }, arrive: async () => {}, end() {} };
  const trainingFrame = { ...frame, body: { ...frame.body, id: 'prism-training', name: 'Prism' }, spin: new THREE.Group() };
  g.buildSystem = async () => {
    const root = new THREE.Group(); root.add(trainingFrame.spin);
    return { star: TRAINING_STAR, root, planets: [trainingFrame], stations: [], starRadius: 1, update() {}, dispose() {} };
  };
  return { g, frame, sourceSystem, writes, warnings, elements };
}

function attacker(g) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1), new THREE.MeshBasicMaterial());
  mesh.position.copy(g.player.pos).add(new THREE.Vector3(1, 0, 0));
  g.localRoot.add(mesh);
  const b = { uid: ++g.beasts.uid, type: 'real-attacker', alive: true, aggro: true, static: false, boss: false,
    pos: mesh.position, mesh, vel: new THREE.Vector3(), model: { group: mesh, anim() {}, flash: [] },
    def: { walker: true, behavior: 'swarm', speed: 6, aggro: 240, color: 0xff4466, radius: 1 },
    hp: 100, maxHp: 100, dmg: 10, radius: 1, tier: 0, home: mesh.position.clone(), wander: new THREE.Vector3(),
    cd: 1, cd2: 1, cd3: 0, gid: 0, state: 'move', phase: 0, lastHit: -99, flashT: 0 };
  g.beasts.beasts.push(b);
  return b;
}

test('real attackers survive entry and can hurt the body despite all simulation cheats', async () => {
  const { g, warnings } = fixture();
  const realPlayer = g.player, realBeasts = g.beasts, enemy = attacker(g);
  await g.training.enter();
  const physical = g.training.physical;
  g.training.options.god = g.training.options.freeze = true;
  g.training.duel.active = true;
  g.training.duel.countdown = 3;
  const simHp = g.rt.hp;
  assert.notEqual(g.player, realPlayer);
  assert.equal(physical.entities.beasts, realBeasts);
  assert.equal(enemy.mesh.parent, physical.root);
  g.time += 0.05;
  g.training.updatePhysical(0.05);
  assert.ok(physical.context.rt.hp < 100);
  assert.equal(g.rt.hp, simHp);
  assert.ok(warnings.includes('physical'));
  assert.ok(!warnings.includes('simulation'));
  assert.equal(physical.context.state.realm, 0);
});

test('returning preserves current physical health and live entities; saves only real state', async () => {
  const { g, writes } = fixture();
  const realState = g.state, realPlayer = g.player, realBeasts = g.beasts;
  await g.training.enter();
  const physical = g.training.physical;
  physical.damage(25, null, null, true);
  g.state.coins = 999999;
  g.save();
  assert.equal(writes.at(-1).coins, realState.coins);
  assert.equal(writes.at(-1).realm, 0);
  g.training.leave();
  assert.equal(g.state, realState);
  assert.equal(g.player, realPlayer);
  assert.equal(g.beasts, realBeasts);
  assert.equal(g.rt.hp, 75);
  assert.equal(g.mode, 'virtual');
  assert.equal(realPlayer.root.parent, g.localRoot);
});

test('physical lethal damage severs training and applies the normal real-world death penalty', async () => {
  const { g } = fixture();
  g.state.xp = 100;
  const realState = g.state;
  await g.training.enter();
  g.training.physical.damage(1000, null, null, true);
  g.training.updatePhysical(0);
  assert.equal(g.training.active, false);
  assert.equal(g.training.physical, null);
  assert.equal(g.state, realState);
  assert.equal(g.mode, 'dead');
  assert.equal(g.rt.hp, 0);
  assert.equal(g.state.xp, 80);
  assert.equal(g.rt.deadT, 3.5);
});

test('physical hazards continue ticking and cannot be disabled by training invulnerability', async () => {
  const { g, sourceSystem } = fixture();
  await g.training.enter();
  sourceSystem.starRadius = 2000;
  const body = g.training.physical;
  g.time += 0.1;
  body.update(0.1);
  assert.ok(body.context.rt.hp < 100);
  assert.ok(body.context.state.worldTime > 60);
  assert.equal(g.training.options.god, true);
});

test('physical Undying uses the real realm and cooldown, not the selected simulation realm', async () => {
  const { g } = fixture();
  g.state.realm = 7;
  g.stats = derive(g.state);
  g.rt = g.freshRuntime();
  await g.training.enter();
  const body = g.training.physical;
  body.damage(body.context.stats.maxHp * 2, null, null, true);
  assert.equal(body.dead, false);
  assert.equal(body.context.rt.undyingCd, 300);
  assert.equal(body.context.rt.hp, body.context.stats.maxHp * 0.3);
});

test('death during preparation cannot later revive the training session', async () => {
  const { g, sourceSystem } = fixture();
  let resolve;
  const lateSystem = { dispose() { this.disposed = true; } };
  g.buildSystem = () => new Promise((r) => { resolve = r; });
  const entering = g.training.enter();
  g.training.physical.damage(1000, null, null, true);
  g.training.updatePhysical(0);
  resolve(lateSystem);
  await entering;
  assert.equal(g.mode, 'dead');
  assert.equal(g.system, sourceSystem);
  assert.equal(g.training.active, false);
  assert.equal(lateSystem.disposed, true);
});

test('real projectiles continue through the original combat system during PvP practice', async () => {
  const { g, warnings } = fixture();
  const realCombat = g.combat;
  realCombat.enemyShot(g.player.pos.clone(), new THREE.Vector3(0, 0, 1), 1, 12, 0xff4466, 0.35);
  await g.training.enter();
  g.training.duel.active = true;
  g.training.duel.countdown = 3;
  const simHp = g.rt.hp;
  g.time += 0.05;
  g.training.updatePhysical(0.05);
  assert.equal(g.training.physical.context.rt.hp, 88);
  assert.equal(g.rt.hp, simHp);
  assert.equal(realCombat.shots.length, 0);
  assert.ok(warnings.includes('physical'));
});

test('simulation hits use cyan feedback without harming physical health or red post-processing', async () => {
  const { g, warnings } = fixture();
  await g.training.enter();
  g.training.options.god = false;
  const physicalHp = g.training.physical.context.rt.hp;
  const simulationHp = g.rt.hp;
  g.hurtPlayer(5, null, null);
  assert.ok(g.rt.hp < simulationHp);
  assert.equal(g.training.physical.context.rt.hp, physicalHp);
  assert.ok(warnings.includes('simulation'));
  assert.ok(!warnings.includes('physical'));
  assert.equal(g.post.fx.damage, 0);
});

test('emergency return goes directly to the living physical body with current health', async () => {
  const { g } = fixture();
  const realPlayer = g.player;
  await g.training.enter();
  g.training.physical.damage(20, null, null, true);
  g.onKey('KeyL');
  assert.equal(g.training.active, false);
  assert.equal(g.player, realPlayer);
  assert.equal(g.mode, 'playing');
  assert.equal(g.rt.hp, 80);
});

test('physical ship hull takes real damage and is preserved when leaving training', async () => {
  const { g, warnings } = fixture();
  const ship = g.shipObj = new Ship(g.localRoot, 0);
  ship.placeAt(g.player.pos.clone(), new THREE.Vector3(10, 1000 + EYE, 0), new THREE.Vector3(0, 1, 0));
  g.rt.inShip = true;
  const hull = ship.hull;
  await g.training.enter();
  assert.equal(ship.model.group.parent, g.training.physical.root);
  g.training.physical.damage(100, null, null);
  assert.equal(ship.hull, hull - 60);
  assert.equal(g.training.physical.context.rt.hp, 100);
  assert.ok(warnings.includes('physical'));
  g.training.leave();
  assert.equal(g.shipObj, ship);
  assert.equal(ship.model.group.parent, g.localRoot);
  assert.equal(g.shipObj.hull, hull - 60);
  assert.equal(g.rt.inShip, true);
});
