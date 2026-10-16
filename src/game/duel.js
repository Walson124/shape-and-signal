import * as THREE from 'three';
import { Player, EYE } from './player.js';
import { newState, derive } from './state.js';
import { PATHS, ALL_NODES } from './paths.js';

export const DUEL_DIFFICULTIES = {
  recruit: { name: 'Recruit', reaction: 0.6, tempo: 1.4, dodge: false, guard: false, lead: 0.2 },
  adept: { name: 'Adept', reaction: 0.35, tempo: 1, dodge: true, guard: true, lead: 0.6 },
  master: { name: 'Master', reaction: 0.18, tempo: 0.75, dodge: true, guard: true, lead: 0.9 },
};
const RANGED = new Set(['bow', 'knife', 'mind', 'psychic']);

export function duelState(playerState, options) {
  const s = newState();
  s.realm = options.duelMirror ? playerState.realm : options.duelRealm;
  s.stage = options.duelMirror ? playerState.stage : options.duelStage;
  s.weapon = options.duelWeapon;
  s.weapons = [options.duelWeapon];
  s.skills = options.duelMirror ? { ...playerState.skills } : Object.fromEntries(ALL_NODES.map((n) => [n.id, n.max]));
  if (options.duelMirror) {
    s.mastery = { ...playerState.mastery };
    s.gear = { armor: playerState.gear.armor, temper: { [s.weapon]: playerState.gear.temper[playerState.weapon] || 0 } };
    s.swordGrade = playerState.swordGrade;
    s.gene = playerState.gene;
    s.bosses = [...playerState.bosses];
  }
  return s;
}

function weaponModel(fighter, weapon, color) {
  if (weapon === 'fist' || weapon === 'psychic') return;
  const material = new THREE.MeshStandardMaterial({ color, metalness: 0.7, roughness: 0.3, emissive: color, emissiveIntensity: 0.5 });
  const geometry = weapon === 'bow' ? new THREE.TorusGeometry(0.55, 0.045, 6, 20, Math.PI)
    : weapon === 'spear' ? new THREE.CylinderGeometry(0.035, 0.035, 2.2, 6)
    : new THREE.BoxGeometry(0.1, weapon === 'knife' ? 0.45 : 1.4, 0.035);
  const mesh = new THREE.Mesh(geometry, material);
  // held in the right hand, pointing forward and up
  mesh.position.set(0, -0.06, weapon === 'bow' ? -0.05 : -0.3);
  mesh.rotation.x = -0.7;
  (fighter.handR || fighter.armR).add(mesh);
  if (weapon === 'mind') {
    for (let i = 0; i < 3; i++) {
      const sword = new THREE.Mesh(geometry.clone(), material.clone());
      sword.position.set((i - 1) * 0.65, 1.2, 0.8);
      sword.rotation.x = Math.PI / 2;
      fighter.root.add(sword);
    }
  }
}

// A humanoid registered in the normal target list so every player attack works.
// Its own controller supplies movement, finite energy, windups, guard and dodge.
export class TrainingDuel {
  constructor(training) {
    this.training = training;
    this.g = training.g;
    this.active = false;
    this.wins = 0;
    this.losses = 0;
    this.result = 'No duel played yet.';
  }

