import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { PLANETARY_BOSSES, PlanetaryBrain, attackHits, buildPlanetaryModel } from '../src/game/planetary-bosses.js';
import { buildPlanetDestruction } from '../src/game/planet-destruction.js';
import { PlanetaryEncounter } from '../src/game/planetary-encounter.js';
import { Campaign, ACT1 } from '../src/game/campaign.js';
import { BeastManager } from '../src/game/beasts.js';
import { newState, derive } from '../src/game/state.js';

globalThis.Worker = class { postMessage() {} terminate() {} };
const { Game } = await import('../src/game/game.js');
const noop = () => {}, v = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
globalThis.document = { getElementById: () => ({ classList: { add: noop, remove: noop } }) };

function fixture(id = 'vesper') {
  const def = PLANETARY_BOSSES[id], root = new THREE.Group(), spin = new THREE.Group(), tilt = new THREE.Group();
  tilt.add(spin); spin.add(root); const surface = new THREE.Mesh(new THREE.SphereGeometry(1000, 8, 6), new THREE.MeshBasicMaterial()); spin.add(surface);
  const planet = { body: { id: def.body, pois: [{ kind: 'ruin', dir: [0, 1, 0] }] }, R: 1000, spin, tilt, floorRadius: () => 1000 };
  const state = newState(); state.realm = 2; state.campaign = { mi: ACT1.findIndex(m => m.steps.some(s => s.boss === id)), si: id === 'vesper' ? 2 : 2, started: true, done: [] };
  state.loc = { star: 'home', body: def.body, pos: [0, 1001.7, 210], mode: 'ground' };
  const hud = { banner: noop, alert: noop, show: noop }, sound = { thunder: noop, explosion: noop };
  const combat = { clear: noop, shockwave: noop, explosion: noop, beam: noop };
  let modalResolve, script;
  const g = { state, stats: derive(state), star: { key: 'home' }, frame: planet, localRoot: root, system: { planets: [planet] },
    training: { active: false }, mode: 'playing', time: 0, hud, sound, combat,
    player: { pos: v(0, 1001.7, 210), vel: v(), quat: new THREE.Quaternion(), setVisible: noop, setRealm: noop,
      placeAt(pos) { this.pos.copy(pos); } },
    rt: { hp: 500, energy: 200, spirit: 100, invuln: 0 },
    arts: { reset: noop }, swords: { setVisible: noop, reset: noop }, applyCamMode: noop,
    freshRuntime: () => ({ hp: 500, energy: 200, spirit: 100 }), input: { unlock: noop },
    setFrame(p) { this.frame = p; },
    setFrame(p) { this.frame = p; },
    save() { this.state.loc = { ...this.state.loc, pos: this.player.pos.toArray() }; },
    hurtPlayer(amount) { this.rt.hp -= amount; if (this.rt.hp <= 0) Game.prototype.die.call(this); },
    cutscene: { say: noop },
    async playCutscene(s) { script = s; s.tick(12); for (const e of s.events || []) e.fn(); },
    menus: { showPause: noop, modal: () => new Promise(r => { modalResolve = r; }) }, quitToTitle() { this.mode = 'title'; },
  };
  g.beasts = new BeastManager(root, { burst: noop }, { ...combat, debris: noop }, sound);
  const c = { g, get st() { return g.state.campaign; }, gate: () => ({ out: v(0, 1000, 0), pos: v(0, 1000, -10) }),
    ground: p => p.normalize().multiplyScalar(1000), advance() { this.advanced = (this.advanced || 0) + 1; } };
  g.campaign = c; c.planetary = new PlanetaryEncounter(c);
  return { g, c, planet, surface, encounter: c.planetary, choice: value => modalResolve(value), script: () => script };
}

test('three original bosses have different models and kits with bounded geometry', () => {
  const signatures = new Set(), kits = new Set();
  for (const def of Object.values(PLANETARY_BOSSES)) {
    const m = buildPlanetaryModel(def); let meshes = 0, triangles = 0;
    m.group.traverse(o => { if (o.isMesh) { meshes++; triangles += (o.geometry.index?.count || o.geometry.attributes.position.count) / 3; } });
    signatures.add(triangles); kits.add(def.kit.join(','));
    assert.ok(meshes <= 12 && triangles < 20000); m.anim(10);
    assert.ok(m.group.children.every(o => Number.isFinite(o.rotation.z)));
    m.group.traverse(o => o.geometry?.dispose());
  }
  assert.equal(signatures.size, 3); assert.equal(kits.size, 3);
});

