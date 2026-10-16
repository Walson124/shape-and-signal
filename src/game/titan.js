import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { relativeSkinning } from './beast-models.js';

// The planetary titans' bodies and minds.
//
// A titan is a huge, animated creature (tools/blender/make_titans.py) that moves
// the whole fight: it stalks and circles, closes distance, and attacks with
// moves that are read from its body, not from markings on the ground. Every
// move has a wind-up (it tracks you), a commit point (it stops tracking) and a
// recovery, its hits ride on the bones that swing, and moves chain into combos
// with uneven, delayed follow-ups. Keeping far away doesn't work: its hide turns
// aside distant blows, and it has leaps, beams and volleys for anyone who tries.
// Weak points stagger it when broken; the World Rend opens at phase changes.

const V = () => new THREE.Vector3();
const tA = V(), tB = V(), tC = V(), tQ = new THREE.Quaternion(), tM = new THREE.Matrix4();
const smooth = (x) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
const rand = (a, b) => a + Math.random() * (b - a);

// ---------------------------------------------------------------- data --
// Distances are in titan scales (multiply by def.scale for metres); move
// times are normalised over dur seconds. lock: when it stops tracking you.
const H = (bones, from, to, r, dmg = 1, knock = 60) => ({ bones, from, to, r, dmg, knock });
export const TITANS = {
  vesper: {
    scale: 80, foot: 0.72, walk: 0.34, run: 0.9, turn: 0.9, prefer: [1.6, 3.2],
    parts: [
      { bone: 'head', r: 0.32, kind: 'weak', name: 'Black Crown', breakHp: 0.05 },
      { bone: 'spine', r: 0.5 }, { bone: 'pelvis', r: 0.45 }, { bone: 'neck', r: 0.3 },
      { bone: 'upperarm_l', r: 0.24 }, { bone: 'upperarm_r', r: 0.24 }, { bone: 'forearm_l', r: 0.2 }, { bone: 'forearm_r', r: 0.2 },
      { bone: 'thigh_l', r: 0.24 }, { bone: 'thigh_r', r: 0.24 }, { bone: 'tail1', r: 0.2 }, { bone: 'tail2', r: 0.14 },
      { bone: 'spine', at: [0, -0.15, 0.35], r: 0.2, kind: 'core', name: 'Burning Core', breakHp: 0.06 },
    ],
    moves: {
      swipe_l: { clip: 'swipe_l', dur: 1.9, lock: 0.38, range: [0, 2.0], hits: [H(['paw_l', 'forearm_l'], 0.44, 0.6, 0.32, 1)], lunge: [0.42, 0.56, 0.35],
        next: [{ id: 'swipe_r', p: 0.6, delay: [0.0, 0.25] }, { id: 'bite', p: 0.25, delay: [0.35, 0.8] }] },
      swipe_r: { clip: 'swipe_r', dur: 1.7, lock: 0.38, range: [0, 2.0], hits: [H(['paw_r', 'forearm_r'], 0.44, 0.6, 0.32, 1)], lunge: [0.42, 0.56, 0.35],
        next: [{ id: 'slam', p: 0.35, delay: [0.6, 1.4] }, { id: 'swipe_l', p: 0.3, delay: [0.1, 0.5] }] },
      bite: { clip: 'bite', dur: 1.8, lock: 0.42, range: [0, 2.4], hits: [H(['head', 'snout', 'jaw'], 0.46, 0.6, 0.3, 1.3, 90)], lunge: [0.45, 0.58, 0.9] },
      slam: { clip: 'slam', dur: 2.6, lock: 0.45, range: [0, 2.6], hits: [H(['paw_l', 'paw_r'], 0.55, 0.64, 0.4, 1.6, 120)],
        shock: { at: 0.6, speed: 1.6, max: 4.5, width: 0.12, height: 0.12, dmg: 1 }, shake: 1.2, heavy: true,
        next: [{ id: 'leap', p: 0.25, delay: [1.2, 2.0], phase: 1 }] },
      tail: { clip: 'tail', dur: 1.9, lock: 0.4, range: [0, 2.6], behind: true, hits: [H(['tail2', 'tail3'], 0.45, 0.62, 0.3, 1.1, 120)] },
      leap: { clip: 'leap', dur: 3.0, lock: 0.32, range: [2.2, 9], closer: true, leap: [0.36, 0.86, 1.6], hits: [H(['paw_l', 'paw_r', 'spine'], 0.82, 0.92, 0.5, 1.7, 140)],
        shock: { at: 0.88, speed: 1.8, max: 4, width: 0.12, height: 0.12, dmg: 1 }, shake: 1.4, heavy: true,
        next: [{ id: 'swipe_l', p: 0.5, delay: [0.2, 0.7] }] },
      beam: { clip: 'beam', dur: 4.2, lock: 0.22, range: [1.8, 12], ranged: true, phase: 1, beam: { from: 0.25, to: 0.85, len: 9, width: 0.09, dps: 0.9 } },
      roar: { clip: 'roar', dur: 2.6, lock: 0.2, range: [0, 12], antiair: true, roar: { at: 0.28, r: 3.4, knock: 220 }, volley: { at: 0.5, count: 9, speed: 260, spread: 0.22, dmg: 0.45 }, shake: 1 },
    },
  },
  serekh: {
    scale: 70, foot: 0.28, walk: 0.5, run: 1.25, turn: 1.1, prefer: [1.4, 3.6], burrows: true,
    parts: [
      { bone: 'head', r: 0.36, kind: 'weak', name: 'Sun-glass Maw', breakHp: 0.05 },
      { bone: 'neck', r: 0.32 }, { bone: 'fw5', r: 0.32 }, { bone: 'fw4', r: 0.32 }, { bone: 'fw3', r: 0.32 }, { bone: 'fw2', r: 0.32 }, { bone: 'pelvis', r: 0.32 },
      { bone: 'bw2', r: 0.3, kind: 'weak', name: 'Glass Sac', breakHp: 0.03 }, { bone: 'bw1', r: 0.3 }, { bone: 'bw3', r: 0.28 }, { bone: 'bw4', r: 0.26 },
      { bone: 'bw5', r: 0.24, kind: 'weak', name: 'Glass Sac', breakHp: 0.03 }, { bone: 'bw6', r: 0.22 }, { bone: 'bw7', r: 0.2 },
    ],
    moves: {
      bite: { clip: 'bite', dur: 1.9, lock: 0.42, range: [0, 2.6], hits: [H(['head', 'jaw'], 0.46, 0.6, 0.42, 1.3, 100)], lunge: [0.45, 0.58, 1.2],
        next: [{ id: 'bite', p: 0.3, delay: [0.4, 1.1] }, { id: 'tail', p: 0.3, delay: [0.2, 0.6] }] },
      slam: { clip: 'slam', dur: 2.6, lock: 0.45, range: [0, 3], hits: [H(['head', 'neck', 'fw5'], 0.55, 0.66, 0.45, 1.6, 120)],
        shock: { at: 0.62, speed: 1.6, max: 4.5, width: 0.1, height: 0.12, dmg: 1 }, shake: 1.2, heavy: true },
      tail: { clip: 'tail', dur: 2.0, lock: 0.4, range: [0, 4], behind: true, hits: [H(['bw5', 'bw6', 'bw7', 'bw8', 'bw9'], 0.45, 0.64, 0.3, 1.1, 140)] },
      burrow: { clip: 'burrow', dur: 1.6, lock: 0.0, range: [0, 12], closer: true, burrow: true },
      beam: { clip: 'beam', dur: 4.2, lock: 0.22, range: [1.6, 12], ranged: true, phase: 1, beam: { from: 0.25, to: 0.85, len: 10, width: 0.1, dps: 0.9 } },
      roar: { clip: 'roar', dur: 2.6, lock: 0.2, range: [0, 12], antiair: true, roar: { at: 0.28, r: 3.4, knock: 220 }, volley: { at: 0.45, count: 11, speed: 240, spread: 0.3, dmg: 0.4 }, shake: 1 },
    },
  },
  ilyra: {
    scale: 65, foot: 0.6, walk: 0.7, run: 1.8, turn: 1.2, prefer: [1.8, 3.5], flies: true, altitude: [1.4, 3.2],
    parts: [
      { bone: 'pelvis', at: [0, -0.05, -0.12], r: 0.16, kind: 'core', name: 'Heart of Light', breakHp: 0.06 },
      { bone: 'head', r: 0.2, kind: 'weak', name: 'Crystal Crown', breakHp: 0.045 },
      { bone: 'pelvis', r: 0.28 }, { bone: 'neck', r: 0.16 }, { bone: 'tail1', r: 0.14 }, { bone: 'tail2', r: 0.1 }, { bone: 'tail3', r: 0.08 },
      { bone: 'wing1_l', r: 0.16 }, { bone: 'wing1_r', r: 0.16 }, { bone: 'wing2_l', r: 0.16 }, { bone: 'wing2_r', r: 0.16 }, { bone: 'wing3_l', r: 0.18 }, { bone: 'wing3_r', r: 0.18 },
    ],
    moves: {
      swipe_l: { clip: 'swipe_l', dur: 1.8, lock: 0.4, range: [0, 2.6], hits: [H(['wing2_l', 'wing3_l'], 0.44, 0.62, 0.3, 1, 90)], lunge: [0.42, 0.58, 0.6],
        next: [{ id: 'swipe_r', p: 0.55, delay: [0.0, 0.4] }] },
      swipe_r: { clip: 'swipe_r', dur: 1.8, lock: 0.4, range: [0, 2.6], hits: [H(['wing2_r', 'wing3_r'], 0.44, 0.62, 0.3, 1, 90)], lunge: [0.42, 0.58, 0.6],
        next: [{ id: 'tail', p: 0.4, delay: [0.2, 0.8] }] },
      tail: { clip: 'tail', dur: 1.9, lock: 0.42, range: [0, 3], hits: [H(['tail2', 'tail3'], 0.45, 0.62, 0.22, 1.2, 130)] },
      dive: { clip: 'leap', dur: 2.6, lock: 0.3, range: [1.5, 12], closer: true, antiair: true, leap: [0.32, 0.6, 0.0], hits: [H(['head', 'pelvis', 'foot_l', 'foot_r'], 0.5, 0.66, 0.36, 1.6, 150)],
        next: [{ id: 'slam', p: 0.5, delay: [0.3, 0.9] }] },
      slam: { clip: 'slam', dur: 2.4, lock: 0.45, range: [0, 4], heavy: true, sphere: { at: 0.6, speed: 2.2, max: 4.2, width: 0.12, dmg: 1.2 }, shake: 1 },
      beam: { clip: 'beam', dur: 4.2, lock: 0.22, range: [1.6, 12], ranged: true, beam: { from: 0.25, to: 0.85, len: 10, width: 0.09, dps: 1 } },
      roar: { clip: 'roar', dur: 2.6, lock: 0.2, range: [0, 12], antiair: true, roar: { at: 0.28, r: 3.2, knock: 220 }, volley: { at: 0.4, count: 14, speed: 230, spread: 0.45, dmg: 0.38 }, shake: 0.8 },
    },
  },
};

