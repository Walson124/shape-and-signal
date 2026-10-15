import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { TerraBlock, CONCOURSE_BUILDINGS } from '../src/world/terra-block.js';
import { blockTextures } from '../src/world/block-materials.js';
import { buildSettlement } from '../src/world/city.js';

const context = new Proxy({}, { get(t, key) {
  if (key in t) return t[key];
  if (String(key).includes('Gradient')) return () => ({ addColorStop() {} });
  if (key === 'measureText') return s => ({ width: s.length * 20 });
  return () => {};
} });
globalThis.document = { createElement: () => ({ getContext: () => context }) };
const makeCity = () => buildSettlement({ x: 0, y: 1, z: 0, height: 0, radius: 520, size: 'capital', name: 'Base City 07' }, 18600, { terra: true, crowd: 0 });

test('composed block has four functional ground floors and does not spawn generic interiors over them', () => {
  const city = makeCity();
  assert.ok(city.block instanceof TerraBlock);
  assert.equal(city.block.rooms.length, 4);
  assert.equal(city.block.services.length, 4);
  assert.deepEqual(city.block.services.map(s => s.kind), ['food', 'forge', 'home', 'pills']);
  city.update(0.016, city.toLocal(30, 1.7, -65));
  assert.ok(city.block.rooms.every(v => v.authored && v.interior === null));
  assert.ok(city.services.some(s => s.name === 'Meridian Noodles'));
  assert.equal(city.venueAt(city.toLocal(30, 1.7, -65)).name, 'Meridian Noodles');
  city.dispose();
});

test('doors and the residential rear passage are walkable while shop glazing remains solid', () => {
  const city = makeCity();
  for (const b of CONCOURSE_BUILDINGS) {
    for (const offset of [-0.7, -0.2, 0.2, 0.7]) {
      const x = 46 + b.x, z = -56 + b.z + b.front * (b.d / 2 + offset);
      const p = city.toLocal(x, 1.7, z), before = p.clone();
      city.collideBoxes(p, 0.9, 1.7);
      assert.ok(p.distanceTo(before) < 0.03, `${b.name} entrance obstructed`);
    }
  }
  for (const [x, z] of [[38, -49], [40, -45], [40, -38], [38, -35.6]]) {
    const p = city.toLocal(x, 1.7, z), before = p.clone();
    city.collideBoxes(p, 0.9, 1.7);
    assert.ok(p.distanceTo(before) < 0.03, 'rear passage must remain navigable');
  }
  const glass = city.toLocal(33, 1.7, -61), before = glass.clone();
  city.collideBoxes(glass, 0.9, 1.7);
  assert.ok(glass.distanceTo(before) > 0.5);
  city.dispose();
});

test('a normal-size player can climb the external stair onto the terrace', () => {
  const city = makeCity();
  let feet = 0;
  for (let z = -57.5; z >= -64.3; z -= 0.08) {
    const p = city.toLocal(69.4, feet + 1.7, z);
    const roof = city.collideBoxes(p, 0.9, 1.7);
    const local = city.toCity(p);
    assert.ok(Math.abs(local.x - 69.4) < 0.03 && Math.abs(local.z - z) < 0.03, `stair blocked at ${z}`);
    if (roof !== null) feet = roof - 18600 - city.drop(69.4, z);
  }
  assert.ok(feet > 3.5 && feet < 3.7);
  city.dispose();
});

test('detailed architecture is bounded, complete and evicted independently of shared material maps', () => {
  const city = makeCity(), block = city.block;
  block.update(new THREE.Vector3(20, 1.7, -55));
  assert.ok(block.stats.meshes <= 12);
  assert.ok(block.stats.triangles < 60000);
  assert.equal(block.proxy.visible, false);
  let disposed = 0;
  block.details.traverse(o => {
    if (!o.isMesh) return;
    const g = o.geometry;
    for (const key of ['position', 'normal', 'color', 'bakedLight']) assert.ok([...g.attributes[key].array].every(Number.isFinite));
    g.addEventListener('dispose', () => disposed++);
  });
  block.update(new THREE.Vector3(20, 120, -55));
  assert.equal(block.details.visible, false);
  assert.equal(block.proxy.visible, true);
  block.update(new THREE.Vector3(-450, 1.7, -55));
  assert.equal(block.details, null);
  assert.equal(disposed, 12);
  let mapDisposed = 0;
  const maps = blockTextures();
  maps.brick.map.addEventListener('dispose', () => mapDisposed++);
  city.dispose();
  assert.equal(mapDisposed, 0);
});

test('surface maps use consistent bounded resolutions and baked light composes with the standard shader', () => {
  const maps = blockTextures();
  assert.equal(maps, blockTextures());
  for (const name of ['brick', 'plaster', 'stone', 'wood']) {
    assert.equal(maps[name].map.image.width, 256);
    assert.equal(maps[name].bump.image.width, 256);
  }
  const city = makeCity(), shader = { vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
  city.block.materials.stone.onBeforeCompile(shader);
  assert.ok(shader.vertexShader.includes('attribute vec3 bakedLight'));
  assert.ok(shader.fragmentShader.includes('diffuseColor.rgb * vBakedLight'));
  city.dispose();
});
