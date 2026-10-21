import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { applySkin } from './beast-skin.js';

// First-person arms: the player's own suited arms in the view-model scene.
// The view model's hand rig (viewmodel.js) still decides every pose (fists,
// casting, sword grips, the bow, the radar), and weapons stay attached to it;
// these arms just follow it. Each frame the wrist goes where that rig's wrist
// is, the arm bends to reach it with the elbow pointing down and out, and the
// fingers copy its curl. One model copy per arm; everything else is folded
// away out of sight.

const v = (x, y, z) => new THREE.Vector3(x, y, z);
const tQ = new THREE.Quaternion(), tQ2 = new THREE.Quaternion(), tM3 = new THREE.Matrix4();

// rotation taking a local frame (Y along the bone, U across it) to a wanted world frame
function frameQuat(yL, uL, yW, uW, out) {
  const xL = new THREE.Vector3().crossVectors(yL, uL).normalize();
  const uL2 = new THREE.Vector3().crossVectors(xL, yL).normalize();
  const xW = new THREE.Vector3().crossVectors(yW, uW).normalize();
  const uW2 = new THREE.Vector3().crossVectors(xW, yW).normalize();
  const mL = new THREE.Matrix4().makeBasis(xL, yL, uL2);
  const mW = new THREE.Matrix4().makeBasis(xW, yW, uW2);
  return out.setFromRotationMatrix(mW.multiply(mL.transpose()));
}

class Arm {
  constructor(source, scene, side) {
    this.side = side;
    const s = side === 'r' ? 1 : -1;
    this.model = cloneSkinned(source.scene);
    this.model.rotation.y = Math.PI; // the model faces +z; the view looks down -z
    scene.add(this.model);
    this.model.traverse((o) => {
      if (!o.isMesh) return;
      o.frustumCulled = false;
      // only the arms-only copy of the suited body shows (the other arm is folded away below)
      if (!/fparms/.test(o.name)) o.visible = false;
      else { o.material = o.material.clone(); this.suit = o.material; this.suit.emissive.set(0x3ef2ff); this.suit.emissiveIntensity = 2; applySkin(this.suit, 'suit', 1); }
    });
    const skinned = [];
    this.model.traverse((o) => { if (o.isSkinnedMesh) skinned.push(o); });
    const bones = Object.fromEntries(skinned[0].skeleton.bones.map((b) => [b.name, b]));
    this.b = bones;
    const other = side === 'r' ? 'l' : 'r';
    for (const n of ['head', 'neck_01', `clavicle_${other}`]) bones[n].scale.setScalar(0.001);
    this.model.updateMatrixWorld(true);
    const wp = (n) => bones[n].getWorldPosition(new THREE.Vector3());
    this.upper = bones[`upperarm_${side}`];
    this.lower = bones[`lowerarm_${side}`];
    this.hand = bones[`hand_${side}`];
    this.upperLen = wp(`upperarm_${side}`).distanceTo(wp(`lowerarm_${side}`));
    this.lowerLen = wp(`lowerarm_${side}`).distanceTo(wp(`hand_${side}`));
    // the back of the hand at rest, from the finger direction and the line across the knuckles
    // (pinky to index, pointing to the thumb side)
    const fingerDir = wp(`middle_01_${side}`).sub(wp(`hand_${side}`)).normalize();
    const across = wp(`index_01_${side}`).sub(wp(`pinky_01_${side}`));
    across.addScaledVector(fingerDir, -across.dot(fingerDir)).normalize();
    const backRest = side === 'r' ? new THREE.Vector3().crossVectors(fingerDir, across) : new THREE.Vector3().crossVectors(across, fingerDir);
    backRest.normalize();
    // the model's rear (where an elbow points at rest)
    const rear = v(0, 0, -1).applyQuaternion(this.model.quaternion);
    const localOf = (bone, world) => world.clone().applyQuaternion(bone.getWorldQuaternion(new THREE.Quaternion()).invert()).normalize();
    this.Y = v(0, 1, 0);
    this.uUpper = localOf(this.upper, rear);
    this.uLower = localOf(this.lower, backRest);
    this.uHand = localOf(this.hand, backRest);
    // finger curl axes: positive turns the tip towards the palm
    this.fingers = ['index', 'middle', 'ring', 'pinky'].map((f) => [1, 2, 3].map((i) => this.curlJoint(bones[`${f}_0${i}_${side}`], backRest)));
    this.thumb = [2, 3].map((i) => this.curlJoint(bones[`thumb_0${i}_${side}`], backRest));
    this.pole = v(0.55 * s, -1, 0.25).normalize();
    this.shoulder = v(0.2 * s, -0.27, 0.14);
    this.scale = 0.86;
    this.model.scale.setScalar(this.scale);
  }

