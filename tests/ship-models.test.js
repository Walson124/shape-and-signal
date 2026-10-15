import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildPlayerShip } from '../src/world/models.js';
import { Ship } from '../src/game/ship.js';

globalThis.document = { createElement: () => ({ getContext: () => ({ createRadialGradient: () => ({ addColorStop() {} }), fillRect() {}, strokeRect() {} }) }) };

test('every ship has a distinct geometry silhouette and expected engine layout even with identical colors', t => {
  const fingerprints = new Set(), expectedEngines = [1, 2, 2, 4, 6];
  for (let tier = 0; tier < 5; tier++) {
    const model = buildPlayerShip(tier, 0x3ef2ff), sprites = model.group.children.filter(o => o.isSprite);
    assert.equal(sprites.length, expectedEngines[tier]);
    let meshes = 0, triangles = 0, maxRadius = 0;
    const fingerprint = [];
    model.group.traverse(o => {
      if (!o.isMesh) return;
      meshes++;
      const g = o.geometry, p = g.attributes.position;
      assert.ok([...p.array, ...g.attributes.normal.array].every(Number.isFinite));
      assert.equal(g.groups.length, 0);
      triangles += (g.index ? g.index.count : p.count) / 3;
      for (let i = 0; i < p.count; i++) maxRadius = Math.max(maxRadius, Math.hypot(p.getX(i), p.getY(i), p.getZ(i)));
      if (o.name === 'hull') fingerprint.push(...p.array);
    });
    assert.ok(maxRadius <= 13, `${model.group.name} exceeds existing collision envelope: ${maxRadius}`);
    assert.ok(meshes <= 5);
    assert.ok(triangles < 6000);
    fingerprints.add(JSON.stringify(fingerprint));
    t.diagnostic(`${model.group.name}: ${triangles} triangles, ${meshes + sprites.length} draws including exhaust`);
    model.dispose();
  }
  assert.equal(fingerprints.size, 5);
  const corvette = buildPlayerShip(1, 0xffffff), frigate = buildPlayerShip(2, 0xffffff);
  corvette.group.updateMatrixWorld(true); frigate.group.updateMatrixWorld(true);
  const size = model => new THREE.Box3().setFromObject(model.group.getObjectByName('hull')).getSize(new THREE.Vector3());
  const escort = size(corvette), patrol = size(frigate);
  assert.ok(patrol.x > escort.x * 1.2 && patrol.y > escort.y * 1.2 && patrol.z > escort.z * 1.25,
    'the Frigate must read as a larger vessel in every dimension');
  corvette.dispose(); frigate.dispose();
});

test('exhaust animates on every engine and gear keeps the existing ground clearance', () => {
  for (let tier = 0; tier < 5; tier++) {
    const model = buildPlayerShip(tier, 0xffcc88), flames = model.group.children.filter(o => o.isSprite);
    const initial = flames.map(f => f.scale.x);
    model.setThrust(1);
    flames.forEach((f, i) => assert.ok(f.scale.x > initial[i]));
    model.setThrust(100);
    assert.ok(flames.every(f => Number.isFinite(f.scale.x) && f.scale.x < 10));
    model.group.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(model.gear);
    const s = 1 + tier * 0.18;
    assert.ok(bounds.min.y >= -3.8 * s);
    assert.ok(Math.abs(bounds.min.y + 3.725 * s) < 1e-4);
    assert.ok(model.group.children.includes(model.gear));
    model.dispose();
  }
});

test('tier swaps preserve hull percentage, transforms and one active model with working gear', () => {
  const root = new THREE.Group(), ship = new Ship(root, 0);
  ship.pos.set(500, 600, 700); ship.vel.set(10, 20, 30); ship.hull = ship.maxHull / 2;
  for (let tier = 1; tier < 5; tier++) {
    ship.setTier(tier);
    assert.equal(root.children.length, 1);
    assert.equal(ship.hull / ship.maxHull, 0.5);
    assert.ok(ship.model.group.position.equals(ship.pos));
    assert.ok(ship.vel.equals(new THREE.Vector3(10, 20, 30)));
    ship.landed = true; ship.sync(); assert.equal(ship.model.gear.visible, true);
    ship.landed = false; ship.gearOut = false; ship.sync(); assert.equal(ship.model.gear.visible, false);
  }
  ship.dispose(); assert.equal(root.children.length, 0);
});

test('disposing batched ship models frees geometry and materials but retains cached shared textures', () => {
  const model = buildPlayerShip(4, 0xeeeeff), geometries = new Set(), materials = new Set(), maps = new Set();
  model.group.traverse(o => {
    if (o.isMesh) geometries.add(o.geometry);
    if (o.material) { materials.add(o.material); if (o.material.map) maps.add(o.material.map); }
  });
  let disposedGeometry = 0, disposedMaterial = 0, disposedMaps = 0;
  geometries.forEach(g => g.addEventListener('dispose', () => disposedGeometry++));
  materials.forEach(m => m.addEventListener('dispose', () => disposedMaterial++));
  maps.forEach(m => m.addEventListener('dispose', () => disposedMaps++));
  model.dispose();
  assert.equal(disposedGeometry, geometries.size);
  assert.equal(disposedMaterial, materials.size);
  assert.equal(disposedMaps, 0);
});
