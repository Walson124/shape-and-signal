import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildSettlement } from '../src/world/city.js';
globalThis.Worker = class { postMessage() {} terminate() {} };
const { Game } = await import('../src/game/game.js');
const { Planet } = await import('../src/world/planet.js');

const context = new Proxy({}, { get(target, key) {
  if (key in target) return target[key];
  if (key === 'measureText') return text => ({ width: text.length * 20 });
  if (String(key).includes('Gradient')) return () => ({ addColorStop() {} });
  return () => {};
} });
globalThis.document = { createElement: () => ({ getContext: () => context }) };
const site = { x: 0, y: 1, z: 0, height: 0, radius: 520, size: 'capital', name: 'Base City 07' };
const makeCity = (opts = {}) => buildSettlement(site, 18600, { terra: true, crowd: 0.25, ...opts });

test('Terra street cells stream incrementally with bounded draws and local geometry', t => {
  const city = makeCity(), streets = city.streets;
  assert.equal(streets.live.size, 0);
  assert.ok([...streets.cells.values()].flat().some(e => e.type === 'storefront'));
  for (let i = 0; i < 10; i++) {
    const before = streets.live.size;
    streets.update(new THREE.Vector3(0, 1.7 + city.drop(0, -60), -60));
    assert.ok(streets.live.size - before <= 1);
  }
  assert.ok(streets.stats.cells > 0 && streets.stats.cells <= 9);
  assert.ok(streets.stats.meshes <= 45);
  assert.ok(streets.stats.triangles < 40000);
  t.diagnostic(`Starting plaza street detail: ${JSON.stringify(streets.stats)}`);
  for (const group of streets.live.values()) group.traverse(o => {
    if (!o.isMesh) return;
    assert.ok([...o.geometry.attributes.position.array].every(Number.isFinite));
    assert.ok(o.geometry.boundingSphere.radius < 120);
    assert.equal(o.geometry.groups.length, 0);
  });
  city.dispose();
});

test('street detail unloads when flying overhead, disposes evicted geometry and can reload', () => {
  const city = makeCity(), s = city.streets, at = new THREE.Vector3(0, 1.7, -60);
  for (let i = 0; i < 10; i++) s.update(at);
  let disposed = 0;
  for (const group of s.live.values()) group.traverse(o => o.geometry?.addEventListener('dispose', () => disposed++));
  s.update(new THREE.Vector3(0, 100, -60));
  assert.equal(s.live.size, 0);
  assert.ok(disposed > 0);
  s.update(at);
  assert.equal(s.live.size, 1);
  const maps = [s.materials.sign.map, s.materials.paving.map];
  let sharedDisposed = 0;
  maps.forEach(map => map.addEventListener('dispose', () => sharedDisposed++));
  city.dispose();
  assert.equal(sharedDisposed, 0);
  assert.equal(s.live.size, 0);
  s.update(at);
  assert.equal(s.live.size, 0);
});

test('street furniture preserves the original venue entrance clearances', () => {
  const city = makeCity(), baseline = makeCity({ terra: false });
  let checked = 0;
  for (const venue of city.venues.filter(v => v.frame && !v.noInterior && !v.authored)) {
    if (!baseline.venues.some(v => v.x === venue.x && v.z === venue.z && v.kind === venue.kind)) continue;
    const [x, z] = venue.frame(0, -venue.bd / 2 - 1);
    const a = city.toLocal(x, 1.7, z), b = a.clone();
    city.collideBoxes(a, 0.35, 1.7);
    baseline.collideBoxes(b, 0.35, 1.7);
    assert.ok(a.distanceTo(b) < 0.001, `${venue.kind} doorway was obstructed by new furniture`);
    checked++;
  }
  assert.ok(checked > 5);
  city.dispose(); baseline.dispose();
});

test('Terra-specific settings retain lower detail ranges and do not decorate other worlds', () => {
  const options = (starKey, id, crowd) => Planet.prototype.settlementOptions.call({ ctx: { starKey, preset: { crowd } }, body: { id } });
  assert.equal(options('home', 'p2', 0.25).terra, true);
  assert.equal(options('home', 'p2', 0.25).streetRange, 48);
  assert.equal(options('home', 'p2', 1).streetRange, 80);
  assert.equal(options('home', 'p3', 1).terra, false);
  assert.equal(options('atlas-reach', 'p2', 1).terra, false);
  const city = makeCity({ terra: false });
  assert.equal(city.streets, null);
  city.dispose();
});

test('Terra crowds stay on outer walking routes instead of crossing the central hall', () => {
  const city = makeCity({ crowd: 1 });
  const crowd = city.group.children.find(o => o.isInstancedMesh && o.count === 110);
  assert.ok(crowd);
  const matrix = new THREE.Matrix4(), point = new THREE.Vector3();
  for (let t = 0; t < 150; t++) {
    city.update(0.4, null);
    for (let i = 0; i < crowd.count; i++) {
      crowd.getMatrixAt(i, matrix); point.setFromMatrixPosition(matrix);
      assert.ok(Math.max(Math.abs(point.x), Math.abs(point.z)) >= 91.9);
      assert.ok(Math.min(Math.abs(point.x), Math.abs(point.z)) >= 7.9);
    }
  }
  city.dispose();
});

test('footsteps follow grounded movement and surface, and stop in flight or vehicles', () => {
  const calls = [];
  const g = { player: { grounded: true, mode: 'ground', vel: new THREE.Vector3(5, 0, 0), pos: new THREE.Vector3() },
    rt: { hp: 100 }, frame: { details: { settlements: [{ streets: { surfaceAt: () => true }, toCity: p => p }] } },
    sound: { footstep: surface => calls.push(surface) } };
  const tick = () => Game.prototype.updateFootsteps.call(g, 1 / 60, { up: new THREE.Vector3(0, 1, 0) });
  for (let i = 0; i < 60; i++) tick();
  assert.equal(calls.length, 3);
  assert.ok(calls.every(surface => surface === 'paving'));
  for (const mode of ['fly', 'space']) {
    g.player.mode = mode;
    for (let i = 0; i < 60; i++) tick();
  }
  g.player.mode = 'ground'; g.rt.inVehicle = true;
  for (let i = 0; i < 60; i++) tick();
  g.rt.inVehicle = false; g.player.vel.set(0, 100, 0);
  for (let i = 0; i < 60; i++) tick();
  assert.equal(calls.length, 3);
});
