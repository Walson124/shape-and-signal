import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
globalThis.Worker = class { postMessage() {} terminate() {} };
const { Game } = await import('../src/game/game.js');
const { newState } = await import('../src/game/state.js');
const { Menus } = await import('../src/ui/menus.js');

globalThis.document = { createElement: () => ({ getContext: () => ({ createRadialGradient: () => ({ addColorStop() {} }), fillRect() {} }) }) };

function fixture() {
  const g = Object.create(Game.prototype), notices = [], events = [];
  Object.assign(g, { state: newState(), mode: 'playing', pods: [], rt: { inShip: true }, shipObj: {},
    player: { pos: new THREE.Vector3(0, 1200, 0), localUp: () => new THREE.Vector3(0, 1, 0) },
    localRoot: new THREE.Group(), frame: null, env: { up: new THREE.Vector3(0, 1, 0) }, time: 0,
    hud: { notify: text => notices.push(text) }, sound: { pickup() {}, confirm() {}, deny() {}, explosion() {} },
    campaign: { event: event => events.push(event) }, nix: { event() {} },
    particles: { emit() {}, burst() {} }, combat: { shockwave() {} }, save() { this.saves = (this.saves || 0) + 1; },
    system: { stations: [] }, notices, events });
  g.state.playtime = 200;
  return g;
}

test('overdue legacy Militia Radar arrives aboard the ship and installs exactly once', () => {
  const g = fixture(), d = { id: 'old', item: 'radar', label: 'Militia Radar', due: 150 };
  g.state.deliveries.push(d);
  g.updateDeliveries(0.1);
  assert.equal(g.state.radar, 0);
  assert.equal(g.state.deliveries.length, 0);
  assert.equal(g.pods.length, 0);
  assert.ok(g.events.includes('radar'));
  assert.ok(g.notices.some(text => text.includes('aboard your ship')));
  g.receiveDelivery(d, true);
  assert.equal(g.saves, 1);
});

test('boarding a ship recovers an already dropped order without charging again', () => {
  const g = fixture(), d = { id: 'p', item: 'radar', label: 'Militia Radar', due: 150 };
  g.state.deliveries.push(d);
  g.rt.inShip = false;
  g.updateDeliveries(2.2);
  assert.equal(g.pods.length, 1);
  assert.equal(g.pods[0].landed, true);
  const coins = g.state.coins;
  g.rt.inShip = true;
  g.updateDeliveries(0.1);
  assert.equal(g.state.radar, 0);
  assert.equal(g.state.coins, coins);
  assert.equal(g.pods.length, 0);
  assert.equal(g.localRoot.children.length, 0);
});

test('ground orders can be redirected, survive virtual mode, and are claimed only on interaction', () => {
  const g = fixture(), d = { id: 'p', item: 'heal3', label: 'Pills', due: 150 };
  g.rt.inShip = false;
  g.state.deliveries.push(d);
  g.updateDeliveries(2.2);
  const oldPod = g.pods[0], before = g.state.pills.heal;
  g.mode = 'virtual';
  g.redirectDelivery(d.id);
  assert.equal(g.pods.length, 0);
  g.updateDeliveries(2.2);
  assert.equal(g.pods.length, 0);
  assert.equal(g.state.deliveries.length, 1);
  g.mode = 'playing';
  g.updateDeliveries(2.2);
  assert.equal(g.state.pills.heal, before);
  g.openPod(g.pods[0]);
  g.openPod(oldPod);
  assert.equal(g.state.pills.heal, before + 3);
  assert.equal(g.state.deliveries.length, 0);
});

test('ordering records the exact radar tier and hides duplicate pending purchases', () => {
  const g = fixture();
  g.state.coins = 10000;
  g.orderDelivery('radar');
  assert.equal(g.state.deliveries[0].radarTier, 0);
  assert.ok(!g.mallCatalog().some(c => c.id === 'radar'));
  // Installing another radar while waiting cannot turn an old Militia order
  // into an unintended Hunter upgrade.
  g.state.radar = 0;
  g.receiveDelivery(g.state.deliveries[0]);
  assert.equal(g.state.radar, 0);
});

test('waiting orders do not arrive early and delivery animation uses elapsed time', () => {
  const g = fixture(), d = { id: 'p', item: 'ore10', label: 'Metal', due: 250 };
  g.state.deliveries.push(d);
  g.updateDeliveries(1);
  assert.equal(g.state.deliveries.length, 1);
  assert.equal(g.pods.length, 0);
  g.rt.inShip = false;
  g.state.playtime = 250;
  g.updateDeliveries(1.1);
  assert.equal(g.pods[0].t, 1.1);
  assert.equal(g.pods[0].landed, false);
  g.updateDeliveries(1.1);
  assert.equal(g.pods[0].landed, true);
});

test('mall explains ready deliveries and offers free recovery instead of a stuck zero-second countdown', () => {
  const g = fixture();
  g.state.deliveries.push({ id: 'p', item: 'radar', label: 'Militia Radar', due: 150 });
  const html = Menus.prototype.renderMall.call({ game: g, wallet: () => '1000' });
  assert.ok(html.includes('Ready'));
  assert.ok(html.includes('Redirect to me (free)'));
  assert.ok(html.includes('Ships receive cargo automatically'));
});

test('ground deliveries have a persistent yellow compass and screen-edge marker without owning a radar', () => {
  const g = fixture();
  g.rt.inShip = false;
  g.shipObj = null;
  g.state.deliveries.push({ id: 'p', item: 'radar', label: 'Militia Radar', due: 150 });
  g.updateDeliveries(2.2);
  Object.assign(g, { markerList: [], vehicleObj: null, storyTarget: () => null,
    beasts: { beasts: [], liveBoss: null }, pets: { active: null }, toWorld: pos => pos.clone(), camera: new THREE.PerspectiveCamera(), width: 1000, height: 800 });
  let displayed = [];
  g.hud.updateMarkers = items => { displayed = items; };
  const items = g.updateMarkers(g.player.pos);
  const marker = items.find(item => item.key === 'delivery:p');
  assert.equal(marker.compass, '#ffe44d');
  assert.equal(marker.edge, true);
  assert.ok(marker.sub.includes('DELIVERY POD'));
  assert.ok(displayed.includes(marker));
  assert.equal(g.state.radar, -1);
});
