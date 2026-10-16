import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { BOSSES, power } from './data.js';

// The World-Eaters: the Overlords of the outer regions, serpents so large they
// coil around a planet. One sleeps around the lair world of every boss system.
//
// It is fought in flight around its planet. The body is a chain of armoured
// segments that follows the head's path (a whip tens of kilometres long), so
// every move the head makes sweeps the body through space. Its hide barely
// notices you: break the glowing nodes along its back, or strike the core deep
// in its maw while the jaws are open. It reads no input and shows no markers:
// the jaws flare, the spines kindle and the head turns before every attack.

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const tA = V(), tB = V(), tC = V(), tM = new THREE.Matrix4();
const rand = (a, b) => a + Math.random() * (b - a);
const smooth = (x) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };

let kit = null;
function loadKit() {
  if (typeof document === 'undefined') return Promise.resolve(null);
  kit ||= new GLTFLoader().loadAsync(`${import.meta.env?.BASE_URL ?? './'}models/worldeater.glb`).then((g) => {
    const get = (n) => g.scene.getObjectByName(n);
    return { head: get('we_head'), petal: get('we_petal'), seg: get('we_seg'), tail: get('we_tail'), node: get('we_node') };
  }).catch((e) => { console.warn('world-eater failed to load', e); return null; });
  return kit;
}

const NODES = [5, 10, 15, 20, 25];
const SEGMENTS = 30;

export class WorldEater {
  constructor(g, bossIndex, planet) {
    this.g = g; this.planet = planet; this.index = bossIndex;
    this.def = { ...BOSSES[bossIndex], behavior: 'boss', aggro: 9e9, cores: 40, xp: BOSSES[bossIndex].xp * 2, coins: BOSSES[bossIndex].coins * 2 };
    const R = planet.R;
    this.R = R;
    // body radius and segment spacing scale with the planet it coils around
    this.br = R * 0.075 * (1 + bossIndex * 0.08);
    this.sc = this.br / 0.45;
    this.L = this.sc * 0.86;
    this.state = 'sleep'; this.t = 0; this.phase = 0; this.time = 0;
    this.speed = 0;
    this.mawOpen = 0; this.glow = 0;
    this.recent = [];
    this.parts = [];
    // the path the body follows, as offsets from the planet centre (newest first)
    this.path = [];
    this.coil(R + this.br * 1.05, 0);
    this.headOff = this.path[0].clone();
    this.fwd = V().subVectors(this.path[0], this.path[1]).normalize();
    const tier = g.star.tier;
    const hp = 60 * power(tier) * this.def.hp * 4;
    this.group = new THREE.Group();
    g.beasts.scene.add(this.group);
    this.boss = {
      uid: ++g.beasts.uid, type: 'boss', bossIndex, colossal: true, boss: true, alive: true, aggro: true, elite: false,
      def: this.def, name: this.def.name, cn: this.def.cn, tier, hp, maxHp: hp, dmg: 8 * power(tier) * this.def.dmg,
      pos: V(), vel: V(), home: V(), radius: 0.01, flashT: 0, lastHit: -99, xpMult: 1, coinMult: 1, phase: 0, owner: this,
      model: { group: new THREE.Group(), anim: () => {}, flash: [], die: () => this.die() },
    };
    this.boss.mesh = this.boss.model.group;
    g.beasts.beasts.push(this.boss);
    g.beasts.boss = this.boss;
    loadKit().then((k) => { if (k && this.boss.alive && !this.disposed) this.build(k); });
  }

  centre(out = V()) {
    this.planet.spin.getWorldPosition(out);
    return this.g.beasts.scene.worldToLocal(out);
  }

  // Lay the body in a sleeping coil around the planet: a slow helix about its equator.
  coil(radius, tilt) {
    const n = SEGMENTS * 5;
    const axis = V(Math.sin(tilt), Math.cos(tilt), 0).normalize();
    const e1 = V(1, 0, 0).projectOnPlane(axis).normalize(), e2 = V().crossVectors(axis, e1);
    const step = (this.L / 5) / radius;
    this.path = [];
    for (let i = 0; i < n; i++) {
      const a = i * step;
      const h = Math.sin(i * 0.02) * 0.08 * radius;
      this.path.push(e1.clone().multiplyScalar(Math.cos(a) * radius).addScaledVector(e2, Math.sin(a) * radius).addScaledVector(axis, h));
    }
  }

