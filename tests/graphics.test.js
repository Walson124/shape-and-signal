import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { bevelBox, taperedHull, smoothSurface } from '../src/world/geometry.js';
import { propGeometries, propMaterial, terrainMaterial } from '../src/world/props.js';
import { buildSettlement } from '../src/world/city.js';
import { buildDockStation } from '../src/world/station.js';
import { buildRuinField } from '../src/world/ruins.js';
import { buildInterior, npcGeometry, VENUES } from '../src/world/interiors.js';
import { Vehicle, VEHICLE_IDS } from '../src/game/vehicle.js';
import { buildPoi } from '../src/world/pois.js';
import { buildStructure } from '../src/game/structures.js';

// Scene construction only; this does not substitute for a browser/GPU test.
const context = new Proxy({}, { get(target, key) {
  if (key in target) return target[key];
  if (key === 'measureText') return text => ({ width: text.length * 20 });
  if (String(key).includes('Gradient')) return () => ({ addColorStop() {} });
  return () => {};
} });
globalThis.document = { createElement: () => ({ getContext: () => context }) };

test('chamfered boxes stay closed, outward facing, inside collision bounds and within budget', () => {
  for (const dimensions of [[8, 20, 10], [1, 1, 1], [20, 1, 15]]) {
    const g = bevelBox(...dimensions);
    assert.equal(g.attributes.position.count / 3, 44);
    assert.equal(g.groups.length, 0);
    g.computeBoundingBox();
    dimensions.forEach((size, axis) => {
      const key = ['x', 'y', 'z'][axis];
      assert.ok(Math.abs(g.boundingBox.max[key] - size / 2) < 1e-5);
      assert.ok(Math.abs(g.boundingBox.min[key] + size / 2) < 1e-5);
    });
    const edges = new Map(), p = g.attributes.position, n = g.attributes.normal;
    const key = v => v.toArray().map(x => x.toFixed(5)).join(',');
    for (let i = 0; i < p.count; i += 3) {
      const vertices = [0, 1, 2].map(k => new THREE.Vector3().fromBufferAttribute(p, i + k));
      const normal = new THREE.Vector3().subVectors(vertices[1], vertices[0]).cross(new THREE.Vector3().subVectors(vertices[2], vertices[0])).normalize();
      assert.ok(normal.dot(new THREE.Vector3().fromBufferAttribute(n, i)) > 0.999);
      assert.ok(normal.dot(vertices[0]) > 0);
      for (let k = 0; k < 3; k++) {
        const edge = [key(vertices[k]), key(vertices[(k + 1) % 3])].sort().join('|');
        edges.set(edge, (edges.get(edge) || 0) + 1);
      }
    }
    assert.ok([...edges.values()].every(count => count === 2));
  }
  assert.equal(bevelBox(10, 0.12, 8).index.count / 3, 12);
  assert.equal(bevelBox(0.7, 100, 0.7).index.count / 3, 12);
});

test('vehicle shells keep finite normals and bounded silhouettes through model swaps', () => {
  const hull = taperedHull(2, 1, 4);
  hull.computeBoundingBox();
  assert.equal(hull.attributes.position.count / 3, 44);
  assert.ok(hull.boundingBox.min.x >= -1 && hull.boundingBox.max.x <= 1);
  assert.ok(hull.boundingBox.min.y >= -0.5 && hull.boundingBox.max.y <= 0.5);
  assert.equal(hull.boundingBox.min.z, -2);
  assert.equal(hull.boundingBox.max.z, 2);
  const root = new THREE.Group(), vehicle = new Vehicle(root, 'bike');
  for (const id of VEHICLE_IDS) {
    vehicle.setKind(id);
    vehicle.place(new THREE.Vector3(0, 4000, 0), new THREE.Vector3(0, 0, -1));
    assert.equal(root.children.length, 1);
    let triangles = 0;
    vehicle.model.group.traverse(o => {
      if (!o.isMesh) return;
      const g = o.geometry;
      assert.ok([...g.attributes.normal.array].every(Number.isFinite));
      triangles += (g.index ? g.index.count : g.attributes.position.count) / 3;
    });
    assert.ok(triangles < 1000, `${id} exceeds lightweight model budget`);
  }
  vehicle.dispose();
  assert.equal(root.children.length, 0);
});

