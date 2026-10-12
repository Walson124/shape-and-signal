import * as THREE from 'three';
import { buildSword } from '../world/models.js';
import { trailTexture } from '../world/textures.js';
import { SWORD_GRADES } from './data.js';
import { segPointDist } from './combat.js';

const Z = new THREE.Vector3(0, 0, 1);
const UP = new THREE.Vector3(0, 1, 0);
const TRAIL_N = 20;
const tA = new THREE.Vector3();
const tB = new THREE.Vector3();
const tC = new THREE.Vector3();
const tQ = new THREE.Quaternion();
const tM = new THREE.Matrix4();

function makeTrail(color) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(TRAIL_N * 2 * 3);
  const uv = new Float32Array(TRAIL_N * 2 * 2);
  const idx = [];
  for (let i = 0; i < TRAIL_N; i++) {
    const u = i / (TRAIL_N - 1);
    uv.set([u, 0, u, 1], i * 4);
    if (i < TRAIL_N - 1) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, c, b, b, c, d);
    }
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  const mat = new THREE.MeshBasicMaterial({ map: trailTexture(), color: new THREE.Color(color).multiplyScalar(1.8), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  return { mesh, geo, pos, mat, filled: false };
}

// The player's flying swords: guard, direct mind-control, homing launch,
// projectile interception and the Ten Thousand Swords storm.
export class SwordArray {
  constructor(scene, particles, combat, sound) {
    this.scene = scene;
    this.particles = particles;
    this.combat = combat;
    this.sound = sound;
    this.swords = [];
    this.phantoms = [];
    this.formation = 'swarm';
    this.controlling = false;
    this.controlDist = 140;
    this.controlPoint = new THREE.Vector3();
    this.grade = -1;
    this.count = 0;
    this.time = 0;
    this.avgSpeed = 0;
    this.phantomGeo = null;
    this.visible = true;
  }

  setup(count, grade) {
    if (count === this.count && grade === this.grade) return;
    const keepPos = this.swords.map((s) => s.pos.clone());
    for (const s of this.swords) this.disposeSword(s);
    this.swords = [];
    const g = SWORD_GRADES[grade];
    for (let i = 0; i < count; i++) {
      const model = buildSword(g);
      model.group.scale.setScalar(1.15);
      const trail = makeTrail(g.glow);
      this.scene.add(model.group, trail.mesh);
      this.swords.push({
        i, group: model.group, glowMat: model.glowMat, trail, glowBase: new THREE.Color(g.glow).multiplyScalar(1.8),
        pos: keepPos[i] ? keepPos[i] : new THREE.Vector3(), vel: new THREE.Vector3(), state: 'guard', target: null, shot: null,
        hits: new Map(), t: 0, interceptCd: 0, spawned: !keepPos[i],
      });
    }
    this.count = count;
    this.grade = grade;
    this.gradeDef = g;
  }

  disposeSword(s) {
    this.scene.remove(s.group, s.trail.mesh);
    s.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
    s.trail.geo.dispose();
    s.trail.mat.dispose();
  }

  setVisible(v) {
    this.visible = v;
    for (const s of this.swords) {
      s.group.visible = v;
      s.trail.mesh.visible = v;
    }
  }

  // Snap every sword to its guard slot (after warps / respawn).
  reset(player) {
    for (const s of this.swords) {
      s.state = 'guard';
      s.target = null;
      s.shot = null;
      this.guardSlot(s, player, s.pos);
      s.vel.set(0, 0, 0);
      s.trail.filled = false;
    }
  }

  toggleFormation() {
    this.formation = this.formation === 'swarm' ? 'lance' : 'swarm';
    this.sound.formation();
    return this.formation;
  }

  guardSlot(s, player, out) {
    const n = this.swords.length;
    const perSide = Math.ceil(n / 2);
    const side = s.i % 2 === 0 ? 1 : -1;
    const k = Math.floor(s.i / 2);
    const spread = perSide > 1 ? k / (perSide - 1) : 0.5;
    const ang = THREE.MathUtils.degToRad(52 + spread * 58);
    const R = 4.4 + spread * 1.0;
    // slots hang around the player in the plane of their local up
    const up = player.mode === 'space' ? player.localUp(tC) : tC.copy(player.up);
    const f = player.forward(tA);
    f.addScaledVector(up, -f.dot(up));
    if (f.lengthSq() < 1e-6) player.localUp(f).negate();
    f.normalize();
    const right = tB.crossVectors(f, up).normalize();
    const bob = Math.sin(this.time * 1.6 + s.i * 1.3) * 0.18;
    out.copy(player.pos)
      .addScaledVector(f, Math.cos(ang) * R)
      .addScaledVector(right, Math.sin(ang) * R * side)
      .addScaledVector(up, -0.9 + spread * 1.3 + bob);
    return out;
  }

  launch(targets, damage) {
    let k = 0;
    for (const s of this.swords) {
      if (s.state === 'seek') continue;
      s.state = 'seek';
      s.target = targets.length ? targets[k++ % targets.length] : null;
      s.t = 0;
      s.damage = damage;
      const out = tA.copy(s.pos).sub(this.anchor || s.pos).normalize();
      s.vel.addScaledVector(out, 80).addScaledVector(this.aimDir || Z, 140);
    }
    this.sound.swordLaunch();
  }

  storm(center, beasts, damage, color) {
    if (!this.phantomGeo) {
      const m = buildSword(SWORD_GRADES[0]);
      this.phantomGeo = m.group.children[0].geometry.clone();
      m.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    }
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2.2), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    const targets = beasts.filter((b) => b.pos.distanceTo(center) < 520);
    const n = 48;
    for (let i = 0; i < n; i++) {
      const target = targets.length ? targets[i % targets.length] : null;
      const aim = target ? target.pos.clone() : center.clone().add(new THREE.Vector3((Math.random() - 0.5) * 300, (Math.random() - 0.5) * 100, (Math.random() - 0.5) * 300));
      const start = aim.clone().add(new THREE.Vector3((Math.random() - 0.5) * 160, 220 + Math.random() * 120, (Math.random() - 0.5) * 160));
      const mesh = new THREE.Mesh(this.phantomGeo, mat);
      mesh.scale.setScalar(3.2);
      mesh.position.copy(start);
      mesh.visible = false;
      this.scene.add(mesh);
      this.phantoms.push({ mesh, target, aim, delay: i * 0.045, speed: 520 + Math.random() * 200, damage, mat, last: i === n - 1 });
    }
    this.sound.storm();
  }

  update(dt, ctx) {
    this.time += dt;
    const { player, camera, aimDir, aimTarget, beasts, hit, realm } = ctx;
    this.aimDir = aimDir;
    this.anchor = player.pos;
    const n = this.swords.length;
    const carry = tA.copy(player.vel).multiplyScalar(dt).clone();
    const target = new THREE.Vector3();
    const maxRange = 260 + 50 * realm;
    let speedSum = 0;

    if (this.controlling) {
      if (aimTarget) {
        const d = camera.position.distanceTo(aimTarget.pos);
        this.controlDist += (Math.min(maxRange, d) - this.controlDist) * (1 - Math.exp(-dt * 6));
      }
      if (ctx.wheel) this.controlDist = THREE.MathUtils.clamp(this.controlDist - ctx.wheel * 22, 25, maxRange);
      this.controlDist = Math.min(this.controlDist, maxRange);
      this.controlPoint.copy(camera.position).addScaledVector(aimDir, this.controlDist);
    }

    // auto-intercept incoming shots
    if (!this.controlling && ctx.enemyShots.length) {
      for (const shot of ctx.enemyShots) {
        if (shot.claimed) continue;
        const toP = tB.subVectors(player.pos, shot.pos);
        const d = toP.length();
        if (d > 70 || shot.vel.dot(toP) <= 0) continue;
        let best = null, bd = Infinity;
        for (const s of this.swords) {
          if (s.state !== 'guard' || s.interceptCd > 0) continue;
          const sd = s.pos.distanceTo(shot.pos);
          if (sd < bd) { bd = sd; best = s; }
        }
        if (!best) break;
        best.state = 'intercept';
        best.shot = shot;
        best.t = 0;
        shot.claimed = true;
      }
    }

    // frame for the swarm orbit around the control point
    const side = new THREE.Vector3().crossVectors(aimDir, UP).normalize();
    if (side.lengthSq() < 0.01) side.set(1, 0, 0);
    const up2 = new THREE.Vector3().crossVectors(side, aimDir).normalize();

    for (const s of this.swords) {
      s.interceptCd = Math.max(0, s.interceptCd - dt);
      s.t += dt;
      const prev = s.pos.clone();
      let stiff = 70, maxSpeed = 700, faceDir = null, cutting = false, dmgMult = 0;

      if (s.state !== 'seek') s.pos.add(carry);

      if (s.state === 'intercept') {
        if (!s.shot || !this.combat.shots.includes(s.shot) || s.t > 1.2) {
          s.state = 'return';
          s.shot = null;
        } else {
          target.copy(s.shot.pos);
          stiff = 400;
          maxSpeed = 1100;
          if (s.pos.distanceTo(s.shot.pos) < s.shot.radius + 2.2) {
            this.combat.destroyShot(s.shot);
            this.sound.intercept(s.pos);
            s.shot = null;
            s.state = 'return';
            s.interceptCd = Math.max(0.5, 1.6 - realm * 0.1);
          }
        }
      }

      if (this.controlling && (s.state === 'guard' || s.state === 'return')) s.state = 'control';
      if (!this.controlling && s.state === 'control') s.state = 'return';

      if (s.state === 'control') {
        cutting = true;
        if (this.formation === 'swarm') {
          const rad = 5 + n * 0.55;
          const th = this.time * 5.2 + (s.i / n) * Math.PI * 2;
          const tilt = Math.sin(this.time * 1.3 + s.i) * 0.6;
          target.copy(this.controlPoint)
            .addScaledVector(side, Math.cos(th) * rad)
            .addScaledVector(up2, Math.sin(th) * rad * (0.5 + tilt * 0.4))
            .addScaledVector(aimDir, Math.sin(th * 0.5 + s.i) * rad * 0.4);
          dmgMult = 0.55;
        } else {
          const back = s.i * 2.6;
          const wob = Math.sin(this.time * 9 + s.i) * 0.35;
          target.copy(this.controlPoint).addScaledVector(aimDir, -back).addScaledVector(side, wob).addScaledVector(up2, Math.cos(this.time * 9 + s.i) * 0.35);
          faceDir = aimDir;
          dmgMult = 0.75;
        }
        stiff = 160;
        maxSpeed = 1100;
      } else if (s.state === 'seek') {
        cutting = true;
        dmgMult = 0;
        if (!s.target || !s.target.alive) {
          s.target = null;
          let bd = 800;
          for (const b of beasts) {
            const d = b.pos.distanceTo(s.pos);
            if (d < bd) { bd = d; s.target = b; }
          }
        }
        const speed = Math.min(620, s.vel.length() + dt * 1400);
        const want = s.target ? tB.subVectors(s.target.pos, s.pos).normalize() : (s.vel.lengthSq() > 1 ? tB.copy(s.vel).normalize() : tB.copy(aimDir));
        const cur = s.vel.lengthSq() > 1 ? s.vel.clone().normalize() : want.clone();
        cur.lerp(want, 1 - Math.exp(-dt * 8)).normalize();
        s.vel.copy(cur).multiplyScalar(speed);
        s.pos.addScaledVector(s.vel, dt);
        if (s.target && segPointDist(prev, s.pos, s.target.pos) < s.target.radius + 1.5) {
          hit(s.target, s.damage, s.pos.clone(), 'sword', s.vel.clone().normalize().multiplyScalar(40));
          this.particles.burst(s.pos, s.glowBase, 22, 70, 0.9, 0.4, 3);
          this.sound.swordHit(s.pos);
          s.state = 'return';
          s.vel.multiplyScalar(-0.3);
        }
        if (s.t > 3.2 || s.pos.distanceTo(player.pos) > maxRange * 2.2) s.state = 'return';
      }

      if (s.state === 'guard' || s.state === 'return') {
        this.guardSlot(s, player, target);
        stiff = s.state === 'return' ? 40 : 90;
        maxSpeed = s.state === 'return' ? 800 : 400;
        faceDir = aimDir;
        if (s.state === 'return' && s.pos.distanceTo(target) < 2) s.state = 'guard';
      }

      if (s.state !== 'seek') {
        const damp = 2 * Math.sqrt(stiff) * 0.9;
        tB.subVectors(target, s.pos).multiplyScalar(stiff).addScaledVector(s.vel, -damp);
        s.vel.addScaledVector(tB, dt);
        const sp = s.vel.length();
        if (sp > maxSpeed) s.vel.multiplyScalar(maxSpeed / sp);
        s.pos.addScaledVector(s.vel, dt);
      }

      // blade contact damage while being steered
      if (cutting && dmgMult > 0) {
        for (const b of beasts) {
          if (!b.alive) continue;
          if (segPointDist(prev, s.pos, b.pos) < b.radius + 1.4) {
            const last = s.hits.get(b.uid) || -9;
            if (this.time - last > (this.formation === 'lance' ? 0.16 : 0.22)) {
              s.hits.set(b.uid, this.time);
              hit(b, ctx.swordDamage * dmgMult, s.pos.clone(), 'sword', s.vel.clone().normalize().multiplyScalar(18));
              this.particles.burst(s.pos, s.glowBase, 14, 60, 0.7, 0.3, 3);
              this.sound.swordHit(s.pos);
              s.vel.multiplyScalar(0.55);
            }
          }
        }
      }

      // orientation
      const sp = s.vel.length();
      speedSum += sp - player.vel.length() * (s.state === 'seek' ? 0 : 1);
      let dir = faceDir;
      if (!dir || sp > 140) dir = sp > 5 ? tB.copy(s.vel).normalize() : aimDir;
      tM.lookAt(tA.copy(s.pos).add(dir), s.pos, ctx.up || UP);
      tQ.setFromRotationMatrix(tM);
      if (s.spawned) {
        s.group.quaternion.copy(tQ);
        s.spawned = false;
      } else {
        s.group.quaternion.slerp(tQ, 1 - Math.exp(-dt * 14));
      }
      s.group.position.copy(s.pos);
      const glow = s.state === 'guard' ? 0.7 : 1.5;
      s.glowMat.color.copy(s.glowBase).multiplyScalar(glow);
      this.updateTrail(s, Math.max(0, sp - player.vel.length() * 0.8));
    }
    this.avgSpeed = n ? Math.max(0, speedSum / n) : 0;
    this.updatePhantoms(dt, hit);
  }

  updateTrail(s, relSpeed) {
    const tr = s.trail;
    const base = new THREE.Vector3(0, 0, 0.8).applyQuaternion(s.group.quaternion).add(s.pos);
    const tip = new THREE.Vector3(0, 0, 2.45).applyQuaternion(s.group.quaternion).add(s.pos);
    const p = tr.pos;
    if (!tr.filled) {
      for (let i = 0; i < TRAIL_N; i++) p.set([base.x, base.y, base.z, tip.x, tip.y, tip.z], i * 6);
      tr.filled = true;
    }
    p.copyWithin(0, 6);
    p.set([base.x, base.y, base.z, tip.x, tip.y, tip.z], (TRAIL_N - 1) * 6);
    tr.geo.attributes.position.needsUpdate = true;
    tr.mat.opacity = Math.min(1, relSpeed / 120);
  }

  updatePhantoms(dt, hit) {
    for (let i = this.phantoms.length - 1; i >= 0; i--) {
      const ph = this.phantoms[i];
      if (ph.delay > 0) {
        ph.delay -= dt;
        if (ph.delay <= 0) ph.mesh.visible = true;
        continue;
      }
      const aim = ph.target && ph.target.alive ? ph.target.pos : ph.aim;
      const dir = tA.subVectors(aim, ph.mesh.position);
      const d = dir.length();
      dir.divideScalar(Math.max(d, 0.001));
      const step = ph.speed * dt;
      tM.lookAt(tB.copy(ph.mesh.position).add(dir), ph.mesh.position, UP);
      ph.mesh.quaternion.setFromRotationMatrix(tM);
      if (Math.random() < 0.7) this.particles.emit(ph.mesh.position.x, ph.mesh.position.y, ph.mesh.position.z, 0, 0, 0, ph.mat.color, 1.4, 0.3, 0, 0.5);
      if (d <= step + (ph.target ? ph.target.radius : 2)) {
        if (ph.target && ph.target.alive) hit(ph.target, ph.damage, ph.mesh.position.clone(), 'storm', dir.clone().multiplyScalar(30));
        this.particles.burst(ph.mesh.position, ph.mat.color, 18, 80, 1.2, 0.5, 3);
        if (Math.random() < 0.4) this.sound.swordHit(ph.mesh.position);
        this.scene.remove(ph.mesh);
        if (ph.last) ph.mat.dispose();
        this.phantoms.splice(i, 1);
      } else {
        ph.mesh.position.addScaledVector(dir, step);
      }
    }
  }

  rebase(m, q) {
    for (const s of this.swords) {
      s.pos.applyMatrix4(m);
      s.vel.applyQuaternion(q);
      s.group.position.copy(s.pos);
      s.group.quaternion.premultiply(q);
      s.trail.filled = false;
    }
    for (const ph of this.phantoms) {
      ph.mesh.position.applyMatrix4(m);
      ph.aim.applyMatrix4(m);
    }
    this.controlPoint.applyMatrix4(m);
  }

  clearPhantoms() {
    const mats = new Set();
    for (const ph of this.phantoms) {
      this.scene.remove(ph.mesh);
      mats.add(ph.mat);
    }
    mats.forEach((m) => m.dispose());
    this.phantoms = [];
  }

  states() {
    return this.swords.map((s) => s.state);
  }
}
