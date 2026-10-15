import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../core/rng.js';

export const PLANETARY_BOSSES = {
  vesper: { id: 'vesper', body: 'p2', planet: 'Terra', name: 'Vesper, the Worldbreaker', cn: '玄冕裂星兽', tier: 1,
    color: 0x272735, accent: 0xffb752, radius: 52, lift: 32, hp: 24, dmg: 2, xp: 16, coins: 30, cores: 25,
    phases: ['The Black Crown', 'Mantle Unbound', 'Last Light'], kit: ['charge', 'sweep', 'pulse', 'salvo'], limit: 420 },
  serekh: { id: 'serekh', body: 'p3', planet: 'Dune', name: 'Serekh, the Buried Sun', cn: '葬日沙皇', tier: 2,
    color: 0x65523f, accent: 0xff733e, radius: 48, lift: 24, hp: 28, dmg: 2.2, xp: 22, coins: 40, cores: 30,
    phases: ['Beneath the Sands', 'Glass Horizon', 'The Buried Sun'], kit: ['eruption', 'salvo', 'charge'], limit: 420 },
  ilyra: { id: 'ilyra', body: 'p5', planet: 'Glacis', name: 'Ilyra, the Silent Choir', cn: '寂霜圣歌', tier: 3,
    color: 0x4b738d, accent: 0x8de9ff, radius: 46, lift: 40, hp: 32, dmg: 2.4, xp: 28, coins: 50, cores: 35,
    phases: ['First Voice', 'Dissonance', 'Final Refrain'], kit: ['lance', 'pulse', 'salvo'], limit: 420 },
};

const ATTACKS = {
  charge: { label: 'Crown charge — sidestep the marked lane', wind: 1.6, active: 0.85, recovery: 2.8, shape: 'lane', reach: 330, width: 22 },
  sweep: { label: 'Crown sweep — get behind it or retreat', wind: 1.35, active: 0.35, recovery: 2.4, shape: 'cone', reach: 145, width: 1.1 },
  pulse: { label: 'Resonance ring — jump or rise above the wave', wind: 1.5, active: 1.6, recovery: 2.5, shape: 'ring', reach: 360, width: 12 },
  eruption: { label: 'Sand eruption — leave the marked ground', wind: 1.7, active: 0.55, recovery: 3, shape: 'disc', reach: 280, width: 36 },
  salvo: { label: 'Falling stars — keep moving out of the marks', wind: 1.9, active: 0.7, recovery: 2.5, shape: 'discs', reach: 600, width: 24 },
  lance: { label: 'Choir lance — break away from its aim', wind: 1.65, active: 0.45, recovery: 3, shape: 'lane', reach: 700, width: 14 },
  devour: { label: 'WORLD REND — attack the exposed core to interrupt', wind: 10, active: 0.2, recovery: 4, shape: 'devour', reach: 0, width: 0 },
};

