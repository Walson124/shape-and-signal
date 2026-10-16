import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

// The skinned player model (built in Blender by tools/blender/make_character.py).
// It's loaded once and cloned per character. Its bones are driven from the
// simple joint groups in humanoid.js, so every pose the game already sets
// (walking, sitting, flying, riding) carries straight over.

let shared = null;
export function loadPlayerModel() {
  if (typeof document === 'undefined') return Promise.resolve(null);
  if (!shared) {
    const url = `${import.meta.env?.BASE_URL ?? './'}models/player.glb`;
    shared = new GLTFLoader().loadAsync(url).then((gltf) => gltf.scene).catch((e) => { console.warn('player model failed to load', e); return null; });
  }
  return shared;
}

const tQ = new THREE.Quaternion();
const tE = new THREE.Euler();
const DOWN = new THREE.Vector3(0, -1, 0);

// Which joint group drives which bone. Each group's rotation is in the
// figure's axes (x right, y up, -z forward), the same as the bones' rest pose.
const DRIVE = {
  upperarm_l: 'armL', upperarm_r: 'armR', lowerarm_l: 'elbowL', lowerarm_r: 'elbowR',
  thigh_l: 'legL', thigh_r: 'legR', calf_l: 'kneeL', calf_r: 'kneeR',
};

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
  const sk = mesh.skeleton;
  sk.update = function update() {
    tInv.copy(mesh.matrixWorld).invert();
    for (let i = 0; i < this.bones.length; i++) {
      tM.multiplyMatrices(tInv, this.bones[i].matrixWorld).multiply(this.boneInverses[i]).multiply(bind);
      tM.toArray(this.boneMatrices, i * 16);
    }
    if (this.boneTexture) this.boneTexture.needsUpdate = true;
  };
}

export class SkinnedFigure {
  // `source` is the loaded scene; `figure` is the group it's placed in (origin at the hips).
  constructor(source, figure) {
    this.model = cloneSkinned(source);
    // the model faces +z; the game's figures face -z
    this.model.rotation.y = Math.PI;
    figure.add(this.model);
    this.model.traverse((o) => {
      if (!o.isMesh) return;
      o.frustumCulled = false; // skinned bounds don't follow the pose
      const m = o.material;
      if (m.transparent) {
        const name = m.name || '';
        // hair is a cut-out (sorting it as see-through flickers); brows and lashes blend
        if (/short|hair|bob|long|afro|braid|ponytail/.test(name)) { m.transparent = false; m.alphaTest = 0.5; }
        else m.depthWrite = false;
      }
    });
    const skinned = [];
    this.model.traverse((o) => { if (o.isSkinnedMesh) skinned.push(o); });
    for (const mesh of skinned) relativeSkinning(mesh);
    this.bones = skinned[0].skeleton.bones;
    this.byName = Object.fromEntries(this.bones.map((b) => [b.name, b]));
    // feet on the figure's floor: the hips are the figure's origin
    this.model.updateMatrixWorld(true);
    const pelvis = new THREE.Vector3().setFromMatrixPosition(this.byName.pelvis.matrixWorld);
    this.model.worldToLocal(pelvis);
    this.hipHeight = pelvis.y;
    this.model.position.y = -this.hipHeight;
    this.model.updateMatrixWorld(true);
    // each bone's rest orientation in figure space, and its parent's
    const figInv = new THREE.Quaternion();
    figure.getWorldQuaternion(figInv).invert();
    const fig = (o) => o.getWorldQuaternion(new THREE.Quaternion()).premultiply(figInv);
    this.rest = new Map(this.bones.map((b) => [b, fig(b)]));
    this.parentRest = fig(this.bones[0].parent);
    // the arms rest in an A-pose: a fixed turn brings them down to hang at the sides
    this.base = new Map();
    for (const side of ['l', 'r']) {
      const up = this.byName[`upperarm_${side}`], low = this.byName[`lowerarm_${side}`];
      const a = new THREE.Vector3().setFromMatrixPosition(up.matrixWorld), b = new THREE.Vector3().setFromMatrixPosition(low.matrixWorld);
      figure.worldToLocal(a); figure.worldToLocal(b);
      const dir = b.sub(a).normalize();
      const hang = DOWN.clone().add(new THREE.Vector3(Math.sign(dir.x) * 0.12, 0, 0)).normalize();
      this.base.set(up, new THREE.Quaternion().setFromUnitVectors(dir, hang));
    }
    // per bone: the arms-down rest pose, parent index, and scratch space for posing
    const index = new Map(this.bones.map((b, k) => [b, k]));
    this.parent = this.bones.map((b) => (index.has(b.parent) ? index.get(b.parent) : -1));
    this.drive = this.bones.map((b) => DRIVE[b.name] || null);
    this.restDown = this.bones.map((b) => {
      // the nearest upper arm at or above this bone decides its arms-down turn
      let a = b;
      while (a && !this.base.has(a)) a = a.parent;
      return a ? this.base.get(a).clone().multiply(this.rest.get(b)) : this.rest.get(b).clone();
    });
    this.D = this.bones.map(() => new THREE.Quaternion());
    this.W = this.bones.map(() => new THREE.Quaternion());
    this.tmp = new THREE.Quaternion();
  }

  // Copy the joint groups' rotations onto the skeleton. Each group turns its
  // limb about the joint in figure axes, carried along by the joints above it,
  // exactly as the nested groups do.
  apply(joints) {
    for (let k = 0; k < this.bones.length; k++) {
      const p = this.parent[k];
      const D = this.D[k];
      if (p >= 0) D.copy(this.D[p]); else D.identity();
      const key = this.drive[k];
      if (key && joints[key]) {
        const r = joints[key].rotation;
        D.multiply(tQ.setFromEuler(tE.set(r.x, r.y, r.z, r.order)));
      }
      const W = this.W[k].copy(D).multiply(this.restDown[k]);
      this.tmp.copy(p >= 0 ? this.W[p] : this.parentRest).invert();
      this.bones[k].quaternion.copy(this.tmp).multiply(W);
    }
  }
}
