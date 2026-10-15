import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Player, EYE } from '../src/game/player.js';
import { beginDodge, DODGE } from '../src/game/evasion.js';

const up = new THREE.Vector3(0, 1, 0);
const idle = { x: 0, y: 0, z: 0 };
const runtime = () => ({ energy: 100, dodgeCd: 0, invuln: 0, medBlock: 0 });
function player() {
  // Only the procedural glow texture needs a canvas; physics uses real Three.js objects.
  globalThis.document = { createElement: () => ({ getContext: () => ({
    createRadialGradient: () => ({ addColorStop() {} }), fillRect() {},
  }) }) };
  const p = new Player(new THREE.Group(), { emit() {} });
  delete globalThis.document;
  p.pos.set(0, 1000 + EYE, 0);
  p.grounded = true;
  return p;
}
const env = (extra = {}) => ({ up, floorR: 1000, gravity: 18, speed: 6, jumpSpeed: 8,
  jump: false, time: 0, hidden: true, ...extra });

test('dodge costs energy, protects briefly, and cannot repeat during cooldown', () => {
  const p = player(), rt = runtime();
  assert.equal(beginDodge(rt, p, { x: 1, y: 0, z: 0 }, up, 6), true);
  assert.equal(rt.energy, 100 - DODGE.cost);
  assert.equal(rt.invuln, DODGE.protection);
  assert.equal(rt.dodgeCd, DODGE.cooldown);
  assert.ok(rt.dodgeDir.x > 0.99);
  assert.equal(beginDodge(rt, p, idle, up, 6), false);
  assert.equal(rt.energy, 100 - DODGE.cost);
});

test('idle dodge moves backward, preserves existing protection, and stays above terrain', () => {
  const p = player(), rt = runtime();
  rt.invuln = 2;
  beginDodge(rt, p, idle, up, 6);
  assert.ok(rt.dodgeDir.z > 0.99);
  assert.equal(rt.invuln, 2);
  p.update(1 / 60, idle, env({ dodge: { dir: rt.dodgeDir, speed: rt.dodgeSpeed } }));
  assert.ok(p.pos.z > 0.39);
  assert.ok(p.pos.length() >= 1000 + EYE);
});

test('dodge is unavailable in the air, in flight, or without energy', () => {
  for (const change of [p => { p.grounded = false; }, p => { p.mode = 'fly'; }]) {
    const p = player(), rt = runtime();
    change(p);
    assert.equal(beginDodge(rt, p, idle, up, 6), false);
    assert.equal(rt.energy, 100);
  }
  const rt = runtime();
  rt.energy = DODGE.cost - 1;
  assert.equal(beginDodge(rt, player(), idle, up, 6), false);
});

test('jump works just after leaving a ledge, but not after grace expires', () => {
  const p = player();
  p.grounded = false;
  p.groundGrace = 0.1;
  p.pos.y += 4;
  p.update(1 / 60, idle, env({ jump: true }));
  assert.ok(p.vel.y > 7);
  assert.equal(p.groundGrace, 0);
  p.update(1 / 60, idle, env({ jump: true }));
  assert.ok(p.vel.y < 8); // no second jump while rising
  p.vel.set(0, 0, 0);
  p.groundGrace = 0.01;
  p.update(0.02, idle, env({ jump: true }));
  assert.ok(p.vel.y < 0);
});

test('a jump pressed just before landing is buffered until ground contact', () => {
  const p = player();
  p.grounded = false;
  p.pos.y += 0.02;
  p.vel.y = -3;
  p.update(1 / 60, idle, env({ jump: true }));
  assert.equal(p.grounded, true);
  p.update(1 / 60, idle, env());
  assert.ok(p.vel.y > 7);
  assert.equal(p.jumpBuffer, 0);
});

test('jumping does not regain ground contact while rising near the floor', () => {
  const p = player();
  p.update(1 / 120, idle, env({ jump: true }));
  assert.equal(p.grounded, false);
});