test('organic welding reduces vertices while preserving triangle count and unit normals', () => {
  const original = new THREE.IcosahedronGeometry(1, 2);
  const triangles = original.attributes.position.count / 3;
  const smooth = smoothSurface(original);
  assert.equal(smooth.index.count / 3, triangles);
  assert.ok(smooth.attributes.position.count < original.attributes.position.count / 2);
  const n = smooth.attributes.normal;
  for (let i = 0; i < n.count; i++) assert.ok(Math.abs(new THREE.Vector3().fromBufferAttribute(n, i).length() - 1) < 1e-5);
});

test('terrain relief composes with the standard shader without new texture samplers', () => {
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
  terrainMaterial().onBeforeCompile(shader);
  assert.ok(shader.fragmentShader.indexOf('float groundDetail =') < shader.fragmentShader.indexOf('dFdx(groundDetail)'));
  assert.ok(shader.fragmentShader.includes('#include <normal_fragment_maps>'));
  assert.equal((shader.fragmentShader.match(/uniform sampler/g) || []).length, (THREE.ShaderLib.standard.fragmentShader.match(/uniform sampler/g) || []).length);
  assert.ok(shader.fragmentShader.includes('max(abs(groundDet), 0.000001)'));
});

test('landmark and placeable variants retain valid geometry after merging', () => {
  for (const kind of ['ruin', 'spring', 'ore', 'nest', 'wreck', 'lair', 'obelisk', 'camp']) {
    const poi = buildPoi({ kind, seed: 4 });
    poi.update(0.016);
    poi.group.traverse(o => {
      if (!o.isMesh) return;
      assert.ok(o.geometry, `${kind} contains a failed geometry merge`);
      assert.ok([...o.geometry.attributes.position.array].every(Number.isFinite));
    });
  }
  for (const kind of ['tent', 'turret', 'totem']) {
    const structure = buildStructure(kind);
    structure.group.traverse(o => { if (o.isMesh) assert.ok([...o.geometry.attributes.position.array].every(Number.isFinite)); });
    structure.ghost(true);
    structure.ghost(false);
    structure.dispose();
  }
});

test('organic prop and NPC geometry retains smooth normals without extra geometry or materials', () => {
  const props = propGeometries();
  assert.equal(props, propGeometries());
  for (const g of [...Object.values(props), npcGeometry()]) {
    for (const name of ['position', 'normal']) assert.ok([...g.attributes[name].array].every(Number.isFinite));
    assert.equal(g.groups.length, 0);
  }
  const g = npcGeometry(), n = g.attributes.normal;
  let smooth = 0;
  for (let i = 0; i < n.count; i += 3) if (new THREE.Vector3().fromBufferAttribute(n, i).distanceTo(new THREE.Vector3().fromBufferAttribute(n, i + 1)) > 0.01) smooth++;
  assert.ok(smooth > 100, 'capsule normals must survive the merged NPC geometry');
  assert.equal(propMaterial().flatShading, false);
});

test('representative world scenes retain valid merged geometry and bounded scene budgets', () => {
  const site = { x: 0, y: 1, z: 0, height: 0, radius: 320, size: 'capital', name: 'Test', seed: 4 };
  // Original scene mesh counts; chamfers must not introduce new draw batches. The city's
  // neon signage adds exactly four merged batches (blade signs, roof strips, billboards, posts)
  // and some 20k triangles of simple boxes and panels.
  const scenes = [[buildSettlement(site, 4000, { crowd: 1 }).group, 81, 130000],
    [buildDockStation('Test').group, 205, 23000],
    [buildRuinField({ ...site, radius: 200 }, { R: 4000, groundRadius: () => 4000 }).group, 6, 9000]];
  for (const [root, meshBudget, triangleBudget] of scenes) {
    let meshes = 0, triangles = 0;
    root.traverse(o => {
      if (!o.isMesh) return;
      assert.ok(o.geometry, 'mixed indexed/non-indexed batches must merge successfully');
      const g = o.geometry;
      assert.ok([...g.attributes.position.array].every(Number.isFinite));
      meshes++;
      triangles += (g.index ? g.index.count : g.attributes.position.count) / 3 * (o.isInstancedMesh ? o.count : 1);
    });
    assert.equal(meshes, meshBudget);
    assert.ok(triangles <= triangleBudget, `unexpected triangle increase: ${triangles}`);
  }
  for (const kind of Object.keys(VENUES)) {
    const interior = buildInterior(kind, 24, 28, 7, 4, 'Test');
    interior.group.traverse(o => {
      if (!o.isMesh) return;
      assert.ok(o.geometry);
      assert.ok([...o.geometry.attributes.position.array].every(Number.isFinite));
    });
    interior.dispose();
  }
});