  // ---- body
  build(k) {
    const tint = new THREE.Color(this.def.color), glow = new THREE.Color(this.def.accent);
    const mats = new Map();
    const dress = (src) => {
      const o = src.clone(true);
      o.traverse((m) => {
        if (!m.isMesh) return;
        m.frustumCulled = false;
        const key = m.material.name;
        if (!mats.has(key)) {
          const mat = m.material.clone();
          if (key === 'hide') { mat.color.copy(tint).multiplyScalar(1.1); mat.vertexColors = true; }
          else if (key === 'dark') mat.color.copy(tint).multiplyScalar(0.35);
          else if (key === 'horn') mat.color.lerp(tint, 0.35);
          else if (key === 'glow' || key === 'eye') { mat.color.copy(glow); mat.emissive.copy(glow); mat.emissiveIntensity = 3; }
          mats.set(key, mat);
        }
        m.material = mats.get(key);
      });
      o.scale.setScalar(this.sc);
      this.group.add(o);
      return o;
    };
    this.mats = mats;
    this.head = dress(k.head);
    this.petals = [];
    for (let i = 0; i < 4; i++) {
      const pivot = new THREE.Group();
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      pivot.position.set(Math.cos(a) * 0.5, Math.sin(a) * 0.5, 0.6);
      pivot.rotation.z = a - Math.PI / 2;
      const p = k.petal.clone(true);
      p.traverse((m) => { if (m.isMesh) { m.frustumCulled = false; const mat = mats.get(m.material.name) || m.material; m.material = mat; } });
      pivot.add(p);
      this.head.add(pivot);
      this.petals.push(p);
    }
    this.segs = [];
    for (let i = 0; i < SEGMENTS; i++) this.segs.push(dress(i === SEGMENTS - 1 ? k.tail : k.seg));
    this.nodes = NODES.map((i) => { const n = dress(k.node); n.scale.setScalar(this.sc * 0.9); return { seg: i, obj: n }; });
    this.makeParts();
    this.layout();
  }

  makeParts() {
    const g = this.g;
    const part = (o) => {
      const p = { uid: ++g.beasts.uid, type: 'titanpart', planetary: true, owner: this, alive: true, boss: false, elite: false, pos: V(), vel: V(), home: V(),
        hp: 1, maxHp: 1, flashT: 0, lastHit: -99, tier: this.boss.tier, def: { color: this.def.color, accent: this.def.accent, name: o.name || this.def.name }, name: o.name || this.def.name, cn: this.def.cn,
        model: { group: new THREE.Group(), anim() {}, flash: [] }, taken: 0, broken: false, ...o };
      p.mesh = p.model.group;
      this.parts.push(p);
      g.beasts.beasts.push(p);
      return p;
    };
    this.core = part({ kind: 'core', name: 'Devouring Core', radius: this.br * 0.45, weak: true });
    this.nodeParts = this.nodes.map((n) => part({ kind: 'node', name: 'Heart-node', radius: this.br * 0.55, weak: true, node: n, breakHp: this.boss.maxHp * 0.07 }));
    this.segParts = [];
    for (let i = 0; i < SEGMENTS; i += 2) this.segParts.push(part({ kind: 'body', seg: i, radius: this.br * 1.05 }));
  }

  // place every piece along the path
  layout() {
    const c = this.centre(tC);
    const pts = this.samples();
    this.boss.pos.copy(c).add(this.headOff);
    if (!this.head) return;
    const place = (obj, pos, ahead) => {
      obj.position.copy(pos);
      const fwd = tA.subVectors(ahead, pos);
      if (fwd.lengthSq() < 1e-6) return;
      fwd.normalize();
      const up = tB.subVectors(pos, c).normalize();
      tM.lookAt(V(), fwd.clone().negate(), up);
      obj.quaternion.setFromRotationMatrix(tM);
    };
    const headPos = c.clone().add(this.headOff);
    place(this.head, headPos, headPos.clone().add(this.fwd));
    for (let i = 0; i < this.segs.length; i++) place(this.segs[i], c.clone().add(pts[i + 1]), c.clone().add(pts[i]));
    for (const n of this.nodes) {
      const s = this.segs[n.seg];
      n.obj.position.copy(s.position).addScaledVector(tA.set(0, 1, 0).applyQuaternion(s.quaternion), this.br * 0.85);
      n.obj.quaternion.copy(s.quaternion);
    }
    for (const p of this.petals) p.rotation.x = THREE.MathUtils.lerp(0.42, -0.75, this.mawOpen);
    // parts follow
    this.core.pos.copy(headPos);
    for (const p of this.nodeParts) p.pos.copy(p.node.obj.position);
    for (const p of this.segParts) p.pos.copy(this.segs[p.seg].position);
    const g = Math.max(0, this.glow);
    const gm = this.mats?.get('glow'), em = this.mats?.get('eye');
    if (gm) gm.emissiveIntensity = 2.5 + g * 10;
    if (em) em.emissiveIntensity = 2.5 + g * 6 + this.mawOpen * 6;
  }

