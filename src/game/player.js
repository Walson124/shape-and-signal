import * as THREE from 'three';
import { glowTexture } from '../world/textures.js';
import { REALMS } from './data.js';

const Y = new THREE.Vector3(0, 1, 0);
const X = new THREE.Vector3(1, 0, 0);
const tA = new THREE.Vector3();
const tB = new THREE.Vector3();
const tC = new THREE.Vector3();
const tQ = new THREE.Quaternion();
const tM = new THREE.Matrix4();
export const EYE = 1.7;

// The cultivator. Position is the eye point, in whatever frame the game's
// local root is attached to (a planet's rotating surface, or the star system).
// Movement modes: 'ground' (gravity), 'fly' (hovering flight) and 'space'.
export class Player {
  constructor(root, particles) {
    this.particles = particles;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.radius = 0.9;
    this.mode = 'ground';
    this.grounded = false;
    this.boosting = false;
    this.pose = 0;
    this.walkPhase = 0;
    this.trailColor = new THREE.Color();
    this.auraColor = new THREE.Color();
    this.up = new THREE.Vector3(0, 1, 0);

    this.root = new THREE.Group();
    root.add(this.root);
    this.figure = new THREE.Group();
    this.root.add(this.figure);
    const suit = new THREE.MeshStandardMaterial({ color: 0x1b2236, metalness: 0.55, roughness: 0.38 });
    const skin = new THREE.MeshStandardMaterial({ color: 0xe8c3a0, roughness: 0.6 });
    const hair = new THREE.MeshStandardMaterial({ color: 0x14141c, roughness: 0.7 });
    this.accent = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 0.9, 6, 12), suit);
    torso.position.y = 0.55;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.34, 16, 12), skin);
    head.position.y = 1.55;
    const hairM = new THREE.Mesh(new THREE.SphereGeometry(0.36, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), hair);
    hairM.position.y = 1.6;
    hairM.rotation.x = 0.25;
    const belt = new THREE.Mesh(new THREE.TorusGeometry(0.43, 0.05, 6, 20), this.accent);
    belt.rotation.x = Math.PI / 2;
    belt.position.y = 0.2;
    const chest = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.05), this.accent);
    chest.position.set(0, 0.85, -0.42);
    this.figure.add(torso, head, hairM, belt, chest);
    const limb = (len, r) => new THREE.CapsuleGeometry(r, len, 4, 8);
    const mkArm = (side) => {
      const g = new THREE.Group();
      g.position.set(0.55 * side, 1.05, 0);
      const m = new THREE.Mesh(limb(0.8, 0.13), suit);
      m.position.y = -0.5;
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.03, 6, 12), this.accent);
      band.rotation.x = Math.PI / 2;
      band.position.y = -0.8;
      g.add(m, band);
      this.figure.add(g);
      return g;
    };
    const mkLeg = (side) => {
      const g = new THREE.Group();
      g.position.set(0.22 * side, 0.0, 0);
      const m = new THREE.Mesh(limb(1.0, 0.16), suit);
      m.position.y = -0.62;
      g.add(m);
      this.figure.add(g);
      return g;
    };
    this.armL = mkArm(-1);
    this.armR = mkArm(1);
    this.legL = mkLeg(-1);
    this.legR = mkLeg(1);
    this.figure.scale.setScalar(0.85);
    this.aura = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.4 }));
    this.aura.scale.setScalar(5);
    this.root.add(this.aura);
    this.shield = new THREE.Mesh(new THREE.IcosahedronGeometry(2.4, 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.2, 0.3), transparent: true, opacity: 0, wireframe: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.root.add(this.shield);
    this.setRealm(0);
  }

  setRealm(realm) {
    const c = new THREE.Color(REALMS[realm].color);
    this.auraColor.copy(c);
    this.trailColor.copy(c).multiplyScalar(0.9);
    this.aura.material.color.copy(c).multiplyScalar(0.8);
    this.accent.color.copy(c).multiplyScalar(1.5);
    // the aura swells with each realm
    this.aura.scale.setScalar(5 + realm * 2.2);
  }

  forward(out = new THREE.Vector3()) {
    return out.set(0, 0, -1).applyQuaternion(this.quat);
  }

  localUp(out = new THREE.Vector3()) {
    return out.set(0, 1, 0).applyQuaternion(this.quat);
  }

  // Place at `pos` looking toward `look`, with `up` as the vertical.
  placeAt(pos, look, up) {
    this.pos.copy(pos);
    this.vel.set(0, 0, 0);
    const u = up ? up.clone() : new THREE.Vector3(0, 1, 0);
    tM.lookAt(pos, look, u);
    this.quat.setFromRotationMatrix(tM);
    this.syncRoot();
  }

  syncRoot() {
    this.root.position.copy(this.pos);
    this.root.quaternion.copy(this.quat);
  }

  // Rotate so the local up matches `up` while keeping the view direction.
  alignUp(up, k) {
    const f = this.forward(tA);
    const dot = f.dot(up);
    if (Math.abs(dot) > 0.995) return;
    tM.lookAt(tB.set(0, 0, 0), f, up);
    tQ.setFromRotationMatrix(tM);
    this.quat.slerp(tQ, Math.min(1, k));
  }

  look(dx, dy, env) {
    if (env.up) {
      // yaw around the planet's up, pitch around the view's right, clamped
      tQ.setFromAxisAngle(env.up, -dx);
      this.quat.premultiply(tQ);
      const f = this.forward(tA);
      const pitch = Math.asin(THREE.MathUtils.clamp(f.dot(env.up), -1, 1));
      const next = THREE.MathUtils.clamp(pitch - dy, -1.5, 1.5);
      tQ.setFromAxisAngle(X, next - pitch);
      this.quat.multiply(tQ);
    } else {
      tQ.setFromAxisAngle(Y, -dx);
      this.quat.multiply(tQ);
      tQ.setFromAxisAngle(X, -dy);
      this.quat.multiply(tQ);
    }
    this.quat.normalize();
  }

  /**
   * move: {x, y, z} input axes. env: {
   *   up: local vertical or null, floorR: walkable radius under us or null,
   *   gravity, speed, boost, meditating, jump, time, hidden, align
   * }
   */
  // Seated on a vehicle: legs astride, hands forward on the bars, facing the way it goes.
  ride(dt, time, v) {
    const up = this.pos.clone().normalize();
    this.up.copy(up);
    const f = v.fwd.clone().projectOnPlane(up).normalize();
    const look = new THREE.Matrix4().lookAt(this.pos, this.pos.clone().add(f), up);
    this.root.position.copy(this.pos);
    this.root.quaternion.setFromRotationMatrix(look);
    this.root.rotateZ(v.lean * 0.8);
    this.figure.position.y = -1.62;
    this.figure.rotation.x = 0.18;
    this.armR.rotation.x = 1.25;
    this.armL.rotation.x = 1.25;
    this.legL.rotation.x = 1.35;
    this.legR.rotation.x = 1.35;
    this.legL.rotation.z = -0.28;
    this.legR.rotation.z = 0.28;
    this.aura.material.opacity = 0.12;
    this.shield.material.opacity = 0;
  }

  update(dt, move, env) {
    const up = env.up;
    if (up) {
      this.up.copy(up);
      this.alignUp(up, dt * (this.mode === 'ground' ? 14 : env.align ?? 4));
    }
    const f = this.forward(tA);
    const r = tB.set(1, 0, 0).applyQuaternion(this.quat);
    const max = env.speed * (env.boost ? (this.mode === 'ground' ? 1.9 : 2.7) : 1) * (env.meditating ? 0 : 1);
    this.boosting = env.boost && (move.x !== 0 || move.y !== 0 || move.z !== 0);

    if (this.mode === 'ground' && up) {
      // horizontal intent along the tangent plane
      const fh = tC.copy(f).addScaledVector(up, -f.dot(up));
      if (fh.lengthSq() < 1e-6) fh.copy(this.localUp(tC)).negate().addScaledVector(up, -0);
      fh.normalize();
      const rh = new THREE.Vector3().crossVectors(fh, up).normalize();
      const wish = new THREE.Vector3().addScaledVector(fh, move.z).addScaledVector(rh, move.x);
      if (wish.lengthSq() > 1) wish.normalize();
      wish.multiplyScalar(max);
      const vUp = this.vel.dot(up);
      const vH = this.vel.clone().addScaledVector(up, -vUp);
      vH.lerp(wish, 1 - Math.exp(-dt * (this.grounded ? 12 : 2.5)));
      let vy = vUp - env.gravity * dt;
      if (env.jump && this.grounded) {
        vy = env.jumpSpeed;
        this.grounded = false;
      }
      this.vel.copy(vH).addScaledVector(up, vy);
    } else {
      const u = up && this.mode === 'fly' ? up : this.localUp(tC);
      const wish = new THREE.Vector3().addScaledVector(f, move.z).addScaledVector(r, move.x).addScaledVector(u, move.y);
      if (wish.lengthSq() > 1) wish.normalize();
      wish.multiplyScalar(max);
      this.vel.lerp(wish, 1 - Math.exp(-dt * (env.meditating ? 4 : env.accel ?? 2.6)));
    }
    this.pos.addScaledVector(this.vel, dt);

    // floor contact
    this.grounded = false;
    if (up && env.floorR !== null && env.floorR !== undefined) {
      const D = this.pos.length();
      const min = env.floorR + EYE;
      if (D < min) {
        this.pos.multiplyScalar(min / D);
        const vn = this.vel.dot(up);
        if (vn < 0) this.vel.addScaledVector(up, -vn);
        this.grounded = true;
      } else if (this.mode === 'ground' && D < min + 0.25) {
        this.grounded = true;
      }
    }

    // visuals
    const speed = this.vel.length();
    const goal = env.meditating ? 1 : 0;
    this.pose += (goal - this.pose) * (1 - Math.exp(-dt * 5));
    const p = this.pose;
    const standing = this.mode === 'ground' ? 1 : 0;
    this.stand = (this.stand ?? 1) + (standing - (this.stand ?? 1)) * (1 - Math.exp(-dt * 6));
    const st = this.stand;
    const t = env.time;
    if (this.mode === 'ground' && this.grounded) this.walkPhase += speed * dt * 1.3;
    const swing = Math.sin(this.walkPhase) * Math.min(1, speed / 6) * 0.7 * st;
    this.figure.position.y = THREE.MathUtils.lerp(-0.2, -1.55, Math.max(st, p)) + p * 0.35;
    this.figure.rotation.x = THREE.MathUtils.lerp(THREE.MathUtils.lerp(-Math.PI / 2 + 0.15, 0, st), 0, p);
    this.armR.rotation.x = THREE.MathUtils.lerp(THREE.MathUtils.lerp(Math.PI - 0.15, swing, st), 0.5, p);
    this.armL.rotation.x = THREE.MathUtils.lerp(THREE.MathUtils.lerp(0.25, -swing, st), 0.5, p);
    this.legL.rotation.x = THREE.MathUtils.lerp(THREE.MathUtils.lerp(0.08 + Math.sin(t * 3) * 0.06, -swing, st), 1.5, p);
    this.legR.rotation.x = THREE.MathUtils.lerp(THREE.MathUtils.lerp(-0.05 - Math.sin(t * 3) * 0.06, swing, st), 1.5, p);
    this.legL.rotation.z = THREE.MathUtils.lerp(0, -0.9, p);
    this.legR.rotation.z = THREE.MathUtils.lerp(0, 0.9, p);
    this.syncRoot();
    this.aura.material.opacity = 0.18 + 0.08 * Math.sin(t * 3) + 0.3 * p;
    this.shield.material.opacity = env.shield ? 0.35 + 0.15 * Math.sin(t * 12) : 0;
    this.shield.rotation.y += dt * 1.5;

    if (speed > 10 && !env.hidden && this.mode !== 'ground') {
      const n = this.boosting ? 3 : 1;
      for (let i = 0; i < n; i++) {
        const back = f.clone().multiplyScalar(-1.5 - Math.random());
        this.particles.emit(this.pos.x + back.x, this.pos.y + back.y - 0.6, this.pos.z + back.z, this.vel.x * 0.2, this.vel.y * 0.2, this.vel.z * 0.2, this.trailColor, this.boosting ? 0.6 : 0.4, 0.5, 1.5, 0.6);
      }
    }
  }

  setVisible(v) {
    this.root.visible = v;
  }

  rebase(m, q) {
    this.pos.applyMatrix4(m);
    this.vel.applyQuaternion(q);
    this.quat.premultiply(q);
    this.up.applyQuaternion(q);
    this.syncRoot();
  }
}
