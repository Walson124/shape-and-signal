import * as THREE from 'three';
import { Player } from './player.js';
import { Combat } from './combat.js';
import { BeastManager } from './beasts.js';
import { Particles } from './particles.js';
import { Loot } from './loot.js';
import { Arts } from './arts.js';
import { derive } from './state.js';
import { addItem } from './ring.js';
import { settings } from '../core/settings.js';

const IDLE = { x: 0, y: 0, z: 0 };

// Keep real entities alive in their original frame while a different avatar is
// rendered in Prism. The context uses normal physics, hazards and damage rules,
// with its own state/runtime and no training cheats or player input.
export class PhysicalBody {
  constructor(training, source) {
    const g = this.g = training.g;
    this.training = training;
    this.source = source;
    this.dead = false;
    this.saveTimer = 0;
    this.lastAlarm = -Infinity;
    this.root = new THREE.Group();
    (g.localRoot.parent || source.system.root).add(this.root);
    const camera = g.camera.clone(false);
    this.root.add(camera);
    this.entities = { player: g.player, beasts: g.beasts, combat: g.combat, particles: g.particles, loot: g.loot, shipObj: g.shipObj };
    this.moveEntities(this.root);
    const c = this.context = Object.create(g);
    Object.assign(c, this.entities, {
      state: source.state, stats: derive(source.state), rt: source.runtime, system: source.system,
      star: source.system.star, frame: g.frame, deck: g.deck, localRoot: this.root, camera,
      mode: 'virtual', training: { active: false, duel: { active: false } },
      input: { act: () => false, hit: () => false, rel: () => false, down: () => false, heldFor: () => 0, wheel: 0 },
      post: { fx: {} }, viewmodel: { hit() {} }, vehicleObj: null,
      camQuat: g.camQuat.clone(), camMode: g.camMode,
      notifyGate: {}, prevVel: g.player.vel.clone(), wasGrounded: g.player.grounded,
      nix: { event() {}, onKill() {}, once() {}, say() {} }, campaign: { event() {} },
      swords: { setup() {}, setVisible() {}, reset() {} },
    });
    c.hud = {
      notify: (text, color) => g.hud.notify(`Physical body: ${text}`, color),
      banner: (_kicker, title) => g.hud.notify(`Physical body: ${title}`, 'red'),
      hitmarker() {}, physicalHit() {}, simulationHit() {},
      alert() {},
    };
    c.dmgNum = () => {};
    c.applyCamMode = () => {};
    c.rt.lock = null;
    c.rt.guarding = c.rt.controlling = c.rt.meditating = c.rt.medToggle = false;
    this.gameDamage = g.hurtPlayer;
    c.hurtPlayer = (...args) => this.damage(...args);
    c.die = () => { this.dead = true; c.mode = 'dead'; };
    c.arts = new Arts(c);
    c.beasts.onKill = (b) => c.onBeastKilled(b);

    // Swap only the simulation's active entities. Real attackers/projectiles are
    // detached, not cleared, when Game.installSystem installs the training world.
    g.particles = new Particles(g.localRoot, settings.preset.particles);
    g.combat = new Combat(g.localRoot, g.particles, g.sound);
    g.beasts = new BeastManager(g.localRoot, g.particles, g.combat, g.sound);
    g.beasts.onKill = (b) => g.onBeastKilled(b);
    g.loot = new Loot(g.localRoot, g.particles, g.sound);
    g.player = new Player(g.localRoot, g.particles);
    g.shipObj = null;
    g.swords.combat = g.combat;
    g.swords.particles = g.particles;
  }

  moveEntities(root) {
    const e = this.entities;
    root.add(e.player.root, e.particles.points);
    if (e.shipObj) { root.add(e.shipObj.model.group); e.shipObj.root = root; }
    for (const b of e.beasts.beasts) root.add(b.mesh);
    for (const shot of e.combat.shots) root.add(shot.group);
    for (const effect of e.combat.effects) root.add(effect.obj);
    for (const debris of e.combat.debrisList) root.add(debris.mesh);
    for (const item of e.loot.items) root.add(item.g);
    e.beasts.scene = e.combat.scene = e.loot.scene = root;
  }

  damage(...args) {
    if (this.dead) return null;
    const c = this.context;
    const hp = c.rt.hp, hull = c.shipObj?.hull;
    const result = this.gameDamage.call(c, ...args);
    if (c.rt.hp < hp || (hull !== undefined && c.shipObj.hull < hull)) {
      this.g.hud.physicalHit();
      if (this.g.time - this.lastAlarm >= 1) {
        this.lastAlarm = this.g.time;
        this.g.sound.warn();
      }
    }
    return result;
  }