// ---------------------------------------------------------------- model --
const loaded = new Map();
export function loadTitan(id) {
  if (typeof document === 'undefined') return Promise.resolve(null);
  if (!loaded.has(id)) {
    const url = `${import.meta.env?.BASE_URL ?? './'}models/titans/${id}.glb`;
    loaded.set(id, new GLTFLoader().loadAsync(url).then((g) => ({ scene: g.scene, clips: Object.fromEntries(g.animations.map((c) => [c.name.split('|').pop(), c])) }))
      .catch((e) => { console.warn(`titan ${id} failed to load`, e); return null; }));
  }
  return loaded.get(id);
}

export class TitanBody {
  constructor(src, def) {
    this.root = cloneSkinned(src.scene);
    this.glows = [];
    const tint = new THREE.Color(def.color), glow = new THREE.Color(def.accent);
    this.root.traverse((o) => {
      if (!o.isMesh) return;
      o.frustumCulled = false;
      const m = o.material.clone();
      if (m.name === 'hide') { m.color.copy(tint).multiplyScalar(1.5); m.vertexColors = true; this.hide = m; }
      else if (m.name === 'eye' || m.name === 'glow') { m.emissive.copy(glow); m.color.copy(glow); m.emissiveIntensity = 2.5; this.glows.push(m); }
      else if (m.name === 'dark') m.color.copy(tint).multiplyScalar(0.4);
      else if (m.name === 'horn') m.color.lerp(tint, 0.3);
      o.material = m;
      if (o.isSkinnedMesh) { relativeSkinning(o); this.skinned = o; }
    });
    this.bones = Object.fromEntries((this.skinned?.skeleton.bones || []).map((b) => [b.name, b]));
    this.mixer = new THREE.AnimationMixer(this.root);
    this.actions = Object.fromEntries(Object.entries(src.clips).map(([k, c]) => [k, this.mixer.clipAction(c)]));
    this.cur = null;
    this.glowBoost = 0;
  }

