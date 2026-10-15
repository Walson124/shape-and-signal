import * as THREE from 'three';
import { REALMS, SWORD_GRADES, masteryMult } from './data.js';
import { PATHS, TECHS, hasPerk, activePath, knows } from './paths.js';
import { segPointDist } from './combat.js';

const tA = new THREE.Vector3();
const RANGED = new Set(['knife', 'arrow', 'bolt']);
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

  get pathId() {
    return activePath(this.g.state);
  }

  get path() {
    return PATHS[this.pathId];
  }

  reset() {
    if (this.grip && this.grip.b) this.grip.b.held = false;
    this.grip = null;
    for (const p of this.prisons) for (const b of p.list) b.held = false;
    this.prisons = [];
    this.dash = null;
    this.pending = [];
    this.combo = 0;
    this.comboT = 0;
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
    if (id === 'javelin' && st.mods.javPlus) cd *= 0.6;
    return cd;
  }

  // Primary attacks get faster with attack-speed skills.
  swingCd(id) {
    return TECHS[id].cd / (1 + (this.g.stats.mods.atkSpeed || 0));
  }

  // Check unlock, cooldown and cost; pay if possible.
  pay(id) {
    const g = this.g, rt = g.rt, t = TECHS[id];
    if (!knows(g.state, id)) {
      g.denied(`Learn ${t.name} in your skill tree first.`);
      return false;
    }
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
    return this.pathId === 'mind' ? REALMS[this.g.state.realm].color : this.path.color;
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
    const pathId = this.pathId;
    const P = this.path;
    rt.ironT = Math.max(0, (rt.ironT || 0) - dt);
    rt.venomT = Math.max(0, (rt.venomT || 0) - dt);
    this.comboT = Math.max(0, this.comboT - dt);
    if (this.comboT <= 0) this.combo = 0;

    if (alive && !rt.meditating && !rt.inShip) {
      // primary
      if (inp.act('fire') && (rt.cooldowns[P.primary] || 0) <= 0) this.primary(P.primary, ctx);
      // secondary
      rt.aiming = P.secondary === 'aim' && inp.act('focus');
      if (P.secondary === 'guard') {
        const want = inp.act('focus') && rt.energy > 1;
        if (want && !rt.guarding) rt.guardStart = g.time;
        rt.guarding = want;
        if (want) rt.energy = Math.max(0, rt.energy - 5 * dt);
      } else rt.guarding = false;
      if (P.secondary === 'grip') this.updateGrip(dt, inp.act('focus'), ctx);
      else if (this.grip) this.releaseGrip(false);
      // techniques
      const keys = ['skill1', 'skill2', 'skill3', 'skill4'];
      keys.forEach((k, i) => { if (inp.hit(k)) this.cast(P.skills[i], ctx); });
      if (inp.hit('formation') && pathId === 'mind') g.hud.notify(`Sword formation: <b>${g.swords.toggleFormation() === 'swarm' ? 'Swarm' : 'Lance'}</b>.`, 'violet');
    } else {
      rt.guarding = false;
      rt.aiming = false;
      if (this.grip) this.releaseGrip(false);
    }
    this.updatePoison(dt);
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

  primary(id, ctx) {
    const rt = this.g.rt;
    if (id === 'bolt') { if (rt.energy >= TECHS.bolt.cost) this.bolt(ctx); }
    else if (id === 'saber') this.saber(ctx);
    else if (id === 'spike') this.spike(ctx);
    else if (id === 'punch') this.punch(ctx);
    else if (id === 'thrust') this.thrust(ctx);
    else if (id === 'knife') this.knife(ctx);
    else if (id === 'arrow') this.arrow(ctx);
  }

  cast(id, ctx) {
    if (!id) return;
    const fn = {
      rush: () => this.rush(ctx), quake: () => this.quake(), iron: () => this.ironBody(), meteor: () => this.meteor(ctx),
      lunge: () => this.lunge(ctx), whirl: () => this.whirl(ctx), javelin: () => this.javelin(ctx), dragon: () => this.dragon(ctx),
      fan: () => this.fan(ctx), venom: () => this.venom(), shadow: () => this.shadowStep(ctx), rain: () => this.knifeRain(ctx),
      multishot: () => this.multishot(ctx), snare: () => this.snare(ctx), blast: () => this.blastArrow(ctx), starfall: () => this.starfall(ctx),
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
    rt.cooldowns.saber = this.swingCd('saber');
    rt.firingT = 0.2;
    this.combo++;
    const fwd = ctx.camFwd.clone();
    const from = g.player.pos.clone();
    const reach = 6.5 + s.realm * 1.1;
    const dmg = st.atk * 2.3 * this.mult('saber');
    const hits = this.inCone(reach, 0.25, from, fwd);
    for (const b of hits) g.hitBeast(b, dmg, this.hitPoint(b, from), 'saber', fwd.clone().multiplyScalar(40));
    g.breakAt(from.clone().addScaledVector(fwd, reach * 0.6), reach * 0.55, fwd);
    const up = this.up();
    g.combat.slash(from.clone().addScaledVector(fwd, 1.5).addScaledVector(up, -0.3), fwd, up, reach, this.color(), this.combo % 2 === 0);
    g.viewmodel.attack('swing', this.combo % 2 === 0);
    this.meleeDig(ctx, reach, 2.2);
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
    const hp = this.hitPoint(target, origin);
    g.combat.beam(origin, hp, col, 0.35, 0.2);
    g.hitBeast(target, dmg, hp, 'spike');
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
  startDash(ctx, opts = {}) {
    const g = this.g;
    const id = opts.id || 'dash';
    if (g.rt.inVehicle) return g.denied('You can\u2019t do that from the saddle.');
    if (!this.pay(id)) return;
    const p = g.player;
    let dir = ctx.camFwd.clone();
    if (p.mode === 'ground' && g.env.up) dir.addScaledVector(g.env.up, -dir.dot(g.env.up)).normalize();
    const reset = id === 'dash' ? g.stats.mods.dashReset : id === 'lunge' ? g.stats.mods.lungePlus : 0;
    const dist = (opts.dist || 30) * (1 + 0.15 * g.state.realm) * (reset ? 1.5 : 1);
    this.dash = { id, t: 0, dur: opts.dur || 0.16, from: p.pos.clone(), to: p.pos.clone().addScaledVector(dir, dist), hit: new Set(), dir, dmg: opts.dmg || 3, reset, kind: opts.kind || 'saber' };
    g.rt.invuln = Math.max(g.rt.invuln, 0.3);
    g.viewmodel.attack(opts.anim || 'swing');
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
    g.breakAt(p.pos, 3, d.dir);
    let killed = false;
    for (const b of [...g.beasts.beasts]) {
      if (d.hit.has(b)) continue;
      if (segPointDist(prev, p.pos, b.pos) < b.radius + 3) {
        d.hit.add(b);
        g.hitBeast(b, g.stats.atk * d.dmg * this.mult(d.id), this.hitPoint(b, p.pos), d.kind, d.dir.clone().multiplyScalar(60));
        if (!b.alive) killed = true;
      }
    }
    if (killed && d.reset) g.rt.cooldowns[d.id] = 0;
    if (k >= 1) {
      if (d.kind === 'saber') g.combat.slash(p.pos.clone(), d.dir, this.up(), 10, this.color());
      else g.combat.shockwave(p.pos.clone().addScaledVector(d.dir, 3), 9, this.color(), 0.35);
      this.dash = null;
    }
  }

  crescent(ctx) {
    const g = this.g;
    if (!this.pay('crescent')) return;
    const plus = g.stats.mods.crescentPlus ? 1 : 0;
    const up = this.up();
    g.combat.fireWave(g.player.pos.clone().addScaledVector(ctx.camFwd, 3), ctx.camFwd.clone(), up, g.stats.atk * 4 * (plus ? 1.4 : 1) * this.mult('crescent'), this.color(), { width: (18 + g.state.realm * 2) * (plus ? 2 : 1), speed: 320, life: 1.3 });
    g.viewmodel.attack('swing', true);
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
    g.viewmodel.attack('swing', false);
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
    g.breakAt(p.pos, radius * 0.45, null);
    g.scorch(p.pos, radius * 0.25);
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

  // Where the crosshair meets solid ground within reach (for digging), or null.
  groundHit(ctx, reach) {
    const g = this.g, cam = g.camera.position;
    const f = ctx.camFwd;
    const extra = g.camMode === 'first' ? 0 : 5.5;
    let prev = cam.clone();
    for (let d = 0.4; d < reach + extra; d += 0.35) {
      const q = cam.clone().addScaledVector(f, d);
      if (g.isSolid(q)) {
        let a = prev, b = q;
        for (let k = 0; k < 8; k++) {
          const m = a.clone().lerp(b, 0.5);
          if (g.isSolid(m)) b = m; else a = m;
        }
        return b;
      }
      prev = q;
    }
    return null;
  }

  // Dig where a melee blow meets the ground.
  meleeDig(ctx, reach, r) {
    const hit = this.groundHit(ctx, reach);
    if (hit) this.g.dig(hit, r);
    return hit;
  }

  // Where an attack from `from` meets a beast's body (not its centre).
  hitPoint(b, from) {
    const d = tA.subVectors(from, b.pos);
    const len = d.length();
    if (len < 1e-3) return b.pos.clone();
    return b.pos.clone().addScaledVector(d, Math.min(1, (b.radius * 0.85) / len));
  }

  // Extra critical chance and forced crits (aiming, Shadow Step).
  critBonus(kind) {
    const g = this.g, rt = g.rt;
    if (rt.aiming && RANGED.has(kind)) return 0.25 + (g.stats.mods.aimCrit || 0);
    return 0;
  }

  consumeBackstab() {
    const rt = this.g.rt;
    if (!rt.backstab) return false;
    rt.backstab = false;
    return true;
  }

  // Called by Game.hitBeast after damage lands.
  onHit(b, kind, killed) {
    const g = this.g, rt = g.rt;
    if (kind === 'knife' && rt.venomT > 0 && !killed && !b.static) {
      b.poisonT = 4;
      b.poisonDps = g.stats.atk * 0.6 * (1 + (g.stats.mods.venomPlus || 0));
    }
    if (killed && rt.shadowKill && g.stats.mods.shadowPlus) {
      rt.cooldowns.shadow = 0;
      rt.shadowKill = false;
    }
  }

  updatePoison(dt) {
    this.poisonTick = (this.poisonTick || 0) - dt;
    if (this.poisonTick > 0) return;
    this.poisonTick = 0.5;
    for (const b of [...this.g.beasts.beasts]) {
      if (!(b.poisonT > 0) || !b.alive) continue;
      b.poisonT -= 0.5;
      this.g.particles.burst(b.pos, new THREE.Color(0.4, 2.2, 0.4), 6, b.radius * 2, 0.6, 0.5);
      this.g.hitBeast(b, b.poisonDps * 0.5, b.pos.clone().addScaledVector(this.up(), b.radius), 'poison');
    }
  }

  // Melee in a cone: shared by punches.
  meleeCone(ctx, reach, cosMin, dmg, kind, knock) {
    const g = this.g, from = g.player.pos.clone(), fwd = ctx.camFwd.clone();
    const hits = this.inCone(reach, cosMin, from, fwd);
    for (const b of hits) g.hitBeast(b, dmg, this.hitPoint(b, from), kind, fwd.clone().multiplyScalar(knock));
    return hits;
  }

  // Beasts within `width` of the segment a-b.
  inLine(a, b, width) {
    return this.g.beasts.beasts.filter((x) => segPointDist(a, b, x.pos) < x.radius + width);
  }

  // A blast that hurts every beast in a radius and leaves a mark on the land.
  blastAt(pos, radius, dmg, color, kind = 'blast', crater = true) {
    const g = this.g;
    for (const b of [...g.beasts.beasts]) {
      if (b.pos.distanceTo(pos) > radius + b.radius) continue;
      g.hitBeast(b, dmg, this.hitPoint(b, pos), kind, b.pos.clone().sub(pos).normalize().multiplyScalar(50));
    }
    g.combat.explosion(pos, color, Math.max(1, radius / 10));
    g.combat.shockwave(pos, radius, color, 0.5);
    g.impact(pos, radius * (crater ? 0.55 : 0.3), crater);
    g.rt.shake = Math.max(g.rt.shake, Math.min(1.2, radius / 40));
    g.sound.explosion(pos, radius > 20);
  }

  // ---------------------------------------------------------------- fist --
  punch(ctx) {
    const g = this.g, rt = g.rt, st = g.stats, s = g.state;
    rt.cooldowns.punch = this.swingCd('punch');
    rt.firingT = 0.15;
    this.combo++;
    this.comboT = 1.2;
    const reach = 4 + s.realm * 0.7;
    const finisher = this.combo % 4 === 0;
    const hits = this.meleeCone(ctx, reach, 0.35, st.atk * (finisher ? 3.2 : 1.7) * this.mult('punch'), 'punch', finisher ? 70 : 15);
    g.viewmodel.attack('punch', this.combo % 2 === 0);
    this.meleeDig(ctx, reach + 1, finisher ? 2.6 : 1.8);
    const at = g.player.pos.clone().addScaledVector(ctx.camFwd, reach * 0.7);
    g.breakAt(at, finisher ? 3.5 : 1.8, ctx.camFwd);
    if (finisher) {
      g.combat.shockwave(at, 6 + s.realm, this.color(), 0.3);
      rt.shake = Math.max(rt.shake, 0.35);
    }
    if (hits.length) {
      g.sound.hit(hits[0].pos);
      rt.shake = Math.max(rt.shake, 0.18);
    } else g.sound.swordLaunch();
  }

  rush(ctx) {
    this.startDash(ctx, { id: 'rush', dist: 24, dmg: 3, kind: 'punch', anim: 'punch' });
  }

  quake() {
    const g = this.g;
    if (!this.pay('quake')) return;
    const plus = g.stats.mods.quakePlus ? 1.5 : 1;
    const radius = 30 * plus * (1 + g.state.realm * 0.1);
    const p = g.player, up = this.up();
    for (const b of [...g.beasts.beasts]) {
      if (b.static || b.pos.distanceTo(p.pos) > radius + b.radius) continue;
      g.hitBeast(b, g.stats.atk * 3.2 * this.mult('quake'), this.hitPoint(b, p.pos), 'quake', up.clone().multiplyScalar(45).add(b.pos.clone().sub(p.pos).normalize().multiplyScalar(25)));
      if (b.alive && plus > 1) b.stunT = b.boss ? 0.6 : 2;
    }
    g.viewmodel.attack('punch', true);
    g.combat.shockwave(p.pos, radius, this.color(), 0.6);
    g.impact(p.pos.clone().addScaledVector(up, -1.7), radius * 0.35, true);
    g.rt.shake = 0.9;
    g.sound.explosion(p.pos, true);
  }

  ironBody() {
    const g = this.g;
    if (!this.pay('iron')) return;
    g.rt.ironT = TECHS.iron.duration;
    g.particles.burst(g.player.pos, new THREE.Color(2.2, 1.4, 0.6), 60, 18, 0.6, 0.7);
    g.hud.notify('<b>Iron Body</b>: your skin turns to bronze.', 'gold');
    g.sound.shield();
  }

  meteor(ctx) {
    const g = this.g;
    if (!this.pay('meteor')) return;
    const at = this.groundAim(ctx, 160);
    const up = at.clone().normalize();
    const fist = new THREE.Mesh(new THREE.SphereGeometry(6, 16, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(this.color()).multiplyScalar(3) }));
    const from = at.clone().addScaledVector(up, 220);
    fist.position.copy(from);
    g.combat.addEffect(fist, 0.55, (e) => {
      const k = 1 - e.life / e.maxLife;
      fist.position.lerpVectors(from, at, k * k);
      g.particles.emit(fist.position.x, fist.position.y, fist.position.z, 0, 0, 0, new THREE.Color(this.color()).multiplyScalar(2), 3, 0.5, 0, 0.6);
    });
    this.pending.push({ t: 0.55, fn: () => this.blastAt(at, 45 + g.state.realm * 4, g.stats.atk * 12 * this.mult('meteor'), this.color(), 'meteor') });
    g.viewmodel.attack('punch', false);
    g.hud.banner('ULTIMATE', 'Meteor Fist', '<span class="cn">流星拳</span>', '#ffb070', 2, true);
  }

  // Where the crosshair meets the ground (or a beast), within range.
  groundAim(ctx, range) {
    const g = this.g;
    const t = this.aimed(range);
    if (t) return t.pos.clone();
    const cam = g.camera.position;
    const f = g.frame;
    const p = cam.clone();
    for (let d = 4; d < range; d += 4) {
      p.copy(cam).addScaledVector(ctx.camFwd, d);
      if (f && f.terrain) {
        const n = p.clone().normalize();
        if (p.length() < f.floorRadius(n.x, n.y, n.z)) return p;
      }
    }
    return cam.clone().addScaledVector(ctx.camFwd, range);
  }

  // --------------------------------------------------------------- spear --
  thrust(ctx) {
    const g = this.g, rt = g.rt, st = g.stats, s = g.state;
    rt.cooldowns.thrust = this.swingCd('thrust');
    rt.firingT = 0.2;
    const reach = (11 + s.realm * 1.4) * (1 + (st.mods.spearReach || 0));
    const from = g.player.pos.clone().addScaledVector(this.up(), -0.3);
    const to = from.clone().addScaledVector(ctx.camFwd, reach);
    const hits = this.inLine(from, to, 1.6);
    for (const b of hits) g.hitBeast(b, st.atk * 2.2 * this.mult('thrust'), this.hitPoint(b, from), 'thrust', ctx.camFwd.clone().multiplyScalar(30));
    g.combat.beam(from.clone().addScaledVector(ctx.camFwd, 1.5), to, this.color(), 0.35, 0.16);
    g.breakAt(to, 2.2, ctx.camFwd);
    g.viewmodel.attack('thrust');
    this.meleeDig(ctx, reach, 1.9);
    if (hits.length) {
      g.sound.swordHit(hits[0].pos);
      rt.shake = Math.max(rt.shake, 0.22);
    } else g.sound.swordLaunch();
  }

  lunge(ctx) {
    this.startDash(ctx, { id: 'lunge', dist: 40, dmg: 3.2, kind: 'thrust', anim: 'thrust', dur: 0.2 });
  }

  whirl(ctx) {
    const g = this.g;
    if (!this.pay('whirl')) return;
    const k = 1 + (g.stats.mods.whirlPlus || 0);
    const radius = (13 + g.state.realm * 1.2) * k;
    const p = g.player;
    for (const b of [...g.beasts.beasts]) {
      if (b.static || b.pos.distanceTo(p.pos) > radius + b.radius) continue;
      g.hitBeast(b, g.stats.atk * 3 * k * this.mult('whirl'), this.hitPoint(b, p.pos), 'thrust', b.pos.clone().sub(p.pos).normalize().multiplyScalar(70));
    }
    const up = this.up();
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      const side = new THREE.Vector3().crossVectors(ctx.camFwd, up).normalize();
      const dir = ctx.camFwd.clone().projectOnPlane(up).normalize().multiplyScalar(Math.cos(a)).addScaledVector(side, Math.sin(a)).normalize();
      g.combat.slash(p.pos.clone().addScaledVector(up, -0.4), dir, up, radius, this.color(), i % 2 === 0);
    }
    g.breakAt(p.pos, radius * 0.7, null);
    g.viewmodel.attack('swing', true);
    g.rt.shake = Math.max(g.rt.shake, 0.4);
    g.sound.burst();
  }

  javelin(ctx) {
    const g = this.g;
    if (!this.pay('javelin')) return;
    const throwOne = () => {
      const origin = this.origin(1);
      const dir = ctx.aimPoint.clone().sub(origin).normalize();
      g.combat.firePlayerBolt(origin, dir, g.stats.atk * 5 * this.mult('javelin'), this.color(), 1000, { size: 1.6, pierce: 99, kind: 'thrust' });
    };
    throwOne();
    if (g.stats.mods.javPlus) this.pending.push({ t: 0.2, fn: throwOne });
    g.viewmodel.attack('throw');
    g.sound.burst();
  }

  dragon(ctx) {
    const g = this.g;
    if (!this.pay('dragon')) return;
    const from = this.origin(1);
    const len = 600 + g.state.realm * 50;
    const to = from.clone().addScaledVector(ctx.camFwd, len);
    for (const b of this.inLine(from, to, 7)) g.hitBeast(b, g.stats.atk * 12 * this.mult('dragon'), b.pos.clone(), 'dragon', ctx.camFwd.clone().multiplyScalar(60));
    g.combat.beam(from, to, this.color(), 5, 0.8);
    g.combat.beam(from, to, 0xffffff, 1.6, 0.6);
    for (let d = 20; d < len; d += 30) g.breakAt(from.clone().addScaledVector(ctx.camFwd, d), 8, ctx.camFwd);
    g.viewmodel.attack('thrust');
    g.rt.shake = 1.3;
    g.post.fx.flash = 0.4;
    g.sound.breakthrough();
    g.hud.banner('ULTIMATE', 'Sky-Piercing Dragon', '<span class="cn">破天龙枪</span>', '#8ae0ff', 2, true);
  }

  // -------------------------------------------------------------- knives --
  throwKnife(ctx, dir, dmg, opts = {}) {
    const g = this.g;
    const origin = opts.origin || this.origin(1);
    g.combat.firePlayerBolt(origin, dir, dmg, 0xe8f0ff, 950, { size: 0.45, kind: 'knife', pierce: opts.pierce || 0 });
  }

  knife(ctx) {
    const g = this.g, rt = g.rt, st = g.stats;
    const cost = TECHS.knife.cost * st.costMult;
    if (rt.energy < cost) return;
    rt.energy -= cost;
    rt.cooldowns.knife = this.swingCd('knife');
    rt.firingT = 0.12;
    const origin = this.origin(1);
    this.throwKnife(ctx, ctx.aimPoint.clone().sub(origin).normalize(), st.atk * 0.95 * this.mult('knife'), { origin });
    g.viewmodel.attack('throw');
    g.sound.bolt();
  }

  fan(ctx) {
    const g = this.g;
    if (!this.pay('fan')) return;
    const n = 7 + (g.stats.mods.fanPlus || 0);
    const up = this.up();
    const origin = this.origin(1);
    const base = ctx.aimPoint.clone().sub(origin).normalize();
    for (let i = 0; i < n; i++) {
      const a = (i / (n - 1) - 0.5) * 0.7;
      const dir = base.clone().applyAxisAngle(up, a);
      this.throwKnife(ctx, dir, g.stats.atk * 1.1 * this.mult('fan'), { origin });
    }
    g.viewmodel.attack('throw');
    g.sound.burst();
  }

  venom() {
    const g = this.g;
    if (!this.pay('venom')) return;
    g.rt.venomT = TECHS.venom.duration;
    g.particles.burst(g.player.pos, new THREE.Color(0.4, 2.2, 0.5), 50, 14, 0.6, 0.7);
    g.hud.notify('<b>Venom Edge</b>: your knives drip poison.', 'green');
    g.sound.shield();
  }

  shadowStep(ctx) {
    const g = this.g, p = g.player;
    if (g.rt.inVehicle) return g.denied('You can\u2019t do that from the saddle.');
    const t = this.aimed(160);
    if (!this.pay('shadow')) return;
    const from = p.pos.clone();
    if (t) {
      const away = t.pos.clone().sub(from).normalize();
      p.pos.copy(t.pos).addScaledVector(away, t.radius + 2.5);
      const up = this.up();
      p.placeAt(p.pos.clone(), t.pos.clone(), up);
      g.camQuat.copy(p.quat);
      g.rt.shadowKill = true;
    } else p.pos.addScaledVector(ctx.camFwd, 25);
    p.vel.multiplyScalar(0.1);
    g.rt.backstab = true;
    g.rt.invuln = Math.max(g.rt.invuln, 0.4);
    const c = new THREE.Color(0.5, 0.4, 0.9);
    g.particles.burst(from, c, 40, 18, 1, 0.5);
    g.particles.burst(p.pos, c, 40, 18, 1, 0.5);
    g.sound.warp();
  }

  knifeRain(ctx) {
    const g = this.g;
    if (!this.pay('rain')) return;
    const at = this.groundAim(ctx, 260);
    const up = at.clone().normalize();
    const radius = 35 + g.state.realm * 3;
    const dmg = g.stats.atk * 1.3 * this.mult('rain');
    for (let i = 0; i < 60; i++) {
      this.pending.push({
        t: i * 0.025,
        fn: () => {
          const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * radius;
          const side = new THREE.Vector3(1, 0, 0).projectOnPlane(up).normalize();
          const fwd = new THREE.Vector3().crossVectors(up, side);
          const hit = at.clone().addScaledVector(side, Math.cos(a) * r).addScaledVector(fwd, Math.sin(a) * r);
          const top = hit.clone().addScaledVector(up, 70);
          g.combat.firePlayerBolt(top, hit.clone().sub(top).normalize(), dmg, 0xe8f0ff, 400, { size: 0.6, kind: 'knife', pierce: 2 });
        },
      });
    }
    g.viewmodel.attack('throw');
    g.hud.banner('ULTIMATE', 'Thousand Knife Rain', '<span class="cn">万刃雨</span>', '#dfe8ff', 2, true);
    g.sound.burst();
  }

  // ----------------------------------------------------------------- bow --
  shootArrow(dir, dmg, opts = {}) {
    const g = this.g;
    const origin = opts.origin || this.origin(-1);
    g.combat.firePlayerBolt(origin, dir, dmg, opts.color || this.color(), opts.speed || 1150, { size: opts.size || 0.75, kind: 'arrow', pierce: opts.pierce ?? (1 + (g.stats.mods.arrowPierce || 0)), onImpact: opts.onImpact });
  }

  arrow(ctx) {
    const g = this.g, rt = g.rt, st = g.stats;
    const cost = TECHS.arrow.cost * st.costMult;
    if (rt.energy < cost) return;
    rt.energy -= cost;
    rt.cooldowns.arrow = this.swingCd('arrow');
    rt.firingT = 0.2;
    const origin = this.origin(-1);
    this.shootArrow(ctx.aimPoint.clone().sub(origin).normalize(), st.atk * 2.5 * this.mult('arrow'), { origin });
    g.viewmodel.attack('shoot');
    g.sound.bolt();
  }

  multishot(ctx) {
    const g = this.g;
    if (!this.pay('multishot')) return;
    const n = 5 + (g.stats.mods.multiPlus || 0);
    const up = this.up();
    const origin = this.origin(-1);
    const base = ctx.aimPoint.clone().sub(origin).normalize();
    for (let i = 0; i < n; i++) this.shootArrow(base.clone().applyAxisAngle(up, (i / (n - 1) - 0.5) * 0.3), g.stats.atk * 2 * this.mult('multishot'), { origin });
    g.viewmodel.attack('shoot');
    g.sound.burst();
  }

  snare(ctx) {
    const g = this.g;
    if (!this.pay('snare')) return;
    const origin = this.origin(-1);
    this.shootArrow(ctx.aimPoint.clone().sub(origin).normalize(), g.stats.atk * 1.5, {
      origin, pierce: 0, color: 0x9affd8,
      onImpact: (pos) => {
        let n = 0;
        for (const b of g.beasts.beasts) {
          if (b.static || b.pos.distanceTo(pos) > 22 + b.radius) continue;
          b.stunT = b.boss ? 1 : 3;
          b.markT = 4;
          n++;
        }
        g.combat.shockwave(pos, 22, 0x9affd8, 0.8);
        g.particles.burst(pos, new THREE.Color(0.6, 2.4, 1.6), 50, 30, 1, 0.8);
        if (n) g.hud.notify(`<b>${n}</b> beast${n > 1 ? 's' : ''} bound in place.`, 'green');
      },
    });
    g.viewmodel.attack('shoot');
    g.sound.burst();
  }

  blastArrow(ctx) {
    const g = this.g;
    if (!this.pay('blast')) return;
    const k = 1 + (g.stats.mods.blastPlus || 0);
    const origin = this.origin(-1);
    this.shootArrow(ctx.aimPoint.clone().sub(origin).normalize(), g.stats.atk * 1.5, {
      origin, pierce: 0, color: 0xff9a4a, size: 1,
      onImpact: (pos) => this.blastAt(pos, 18 * k, g.stats.atk * 4 * k * this.mult('blast'), 0xff8a3a),
    });
    g.viewmodel.attack('shoot');
    g.sound.burst();
  }

  starfall(ctx) {
    const g = this.g;
    if (!this.pay('starfall')) return;
    const at = this.groundAim(ctx, 400);
    const up = at.clone().normalize();
    const radius = 60 + g.state.realm * 4;
    const dmg = g.stats.atk * 2.2 * this.mult('starfall');
    for (let i = 0; i < 40; i++) {
      this.pending.push({
        t: i * 0.05,
        fn: () => {
          const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * radius;
          const side = new THREE.Vector3(1, 0, 0).projectOnPlane(up).normalize();
          const fwd = new THREE.Vector3().crossVectors(up, side);
          const hit = at.clone().addScaledVector(side, Math.cos(a) * r).addScaledVector(fwd, Math.sin(a) * r);
          const top = hit.clone().addScaledVector(up, 120);
          this.shootArrow(hit.clone().sub(top).normalize(), dmg, { origin: top, speed: 500, pierce: 0, onImpact: (pos) => this.blastAt(pos, 7, dmg * 0.5, this.color(), 'arrow', false) });
        },
      });
    }
    g.viewmodel.attack('shoot');
    g.hud.banner('ULTIMATE', 'Starfall Volley', '<span class="cn">流星箭雨</span>', '#b0ff8a', 2, true);
    g.sound.burst();
  }

  // ------------------------------------------------------- realm perks --
  blink(ctx) {
    const g = this.g, rt = g.rt, p = g.player;
    if (rt.inVehicle) return;
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
      if (b.static || b.boss || b.duelist) continue;
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
  damageMult(b, kind) {
    const g = this.g;
    let m = 1;
    if (g.rt.aiming && RANGED.has(kind)) m *= 1.4;
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
    if (rt.ironT > 0) amount *= 0.5;
    if (g.mealActive && g.mealActive('dumpling')) amount *= 0.7;
    if (rt.shieldT > 0) {
      amount *= 0.3;
      if (shot && st.mods.reflect) reflect = true;
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
