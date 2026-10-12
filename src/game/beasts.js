import * as THREE from 'three';
import { BEASTS, BOSSES, power } from './data.js';
import { glowTexture } from './textures.js';

const UP = new THREE.Vector3(0, 1, 0);
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();

function emissiveMat(color, intensity = 0.8, base = 0x15121c, extra = {}) {
  return new THREE.MeshStandardMaterial({ color: base, emissive: new THREE.Color(color), emissiveIntensity: intensity, roughness: 0.5, metalness: 0.3, flatShading: true, ...extra });
}
function glowMat(color, mul = 3) {
  return new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(mul) });
}

// ------------------------------------------------------------ models --
function buildMite(color) {
  const g = new THREE.Group();
  const body = emissiveMat(color, 0.5, 0x221830);
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(1.6, 0), body);
  g.add(core);
  const spikeMat = emissiveMat(color, 1.2, 0x2a1840);
  const dirs = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0.6, 0.3, -0.8], [-0.6, 0.3, -0.8]];
  for (const d of dirs) {
    const s = new THREE.Mesh(new THREE.ConeGeometry(0.35, 1.9, 5), spikeMat);
    const v = new THREE.Vector3(...d).normalize();
    s.position.copy(v).multiplyScalar(1.8);
    s.quaternion.setFromUnitVectors(UP, v);
    g.add(s);
  }
  const eye = glowMat(0xff4a6a, 4);
  for (const x of [-0.55, 0.55]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 6), eye);
    e.position.set(x, 0.3, 1.35);
    g.add(e);
  }
  return { group: g, flash: [body, spikeMat], anim: (t) => { core.rotation.z = t * 3; } };
}

function buildRay(color) {
  const g = new THREE.Group();
  const body = emissiveMat(color, 0.35, 0x0c1a2a, { flatShading: false });
  const b = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 12), body);
  b.scale.set(3.4, 0.7, 3.0);
  g.add(b);
  const wingMat = emissiveMat(color, 0.9, 0x0c2236, { side: THREE.DoubleSide, flatShading: false });
  const wingGeo = new THREE.BufferGeometry();
  wingGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 2.2, 0, 0, -1.8, 6.5, 0, -0.6], 3));
  wingGeo.computeVertexNormals();
  const wl = new THREE.Mesh(wingGeo, wingMat);
  const wr = new THREE.Mesh(wingGeo, wingMat);
  wr.scale.x = -1;
  wl.position.x = 2.4;
  wr.position.x = -2.4;
  g.add(wl, wr);
  const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.35, 8, 6).rotateX(Math.PI / 2), emissiveMat(color, 1.2));
  tail.position.z = -6.5;
  g.add(tail);
  const spot = glowMat(color, 3);
  for (let i = 0; i < 5; i++) {
    const s = new THREE.Mesh(new THREE.SphereGeometry(0.25, 6, 4), spot);
    s.position.set((i - 2) * 0.9, 0.62, -0.4 + Math.abs(i - 2) * 0.35);
    g.add(s);
  }
  const eye = glowMat(0xffffff, 4);
  for (const x of [-1.1, 1.1]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), eye);
    e.position.set(x, 0.25, 2.6);
    g.add(e);
  }
  return {
    group: g,
    flash: [body, wingMat],
    anim: (t) => {
      wl.rotation.z = Math.sin(t * 3.2) * 0.45;
      wr.rotation.z = -Math.sin(t * 3.2) * 0.45;
      tail.rotation.y = Math.sin(t * 2.1) * 0.25;
    },
  };
}

