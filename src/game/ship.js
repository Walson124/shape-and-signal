import * as THREE from 'three';
import { buildPlayerShip } from '../world/models.js';
import { SHIPS } from './data.js';

const Y = new THREE.Vector3(0, 1, 0);
const X = new THREE.Vector3(1, 0, 0);
const tA = new THREE.Vector3();
const tQ = new THREE.Quaternion();
const tM = new THREE.Matrix4();

// The player's starship. Lives in the game's local frame like everything else.
export class Ship {
  constructor(root, tier) {
    this.root = root;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.landed = false;
    this.thrust = 0;
    this.setTier(tier);
  }

  setTier(tier) {
    const keepHull = this.hull !== undefined ? this.hull / this.maxHull : 1;
    if (this.model) {
      this.root.remove(this.model.group);
      this.model.dispose();
    }
    this.tier = tier;
    this.def = SHIPS[tier];
    this.model = buildPlayerShip(tier, this.def.color);
    this.root.add(this.model.group);
    this.scale = 1 + tier * 0.18;
    this.gearHeight = 3.8 * this.scale;
    this.radius = 13 * this.scale;
    this.maxHull = 4000 * this.def.hull;
    this.hull = this.maxHull * keepHull;
    this.sync();
  }

  forward(out = new THREE.Vector3()) {
    return out.set(0, 0, -1).applyQuaternion(this.quat);
  }

  localUp(out = new THREE.Vector3()) {
    return out.set(0, 1, 0).applyQuaternion(this.quat);
  }

  placeAt(pos, look, up) {
    this.pos.copy(pos);
    this.vel.set(0, 0, 0);
    tM.lookAt(pos, look, up || Y);
    this.quat.setFromRotationMatrix(tM);
    this.sync();
  }

  sync() {
    this.model.group.position.copy(this.pos);
    this.model.group.quaternion.copy(this.quat);
    this.model.gear.visible = this.landed || this.gearOut;
  }

  look(dx, dy, env) {
    if (this.landed) return;
    const k = 0.8;
    if (env.up) {
      tQ.setFromAxisAngle(env.up, -dx * k);
      this.quat.premultiply(tQ);
    } else {
      tQ.setFromAxisAngle(Y, -dx * k);
      this.quat.multiply(tQ);
    }
    tQ.setFromAxisAngle(X, -dy * k);
    this.quat.multiply(tQ);
    this.quat.normalize();
  }

  /** env: {up, floorR, speed (cap), boost, inAtmo, time} */
  update(dt, move, env) {
    const up = env.up;
    if (this.landed) {
      this.vel.set(0, 0, 0);
      if (up) {
        const D = this.pos.length();
        this.pos.multiplyScalar((env.floorR + this.gearHeight) / D);
        const f = this.forward(tA);
        f.addScaledVector(up, -f.dot(up)).normalize();
        tM.lookAt(new THREE.Vector3(), f, up);
        tQ.setFromRotationMatrix(tM);
        this.quat.slerp(tQ, Math.min(1, dt * 4));
      }
      if (move.y > 0 || move.z !== 0) {
        this.landed = false;
        if (up) this.vel.copy(up).multiplyScalar(12);
      }
      this.thrust += (0 - this.thrust) * Math.min(1, dt * 3);
      this.model.setThrust(this.thrust);
      this.sync();
      return;
    }
    if (up && env.inAtmo) {
      // keep the horizon level while flying in an atmosphere
      const f = this.forward(tA);
      if (Math.abs(f.dot(up)) < 0.98) {
        tM.lookAt(new THREE.Vector3(), f, up);
        tQ.setFromRotationMatrix(tM);
        this.quat.slerp(tQ, Math.min(1, dt * 1.5));
      }
    }
    const f = this.forward(tA).clone();
    const r = new THREE.Vector3(1, 0, 0).applyQuaternion(this.quat);
    const u = up && env.inAtmo ? up : this.localUp();
    const wish = new THREE.Vector3().addScaledVector(f, move.z).addScaledVector(r, move.x * 0.6).addScaledVector(u, move.y * 0.6);
    if (wish.lengthSq() > 1) wish.normalize();
    const max = env.speed * (env.boost ? 2.2 : 1);
    wish.multiplyScalar(max);
    this.vel.lerp(wish, 1 - Math.exp(-dt * (env.accel ?? 1.2)));
    this.pos.addScaledVector(this.vel, dt);
    this.thrust += (Math.min(1, wish.length() / Math.max(1, env.speed)) * (env.boost ? 1 : 0.6) - this.thrust) * Math.min(1, dt * 4);
    this.model.setThrust(this.thrust);
    this.gearOut = false;
    if (up && env.floorR !== null && env.floorR !== undefined) {
      const D = this.pos.length();
      const min = env.floorR + this.gearHeight;
      const alt = D - min;
      this.gearOut = alt < 40;
      if (D < min) {
        this.pos.multiplyScalar(min / D);
        const vn = this.vel.dot(up);
        if (vn < 0) this.vel.addScaledVector(up, -vn);
        // settle onto the ground when slow and descending
        if (this.vel.length() < 30 && move.y <= 0) this.landed = true;
      }
    }
    this.sync();
  }

  rebase(m, q) {
    this.pos.applyMatrix4(m);
    this.vel.applyQuaternion(q);
    this.quat.premultiply(q);
    this.sync();
  }

  setVisible(v) {
    this.model.group.visible = v;
  }

  dispose() {
    this.root.remove(this.model.group);
    this.model.dispose();
  }
}