  // Loop a base clip, or play a move once over `dur` seconds.
  play(name, { loop = true, dur = 0, fade = 0.25 } = {}) {
    const a = this.actions[name] || this.actions.idle;
    if (!a) return;
    if (loop && this.cur === a && this.curLoop) return;
    a.reset();
    a.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    a.clampWhenFinished = !loop;
    a.timeScale = dur ? a.getClip().duration / dur : 1;
    a.play();
    if (this.cur && this.cur !== a) a.crossFadeFrom(this.cur, fade, false);
    this.cur = a;
    this.curLoop = loop;
  }

  setRate(r) { if (this.cur && this.curLoop) this.cur.timeScale = r; }

  update(dt) {
    this.mixer.update(dt);
    const g = 2.5 + this.glowBoost * 9;
    for (const m of this.glows) m.emissiveIntensity = g;
  }
}

// ---------------------------------------------------------------- brain --
export class Titan {
  // g: game; def: PLANETARY_BOSSES entry; boss: the beast entry; centre/up: the arena
  constructor(g, def, boss, centre) {
    this.g = g; this.def = def; this.boss = boss; this.T = TITANS[def.id];
    this.S = this.T.scale;
    this.centre = centre.clone();
    this.up = centre.clone().normalize();
    this.fwd = V().subVectors(g.player.pos, centre).projectOnPlane(this.up).normalize();
    if (this.fwd.lengthSq() < 0.5) this.fwd.set(1, 0, 0).projectOnPlane(this.up).normalize();
    this.phase = 0; this.elapsed = 0; this.integrity = 100;
    this.state = 'intro'; this.t = 0; this.move = null; this.queue = null;
    this.recent = []; this.farT = 0; this.airT = 0; this.circle = Math.random() < 0.5 ? 1 : -1; this.circleT = rand(2, 5);
    this.altitude = this.T.flies ? this.T.altitude[1] : 0;
    this.parts = [];
    this.shocks = [];
    this.vel = V();
    this.tooFarT = -99;
    this.rendT = 0;
    this.placeOnGround(this.boss.pos);
  }

  get vulnerability() { return this.state === 'stagger' ? 2.2 : this.state === 'rend' ? 1.4 : 1; }