  // points along the path at segment spacing: [head, seg0 front, ...]
  samples() {
    const out = [this.headOff.clone()];
    let need = this.L * 0.9, acc = 0, prev = this.headOff;
    for (let i = 0; i < this.path.length && out.length <= SEGMENTS + 1; i++) {
      const p = this.path[i];
      const d = prev.distanceTo(p);
      if (acc + d >= need) {
        const f = (need - acc) / Math.max(1e-6, d);
        const q = prev.clone().lerp(p, f);
        out.push(q);
        prev = q; acc = 0; need = this.L; i--;
        continue;
      }
      acc += d; prev = p;
    }
    while (out.length <= SEGMENTS + 1) out.push(out[out.length - 1].clone());
    return out;
  }

  // ---- movement: the head swims; the body follows its path
  swim(dt, target, speed, turn) {
    const c = this.centre(tC);
    const head = c.clone().add(this.headOff);
    const want = V().subVectors(target, head);
    if (want.lengthSq() > 1) {
      want.normalize();
      this.fwd.lerp(want, 1 - Math.exp(-dt * turn)).normalize();
    }
    // never dive into the planet
    const rad = this.headOff.length(), minR = this.R + this.br * 1.1;
    if (rad < minR * 1.02) this.fwd.addScaledVector(this.headOff.clone().normalize(), 0.5).normalize();
    this.speed += (speed - this.speed) * Math.min(1, dt * 2);
    this.headOff.addScaledVector(this.fwd, this.speed * dt);
    if (this.headOff.length() < minR) this.headOff.setLength(minR);
    if (this.path[0].distanceTo(this.headOff) > this.L / 5) {
      this.path.unshift(this.headOff.clone());
      if (this.path.length > SEGMENTS * 6) this.path.pop();
    }
  }

  playerRel() {
    const g = this.g;
    const head = this.centre(V()).add(this.headOff);
    const to = V().subVectors(g.player.pos, head);
    return { head, to, dist: to.length(), facing: to.clone().normalize().dot(this.fwd) };
  }

  predict(t) {
    const g = this.g;
    const v = g.rt.inShip && g.shipObj ? g.shipObj.vel : g.player.vel;
    return g.player.pos.clone().addScaledVector(v, t);
  }

  // ---- the fight
  wake() {
    if (this.state !== 'sleep') return;
    this.state = 'roam'; this.t = 4;
    const g = this.g;
    g.hud.banner('WORLD-EATER', this.def.name, `<span class="cn">${this.def.cn}</span>uncoils from ${this.planet.body.name}`, '#' + new THREE.Color(this.def.accent).getHexString(), 5);
    g.sound.thunder();
    g.rt.shake = Math.max(g.rt.shake, 1);
    g.cutscene.say([['Nix', 'That is not a mountain range. It\'s ALIVE. Its hide won\'t notice your blows: break the glowing nodes on its back, or hit the core in its throat when the jaws open.']]);
  }

  choose(r) {
    const opts = [];
    const add = (id, w) => { w -= this.recent.filter((x) => x === id).length * 1.5; if (w > 0) opts.push([id, w + Math.random()]); };
    const far = r.dist > this.br * 18;
    add('lunge', far ? 1.5 : 2.4);
    add('sweep', r.dist < this.br * 14 ? 2.2 : 0.6);
    add('inhale', r.dist < this.br * 22 ? 1.6 : 0.4);
    add('starfall', far ? 2.4 : 1.2);
    if (this.phase >= 1) add('brood', 1.0);
    opts.sort((a, b) => b[1] - a[1]);
    return opts[0]?.[0] || 'lunge';
  }

