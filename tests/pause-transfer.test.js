import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
globalThis.Worker = class { postMessage() {} terminate() {} };
const { Input } = await import('../src/core/input.js');
const { Game } = await import('../src/game/game.js');
const { VirtualTransfer } = await import('../src/game/virtual-transfer.js');

function inputFixture() {
  const keyboard = {}, documentEvents = {};
  globalThis.window = { addEventListener: (type, handler) => { keyboard[type] = handler; } };
  globalThis.document = {
    pointerLockElement: null,
    addEventListener: (type, handler) => { documentEvents[type] = handler; },
    exitPointerLock() { this.pointerLockElement = null; documentEvents.pointerlockchange(); },
  };
  const canvas = { addEventListener() {}, requestPointerLock: async () => { throw Object.assign(new Error('Gesture required'), { name: 'NotAllowedError' }); } };
  const input = new Input(canvas);
  let paused = false, panel = false;
  const menus = {
    get pauseOpen() { return paused; }, get panelOpen() { return panel; }, get overlayOpen() { return panel; },
    showPause(value) { paused = value; }, closePanel() { panel = false; },
    $: () => ({ classList: { contains: () => true } }),
  };
  const g = { input, menus, mode: 'playing', inGame: true, training: { busy: false }, sound: { init() {} }, save() {} };
  let pending;
  g.pause = () => Game.prototype.pause.call(g);
  g.resume = () => pending = Game.prototype.resume.call(g);
  input.onKey = (code) => Game.prototype.onKey.call(g, code);
  input.onLockChange = (locked) => Game.prototype.onLockChange.call(g, locked);
  const key = (repeat = false) => keyboard.keydown({ code: 'Escape', repeat, preventDefault() {} });
  return { g, input, canvas, menus, key, documentEvents, pending: () => pending, openPanel() { panel = true; } };
}

test('repeated Escape and rejected pointer lock always leave a usable pause screen', async () => {
  const f = inputFixture();
  f.input.keys.add('KeyW');
  f.key();
  assert.equal(f.menus.pauseOpen, true);
  assert.equal(f.input.down('KeyW'), false);
  for (let i = 0; i < 10; i++) f.key(true);
  assert.equal(f.menus.pauseOpen, true);
  f.key();
  await f.pending();
  assert.equal(f.menus.pauseOpen, true);
  assert.equal(f.input.locked, false);
  // A later explicit click can resume normally.
  f.canvas.requestPointerLock = async () => { document.pointerLockElement = f.canvas; f.documentEvents.pointerlockchange(); };
  assert.equal(await f.g.resume(), true);
  assert.equal(f.menus.pauseOpen, false);
  assert.equal(f.input.locked, true);
});

test('Escape closes a panel into pause without requesting pointer lock', () => {
  const f = inputFixture();
  let requests = 0;
  f.canvas.requestPointerLock = async () => { requests++; };
  f.openPanel();
  f.key();
  assert.equal(f.menus.panelOpen, false);
  assert.equal(f.menus.pauseOpen, true);
  assert.equal(requests, 0);
});

test('a late pointer-lock completion cannot undo a newer pause', async () => {
  const f = inputFixture();
  let resolve;
  f.canvas.requestPointerLock = () => new Promise((r) => { resolve = r; });
  const pending = f.g.resume();
  f.g.pause();
  document.pointerLockElement = f.canvas;
  f.documentEvents.pointerlockchange();
  resolve();
  await pending;
  assert.equal(document.pointerLockElement, null);
  assert.equal(f.input.locked, false);
  assert.equal(f.menus.pauseOpen, true);
});

test('raw mouse fallback only retries an unsupported option, not a denied gesture', async () => {
  const f = inputFixture();
  let requests = 0;
  f.canvas.requestPointerLock = async (options) => {
    requests++;
    if (options) throw Object.assign(new Error(), { name: 'NotSupportedError' });
    document.pointerLockElement = f.canvas;
    f.documentEvents.pointerlockchange();
  };
  assert.equal(await f.input.lock(), true);
  assert.equal(requests, 2);
});

test('Escape during transfer queues pause for arrival without interrupting preparation', () => {
  const f = inputFixture();
  f.g.training.busy = true;
  f.g.mode = 'transferring';
  f.key();
  assert.equal(f.g.training.pauseOnArrival, true);
  assert.equal(f.menus.pauseOpen, false);
});

test('transfer renders every frame even while the destination system is not installed', () => {
  let updates = 0, renders = 0;
  const g = { mode: 'transferring', system: null, clock: { getDelta: () => 0.016 }, time: 0, fpsAcc: 0, fpsFrames: 0,
    training: { transfer: { update() { updates++; } } }, sound: { setListener() {} },
    post: { renderPass: { camera: {} }, render() { renders++; } }, input: { endFrame() {} } };
  for (let i = 0; i < 10; i++) Game.prototype.frameLoop.call(g);
  assert.equal(updates, 10);
  assert.equal(renders, 10);
});

test('virtual warp animates the plaza then reveals the destination without a loading overlay', async () => {
  const fade = { style: {} };
  globalThis.document = { getElementById: (id) => id === 'fade' ? fade : { classList: { add() {} } } };
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  const lines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial());
  const camera = new THREE.PerspectiveCamera(80, 1, 0.1, 1000);
  const virtualCamera = new THREE.PerspectiveCamera(80, 1, 0.1, 1000);
  virtualCamera.position.set(0, 1.7, 32);
  const original = virtualCamera.position.clone();
  const g = { camera, scene: new THREE.Scene(), vu: { camera: virtualCamera, scene: new THREE.Scene(), core: new THREE.Group(), motes: new THREE.Group() },
    warpLines: lines, warpData: [{ x: 1, y: 1, z: -100 }], post: { renderPass: {}, fx: {} },
    menus: { showPause() {} }, hud: { show() {} }, sound: { warp() {}, arrive() {} },
    input: { consumeMouse() {} }, flare: {}, positionCamera() {}, updateAtmosphereLighting() {} };
  g.updateWarpLines = (dt, intensity) => Game.prototype.updateWarpLines.call(g, dt, intensity);
  const transfer = new VirtualTransfer(g);
  transfer.begin();
  for (let i = 0; i < 30; i++) transfer.update(0.05);
  assert.equal(g.mode, 'transferring');
  assert.equal(g.post.renderPass.scene, g.vu.scene);
  assert.equal(lines.parent, virtualCamera);
  assert.ok(virtualCamera.position.distanceTo(original) > 10);
  assert.equal(fade.style.opacity, 0);
  const arrived = transfer.arrive();
  assert.equal(g.post.renderPass.scene, g.scene);
  assert.equal(lines.parent, camera);
  for (let i = 0; i < 20; i++) transfer.update(0.05);
  await arrived;
  assert.equal(transfer.active, false);
  assert.equal(lines.visible, false);
  assert.ok(virtualCamera.position.equals(original));
  assert.equal(g.post.fx.speed, 0);
  delete globalThis.document;
  delete globalThis.window;
});
