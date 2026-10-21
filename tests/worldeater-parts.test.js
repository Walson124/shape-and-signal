import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { BeastManager } from '../src/game/beasts.js';

// A World-Eater's body is tens of kilometres long; its hit zones (segments, heart-nodes,
// the core) must not be despawned like stray beasts far from the player, or nothing on it
// can be hit and its health bar never moves.
test('parts of a giant are never despawned for being far from the player', () => {
  const stub = new Proxy({}, { get: () => () => {} });
  const m = new BeastManager(new THREE.Scene(), stub, stub, stub);
  m.env = { despawn: 3000, max: 0 };
  const far = new THREE.Vector3(10000, 0, 0);
  const owner = {};
  const part = { type: 'titanpart', planetary: true, owner, alive: true, boss: false, pos: far.clone(), radius: 400, mesh: new THREE.Group(), model: { group: new THREE.Group(), anim() {}, flash: [] } };
  const stray = { type: 'wolf', alive: true, boss: false, pos: far.clone(), radius: 2, mesh: new THREE.Group(), model: { group: new THREE.Group(), anim() {}, flash: [] } };
  m.beasts.push(part, stray);
  try { m.update(0.016, { player: { pos: new THREE.Vector3() }, playerAlive: true, time: 0 }); } catch { /* the rest of the update needs a full game */ }
  assert.ok(m.beasts.includes(part), 'the World-Eater part was despawned');
  assert.equal(part.alive, true);
  assert.ok(!m.beasts.includes(stray), 'a stray beast that far away should go');
});