  // ---- body
  attach(body) {
    this.body = body;
    const m = this.boss.model;
    for (const c of m.group.children) c.visible = false;
    body.root.scale.setScalar(this.S);
    m.group.add(body.root);
    // after death the body keeps animating while it falls
    let last = null;
    m.anim = (t) => { if (!this.dead) return; const d = last === null ? 0 : t - last; last = t; body.update(Math.min(0.1, Math.max(0, d))); };
    m.die = () => { this.dead = true; this.removeParts(); body.glowBoost = 0; body.play('death', { loop: false, dur: 4 }); return 4; };
    m.flash = [];
    this.makeParts();
    body.play('roar', { loop: false, dur: 3 });
  }

  makeParts() {
    const g = this.g;
    for (const p of this.T.parts) {
      const bone = this.body.bones[p.bone];
      if (!bone) continue;
      const proxy = {
        uid: ++g.beasts.uid, type: 'titanpart', planetary: true, part: p, owner: this, alive: true, boss: false, elite: false,
        pos: V(), vel: V(), radius: p.r * this.S, hp: 1, maxHp: 1, def: { color: this.def.color, accent: this.def.accent, name: p.name || this.def.name },
        name: p.name || this.def.name, cn: this.def.cn, tier: this.def.tier, flashT: 0, lastHit: -99,
        model: { group: new THREE.Group(), anim() {}, flash: [] }, mesh: null,
        bone, at: p.at ? new THREE.Vector3(...p.at) : null, weak: p.kind === 'weak' || p.kind === 'core', core: p.kind === 'core',
        breakHp: (p.breakHp || 0) * this.boss.maxHp, taken: 0, broken: false,
      };
      proxy.mesh = proxy.model.group;
      this.parts.push(proxy);
      g.beasts.beasts.push(proxy);
    }
    this.syncParts();
  }

  syncParts() {
    if (!this.body) return;
    const root = this.g.beasts.scene;
    this.boss.mesh.updateMatrixWorld(true);
    for (const p of this.parts) {
      if (p.at) tA.copy(p.at); else tA.set(0, 0, 0);
      p.pos.copy(tA.applyMatrix4(p.bone.matrixWorld));
      root.worldToLocal(p.pos);
    }
  }

  bonePos(name, out = V()) {
    const b = this.body?.bones[name];
    if (!b) return out.copy(this.boss.pos);
    out.setFromMatrixPosition(b.matrixWorld);
    return this.g.beasts.scene.worldToLocal(out);
  }

  removeParts() {
    const list = this.g.beasts.beasts;
    for (const p of this.parts) { p.alive = false; const i = list.indexOf(p); if (i >= 0) list.splice(i, 1); }
    this.parts = [];
  }

  // A player hit on one of the titan's parts. Returns the damage actually dealt.
  hitPart(p, amount) {
    const g = this.g;
    const d = g.player.pos.distanceTo(p.pos) - p.radius;
    let mult = p.weak && !p.broken ? 2 : 0.55;
    if (p.core && this.state !== 'rend' && this.state !== 'stagger') mult = 0.8;
    // its hide turns aside distant blows
    if (d > 3.2 * this.S) {
      mult *= 0.12;
      if (g.time - this.tooFarT > 6) { this.tooFarT = g.time; g.hud.notify('Its hide turns aside blows from afar. <b>Get close</b> and strike its glowing weak points.', 'red'); }
    }
    amount *= mult * this.vulnerability;
    if (p.weak && !p.broken) {
      p.taken += amount;
      if (this.state === 'rend' && p.core) this.rendDamage += amount;
      if (p.taken >= p.breakHp && this.state !== 'rend') this.breakPart(p);
    }
    return amount;
  }

  breakPart(p) {
    const g = this.g;
    p.broken = true;
    g.combat.explosion(p.pos, this.def.accent, 4);
    g.sound.explosion(p.pos, true);
    g.hud.banner('WEAK POINT BROKEN', p.name, 'It staggers. Strike now!', '#5dffa8', 2, true);
    this.stagger(5);
  }

  stagger(sec) {
    this.state = 'stagger'; this.t = sec; this.move = null; this.queue = null;
    this.body?.play('stagger', { loop: false, dur: sec });
  }

  // ---- placement and movement
  placeOnGround(pos) {
    const n = tA.copy(pos).normalize();
    const f = this.g.frame;
    const floor = f ? f.floorRadius(n.x, n.y, n.z) : pos.length();
    const h = this.T.foot * this.S + (this.T.flies ? this.altitude * this.S : 0) + (this.under ? -this.T.foot * this.S * 3.5 : 0);
    pos.copy(n).multiplyScalar(floor + h);
  }

  orient(dt, rate) {
    const up = tB.copy(this.boss.pos).normalize();
    this.up.copy(up);
    this.fwd.projectOnPlane(up).normalize();
    const b = this.boss;
    tM.lookAt(tC.set(0, 0, 0), tA.copy(this.fwd).negate(), up);
    tQ.setFromRotationMatrix(tM);
    if (rate === Infinity) b.mesh.quaternion.copy(tQ);
    else b.mesh.quaternion.slerp(tQ, 1 - Math.exp(-dt * rate));
  }