  start() {
    const g = this.g, o = this.training.options;
    if (!this.training.active || !g.frame?.terrain) return g.denied('Return to the training planet to duel.');
    if (g.mode !== 'playing' || g.rt.trib) return g.denied('Finish your current challenge before starting a duel.');
    this.stop();
    this.training.clear();
    g.dismount(true);
    if (g.rt.inShip) g.exitShip(true);
    g.state.petOut = null;
    g.pets.despawn();
    this.frame = g.system.planets[0];
    g.spawnAtSettlement(this.frame);
    const up = g.player.pos.clone().normalize();
    const side = new THREE.Vector3(1, 0, 0).projectOnPlane(up).normalize();
    if (side.lengthSq() < 0.1) side.set(0, 0, 1).projectOnPlane(up).normalize();
    const center = g.player.pos.clone().addScaledVector(side, 1100);
    const position = (offset) => {
      const p = center.clone().addScaledVector(side, offset).normalize();
      return p.multiplyScalar(this.frame.floorRadius(p.x, p.y, p.z) + EYE);
    };
    const playerPos = position(-18), rivalPos = position(18);
    g.player.placeAt(playerPos, rivalPos, playerPos.clone().normalize());
    g.player.mode = 'ground';
    g.camQuat.copy(g.player.quat);
    this.training.refill();
    this.rules = Object.fromEntries(['god', 'infinite', 'cooldowns', 'freeze'].map((k) => [k, o[k]]));
    if (o.duelFair) for (const k of Object.keys(this.rules)) o[k] = false;
    this.fair = o.duelFair;
    this.difficulty = DUEL_DIFFICULTIES[o.duelDifficulty];
    const state = duelState(g.state, o);
    this.stats = derive(state);
    this.ranged = RANGED.has(state.weapon);
    this.fighter = new Player(g.localRoot, g.particles);
    this.fighter.setRealm(state.realm);
    this.fighter.placeAt(rivalPos, playerPos, rivalPos.clone().normalize());
    this.fighter.mode = 'ground';
    const color = PATHS[state.weapon].color;
    weaponModel(this.fighter, state.weapon, color);
    this.opponent = {
      uid: ++g.beasts.uid, type: 'cultivator', duelist: true, alive: true, aggro: true, boss: false, static: false,
      name: `${this.difficulty.name} ${PATHS[state.weapon].name} Rival`, cn: '', tier: state.realm,
      radius: 0.9, pos: this.fighter.pos, vel: this.fighter.vel, mesh: this.fighter.root,
      model: { group: this.fighter.root, flash: [], anim() {} },
      def: { color, accent: color, arch: 'humanoid', speed: this.stats.walk, hp: 1, dmg: 1, xp: 0, coins: 0, cores: 0 },
      hp: this.stats.maxHp, maxHp: this.stats.maxHp, dmg: this.stats.atk,
      home: rivalPos.clone(), lastHit: -99, state: 'move', flashT: 0, gid: 0,
      xpMult: 0, coinMult: 0,
    };
    g.beasts.beasts.push(this.opponent);
    g.rt.lock = this.opponent;
    this.energy = this.stats.maxEnergy;
    this.elapsed = 0;
    this.countdown = 3;
    this.attackCd = 0.5;
    this.skillCd = 3;
    this.dodgeCd = 1;
    this.guardCd = 1;
    this.dodgeT = this.guardT = 0;
    this.pending = null;
    this.pendingClear = false;
    this.active = true;
    this.showStatus();
    this.result = 'Get ready — duel starts in 3 seconds.';
    g.rt.cooldowns = {};
    g.rt.invuln = 0;
    g.rt.medToggle = g.rt.meditating = false;
    g.menus.closePanel();
    g.resume();
    g.hud.banner('PVP SIMULATION', this.opponent.name, this.fair ? 'Fair rules · finite resources · no invulnerability' : 'Practice rules · training modifiers enabled', '#3ef2ff', 3);
  }

  stop() {
    if (this.rules) Object.assign(this.training.options, this.rules);
    this.rules = null;
    if (this.opponent?.alive && this.g.beasts.beasts.includes(this.opponent)) this.g.beasts.removeBeast(this.opponent);
    this.opponent = null;
    this.active = false;
    this.pending = null;
    if (this.g.rt) this.g.rt.lock = null;
    this.showStatus();
  }

