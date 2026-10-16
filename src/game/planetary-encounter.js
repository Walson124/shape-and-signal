import * as THREE from 'three';
import { PLANETARY_BOSSES } from './planetary-bosses.js';
import { Titan, TitanBody, loadTitan } from './titan.js';
import { buildPlanetDestruction } from './planet-destruction.js';
import { derive } from './state.js';

// The pre-siege checkpoint is a whole copy of the save. It lives under its own
// storage key (with an in-memory copy) so it doesn't double the main save.
const CHECKPOINT_KEY = 'starsea-ascension-siege-checkpoint';
export function storeCheckpoint(state) {
  try { localStorage.setItem(CHECKPOINT_KEY, JSON.stringify(state)); return true; } catch { return false; }
}
export function loadCheckpoint() {
  try { const raw = localStorage.getItem(CHECKPOINT_KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
export function clearCheckpoint() {
  try { localStorage.removeItem(CHECKPOINT_KEY); } catch { /* storage unavailable */ }
}
const esc = text => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const Y = new THREE.Vector3(0, 1, 0);
export class PlanetaryEncounter {
  constructor(campaign) { this.c = campaign; this.g = campaign.g; this.status = 'idle'; this.marks = []; this.telegraphs = []; }
  get active() { return this.status === 'fighting'; }
  planetFor(id) { return this.g.star.key === 'home' ? this.g.system.planets.find(p => p.body.id === PLANETARY_BOSSES[id].body) : null; }
  arena(id) {
    const planet = this.planetFor(id); if (!planet) return null;
    if (id === 'vesper') {
      const gate = this.c.gate(), dir = gate.out.clone().sub(gate.pos).normalize();
      return this.c.ground(gate.out.clone().addScaledVector(dir, 560), 0);
    }
    const site = planet.body.pois.find(p => p.kind === 'ruin') || planet.body.pois[0];
    const d = site ? new THREE.Vector3(...site.dir).normalize() : new THREE.Vector3(0, 1, 0);
    return d.multiplyScalar(planet.floorRadius(d.x, d.y, d.z));
  }
  target(id) { return this.g.frame === this.planetFor(id) ? this.boss?.alive ? this.boss.pos.clone() : this.arena(id) : null; }
  begin(id, retry = false) {
    const g = this.g; this.def = PLANETARY_BOSSES[id]; this.planet = this.planetFor(id);
    if (!this.planet || g.frame !== this.planet || g.training.active) return false;
    this.centre = this.arena(id); this.up = this.centre.clone().normalize();
    if (!retry && !this.c.st.siegeCheckpoint) {
      g.save();
      const snapshot = structuredClone(g.state); delete snapshot.campaign.siegeCheckpoint; delete snapshot.campaign.siegeFailure;
      this.snapshot = snapshot;
      storeCheckpoint(snapshot);
      this.c.st.siegeCheckpoint = { hp: g.rt.hp, energy: g.rt.energy, spirit: g.rt.spirit };
    }
    this.c.st.siegeFailure = null;
    g.beasts.clear(); g.combat.clear();
    this.boss = g.beasts.spawnPlanetary(this.def, this.centre.clone().addScaledVector(this.up, this.def.lift));
    // the titan is the fight: it moves, attacks and is struck through its body parts
    this.titan = this.brain = new Titan(g, this.def, this.boss, this.centre);
    this.status = 'fighting'; this.abandon = 0;
    const attempt = this.titan;
    loadTitan(id).then((src) => {
      if (!src || this.titan !== attempt || !this.boss?.alive) return;
      attempt.attach(new TitanBody(src, this.def));
      // the titan's parts take the hits now, not one big sphere
      this.boss.radius = 0.01;
    });
    g.combat.shockwave(this.boss.pos.clone(), 220, this.def.accent, 1.6); g.sound.thunder(); g.rt.shake = Math.max(g.rt.shake, 0.9);
    g.hud.el?.alert?.classList.add('planetary');
    g.hud.banner('PLANETARY THREAT', this.def.name, `${this.def.cn} · ${this.def.planet} will fall if you lose`, '#ffb752', 5);
    g.cutscene.say([['Nix', 'Watch its body, not the ground: it shows you every blow before it lands. Get in close. Its hide shrugs off distant fire, and its glowing weak points break.']]);
    g.save(); return true;
  }
  onDeath() {
    if (!this.active || this.g.training.active) return false;
    this.requestFailure('You fell. No defender remained to stop the World Rend.'); return true;
  }
  requestFailure(reason) {
    if (!this.active) return;
    this.status = 'pending-failure'; this.reason = reason; this.g.mode = 'cutscene';
  }
  onKill(b) { if (this.active && b === this.boss) { this.titan?.removeParts(); this.status = 'pending-win'; return true; } return false; }
  clearTells() {
    for (const m of this.telegraphs) { m.removeFromParent(); m.geometry.dispose(); m.material.dispose(); }
    this.telegraphs = [];
  }
  update(dt) {
    const g = this.g;
    if (this.status === 'pending-failure') { this.fail(this.reason); return; }
    if (this.status === 'pending-win') {
      this.status = 'idle'; this.clearTells(); g.hud.alert(null); this.titan?.dispose(); this.titan = null;
      g.hud.el?.alert?.classList.remove('planetary');
      this.c.st.slain = [...new Set([...(this.c.st.slain || []), this.def.id])];
      delete this.c.st.siegeCheckpoint; delete this.c.st.siegeFailure;
      this.snapshot = null; clearCheckpoint();
      g.hud.banner('PLANET SAVED', this.def.planet, `${this.def.name} has fallen`, '#5dffa8', 5);
      this.boss = null; this.c.advance(); return;
    }
    if (!this.active || g.training.active || g.mode !== 'playing') return;
    if (g.frame !== this.planet) { this.requestFailure('You left the planet undefended.'); return; }
    if (!this.boss?.alive || !g.beasts.beasts.includes(this.boss)) { this.requestFailure('The defensive line collapsed.'); return; }
    const b = this.boss, distance = g.player.pos.distanceTo(this.centre);
    this.abandon = distance > 1900 ? this.abandon + dt : 0;
    if (this.abandon > 12) { this.requestFailure('You abandoned the final defensive line.'); return; }
    const events = this.titan.update(dt);
    for (const event of events) {
      if (event.type === 'phase') { g.sound.thunder(); g.combat.shockwave(b.pos, 160, this.def.accent, 1.5); }
      if (event.type === 'interrupt') g.hud.banner('WORLD REND INTERRUPTED', 'It staggers', 'Punish the opening', '#5dffa8', 2, true);
      if (event.type === 'failure') { this.requestFailure('The planetary core ruptured.'); return; }
    }
    b.stunT = 0; b.held = false;
    const left = Math.max(0, Math.ceil(this.def.limit - this.titan.elapsed));
    const ph = this.def.phases[this.titan.phase].toUpperCase();
    g.hud.alert(`${this.def.planet.toUpperCase()} INTEGRITY ${this.titan.integrity}% · ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} · ${this.abandon > 0 ? 'RETURN — ' + Math.ceil(12 - this.abandon) + 's' : this.titan.state === 'rend' ? 'WORLD REND — STRIKE ITS CORE' : ph}`);
  }
  async fail(reason) {
    if (this.status === 'defeated' || this.status === 'cinematic') return;
    const g = this.g; this.status = 'cinematic'; this.clearTells();
    g.hud.hideBanner?.(); g.hud.el?.alert?.classList.remove('planetary');
    this.titan?.dispose(); this.titan = null;
    this.c.st.siegeFailure = reason; g.rt.hp = 0; g.rt.inShip = false; g.rt.inVehicle = false;
    g.beasts.clear(); g.combat.clear(); g.player.vel.set(0, 0, 0); g.hud.alert(null); g.save();
    const fx = this.destruction = buildPlanetDestruction(g, this.planet, this.def.accent);
    const forward = g.player.pos.clone().sub(fx.centre).normalize(), east = new THREE.Vector3(1, 0, 0).projectOnPlane(forward).normalize();
    const eye = k => fx.centre.clone().addScaledVector(forward, fx.R * k).addScaledVector(east, fx.R * 0.6);
    await g.playCutscene({ shots: [{ dur: 4, from: () => eye(3), to: () => eye(3.4), look: () => fx.centre, up: () => Y },
      { dur: 8, from: () => eye(3.4), to: () => eye(5), look: () => fx.centre, up: () => Y }], tick: t => fx.update(t),
      lines: [{ at: 0, who: 'Nix', text: reason, dur: 4 }, { at: 4, who: '', text: `${this.def.planet} breaks apart. The signal goes silent.`, dur: 7 }],
      events: [{ at: 11.9, fn: () => fx.update(12) }] });
    if (this.status !== 'cinematic' || g.mode === 'title') return;
    this.status = 'defeated'; g.mode = 'campaign-defeat'; g.hud.show(false); g.player.setVisible(false);
    g.viewmodel?.setVisible(false); if (g.post) g.post.vmEnabled = false; g.swords.setVisible(false);
    g.menus.showPause(false); g.input.unlock();
    const choice = await g.menus.modal({ kicker: 'CAMPAIGN DEFEAT', title: `${this.def.planet} has fallen`,
      body: `<p>${esc(reason)}</p><p>The planet was destroyed in this attempt. Restore the checkpoint before the confrontation to try again.</p>`,
      actions: [{ label: 'Retry from checkpoint', val: 'retry', cls: 'primary' }, { label: 'Return to title', val: 'title', cls: 'ghost' }] });
    if (this.status !== 'defeated') return;
    if (choice === 'retry') this.retry();
    else { this.clearDestruction(); g.quitToTitle(); }
  }
  retry() {
    const g = this.g, checkpoint = this.c.st.siegeCheckpoint;
    const saved = this.snapshot || checkpoint?.state || loadCheckpoint();
    if (!checkpoint || !saved) return;
    const id = this.def.id;
    this.clearDestruction(); this.clearTells(); this.status = 'idle';
    g.state = structuredClone(saved); g.stats = derive(g.state); g.rt = g.freshRuntime(); g.arts.reset();
    g.setFrame(this.planet, false); g.beasts.clear(); g.combat.clear();
    const pos = new THREE.Vector3(...g.state.loc.pos), up = pos.clone().normalize();
    g.player.placeAt(pos, this.arena(id), up); g.player.vel.set(0, 0, 0); g.player.setRealm(g.state.realm);
    g.player.mode = g.state.loc.mode || 'ground'; g.camQuat?.copy(g.player.quat);
    g.rt.hp = Math.max(checkpoint.hp, g.stats.maxHp * 0.5); g.rt.energy = checkpoint.energy; g.rt.spirit = checkpoint.spirit; g.rt.invuln = 3;
    if (g.shipObj && g.state.ship) {
      const ship = g.shipObj, saved = g.state.ship;
      if (ship.tier !== saved.tier) ship.setTier(saved.tier);
      ship.hull = saved.hull; ship.pos.fromArray(saved.pos); ship.quat.fromArray(saved.quat);
      ship.vel.set(0, 0, 0); ship.landed = !!saved.landed; ship.thrust = 0; ship.sync();
    }
    g.mode = 'playing'; g.hud.textTimer = 0; g.hud.show(true); g.applyCamMode(); g.swords.setVisible(true); g.swords.reset(g.player);
    this.begin(id); g.menus.showPause(true);
  }
  clearDestruction() { this.destruction?.dispose(); this.destruction = null; }
  rebase(m, q) {
    this.titan?.rebase(m, q);
    this.centre?.applyMatrix4(m); this.origin?.applyMatrix4(m); this.up?.applyQuaternion(q); this.direction?.applyQuaternion(q);
    for (const mark of this.marks) mark.applyMatrix4(m);
    for (const mesh of this.telegraphs) { mesh.position.applyMatrix4(m); mesh.quaternion.premultiply(q); }
  }
  dispose() { this.titan?.dispose(); this.titan = null; this.status = 'idle'; this.clearTells(); this.clearDestruction(); this.boss = null; this.g.hud.alert?.(null); this.g.hud.el?.alert?.classList.remove('planetary'); }
}
