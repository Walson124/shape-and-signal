import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { recordJump, findRoute } from '../src/game/starmap.js';

const star = (key, x, z = 0) => ({ key, pos: new THREE.Vector3(x, 0, z) });

test('each warp is remembered once, whichever way you flew it', () => {
  const s = {};
  recordJump(s, 'home', 'a');
  recordJump(s, 'a', 'home');
  recordJump(s, 'a', 'b');
  recordJump(s, 'b', 'b');
  assert.deepEqual(s.jumps, [['home', 'a'], ['a', 'b']]);
});

test('the route home goes through known systems within warp range', () => {
  const stars = [star('home', 0), star('a', 20), star('b', 40), star('far', 60), star('x', 30, 25)];
  const route = findRoute(stars, 'far', 'home', 22);
  assert.deepEqual(route.map((s) => s.key), ['b', 'a', 'home']);
});

test('home in range is a single jump; no chain means no route', () => {
  const stars = [star('home', 0), star('a', 20), star('lost', 200)];
  assert.deepEqual(findRoute(stars, 'a', 'home', 25).map((s) => s.key), ['home']);
  assert.equal(findRoute(stars, 'lost', 'home', 25), null);
  assert.equal(findRoute(stars, 'a', 'home', 0), null);
});

test('fewest jumps wins over a shorter total distance', () => {
  const stars = [star('home', 0), star('s1', 9), star('s2', 18), star('start', 27), star('mid', 14, 10)];
  const route = findRoute(stars, 'start', 'home', 20);
  assert.equal(route.length, 2);
});