  turnToward(dir, dt, rate) {
    const want = tA.copy(dir).projectOnPlane(this.up);
    if (want.lengthSq() < 1e-6) return;
    want.normalize();
    const ang = Math.acos(THREE.MathUtils.clamp(this.fwd.dot(want), -1, 1));
    const step = Math.min(ang, rate * dt);
    if (ang < 1e-4) return;
    const axis = tB.crossVectors(this.fwd, want).normalize();
    if (axis.lengthSq() < 1e-6) axis.copy(this.up);
    this.fwd.applyAxisAngle(axis, step).projectOnPlane(this.up).normalize();
  }

  stepForward(dist) {
    this.boss.pos.addScaledVector(this.fwd, dist);
    this.placeOnGround(this.boss.pos);
  }

  // where the player is, relative to the titan
  sense() {
    const g = this.g, b = this.boss;
    const to = V().subVectors(g.player.pos, b.pos);
    const upd = to.dot(this.up);
    const flat = to.clone().addScaledVector(this.up, -upd);
    const dist = flat.length();
    const n = tA.copy(g.player.pos).normalize();
    const alt = g.frame ? g.player.pos.length() - g.frame.floorRadius(n.x, n.y, n.z) : 0;
    const ahead = dist > 1e-3 ? flat.clone().divideScalar(dist).dot(this.fwd) : 1;
    return { to, flat, dist: dist / this.S, alt, ahead, air: alt > 45 || g.rt.inShip };
  }

  predict(lead) {
    const g = this.g;
    const v = g.rt.inShip && g.shipObj ? g.shipObj.vel : g.player.vel;
    return g.player.pos.clone().addScaledVector(v, lead);
  }

  // ---- choosing what to do
  choose(s) {
    const moves = this.T.moves;
    const out = [];
    for (const [id, m] of Object.entries(moves)) {
      if (m.phase && this.phase < m.phase) continue;
      if (s.dist < m.range[0] || s.dist > m.range[1]) continue;
      let w = 1 + Math.random() * 0.6;
      if (m.behind) w += s.ahead < -0.2 ? 1.5 : -0.8;
      if (!m.behind && s.ahead < -0.3 && !m.closer && !m.ranged) w -= 0.6;
      if (m.closer) w += this.farT > 3 ? 1.6 + this.farT * 0.15 : -0.3;
      if (m.ranged) w += this.farT > 4 ? 1.2 : 0;
      if (m.antiair) w += s.air ? 1.4 + this.airT * 0.2 : -0.5;
      if (m.heavy) w += this.phase * 0.3;
      w -= this.recent.filter((x) => x === id).length * 1.9;
      out.push([id, w]);
    }
    out.sort((a, b) => b[1] - a[1]);
    return out.length && out[0][1] > 0.2 ? out[0][0] : null;
  }

  begin(id) {
    const m = this.T.moves[id];
    if (!m) return;
    this.state = 'move'; this.move = { id, m, t: 0, hit: new Set(), fired: new Set() };
    this.recent.push(id); if (this.recent.length > 3) this.recent.shift();
    this.body?.play(m.clip, { loop: false, dur: m.dur, fade: 0.18 });
    if (m.heavy) this.g.sound.thunder();
    if (m.leap) { this.leapFrom = this.boss.pos.clone(); this.leapTo = null; }
  }

  // ---- per frame
  update(dt) {
    const g = this.g, b = this.boss;
    dt = Math.min(dt, 0.1);
    this.elapsed += dt;
    const s = this.sense();
    this.farT = s.dist > 3.4 ? this.farT + dt : Math.max(0, this.farT - dt * 2);
    this.airT = s.air ? this.airT + dt : Math.max(0, this.airT - dt * 2);
    const hpFrac = b.hp / b.maxHp;
    const phase = hpFrac <= 0.34 ? 2 : hpFrac <= 0.67 ? 1 : 0;
    const events = [];
    if (phase > this.phase) { this.phase = phase; events.push({ type: 'phase', phase }); this.startRend(); }
    this.t -= dt;

    if (this.state === 'intro') {
      if (this.t < -3) { this.state = 'stalk'; this.t = rand(0.8, 1.6); }
    } else if (this.state === 'stalk') this.stalk(dt, s);
    else if (this.state === 'move') this.runMove(dt, s);
    else if (this.state === 'stagger') { if (this.t <= 0) { this.state = 'stalk'; this.t = rand(0.3, 0.8); } }
    else if (this.state === 'under') this.tunnel(dt, s);
    else if (this.state === 'rend') this.rend(dt, events);

    if (this.T.flies) {
      const want = this.state === 'stalk' ? THREE.MathUtils.lerp(this.T.altitude[0], this.T.altitude[1], 0.5 + 0.5 * Math.sin(this.elapsed * 0.4)) : this.altitude;
      this.altitude += (want - this.altitude) * Math.min(1, dt * 0.8);
    }
    this.placeOnGround(b.pos);
    this.orient(dt, 6);
    this.updateShocks(dt);
    if (this.body) {
      this.body.update(dt);
      this.syncParts();
    }
    b.state = this.state === 'move' && this.move && this.move.t < this.move.m.lock * this.move.m.dur ? 'windup' : this.state;
    if (this.elapsed >= this.def.limit || this.integrity <= 0) events.push({ type: 'failure' });
    return events;
  }