// Deterministic encounter logic, independent of rendering. Targets are locked
// at the start of the tell; it predicts motion, never reads dodge/input state.
export class PlanetaryBrain {
  constructor(def) {
    this.def = def; this.phase = 0; this.state = 'recovery'; this.t = 2;
    this.elapsed = 0; this.integrity = 100; this.turn = 0; this.recent = []; this.history = [];
    this.r = mulberry32(def.id.length * 701 + def.tier); this.attack = null;
  }
  choose(distance) {
    if (this.turn > 0 && this.turn % 4 === 0) return 'devour';
    const candidates = this.def.kit.filter(k => !(k === 'sweep' && distance > 190));
    const scored = candidates.map(k => [k, this.r() + (k === 'charge' && distance > 160 ? 0.8 : 0) + (k === 'lance' && distance > 200 ? 0.7 : 0) - this.recent.filter(x => x === k).length * 0.9]);
    return scored.sort((a, b) => b[1] - a[1])[0][0];
  }
  tick(dt, { hp, maxHp, distance, enabled = true }) {
    if (!enabled) return [];
    const events = []; dt = Math.max(0, Math.min(dt, 0.1)); this.elapsed += dt;
    const phase = hp / maxHp <= 0.34 ? 2 : hp / maxHp <= 0.67 ? 1 : 0;
    if (phase > this.phase) { this.phase = phase; events.push({ type: 'phase', phase }); }
    this.t -= dt;
    if (this.state === 'windup' && this.attack.id === 'devour' && this.rendHp - hp >= maxHp * 0.055) {
      this.state = 'recovery'; this.t = 4.5; events.push({ type: 'interrupt' }); return events;
    }
    if (this.t <= 0) {
      if (this.state === 'recovery') {
        const id = this.choose(distance), spec = ATTACKS[id];
        // the first two attacks wind up a little slower so the player can learn the tells
        this.attack = { ...spec, id, wind: spec.wind * (id === 'devour' ? 1 : 1 - this.phase * 0.08) * (this.turn < 2 && id !== 'devour' ? 1.3 : 1) };
        this.state = 'windup'; this.t = this.attack.wind; this.rendHp = hp; this.turn++;
        this.recent.push(id); if (this.recent.length > 2) this.recent.shift();
        this.history.push(id); if (this.history.length > 24) this.history.shift();
        events.push({ type: 'tell', attack: this.attack });
      } else if (this.state === 'windup') {
        this.state = 'active'; this.t = this.attack.active;
        if (this.attack.id === 'devour') this.integrity = Math.max(0, this.integrity - 35);
        events.push({ type: 'strike', attack: this.attack });
      } else { this.state = 'recovery'; this.t = this.attack.recovery; events.push({ type: 'recover' }); }
    }
    if (this.elapsed >= this.def.limit || this.integrity <= 0) events.push({ type: 'failure' });
    return events;
  }
  get vulnerability() { return this.state === 'recovery' ? 1.65 : this.attack?.id === 'devour' && this.state === 'windup' ? 2 : 0.85; }
}

export function attackHits(attack, origin, direction, target, up, progress, marks = []) {
  const delta = target.clone().sub(origin), height = delta.dot(up);
  const flat = delta.clone().addScaledVector(up, -height), distance = flat.length();
  if (attack.shape === 'devour') return false;
  if (attack.shape === 'ring') return Math.abs(distance - attack.reach * progress) < attack.width && Math.abs(height) < 7;
  if (attack.shape === 'disc' || attack.shape === 'discs') return marks.some(m => {
    const d = target.clone().sub(m), y = d.dot(up); return Math.abs(y) < 95 && d.addScaledVector(up, -y).length() < attack.width;
  });
  const forward = delta.dot(direction);
  if (attack.shape === 'lane') {
    const front = attack.id === 'charge' ? attack.reach * progress : attack.reach;
    const back = attack.id === 'charge' ? Math.max(0, front - attack.width * 2) : 0;
    return forward >= back && forward <= front + (attack.id === 'charge' ? attack.width : 0) && delta.clone().addScaledVector(direction, -forward).length() < attack.width;
  }
  return Math.abs(height) < 90 && distance < attack.reach && flat.normalize().dot(direction) > Math.cos(attack.width);
}