function buildRockback(color) {
  const g = new THREE.Group();
  const geo = new THREE.DodecahedronGeometry(1, 1);
  const p = geo.attributes.position;
  const seen = new Map();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    if (!seen.has(key)) seen.set(key, 0.82 + Math.random() * 0.36);
    const s = seen.get(key);
    p.setXYZ(i, p.getX(i) * s, p.getY(i) * s, p.getZ(i) * s);
  }
  geo.computeVertexNormals();
  const rock = new THREE.MeshStandardMaterial({ color: 0x5b4c44, roughness: 1, flatShading: true, emissive: new THREE.Color(color), emissiveIntensity: 0.05 });
  const body = new THREE.Mesh(geo, rock);
  body.scale.set(10, 8, 12);
  g.add(body);
  const crystal = emissiveMat(color, 1.6, 0x3a1a08);
  for (let i = 0; i < 9; i++) {
    const c = new THREE.Mesh(new THREE.ConeGeometry(1.1, 6 + Math.random() * 5, 5), crystal);
    const a = (i / 9) * Math.PI * 2;
    const v = new THREE.Vector3(Math.cos(a) * 0.5, 1, Math.sin(a) * 0.6 - 0.2).normalize();
    c.position.copy(v).multiplyScalar(8);
    c.quaternion.setFromUnitVectors(UP, v);
    g.add(c);
  }
  const maw = new THREE.Mesh(new THREE.TorusGeometry(3.2, 0.7, 8, 20), glowMat(color, 3));
  maw.position.z = 11.2;
  g.add(maw);
  const eye = glowMat(0xffe08a, 4);
  for (const [x, y] of [[-3.5, 3], [3.5, 3], [-2, 4.5], [2, 4.5]]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.6, 8, 6), eye);
    e.position.set(x, y, 9.6);
    g.add(e);
  }
  return { group: g, flash: [rock, crystal], anim: (t) => { maw.rotation.z = t; } };
}

function buildWraith(color) {
  const g = new THREE.Group();
  const veil = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(0.9), transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const cone = new THREE.Mesh(new THREE.ConeGeometry(2.6, 10, 10, 1, true).rotateX(-Math.PI / 2), veil);
  cone.position.z = -2;
  g.add(cone);
  const coreMat = glowMat(color, 3);
  const core = new THREE.Mesh(new THREE.SphereGeometry(1.3, 12, 8), coreMat);
  core.position.z = 2;
  g.add(core);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: new THREE.Color(color).multiplyScalar(1.2), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  halo.scale.setScalar(12);
  halo.position.z = 2;
  g.add(halo);
  const tendrils = [];
  for (let i = 0; i < 4; i++) {
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.25, 9, 5).rotateX(Math.PI / 2), veil);
    const a = (i / 4) * Math.PI * 2;
    t.position.set(Math.cos(a) * 1.4, Math.sin(a) * 1.4, -8);
    g.add(t);
    tendrils.push(t);
  }
  return {
    group: g,
    flash: [],
    flashBasic: [coreMat],
    anim: (t) => {
      tendrils.forEach((td, i) => { td.rotation.x = Math.sin(t * 3 + i) * 0.3; td.rotation.y = Math.cos(t * 2.4 + i) * 0.3; });
      veil.opacity = 0.45 + 0.15 * Math.sin(t * 5);
    },
    disposeExtra: [halo.material],
  };
}

