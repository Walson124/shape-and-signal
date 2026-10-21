import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { applySkin } from './beast-skin.js';

// The skinned player model and its animations (built in Blender by
// tools/blender/make_character.py: clips retargeted from Quaternius's CC0
// Universal Animation Library, plus flying and meditation poses).
//
// Animation runs in two layers. The base layer is locomotion and other
// whole-body states, blended by weight. Attacks play on the upper body over
// it, so you can punch while running. Every clip is split into upper and
// lower halves when it loads to make that possible.

let shared = null;
export function loadPlayerModel() {
  if (typeof document === 'undefined') return Promise.resolve(null);
  if (!shared) {
    const url = `${import.meta.env?.BASE_URL ?? './'}models/player.glb`;
    shared = new GLTFLoader().loadAsync(url).then((gltf) => ({ scene: gltf.scene, clips: gltf.animations })).catch((e) => { console.warn('player model failed to load', e); return null; });
  }
  return shared;
}

// Planet surfaces sit millions of metres from the scene origin, and three.js
// skins on the GPU with world-space bone matrices in 32-bit floats, which shreds
// the mesh out there. Work out each bone's matrix relative to the mesh on the
// CPU (64-bit) instead, so the GPU only ever sees small numbers.
const tM = new THREE.Matrix4(), tInv = new THREE.Matrix4();
function relativeSkinning(mesh) {
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

const LOWER = /^(Root|pelvis|thigh_|calf_|foot_|ball_)/;
const tQa = new THREE.Quaternion(), tQb = new THREE.Quaternion(), tQc = new THREE.Quaternion();
// clips that only make sense on the whole body
const FULL = new Set(['roll', 'death', 'meditate', 'drive', 'swim', 'swim_idle', 'fall', 'air', 'jump_start', 'land', 'leap', 'leap_land', 'knockback', 'fly_hover', 'fly_cruise', 'fly_dash', 'sword_heavy']);

function split(clip) {
  const bone = (t) => t.name.split('.')[0];
  const lower = clip.tracks.filter((t) => LOWER.test(bone(t)));
  const upper = clip.tracks.filter((t) => !LOWER.test(bone(t)));
  return { upper: new THREE.AnimationClip(`${clip.name}:upper`, clip.duration, upper), lower: new THREE.AnimationClip(`${clip.name}:lower`, clip.duration, lower) };
}

export class SkinnedFigure {
  // `source` is the loaded model; `figure` is the group it's placed in (origin at the hips).
  constructor(source, figure) {
    this.model = cloneSkinned(source.scene);
    // the model faces +z; the game's figures face -z
    this.model.rotation.y = Math.PI;
    this.model.traverse((o) => {
      if (!o.isMesh) return;
      o.frustumCulled = false; // skinned bounds don't follow the pose
      // the arms-only copy is for first person (fp-arms.js)
      if (/fparms/.test(o.name)) { o.visible = false; return; }
      const m = o.material;
      // the combat suit's piping glows in the realm colour (setGlow)
      if (m.name === 'suit') {
        o.material = m.clone(); this.suit = o.material; this.suit.emissive.set(0x3ef2ff); this.suit.emissiveIntensity = 2.2;
        // the suit's weave and panel seams, in metres of the model
        applySkin(this.suit, 'suit', 1);
      }
      if (m.transparent) {
        // hair is a cut-out (sorting it as see-through flickers); brows and lashes blend
        if (/short|hair|bob|long|afro|braid|ponytail/.test(m.name || '')) { m.transparent = false; m.alphaTest = 0.5; }
        else m.depthWrite = false;
      }
    });
    const skinned = [];
    this.model.traverse((o) => { if (o.isSkinnedMesh) skinned.push(o); });
    for (const mesh of skinned) relativeSkinning(mesh);
    const bones = skinned[0].skeleton.bones;
    this.pelvis = bones.find((b) => b.name === 'pelvis');
    this.bones = Object.fromEntries(bones.map((b) => [b.name, b]));
    // rest rotations, so turns added on top of the animation don't pile up on bones no clip keys
    this.restQ = new Map(bones.map((b) => [b, b.quaternion.clone()]));
    this.touched = new Set();
    // feet on the figure's floor: the hips are the figure's origin. Measured before the model
    // joins the scene: out on a planet its world matrices are millions of metres from the
    // origin, and a body made mid-game (another player) would measure its hips from there.
    this.model.updateMatrixWorld(true);
    const p = this.model.worldToLocal(new THREE.Vector3().setFromMatrixPosition(this.pelvis.matrixWorld));
    this.hipHeight = p.y;
    this.model.position.y = -this.hipHeight;
    figure.add(this.model);
    this.figure = figure;

    this.mixer = new THREE.AnimationMixer(this.model);
    this.layers = {}; // name -> { upper, lower, full, w (current), want }
    for (const clip of source.clips) {
      const halves = split(clip);
      const L = { upper: this.mixer.clipAction(halves.upper), lower: this.mixer.clipAction(halves.lower), full: FULL.has(clip.name), w: 0, want: 0, duration: clip.duration };
      for (const a of [L.upper, L.lower]) { a.setEffectiveWeight(0); a.play(); a.enabled = false; }
      this.layers[clip.name] = L;
    }
    this.overlay = null; // { name, t, duration, full }
    this.combo = 0;
  }

  has(name) { return !!this.layers[name]; }

  setGlow(color, intensity = 2.2) {
    if (!this.suit) return;
    this.suit.emissive.copy(color);
    this.suit.emissiveIntensity = intensity;
  }

  // Base layer: target weights for whole-body clips (a missing name fades out).
  setBase(weights, rates = {}) {
    // kept so multiplayer can send how the body is moving (src/net/net.js)
    this.lastBase = weights;
    this.lastRates = rates;
    for (const [name, L] of Object.entries(this.layers)) {
      L.want = weights[name] || 0;
      if (rates[name] !== undefined) { L.upper.timeScale = L.lower.timeScale = rates[name]; }
    }
  }

  // A one-shot move: on the upper body (attacks) or the whole body (rolls, falls, death).
  play(name, { full, speed = 1, hold = false } = {}) {
    const L = this.layers[name];
    if (!L) return;
    const whole = full ?? L.full;
    for (const a of whole ? [L.upper, L.lower] : [L.upper]) {
      a.reset();
      a.enabled = true;
      a.setLoop(THREE.LoopOnce, 1);
      a.clampWhenFinished = true;
      a.timeScale = speed;
    }
    this.overlay = { name, t: 0, duration: L.duration / speed, full: whole, hold };
    // one-shot moves, for multiplayer to pass on (only the newest few are kept)
    (this.events ||= []).push([name, speed, whole]);
    if (this.events.length > 8) this.events.shift();
  }

  stop() { this.overlay = null; }

  update(dt) {
    const fade = 1 - Math.exp(-dt * 9);
    // the overlay fades in fast and out over its last fifth (a held one stays)
    let ow = 0;
    const o = this.overlay;
    if (o) {
      o.t += dt;
      const fin = Math.max(0.08, o.duration * 0.2);
      ow = o.hold ? Math.min(1, o.t / 0.08) : Math.min(1, o.t / 0.06, (o.duration - o.t) / fin);
      if (!o.hold && o.t >= o.duration) { this.overlay = null; ow = 0; }
    }
    for (const [name, L] of Object.entries(this.layers)) {
      L.w += (L.want - L.w) * fade;
      if (L.w < 0.002 && L.want === 0) L.w = 0;
      const isOverlay = o && o.name === name;
      const upperBase = L.w * (1 - ow), lowerBase = L.w * (o && o.full ? 1 - ow : 1);
      const uw = isOverlay ? ow : upperBase;
      const lw = isOverlay ? (o.full ? ow : lowerBase) : lowerBase;
      L.upper.enabled = uw > 0.001;
      L.lower.enabled = lw > 0.001;
      L.upper.setEffectiveWeight(uw);
      L.lower.setEffectiveWeight(lw);
      if (!isOverlay) {
        // looping base clips
        for (const a of [L.upper, L.lower]) if (a.loop !== THREE.LoopRepeat) { a.setLoop(THREE.LoopRepeat, Infinity); a.clampWhenFinished = false; }
      }
    }
    for (const b of this.touched) b.quaternion.copy(this.restQ.get(b));
    this.touched.clear();
    this.mixer.update(dt);
  }

  // Turn a bone by angle about an axis given in the model's own space (+y up, +z the way it
  // faces, +x its left), on top of whatever the animation set this frame. Parents first.
  addRot(name, axis, angle) {
    const b = this.bones?.[name];
    if (!b || !angle) return;
    const P = tQa.identity();
    const chain = [];
    for (let o = b.parent; o && o !== this.model; o = o.parent) chain.push(o);
    for (let i = chain.length - 1; i >= 0; i--) P.multiply(chain[i].quaternion);
    tQb.setFromAxisAngle(axis, angle);
    tQc.copy(P).invert().multiply(tQb).multiply(P);
    b.quaternion.premultiply(tQc);
    this.touched.add(b);
  }

  // where the pelvis sits in the figure's space right now (for placing a seated body)
  pelvisY() {
    this.model.updateMatrixWorld(true);
    return this.figure.worldToLocal(new THREE.Vector3().setFromMatrixPosition(this.pelvis.matrixWorld)).y;
  }
}