  finish(result) {
    if (!this.active) return;
    if (result === 'won') this.wins++;
    if (result === 'lost') this.losses++;
    const duration = this.elapsed.toFixed(1);
    this.result = `${result === 'won' ? 'Victory' : result === 'lost' ? 'Defeat' : 'Duel cancelled'} · ${duration}s · ${this.fair ? 'fair rules' : 'practice rules'}`;
    this.stop();
    // A round can end inside a projectile callback; clear after that loop finishes.
    this.pendingClear = true;
    this.g.rt.invuln = Math.max(this.g.rt.invuln, 0.25);
    this.g.hud.banner('DUEL COMPLETE', this.result, 'Open training controls for a rematch.', result === 'won' ? '#5dffa8' : '#ffc857', 4);
    if (result === 'lost') { this.g.rt.hp = Math.max(1, this.g.rt.hp); this.g.rt.invuln = 1; }
  }

  reduceIncoming(amount, kind) {
    if (!this.active) return amount;
    if (this.countdown > 0 || this.dodgeT > 0.04) return 0;
    const front = this.opponent && this.fighter.forward().dot(this.g.player.pos.clone().sub(this.opponent.pos).normalize()) > 0.2;
    const guarded = front && this.guardT > 0 && kind !== 'poison' && kind !== 'pressure' && kind !== 'spike';
    return amount * (1 - this.stats.armor) * (guarded ? 0.3 : 1);
  }

  lineOfSight() {
    const from = this.opponent.pos;
    for (let i = 1; i < 6; i++) {
      if (this.g.isSolid(from.clone().lerp(this.g.player.pos, i / 6))) return false;
    }
    return true;
  }

  update(dt) {
    if (!this.active) return;
    const g = this.g, b = this.opponent, p = this.fighter, st = this.stats;
    if (!b.alive) return this.finish('won');
    if (g.mode === 'dead') return this.finish('lost');
    if (g.frame !== this.frame || g.rt.inShip || g.rt.inVehicle || b.pos.distanceTo(g.player.pos) > 500) return this.finish('cancelled');
    if (this.countdown > 0) {
      this.countdown = Math.max(0, this.countdown - dt);
      this.result = this.countdown > 0 ? `Get ready — ${Math.ceil(this.countdown)}` : 'Duel in progress';
      this.showStatus();
      return;
    }
    this.elapsed += dt;
    this.energy = Math.min(st.maxEnergy, this.energy + st.regen * dt);
    for (const key of ['attackCd', 'skillCd', 'dodgeCd', 'guardCd', 'dodgeT', 'guardT']) this[key] = Math.max(0, this[key] - dt);
    b.stunT = Math.max(0, (b.stunT || 0) - dt);
    b.markT = Math.max(0, (b.markT || 0) - dt);
    const up = b.pos.clone().normalize();
    const toPlayer = g.player.pos.clone().sub(b.pos);
    const distance = toPlayer.length();
    const direction = toPlayer.clone().normalize();
    if (b.held || b.stunT > 0) { this.pending = null; return; }
    p.quat.setFromRotationMatrix(new THREE.Matrix4().lookAt(b.pos, g.player.pos, up));
    p.mode = b.tier >= 1 && g.player.mode !== 'ground' ? 'fly' : 'ground';
    const move = { x: Math.sin(this.elapsed * 1.5) * 0.7, y: 0, z: distance > (this.ranged ? 28 : 3.5) ? 1 : distance < (this.ranged ? 17 : 2) ? -1 : 0 };
    const reacting = this.elapsed > this.difficulty.reaction && (g.rt.firingT > 0 || g.time - b.lastHit < 0.2);
    if (reacting && this.difficulty.dodge && this.dodgeCd <= 0 && this.energy >= 18 && distance < 65) {
      this.dodgeT = 0.22;
      this.dodgeCd = 2.5 * this.difficulty.tempo;
      this.energy -= 18;
      this.dodgeDir = new THREE.Vector3().crossVectors(direction, up).normalize().multiplyScalar(Math.sin(this.elapsed) > 0 ? 1 : -1);
    } else if (reacting && this.difficulty.guard && this.guardCd <= 0 && this.energy >= 8 && distance < 12) {
      this.guardT = 0.5;
      this.guardCd = 2 * this.difficulty.tempo;
      this.energy -= 8;
    }
    b.state = this.dodgeT > 0 ? 'evade' : this.guardT > 0 ? 'guard' : this.pending ? 'windup' : 'move';
    if (this.pending) {
      move.x = move.z = 0;
      this.pending.time -= dt;
      if (this.pending.time <= 0) {
        this.attack(this.pending.skill, distance, direction, up);
        this.pending = null;
      }
    } else if (this.guardT <= 0 && this.dodgeT <= 0 && this.attackCd <= 0 && distance < (this.ranged ? 100 : 6) && this.lineOfSight()) {
      const skill = this.skillCd <= 0 && b.tier >= 1 && this.energy >= 24;
      const cost = skill ? 24 : this.ranged ? 8 : 4;
      if (this.energy >= cost) {
        this.energy -= cost;
        this.pending = { skill, time: skill ? 0.65 : this.difficulty.reaction };
        this.attackCd = (skill ? 1.2 : this.ranged ? 0.85 : 0.65) * this.difficulty.tempo;
        if (skill) this.skillCd = 6 * this.difficulty.tempo;
        b.state = 'windup';
        g.combat.flash(b.pos, b.def.color, skill ? 4 : 2, this.pending.time);
      }
    }
    const normal = b.pos.clone().normalize();
    p.update(dt, move, { up, floorR: this.frame.floorRadius(normal.x, normal.y, normal.z), gravity: 18,
      speed: p.mode === 'fly' ? Math.min(70, st.flySpeed) : st.walk * g.arts.slowAt(b),
      dodge: this.dodgeT > 0 ? { dir: this.dodgeDir, speed: Math.max(24, st.walk * 3) } : null,
      time: g.time, shield: this.guardT > 0, hidden: false, jump: false, meditating: false });
    this.frame.collide(p.pos, p.radius, EYE);
    p.syncRoot();
    if (b.flashT > 0) { b.flashT = Math.max(0, b.flashT - dt); p.accent.color.set(b.def.color).multiplyScalar(b.flashT > 0 ? 4 : 1.5); }
    this.showStatus();
  }

