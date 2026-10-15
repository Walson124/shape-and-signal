import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildSettlement } from '../src/world/city.js';
import { planTerraBuilding, terraCityProfile, TERRA_STYLES } from '../src/world/terra-architecture.js';
import { blockTextures } from '../src/world/block-materials.js';

const context = new Proxy({}, { get(t, key) {
  if (key in t) return t[key];
  if (String(key).includes('Gradient')) return () => ({ addColorStop() {} });
  if (key === 'measureText') return s => ({ width: s.length * 20 });
  return () => {};
} });
globalThis.document = { createElement: () => ({ getContext: () => context }) };
const site = { x: 0.6, y: 0.8, z: 0, radius: 300, height: 0, size: 'city', name: 'Test City' };
const make = (s = site, opts = {}) => buildSettlement(s, 18600, { terra: true, crowd: 0, ...opts });

test('city, neighbourhood and lot recipes are reproducible with distinct character and varied buildings', () => {
  const styles = new Set(), silhouettes = new Set(), palettes = new Set(), profiles = new Set();
  for (let town = 0; town < 8; town++) {
    const s = { ...site, x: town * 0.13, z: -town * 0.07 };
    profiles.add(JSON.stringify(terraCityProfile(s)));
    for (let i = 0; i < 40; i++) {
      const lot = { x: i * 46 - 300, z: i % 6 * 46, w: 18 + i % 8, d: 20, h: 75, enter: i % 3 === 0 };
      const p = planTerraBuilding(s, lot);
      assert.deepEqual(p, planTerraBuilding(s, lot));
      styles.add(p.style); palettes.add(p.tint); silhouettes.add(`${p.style}/${p.h}/${p.roof}`);
      assert.ok(p.masses.every(m => m.w <= lot.w && m.d <= lot.d && m.y1 <= p.h && m.y1 > m.y0));
    }
  }
  assert.deepEqual([...styles].sort(), [...TERRA_STYLES].sort());
  assert.equal(profiles.size, 8);
  assert.ok(palettes.size > 200 && silhouettes.size > 70);
  assert.deepEqual(terraCityProfile(site), terraCityProfile({ ...site, name: 'Renamed' }));
});

test('procedural architecture covers towns and outposts across Terra while other planets keep their architecture', () => {
  for (const size of ['capital', 'city', 'outpost']) {
    const city = make({ ...site, size, radius: size === 'outpost' ? 170 : 300 });
    assert.ok(city.architecture.plans.length > 5);
    assert.ok(new Set(city.architecture.plans.map(p => p.style)).size >= 3);
    assert.ok(city.architecture.stats.baseTriangles < 160000);
    city.dispose();
  }
  const elsewhere = make(site, { terra: false });
  assert.equal(elsewhere.architecture, null);
  elsewhere.dispose();
});

test('architecture streams one cell per update, remains bounded along a route, and releases shared-map-free geometry', t => {
  const city = make(), a = city.architecture;
  let peak = 0;
  for (const [x, z] of [[-80, -100], [130, -100], [-170, 70], [90, 170]]) {
    const pos = new THREE.Vector3(x, 1.7 + city.drop(x, z), z);
    for (let i = 0; i < 6; i++) {
      const before = a.live.size; a.update(pos);
      assert.ok(a.live.size - before <= 1 && a.live.size <= 4);
      assert.ok(a.stats.meshes <= 48);
      peak = Math.max(peak, a.stats.triangles);
    }
    for (const g of a.live.values()) for (const mesh of g.children) {
      assert.ok(mesh.geometry.boundingSphere.radius < 160);
      for (const name of ['position', 'normal', 'color', 'bakedLight', 'uv']) assert.ok([...mesh.geometry.attributes[name].array].every(Number.isFinite));
    }
  }
  assert.ok(peak < 180000);
  t.diagnostic(`Peak streamed architecture: ${peak} triangles`);
  let disposed = 0, textureDisposed = 0;
  for (const group of a.live.values()) group.traverse(o => o.geometry?.addEventListener('dispose', () => disposed++));
  const maps = blockTextures(); maps.brick.map.addEventListener('dispose', () => textureDisposed++);
  a.update(new THREE.Vector3(0, 100, 0));
  assert.equal(a.live.size, 0); assert.ok(disposed > 0);
  a.update(new THREE.Vector3(-80, 1.7, -100)); assert.equal(a.live.size, 1);
  city.dispose(); assert.equal(textureDisposed, 0); assert.equal(a.live.size, 0);
  a.update(new THREE.Vector3(-80, 1.7, -100)); assert.equal(a.live.size, 0);
  const low = make(site, { streetRange: 48 });
  for (let i = 0; i < 8; i++) low.architecture.update(new THREE.Vector3(-80, 1.7, -100));
  assert.ok(low.architecture.live.size <= 2);
  low.dispose();
});

test('all real venue entrances remain clear and stepped towers collide with their actual upper footprint', () => {
  const city = make();
  for (const v of city.venues.filter(v => v.frame && !v.noInterior)) {
    for (const offset of [-0.5, 0, 0.5]) {
      const [x, z] = v.frame(0, -v.bd / 2 + offset), p = city.toLocal(x, 1.7, z), original = p.clone();
      city.collideBoxes(p, 0.9, 1.7);
      assert.ok(p.distanceTo(original) < 0.04, `${v.kind} entrance obstructed`);
    }
  }
  const p = city.architecture.plans.find(p => !p.enter && p.masses.length === 2);
  assert.ok(p);
  const top = p.masses[1], x = p.x + (top.w + p.w) / 4, z = p.z, y = top.y0 + 3;
  const outside = city.toLocal(x, y, z), before = outside.clone();
  city.collideBoxes(outside, 0.1, 1.7);
  assert.ok(outside.distanceTo(before) < 0.01, 'setback must not retain an invisible full-width wall');
  const inside = city.toLocal(p.x, y, z), start = inside.clone();
  city.collideBoxes(inside, 0.9, 1.7);
  assert.ok(inside.distanceTo(start) > 0.5);
  city.dispose();
});