test('brains telegraph before striking, change phases, avoid repeating a single move and expose recovery windows', () => {
  const brain = new PlanetaryBrain(PLANETARY_BOSSES.vesper), events = [];
  let lastTell = null;
  for (let t = 0; t < 75; t += 0.05) for (const e of brain.tick(0.05, { hp: t > 45 ? 30 : t > 25 ? 60 : 100, maxHp: 100, distance: 140 })) {
    events.push(e);
    if (e.type === 'tell') lastTell = { t, attack: e.attack };
    if (e.type === 'strike') assert.ok(t - lastTell.t >= lastTell.attack.wind - 0.1);
  }
  assert.equal(brain.phase, 2);
  assert.ok(new Set(events.filter(e => e.type === 'tell').map(e => e.attack.id)).size >= 4);
  assert.ok(events.some(e => e.type === 'recover'));
  const time = brain.elapsed; brain.tick(1, { hp: 30, maxHp: 100, distance: 140, enabled: false }); assert.equal(brain.elapsed, time);
});

test('World Rend can be interrupted; ignoring it destroys planetary integrity', () => {
  const brain = new PlanetaryBrain(PLANETARY_BOSSES.serekh);
  brain.turn = 4; brain.t = 0;
  const e = brain.tick(0.05, { hp: 1000, maxHp: 1000, distance: 200 });
  assert.equal(e[0].attack.id, 'devour');
  assert.equal(brain.vulnerability, 2);
  const interrupted = brain.tick(0.05, { hp: 940, maxHp: 1000, distance: 200 });
  assert.equal(interrupted[0].type, 'interrupt'); assert.equal(brain.integrity, 100); assert.equal(brain.vulnerability, 1.65);
  brain.turn = 8; brain.t = 0; brain.integrity = 30;
  brain.tick(0.05, { hp: 940, maxHp: 1000, distance: 200 });
  brain.t = 0;
  assert.ok(brain.tick(0.05, { hp: 940, maxHp: 1000, distance: 200 }).some(e => e.type === 'failure'));
});

test('attack volumes respect dodge lanes, charge travel, jumping over waves and moving off eruption marks', () => {
  const origin = v(), up = v(0, 1, 0), dir = v(0, 0, 1);
  const charge = { id: 'charge', shape: 'lane', reach: 300, width: 20 };
  assert.equal(attackHits(charge, origin, dir, v(0, 1, 150), up, 0), false);
  assert.equal(attackHits(charge, origin, dir, v(0, 1, 150), up, 0.5), true);
  assert.equal(attackHits(charge, origin, dir, v(30, 1, 150), up, 0.5), false);
  const pulse = { shape: 'ring', reach: 300, width: 12 };
  assert.equal(attackHits(pulse, origin, dir, v(0, 1.7, 150), up, 0.5), true);
  assert.equal(attackHits(pulse, origin, dir, v(0, 10, 150), up, 0.5), false);
  assert.equal(attackHits({ shape: 'disc', width: 30 }, origin, dir, v(60, 0, 0), up, 1, [v()]), false);
});

test('planetary enemies bypass generic AI and keep normal boss combat targeting', () => {
  const { encounter: e, g } = fixture(); e.begin('vesper');
  const b = e.boss, pos = b.pos.clone();
  assert.ok(v(0, 1, 0).applyQuaternion(b.mesh.quaternion).dot(pos.clone().normalize()) > 0.999, 'giant must stand upright on its planet from the first frame');
  g.beasts.setEnv({ max: 0, spawn: () => null });
  g.beasts.update(1, { player: g.player, playerAlive: true, time: 2 });
  assert.ok(b.pos.equals(pos)); assert.equal(g.beasts.liveBoss, b); assert.equal(b.boss, true);
  e.update(0.05); assert.equal(b.state, 'recovery');
  g.beasts.clear(); e.dispose();
});

