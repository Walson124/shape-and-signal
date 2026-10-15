import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

class FakeWorker {
  postMessage() {}
  terminate() { this.terminated = true; }
}
globalThis.Worker = FakeWorker;
const { WorkerPool } = await import('../src/world/texpool.js');
const { VirtualWorld } = await import('../src/game/virtual.js');
const { Game } = await import('../src/game/game.js');
const { Menus } = await import('../src/ui/menus.js');
const { newState, derive } = await import('../src/game/state.js');
const ringJob = { stops: [[0, 0, 0], [255, 255, 255]], seed: 1 };

test('worker crash recovers running and queued jobs, respecting cancellation', async () => {
  const pool = new WorkerPool();
  const workers = [...pool.workers];
  const jobs = Array.from({ length: workers.length + 2 }, () => pool.run('ring', ringJob));
  jobs.push(pool.run('ring', ringJob, { cancelled: () => true }));
  workers[0].onerror();
  const results = await Promise.all(jobs);
  assert.equal(results.at(-1), null);
  assert.ok(results.slice(0, -1).every((r) => r.data.length === 16384));
  assert.ok(workers.every((w) => w.terminated));
  assert.equal(pool.busy, 0);
  assert.equal(pool.pending.size, 0);
  assert.equal((await pool.run('ring', ringJob)).w, 1024);
});

test('main thread fallback rejects generation errors rather than hanging', async () => {
  const pool = new WorkerPool();
  pool.failWorkers();
  await assert.rejects(pool.run('unknown', {}), TypeError);
  assert.equal(pool.busy, 0);
});

test('postMessage failures recover the job', async () => {
  const pool = new WorkerPool();
  pool.workers[0].postMessage = () => { throw new Error('post failed'); };
  assert.equal((await pool.run('ring', ringJob)).w, 1024);
  assert.equal(pool.busy, 0);
});

test('clearing simulator targets disposes geometry and material', () => {
  const targets = new THREE.Group();
  const target = new THREE.Mesh(new THREE.IcosahedronGeometry(0.9, 1), new THREE.MeshBasicMaterial());
  let geometryDisposed = false, materialDisposed = false;
  target.geometry.addEventListener('dispose', () => { geometryDisposed = true; });
  target.material.addEventListener('dispose', () => { materialDisposed = true; });
  targets.add(target);
  VirtualWorld.prototype.clearTargets.call({ targets });
  assert.equal(targets.children.length, 0);
  assert.ok(geometryDisposed && materialDisposed);
});

test('save failure notifies once, then recovery saves the latest progress', () => {
  const notifications = [];
  let fail = true, saved;
  globalThis.localStorage = { setItem(key, value) {
    if (fail) throw new Error('storage full');
    saved = JSON.parse(value);
  } };
  const game = {
    state: newState(), mode: 'playing', system: {}, star: { key: 'home' }, frame: null,
    player: { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), mode: 'ground' },
    rt: { inShip: false }, locationLabel: () => 'Home',
    hud: { notify: (...args) => notifications.push(args) },
  };
  assert.equal(Game.prototype.save.call(game), false);
  assert.equal(Game.prototype.save.call(game), false);
  assert.equal(notifications.length, 1);
  game.state.coins = 777;
  fail = false;
  assert.equal(Game.prototype.save.call(game), true);
  assert.equal(saved.coins, 777);
  assert.equal(notifications.length, 2);
  assert.match(notifications[1][0], /Saving restored/);
  delete globalThis.localStorage;
});

test('breakthrough checklist covers progress, final boss, ship and summit', () => {
  const state = newState();
  const game = { state, stats: derive(state), rt: {}, breakthroughStatus() {
    return Game.prototype.breakthroughStatus.call(this);
  } };
  const render = () => Menus.prototype.renderBreakthrough.call({ game });
  assert.match(render(), /0 \/ 3/);
  assert.match(render(), /War God/);
  state.stage = 3;
  state.xp = (game.stats = derive(state)).xpNeed;
  state.insight = 1;
  assert.match(render(), /3 \/ 3/);
  assert.match(render(), /Ready/);
  game.rt.inShip = true;
  assert.match(render(), /Leave your ship/);
  state.realm = 8;
  state.xp = (game.stats = derive(state)).xpNeed;
  assert.match(render(), /3 \/ 4/);
  assert.match(render(), /Needed: Slay the Primordial Devourer/);
  state.realm = 9;
  assert.match(render(), /summit/);
});
