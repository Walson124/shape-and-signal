import * as THREE from 'three';
import { REALMS, SWORD_GRADES, masteryMult } from './data.js';
import { PATHS, TECHS, hasPerk } from './paths.js';
import { segPointDist } from './combat.js';

const tA = new THREE.Vector3();
const Y = new THREE.Vector3(0, 1, 0);

// Martial arts: every path's attacks and techniques, realm perks, and the
// damage / defence modifiers they impose. Owned by Game.
export class Arts {
  constructor(game) {
    this.g = game;
    this.combo = 0;
    this.grip = null;
    this.prisons = [];
    this.dash = null;
    this.pending = [];
  }

  get path() {
    return PATHS[this.g.state.path] || PATHS.mind;
  }

  reset() {
    if (this.grip && this.grip.b) this.grip.b.held = false;
    this.grip = null;
    for (const p of this.prisons) for (const b of p.list) b.held = false;
    this.prisons = [];
    this.dash = null;
    this.pending = [];
    this.combo = 0;
  }

  rebase(m) {
    for (const p of this.prisons) {
      p.center.applyMatrix4(m);
      for (const b of p.list) if (b.liftTo) b.liftTo.applyMatrix4(m);
    }
    if (this.dash) {
      this.dash.from.applyMatrix4(m);
      this.dash.to.applyMatrix4(m);
    }
  }

  // ------------------------------------------------------------- helpers --
  up() {
    return this.g.env.up ? this.g.env.up.clone() : this.g.player.localUp();
  }

  mult(id) {
    return masteryMult(this.g.state.mastery[id] || 1);
  }

  realmScale() {
    return 1 + this.g.state.realm * 0.18;
  }

  cooldown(id) {
    const st = this.g.stats;
    let cd = TECHS[id].cd * (1 - st.cdr);
    if (id === 'heaven' && st.mods.heavenPlus) cd *= 0.6;
    return cd;
  }

  // Check unlock, cooldown and cost; pay if possible.
  pay(id) {
    const g = this.g, rt = g.rt, t = TECHS[id];
    if (g.state.realm < t.unlockRealm) {
      g.denied(`${t.name} unlocks at the ${REALMS[t.unlockRealm].name} realm.`);
      return false;
    }
    if ((rt.cooldowns[id] || 0) > 0) return false;
    const cost = t.cost * g.stats.costMult;
    const pool = t.res === 'spirit' ? 'spirit' : 'energy';
    if (rt[pool] < cost) {
      g.denied(pool === 'spirit' ? 'Not enough spirit sense.' : 'Not enough energy.');
      return false;
    }
    rt[pool] -= cost;
    rt.cooldowns[id] = this.cooldown(id);
    return true;
  }

  color() {
    return this.g.state.path === 'mind' ? REALMS[this.g.state.realm].color : this.path.color;
  }

  // Beasts in front of the camera within range and cone.
  inCone(range, cosMin, from, dir) {
    const out = [];
    for (const b of this.g.beasts.beasts) {
      tA.subVectors(b.pos, from);
      const d = tA.length();
      if (d > range + b.radius) continue;
      if (d > b.radius && tA.divideScalar(d).dot(dir) < cosMin) continue;
      out.push(b);
    }
    return out;
  }

  aimed(maxDist = 1200) {
    const g = this.g;
    if (g.aimTarget) return g.aimTarget;
    if (g.rt.lock && g.rt.lock.alive) return g.rt.lock;
    const cam = g.camera.position;
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(g.camera.quaternion);
    let best = null, bs = 0.97;
    for (const b of g.beasts.beasts) {
      tA.subVectors(b.pos, cam);
      const d = tA.length();
      if (d > maxDist) continue;
      const c = tA.divideScalar(d).dot(f);
      if (c > bs) { bs = c; best = b; }
    }
    return best;
  }