test('death during a live siege defers destruction, persists defeat, and waits for an explicit checkpoint retry', async () => {
  const f = fixture(), { g, encounter: e, c, surface } = f; e.begin('vesper');
  const originalCoins = g.state.coins; g.state.coins += 999; g.rt.hp = 0;
  Game.prototype.die.call(g);
  assert.equal(e.status, 'pending-failure'); assert.equal(g.mode, 'cutscene'); assert.equal(g.rt.deadT, undefined);
  e.update(0.05); await Promise.resolve(); await Promise.resolve();
  assert.equal(e.status, 'defeated'); assert.equal(surface.visible, false); assert.ok(c.st.siegeFailure);
  assert.equal(c.advanced, undefined); assert.ok(f.script().shots.reduce((t, s) => t + s.dur, 0) >= 10);
  f.choice('retry'); await Promise.resolve(); await Promise.resolve();
  assert.equal(e.status, 'fighting'); assert.equal(g.state.coins, originalCoins); assert.equal(surface.visible, true);
  assert.equal(g.state.campaign.siegeCheckpoint.state.campaign.siegeCheckpoint, undefined);
  e.dispose(); g.beasts.clear();
});

test('winning only advances after combat finishes, and ordinary deaths/training do not destroy planets', () => {
  const { g, encounter: e, c } = fixture('serekh'); e.begin('serekh');
  const b = e.boss; b.alive = false;
  assert.equal(e.onKill(b), true); assert.equal(c.advanced, undefined);
  e.update(0.05); assert.equal(c.advanced, 1); assert.ok(c.st.slain.includes('serekh')); assert.equal(c.st.siegeCheckpoint, undefined);
  assert.equal(e.onDeath(), false);
  e.begin('serekh'); g.training.active = true; assert.equal(e.onDeath(), false);
  e.dispose(); g.beasts.clear();
});

test('loading a mid-siege checkpoint restores the original attempt without nested snapshots or duplicated bosses', () => {
  const { g, c, encounter: e } = fixture(); e.begin('vesper');
  const original = g.state.coins; g.state.coins += 400;
  e.dispose();
  Object.defineProperty(c, 'step', { get: () => ACT1[g.state.campaign.mi].steps[g.state.campaign.si] });
  c.render = noop;
  Campaign.prototype.resume.call(c);
  assert.equal(e.status, 'fighting'); assert.equal(g.state.coins, original);
  assert.equal(g.beasts.beasts.filter(b => b.planetary).length, 1);
  assert.equal(c.st.siegeCheckpoint.state.campaign.siegeCheckpoint, undefined);
  e.dispose(); g.beasts.clear();
});

test('destruction hides the actual planet, preserves the player frame and restores all visibility on disposal or skipped scene', () => {
  const { g, planet, surface } = fixture(); const atmo = new THREE.Group(); planet.tilt.add(atmo); atmo.visible = false;
  const fx = buildPlanetDestruction(g, planet, 0xffaa44);
  fx.update(2); assert.equal(surface.visible, true);
  fx.update(12); assert.equal(surface.visible, false); assert.equal(g.localRoot.visible, true);
  assert.ok(fx.group.children.filter(o => o.isMesh).length < 80);
  fx.dispose(); assert.equal(surface.visible, true); assert.equal(atmo.visible, false);
  fx.update(12); assert.equal(surface.visible, true);
});

test('campaign order preserves old missions and gives later confrontations off-world story objectives', () => {
  const fights = ACT1.flatMap(m => m.steps.filter(s => s.type === 'planetary').map(s => [m, s]));
  assert.deepEqual(fights.map(([, s]) => s.boss), ['vesper', 'serekh', 'ilyra']);
  assert.equal(fights[1][0].planet, 'p3'); assert.equal(fights[2][0].planet, 'p5');
  assert.ok(ACT1.findIndex(m => m.id === 'tide') < ACT1.findIndex(m => m.id === 'worldbreaker'));
  const { g } = fixture(); assert.equal(Campaign.prototype.onTerra.call({ g }), true);
  g.star.key = 'other'; assert.equal(Campaign.prototype.onTerra.call({ g }), false);
});