  stalk(dt, s) {
    const T = this.T, S = this.S;
    // a combo follow-up: hold, facing the player, for its (uneven) pause, then strike
    if (this.queue) {
      this.turnToward(s.flat, dt, T.turn * 1.5);
      this.body?.play('idle', { fade: 0.2 });
      if (this.t <= 0) { const id = this.queue; this.queue = null; this.begin(id); }
      return;
    }
    // move around the player: close in when far, circle at its preferred range, back off when right underneath
    let dir = s.flat.clone().normalize();
    let speed = T.walk;
    if (s.dist > T.prefer[1]) speed = T.run;
    else if (s.dist > T.prefer[0]) {
      this.circleT -= dt;
      if (this.circleT <= 0) { this.circle = -this.circle; this.circleT = rand(2.5, 5.5); }
      dir = dir.clone().cross(this.up).multiplyScalar(this.circle).addScaledVector(dir, 0.35).normalize();
      speed = T.walk * 1.2;
    } else if (s.dist < T.prefer[0] * 0.5) { dir.negate(); speed = T.walk * 0.6; }
    // you're behind it: it wheels round to face you (sometimes it lashes out with the tail instead)
    if (s.ahead < -0.1 && s.dist < T.prefer[1]) {
      this.turnToward(s.flat, dt, T.turn * 1.6);
      this.body?.play('walk', { fade: 0.3 });
      this.stepForward(T.walk * 0.3 * S * dt);
      if (this.t <= 0) { const id = this.choose(s); if (id) this.begin(id); else this.t = rand(0.2, 0.5); }
      return;
    }
    // stay near the arena
    const home = V().subVectors(this.centre, this.boss.pos).projectOnPlane(this.up);
    if (home.length() > 14 * S) dir.addScaledVector(home.normalize(), 0.8).normalize();
    this.turnToward(dir.lengthSq() > 0 ? dir : this.fwd, dt, T.turn);
    const align = Math.max(0.25, this.fwd.dot(dir));
    this.stepForward(speed * S * align * dt);
    this.body?.play(speed >= T.run ? 'run' : 'walk', { fade: 0.35 });
    this.body?.setRate(speed >= T.run ? 1 : 0.9);
    if (this.t <= 0) {
      const id = this.choose(s);
      if (id) this.begin(id);
      else this.t = rand(0.3, 0.7);
    }
  }

  runMove(dt, s) {
    const g = this.g, mv = this.move, m = mv.m, S = this.S;
    mv.t += dt;
    const k = mv.t / m.dur;
    // tracking during the wind-up; committed after the lock
    if (k < m.lock) {
      const lead = m.leap ? 0.6 : m.lunge ? 0.35 : 0.2;
      this.turnToward(V().subVectors(this.predict(lead), this.boss.pos), dt, this.T.turn * 1.8);
    }
    this.body && (this.body.glowBoost = k < m.lock ? smooth(k / m.lock) : Math.max(0, 1 - (k - m.lock) * 3));
    // root motion
    if (m.lunge) {
      const [a, z, d] = m.lunge;
      if (k > a && k < z) this.stepForward((d * S / ((z - a) * m.dur)) * dt);
    }
    if (m.leap) {
      const [a, z, h] = m.leap;
      if (k >= a && !this.leapTo) {
        this.leapTo = this.predict(0.8);
        this.leapFrom = this.boss.pos.clone();
        this.leapH = h;
      }
      if (this.leapTo && k < z + 0.02) {
        const f = smooth(Math.min(1, (k - a) / (z - a)));
        const p = this.leapFrom.clone().lerp(this.leapTo, f);
        this.boss.pos.copy(p);
        this.placeOnGround(this.boss.pos);
        if (this.leapH) this.boss.pos.addScaledVector(this.up, Math.sin(f * Math.PI) * this.leapH * S);
        if (this.T.flies) this.altitude = THREE.MathUtils.lerp(this.altitude, 0.25, f);
        const d = V().subVectors(this.leapTo, this.leapFrom).projectOnPlane(this.up);
        if (d.lengthSq() > 1) this.fwd.copy(d.normalize());
      }
    }
    if (m.burrow && k >= 0.95 && !this.under) { this.goUnder(); return; }
    // hit volumes on the swinging bones
    if (m.hits) for (let i = 0; i < m.hits.length; i++) {
      const h = m.hits[i];
      if (k < h.from || k > h.to || mv.hit.has(i)) continue;
      for (const bn of h.bones) {
        if (g.player.pos.distanceTo(this.bonePos(bn, tA)) < h.r * S + 2) { mv.hit.add(i); this.hurt(h.dmg, m.heavy, h.knock); break; }
      }
    }
    if (m.shock && k >= m.shock.at && !mv.fired.has('shock')) { mv.fired.add('shock'); this.shockwave(m.shock, false); }
    if (m.sphere && k >= m.sphere.at && !mv.fired.has('sphere')) { mv.fired.add('sphere'); this.shockwave(m.sphere, true); }
    if (m.roar && k >= m.roar.at && !mv.fired.has('roar')) { mv.fired.add('roar'); this.roar(m.roar); }
    if (m.volley && k >= m.volley.at && !mv.fired.has('volley')) { mv.fired.add('volley'); this.volley(m.volley); }
    if (m.beam && k >= m.beam.from && k <= m.beam.to) this.beam(m.beam, dt);
    if (m.shake && !mv.fired.has('shake') && ((m.shock && k >= m.shock.at) || (m.sphere && k >= m.sphere.at) || (m.roar && k >= m.roar.at))) {
      mv.fired.add('shake');
      g.rt.shake = Math.max(g.rt.shake, m.shake);
    }
    if (k >= 1) this.endMove();
  }

