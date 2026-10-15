import * as THREE from 'three';
import { newState, derive } from './state.js';
import { PATH_IDS, ALL_NODES, TECHS } from './paths.js';
import { SHIPS, MAX_REALM, STAGES, SWORD_GRADES, BOSSES } from './data.js';
import { speciesForBody } from './bestiary.js';
import { Ship } from './ship.js';
import { VEHICLE_IDS } from './vehicle.js';
import { ITEMS, addItem, partFor } from './ring.js';
import { EYE } from './player.js';
import { TrainingDuel, DUEL_DIFFICULTIES } from './duel.js';
import { VirtualTransfer } from './virtual-transfer.js';
import { settings } from '../core/settings.js';
import { codeLabel } from '../core/bindings.js';
import { PhysicalBody } from './physical-body.js';

export const TRAINING_STAR = {
  key: 'virtual-training', name: 'Prism Simulation', seed: 8675309, cls: 'violet',
  region: 0, tier: 0, boss: null, pos: new THREE.Vector3(0, 0, 0),
};

export function trainingState(realm = 2, stage = 0) {
  const s = newState();
  s.realm = realm;
  s.stage = stage;
  s.intro = true;
  s.nixAwake = true;
  s.weapons = PATH_IDS.filter((id) => id !== 'fist');
  s.vehicles = [...VEHICLE_IDS];
  s.skills = Object.fromEntries(ALL_NODES.map((n) => [n.id, n.max]));
  s.mastery = Object.fromEntries(Object.keys(TECHS).map((id) => [id, 1]));
  s.ring.tier = 4;
  for (const id of Object.keys(ITEMS)) addItem(s, id, 99);
  for (const def of speciesForBody({ id: 'p2', name: 'Terra', seed: 1 })) {
    for (let grade = 0; grade <= MAX_REALM; grade++) {
      addItem(s, partFor(def, grade, false), 99);
      addItem(s, partFor(def, grade, true), 99);
    }
  }
  s.coins = s.essence = s.ore = 1e9;
  s.insight = 99;
  s.bonusPoints = 10000;
  s.pills = { heal: 999, energy: 999, cult: 999 };
  s.radar = 4;
  return s;
}

export class TrainingGround {
  constructor(game) {
    this.g = game;
    this.active = false;
    this.busy = false;
    this.source = null;
    this.physical = null;
    this.session = 0;
    this.duel = new TrainingDuel(this);
    this.transfer = new VirtualTransfer(game);
    this.options = { realm: 2, stage: 0, weapon: 'fist', grade: 0, mastery: 1, armor: 0, temper: 0,
      god: true, infinite: true, cooldowns: false, freeze: false, enemyRealm: 0, count: 3, boss: 0,
      duelMirror: true, duelFair: true, duelRealm: 2, duelStage: 0, duelWeapon: 'blade', duelDifficulty: 'adept' };
  }

  async enter() {
    const g = this.g;
    if (this.active || this.busy || g.mode !== 'virtual') return;
    if (g.rt.trib || g.arena || g.trial) return g.denied('Finish your current challenge before entering training.');
    g.save();
    g.dismount(true);
    this.source = { state: g.state, system: g.system,
      runtime: { ...g.rt, cooldowns: { ...g.rt.cooldowns } } };
    const session = ++this.session;
    this.physical = this.createPhysicalBody(this.source);
    this.busy = this.active = true;
    this.pauseOnArrival = false;
    g.menus.closePanel();
    g.input.unlock();
    g.campaign.cleanup();
    this.transfer.begin();
    // Keep the physical world alive offscreen; its own entities continue ticking.
    g.scene.add(g.localRoot);
    g.scene.remove(g.system.root);
    g.system = null;
    g.state = trainingState(this.options.realm, this.options.stage);
    g.stats = derive(g.state);
    g.rt = g.freshRuntime();
    try {
      const preparation = this.prepared || this.prepare();
      const system = await preparation;
      if (this.prepared === preparation) this.prepared = null;
      if (!this.active || session !== this.session) { system.dispose?.(); return; }
      g.installSystem(system);
      g.spawnAtSettlement();
      this.apply();
      await g.warmTerrain(() => {}, () => !this.active || session !== this.session);
      if (!this.active || session !== this.session) return;
      await this.transfer.arrive();
      if (!this.active || session !== this.session) return;
      g.startPlaying();
      document.getElementById('training-hud').classList.remove('hidden');
      g.hud.notify(`Prism simulation online. Press ${codeLabel(settings.key('panelTraining'))} for training controls.`, 'cy');
    } catch (error) {
      if (session !== this.session) return;
      console.error('Training world failed to start', error);
      this.transfer.end();
      this.leave();
      g.hud.notify('Training could not start. Your character has been restored.', 'red');
    } finally {
      if (session === this.session) {
        this.busy = false;
        if (this.active && this.pauseOnArrival) g.pause();
      }
    }
  }