function buildBoss(def, index) {
  const g = new THREE.Group();
  const R = def.radius;
  const skin = emissiveMat(def.color, 0.35, 0x161220, { flatShading: index >= 2 });
  const accent = emissiveMat(def.accent, 1.0, 0x302010);
  const eyeMat = glowMat(def.accent, 3);
  let bodyGeo;
  if (index === 2) bodyGeo = new THREE.DodecahedronGeometry(1, 0);
  else if (index === 3) bodyGeo = new THREE.OctahedronGeometry(1, 0);
  else bodyGeo = new THREE.SphereGeometry(1, 32, 16);
  const body = new THREE.Mesh(bodyGeo, skin);
  body.scale.set(R * 0.55, R * 0.45, R * (index === 3 ? 0.7 : 0.95));
  g.add(body);

  const segments = [];
  const segCount = index === 3 ? 0 : 6;
  for (let i = 0; i < segCount; i++) {
    const s = 1 - i / (segCount + 1);
    const seg = new THREE.Mesh(index === 2 ? new THREE.DodecahedronGeometry(1, 0) : new THREE.SphereGeometry(1, 20, 12), skin);
    seg.scale.set(R * 0.38 * s, R * 0.32 * s, R * 0.38 * s);
    seg.position.z = -R * (0.8 + i * 0.42);
    g.add(seg);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(R * 0.4 * s, R * 0.02, 6, 24), accent);
    ring.position.copy(seg.position);
    g.add(ring);
    segments.push([seg, ring]);
  }
  // fins / wings
  for (const side of [-1, 1]) {
    const fin = new THREE.Mesh(new THREE.ConeGeometry(R * 0.18, R * 1.1, 4), accent);
    fin.position.set(side * R * 0.6, 0, -R * 0.1);
    fin.rotation.z = side * -Math.PI / 2.4;
    fin.rotation.x = -0.6;
    g.add(fin);
    for (let h = 0; h < (index === 1 ? 3 : 2); h++) {
      const horn = new THREE.Mesh(new THREE.ConeGeometry(R * 0.06, R * 0.6, 6), accent);
      horn.position.set(side * R * (0.2 + h * 0.12), R * 0.35, R * (0.55 - h * 0.15));
      horn.rotation.x = -1.0;
      horn.rotation.z = side * -0.4;
      g.add(horn);
    }
    const eye = new THREE.Mesh(new THREE.SphereGeometry(R * 0.07, 12, 8), eyeMat);
    eye.position.set(side * R * 0.22, R * 0.12, R * 0.85);
    g.add(eye);
  }
  let halo = null;
  if (index === 3 || index === 4) {
    halo = new THREE.Group();
    for (let k = 0; k < 3; k++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(R * (0.9 + k * 0.2), R * 0.015, 6, 64), accent);
      ring.rotation.set(Math.random() * 3, Math.random() * 3, 0);
      halo.add(ring);
    }
    g.add(halo);
  }
  let maw = null;
  if (index === 4) {
    maw = new THREE.Group();
    for (let k = 0; k < 12; k++) {
      const tooth = new THREE.Mesh(new THREE.ConeGeometry(R * 0.05, R * 0.25, 5), eyeMat);
      const a = (k / 12) * Math.PI * 2;
      tooth.position.set(Math.cos(a) * R * 0.28, Math.sin(a) * R * 0.28, 0);
      tooth.rotation.z = a - Math.PI / 2;
      tooth.rotation.x = Math.PI / 2;
      maw.add(tooth);
    }
    maw.position.z = R * 0.95;
    g.add(maw);
  }
  const aura = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: new THREE.Color(def.color).multiplyScalar(0.5), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.3 }));
  aura.scale.setScalar(R * 4);
  g.add(aura);
  return {
    group: g,
    flash: [skin, accent],
    anim: (t) => {
      segments.forEach(([seg, ring], i) => {
        const x = Math.sin(t * 1.6 - i * 0.6) * R * 0.12 * (i + 1) * 0.4;
        seg.position.x = x;
        ring.position.x = x;
      });
      if (halo) { halo.rotation.y = t * 0.3; halo.rotation.x = t * 0.17; }
      if (maw) maw.rotation.z = t * 0.8;
    },
    disposeExtra: [aura.material],
  };
}

const BUILDERS = { mite: buildMite, ray: buildRay, rockback: buildRockback, wraith: buildWraith };

// ----------------------------------------------------------- manager --
export class BeastManager {
  constructor(scene, particles, combat, sound) {
    this.scene = scene;
    this.particles = particles;
    this.combat = combat;
    this.sound = sound;
    this.beasts = [];
    this.groupId = 0;
    this.system = null;
    this.onKill = null;
  }

  setSystem(system, def, bossDefeated, avoid) {
    this.clear();
    this.system = system;
    this.def = def;
    this.max = Math.min(30, 13 + Math.round(def.tier * 1.8));
    this.spawnTimer = 3;
    let guard = 0;
    while (this.beasts.length < this.max * 0.75 && guard++ < 40) this.spawnRandomGroup(avoid, 900);
    if (def.boss !== null && !bossDefeated) {
      this.spawnBoss(def.boss, system.bossPoint, def.tier);
    }
  }