  begin(id) {
    this.state = id; this.t = 0; this.hit = false; this.fired = 0;
    this.recent.push(id); if (this.recent.length > 3) this.recent.shift();
    const g = this.g;
    if (id === 'lunge' || id === 'inhale') g.sound.thunder();
    this.dur = { lunge: 4.2, sweep: 5, inhale: 5.5, starfall: 4.5, brood: 3, crush: 14, stagger: 5 }[id] || 4;
  }

  update(dt) {
    const g = this.g, b = this.boss;
    if (!b.alive || this.disposed) return;
    dt = Math.min(dt, 0.1);
    this.time += dt;
    this.t += dt;
    const r = this.playerRel();
    const hpf = b.hp / b.maxHp;
    const phase = hpf <= 0.33 ? 2 : hpf <= 0.66 ? 1 : 0;
    if (phase > this.phase) {
      this.phase = phase;
      g.sound.thunder();
      g.hud.banner(phase === 1 ? 'IT TIGHTENS' : 'FRENZY', this.def.name, phase === 1 ? 'It wraps the planet to crush it. Break its heart-nodes to loosen its grip!' : 'Its maw stays open. Strike the core!', '#ff6a80', 4);
      for (const p of this.nodeParts) if (p.broken) { p.broken = false; p.taken = 0; p.node.obj.visible = true; }
      if (phase === 1) { this.begin('crush'); this.crushHits = 0; }
    }
    const fast = this.phase >= 2 ? 1.35 : 1;
    const base = this.br * 3.2 * fast;
    if (this.state === 'sleep') {
      if (r.dist < this.R * 1.6) this.wake();
    } else if (this.state === 'roam') {
      // circle the player at a distance, weaving, so the body arcs through the fight
      const side = V().crossVectors(r.to, this.centre(V()).add(this.headOff).normalize()).normalize();
      const target = g.player.pos.clone().addScaledVector(side, this.br * 10 * Math.sin(this.time * 0.3)).addScaledVector(r.to.clone().normalize(), -this.br * 9);
      this.swim(dt, target, base, 0.7);
      this.glow = Math.max(0, this.glow - dt);
      this.mawOpen = Math.max(0, this.mawOpen - dt);
      if (this.t > (this.phase >= 2 ? 2.5 : 4)) this.begin(this.choose(r));
    } else this.act(dt, r, base);
    this.layout();
    this.contact(dt);
    this.boss.pos.copy(this.centre(V()).add(this.headOff));
  }