  leave({ physicalDeath = false, returnToBody = false } = {}) {
    if (!this.source) return;
    ++this.session;
    this.physical?.save();
    this.duel.stop();
    this.transfer.end();
    const g = this.g, source = this.source;
    g.menus.closePanel();
    g.menus.closeModal?.(null);
    g.menus.closeSettings?.();
    g.menus.showDeath?.(false);
    if (!physicalDeath) g.input.unlock();
    g.exitVirtual();
    g.mode = 'loading';
    g.endTribulation();
    g.dismount(true);
    g.pets.despawn();
    g.campaign.cleanup();
    g.state = source.state;
    g.stats = derive(g.state);
    g.rt = g.freshRuntime();
    g.installSystem(source.system);
    g.restoreLocation();
    if (this.physical) this.physical.restore();
    else Object.assign(g.rt, source.runtime);
    this.physical = null;
    this.source = null;
    this.active = false;
    this.busy = false;
    document.getElementById('training-hud').classList.add('hidden');
    document.getElementById('physical-body-status').classList.add('hidden');
    document.getElementById('simulation-hit').classList.remove('hit-flash');
    g.player.setRealm(g.state.realm);
    if (physicalDeath) {
      g.mode = 'playing';
      g.hud.show(true);
      g.applyWeapon();
      g.arts.reset();
      return;
    }
    g.startPlaying();
    if (g.state.campaign?.started) g.campaign.resume();
    if (!returnToBody) g.enterVirtual();
  }

  createPhysicalBody(source) {
    return new PhysicalBody(this, source);
  }

  updatePhysical(dt) {
    if (!this.physical) return;
    this.physical.update(dt);
    if (this.physical.dead) {
      this.leave({ physicalDeath: true });
      this.g.hud.notify('Your physical body was killed. The simulation connection has been severed.', 'red');
      this.g.die();
      return;
    }
    const c = this.physical.context;
    const el = document.getElementById('physical-body-status');
    el.classList.remove('hidden');
    el.classList.toggle('alert', this.g.time - c.rt.lastHurt < 2 || c.rt.hp < c.stats.maxHp * 0.35);
    document.getElementById('physical-body-health').textContent = `${Math.ceil(Math.max(0, c.rt.hp))} / ${c.stats.maxHp}${c.rt.inShip && c.shipObj ? ` · HULL ${Math.ceil(100 * c.shipObj.hull / c.shipObj.maxHull)}%` : ''}`;
    document.getElementById('physical-body-fill').style.width = `${Math.max(0, Math.min(100, 100 * c.rt.hp / c.stats.maxHp))}%`;
    document.getElementById('physical-body-location').textContent = c.locationLabel();
  }

  set(key, value) {
    const o = this.options;
    if (this.duel.active) this.duel.finish('cancelled');
    if (['god', 'infinite', 'cooldowns', 'freeze', 'duelMirror', 'duelFair'].includes(key)) o[key] = !!value;
    else if (['weapon', 'duelWeapon'].includes(key) && PATH_IDS.includes(value)) o[key] = value;
    else if (key === 'duelDifficulty' && Object.hasOwn(DUEL_DIFFICULTIES, value)) o[key] = value;
    else {
      const bounds = { realm: [0, MAX_REALM], stage: [0, STAGES.length - 1], grade: [0, SWORD_GRADES.length - 1],
        mastery: [1, 20], armor: [0, 5], temper: [0, 5], enemyRealm: [0, MAX_REALM], count: [1, 20], boss: [0, BOSSES.length - 1],
        duelRealm: [0, MAX_REALM], duelStage: [0, STAGES.length - 1] };
      if (!bounds[key] || !Number.isFinite(Number(value))) return;
      const [min, max] = bounds[key];
      o[key] = Math.max(min, Math.min(max, Math.trunc(Number(value))));
    }
    if (this.active && ['realm', 'stage', 'weapon', 'grade', 'mastery', 'armor', 'temper'].includes(key)) this.apply();
  }

  prepare() {
    if (!this.prepared) {
      this.prepared = this.g.buildSystem(TRAINING_STAR).catch((error) => {
        this.prepared = null;
        throw error;
      });
    }
    return this.prepared;
  }

  apply() {
    if (!this.active || !this.g.system) return;
    const g = this.g, s = g.state, o = this.options;
    g.endTribulation();
    g.arts.reset();
    Object.assign(s, { realm: o.realm, stage: o.stage, xp: 0, weapon: o.weapon, swordGrade: o.grade });
    s.gear.armor = o.armor;
    s.gear.temper[o.weapon] = o.temper;
    for (const id of Object.keys(s.mastery)) s.mastery[id] = o.mastery;
    g.stats = derive(s);
    g.player.setRealm(s.realm);
    g.applyWeapon();
    this.refill();
    g.rt.cooldowns = {};
    g.rt.blinkCd = g.rt.dodgeCd = 0;
  }