  curlJoint(bone, backRest) {
    const q = bone.getWorldQuaternion(new THREE.Quaternion());
    const dir = v(0, 1, 0).applyQuaternion(q);
    const axisW = new THREE.Vector3().crossVectors(dir, backRest).normalize();
    // check which way turns the tip towards the palm
    const test = dir.clone().applyAxisAngle(axisW, 0.3);
    if (test.dot(backRest) > dir.dot(backRest)) axisW.negate();
    return { bone, rest: bone.quaternion.clone(), axis: axisW.applyQuaternion(q.clone().invert()).normalize() };
  }

  setWorld(bone, qWorld) {
    bone.parent.updateWorldMatrix(true, false);
    bone.parent.getWorldQuaternion(tQ2);
    bone.quaternion.copy(tQ2.invert().multiply(qWorld));
    bone.updateMatrixWorld(true);
  }

  // Follow one hand of the view-model rig.
  follow(rig) {
    rig.hand.updateWorldMatrix(true, false);
    const m = rig.hand.matrixWorld;
    const W = new THREE.Vector3().setFromMatrixPosition(m);
    const fwd = v(0, 0, -1).transformDirection(m);
    const back = v(0, 1, 0).transformDirection(m);
    const E = W.clone().addScaledVector(fwd, -this.lowerLen * this.scale);
    const d = E.clone().sub(this.shoulder).normalize();
    const S = E.clone().addScaledVector(d, -this.upperLen * this.scale);
    // put the shoulder at S
    this.model.updateMatrixWorld(true);
    const at = this.upper.getWorldPosition(new THREE.Vector3());
    this.model.position.add(S.sub(at));
    this.model.updateMatrixWorld(true);
    const pole = this.pole.clone().addScaledVector(d, -this.pole.dot(d)).normalize();
    this.setWorld(this.upper, frameQuat(this.Y, this.uUpper, d, pole, tQ));
    this.setWorld(this.lower, frameQuat(this.Y, this.uLower, W.clone().sub(E).normalize(), back, tQ));
    this.setWorld(this.hand, frameQuat(this.Y, this.uHand, fwd, back, tQ));
    const curl = rig.cur.curl;
    this.fingers.forEach((joints, i) => joints.forEach((j, k) => j.bone.quaternion.copy(j.rest).multiply(tQ.setFromAxisAngle(j.axis, curl[i] * [1.15, 1.2, 0.85][k]))));
    this.thumb.forEach((j, k) => j.bone.quaternion.copy(j.rest).multiply(tQ.setFromAxisAngle(j.axis, rig.cur.thumb * [0.7, 0.9][k])));
  }
}

export class FirstPersonArms {
  constructor(source, scene) {
    this.right = new Arm(source, scene, 'r');
    this.left = new Arm(source, scene, 'l');
  }

  setGlow(color, intensity = 2) {
    for (const a of [this.right, this.left]) { a.suit.emissive.copy(color); a.suit.emissiveIntensity = intensity; }
  }

  setVisible(v) { this.right.model.visible = this.left.model.visible = v; }

  update(rightRig, leftRig) {
    this.right.follow(rightRig);
    this.left.follow(leftRig);
  }
}