  spawnRandomGroup(avoid, minDist = 800) {
    const pts = this.system.spawnPoints.filter((p) => !avoid || p.pos.distanceTo(avoid) > minDist);
    if (!pts.length) return;
    const sp = pts[Math.floor(Math.random() * pts.length)];
    const tier = this.def.tier;
    const roll = Math.random();
    let type;
    if (sp.kind === 'belt') type = roll < 0.6 ? 'rockback' : 'mite';
    else if (sp.kind === 'hotspot') type = tier >= 2 && roll < 0.45 ? 'wraith' : roll < 0.75 ? 'ray' : 'mite';
    else type = roll < 0.45 ? 'mite' : roll < 0.8 ? 'ray' : tier >= 1 ? 'rockback' : 'mite';
    const counts = { mite: [3, 6], ray: [1, 3], rockback: [1, 2], wraith: [1, 3] }[type];
    const n = counts[0] + Math.floor(Math.random() * (counts[1] - counts[0] + 1));
    const center = sp.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 300, (Math.random() - 0.5) * 120, (Math.random() - 0.5) * 300));
    this.spawnGroup(type, center, n, tier);
  }

  spawnGroup(type, center, n, tier, aggro = false) {
    const gid = ++this.groupId;
    const out = [];
    for (let i = 0; i < n; i++) {
      const pos = center.clone().add(new THREE.Vector3((Math.random() - 0.5) * 60, (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 60));
      const elite = Math.random() < 0.08;
      out.push(this.spawn(type, pos, tier, { gid, elite, aggro }));
    }
    return out;
  }

  spawn(type, pos, tier, { gid = 0, elite = false, aggro = false } = {}) {
    const def = BEASTS[type];
    const model = BUILDERS[type](elite ? 0xffd040 : def.color);
    const scale = elite ? 1.35 : 1;
    model.group.scale.setScalar(scale);
    model.group.position.copy(pos);
    this.scene.add(model.group);
    const hp = 60 * power(tier) * def.hp * (elite ? 2.4 : 1);
    const b = {
      type, def, model, mesh: model.group, pos: model.group.position, vel: new THREE.Vector3(),
      hp, maxHp: hp, dmg: 8 * power(tier) * def.dmg * (elite ? 1.4 : 1),
      tier: tier + (elite ? 0.5 : 0), radius: def.radius * scale, elite, boss: false,
      name: `${elite ? 'Elite ' : ''}${def.name}`, cn: def.cn,
      home: pos.clone(), wander: new THREE.Vector3(), wanderT: 0, gid, alive: true, aggro,
      cd: Math.random() * 2, cd2: 2 + Math.random() * 3, state: 'move', stateT: 0, flashT: 0,
      phase: Math.random() * 10, lastHit: -99, xpMult: elite ? 2.5 : 1, coinMult: elite ? 3 : 1,
    };
    this.beasts.push(b);
    return b;
  }

  spawnBoss(index, pos, tier) {
    const def = BOSSES[index];
    const model = buildBoss(def, index);
    model.group.position.copy(pos);
    this.scene.add(model.group);
    const hp = 60 * power(tier) * def.hp;
    const b = {
      type: 'boss', bossIndex: index, def: { ...def, behavior: 'boss', aggro: 900 }, model, mesh: model.group, pos: model.group.position,
      vel: new THREE.Vector3(), hp, maxHp: hp, dmg: 8 * power(tier) * def.dmg, tier, radius: def.radius * 0.8, elite: false, boss: true,
      name: def.name, cn: def.cn, home: pos.clone(), wander: new THREE.Vector3(), wanderT: 0, gid: -1, alive: true, aggro: false,
      cd: 2.5, cd2: 12, state: 'move', stateT: 0, flashT: 0, phase: 0, pattern: 0, orbitA: 0, streamT: 0, lastHit: -99,
      xpMult: 1, coinMult: 1,
    };
    this.beasts.push(b);
    this.boss = b;
    return b;
  }

  get liveBoss() {
    return this.boss && this.boss.alive ? this.boss : null;
  }

  // Returns true if the beast died.
  damage(b, amount, time) {
    if (!b.alive) return false;
    b.hp -= amount;
    b.flashT = 0.12;
    b.lastHit = time;
    if (!b.aggro) {
      b.aggro = true;
      if (b.gid > 0) for (const o of this.beasts) if (o.gid === b.gid && o.pos.distanceTo(b.pos) < 700) o.aggro = true;
    }
    if (b.hp <= 0) {
      this.kill(b);
      return true;
    }
    return false;
  }

  kill(b) {
    b.alive = false;
    const c = b.boss ? b.def.color : b.elite ? 0xffd040 : b.def.color;
    this.combat.explosion(b.pos, c, b.boss ? 6 : b.radius / 4);
    if (b.boss) {
      this.combat.shockwave(b.pos, 400, b.def.accent, 1.2);
      this.particles.burst(b.pos, new THREE.Color(b.def.accent).multiplyScalar(2), 300, 260, 6, 2.5, 0.8);
    }
    this.sound.boom(b.boss || b.type === 'rockback');
    this.removeModel(b);
    this.beasts.splice(this.beasts.indexOf(b), 1);
    if (this.onKill) this.onKill(b);
  }

  removeModel(b) {
    this.scene.remove(b.mesh);
    b.mesh.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material && !o.isSprite) o.material.dispose();
    });
    if (b.model.disposeExtra) b.model.disposeExtra.forEach((m) => m.dispose());
  }

  clear() {
    for (const b of this.beasts) this.removeModel(b);
    this.beasts = [];
    this.boss = null;
  }

  aimAt(b, player, speed) {
    const d = b.pos.distanceTo(player.pos);
    return tmpA.copy(player.pos).addScaledVector(player.vel, d / speed).sub(b.pos).normalize().clone();
  }

  face(b, dir, dt, rate = 6) {
    if (dir.lengthSq() < 0.0001) return;
    tmpM.lookAt(tmpB.copy(b.pos).add(dir), b.pos, UP);
    tmpQ.setFromRotationMatrix(tmpM);
    b.mesh.quaternion.slerp(tmpQ, 1 - Math.exp(-dt * rate));
  }

  update(dt, ctx) {
    const { player, playerAlive, time } = ctx;
    // respawn
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = 7;
      const normal = this.beasts.filter((b) => !b.boss).length;
      if (normal < this.max) this.spawnRandomGroup(player.pos, 900);
    }

    for (const b of this.beasts) {
      const toP = tmpA.subVectors(player.pos, b.pos);
      const d = toP.length();
      const dirP = toP.clone().divideScalar(Math.max(d, 0.001));
      const desired = new THREE.Vector3();
      const def = b.def;
      let speed = def.speed;
      let faceDir = null;

      if (!b.aggro && playerAlive && d < def.aggro + b.radius) b.aggro = true;
      if (b.aggro && (!playerAlive || d > 1900 || b.pos.distanceTo(b.home) > 2600)) {
        b.aggro = false;
        b.hp = b.maxHp;
        b.state = 'move';
      }

      if (!b.aggro) {
        b.wanderT -= dt;
        if (b.wanderT <= 0) {
          b.wanderT = 3 + Math.random() * 4;
          b.wander.set((Math.random() - 0.5) * 240, (Math.random() - 0.5) * 80, (Math.random() - 0.5) * 240);
        }
        desired.copy(b.home).add(b.wander).sub(b.pos);
        const dl = desired.length();
        desired.multiplyScalar(dl > 20 ? (speed * 0.35) / dl : 0);
      } else if (def.behavior === 'swarm') {
        const side = new THREE.Vector3().crossVectors(dirP, UP).normalize().multiplyScalar(Math.sin(time * 2 + b.phase) * 0.5);
        desired.copy(dirP).add(side).normalize().multiplyScalar(speed * 1.15);
      } else if (def.behavior === 'ranged') {
        const ideal = 190;
        const radial = d > ideal + 30 ? 1 : d < ideal - 30 ? -1 : 0;
        const side = new THREE.Vector3().crossVectors(dirP, UP).normalize();
        desired.copy(dirP).multiplyScalar(radial).addScaledVector(side, Math.sin(time * 0.5 + b.phase) > 0 ? 0.8 : -0.8).normalize().multiplyScalar(speed);
        faceDir = dirP;
        b.cd -= dt;
        if (b.cd <= 0 && d < 600 && playerAlive) {
          b.cd = def.fireRate * (0.8 + Math.random() * 0.4);
          const muzzle = b.pos.clone().addScaledVector(dirP, b.radius);
          this.combat.enemyShot(muzzle, this.aimAt(b, player, def.shotSpeed), def.shotSpeed, b.dmg, b.elite ? 0xffd040 : def.color, 1.5);
        }
      } else if (def.behavior === 'tank') {
        b.cd2 -= dt;
        if (b.state === 'move') {
          desired.copy(dirP).multiplyScalar(speed);
          if (b.cd2 <= 0 && d < 420) { b.state = 'windup'; b.stateT = 0.8; }
        } else if (b.state === 'windup') {
          b.stateT -= dt;
          faceDir = dirP;
          b.mesh.position.x += (Math.random() - 0.5) * 0.8;
          if (b.stateT <= 0) { b.state = 'charge'; b.stateT = 1.2; b.chargeDir = dirP.clone(); }
        } else if (b.state === 'charge') {
          b.stateT -= dt;
          desired.copy(b.chargeDir).multiplyScalar(speed * 5.5);
          speed *= 5.5;
          if (Math.random() < 0.6) this.particles.emit(b.pos.x, b.pos.y, b.pos.z, 0, 0, 0, new THREE.Color(2, 0.8, 0.3), 4, 0.5, 0, 1);
          if (b.stateT <= 0) { b.state = 'move'; b.cd2 = 5 + Math.random() * 2; }
        }
      } else if (def.behavior === 'blink') {
        desired.copy(dirP).multiplyScalar(d > 140 ? speed : -speed * 0.4);
        faceDir = dirP;
        b.cd2 -= dt;
        b.cd -= dt;
        if (b.cd2 <= 0 && playerAlive && d < 700) {
          b.cd2 = 4 + Math.random() * 2;
          this.particles.burst(b.pos, new THREE.Color(def.color).multiplyScalar(2), 30, 60, 2.5, 0.6);
          const off = new THREE.Vector3(Math.random() - 0.5, (Math.random() - 0.5) * 0.5, Math.random() - 0.5).normalize().multiplyScalar(90 + Math.random() * 40);
          b.pos.copy(player.pos).add(off);
          b.vel.set(0, 0, 0);
          this.particles.burst(b.pos, new THREE.Color(def.color).multiplyScalar(2), 30, 60, 2.5, 0.6);
          b.cd = 0.35;
          b.burst = 3;
        }
        if (b.burst > 0 && b.cd <= 0) {
          b.burst--;
          b.cd = 0.18;
          this.combat.enemyShot(b.pos.clone(), this.aimAt(b, player, def.shotSpeed), def.shotSpeed, b.dmg * 0.6, def.color, 1.2);
        }
      } else if (def.behavior === 'boss') {
        this.updateBoss(b, dt, ctx, d, dirP, desired);
        speed = b.state === 'charge' ? def.speed * 5 : def.speed;
        faceDir = b.state === 'charge' ? b.chargeDir : dirP;
      }

      // separation from other beasts
      for (const o of this.beasts) {
        if (o === b) continue;
        const sep = tmpB.subVectors(b.pos, o.pos);
        const sd = sep.length();
        const min = b.radius + o.radius + 2;
        if (sd < min && sd > 0.001) desired.addScaledVector(sep.divideScalar(sd), (min - sd) * 6);
      }

      const accel = b.state === 'charge' ? 6 : 2.2;
      b.vel.lerp(desired, 1 - Math.exp(-dt * accel));
      b.pos.addScaledVector(b.vel, dt);
      if (this.system) this.system.resolveCollision(b.pos, b.radius);
      this.face(b, faceDir || (b.vel.lengthSq() > 4 ? b.vel.clone().normalize() : dirP), dt, b.boss ? 2.5 : 6);

      // contact damage
      if (playerAlive && b.aggro && d < b.radius + player.radius + 1.5) {
        b.cd3 = (b.cd3 || 0) - dt;
        if (b.cd3 <= 0) {
          b.cd3 = 1.0;
          const mult = b.state === 'charge' ? 2 : 1;
          ctx.hurtPlayer(b.dmg * mult * (b.boss ? 1.2 : 1), b.pos.clone(), dirP.clone().multiplyScalar(b.boss ? 160 : 90));
        }
      } else if (b.cd3 > 0) {
        b.cd3 -= dt;
      }

      // visuals
      b.model.anim(time + b.phase);
      if (b.flashT > 0) b.flashT -= dt;
      const f = b.flashT > 0 ? 3.5 : 1;
      for (const m of b.model.flash) {
        if (m.userData.base === undefined) m.userData.base = m.emissiveIntensity;
        m.emissiveIntensity = m.userData.base * f;
      }
    }
  }

  updateBoss(b, dt, ctx, d, dirP, desired) {
    const { player, playerAlive } = ctx;
    if (!b.aggro) {
      desired.copy(b.home).sub(b.pos).multiplyScalar(0.5);
      return;
    }
    const enraged = b.hp < b.maxHp * 0.4;
    b.cd -= dt;
    b.cd2 -= dt;
    if (b.state === 'windup') {
      b.stateT -= dt;
      desired.set(0, 0, 0);
      if (Math.random() < 0.5) this.particles.converge(b.pos, new THREE.Color(b.def.accent).multiplyScalar(2), 3, b.radius * 2.5, b.radius * 4, 4);
      if (b.stateT <= 0) { b.state = 'charge'; b.stateT = 1.4; b.chargeDir = dirP.clone(); }
      return;
    }
    if (b.state === 'charge') {
      b.stateT -= dt;
      desired.copy(b.chargeDir).multiplyScalar(b.def.speed * 5);
      if (b.stateT <= 0) b.state = 'move';
      return;
    }
    // orbit the player at a distance
    b.orbitA += dt * 0.35;
    const away = tmpB.subVectors(b.pos, player.pos).setY(0).normalize();
    const tangent = new THREE.Vector3().crossVectors(UP, away);
    const ideal = 300;
    desired.copy(away).multiplyScalar((ideal - d) * 0.8).addScaledVector(tangent, b.def.speed);
    desired.y += (player.pos.y + Math.sin(b.orbitA) * 60 - b.pos.y) * 0.8;

    if (b.streamT > 0) {
      b.streamT -= dt;
      b.streamCd = (b.streamCd || 0) - dt;
      if (b.streamCd <= 0 && playerAlive) {
        b.streamCd = enraged ? 0.08 : 0.13;
        const muzzle = b.pos.clone().addScaledVector(dirP, b.radius);
        this.combat.enemyShot(muzzle, this.aimAt(b, player, 240), 240, b.dmg * 0.5, b.def.accent, 2.2);
      }
    }
    if (b.cd <= 0 && playerAlive) {
      const patterns = ['fan', 'stream', 'charge', 'fan', 'nova'];
      const p = patterns[b.pattern++ % patterns.length];
      b.cd = enraged ? 2.2 : 3.4;
      if (p === 'fan') {
        const n = 11 + b.bossIndex * 2 + (enraged ? 6 : 0);
        const side = new THREE.Vector3().crossVectors(dirP, UP).normalize();
        for (let k = 0; k < n; k++) {
          const a = (k / (n - 1) - 0.5) * 1.1;
          const dir = dirP.clone().multiplyScalar(Math.cos(a)).addScaledVector(side, Math.sin(a)).normalize();
          dir.y += (Math.random() - 0.5) * 0.08;
          this.combat.enemyShot(b.pos.clone().addScaledVector(dirP, b.radius), dir, 160, b.dmg * 0.7, b.def.color, 2.6);
        }
      } else if (p === 'stream') {
        b.streamT = 1.8;
      } else if (p === 'charge') {
        b.state = 'windup';
        b.stateT = 0.9;
      } else if (p === 'nova') {
        const n = 26 + (enraged ? 12 : 0);
        for (let k = 0; k < n; k++) {
          const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u);
          const dir = new THREE.Vector3(s * Math.cos(th), u * 0.6, s * Math.sin(th)).normalize();
          this.combat.enemyShot(b.pos.clone().addScaledVector(dir, b.radius), dir, 120, b.dmg * 0.6, b.def.accent, 2.4);
        }
      }
    }
    if (b.cd2 <= 0) {
      b.cd2 = enraged ? 10 : 15;
      const minions = this.spawnGroup('mite', b.pos.clone().add(new THREE.Vector3(0, b.radius, 0)), 4, Math.max(0, b.tier - 0.6), true);
      minions.forEach((m) => { m.home.copy(b.home); });
    }
  }

  nearest(pos, maxDist = Infinity) {
    let best = null, bd = maxDist;
    for (const b of this.beasts) {
      const d = b.pos.distanceTo(pos);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }
}
