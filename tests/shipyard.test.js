import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
globalThis.Worker = class { postMessage() {} terminate() {} };
const { Game } = await import('../src/game/game.js');
const { Ship } = await import('../src/game/ship.js');
const { SHIPS } = await import('../src/game/data.js');
const { newState } = await import('../src/game/state.js');
const { Menus } = await import('../src/ui/menus.js');
globalThis.document = { createElement: () => ({ getContext: () => ({ createRadialGradient: () => ({ addColorStop() {} }), fillRect() {}, strokeRect() {} }) }) };

function fixture(tier = 0) {
  const g = Object.create(Game.prototype), service = { kind: 'shipyard' };
  const settlement = { services: [service], padLocal: new THREE.Vector3(30, 1000, 0), group: { position: new THREE.Vector3(0, 1000, 0) } };
  Object.assign(g, { state: newState(), rt: { inShip: false }, star: { key: 'home' }, localRoot: new THREE.Group(), shipObj: null,
    frame: { body: { id: 'p2' }, terrain: {}, floorRadius: () => 1000, details: { settlements: [settlement] } },
    player: { pos: new THREE.Vector3(0, 1001.7, 0), forward: () => new THREE.Vector3(0, 0, -1), localUp: () => new THREE.Vector3(0, 1, 0) },
    lastService: { service }, campaign: { event() {} }, nix: { event() {} }, sound: { deny() { g.denials++; }, breakthrough() {} },
    hud: { notify() {}, banner() {} }, denied() { g.denials++; }, denials: 0,
    save() { this.saved = JSON.parse(JSON.stringify(this.state.ship)); } });
  Object.assign(g.state, { coins: 1e9, ore: 100000, essence: 1e9, realm: 2,
    ship: tier >= 0 ? { tier, star: 'stranded-star', body: null, pos: [1e9, 0, 0], quat: [0, 0, 0, 1], hull: 1 } : null });
  return g;
}

test('same-model replacement recovers a remote registered ship at the local shipyard', () => {
  const g = fixture(), before = { coins: g.state.coins, ore: g.state.ore, essence: g.state.essence };
  g.buildShip(0);
  assert.equal(g.denials, 0);
  assert.equal(g.shipObj.tier, 0);
  assert.equal(g.shipObj.hull, g.shipObj.maxHull);
  assert.equal(g.shipObj.landed, true);
  assert.ok(g.shipObj.pos.distanceTo(g.frame.details.settlements[0].padLocal) < 10);
  assert.equal(g.saved.star, 'home');
  assert.equal(g.saved.body, 'p2');
  assert.equal(g.saved.tier, 0);
  for (const key of ['coins', 'ore', 'essence']) assert.equal(g.state[key], before[key] - SHIPS[0][key]);
  assert.equal(g.localRoot.children.length, 1);
  g.shipObj.dispose();
});

test('replacement of a live distant hull clears drift and docking state without duplicate ships', () => {
  const g = fixture(1);
  g.shipObj = new Ship(g.localRoot, 1);
  g.shipObj.pos.set(1e8, 0, 0); g.shipObj.vel.set(10000, 2000, 4000);
  g.shipObj.dockedAt = { name: 'Old station' }; g.shipObj.hull = 1;
  g.buildShip(1);
  assert.equal(g.shipObj.vel.length(), 0);
  assert.equal(g.shipObj.dockedAt, null);
  assert.equal(g.shipObj.hull, g.shipObj.maxHull);
  assert.equal(g.localRoot.children.length, 1);
  assert.ok(g.shipObj.pos.length() < 2000);
  g.shipObj.dispose();
});

test('unaffordable or piloted replacements preserve the original hull and wallet', () => {
  for (const piloted of [false, true]) {
    const g = fixture();
    g.rt.inShip = piloted;
    if (!piloted) g.state.ore = 0;
    const before = JSON.stringify(g.state);
    g.buildShip(0);
    assert.equal(JSON.stringify(g.state), before);
    assert.equal(g.shipObj, null);
    assert.equal(g.saved, undefined);
    assert.equal(g.denials, 1);
  }
});

test('replacements do not unlock skipped upgrades or downgrades and normal upgrades still work', () => {
  for (const [current, requested, realm] of [[0, 2, 2], [1, 0, 2], [0, 1, 0]]) {
    const g = fixture(current); g.state.realm = realm;
    const before = JSON.stringify(g.state);
    g.buildShip(requested);
    assert.equal(JSON.stringify(g.state), before);
    assert.equal(g.denials, 1);
  }
  const g = fixture(0);
  g.buildShip(1);
  assert.equal(g.saved.tier, 1);
  g.shipObj.dispose();
});

test('a replacement without an available settlement pad lands on the local surface', () => {
  const g = fixture(); g.lastService = null;
  g.buildShip(0);
  assert.ok(Math.abs(g.shipObj.pos.length() - 1000 - g.shipObj.gearHeight) < 1e-6);
  assert.equal(g.shipObj.landed, true);
  assert.ok(g.saved.quat.every(Number.isFinite));
  g.shipObj.dispose();
});

test('shipyard offers an affordable current-model replacement and disables unaffordable ones', () => {
  const g = fixture();
  const render = () => Menus.prototype.renderShipyard.call({ game: g, wallet: () => '' });
  let html = render();
  assert.match(html, /data-tier="0"\s*>Build replacement/);
  assert.ok(html.includes('replaces your registered hull'));
  g.state.coins = 0;
  html = render();
  assert.match(html, /data-tier="0" disabled>Build replacement/);
});