  showStatus() {
    const el = globalThis.document?.getElementById('training-duel-status');
    if (!el) return;
    el.classList.toggle('hidden', !this.active);
    if (this.active) el.textContent = this.countdown > 0 ? `DUEL STARTS IN ${Math.ceil(this.countdown)}`
      : `DUEL ${this.elapsed.toFixed(1)}s · RIVAL HP ${Math.ceil(this.opponent.hp)} / ${this.opponent.maxHp} · ENERGY ${Math.floor(this.energy)}`;
  }

  flush() {
    if (!this.pendingClear) return;
    this.pendingClear = false;
    this.g.combat.clear();
  }

  attack(skill, distance, direction, up) {
    const g = this.g, b = this.opponent;
    if (!this.lineOfSight()) return;
    if (this.ranged) {
      const speed = 100 + b.tier * 10;
      const lead = g.player.pos.clone().addScaledVector(g.player.vel, distance / speed * this.difficulty.lead).sub(b.pos).normalize();
      for (let i = 0; i < (skill ? 3 : 1); i++) {
        const aim = lead.clone().applyAxisAngle(up, skill ? (i - 1) * 0.08 : 0);
        g.combat.enemyShot(b.pos.clone().addScaledVector(aim, 1.5), aim, speed, this.stats.atk * (skill ? 1.2 : 0.9), b.def.color, 0.35);
      }
    } else {
      g.combat.shockwave(b.pos.clone().addScaledVector(up, -0.6), skill ? 7 : 3, b.def.color, 0.25);
      if (distance < (skill ? 7 : 4.5)) g.hurtPlayer(this.stats.atk * (skill ? 2 : 1), b.pos.clone(), direction.clone().multiplyScalar(skill ? 20 : 8));
      pAttack(this.fighter);
    }
  }
}

function pAttack(fighter) { fighter.armR.rotation.x = -1.7; fighter.act?.('punch'); }