  // -------------------------------------------------------------- update --
  update(dt, ctx) {
    const g = this.g, rt = g.rt, inp = g.input, s = g.state;
    const alive = ctx.alive;
    for (const k of Object.keys(rt.cooldowns)) rt.cooldowns[k] = Math.max(0, rt.cooldowns[k] - dt);
    rt.willT = Math.max(0, (rt.willT || 0) - dt);
    rt.blinkCd = Math.max(0, (rt.blinkCd || 0) - dt);
    rt.undyingCd = Math.max(0, (rt.undyingCd || 0) - dt);
    const pathId = s.path || 'mind';
    const P = this.path;

    if (alive && !rt.meditating && !rt.inShip) {
      // primary
      if (inp.act('fire')) {
        if (P.primary === 'bolt' && (rt.cooldowns.bolt || 0) <= 0 && rt.energy >= TECHS.bolt.cost) this.bolt(ctx);
        else if (P.primary === 'saber' && (rt.cooldowns.saber || 0) <= 0) this.saber(ctx);
        else if (P.primary === 'spike' && (rt.cooldowns.spike || 0) <= 0) this.spike(ctx);
      }
      // secondary
      if (pathId === 'blade') {
        const want = inp.act('focus') && rt.energy > 1;
        if (want && !rt.guarding) rt.guardStart = g.time;
        rt.guarding = want;
        if (want) rt.energy = Math.max(0, rt.energy - 5 * dt);
      } else rt.guarding = false;
      if (pathId === 'psychic') this.updateGrip(dt, inp.act('focus'), ctx);
      // techniques
      const keys = ['skill1', 'skill2', 'skill3', 'skill4'];
      keys.forEach((k, i) => { if (inp.hit(k)) this.cast(P.skills[i], ctx); });
      if (inp.hit('formation') && pathId === 'mind') g.hud.notify(`Sword formation: <b>${g.swords.toggleFormation() === 'swarm' ? 'Swarm' : 'Lance'}</b>.`, 'violet');
      if (inp.hit('blink')) this.blink(ctx);
    } else {
      rt.guarding = false;
      if (this.grip) this.releaseGrip(false);
    }
    if (rt.inShip && alive && inp.act('fire') && (rt.cooldowns.bolt || 0) <= 0) this.bolt(ctx);

    this.updateDash(dt);
    this.updatePrisons(dt);
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i];
      p.t -= dt;
      if (p.t <= 0) {
        this.pending.splice(i, 1);
        p.fn();
      }
    }
    this.realmPerks(dt);
  }

  cast(id, ctx) {
    if (!id) return;
    const fn = {
      volley: () => this.volley(ctx), prison: () => this.prison(ctx), barrier: () => this.barrier(), storm: () => this.storm(ctx),
      dash: () => this.startDash(ctx), crescent: () => this.crescent(ctx), will: () => this.will(), heaven: () => this.heaven(ctx),
      lance: () => this.lance(ctx), shock: () => this.shock(), terror: () => this.terror(), annihilate: () => this.annihilate(),
    }[id];
    if (fn) fn();
  }

  // --------------------------------------------------------- primaries --
  origin(hand) {
    const g = this.g, cam = g.camera;
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
    const down = new THREE.Vector3(0, -1, 0).applyQuaternion(cam.quaternion);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    if (g.rt.inShip && g.shipObj) {
      const sh = g.shipObj;
      const sr = new THREE.Vector3(1, 0, 0).applyQuaternion(sh.quat);
      return sh.pos.clone().addScaledVector(sh.forward(), 14 * sh.scale).addScaledVector(sr, hand * 3 * sh.scale);
    }
    if (g.camMode === 'first') return cam.position.clone().addScaledVector(fwd, 1.4).addScaledVector(right, hand * 0.55).addScaledVector(down, 0.42);
    return g.player.pos.clone().addScaledVector(fwd, 1.5).addScaledVector(right, hand * 0.5);
  }

  bolt(ctx) {
    const g = this.g, rt = g.rt, st = g.stats;
    rt.cooldowns.bolt = TECHS.bolt.cd * (rt.inShip ? 0.6 : 1);
    if (!rt.inShip) rt.energy -= TECHS.bolt.cost * st.costMult;
    rt.firingT = 0.12;
    rt.hand = -(rt.hand || 1);
    if (rt.controlling) rt.hand = 1;
    const origin = this.origin(rt.hand);
    if (!rt.inShip && g.camMode === 'first') {
      if (rt.hand > 0) g.viewmodel.castRight();
      else g.viewmodel.castLeft();
    }
    const dir = ctx.aimPoint.clone().sub(origin).normalize();
    const ship = rt.inShip && g.shipObj;
    const dmg = st.atk * this.mult('bolt') * (ship ? 1.2 + g.shipObj.tier * 0.4 : 1);
    const color = ship ? 0x3ef2ff : this.color();
    g.combat.firePlayerBolt(origin, dir, dmg, color, ship ? 1400 : 700 + g.state.realm * 60, { size: ship ? 1 : 0.85 + g.state.realm * 0.12, pierce: st.mods.boltPierce || 0 });
    g.sound.bolt();
  }

  saber(ctx) {
    const g = this.g, rt = g.rt, st = g.stats, s = g.state;
    rt.cooldowns.saber = TECHS.saber.cd / (1 + (st.mods.atkSpeed || 0));
    rt.firingT = 0.2;
    this.combo++;
    const fwd = ctx.camFwd.clone();
    const from = g.player.pos.clone();
    const reach = 6.5 + s.realm * 1.1;
    const dmg = st.atk * 2.3 * this.mult('saber');
    const hits = this.inCone(reach, 0.25, from, fwd);
    for (const b of hits) g.hitBeast(b, dmg, b.pos.clone().addScaledVector(fwd, -b.radius * 0.5), 'saber', fwd.clone().multiplyScalar(40));
    const up = this.up();
    g.combat.slash(from.clone().addScaledVector(fwd, 1.5).addScaledVector(up, -0.3), fwd, up, reach, this.color(), this.combo % 2 === 0);
    g.viewmodel.swing(this.combo % 2 === 0);
    if (hits.length) {
      g.sound.swordHit(hits[0].pos);
      rt.shake = Math.max(rt.shake, 0.25);
    } else g.sound.swordLaunch();
    const every = st.mods.waveEvery ? 2 : 3;
    if (this.combo % every === 0) {
      g.combat.fireWave(from.clone().addScaledVector(fwd, 2), fwd, up, st.atk * 1.6 * this.mult('saber'), this.color(), { width: 7 + s.realm * 1.2, speed: 240, life: 0.55 + s.realm * 0.04 });
    }
  }

  spike(ctx) {
    const g = this.g, rt = g.rt, st = g.stats;
    const cost = TECHS.spike.cost * st.costMult;
    if (rt.spirit < cost) return;
    rt.spirit -= cost;
    rt.cooldowns.spike = TECHS.spike.cd;
    rt.firingT = 0.12;
    rt.hand = -(rt.hand || 1);
    const origin = this.origin(rt.hand);
    if (g.camMode === 'first') {
      if (rt.hand > 0) g.viewmodel.castRight();
      else g.viewmodel.castLeft();
    }
    const target = this.aimed(900 + g.state.realm * 120);
    const col = this.color();
    if (!target) {
      g.combat.beam(origin, ctx.aimPoint.clone().sub(origin).setLength(Math.min(300, ctx.aimPoint.distanceTo(origin))).add(origin), col, 0.25, 0.15);
      g.sound.bolt();
      return;
    }
    const dmg = st.atk * 1.15 * this.mult('spike');
    g.combat.beam(origin, target.pos, col, 0.35, 0.2);
    g.hitBeast(target, dmg, target.pos.clone(), 'spike');
    let last = target;
    const hitSet = new Set([target]);
    for (let i = 0; i < (st.mods.spikeChain || 0); i++) {
      let next = null, bd = 70;
      for (const b of g.beasts.beasts) {
        if (hitSet.has(b)) continue;
        const d = b.pos.distanceTo(last.pos);
        if (d < bd) { bd = d; next = b; }
      }
      if (!next) break;
      g.combat.beam(last.pos, next.pos, col, 0.25, 0.2);
      g.hitBeast(next, dmg * 0.7, next.pos.clone(), 'spike');
      hitSet.add(next);
      last = next;
    }
    g.sound.hit(target.pos);
  }

  // -------------------------------------------------------- secondaries --
  updateGrip(dt, holding, ctx) {
    const g = this.g, rt = g.rt, st = g.stats;
    if (holding && !this.grip) {
      const b = this.aimed(220 + g.state.realm * 30);
      if (!b) return;
      if (b.boss) {
        g.denied('An Overlord’s mind is too vast to seize.');
        return;
      }
      if (b.static) return;
      b.held = true;
      b.aggro = true;
      this.grip = { b, t: 0, dist: Math.min(40, Math.max(10, b.pos.distanceTo(g.player.pos))) };
      g.viewmodel.castLeft();
    }
    if (!this.grip) return;
    const gr = this.grip, b = gr.b;
    if (!b.alive) {
      this.grip = null;
      return;
    }
    if (!holding || rt.spirit <= 0) {
      this.releaseGrip(true, ctx);
      return;
    }
    gr.t += dt;
    rt.spirit = Math.max(0, rt.spirit - 12 * dt);
    const target = g.camera.position.clone().addScaledVector(ctx.camFwd, gr.dist).addScaledVector(this.up(), 3);
    b.pos.lerp(target, 1 - Math.exp(-dt * 6));
    b.pos.add(tA.set((Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.4));
    gr.tick = (gr.tick || 0) - dt;
    if (gr.tick <= 0) {
      gr.tick = 0.4;
      g.hitBeast(b, st.atk * 0.45 * (1 + (st.mods.gripDmg || 0)) * this.mult('grip'), b.pos.clone(), 'grip');
      g.particles.converge(b.pos, new THREE.Color(this.color()).multiplyScalar(2), 8, b.radius * 2.5, b.radius * 4, 0.6);
    }
  }

  releaseGrip(hurl, ctx) {
    const gr = this.grip;
    this.grip = null;
    if (!gr || !gr.b) return;
    const b = gr.b, g = this.g;
    b.held = false;
    if (!b.alive || !hurl) return;
    b.vel.copy(ctx.camFwd).multiplyScalar(140);
    b.stunT = 1.2;
    if (g.stats.mods.gripThrow) {
      this.pending.push({
        t: 0.5,
        fn: () => {
          if (!b.alive) return;
          g.combat.explosion(b.pos, this.color(), 1.2);
          for (const o of [...g.beasts.beasts]) if (o !== b && o.pos.distanceTo(b.pos) < 30) g.hitBeast(o, g.stats.atk * 1.8, o.pos.clone(), 'grip');
          g.hitBeast(b, g.stats.atk * 1.8, b.pos.clone(), 'grip');
        },
      });
    }
  }

  // ------------------------------------------------------------- mind --
  volley(ctx) {
    const g = this.g, rt = g.rt;
    if (!this.pay('volley')) return;
    const p = g.player;
    let targets = [];
    if (rt.lock && rt.lock.alive) targets.push(rt.lock);
    const range = (260 + 50 * g.state.realm) * 1.6 * g.stats.reach;
    const cands = g.beasts.beasts
      .filter((b) => b !== rt.lock)
      .map((b) => ({ b, d: b.pos.distanceTo(p.pos), ang: tA.subVectors(b.pos, p.pos).normalize().angleTo(ctx.camFwd) }))
      .filter((c) => c.d < range && c.ang < 0.75)
      .sort((a, b) => a.ang - b.ang);
    targets = targets.concat(cands.map((c) => c.b));
    if (!targets.length) {
      const n = g.beasts.nearest(p.pos, 900);
      if (n) targets = [n];
    }
    targets = targets.slice(0, Math.max(1, Math.ceil(g.swords.swords.length / 2)));
    g.swords.launch(targets, ctx.swordDamage * 1.6 * this.mult('volley'));
    if (g.camMode === 'first') g.viewmodel.throwLeft();
  }

  prison(ctx) {
    const g = this.g;
    if (!this.pay('prison')) return;
    const k = 1 + (g.stats.mods.prison || 0);
    const target = this.aimed(160);
    const center = target ? target.pos.clone() : g.camera.position.clone().addScaledVector(ctx.camFwd, Math.min(120, ctx.aimPoint.distanceTo(g.camera.position)));
    const radius = 28 * k;
    const list = [];
    for (const b of g.beasts.beasts) {
      if (b.static || b.pos.distanceTo(center) > radius + b.radius) continue;
      if (b.boss) { b.stunT = 1.5; continue; }
      b.held = true;
      b.aggro = true;
      b.liftTo = b.pos.clone().addScaledVector(this.up(), 4 + Math.random() * 4);
      list.push(b);
    }
    const geo = new THREE.IcosahedronGeometry(radius, 1);
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(this.color()).multiplyScalar(1.8), wireframe: true, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(center);
    const dur = 3 * k;
    g.combat.addEffect(mesh, dur, (e, dt) => {
      mesh.rotation.y += dt * 0.8;
      mesh.scale.setScalar(0.85 + 0.15 * Math.sin(e.life * 6));
      mat.opacity = Math.min(0.6, e.life);
    });
    this.prisons.push({ list, t: dur, tick: 0, center, dmg: g.stats.atk * 0.9 * k * this.mult('prison') });
    g.sound.shield();
    g.hud.notify(list.length ? `<b>${list.length}</b> beast${list.length > 1 ? 's' : ''} seized.` : 'Thought Prison closes on empty air.', 'violet');
  }

  updatePrisons(dt) {
    const g = this.g;
    for (let i = this.prisons.length - 1; i >= 0; i--) {
      const p = this.prisons[i];
      p.t -= dt;
      p.tick -= dt;
      for (const b of p.list) {
        if (!b.alive) continue;
        if (b.liftTo) b.pos.lerp(b.liftTo, 1 - Math.exp(-dt * 3));
        b.pos.add(tA.set((Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.3));
      }
      if (p.tick <= 0) {
        p.tick = 0.5;
        for (const b of [...p.list]) if (b.alive) g.hitBeast(b, p.dmg * 0.5, b.pos.clone(), 'prison');
      }
      if (p.t <= 0) {
        for (const b of p.list) {
          b.held = false;
          b.liftTo = null;
          b.stunT = 0.8;
        }
        this.prisons.splice(i, 1);
      }
    }
  }

  barrier() {
    const g = this.g;
    if (!this.pay('barrier')) return;
    g.rt.shieldT = TECHS.barrier.duration;
    g.particles.burst(g.player.pos, new THREE.Color(this.color()).multiplyScalar(2), 50, 20, 0.6, 0.7);
    g.sound.shield();
  }

  storm(ctx) {
    const g = this.g;
    if (!this.pay('storm')) return;
    const dmg = ctx.swordDamage * 2.2 * this.mult('storm');
    const fire = () => g.swords.storm(g.player.pos, g.beasts.beasts.filter((b) => !b.static), dmg, SWORD_GRADES[g.state.swordGrade].glow, this.up());
    fire();
    if (g.stats.mods.stormPlus) this.pending.push({ t: 2.2, fn: fire });
    g.hud.banner('ULTIMATE', 'Ten Thousand Swords', '<span class="cn">万剑归宗</span>', '#ffe44d', 2, true);
  }

  // ------------------------------------------------------------ blade --
  startDash(ctx) {
    const g = this.g;
    if (!this.pay('dash')) return;
    const p = g.player;
    let dir = ctx.camFwd.clone();
    if (p.mode === 'ground' && g.env.up) dir.addScaledVector(g.env.up, -dir.dot(g.env.up)).normalize();
    const dist = 30 * (1 + 0.15 * g.state.realm) * (g.stats.mods.dashReset ? 1.5 : 1);
    this.dash = { t: 0, dur: 0.16, from: p.pos.clone(), to: p.pos.clone().addScaledVector(dir, dist), hit: new Set(), dir };
    g.rt.invuln = Math.max(g.rt.invuln, 0.3);
    g.viewmodel.swing(false);
    g.sound.swordLaunch();
  }

  updateDash(dt) {
    const d = this.dash;
    if (!d) return;
    const g = this.g, p = g.player;
    d.t += dt;
    const k = Math.min(1, d.t / d.dur);
    const prev = p.pos.clone();
    p.pos.lerpVectors(d.from, d.to, k);
    p.vel.copy(d.dir).multiplyScalar(30);
    g.particles.emit(p.pos.x, p.pos.y, p.pos.z, 0, 0, 0, new THREE.Color(this.color()).multiplyScalar(1.6), 1.2, 0.4, 0, 0.5);
    let killed = false;
    for (const b of [...g.beasts.beasts]) {
      if (d.hit.has(b)) continue;
      if (segPointDist(prev, p.pos, b.pos) < b.radius + 3) {
        d.hit.add(b);
        g.hitBeast(b, g.stats.atk * 3 * this.mult('dash'), b.pos.clone(), 'saber', d.dir.clone().multiplyScalar(60));
        if (!b.alive) killed = true;
      }
    }
    if (killed && g.stats.mods.dashReset) g.rt.cooldowns.dash = 0;
    if (k >= 1) {
      g.combat.slash(p.pos.clone(), d.dir, this.up(), 10, this.color());
      this.dash = null;
    }
  }

  crescent(ctx) {
    const g = this.g;
    if (!this.pay('crescent')) return;
    const plus = g.stats.mods.crescentPlus ? 1 : 0;
    const up = this.up();
    g.combat.fireWave(g.player.pos.clone().addScaledVector(ctx.camFwd, 3), ctx.camFwd.clone(), up, g.stats.atk * 4 * (plus ? 1.4 : 1) * this.mult('crescent'), this.color(), { width: (18 + g.state.realm * 2) * (plus ? 2 : 1), speed: 320, life: 1.3 });
    g.viewmodel.swing(true);
    g.rt.shake = Math.max(g.rt.shake, 0.5);
    g.sound.burst();
  }

  will() {
    const g = this.g;
    if (!this.pay('will')) return;
    g.rt.willT = TECHS.will.duration;
    g.particles.burst(g.player.pos, new THREE.Color(2, 0.9, 0.3), 70, 25, 0.7, 0.8);
    g.hud.notify('<b>Battle Will</b> surges through you.', 'gold');
    g.sound.shield();
  }

  heaven(ctx) {
    const g = this.g;
    if (!this.pay('heaven')) return;
    const plus = g.stats.mods.heavenPlus ? 2 : 1;
    const up = this.up();
    g.combat.fireWave(g.player.pos.clone().addScaledVector(ctx.camFwd, 4), ctx.camFwd.clone(), up, g.stats.atk * 14 * this.mult('heaven'), 0xfff0c0, { width: 70, speed: 520, life: 0.9 * plus, vertical: true, kind: 'heaven' });
    g.viewmodel.swing(false);
    g.rt.shake = 1.4;
    g.post.fx.flash = 0.45;
    g.sound.breakthrough();
    g.hud.banner('ULTIMATE', 'Heaven-Splitting Blade', '<span class="cn">开天一刀</span>', '#ffd28a', 2, true);
  }

  // ---------------------------------------------------------- psychic --
  lanceOnce(ctx, offset) {
    const g = this.g;
    const side = new THREE.Vector3().crossVectors(ctx.camFwd, this.up()).normalize();
    const from = this.origin(1).addScaledVector(side, offset);
    const to = from.clone().addScaledVector(ctx.camFwd, 420 + g.state.realm * 40);
    const dmg = g.stats.atk * 3 * this.mult('lance');
    for (const b of [...g.beasts.beasts]) if (segPointDist(from, to, b.pos) < b.radius + 2.5) g.hitBeast(b, dmg, b.pos.clone(), 'lance', ctx.camFwd.clone().multiplyScalar(30));
    g.combat.beam(from, to, this.color(), 1.2, 0.35);
  }

  lance(ctx) {
    const g = this.g;
    if (!this.pay('lance')) return;
    this.lanceOnce(ctx, 0);
    if (g.stats.mods.lancePlus) this.pending.push({ t: 0.18, fn: () => this.lanceOnce(ctx, 1.2) });
    g.viewmodel.castRight();
    g.sound.burst();
  }

  shock() {
    const g = this.g;
    if (!this.pay('shock')) return;
    const k = 1 + (g.stats.mods.shockPlus || 0);
    const radius = 70 * k;
    const p = g.player;
    for (const b of [...g.beasts.beasts]) {
      if (b.static || b.pos.distanceTo(p.pos) > radius + b.radius) continue;
      g.hitBeast(b, g.stats.atk * 3 * this.mult('shock'), b.pos.clone(), 'shock', b.pos.clone().sub(p.pos).normalize().multiplyScalar(80));
      if (b.alive) b.stunT = (b.boss ? 0.8 : 2.5) * k;
    }
    g.combat.shockwave(p.pos, radius, this.color(), 0.6);
    g.rt.shake = 0.7;
    g.post.fx.flash = 0.2;
    g.sound.burst();
  }

  terror() {
    const g = this.g;
    if (!this.pay('terror')) return;
    const p = g.player;
    let n = 0;
    for (const b of g.beasts.beasts) {
      if (b.static || b.pos.distanceTo(p.pos) > 160) continue;
      b.markT = 8;
      if (!b.boss) {
        b.fleeT = 8;
        if (g.stats.mods.terrorPlus) b.stunT = 2;
      }
      n++;
    }
    g.combat.shockwave(p.pos, 160, 0x6a1aff, 1.0);
    g.hud.notify(n ? `<b>${n}</b> beast${n > 1 ? 's' : ''} break before your will.` : 'Your terror finds no mind to break.', 'violet');
    g.sound.thunder();
  }

  annihilate() {
    const g = this.g;
    if (!this.pay('annihilate')) return;
    const p = g.player;
    const exec = 0.25 + (g.stats.mods.execute || 0);
    let n = 0;
    for (const b of [...g.beasts.beasts]) {
      if (b.static || b.pos.distanceTo(p.pos) > 650) continue;
      n++;
      const pos = b.pos.clone();
      this.pending.push({
        t: Math.random() * 0.5,
        fn: () => {
          if (!b.alive) return;
          g.combat.beam(pos.clone().addScaledVector(this.up(), 120), b.pos, this.color(), 2, 0.4);
          if (!b.boss && b.hp < b.maxHp * exec) g.hitBeast(b, b.hp * 3, b.pos.clone(), 'annihilate');
          else g.hitBeast(b, g.stats.atk * 10 * this.mult('annihilate'), b.pos.clone(), 'annihilate');
        },
      });
    }
    g.post.fx.flash = 0.5;
    g.rt.shake = 1.2;
    g.sound.breakthrough();
    g.hud.banner('ULTIMATE', 'Soul Annihilation', `<span class="cn">灭魂</span>${n} minds`, '#d8a0ff', 2, true);
  }

  // ------------------------------------------------------- realm perks --
  blink(ctx) {
    const g = this.g, rt = g.rt, p = g.player;
    if (!hasPerk(g.state.realm, 3)) return g.denied('Star Step awakens at the Stellar realm.');
    if (rt.blinkCd > 0) return;
    rt.blinkCd = 2.5;
    const dist = 60 + 18 * g.state.realm;
    const from = p.pos.clone();
    p.pos.addScaledVector(ctx.camFwd, dist);
    const f = g.frame;
    if (f && f.terrain) {
      const D = p.pos.length();
      const d = p.pos.clone().divideScalar(D);
      const floor = f.floorRadius(d.x, d.y, d.z) + 2;
      if (D < floor) p.pos.multiplyScalar(floor / D);
    }
    p.vel.multiplyScalar(0.2);
    const c = new THREE.Color(REALMS[g.state.realm].color).multiplyScalar(2);
    g.particles.burst(from, c, 40, 30, 1, 0.5);
    g.particles.burst(p.pos, c, 40, 30, 1, 0.5);
    g.sound.warp();
  }

  realmPerks(dt) {
    const g = this.g, s = g.state, p = g.player;
    if (g.mode !== 'playing') return;
    this.perkT = (this.perkT || 0) - dt;
    if (this.perkT > 0) return;
    this.perkT = 0.25;
    for (const b of [...g.beasts.beasts]) {
      if (b.static || b.boss) continue;
      const gap = s.realm - b.tier;
      const d = b.pos.distanceTo(p.pos);
      if (hasPerk(s.realm, 6) && gap >= 3 && d < 140) {
        g.particles.burst(b.pos, new THREE.Color(REALMS[s.realm].color).multiplyScalar(2), 20, 20, 1, 0.5);
        g.hitBeast(b, b.hp * 2, b.pos.clone(), 'pressure');
        continue;
      }
      if (hasPerk(s.realm, 4) && gap >= 2 && d < 400) {
        b.fleeT = Math.max(b.fleeT || 0, 0.6);
        b.aggro = false;
      }
    }
  }

  // Domain slows beasts near you.
  slowAt(b) {
    const g = this.g;
    if (!hasPerk(g.state.realm, 5)) return 1;
    return b.pos.distanceTo(g.player.pos) < 70 ? 0.6 : 1;
  }

  // ------------------------------------------------------- modifiers --
  damageMult(b) {
    const g = this.g;
    let m = 1;
    if (b.markT > 0) m *= 1.4;
    if (g.mealActive && g.mealActive('spicy')) m *= 1.25;
    if (g.rt.willT > 0) m *= 1.5;
    if (hasPerk(g.state.realm, 5) && b.pos.distanceTo(g.player.pos) < 70) m *= 1.2;
    return m;
  }

  lifesteal() {
    return this.g.stats.lifesteal + (this.g.rt.willT > 0 ? 0.15 : 0);
  }

  // Returns { amount, reflect, parried } for an incoming hit.
  defend(amount, pos, shot) {
    const g = this.g, rt = g.rt, st = g.stats;
    let reflect = false;
    amount *= 1 - st.armor;
    if (g.mealActive && g.mealActive('dumpling')) amount *= 0.7;
    if (rt.shieldT > 0) {
      amount *= 0.3;
      if (shot && (g.state.path !== 'mind' || st.mods.reflect)) reflect = true;
      else if (shot) amount = 0;
    }
    if (rt.guarding && pos) {
      const to = pos.clone().sub(g.player.pos).normalize();
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(g.camera.quaternion);
      if (to.dot(fwd) > 0.15) {
        const window = st.mods.parry ? 0.45 : 0.25;
        if (g.time - (rt.guardStart || -9) < window) {
          // parry: nothing gets through, shots fly back, attackers stagger
          amount = 0;
          reflect = !!shot;
          const b = g.beasts.nearest(pos, 30);
          if (b && !shot) b.stunT = st.mods.parry ? 2 : 1;
          g.particles.burst(pos, new THREE.Color(2.4, 2.0, 1.2), 30, 40, 1, 0.3);
          g.sound.intercept(pos);
          g.hud.hitmarker(false);
          return { amount, reflect, parried: true };
        }
        amount *= 0.25;
        if (shot) reflect = Math.random() < 0.35;
        g.sound.intercept(pos);
      }
    }
    return { amount, reflect, parried: false };
  }
}