  act(dt, r, base) {
    const g = this.g, k = this.t / this.dur;
    const s = this.state;
    if (s === 'lunge') {
      // wind up: slow, turning to track you, jaws flaring; then a straight strike through your position
      if (k < 0.4) {
        this.swim(dt, this.predict(1.2), base * 0.4, 1.6);
        this.glow = smooth(k / 0.4); this.mawOpen = smooth(k / 0.4) * 0.8;
        this.lungeTarget = this.predict(1.0);
      } else if (k < 0.75) {
        this.swim(dt, this.lungeTarget.clone().addScaledVector(this.fwd, this.br * 40), base * 4.5, 0.25);
        this.mawOpen = 1;
        if (!this.hit && r.dist < this.br * 2.2) { this.hit = true; this.hurt(0.32, 'devoured'); }
      } else { this.swim(dt, g.player.pos, base * 1.2, 0.6); this.mawOpen = Math.max(0, 1 - (k - 0.75) * 4); this.glow = 0; }
    } else if (s === 'sweep') {
      // dive past you so the whole body lashes through the space you're in
      if (k < 0.3) { this.swim(dt, g.player.pos.clone().addScaledVector(V().crossVectors(r.to, this.headOff).normalize(), this.br * 6), base * 0.8, 1.2); this.glow = smooth(k / 0.3) * 0.5; }
      else this.swim(dt, g.player.pos.clone().addScaledVector(this.fwd, this.br * 30), base * 3.4, 0.5);
    } else if (s === 'inhale') {
      // face you and drink in everything nearby: fly away hard, or dive into the maw and strike the core
      this.swim(dt, g.player.pos, base * 0.15, 1.4);
      this.mawOpen = Math.min(1, this.mawOpen + dt * 1.5);
      if (k > 0.2 && k < 0.85) {
        const pull = V().subVectors(r.head, g.player.pos);
        const d = pull.length();
        if (d < this.br * 25) {
          const f = (1 - d / (this.br * 25)) * this.br * 1.6;
          pull.normalize().multiplyScalar(f * dt);
          if (g.rt.inShip && g.shipObj) g.shipObj.vel.add(pull.multiplyScalar(1 / Math.max(dt, 1e-3) * dt * 6));
          else g.player.vel.addScaledVector(pull, 6 / Math.max(dt, 1e-3) * dt);
          if (Math.random() < 0.5) g.particles.converge(r.head, new THREE.Color(this.def.accent).multiplyScalar(1.5), 4, this.br * 6, this.br * 10, 0.6);
        }
        if (!this.hit && d < this.br * 1.4) { this.hit = true; this.hurt(0.35, 'devoured'); g.player.vel.addScaledVector(this.fwd, this.br * 3); }
      }
    } else if (s === 'starfall') {
      // the spines kindle one by one from the tail, then loose burning meteors that hunt you
      this.swim(dt, g.player.pos.clone().addScaledVector(r.to.clone().normalize(), -this.br * 14), base * 0.6, 0.8);
      this.glow = smooth(k / 0.45);
      if (k > 0.45 && this.fired < 10 && this.t > 0.45 * this.dur + this.fired * 0.18) {
        const seg = this.segs?.[Math.floor(Math.random() * this.segs.length)];
        if (seg) {
          const from = seg.position.clone().addScaledVector(tA.set(0, 1, 0).applyQuaternion(seg.quaternion), this.br * 2);
          const shot = g.combat.enemyShot(from, V().subVectors(this.predict(2), from).normalize(), this.br * 1.8, Math.min(this.boss.dmg * 0.6, g.stats.maxHp * 0.08), this.def.accent, this.br * 0.08);
          if (shot) { shot.homing = () => g.player.pos.clone(); shot.turn = 0.7; shot.life = 9; }
        }
        this.fired++;
      }
    } else if (s === 'brood') {
      // it sheds parasites onto the fight
      this.swim(dt, g.player.pos.clone().addScaledVector(r.to.clone().normalize(), -this.br * 12), base * 0.5, 0.8);
      if (this.fired === 0 && k > 0.4) {
        this.fired = 1;
        const types = [...g.beasts.species.keys()].filter((id) => { const d = g.beasts.species.get(id); return d.arch === 'avian' || d.arch === 'insect'; });
        const type = types[Math.floor(Math.random() * types.length)] || 'mite';
        g.beasts.spawnGroup(type, g.player.pos.clone().addScaledVector(r.to.clone().normalize(), -this.br * 3), 4, this.boss.tier - 0.3, true);
        g.hud.notify('It sheds a brood of parasites!', 'red');
      }
    } else if (s === 'crush') {
      // wrapping the planet: the head spirals close over its surface; break nodes to loosen it
      const c = this.centre(V());
      const radial = this.headOff.clone().normalize();
      const side = V().crossVectors(radial, V(0, 1, 0)).normalize();
      const target = c.clone().add(this.headOff.clone().setLength(this.R + this.br * 1.1).addScaledVector(side, this.br * 6));
      this.swim(dt, target, base * 1.4, 1.2);
      this.glow = 0.6 + 0.4 * Math.sin(this.time * 4);
      if (Math.random() < 0.1) g.combat.lightning(this.segs?.[Math.floor(Math.random() * SEGMENTS)]?.position || c, this.def.accent, this.br * 4, radial);
      if (this.crushHits >= 2) {
        g.hud.banner('GRIP BROKEN', this.def.name, 'It recoils', '#5dffa8', 2, true);
        this.begin('stagger');
        return;
      }
      if (k >= 1) {
        // the planet groans: a world-wide quake, and it feeds
        g.combat.shockwave(c, this.R * 1.6, this.def.accent, 2.5);
        g.rt.shake = 1.5;
        this.hurt(0.3, 'quake');
        this.boss.hp = Math.min(this.boss.maxHp * 0.66, this.boss.hp + this.boss.maxHp * 0.08);
        g.hud.notify('It feeds on the planet\'s heart and grows stronger.', 'red');
      }
    } else if (s === 'stagger') {
      this.swim(dt, this.centre(V()).add(this.headOff).addScaledVector(this.fwd, this.br * 5), base * 0.25, 0.3);
      this.mawOpen = 1; this.glow = 0;
    }
    if (k >= 1) { this.state = 'roam'; this.t = 0; }
  }

