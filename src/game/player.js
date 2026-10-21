import * as THREE from 'three';
import { glowTexture } from '../world/textures.js';
import { REALMS } from './data.js';
import { buildHumanoid, HIP_HEIGHT } from './humanoid.js';
import { loadPlayerModel, SkinnedFigure } from './player-model.js';

const Y = new THREE.Vector3(0, 1, 0);
const X = new THREE.Vector3(1, 0, 0);
const tA = new THREE.Vector3();
const tB = new THREE.Vector3();
const tC = new THREE.Vector3();
const tQ = new THREE.Quaternion();
const tD = new THREE.Vector3();
const tE = new THREE.Vector3();
const tN = new THREE.Matrix4();
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
    this.groundGrace = 0;
    this.jumpBuffer = 0;
    this.boosting = false;
    this.pose = 0;
    this.walkPhase = 0;
    this.trailColor = new THREE.Color();
    this.auraColor = new THREE.Color();
    this.up = new THREE.Vector3(0, 1, 0);

    this.root = new THREE.Group();
    root.add(this.root);
    this.accent = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const body = buildHumanoid({ accent: this.accent });
    this.figure = body.figure;
    this.root.add(this.figure);
    // shoulder and hip joints keep their old names; elbows, knees and the hand are new
    this.armL = body.armL.shoulder; this.armR = body.armR.shoulder;
    this.elbowL = body.armL.elbow; this.elbowR = body.armR.elbow; this.handR = body.armR.hand;
    this.legL = body.legL.hip; this.legR = body.legR.hip;
    this.kneeL = body.legL.knee; this.kneeR = body.legR.knee;
    this.joints = { armL: this.armL, armR: this.armR, elbowL: this.elbowL, elbowR: this.elbowR, legL: this.legL, legR: this.legR, kneeL: this.kneeL, kneeR: this.kneeR };
    this.hipHeight = HIP_HEIGHT;
    // the skinned, animated model replaces the simple shapes once it has loaded
    // (the shapes' hand group still holds anything a duel fighter carries)
    const shapes = [];
    this.figure.traverse((o) => { if (o.isMesh) shapes.push(o); });
    loadPlayerModel().then((source) => {
      if (!source) return;
      this.skin = new SkinnedFigure(source, this.figure);
      this.hipHeight = this.skin.hipHeight;
      this.skin.setGlow(this.auraColor, this.glowLevel());
      for (const m of shapes) m.visible = false;
    });
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
    // the suit's piping burns a little brighter with each realm (a trim, not a lamp)
    this.realmLevel = realm;
    this.skin?.setGlow(this.auraColor, this.glowLevel());
    // the aura swells with each realm
    this.aura.scale.setScalar(5 + realm * 2.2);
  }

  glowLevel() { return 0.35 + (this.realmLevel || 0) * 0.07; }

  forward(out = new THREE.Vector3()) {
    return out.set(0, 0, -1).applyQuaternion(this.quat);
  }

  localUp(out = new THREE.Vector3()) {
    return out.set(0, 1, 0).applyQuaternion(this.quat);
  }

  // Place at `pos` looking toward `look`, with `up` as the vertical.
  placeAt(pos, look, up) {
    this.useHeading = false;
    this.pos.copy(pos);
    this.vel.set(0, 0, 0);
    this.grounded = false;
    this.groundGrace = this.jumpBuffer = 0;
    const u = up ? up.clone() : new THREE.Vector3(0, 1, 0);
    tM.lookAt(pos, look, u);
    this.quat.setFromRotationMatrix(tM);
    this.syncRoot();
  }

  syncRoot() {
    this.root.position.copy(this.pos);
    this.root.quaternion.copy(this.quat);
    if (this.mode === 'ground' || this.pose > 0.5) {
      // on foot the body faces the way it is going (its heading), not where the camera looks
      const f = (this.useHeading && this.heading ? tD.copy(this.heading) : this.forward(tD)).projectOnPlane(this.up);
      if (f.lengthSq() > 1e-6) {
        tN.lookAt(tE.set(0, 0, 0), f.normalize(), this.up);
        this.root.quaternion.setFromRotationMatrix(tN);
      }
    }
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
    this.figure.position.y = -1.62 + 0.55;
    this.figure.rotation.x = 0.18;
    this.armR.rotation.x = 0.95;
    this.armL.rotation.x = 0.95;
    this.elbowL.rotation.x = this.elbowR.rotation.x = 0.45;
    this.legL.rotation.x = 1.35;
    this.legR.rotation.x = 1.35;
    this.legL.rotation.z = -0.28;
    this.legR.rotation.z = 0.28;
    this.kneeL.rotation.x = this.kneeR.rotation.x = -1.5;
    if (this.skin) {
      this.skin.setBase({ drive: 1 });
      this.skin.update(dt);
      this.figure.rotation.set(0, 0, 0);
      this.figure.position.y = -1.07 - this.skin.pelvisY();
    }
    this.aura.material.opacity = this.skin ? 0.02 : 0.12;
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
      this.groundGrace = this.grounded ? 0.1 : Math.max(0, this.groundGrace - dt);
      this.jumpBuffer = env.jump ? 0.12 : Math.max(0, this.jumpBuffer - dt);
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
      if (env.dodge) vH.copy(env.dodge.dir).projectOnPlane(up).normalize().multiplyScalar(env.dodge.speed);
      let vy = vUp - env.gravity * dt;
      if (!env.dodge && this.jumpBuffer > 0 && this.groundGrace > 0) {
        vy = env.jumpSpeed;
        this.grounded = false;
        this.groundGrace = this.jumpBuffer = 0;
      }
      this.vel.copy(vH).addScaledVector(up, vy);
    } else {
      this.groundGrace = this.jumpBuffer = 0;
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
      } else if (this.mode === 'ground' && D < min + 0.25 && this.vel.dot(up) <= 0) {
        this.grounded = true;
      }
    }

    // which way the body faces on foot: toward its movement, turning at a human pace; to the
    // camera's forward while fighting, guarding or aiming, or in first person
    this.faceAimT = Math.max(0, (this.faceAimT || 0) - dt);
    if (up && this.mode === 'ground') {
      const camF = this.forward(tE).projectOnPlane(up);
      if (camF.lengthSq() < 1e-6) camF.copy(this.localUp(tE)).negate().projectOnPlane(up);
      camF.normalize();
      if (!this.useHeading || !this.heading) { this.heading = (this.heading || new THREE.Vector3()).copy(camF); this.useHeading = true; this.turnRate = 0; }
      this.heading.projectOnPlane(up).normalize();
      const aim = env.faceAim || this.faceAimT > 0 || env.hidden;
      const vH = tC.copy(this.vel).addScaledVector(up, -this.vel.dot(up));
      let target = null;
      if (aim) target = camF;
      else if (vH.lengthSq() > 0.8 * 0.8) target = vH.normalize();
      if (target) {
        const ang = Math.atan2(tB.crossVectors(this.heading, target).dot(up), this.heading.dot(target));
        const rate = aim ? 16 : 7; // radians a second
        const step = THREE.MathUtils.clamp(ang, -rate * dt, rate * dt);
        this.heading.applyAxisAngle(up, step).projectOnPlane(up).normalize();
        this.turnRate = step / Math.max(dt, 1e-4);
      } else this.turnRate = (this.turnRate || 0) * Math.exp(-dt * 8);
    } else {
      this.useHeading = false;
      this.turnRate = 0;
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
    const gait = Math.min(1, speed / 6) * st;
    const sw = Math.sin(this.walkPhase), cw = Math.cos(this.walkPhase);
    const swing = sw * (0.42 + 0.18 * Math.min(1, speed / 14)) * gait;
    const L = THREE.MathUtils.lerp;
    // standing: hips at full leg height, a little lower mid-stride; sitting: hips on the ground
    const standY = -EYE + this.hipHeight - Math.abs(Math.cos(this.walkPhase)) * 0.03 * gait;
    this.figure.position.y = L(L(-0.45, standY, st), -EYE + 0.13, p);
    this.figure.rotation.x = L(L(-Math.PI / 2 + 0.15, 0, st), 0, p);
    // arms swing against the legs, elbows bend more on the forward swing
    this.armR.rotation.x = L(L(Math.PI - 0.15, swing, st), 0.28, p);
    this.armL.rotation.x = L(L(0.25, -swing, st), 0.28, p);
    this.armR.rotation.z = L(L(0, 0.08, st), 0.32, p);
    this.armL.rotation.z = L(L(0, -0.08, st), -0.32, p);
    this.elbowR.rotation.x = L(L(0.05, 0.18 + Math.max(0, swing) * 0.7, st), 0.22, p);
    this.elbowL.rotation.x = L(L(0.25, 0.18 + Math.max(0, -swing) * 0.7, st), 0.22, p);
    // legs: the trailing leg's knee folds as it lifts; cross-legged when sitting
    this.legL.rotation.x = L(L(0.08 + Math.sin(t * 3) * 0.06, -swing, st), 1.45, p);
    this.legR.rotation.x = L(L(-0.05 - Math.sin(t * 3) * 0.06, swing, st), 1.45, p);
    this.legL.rotation.z = L(0, -1.0, p);
    this.legR.rotation.z = L(0, 1.0, p);
    this.kneeL.rotation.x = L(L(-0.25, -(0.08 + Math.max(0, -cw) * 1.05) * gait - 0.04, st), -2.5, p);
    this.kneeR.rotation.x = L(L(-0.15, -(0.08 + Math.max(0, cw) * 1.05) * gait - 0.04, st), -2.5, p);
    if (this.skin) this.animate(dt, env, speed, f);
    this.syncRoot();
    // with the modelled body the aura only shows while cultivating; it washed the figure out otherwise
    this.aura.material.opacity = this.skin ? (0.02 + 0.22 * p) * (1 + 0.15 * Math.sin(t * 3)) : 0.18 + 0.08 * Math.sin(t * 3) + 0.3 * p;
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

  // Pick and blend the skinned model's animations from how the body is moving,
  // and lean and bank the whole figure in flight.
  animate(dt, env, speed, fwd) {
    const sk = this.skin;
    const up = env.up;
    const vUp = up ? this.vel.dot(up) : 0;
    const hs = up ? Math.sqrt(Math.max(0, speed * speed - vUp * vUp)) : speed;
    const ss = THREE.MathUtils.smoothstep;
    const clamp = THREE.MathUtils.clamp;
    const base = {}, rates = {};
    let tilt = 0, bankWant = 0;
    const airborne = this.mode === 'ground' && !this.grounded && this.groundGrace <= 0;
    if (airborne) this.airT = (this.airT || 0) + dt;
    if (env.dodge && !this.wasDodging && this.mode === 'ground') sk.play('roll', { speed: 2.2 });
    this.wasDodging = !!env.dodge;
    if (env.meditating) base.meditate = 1;
    else if (env.swimming) {
      if (hs > 1.2) { base.swim = 1; rates.swim = clamp(hs / 3, 0.7, 1.8); } else base.swim_idle = 1;
    } else if (this.mode === 'ground') {
      if (airborne) base.fall = 1;
      else {
        if (this.airT > 0.35 && sk.has('land')) sk.play('land', { speed: 2.2 });
        this.airT = 0;
        // idle, walk, jog and sprint crossfade by speed, each played at a rate that keeps the feet planted
        const w = {
          idle: 1 - ss(hs, 0.2, 1.0),
          walk: ss(hs, 0.2, 1.0) * (1 - ss(hs, 2.6, 4.2)),
          jog: ss(hs, 2.6, 4.2) * (1 - ss(hs, 7, 9.5)),
          sprint: ss(hs, 7, 9.5),
        };
        Object.assign(base, w);
        rates.walk = clamp(hs / 1.6, 0.6, 1.6);
        rates.jog = clamp(hs / 5.2, 0.7, 1.7);
        rates.sprint = clamp(hs / 10, 0.8, 2.2);
      }
    } else {
      // flight: hover when slow, stretch out to cruise, a fist forward at full speed
      const k = ss(hs, 3, 22);
      const d = this.boosting ? ss(hs, 25, 60) : ss(hs, 120, 400);
      base.fly_hover = 1 - k;
      base.fly_cruise = k * (1 - d);
      base.fly_dash = k * d;
      tilt = k * (Math.PI / 2 - 0.2);
      // bank into turns
      const h = tD.copy(fwd);
      if (up) h.projectOnPlane(up);
      if (this.prevFwd && h.lengthSq() > 1e-6) {
        h.normalize();
        const turn = Math.atan2(tE.crossVectors(this.prevFwd, h).dot(up || this.localUp(tE.clone())), this.prevFwd.dot(h));
        bankWant = clamp(-turn / Math.max(dt, 1e-3) * 0.35, -0.8, 0.8) * k;
      }
      this.prevFwd = (this.prevFwd || new THREE.Vector3()).copy(h.lengthSq() > 1e-6 ? h.normalize() : h);
    }
    sk.setBase(base, rates);
    sk.update(dt);
    const e = 1 - Math.exp(-dt * 5);
    this.tilt = (this.tilt || 0) + (tilt - (this.tilt || 0)) * e;
    this.bank = (this.bank || 0) + (bankWant - (this.bank || 0)) * (1 - Math.exp(-dt * 3));
    const f = this.tilt / (Math.PI / 2);
    this.figure.position.y = THREE.MathUtils.lerp(-EYE + this.hipHeight, -0.45, f);
    // on foot, a runner leans into the turn and a little forward when picking up speed
    const running = this.mode === 'ground' && !airborne ? THREE.MathUtils.smoothstep(hs, 2, 7) : 0;
    const leanWant = THREE.MathUtils.clamp(-(this.turnRate || 0) * hs * 0.018, -0.24, 0.24) * running;
    this.lean = (this.lean || 0) + (leanWant - (this.lean || 0)) * (1 - Math.exp(-dt * 6));
    const accel = this.lastHs !== undefined ? (hs - this.lastHs) / Math.max(dt, 1e-3) : 0;
    this.lastHs = hs;
    this.pitchLean = (this.pitchLean || 0) + (THREE.MathUtils.clamp(accel * 0.012, -0.08, 0.14) * running - (this.pitchLean || 0)) * (1 - Math.exp(-dt * 4));
    // lean forward, then roll about the body's own length (the axis the flight runs along)
    this.figure.rotation.set(-this.tilt - this.pitchLean, this.bank, this.lean, 'XYZ');
  }

  // A move the game just made: an attack, a technique, a hit taken.
  act(kind) {
    const sk = this.skin;
    if (!sk) return;
    const moves = {
      punch: [['punch_jab', 1.5], ['punch_cross', 1.4], ['punch_hook', 1.3]],
      saber: [['sword_a', 1.3], ['sword_b', 1.3]],
      thrust: [['sword_b', 1.4], ['punch_cross', 1.4]],
      knife: [['punch_jab', 1.7], ['sword_a', 1.6]],
      arrow: [['shoot', 1.6]],
      bolt: [['cast', 1.6]],
      spike: [['cast', 1.5]],
      heavy: [['sword_heavy', 1.5]],
      spell: [['cast', 1.3]],
      buff: [['consume', 1.6]],
      hit: [['hit', 1.4]],
      knockback: [['knockback', 1.5]],
    }[kind];
    if (!moves) return;
    const [name, speed] = moves[(this.combo = (this.combo || 0) + 1) % moves.length];
    // strike where you're looking: the body swings round to face it for a moment
    if (kind !== 'hit' && kind !== 'knockback') this.faceAimT = 0.9;
    // a stagger or a heavy move takes the whole body; attacks only the upper body
    sk.play(name, { speed, full: kind === 'knockback' || (kind === 'heavy' && this.mode === 'ground' && this.grounded) });
  }

  fall() { this.skin?.play('death', { full: true, hold: true, speed: 1.2 }); }

  revive() { this.skin?.stop(); }

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