  endMove() {
    const m = this.move?.m;
    this.move = null;
    this.body && (this.body.glowBoost = 0);
    // a combo follow-up, after an uneven pause, or back to stalking
    const next = (m?.next || []).filter((n) => !n.phase || this.phase >= n.phase);
    for (const n of next) {
      if (Math.random() < n.p + this.phase * 0.12) {
        this.state = 'stalk'; this.t = rand(...n.delay); this.queue = n.id;
        this.chainTo = n.id;
        return;
      }
    }
    this.state = 'stalk';
    this.t = rand(0.7, 1.8) * (1 - this.phase * 0.15);
    this.chainTo = null;
  }

  // Serekh: dive into the ground, travel under it towards the player, erupt beneath them.
  goUnder() {
    this.move = null;
    this.state = 'under'; this.under = true; this.t = rand(1.8, 3.2);
    this.boss.mesh.visible = false;
    for (const p of this.parts) p.alive = false;
  }

  tunnel(dt, s) {
    const g = this.g;
    const to = V().subVectors(this.predict(0.4), this.boss.pos).projectOnPlane(this.up);
    if (to.lengthSq() > 1) this.fwd.copy(to.normalize());
    this.stepForward(Math.min(s.dist * this.S, this.T.run * 1.4 * this.S * dt));
    // the only warning: the ground boils above it
    if (Math.random() < 0.6) {
      const n = tA.copy(this.boss.pos).normalize();
      const surf = n.multiplyScalar(g.frame.floorRadius(n.x, n.y, n.z) + 2);
      g.combat.debris(surf, 0x8a6a40, 3, 4);
    }
    if (this.t <= 0 || s.dist < 0.6) {
      this.under = false;
      this.boss.mesh.visible = true;
      for (const p of this.parts) p.alive = true;
      this.state = 'move';
      const m = { clip: 'emerge', dur: 1.8, lock: 0.0, range: [0, 0], heavy: true, hits: [H(['head', 'neck', 'fw5', 'fw4'], 0.25, 0.55, 0.55, 1.7, 160)],
        shock: { at: 0.3, speed: 1.6, max: 3.5, width: 0.12, height: 0.12, dmg: 0.8 }, shake: 1.4 };
      this.move = { id: 'emerge', m, t: 0, hit: new Set(), fired: new Set() };
      this.body?.play('emerge', { loop: false, dur: m.dur, fade: 0.05 });
      g.sound.explosion(this.boss.pos, true);
      g.combat.explosion(this.boss.pos, 0x8a6a40, 8);
    }
  }

  // ---- attack effects
  hurt(mult, heavy, knock) {
    const g = this.g, b = this.boss;
    const cap = g.stats.maxHp * [0.17, 0.21, 0.25][this.phase] * (heavy ? 1.45 : 1);
    const dmg = Math.min(b.dmg * mult * (1 + this.phase * 0.15), cap);
    const dir = V().subVectors(g.player.pos, b.pos).projectOnPlane(this.up).normalize().addScaledVector(this.up, 0.5).normalize();
    const res = g.hurtPlayer(dmg, b.pos.clone(), dir.multiplyScalar(knock));
    if (res !== null && !g.rt.inShip) g.player.vel.addScaledVector(dir, 1);
  }

  shockwave(spec, sphere) {
    const g = this.g, S = this.S;
    const at = this.move?.m.hits?.[0]?.bones?.[0] ? this.bonePos(this.move.m.hits[0].bones[0], V()) : this.boss.pos.clone();
    const n = at.clone().normalize();
    const ground = n.multiplyScalar(g.frame.floorRadius(n.x, n.y, n.z) + 2);
    const origin = sphere ? this.boss.pos.clone() : ground;
    g.combat.shockwave(origin, spec.max * S, this.def.accent, spec.max / spec.speed);
    g.sound.explosion(origin, true);
    this.shocks.push({ origin, r: 0, spec, sphere, hit: false });
  }

