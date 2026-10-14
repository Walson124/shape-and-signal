import * as THREE from 'three';
import { buildCreature } from './creatures.js';
import { power } from './data.js';
import { addCompiled, cancelAdd } from '../core/precompile.js';

// Tamed beasts. One at a time walks with you, fights what attacks you and
// grows a little stronger with every kill. The rest wait in your ring.
// state.pets: [{ id, name, def (species), tier, hp (0..1), knockedUntil }], state.petOut: id

const tA = new THREE.Vector3();
const tM = new THREE.Matrix4();
const tQ = new THREE.Quaternion();

// The parts of a species definition a pet needs to be rebuilt later.
export function petDef(def) {
  const keep = ['id', 'name', 'cn', 'arch', 'variant', 'color', 'accent', 'radius', 'hp', 'dmg', 'speed', 'footing', 'walker', 'horns', 'spikes', 'aquatic'];
  const out = {};
  for (const k of keep) if (def[k] !== undefined) out[k] = def[k];
  return out;
}

export class Pets {
  constructor(game) {
    this.g = game;
    this.active = null; // { rec, model, pos, vel, hp, maxHp, cd, phase }
  }

  rec() {
    const s = this.g.state;
    return (s.pets || []).find((p) => p.id === s.petOut) || null;
  }

  maxHp(rec) {
    return 60 * power(rec.tier) * (rec.def.hp || 1) * 2.2;
  }

  // Bring the chosen pet out beside the player (or put it away).
  sync() {
    const g = this.g, rec = this.rec(), f = g.frame;
    const want = rec && f && f.terrain && g.env.inAtmo && !(rec.knockedUntil > g.state.playtime) && !rec.def.aquatic;
    if (!want) return this.despawn();
    if (this.active && this.active.rec === rec) return;
    this.despawn();
    const model = buildCreature(rec.def);
    const p = g.player;
    const up = p.pos.clone().normalize();
    const side = new THREE.Vector3(1, 0, 0).projectOnPlane(up).normalize();
    const pos = p.pos.clone().addScaledVector(side, 4);
    model.group.position.copy(pos);
    addCompiled(g.localRoot, model.group, `beast:${rec.def.id}`);
    const maxHp = this.maxHp(rec);
    this.active = { rec, model, pos: model.group.position, vel: new THREE.Vector3(), maxHp, hp: maxHp * (rec.hp ?? 1), cd: 0, phase: Math.random() * 10, target: null };
    g.particles.burst(pos, new THREE.Color(1.4, 1, 2.4), 30, 8, 0.8, 0.5);
  }

  despawn() {
    const a = this.active;
    if (!a) return;
    a.rec.hp = Math.max(0, a.hp / a.maxHp);
    cancelAdd(a.model.group);
    this.g.localRoot.remove(a.model.group);
    a.model.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material && !o.isSprite) o.material.dispose();
    });
    this.active = null;
  }

  update(dt, time) {
    const g = this.g, a = this.active;
    const s = g.state;
    // knocked-out pets recover with time
    for (const r of s.pets || []) if (r.knockedUntil && r.knockedUntil <= s.playtime) { r.knockedUntil = 0; r.hp = 1; }
    if (!a) {
      if (this.rec() && !(this.rec().knockedUntil > s.playtime)) this.sync();
      return;
    }
    const f = g.frame;
    if (!f || !f.terrain) return this.despawn();
    const p = g.player, def = a.rec.def;
    a.hp = Math.min(a.maxHp, a.hp + a.maxHp * 0.01 * dt);
    // pick a fight: the nearest beast hunting you, or one close by
    if (!a.target || !a.target.alive || a.target.pos.distanceTo(p.pos) > 90) {
      a.target = null;
      let bd = 70;
      for (const b of g.beasts.beasts) {
        if (!b.alive || b.static) continue;
        const d = b.pos.distanceTo(a.pos);
        if ((b.aggro || d < 25) && d < bd && b.pos.distanceTo(p.pos) < 80) { bd = d; a.target = b; }
      }
    }
    const up = a.pos.clone().normalize();
    let goal, speed = (def.speed || 50) * 0.9;
    if (a.target) goal = a.target.pos;
    else {
      const back = p.forward().projectOnPlane(up).normalize().multiplyScalar(-4);
      const side = new THREE.Vector3().crossVectors(p.forward(), up).normalize().multiplyScalar(3);
      goal = p.pos.clone().add(back).add(side);
      const d = goal.distanceTo(a.pos);
      if (d < 3) speed = 0;
      else if (d < 12) speed = Math.min(speed, g.stats.walk * 1.6);
    }
    if (a.pos.distanceTo(p.pos) > 220) a.pos.copy(p.pos).addScaledVector(new THREE.Vector3(1, 0, 0).projectOnPlane(up).normalize(), 4);
    const to = tA.subVectors(goal, a.pos).projectOnPlane(up);
    const dist = to.length();
    const desired = dist > 0.5 ? to.normalize().multiplyScalar(speed) : new THREE.Vector3();
    a.vel.lerp(desired, 1 - Math.exp(-dt * 4));
    a.pos.addScaledVector(a.vel, dt);
    const n = a.pos.clone().normalize();
    const floor = f.floorRadius(n.x, n.y, n.z);
    const r = (def.radius || 2) * (def.walker === false ? 1 : def.footing ?? 0.75);
    a.pos.setLength(def.walker === false ? floor + 6 + Math.sin(time * 2 + a.phase) : floor + r);
    f.collide(a.pos, def.radius || 2);
    if (a.vel.lengthSq() > 1) {
      tM.lookAt(a.pos.clone().add(a.vel), a.pos, n);
      tQ.setFromRotationMatrix(tM);
      a.model.group.quaternion.slerp(tQ, 1 - Math.exp(-dt * 6));
    }
    a.model.anim(time + a.phase, a.vel.length(), a);
    // bite
    a.cd -= dt;
    const tgt = a.target;
    if (tgt && tgt.alive && a.cd <= 0 && tgt.pos.distanceTo(a.pos) < tgt.radius + (def.radius || 2) + 1.5) {
      a.cd = 1;
      const dmg = 8 * power(a.rec.tier) * (def.dmg || 0.5) * 3.2;
      const killed = g.beasts.damage(tgt, dmg, g.time, tgt.pos.clone().sub(a.pos).normalize().multiplyScalar(20));
      g.dmgNum(tgt.pos.clone().addScaledVector(n, tgt.radius), Math.round(dmg).toString(), 'pet');
      g.particles.burst(tgt.pos, new THREE.Color(2, 1.2, 0.6), 10, 12, 0.5, 0.4);
      if (killed) {
        a.rec.tier = Math.min(s.realm + 0.6, a.rec.tier + 0.05);
        a.maxHp = this.maxHp(a.rec);
      }
    }
    // beasts in contact bite back
    for (const b of g.beasts.beasts) {
      if (!b.alive || b.static || !b.aggro) continue;
      if (b.pos.distanceTo(a.pos) > b.radius + (def.radius || 2) + 1) continue;
      a.hp -= b.dmg * 0.6 * dt;
    }
    if (a.hp <= 0) {
      const name = a.rec.name;
      a.rec.knockedUntil = s.playtime + 90;
      a.hp = 0;
      g.particles.burst(a.pos, new THREE.Color(1.6, 0.4, 0.4), 40, 10, 0.8, 0.6);
      this.despawn();
      g.hud.notify(`Your <b>${name}</b> is knocked out. It slips back into your ring to recover (90 s).`, 'red');
    }
  }
}
