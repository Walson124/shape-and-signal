import * as THREE from 'three';
import { glowTexture } from './textures.js';
import { REALMS } from './data.js';

const FWD = new THREE.Vector3();
const RIGHT = new THREE.Vector3();
const UP = new THREE.Vector3();
const tmp = new THREE.Vector3();

// The cultivator: a small glowing figure that flies Superman-style and sits
// cross-legged when cultivating.
export class Player {
  constructor(scene, particles) {
    this.particles = particles;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.quat = new THREE.Quaternion();
    this.radius = 2.4;
    this.pose = 0; // 0 flying, 1 meditating
    this.boosting = false;
    this.trailColor = new THREE.Color();
    this.auraColor = new THREE.Color();

    this.root = new THREE.Group();
    scene.add(this.root);
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

    this.aura = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.85 }));
    this.aura.scale.setScalar(9);
    this.root.add(this.aura);
    this.light = new THREE.PointLight(0xffffff, 1.3, 40, 1.4);
    this.light.position.set(0, 3, 3);
    this.root.add(this.light);

    this.shield = new THREE.Mesh(new THREE.IcosahedronGeometry(4.2, 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.2, 0.3), transparent: true, opacity: 0, wireframe: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.root.add(this.shield);
    this.setRealm(0);
  }

  setRealm(realm) {
    const c = new THREE.Color(REALMS[realm].color);
    this.auraColor.copy(c);
    this.trailColor.copy(c).multiplyScalar(0.9);
    this.aura.material.color.copy(c).multiplyScalar(0.9);
    this.aura.scale.setScalar(8 + realm * 1.4);
    this.accent.color.copy(c).multiplyScalar(1.5);
    this.light.color.copy(c);
  }

  forward(out = new THREE.Vector3()) {
    return out.set(0, 0, -1).applyQuaternion(this.quat);
  }

  placeAt(pos, lookAt) {
    this.pos.copy(pos);
    this.vel.set(0, 0, 0);
    if (lookAt) {
      tmp.subVectors(lookAt, pos).normalize();
      this.yaw = Math.atan2(-tmp.x, -tmp.z);
      this.pitch = Math.asin(THREE.MathUtils.clamp(tmp.y, -1, 1));
    }
    this.quat.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
    this.root.position.copy(this.pos);
    this.root.quaternion.copy(this.quat);
  }

  // move: {x: strafe, y: vertical, z: forward} each in [-1, 1]
  update(dt, move, look, opts) {
    this.yaw -= look.x;
    this.pitch = THREE.MathUtils.clamp(this.pitch - look.y, -1.45, 1.45);
    this.quat.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));

    FWD.set(0, 0, -1).applyQuaternion(this.quat);
    RIGHT.set(1, 0, 0).applyQuaternion(this.quat);
    UP.set(0, 1, 0).applyQuaternion(this.quat);
    const dir = tmp.set(0, 0, 0).addScaledVector(FWD, move.z).addScaledVector(RIGHT, move.x).addScaledVector(UP, move.y);
    if (dir.lengthSq() > 1) dir.normalize();
    const max = opts.speed * (opts.boost ? 2.7 : 1) * (opts.meditating ? 0 : 1);
    this.boosting = opts.boost && dir.lengthSq() > 0.01;
    const target = dir.multiplyScalar(max);
    const k = 1 - Math.exp(-dt * (opts.meditating ? 4 : 2.6));
    this.vel.lerp(target, k);
    this.pos.addScaledVector(this.vel, dt);

    // pose & animation
    const goalPose = opts.meditating ? 1 : 0;
    this.pose += (goalPose - this.pose) * (1 - Math.exp(-dt * 5));
    const p = this.pose;
    const speedFrac = Math.min(1, this.vel.length() / Math.max(1, opts.speed));
    this.figure.rotation.x = THREE.MathUtils.lerp(-Math.PI / 2 + 0.15, 0, p);
    this.figure.position.y = THREE.MathUtils.lerp(0, -0.4, p);
    // flying: arms forward-ish (superhero), meditating: hands on knees
    const t = opts.time;
    this.armR.rotation.x = THREE.MathUtils.lerp(Math.PI - 0.15 + Math.sin(t * 2) * 0.05, 0.5, p);
    this.armL.rotation.x = THREE.MathUtils.lerp(0.25 + speedFrac * 0.2, 0.5, p);
    this.armL.rotation.z = THREE.MathUtils.lerp(-0.25, -0.6, p);
    this.armR.rotation.z = THREE.MathUtils.lerp(0.05, 0.6, p);
    this.legL.rotation.x = THREE.MathUtils.lerp(0.08 + Math.sin(t * 3) * 0.06, 1.5, p);
    this.legR.rotation.x = THREE.MathUtils.lerp(-0.05 - Math.sin(t * 3) * 0.06, 1.5, p);
    this.legL.rotation.z = THREE.MathUtils.lerp(0, -0.9, p);
    this.legR.rotation.z = THREE.MathUtils.lerp(0, 0.9, p);

    this.root.position.copy(this.pos);
    this.root.quaternion.copy(this.quat);
    this.aura.material.opacity = 0.28 + 0.1 * Math.sin(t * 3) + 0.2 * p;
    this.shield.material.opacity = opts.shield ? 0.35 + 0.15 * Math.sin(t * 12) : 0;
    this.shield.rotation.y += dt * 1.5;

    // trail
    const speed = this.vel.length();
    if (speed > 8 && !opts.hidden) {
      const n = this.boosting ? 4 : 2;
      for (let i = 0; i < n; i++) {
        const back = FWD.clone().multiplyScalar(-2.6 - Math.random() * 1.2);
        this.particles.emit(
          this.pos.x + back.x + (Math.random() - 0.5) * 0.6,
          this.pos.y + back.y + (Math.random() - 0.5) * 0.6,
          this.pos.z + back.z + (Math.random() - 0.5) * 0.6,
          this.vel.x * 0.2, this.vel.y * 0.2, this.vel.z * 0.2,
          this.trailColor, this.boosting ? 0.75 : 0.5, this.boosting ? 0.8 : 0.5, 1.5, 0.6,
        );
      }
    }
  }

  setVisible(v) {
    this.root.visible = v;
  }
}