  updateShocks(dt) {
    const g = this.g, S = this.S;
    for (let i = this.shocks.length - 1; i >= 0; i--) {
      const w = this.shocks[i];
      w.r += w.spec.speed * S * dt;
      if (w.r > w.spec.max * S) { this.shocks.splice(i, 1); continue; }
      if (w.hit) continue;
      const to = V().subVectors(g.player.pos, w.origin);
      let hit;
      if (w.sphere) hit = Math.abs(to.length() - w.r) < w.spec.width * S;
      else {
        const up = w.origin.clone().normalize();
        const h = to.dot(up);
        const flat = to.addScaledVector(up, -h).length();
        // a ground wave: jump it
        hit = Math.abs(flat - w.r) < w.spec.width * S && h < w.spec.height * S + 1.7;
      }
      if (hit) { w.hit = true; this.hurt(w.spec.dmg, true, 120); }
    }
  }

  roar(spec) {
    const g = this.g, S = this.S;
    const head = this.bonePos('head', V());
    g.combat.shockwave(head, spec.r * S, this.def.accent, 0.9);
    g.sound.thunder();
    const to = V().subVectors(g.player.pos, head);
    if (to.length() < spec.r * S) {
      const push = to.normalize().multiplyScalar(spec.knock);
      if (g.rt.inShip && g.shipObj) g.shipObj.vel.add(push);
      else g.player.vel.add(push);
      this.hurt(0.35, false, 0);
    }
  }

  volley(spec) {
    const g = this.g;
    const mouth = this.bonePos(this.body?.bones.snout ? 'snout' : 'head', V());
    // each orb stings (about 7% of your life); it's the swarm that kills
    const dmg = Math.min(this.boss.dmg * spec.dmg, g.stats.maxHp * 0.07);
    for (let i = 0; i < spec.count; i++) {
      const t = this.predict(0.6 + Math.random() * 0.6);
      t.add(V(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(spec.spread * this.S * 2));
      setTimeout(() => {
        if (!this.boss.alive) return;
        g.combat.enemyShot(mouth.clone(), V().subVectors(t, mouth).normalize(), spec.speed, dmg, this.def.accent, 3.5);
      }, i * 70);
    }
  }

  beam(spec, dt) {
    const g = this.g, S = this.S;
    const head = this.bonePos('head', V());
    const snout = this.bonePos(this.body?.bones.snout ? 'snout' : this.body?.bones.jaw ? 'jaw' : 'head', V());
    const dir = V().subVectors(snout, head);
    if (dir.lengthSq() < 1e-3) dir.copy(this.fwd);
    dir.normalize();
    // the beam rakes the ground ahead of it
    dir.addScaledVector(this.up, -0.25).normalize();
    const end = snout.clone().addScaledVector(dir, spec.len * S);
    g.combat.beam(snout, end, this.def.accent, spec.width * S * 0.6, 0.06);
    const p = g.player.pos;
    const ab = V().subVectors(end, snout), ap = V().subVectors(p, snout);
    const tt = THREE.MathUtils.clamp(ap.dot(ab) / ab.lengthSq(), 0, 1);
    if (snout.clone().addScaledVector(ab, tt).distanceTo(p) < spec.width * S + 2) {
      this.beamTick = (this.beamTick || 0) + dt;
      if (this.beamTick > 0.25) { this.beamTick = 0; this.hurt(spec.dps * 0.25, false, 30); }
    }
  }

  // ---- the World Rend: at each phase change it braces and opens its core
  startRend() {
    const core = this.parts.find((p) => p.core) || this.parts.find((p) => p.weak);
    this.state = 'rend'; this.t = 10; this.move = null; this.rendDamage = 0; this.rendCore = core;
    if (core) { core.broken = false; core.taken = 0; }
    for (const p of this.parts) if (p.weak) { p.broken = false; p.taken = 0; }
    this.body?.play('roar', { loop: false, dur: 3 });
    this.g.hud.banner('WORLD REND', 'It tears at the planet', 'Strike its glowing core to interrupt it', '#ff6a80', 3);
    this.g.sound.thunder();
  }

  rend(dt, events) {
    const g = this.g;
    this.body && (this.body.glowBoost = 0.6 + 0.4 * Math.sin(this.elapsed * 6));
    if (this.t < 7 && this.body?.cur !== this.body?.actions.beam) this.body?.play('beam', { loop: true, dur: 4 });
    if (Math.random() < 0.2) g.combat.lightning(this.boss.pos.clone().addScaledVector(this.up, -this.S * 0.5).add(V(rand(-1, 1), 0, rand(-1, 1)).multiplyScalar(this.S * 3)), this.def.accent, 600, this.up);
    if (this.rendDamage >= this.boss.maxHp * 0.05) {
      events.push({ type: 'interrupt' });
      this.stagger(6);
      return;
    }
    if (this.t <= 0) {
      this.integrity = Math.max(0, this.integrity - 35);
      g.combat.shockwave(this.centre, 40 * this.S, this.def.accent, 2);
      g.rt.shake = 1.4;
      events.push({ type: 'rend' });
      this.state = 'stalk'; this.t = 1;
    }
  }

  rebase(m, q) {
    this.centre.applyMatrix4(m); this.up.applyQuaternion(q); this.fwd.applyQuaternion(q);
    this.leapFrom?.applyMatrix4(m); this.leapTo?.applyMatrix4(m);
    for (const w of this.shocks) w.origin.applyMatrix4(m);
  }

  dispose() { this.removeParts(); this.shocks = []; }
}
