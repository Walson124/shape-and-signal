import * as THREE from 'three';
import { glowTexture } from './textures.js';

const Z = new THREE.Vector3(0, 0, 1);
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const tmpC = new THREE.Vector3();

// Distance from point p to segment ab.
export function segPointDist(a, b, p) {
  tmpA.subVectors(b, a);
  tmpB.subVectors(p, a);
  const len2 = tmpA.lengthSq();
  const t = len2 > 0 ? Math.max(0, Math.min(1, tmpB.dot(tmpA) / len2)) : 0;
  tmpC.copy(a).addScaledVector(tmpA, t);
  return tmpC.distanceTo(p);
}

// Projectiles and visual effects for both sides of a fight.
export class Combat {
  constructor(scene, particles, sound) {
    this.scene = scene;
    this.particles = particles;
    this.sound = sound;
    this.shots = [];
    this.effects = [];
    this.boltGeo = new THREE.CylinderGeometry(0.28, 0.28, 1, 6).rotateX(Math.PI / 2);
    this.bladeGeo = new THREE.OctahedronGeometry(1, 0).scale(0.38, 0.1, 2.4);
    this.orbGeo = new THREE.SphereGeometry(1, 12, 8);
    this.mats = new Map();
    this.spriteMats = new Map();
    this._c = new THREE.Color();
  }

