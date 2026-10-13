import * as THREE from 'three';
import { glowTexture } from '../world/textures.js';

const Z = new THREE.Vector3(0, 0, 1);
const tA = new THREE.Vector3();
const tB = new THREE.Vector3();
const tC = new THREE.Vector3();

export function segPointDist(a, b, p) {
  tA.subVectors(b, a);
  tB.subVectors(p, a);
  const len2 = tA.lengthSq();
  const t = len2 > 0 ? Math.max(0, Math.min(1, tB.dot(tA) / len2)) : 0;
  tC.copy(a).addScaledVector(tA, t);
  return tC.distanceTo(p);
}

// Projectiles and visual effects.
export class Combat {
  constructor(scene, particles, sound) {
    this.scene = scene;
    this.particles = particles;
    this.sound = sound;
    this.shots = [];
    this.effects = [];
    this.debrisList = [];
    this.boltGeo = new THREE.CylinderGeometry(0.22, 0.22, 1, 6).rotateX(Math.PI / 2);
    this.orbGeo = new THREE.SphereGeometry(1, 14, 10);
    this.debrisGeo = new THREE.TetrahedronGeometry(1, 0);
    this.mats = new Map();
    this.spriteMats = new Map();
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

  firePlayerBolt(origin, dir, damage, color, speed = 700, opts = {}) {
    const size = opts.size || 1;
    const mesh = new THREE.Mesh(this.boltGeo, this.mat(color, 3.5));
    mesh.scale.set(size, size, 9 * size);
    mesh.quaternion.setFromUnitVectors(Z, dir);
    const glow = new THREE.Sprite(this.spriteMat(color, 1.1));
    glow.scale.setScalar(4.5 * size);
    this.addShot({ kind: 'bolt', owner: 'player', pos: origin.clone(), vel: dir.clone().multiplyScalar(speed), life: 2.2, damage, radius: 1.3 * size, color: new THREE.Color(color).multiplyScalar(1.4), mesh, glow, pierce: opts.pierce || 0, hitSet: new Set() });
  }

  // A crescent of light that cuts through everything along its path.
  fireWave(origin, dir, up, damage, color, opts = {}) {
    const width = opts.width || 10;
    const geo = new THREE.RingGeometry(width * 0.42, width * 0.5, 24, 1, -Math.PI * 0.42, Math.PI * 0.84);
    geo.rotateZ(Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(3), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat);
    // the arc faces forward, spanning sideways across the travel direction
    const side = new THREE.Vector3().crossVectors(dir, up).normalize();
    const u = new THREE.Vector3().crossVectors(side, dir).normalize();
    const m = new THREE.Matrix4().makeBasis(side, u, dir.clone().negate());
    mesh.quaternion.setFromRotationMatrix(m);
    if (opts.vertical) mesh.rotateZ(Math.PI / 2);
    const glow = new THREE.Sprite(this.spriteMat(color, 0.9));
    glow.scale.setScalar(width * 0.8);
    this.addShot({
      kind: opts.kind || 'wave', owner: 'player', pos: origin.clone(), vel: dir.clone().multiplyScalar(opts.speed || 260), life: opts.life || 0.9, damage,
      radius: width * 0.45, color: new THREE.Color(color).multiplyScalar(1.6), mesh, glow, pierce: 999, hitSet: new Set(), ownMat: mat, ownGeo: geo, fade: true,
    });
  }

  // Instant beam drawn between two points (hit-scan attacks).
  beam(a, b, color, width = 0.6, life = 0.25) {
    const len = a.distanceTo(b);
    const geo = new THREE.CylinderGeometry(width, width * 0.4, len, 6, 1, true).rotateX(Math.PI / 2).translate(0, 0, len / 2);
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(3), transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(a);
    mesh.lookAt(b);
    this.addEffect(mesh, life, (e) => {
      const k = e.life / e.maxLife;
      mat.opacity = k;
      mesh.scale.set(k * 1.4, k * 1.4, 1);
    });
    this.particles.burst(b, new THREE.Color(color).multiplyScalar(2), 10, 30, 0.8, 0.3, 3);
  }

  // A sweeping arc in front of the attacker for melee cuts.
  slash(pos, dir, up, radius, color, flip = false) {
    const geo = new THREE.RingGeometry(radius * 0.55, radius, 28, 1, -Math.PI * 0.45, Math.PI * 0.9);
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2.6), transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat);
    const side = new THREE.Vector3().crossVectors(dir, up).normalize();
    const u = new THREE.Vector3().crossVectors(side, dir).normalize();
    // lie the arc in the plane of the swing, opening toward dir
    const m = new THREE.Matrix4().makeBasis(dir.clone(), side.clone().multiplyScalar(flip ? -1 : 1), u.clone());
    mesh.quaternion.setFromRotationMatrix(m);
    mesh.rotateX(flip ? 0.5 : -0.5);
    mesh.position.copy(pos);
    this.addEffect(mesh, 0.22, (e) => {
      const k = e.life / e.maxLife;
      mat.opacity = k;
      mesh.rotateZ((flip ? 1 : -1) * 0.12);
    });
  }

  enemyShot(origin, dir, speed, damage, color, size = 1.6) {
    const mesh = new THREE.Mesh(this.orbGeo, this.mat(color, 2.6));
    mesh.scale.setScalar(size);
    const glow = new THREE.Sprite(this.spriteMat(color, 1));
    glow.scale.setScalar(size * 6);
    this.addShot({ kind: 'orb', owner: 'enemy', pos: origin.clone(), vel: dir.clone().normalize().multiplyScalar(speed), life: 4.5, damage, radius: size * 1.1, color: new THREE.Color(color).multiplyScalar(1.5), mesh, glow });
    this.sound.enemyShot(origin);
  }

  rebase(m, q) {
    for (const s of this.shots) {
      s.pos.applyMatrix4(m);
      s.vel.applyQuaternion(q);
      s.group.position.copy(s.pos);
      if (s.mesh) s.mesh.quaternion.premultiply(q);
    }
    for (const e of this.effects) e.obj.applyMatrix4(m);
    for (const d of this.debrisList) {
      d.mesh.position.applyMatrix4(m);
      d.vel.applyQuaternion(q);
    }
  }

  get enemyShots() {
    return this.shots.filter((s) => s.owner === 'enemy');
  }

  destroyShot(shot) {
    const i = this.shots.indexOf(shot);
    if (i >= 0) {
      this.particles.burst(shot.pos, shot.color, 16, 60, 0.9, 0.35, 3);
      this.removeShot(i);
    }
  }

  removeShot(i) {
    const s = this.shots[i];
    this.scene.remove(s.group);
    if (s.ownMat) s.ownMat.dispose();
    if (s.ownGeo) s.ownGeo.dispose();
    this.shots.splice(i, 1);
  }

  clear() {
    for (let i = this.shots.length - 1; i >= 0; i--) this.removeShot(i);
    for (const e of this.effects) this.disposeEffect(e);
    this.effects = [];
    for (const d of this.debrisList) this.scene.remove(d.mesh);
    this.debrisList = [];
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
    if (e.disposeMat) e.disposeMat.dispose();
    if (!e.owned) return;
    e.obj.traverse((o) => {
      if (o.geometry && o.geometry !== this.orbGeo) o.geometry.dispose();
      if (o.material && !o.isSprite) o.material.dispose();
    });
  }

  shockwave(pos, radius, color, duration = 0.6) {
    const c = new THREE.Color(color);
    const shell = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), new THREE.ShaderMaterial({
      uniforms: { color: { value: c.clone().multiplyScalar(1.6) }, fade: { value: 1 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      vertexShader: /* glsl */ `
        varying vec3 vN;
        varying vec3 vV;
        void main() {
          vN = normalize(normalMatrix * normal);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vV = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 color;
        uniform float fade;
        varying vec3 vN;
        varying vec3 vV;
        void main() {
          float f = pow(clamp(1.0 - abs(dot(vN, vV)), 0.0, 1.0), 3.0);
          gl_FragColor = vec4(color * f * fade, 1.0);
        }`,
    }));
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.02, 6, 96), new THREE.MeshBasicMaterial({ color: c.clone().multiplyScalar(3), transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false }));
    ring.rotation.x = Math.PI / 2;
    const g = new THREE.Group();
    g.add(shell, ring);
    g.position.copy(pos);
    this.addEffect(g, duration, (e) => {
      const f = 1 - e.life / e.maxLife;
      g.scale.setScalar(Math.max(0.01, radius * (1 - Math.pow(1 - f, 3))));
      shell.material.uniforms.fade.value = 1 - f;
      ring.material.opacity = 1 - f;
    });
    this.particles.burst(pos, c.clone().multiplyScalar(1.4), 60, radius * 1.5, 1.4, 0.7, 2.5);
  }

  flash(pos, color, size, duration = 0.35) {
    const mat = new THREE.SpriteMaterial({ map: glowTexture(), color: new THREE.Color(color).multiplyScalar(2), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    const sp = new THREE.Sprite(mat);
    sp.position.copy(pos);
    sp.scale.setScalar(size);
    const e = this.addEffect(sp, duration, (ef) => {
      const f = ef.life / ef.maxLife;
      mat.opacity = f;
      sp.scale.setScalar(size * (1.3 - 0.3 * f));
    }, false);
    e.disposeMat = mat;
  }

  explosion(pos, color, scale = 1) {
    const c = new THREE.Color(color);
    const s = Math.min(4, scale);
    this.particles.burst(pos, c.clone().multiplyScalar(2), Math.round(45 * s), 70 * scale, 1.8 * scale, 1.0, 1.8);
    this.particles.burst(pos, new THREE.Color(2, 1.8, 1.5), Math.round(20 * s), 35 * scale, 1.2 * scale, 0.5, 2);
    this.particles.burst(pos, new THREE.Color(0.25, 0.22, 0.3), Math.round(14 * s), 25 * scale, 3 * scale, 1.6, 1.2);
    this.flash(pos, color, 26 * scale, 0.45);
  }

  // Tumbling shards from a destroyed beast.
  debris(pos, color, count, size) {
    const mat = this.mat(color, 1.6);
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(this.debrisGeo, mat);
      m.position.copy(pos);
      m.scale.setScalar(size * (0.3 + Math.random() * 0.7));
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(20 + Math.random() * 60);
      this.scene.add(m);
      this.debrisList.push({ mesh: m, vel: v, spin: new THREE.Vector3(Math.random() * 6, Math.random() * 6, Math.random() * 6), life: 1.2 + Math.random() * 1.2, s0: m.scale.x });
    }
  }

  lightning(target, color = 0xc8b8ff, height = 420, up = new THREE.Vector3(0, 1, 0)) {
    const pts = [];
    const top = target.clone().addScaledVector(up, height).add(new THREE.Vector3((Math.random() - 0.5) * 60, (Math.random() - 0.5) * 60, (Math.random() - 0.5) * 60));
    const n = 16;
    for (let i = 0; i <= n; i++) {
      const p = top.clone().lerp(target, i / n);
      if (i > 0 && i < n) p.add(new THREE.Vector3((Math.random() - 0.5) * 28, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 28));
      pts.push(p);
    }
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(4), transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false });
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.1), 80, 2.2, 5, false), mat));
    for (let f = 0; f < 3; f++) {
      let p = pts[3 + Math.floor(Math.random() * 10)].clone();
      const fp = [p.clone()];
      for (let k = 0; k < 5; k++) {
        p = p.clone().add(new THREE.Vector3((Math.random() - 0.5) * 40, (Math.random() - 0.5) * 40, (Math.random() - 0.5) * 40)).addScaledVector(up, -20 - Math.random() * 20);
        fp.push(p);
      }
      g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(fp), 20, 0.9, 4, false), mat));
    }
    this.addEffect(g, 0.4, (e) => {
      mat.opacity = (e.life / e.maxLife) * (Math.random() < 0.3 ? 0.35 : 1);
    });
    this.flash(target, color, 40, 0.35);
    this.particles.burst(target, new THREE.Color(color).multiplyScalar(2.5), 70, 120, 1.6, 0.7, 2);
  }

  warning(pos, radius, duration) {
    const g = new THREE.Group();
    const fill = new THREE.Mesh(new THREE.SphereGeometry(radius, 24, 16), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 0.1, 0.2), transparent: true, opacity: 0.08, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    const wire = new THREE.Mesh(new THREE.IcosahedronGeometry(radius, 1), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 0.25, 0.3), transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false, wireframe: true }));
    const core = new THREE.Mesh(new THREE.SphereGeometry(1.2, 10, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.6, 0.6) }));
    g.add(fill, wire, core);
    g.position.copy(pos);
    return this.addEffect(g, duration, (e) => {
      const f = 1 - e.life / e.maxLife;
      wire.material.opacity = 0.12 + 0.4 * f * (0.6 + 0.4 * Math.sin(f * 40));
      fill.material.opacity = 0.05 + 0.12 * f;
      wire.rotation.y += 0.05;
      g.scale.setScalar(1.2 - 0.2 * f);
    });
  }

  // ----------------------------------------------------------- update --
  update(dt, ctx) {
    const { beasts, player, system } = ctx;
    const prevPos = new THREE.Vector3();
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const s = this.shots[i];
      s.life -= dt;
      if (s.life <= 0) {
        this.removeShot(i);
        continue;
      }
      prevPos.copy(s.pos);
      s.pos.addScaledVector(s.vel, dt);
      s.group.position.copy(s.pos);
      if (Math.random() < 0.6) this.particles.emit(s.pos.x, s.pos.y, s.pos.z, 0, 0, 0, s.color, s.owner === 'player' ? 0.6 : 1.2, 0.25, 0, 0.5);

      let dead = false;
      if (s.owner === 'player' && (s.kind === 'wave' || s.kind === 'heaven') && ctx.breakAt) ctx.breakAt(s.pos, s.radius * 0.7, s.vel.clone().normalize());
      if (s.fade && s.ownMat) {
        s.ownMat.opacity = Math.min(0.9, s.life * 3);
        s.mesh.scale.setScalar(1 + (1 - s.life) * 0.3);
      }
      if (s.owner === 'player') {
        for (const b of [...beasts]) {
          if (!b.alive || (s.hitSet && s.hitSet.has(b))) continue;
          if (segPointDist(prevPos, s.pos, b.pos) < b.radius + s.radius) {
            ctx.hitBeast(b, s.damage, s.pos.clone(), s.kind, s.vel.clone().normalize().multiplyScalar(15));
            this.particles.burst(s.pos, s.color, 12, 50, 0.8, 0.35, 3);
            if (s.hitSet) s.hitSet.add(b);
            if (!s.pierce || s.hitSet.size > s.pierce) { dead = true; break; }
          }
        }
      } else if (ctx.playerAlive && segPointDist(prevPos, s.pos, player.pos) < player.radius + s.radius) {
        const res = ctx.hurtPlayer(s.damage, s.pos.clone(), s);
        if (res === 'reflect') {
          // turned aside: the shot flies back at the beasts
          s.owner = 'player';
          s.vel.negate();
          s.pos.addScaledVector(s.vel, 0.03);
          s.hitSet = new Set();
          s.pierce = 0;
          s.damage *= 2.5;
          s.life = 2;
          this.particles.burst(s.pos, s.color, 18, 50, 1, 0.3, 3);
          continue;
        }
        this.particles.burst(s.pos, s.color, 14, 40, 1.2, 0.4, 3);
        dead = true;
      }
      if (!dead && s.kind !== 'wave' && s.kind !== 'heaven' && ctx.solid && ctx.solid(s.pos)) {
        dead = true;
        if (s.owner === 'player' && ctx.breakAt) {
          ctx.breakAt(s.pos, 2.5 * (s.radius || 1), s.vel.clone().normalize());
          if (ctx.scorch) ctx.scorch(s.pos, 1.6 + s.radius);
        }
        this.particles.burst(s.pos, s.color, 8, 30, 1, 0.3, 3);
      }
      if (dead) this.removeShot(i);
    }

    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i];
      e.life -= dt;
      if (e.life <= 0) {
        this.disposeEffect(e);
        this.effects.splice(i, 1);
        continue;
      }
      if (e.update) e.update(e, dt);
    }

    for (let i = this.debrisList.length - 1; i >= 0; i--) {
      const d = this.debrisList[i];
      d.life -= dt;
      if (d.life <= 0) {
        this.scene.remove(d.mesh);
        this.debrisList.splice(i, 1);
        continue;
      }
      d.mesh.position.addScaledVector(d.vel, dt);
      d.vel.multiplyScalar(1 - dt * 0.6);
      d.mesh.rotation.x += d.spin.x * dt;
      d.mesh.rotation.y += d.spin.y * dt;
      d.mesh.scale.setScalar(d.s0 * Math.min(1, d.life / 0.6));
    }
  }
}