  // touching the body when it's moving fast hurts
  contact(dt) {
    const g = this.g;
    this.contactCd = Math.max(0, (this.contactCd || 0) - dt);
    if (this.contactCd > 0 || this.speed < this.br * 2 || !this.segs) return;
    for (const s of this.segs) {
      if (s.position.distanceTo(g.player.pos) < this.br * 1.15) {
        this.contactCd = 1;
        this.hurt(0.14, 'body');
        const away = V().subVectors(g.player.pos, s.position).normalize();
        if (g.rt.inShip && g.shipObj) g.shipObj.vel.addScaledVector(away, this.br * 0.8);
        else g.player.vel.addScaledVector(away, this.br * 0.8);
        break;
      }
    }
  }

  hurt(frac, kind) {
    const g = this.g;
    const dmg = Math.min(this.boss.dmg * (kind === 'devoured' ? 2.5 : 1.2), g.stats.maxHp * frac);
    g.hurtPlayer(dmg, this.boss.pos.clone(), null);
  }

  // ---- being hit
  hitPart(p, amount) {
    let mult = 0.06;
    if (p.kind === 'node' && !p.broken) mult = 1.6;
    if (p.kind === 'core') mult = this.mawOpen > 0.5 ? 3 : 0.1;
    if (this.state === 'stagger') mult *= 1.8;
    amount *= mult;
    if (p.kind === 'node' && !p.broken) {
      p.taken += amount;
      if (p.taken >= p.breakHp) this.breakNode(p);
    }
    if (this.state === 'sleep') this.wake();
    return amount;
  }

  breakNode(p) {
    const g = this.g;
    p.broken = true;
    p.node.obj.visible = false;
    g.combat.explosion(p.pos, this.def.accent, this.br * 0.02);
    g.combat.shockwave(p.pos, this.br * 4, this.def.accent, 1.2);
    g.sound.explosion(p.pos, true);
    this.boss.hp -= this.boss.maxHp * 0.05;
    if (this.state === 'crush') { this.crushHits = (this.crushHits || 0) + 1; return; }
    g.hud.banner('HEART-NODE BURST', this.def.name, 'It writhes. Its maw gapes open!', '#5dffa8', 2, true);
    this.begin('stagger');
  }

  // ---- death: it comes apart from the tail up
  die() {
    this.dying = 0;
    this.removeParts();
    const anim = (t) => {
      if (this.disposed) return;
      const dt = this.lastDie === undefined ? 0 : Math.min(0.1, t - this.lastDie);
      this.lastDie = t;
      this.dying += dt;
      const n = Math.floor(this.dying / 0.15);
      const g = this.g;
      for (let i = SEGMENTS - 1; i >= SEGMENTS - n && i >= 0; i--) {
        const s = this.segs?.[i];
        if (s && s.visible) { s.visible = false; g.combat.explosion(s.position, this.def.accent, this.br * 0.02); g.combat.debris(s.position, this.def.color, 8, this.br * 0.2); }
      }
      if (n > SEGMENTS && this.head?.visible) { this.head.visible = false; g.combat.shockwave(this.head.position, this.br * 10, this.def.accent, 2); g.sound.explosion(this.head.position, true); }
    };
    this.boss.model.anim = anim;
    return SEGMENTS * 0.15 + 1.5;
  }

  removeParts() {
    const list = this.g.beasts.beasts;
    for (const p of this.parts) { p.alive = false; const i = list.indexOf(p); if (i >= 0) list.splice(i, 1); }
    this.parts = [];
  }

  rebase(m, q) {
    for (const p of this.path) p.applyQuaternion(q);
    this.headOff.applyQuaternion(q);
    this.fwd.applyQuaternion(q);
    this.lungeTarget?.applyMatrix4(m);
  }

  dispose() {
    this.disposed = true;
    this.removeParts();
    const list = this.g.beasts.beasts;
    const i = list.indexOf(this.boss);
    if (i >= 0) list.splice(i, 1);
    if (this.g.beasts.boss === this.boss) this.g.beasts.boss = null;
    this.group.removeFromParent();
    for (const m of this.mats?.values() || []) m.dispose();
  }
}
