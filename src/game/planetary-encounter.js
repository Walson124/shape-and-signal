import * as THREE from 'three';
import { PlanetaryBrain, PLANETARY_BOSSES, attackHits } from './planetary-bosses.js';
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
    this.brain = new PlanetaryBrain(this.def); this.status = 'fighting'; this.abandon = 0; this.hit = false;
    g.hud.el?.alert?.classList.add('planetary');
    g.hud.banner('PLANETARY THREAT', this.def.name, `${this.def.cn} · ${this.def.planet} will fall if you lose`, '#ffb752', 5);
    g.cutscene.say([['Nix', 'Watch its tells. Commit after it attacks. When the core opens, interrupt the World Rend.']]);
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
  onKill(b) { if (this.active && b === this.boss) { this.status = 'pending-win'; return true; } return false; }
  clearTells() {
    for (const m of this.telegraphs) { m.removeFromParent(); m.geometry.dispose(); m.material.dispose(); }
    this.telegraphs = [];
  }
  tell(attack) {
    this.clearTells(); const g = this.g, b = this.boss;
    this.origin = b.pos.clone().addScaledVector(this.up, -this.def.lift + 1.8);
    const prediction = g.player.pos.clone().addScaledVector(g.player.vel, 0.45);
    this.direction = prediction.clone().sub(this.origin);
    if (attack.id !== 'lance') this.direction.projectOnPlane(this.up);
    this.direction.normalize();
    if (this.direction.lengthSq() < 0.5) this.direction = new THREE.Vector3(1, 0, 0).projectOnPlane(this.up).normalize();
    const side = new THREE.Vector3().crossVectors(this.direction, this.up).normalize();
    this.marks = attack.shape === 'disc' || attack.shape === 'discs' ? [prediction.clone()] : [];
    if (attack.shape === 'discs') for (const offset of [-65, 65]) this.marks.push(prediction.clone().addScaledVector(side, offset).addScaledVector(this.direction, 35));
    this.marks.forEach(p => { const d = p.clone().normalize(), floor = this.planet.floorRadius(d.x, d.y, d.z) + 1.8;
      if (attack.id === 'eruption' || p.length() - floor < 70) p.copy(d.multiplyScalar(floor)); });
    const add = (geo, pos, q) => {
      const dir = pos.clone().normalize(), floor = this.planet.floorRadius(dir.x, dir.y, dir.z);
      if (attack.id !== 'lance' && pos.length() - floor < 10) {
        const vertices = geo.attributes.position, inverse = q.clone().invert(), v = new THREE.Vector3();
        for (let i = 0; i < vertices.count; i++) {
          v.fromBufferAttribute(vertices, i).applyQuaternion(q).add(pos);
          const n = v.clone().normalize(); v.copy(n.multiplyScalar(this.planet.floorRadius(n.x, n.y, n.z) + 1.8)).sub(pos).applyQuaternion(inverse);
          vertices.setXYZ(i, v.x, v.y, v.z);
        }
        geo.computeBoundingSphere();
      }
      const mat = new THREE.MeshBasicMaterial({ color: attack.id === 'devour' ? 0xff3c64 : this.def.accent, transparent: true, opacity: 0.42, depthWrite: false, side: THREE.DoubleSide });
      const m = new THREE.Mesh(geo, mat); m.position.copy(pos); m.quaternion.copy(q); g.localRoot.add(m); this.telegraphs.push(m); return m;
    };
    const groundQ = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), this.up);
    if (attack.shape === 'lane') {
      const basis = new THREE.Matrix4().makeBasis(side, this.direction, new THREE.Vector3().crossVectors(side, this.direction));
      add(new THREE.PlaneGeometry(attack.width * 2, attack.reach), this.origin.clone().addScaledVector(this.direction, attack.reach / 2), new THREE.Quaternion().setFromRotationMatrix(basis));
    } else if (attack.shape === 'disc' || attack.shape === 'discs') for (const p of this.marks) add(new THREE.RingGeometry(attack.width * 0.85, attack.width, 48), p, groundQ);
    else if (attack.shape === 'cone') {
      const geo = new THREE.CircleGeometry(attack.reach, 40, Math.PI / 2 - attack.width, attack.width * 2);
      const basis = new THREE.Matrix4().makeBasis(side, this.direction, this.up);
      add(geo, this.origin, new THREE.Quaternion().setFromRotationMatrix(basis));
    } else add(new THREE.RingGeometry(attack.id === 'devour' ? 43 : 48, attack.id === 'devour' ? 49 : 52, 64), this.origin, groundQ);
    this.hit = false;
    const [name, instruction] = attack.label.split(' — ');
    g.hud.banner(this.def.phases[this.brain.phase].toUpperCase(), name, instruction || 'Strike during recovery', '#ffb752', Math.min(attack.wind, 3), true);
  }
  update(dt) {
    const g = this.g;
    if (this.status === 'pending-failure') { this.fail(this.reason); return; }
    if (this.status === 'pending-win') {
      this.status = 'idle'; this.clearTells(); g.hud.alert(null);
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
    const events = this.brain.tick(dt, { hp: b.hp, maxHp: b.maxHp, distance: b.pos.distanceTo(g.player.pos) });
    for (const event of events) {
      if (event.type === 'tell') this.tell(event.attack);
      if (event.type === 'phase') { g.sound.thunder(); g.combat.shockwave(b.pos, 160, this.def.accent, 1.5); }
      if (event.type === 'interrupt') { this.clearTells(); g.hud.banner('WORLD REND INTERRUPTED', 'Core stagger', 'Punish the opening', '#5dffa8', 2, true); }
      if (event.type === 'recover') this.clearTells();
      if (event.type === 'strike') {
        if (event.attack.id === 'devour') { g.sound.thunder(); g.combat.shockwave(this.centre, 900, this.def.accent, 2); g.rt.shake = 1.2; }
        if (event.attack.id === 'lance') g.combat.beam(this.origin.clone().addScaledVector(this.up, 18), this.origin.clone().addScaledVector(this.direction, event.attack.reach).addScaledVector(this.up, 18), this.def.accent, 8, 0.6);
        if (event.attack.shape === 'disc' || event.attack.shape === 'discs') for (const mark of this.marks) g.combat.explosion(mark, this.def.accent, 6);
      }
      if (event.type === 'failure') { this.requestFailure('The planetary core ruptured.'); return; }
    }
    b.model.anim(g.time); g.beasts.face(b, this.direction || g.player.pos.clone().sub(b.pos).projectOnPlane(this.up).normalize(), dt, this.brain.state === 'windup' ? 2 : 0.5, this.up);
    b.state = this.brain.state;
    if (this.brain.state === 'active') {
      const attack = this.brain.attack, progress = Math.min(1, 1 - this.brain.t / attack.active);
      if (attack.id === 'charge') {
        const at = this.origin.clone().addScaledVector(this.direction, attack.reach * progress), d = at.normalize();
        b.pos.copy(d.multiplyScalar(this.planet.floorRadius(d.x, d.y, d.z) + this.def.lift));
      }
      if (attack.shape === 'ring') for (const m of this.telegraphs) m.scale.setScalar(Math.max(0.1, attack.reach * progress / 50));
      if (!this.hit && attackHits(attack, this.origin, this.direction, g.player.pos, this.up, progress, this.marks)) {
        this.hit = true; g.hurtPlayer(b.dmg * (this.brain.phase === 2 ? 1.2 : 1), b.pos);
      }
    }
    b.stunT = 0; b.held = false;
    const left = Math.max(0, Math.ceil(this.def.limit - this.brain.elapsed));
    g.hud.alert(`${this.def.planet.toUpperCase()} INTEGRITY ${this.brain.integrity}% · ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} · ${this.abandon > 0 ? 'RETURN — ' + Math.ceil(12 - this.abandon) + 's' : this.brain.state === 'recovery' ? 'CORE EXPOSED' : this.brain.attack?.id === 'devour' ? 'INTERRUPT WORLD REND' : this.brain.state === 'windup' ? 'ATTACK INCOMING' : 'EVADE'}`);
  }
  async fail(reason) {
    if (this.status === 'defeated' || this.status === 'cinematic') return;
    const g = this.g; this.status = 'cinematic'; this.clearTells();
    g.hud.hideBanner?.(); g.hud.el?.alert?.classList.remove('planetary');
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
    this.centre?.applyMatrix4(m); this.origin?.applyMatrix4(m); this.up?.applyQuaternion(q); this.direction?.applyQuaternion(q);
    for (const mark of this.marks) mark.applyMatrix4(m);
    for (const mesh of this.telegraphs) { mesh.position.applyMatrix4(m); mesh.quaternion.premultiply(q); }
  }
  dispose() { this.status = 'idle'; this.clearTells(); this.clearDestruction(); this.boss = null; this.g.hud.el?.alert?.classList.remove('planetary'); }
}
