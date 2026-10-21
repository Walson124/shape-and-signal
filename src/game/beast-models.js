import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { applySkin, SKIN_FOR_PLAN } from './beast-skin.js';

// Sculpted, rigged and animated beasts (tools/blender/make_beasts.py), one file per
// body plan. A beast spawns with its code-built model and switches to the animated
// one as soon as its plan has loaded (all plans start loading with the game).

const PLAN = { wolf: 'wolf', lizard: 'lizard', rhino: 'rhino', bear: 'bear' };
export function planFor(def) {
  if (def.arch === 'quad') return PLAN[def.variant] || 'wolf';
  return { avian: 'raptor', insect: 'mantis', serpent: 'wyrm', golem: 'golem' }[def.arch] || null;
}

// plans that have been built so far
const AVAILABLE = new Set(['wolf', 'lizard', 'rhino', 'bear', 'raptor', 'mantis', 'wyrm', 'golem']);
const cache = new Map();
function load(plan) {
  if (typeof document === 'undefined' || !AVAILABLE.has(plan)) return Promise.resolve(null);
  if (!cache.has(plan)) {
    const url = `${import.meta.env?.BASE_URL ?? './'}models/beasts/${plan}.glb`;
    cache.set(plan, new GLTFLoader().loadAsync(url).then((g) => {
      const clips = {};
      for (const c of g.animations) clips[c.name.split('|').pop()] = c;
      return { scene: g.scene, clips };
    }).catch((e) => { console.warn(`beast ${plan} failed to load`, e); return null; }));
  }
  return cache.get(plan);
}
export function preloadBeasts() { for (const p of AVAILABLE) load(p); }

// Far from the scene origin GPU skinning in world space loses precision; skin relative to the mesh.
const tM = new THREE.Matrix4(), tInv = new THREE.Matrix4();
export function relativeSkinning(mesh) {
  const bind = mesh.bindMatrix.clone();
  mesh.bindMode = THREE.DetachedBindMode;
  mesh.bindMatrix.identity();
  mesh.bindMatrixInverse.identity();
  mesh.skeleton.update = function update() {
    tInv.copy(mesh.matrixWorld).invert();
    for (let i = 0; i < this.bones.length; i++) {
      tM.multiplyMatrices(tInv, this.bones[i].matrixWorld).multiply(this.boneInverses[i]).multiply(bind);
      tM.toArray(this.boneMatrices, i * 16);
    }
    if (this.boneTexture) this.boneTexture.needsUpdate = true;
  };
}

// the middle of a body's three extents: about how thick it is
function bodySize(geo) {
  if (!geo.boundingBox) geo.computeBoundingBox();
  const s = geo.boundingBox.getSize(new THREE.Vector3());
  return [s.x, s.y, s.z].sort((a, b) => a - b)[1] / 2;
}

class AnimatedBeast {
  constructor(src, def, elite) {
    this.root = cloneSkinned(src.scene);
    this.mats = [];
    const tint = new THREE.Color(def.color), glow = new THREE.Color(elite ? 0xffd040 : def.accent);
    this.root.traverse((o) => {
      if (!o.isMesh) return;
      o.frustumCulled = false;
      const m = o.material.clone();
      if (m.name === 'hide') {
        m.color.copy(tint).multiplyScalar(1.6); m.vertexColors = true; m.emissive = new THREE.Color(0x000000); this.hide = m;
        // scales, fur, chitin, stone or leather, sized to the body's thickness (not its length,
        // or a serpent would get scales the size of dinner plates)
        applySkin(m, SKIN_FOR_PLAN[planFor(def)], bodySize(o.geometry));
      }
      else if (m.name === 'stone') applySkin(m, 'stone', bodySize(o.geometry));
      else if (m.name === 'eye' || m.name === 'glow') { m.emissive.copy(glow); m.emissiveIntensity = 3; m.color.copy(glow); }
      else if (m.name === 'dark') { m.color.copy(tint).multiplyScalar(0.35); }
      o.material = m;
      this.mats.push(m);
      if (o.isSkinnedMesh) relativeSkinning(o);
    });
    this.mixer = new THREE.AnimationMixer(this.root);
    this.actions = {};
    for (const [k, c] of Object.entries(src.clips)) this.actions[k] = this.mixer.clipAction(c);
    this.base = null;
    this.over = null; // a one-shot: attack, hit
    this.lastT = null;
    this.dead = false;
    this.setBase('idle');
  }

  setBase(name, rate = 1) {
    const a = this.actions[name] || this.actions.idle;
    if (!a) return;
    a.timeScale = rate;
    if (this.base === a) return;
    a.reset().setLoop(THREE.LoopRepeat, Infinity).play();
    if (this.base) a.crossFadeFrom(this.base, 0.22, false);
    this.base = a;
  }

  oneShot(name, speed = 1) {
    const a = this.actions[name];
    if (!a || this.dead) return;
    if (this.over && this.over !== a) this.over.fadeOut(0.08);
    a.reset().setLoop(THREE.LoopOnce, 1);
    a.clampWhenFinished = false;
    a.timeScale = speed;
    a.setEffectiveWeight(1).fadeIn(0.06).play();
    this.over = a;
    this.overEnd = a.getClip().duration / speed;
  }

  anim(t, speed = 0, b = null) {
    const dt = this.lastT === null ? 0 : Math.max(0, Math.min(0.1, t - this.lastT));
    this.lastT = t;
    if (!this.dead && b) {
      const r = Math.max(0.5, b.radius || 1);
      const ns = speed / r; // body lengths per second
      if (b.state === 'windup') this.setBase('windup');
      else if (b.state === 'charge') this.setBase('run', 1.5);
      else if (ns > 2.2) this.setBase('run', THREE.MathUtils.clamp(ns / 6, 0.7, 2));
      else if (ns > 0.25) this.setBase('walk', THREE.MathUtils.clamp(ns / 1.1, 0.6, 1.8));
      else this.setBase('idle');
    }
    if (this.over) {
      this.overEnd -= dt;
      if (this.overEnd <= 0.1) { this.over.fadeOut(0.1); this.over = null; }
    }
    if (this.hide) this.hide.emissive.setScalar(b && b.flashT > 0 ? 0.6 : 0);
    this.mixer.update(dt);
  }

  die() {
    this.dead = true;
    const a = this.actions.death;
    if (!a) return 0;
    for (const x of Object.values(this.actions)) if (x !== a) x.fadeOut(0.15);
    a.reset().setLoop(THREE.LoopOnce, 1);
    a.clampWhenFinished = true;
    a.fadeIn(0.1).play();
    return a.getClip().duration;
  }

  dispose() { for (const m of this.mats) m.dispose(); }
}

// Give a beast's model its animated body as soon as the plan is ready.
export function upgradeBeast(model, def, elite) {
  const plan = planFor(def);
  if (!plan || !AVAILABLE.has(plan)) return;
  load(plan).then((src) => {
    if (!src || model.removed) return;
    const ab = new AnimatedBeast(src, def, elite);
    for (const c of model.group.children) c.visible = false;
    model.group.add(ab.root);
    model.animated = ab;
    model.anim = (t, speed, b) => ab.anim(t, speed, b);
    model.act = (name, speed) => ab.oneShot(name, speed);
    model.die = () => ab.die();
    model.flash = [];
    model.disposeExtra = [...(model.disposeExtra || []), ab];
  });
}