  update(dt) {
    if (this.dead) return;
    const c = this.context, p = c.player, rt = c.rt;
    c.time = this.g.time;
    c.stats = derive(c.state);
    c.state.worldTime += dt;
    c.state.playtime += dt;
    c.camera.position.copy(p.pos);
    c.camera.quaternion.copy(p.quat);
    c.system.update(dt, c.state.worldTime, c.camera, c.playerWorld());
    c.updateStations();
    for (const key of ['invuln', 'shieldT', 'ironT', 'willT', 'blinkCd', 'undyingCd', 'medBlock']) rt[key] = Math.max(0, (rt[key] || 0) - dt);
    for (const key of Object.keys(rt.cooldowns)) rt.cooldowns[key] = Math.max(0, rt.cooldowns[key] - dt);
    c.env = c.computeEnv(rt.inShip && c.shipObj ? c.shipObj.pos : p.pos);
    if (rt.inShip && c.shipObj) c.controlShip(dt, IDLE, { x: 0, y: 0 }, c.env, false);
    else c.controlPlayer(dt, IDLE, { x: 0, y: 0 }, c.env, false, false);
    if (this.dead) return;
    c.camera.position.copy(p.pos);
    c.camera.quaternion.copy(p.quat);
    c.beasts.setEnv(c.beastEnv(c.locTier()));
    c.beasts.update(dt, { player: p, playerAlive: rt.hp > 0 && rt.invuln <= 0, time: c.time,
      hurtPlayer: (amount, pos, knock) => this.damage(amount, pos, knock), slowAt: () => 1 });
    c.combat.update(dt, { beasts: c.beasts.beasts, player: p, playerAlive: rt.hp > 0 && rt.invuln <= 0,
      solid: (pos) => c.isSolid(pos),
      hitBeast: (...args) => c.hitBeast(...args),
      hurtPlayer: (amount, pos, shot) => this.damage(amount, pos, null, false, shot) });
    if (this.dead) return;
    c.updateWater(dt, true);
    if (this.dead) return;
    rt.energy = Math.min(c.stats.maxEnergy, rt.energy + c.stats.regen * dt);
    rt.spirit = Math.min(c.stats.maxSpirit, rt.spirit + c.stats.spiritRegen * dt);
    if (c.time - rt.lastHurt > 6) rt.hp = Math.min(c.stats.maxHp, rt.hp + c.stats.maxHp * 0.012 * dt);
    c.loot.update(dt, p, 70 + c.state.realm * 12, (item) => {
      if (item.kind === 'part') return !!addItem(c.state, item.data);
      if (item.kind === 'ore') c.state.ore += Math.round(item.amount);
      else c.state.essence += item.amount;
      return true;
    });
    c.particles.update(dt);
    this.saveTimer += dt;
    if (this.saveTimer >= 10) { this.saveTimer = 0; this.save(); }
  }

  save() {
    return this.g.save.call(this.context);
  }

  restore() {
    const g = this.g;
    // installSystem has already cleared the temporary encounters. Dispose the
    // temporary avatar/pool, then reconnect the still-living physical entities.
    g.player.root.removeFromParent();
    g.player.root.traverse((o) => { o.geometry?.dispose(); if (o.material && !o.isSprite) o.material.dispose(); });
    g.player.aura.material.dispose();
    g.particles.points.removeFromParent();
    g.particles.points.geometry.dispose();
    g.particles.material.dispose();
    for (const key of ['boltGeo', 'orbGeo', 'debrisGeo']) g.combat[key].dispose();
    for (const material of g.combat.mats.values()) material.dispose();
    for (const material of g.combat.spriteMats.values()) material.dispose();
    g.loot.geo.dispose();
    for (const materials of g.loot.mats.values()) { materials.core.dispose(); materials.glow.dispose(); }
    g.shipObj?.dispose();
    Object.assign(g, this.entities);
    g.rt = this.context.rt;
    g.stats = derive(g.state);
    this.moveEntities(g.localRoot);
    g.beasts.onKill = (b) => g.onBeastKilled(b);
    g.swords.combat = g.combat;
    g.swords.particles = g.particles;
    this.root.removeFromParent();
    g.camQuat.copy(g.player.quat);
  }
}