  refill() {
    const g = this.g;
    Object.assign(g.rt, { hp: g.stats.maxHp, energy: g.stats.maxEnergy, spirit: g.stats.maxSpirit });
    g.state.coins = g.state.essence = g.state.ore = 1e9;
    g.state.pills = { heal: 999, energy: 999, cult: 999 };
    if (g.shipObj) g.shipObj.hull = g.shipObj.maxHull;
  }

  update() {
    Object.assign(this.options, { realm: this.g.state.realm, stage: this.g.state.stage, weapon: this.g.state.weapon });
    if (this.options.infinite) {
      this.g.rt.energy = this.g.stats.maxEnergy;
      this.g.rt.spirit = this.g.stats.maxSpirit;
      this.g.state.coins = this.g.state.essence = this.g.state.ore = 1e9;
    }
    if (this.options.cooldowns) {
      this.g.rt.cooldowns = {};
      this.g.rt.blinkCd = this.g.rt.dodgeCd = this.g.rt.undyingCd = 0;
    }
  }

  clear() {
    this.duel.stop();
    const g = this.g;
    g.arts.reset();
    g.swords.clearPhantoms();
    g.swords.reset(g.player);
    g.beasts.clear();
    g.combat.clear();
    g.loot.clear();
    g.rt.lock = null;
    g.arena = g.trial = null;
    g.statics.clear();
  }

  reset() {
    this.clear();
    this.g.endTribulation();
    this.g.dismount(true);
    if (this.g.rt.inShip) this.g.exitShip(true);
    this.g.spawnAtSettlement();
    this.g.mode = 'playing';
    this.g.menus.showDeath(false);
    this.apply();
  }

  readyBreakthrough() {
    if (!this.active || this.g.state.realm >= MAX_REALM) return;
    this.set('stage', STAGES.length - 1);
    this.g.state.xp = this.g.stats.xpNeed;
    this.g.state.insight = Math.max(1, this.g.state.insight);
  }

  spawn(boss = false) {
    const g = this.g, f = g.frame;
    if (!this.active || !f?.terrain) return g.denied('Return to the training planet to spawn enemies.');
    if (g.beasts.beasts.filter((b) => !b.static).length + (boss ? 1 : this.options.count) > 40) return g.denied('Clear enemies before spawning more (40 maximum).');
    if (boss && g.beasts.liveBoss) return g.denied('Clear the current boss first.');
    const species = speciesForBody(f.body);
    for (const def of species) g.beasts.species.set(def.id, def);
    const up = g.player.pos.clone().normalize();
    const forward = g.player.forward().projectOnPlane(up).normalize();
    if (forward.lengthSq() < 0.001) forward.copy(g.player.localUp()).projectOnPlane(up).normalize();
    const right = new THREE.Vector3().crossVectors(forward, up).normalize();
    for (let i = 0; i < (boss ? 1 : this.options.count); i++) {
      const pos = g.player.pos.clone().addScaledVector(forward, boss ? 180 : 55).addScaledVector(right, (i - (this.options.count - 1) / 2) * 12);
      const dir = pos.clone().normalize();
      pos.copy(dir.multiplyScalar(f.floorRadius(dir.x, dir.y, dir.z) + (boss ? 90 : 8)));
      const def = species.find((s) => s.id === this.enemy) || species[0];
      const b = boss ? g.beasts.spawnBoss(this.options.boss, pos, this.options.enemyRealm)
        : g.beasts.spawn(def.id, pos, this.options.enemyRealm, { aggro: true });
      b.aggro = true;
    }
  }

  ship(tier) {
    if (!this.active || !Number.isInteger(tier) || !SHIPS[tier]) return;
    const g = this.g;
    if (!g.frame?.terrain) return g.denied('Return to the training planet to spawn a ship.');
    if (g.rt.inShip) g.exitShip(true);
    g.shipObj?.dispose();
    g.shipObj = new Ship(g.localRoot, tier);
    const up = g.player.pos.clone().normalize();
    const pos = g.player.pos.clone().addScaledVector(g.player.forward().projectOnPlane(up).normalize(), 35);
    const dir = pos.clone().normalize();
    if (g.frame?.terrain) pos.copy(dir.multiplyScalar(g.frame.floorRadius(dir.x, dir.y, dir.z) + g.shipObj.gearHeight));
    g.shipObj.placeAt(pos, g.player.pos, up);
    g.shipObj.landed = true;
    g.shipObj.sync();
    g.state.ship = { tier };
  }

  vehicle(id) {
    const g = this.g;
    if (!this.active || !VEHICLE_IDS.includes(id)) return;
    if (!g.frame?.terrain) return g.denied('Return to the training planet to spawn a vehicle.');
    g.dismount(true);
    g.state.vehicle = id;
    g.state.vehicleStored = false;
    g.state.vehicleLoc = null;
    g.syncVehicleFrame();
  }
}