  mat(hex, mul = 3) {
    const k = `${hex}:${mul}`;
    if (!this.mats.has(k)) this.mats.set(k, new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(mul) }));
    return this.mats.get(k);
  }

  spriteMat(hex, mul = 1) {
    const k = `${hex}:${mul}`;
    if (!this.spriteMats.has(k)) {
      this.spriteMats.set(k, new THREE.SpriteMaterial({ map: glowTexture(), color: new THREE.Color(hex).multiplyScalar(mul), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    }
    return this.spriteMats.get(k);
  }

  addShot(shot) {
    shot.group = new THREE.Group();
    shot.group.position.copy(shot.pos);
    if (shot.mesh) shot.group.add(shot.mesh);
    if (shot.glow) shot.group.add(shot.glow);
    this.scene.add(shot.group);
    this.shots.push(shot);
    return shot;
  }

  firePlayerBolt(origin, dir, damage, color, speed = 640) {
    const mesh = new THREE.Mesh(this.boltGeo, this.mat(color, 3));
    mesh.scale.set(1, 1, 8);
    mesh.quaternion.setFromUnitVectors(Z, dir);
    const glow = new THREE.Sprite(this.spriteMat(color, 1.2));
    glow.scale.setScalar(5);
    this.addShot({ kind: 'bolt', owner: 'player', pos: origin.clone(), vel: dir.clone().multiplyScalar(speed), life: 2.4, damage, radius: 1.2, color: new THREE.Color(color), mesh, glow });
  }

  launchSword(origin, dir, damage, target, delay) {
    const mesh = new THREE.Mesh(this.bladeGeo, this.mat(0xffe7a0, 3.2));
    mesh.scale.setScalar(1.3);
    const glow = new THREE.Sprite(this.spriteMat(0xffc860, 1));
    glow.scale.setScalar(6);
    this.addShot({ kind: 'sword', owner: 'player', pos: origin.clone(), vel: dir.clone().multiplyScalar(140), life: 4.5, damage, radius: 2.2, color: new THREE.Color(1.6, 1.3, 0.6), mesh, glow, target, delay, speed: 380 });
  }

  enemyShot(origin, dir, speed, damage, color, size = 1.6) {
    const mesh = new THREE.Mesh(this.orbGeo, this.mat(color, 2.4));
    mesh.scale.setScalar(size);
    const glow = new THREE.Sprite(this.spriteMat(color, 1));
    glow.scale.setScalar(size * 6);
    this.addShot({ kind: 'orb', owner: 'enemy', pos: origin.clone(), vel: dir.clone().normalize().multiplyScalar(speed), life: 4.5, damage, radius: size * 1.1, color: new THREE.Color(color).multiplyScalar(1.5), mesh, glow });
    this.sound.enemyShot();
  }

  removeShot(i) {
    const s = this.shots[i];
    this.scene.remove(s.group);
    this.shots.splice(i, 1);
  }

  clearShots() {
    for (let i = this.shots.length - 1; i >= 0; i--) this.removeShot(i);
    for (const e of this.effects) this.disposeEffect(e);
    this.effects = [];
  }

  // ---------------------------------------------------------- effects --
  addEffect(obj, life, update, owned = true) {
    this.scene.add(obj);
    const e = { obj, life, maxLife: life, update, owned };
    this.effects.push(e);
    return e;
  }

  disposeEffect(e) {
    this.scene.remove(e.obj);
    if (!e.owned) return;
    e.obj.traverse((o) => {
      if (o.geometry && o.geometry !== this.orbGeo) o.geometry.dispose();
      if (o.material && !o.isSprite) o.material.dispose();
    });
  }

  shockwave(pos, radius, color, duration = 0.55) {
    const c = new THREE.Color(color);
    const shell = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 12), new THREE.MeshBasicMaterial({ color: c.clone().multiplyScalar(0.8), transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, wireframe: true }));
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.03, 6, 64), new THREE.MeshBasicMaterial({ color: c.clone().multiplyScalar(3), transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false }));
    ring.rotation.x = Math.PI / 2;
    const g = new THREE.Group();
    g.add(shell, ring);
    g.position.copy(pos);
    this.addEffect(g, duration, (e) => {
      const f = 1 - e.life / e.maxLife;
      const s = radius * (1 - Math.pow(1 - f, 3));
      g.scale.setScalar(Math.max(0.01, s));
      shell.material.opacity = 0.12 * (1 - f);
      ring.material.opacity = 1 - f;
    });
    this.particles.burst(pos, c.clone().multiplyScalar(1.4), 60, radius * 1.6, 1.6, 0.7, 2.5);
  }

  flash(pos, color, size, duration = 0.35) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: new THREE.Color(color).multiplyScalar(2), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    sp.position.copy(pos);
    sp.scale.setScalar(size);
    this.addEffect(sp, duration, (e) => {
      const f = e.life / e.maxLife;
      sp.material.opacity = f;
      sp.scale.setScalar(size * (1.3 - 0.3 * f));
    }, false);
    // sprite material is per-flash: dispose it explicitly
    const last = this.effects[this.effects.length - 1];
    last.disposeMat = sp.material;
  }

  explosion(pos, color, scale = 1) {
    const c = new THREE.Color(color);
    this.particles.burst(pos, c.clone().multiplyScalar(2), Math.round(40 * Math.min(4, scale)), 60 * scale, 2.4 * scale, 0.9, 1.8);
    this.particles.burst(pos, new THREE.Color(2, 1.8, 1.5), Math.round(16 * Math.min(4, scale)), 30 * scale, 1.5 * scale, 0.5, 2);
    this.flash(pos, color, 26 * scale, 0.4);
  }

  // Jagged lightning from the sky to a point.
  lightning(target, color = 0xc8b8ff, height = 420) {
    const pts = [];
    const top = target.clone().add(new THREE.Vector3((Math.random() - 0.5) * 60, height, (Math.random() - 0.5) * 60));
    const n = 14;
    for (let i = 0; i <= n; i++) {
      const p = top.clone().lerp(target, i / n);
      if (i > 0 && i < n) p.add(new THREE.Vector3((Math.random() - 0.5) * 26, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 26));
      pts.push(p);
    }
    const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.1);
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(4), transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false });
    const bolt = new THREE.Mesh(new THREE.TubeGeometry(curve, 60, 2.2, 5, false), mat);
    this.addEffect(bolt, 0.35, (e) => {
      mat.opacity = (e.life / e.maxLife) * (Math.random() < 0.3 ? 0.4 : 1);
    });
    this.flash(target, color, 40, 0.35);
    this.particles.burst(target, new THREE.Color(color).multiplyScalar(2.5), 70, 120, 3, 0.7, 2);
  }

  // A pulsing red sphere marking where tribulation lightning will land.
  warning(pos, radius, duration) {
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 0.25, 0.3), transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false, wireframe: true });
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(radius, 2), mat);
    m.position.copy(pos);
    return this.addEffect(m, duration, (e) => {
      const f = 1 - e.life / e.maxLife;
      mat.opacity = 0.15 + 0.5 * f * (0.6 + 0.4 * Math.sin(f * 40));
      m.scale.setScalar(1.25 - 0.25 * f);
      m.rotation.y += 0.05;
    });
  }

  // ----------------------------------------------------------- update --
  update(dt, ctx) {
    const { beasts, player, system } = ctx;
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const s = this.shots[i];
      s.life -= dt;
      if (s.life <= 0) {
        this.removeShot(i);
        continue;
      }
      if (s.kind === 'sword') {
        if (s.delay > 0) {
          s.delay -= dt;
          s.vel.multiplyScalar(Math.max(0, 1 - dt * 2.5));
        } else {
          if (!s.target || !s.target.alive) {
            let best = null, bd = 1100;
            for (const b of beasts) {
              const d = b.pos.distanceTo(s.pos);
              if (d < bd) { bd = d; best = b; }
            }
            s.target = best;
          }
          const want = tmpA.copy(s.vel).normalize();
          if (s.target) want.subVectors(s.target.pos, s.pos).normalize();
          const cur = tmpB.copy(s.vel).normalize();
          cur.lerp(want, 1 - Math.exp(-dt * 9)).normalize();
          s.vel.copy(cur).multiplyScalar(Math.min(s.speed, s.vel.length() + dt * 900));
        }
        if (s.vel.lengthSq() > 0.01) s.mesh.quaternion.setFromUnitVectors(Z, tmpC.copy(s.vel).normalize());
        if (Math.random() < 0.8) this.particles.emit(s.pos.x, s.pos.y, s.pos.z, 0, 0, 0, s.color, 1.4, 0.35, 0, 0.5);
      }
      const prev = tmpC.copy(s.pos);
      const prevPos = prev.clone();
      s.pos.addScaledVector(s.vel, dt);
      s.group.position.copy(s.pos);

      let dead = false;
      if (s.owner === 'player') {
        for (const b of beasts) {
          if (!b.alive) continue;
          if (segPointDist(prevPos, s.pos, b.pos) < b.radius + s.radius) {
            ctx.hitBeast(b, s.damage, s.pos.clone(), s.kind);
            this.particles.burst(s.pos, s.color, 10, 50, 1.4, 0.35, 3);
            dead = true;
            break;
          }
        }
      } else if (ctx.playerAlive) {
        if (segPointDist(prevPos, s.pos, player.pos) < player.radius + s.radius) {
          ctx.hurtPlayer(s.damage, s.pos.clone());
          this.particles.burst(s.pos, s.color, 14, 40, 1.6, 0.4, 3);
          dead = true;
        }
      }
      if (!dead && system) {
        for (const c of system.colliders) {
          if (s.pos.distanceToSquared(c.pos) < c.radius * c.radius) {
            dead = true;
            this.particles.burst(s.pos, s.color, 6, 30, 1.2, 0.3, 3);
            break;
          }
        }
      }
      if (dead) this.removeShot(i);
    }

    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i];
      e.life -= dt;
      if (e.life <= 0) {
        this.disposeEffect(e);
        if (e.disposeMat) e.disposeMat.dispose();
        this.effects.splice(i, 1);
        continue;
      }
      if (e.update) e.update(e, dt);
    }
  }
}
