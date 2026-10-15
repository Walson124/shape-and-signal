import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { getStar, starsNear, HOME_KEY, ATLAS_KEY } from '../src/world/galaxy.js';
import { generateSystem } from '../src/world/systemgen.js';
import { SHIPS } from '../src/game/data.js';
import { buildChunk } from '../src/world/chunkgen.js';
import { makeTerrain } from '../src/world/terrain.js';
globalThis.Worker = class { postMessage() {} terminate() {} };
const { Game } = await import('../src/game/game.js');
const { Planet } = await import('../src/world/planet.js');

const star = getStar(ATLAS_KEY), system = generateSystem(star);

test('Atlas Reach is a persistent distant warp destination with a higher-hull direct jump', () => {
  assert.equal(star.key, ATLAS_KEY);
  const distance = star.pos.distanceTo(getStar(HOME_KEY).pos);
  assert.equal(distance, 180);
  assert.ok(starsNear(new THREE.Vector3(), 181).some(s => s.star.key === ATLAS_KEY));
  assert.ok(!starsNear(new THREE.Vector3(), 15).some(s => s.star.key === ATLAS_KEY));
  assert.ok(SHIPS[0].range < distance);
  assert.ok(SHIPS.at(-1).range >= distance);
  assert.deepEqual(SHIPS.map(s => s.speed), [900, 1400, 2200, 3500, 6000]);
  assert.deepEqual(SHIPS.map(s => s.cruise), [120000, 300000, 800000, 2000000, 5000000]);
});

test('colossal planets regenerate deterministically without resizing existing worlds', () => {
  assert.deepEqual(generateSystem(star), system);
  assert.equal(system.bodies.find(b => b.id === 'atlas').radius * 2, 12800000);
  assert.equal(system.bodies.find(b => b.id === 'khamsin').radius * 2, 6000000);
  const giant = system.bodies.find(b => b.id === 'behemoth');
  assert.equal(giant.radius * 2, 96000000);
  assert.equal(giant.landable, false);
  assert.ok(giant.rings);
  const home = generateSystem(getStar(HOME_KEY));
  assert.equal(home.bodies.find(b => b.id === 'p2').radius, 18600);
  assert.equal(home.bodies.find(b => b.id === 'p3').radius, 13200);
});

test('large-world terrain, atmospheres and orbits remain bounded and expedition bases have nearby discoveries', () => {
  const planets = system.bodies.filter(b => !b.parent).sort((a, b) => a.orbit.a - b.orbit.a);
  let outer = system.starRadius;
  for (const body of planets) {
    assert.ok(body.orbit.a * (1 - body.orbit.e) - body.radius * 4 > outer);
    outer = body.orbit.a * (1 + body.orbit.e) + body.radius * 4;
  }
  for (const body of system.bodies.filter(b => b.landable)) {
    assert.ok(body.amp <= 8000);
    if (body.atmo) assert.ok(body.radius * body.atmo.height <= 80001);
    const site = body.sites.outposts[0], up = new THREE.Vector3(site.x, site.y, site.z);
    const nearby = body.pois.filter(p => Math.acos(THREE.MathUtils.clamp(up.dot(new THREE.Vector3(...p.dir)), -1, 1)) * body.radius < 16000);
    assert.ok(nearby.length >= 16);
    const terrain = makeTerrain({ ...body, outposts: [site] });
    assert.ok(Math.abs(terrain.height(site.x, site.y, site.z) - site.height) < 0.01);
  }
});

test('Earth-sized landable worlds use fixed-size local chunks at deeper detail levels', () => {
  const body = system.bodies[0];
  const params = { key: 'atlas-chunk-test', type: body.type, seed: body.seed, radius: body.radius, amp: body.amp, sea: body.sea };
  const level = Math.ceil(Math.log2(body.radius * Math.PI / 2 / 50));
  assert.ok(level < 24);
  const node = Planet.prototype.makeNode.call({ faceArc: body.radius * Math.PI / 2, R: body.radius, body }, 2, level, 2 ** (level - 1), 2 ** (level - 1), null);
  assert.ok(node.size <= 50);
  const chunk = buildChunk({ params, face: node.face, level, x: node.x, y: node.y, res: 32, props: true });
  assert.equal(chunk.positions.length / 3, 33 * 33 + 4 * 33);
  assert.ok([...chunk.positions, ...chunk.normals, ...chunk.center].every(Number.isFinite));
  assert.ok(Math.max(...chunk.positions.map(Math.abs)) < 1000, 'vertices stay local despite the planet radius');
  assert.ok(Math.hypot(...chunk.center) > 6e6);
});

test('charting the expedition uses normal navigation without bypassing warp range rules', () => {
  const g = Object.create(Game.prototype);
  let denial = '';
  Object.assign(g, { training: { active: false }, star: getStar(HOME_KEY), shipObj: { tier: 0 }, rt: { inShip: true, cruise: true, warpCharge: 2 },
    hud: { notify() {} }, env: {}, sound: { warp() {} }, denied: message => { denial = message; } });
  g.targetExpedition(ATLAS_KEY);
  assert.equal(g.rt.nav.star.key, ATLAS_KEY);
  assert.equal(g.rt.nav.dist, 180);
  assert.equal(g.rt.warpCharge, 0);
  assert.equal(g.rt.cruise, false);
  g.tryWarp(g.rt.nav.star, g.rt.nav.dist);
  assert.ok(denial.includes('beyond your 15 ly warp range'));
  assert.equal(g.rt.warpCharge, 0);
  g.shipObj.tier = SHIPS.length - 1;
  g.tryWarp(g.rt.nav.star, g.rt.nav.dist);
  assert.equal(g.rt.warpCharge, 3);
  assert.equal(g.rt.warpTarget.key, ATLAS_KEY);
});