// Original silhouettes, constructed once and merged by material. Only four
// limb/wing pivots animate; no skinned meshes, textures or additional lights.
export function buildPlanetaryModel(def) {
  const group = new THREE.Group(), armor = new THREE.MeshStandardMaterial({ color: def.color, roughness: 0.6, metalness: 0.65 });
  const crown = new THREE.MeshStandardMaterial({ color: def.accent, roughness: 0.32, metalness: 0.8 });
  const core = new THREE.MeshBasicMaterial({ color: new THREE.Color(def.accent).multiplyScalar(2.2) });
  const parts = [[], [], []], pivots = [];
  const put = (kind, geo, x, y, z) => { geo.translate(x, y, z); parts[kind].push(geo.index ? geo.toNonIndexed() : geo); if (geo.index) geo.dispose(); };
  const oval = (kind, x, y, z, sx, sy, sz) => put(kind, new THREE.SphereGeometry(1, 16, 10).scale(sx, sy, sz), x, y, z);
  if (def.id === 'vesper') {
    oval(0, 0, 2, 0, 31, 22, 48); oval(0, 0, 9, 43, 20, 15, 25);
    for (let i = 0; i < 7; i++) oval(1, 0, 19 - i * 0.8, 32 - i * 12, 22 - i, 6, 9);
    for (const side of [-1, 1]) {
      put(1, new THREE.ConeGeometry(8, 45, 10).rotateX(0.45).rotateZ(-side * 0.3), side * 13, 34, 51);
      oval(2, side * 11, 13, 62, 4, 2, 3);
      for (const z of [-28, 25]) {
        const pivot = new THREE.Group(); pivot.position.set(side * 25, -9, z);
        const leg = new THREE.Mesh(new THREE.CapsuleGeometry(7, 20, 3, 10), armor); leg.position.y = -10;
        const foot = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8).scale(10, 5, 15), crown); foot.position.set(0, -19, 4);
        pivot.add(leg, foot); group.add(pivot); pivots.push(pivot);
      }
    }
    oval(2, 0, 12, 57, 6, 7, 5);
    put(0, new THREE.ConeGeometry(10, 70, 10).rotateX(-Math.PI / 2), 0, 0, -65);
  } else if (def.id === 'serekh') {
    for (let i = 0; i < 7; i++) {
      const z = 35 - i * 16, size = 24 - i * 1.5;
      oval(0, Math.sin(i * 0.6) * 9, -i * 1.2, z, size, size * 0.85, 18);
      put(1, new THREE.ConeGeometry(5, 25 - i * 2, 7), Math.sin(i * 0.6) * 9, size - 1, z);
    }
    put(1, new THREE.TorusGeometry(18, 4, 8, 24), 0, 0, 53);
    oval(2, 0, 0, 55, 12, 12, 3);
    for (let i = 0; i < 12; i++) put(1, new THREE.ConeGeometry(2, 10, 5).rotateX(-Math.PI / 2), Math.cos(i * Math.PI / 6) * 16, Math.sin(i * Math.PI / 6) * 16, 58);
  } else {
    oval(0, 0, 0, 0, 22, 12, 32); oval(2, 0, 3, 13, 7, 9, 10);
    put(1, new THREE.TorusGeometry(35, 2, 6, 48).rotateX(Math.PI / 2), 0, 12, 0);
    for (const side of [-1, 1]) for (const z of [-12, 13]) {
      const pivot = new THREE.Group(); pivot.position.set(side * 13, 0, z);
      const wing = new THREE.Mesh(new THREE.ConeGeometry(16, 64, 4).rotateZ(-side * Math.PI / 2), crown); wing.position.x = side * 25;
      pivot.add(wing); group.add(pivot); pivots.push(pivot);
    }
    for (let i = 0; i < 7; i++) put(1, new THREE.ConeGeometry(4, 26, 5), Math.cos(i * Math.PI * 2 / 7) * 30, 17, Math.sin(i * Math.PI * 2 / 7) * 30);
  }
  for (let i = 0; i < 3; i++) if (parts[i].length) {
    const g = mergeGeometries(parts[i]); parts[i].forEach(p => p.dispose()); group.add(new THREE.Mesh(g, [armor, crown, core][i]));
  }
  return { group, flash: [armor, crown], anim: t => {
    pivots.forEach((p, i) => { p.rotation.z = Math.sin(t * (def.id === 'ilyra' ? 1.5 : 2) + i * 2) * 0.12; });
    core.color.setHex(def.accent).multiplyScalar(1.8 + Math.sin(t * 3) * 0.3);
  } };
}
