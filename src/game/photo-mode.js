import * as THREE from 'three';
import { settings } from '../core/settings.js';
import { codeLabel } from '../core/bindings.js';

// Photo mode: time stops, the HUD goes, and the camera flies free (within reach of your
// body) so you can frame a shot. Esc frees the mouse for the controls: time of day,
// weather, field of view, exposure, and a button (or Enter) that saves a picture.

const REACH = 400;
const WEATHERS = [
  ['auto', 'As it is'], ['clear', 'Clear'], ['overcast', 'Overcast'], ['rain', 'Rain'], ['storm', 'Thunderstorm'],
  ['snow', 'Snow'], ['blizzard', 'Blizzard'], ['dust', 'Dust storm'],
];
const WEATHER_SPELL = {
  clear: { kind: null, precip: 0, cover: 0.05, storm: 0 },
  overcast: { kind: null, precip: 0, cover: 0.9, storm: 0 },
  rain: { kind: 'rain', precip: 0.8, cover: 0.92, storm: 0 },
  storm: { kind: 'rain', precip: 1, cover: 1, storm: 1 },
  snow: { kind: 'snow', precip: 0.8, cover: 0.85, storm: 0, blizzard: 0 },
  blizzard: { kind: 'snow', precip: 1, cover: 1, storm: 0, blizzard: 1 },
  dust: { kind: 'dust', precip: 0.9, cover: 0.3, storm: 0 },
};
const tA = new THREE.Vector3(), tQ = new THREE.Quaternion();

export class PhotoMode {
  constructor(game) {
    this.game = game;
    this.active = false;
    this.speed = 8;
    this.buildPanel();
    game.canvas.addEventListener('mousedown', () => {
      if (this.active && !game.input.locked) game.input.lock();
    });
  }

  enter() {
    const g = this.game;
    if (this.active || g.mode !== 'playing') return;
    this.active = true;
    g.photo = this;
    g.menus.closePanel?.();
    this.saved = { fov: g.camera.fov, worldTime: g.state.worldTime, playerVisible: g.player.root.visible };
    this.timeOffset = 0;
    this.weather = 'auto';
    this.hidePlayer = false;
    this.freeze = false;
    this.exposure = 1;
    g.exposureMul = 1;
    this.fov = g.camera.fov;
    this.pos = g.camera.position.clone();
    this.quat = g.camera.quaternion.clone();
    g.hud.show(false);
    for (const id of ['nix', 'markers', 'chat-box', 'feed']) { const e = document.getElementById(id); if (e) { e.dataset.photoHide = e.style.display; e.style.display = 'none'; } }
    g.viewmodel.setVisible(false);
    g.post.vmEnabled = false;
    g.player.setVisible(true);
    g.swords?.setVisible?.(false);
    g.input.clear?.();
    this.sync();
    this.panel.classList.add('hidden');
    this.hint.classList.remove('hidden');
    g.sound.ui?.();
  }

  exit() {
    const g = this.game;
    if (!this.active) return;
    this.active = false;
    g.photo = null;
    g.state.worldTime = this.saved.worldTime;
    g.camera.fov = this.saved.fov;
    g.camera.updateProjectionMatrix();
    g.exposureMul = 1;
    g.forceWeather(null);
    g.hud.show(true);
    for (const id of ['nix', 'markers', 'chat-box', 'feed']) { const e = document.getElementById(id); if (e && e.dataset.photoHide !== undefined) { e.style.display = e.dataset.photoHide; delete e.dataset.photoHide; } }
    g.applyCamMode();
    this.panel.classList.add('hidden');
    this.hint.classList.add('hidden');
    if (!g.input.locked) g.input.lock();
  }

  onLock(locked) {
    if (!this.active) return;
    this.panel.classList.toggle('hidden', locked);
    this.hint.classList.toggle('hidden', !locked);
    if (!locked) this.sync();
  }

  // the free camera, and the scene kept in step with it while time stands still
  update(dt) {
    const g = this.game, inp = g.input;
    const f = g.frame;
    const up = f && g.localRoot.parent === f.spin ? tA.copy(this.pos).normalize() : tA.set(0, 1, 0);
    if (inp.locked) {
      const m = inp.consumeMouse();
      const sens = 0.0021 * settings.get('sensitivity') * (this.fov / 80);
      // yaw about the world's up, pitch about the camera's own side
      this.quat.premultiply(tQ.setFromAxisAngle(up, -m.x * sens));
      const side = new THREE.Vector3(1, 0, 0).applyQuaternion(this.quat);
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.quat);
      const pitch = -m.y * sens * (settings.get('invertY') ? -1 : 1);
      if (Math.abs(fwd.dot(up) + Math.sin(pitch)) < 0.985) this.quat.premultiply(tQ.setFromAxisAngle(side, pitch));
      this.quat.normalize();
      if (inp.wheel) { this.speed = THREE.MathUtils.clamp(this.speed * (inp.wheel > 0 ? 0.8 : 1.25), 0.5, 120); inp.wheel = 0; }
      const mv = new THREE.Vector3();
      if (inp.act('forward')) mv.z -= 1;
      if (inp.act('back')) mv.z += 1;
      if (inp.act('right')) mv.x += 1;
      if (inp.act('left')) mv.x -= 1;
      if (mv.lengthSq()) this.pos.addScaledVector(mv.normalize().applyQuaternion(this.quat), this.speed * (inp.act('sprint') ? 4 : 1) * dt);
      if (inp.act('jump')) this.pos.addScaledVector(up, this.speed * dt);
      if (inp.act('down')) this.pos.addScaledVector(up, -this.speed * dt);
    } else inp.consumeMouse();
    // stay within reach of your body, and above the ground
    const body = g.rt.inShip && g.shipObj ? g.shipObj.pos : g.player.pos;
    const off = this.pos.clone().sub(body);
    if (off.length() > REACH) this.pos.copy(body).addScaledVector(off.normalize(), REACH);
    if (f && f.terrain && g.localRoot.parent === f.spin) {
      const floor = f.groundBelow(this.pos) + 0.3;
      if (this.pos.length() < floor) this.pos.setLength(floor);
    }
    g.camera.position.copy(this.pos);
    g.camera.quaternion.copy(this.quat);
    if (Math.abs(g.camera.fov - this.fov) > 0.01) { g.camera.fov = this.fov; g.camera.updateProjectionMatrix(); }
    g.camera.updateMatrixWorld();
    g.player.setVisible(!this.hidePlayer && !g.rt.inShip);
    g.state.worldTime = this.saved.worldTime + this.timeOffset;
    g.exposureMul = this.exposure;
    // the world keeps streaming and lighting for the new viewpoint, but nothing moves
    g.system.update(0, g.state.worldTime, g.camera, g.playerWorld());
    g.updateAtmosphereLighting(dt);
    g.applyUnderground();
    g.applyUnderwater();
    g.flare.update(g.camera, g.system.root.position, g.system.starRadius, g.flareOccluders(), dt);
  }

  // ---- the controls
  buildPanel() {
    const hint = document.createElement('div');
    hint.id = 'photo-hint';
    hint.className = 'hidden';
    document.body.appendChild(hint);
    this.hint = hint;
    const p = document.createElement('div');
    p.id = 'photo-panel';
    p.className = 'hidden';
    document.body.appendChild(p);
    this.panel = p;
    p.addEventListener('input', (e) => this.onInput(e.target));
    p.addEventListener('change', (e) => this.onInput(e.target));
    p.addEventListener('click', (e) => {
      const b = e.target.closest('[data-photo]');
      if (!b) return;
      if (b.dataset.photo === 'shot') this.wantShot = true;
      if (b.dataset.photo === 'leave') this.exit();
      if (b.dataset.photo === 'back') this.game.input.lock();
    });
  }

  sync() {
    const g = this.game, f = g.frame;
    const day = f && f.body.spin ? Math.abs(f.body.spin.period || f.body.spin) : 1200;
    const key = codeLabel(settings.key('photo'));
    this.hint.innerHTML = `PHOTO MODE · <b>WASD</b> move · <b>Space / X</b> up, down · <b>Shift</b> faster · wheel: speed · <b>Enter</b> save picture · <b>Esc</b> controls · <b>${key}</b> leave`;
    const opt = (v, l) => `<option value="${v}" ${this.weather === v ? 'selected' : ''}>${l}</option>`;
    const hasAir = !!(f && f.body.atmo && f.body.landable);
    this.panel.innerHTML = `<div class="ph-title">PHOTO MODE</div>
      ${hasAir ? `<label>Time of day<input type="range" data-k="time" min="${-day / 2}" max="${day / 2}" step="${day / 400}" value="${this.timeOffset}"></label>
      <label>Weather<select data-k="weather">${WEATHERS.map(([v, l]) => opt(v, l)).join('')}</select></label>` : ''}
      <label>Field of view<input type="range" data-k="fov" min="15" max="110" step="1" value="${this.fov}"><output>${Math.round(this.fov)}°</output></label>
      <label>Exposure<input type="range" data-k="exposure" min="0.4" max="2.5" step="0.05" value="${this.exposure}"><output>${this.exposure.toFixed(2)}</output></label>
      <label class="ph-check"><input type="checkbox" data-k="hide" ${this.hidePlayer ? 'checked' : ''}> Hide your character</label>
      <label class="ph-check"><input type="checkbox" data-k="freeze" ${this.freeze ? 'checked' : ''}> Freeze rain and snow</label>
      <div class="ph-buttons"><button class="btn small primary" data-photo="shot">Save picture</button><button class="btn small" data-photo="back">Back to camera</button><button class="btn small" data-photo="leave">Leave</button></div>`;
  }

  onInput(el) {
    const k = el.dataset.k;
    if (!k) return;
    if (k === 'time') this.timeOffset = Number(el.value);
    else if (k === 'fov') this.fov = Number(el.value);
    else if (k === 'exposure') this.exposure = Number(el.value);
    else if (k === 'hide') this.hidePlayer = el.checked;
    else if (k === 'freeze') this.freeze = el.checked;
    else if (k === 'weather') { this.weather = el.value; this.game.forceWeather(WEATHER_SPELL[el.value] || null); }
    const out = el.parentElement.querySelector('output');
    if (out) out.textContent = k === 'fov' ? `${Math.round(this.fov)}°` : this.exposure.toFixed(2);
  }

  // called right after a frame is drawn, so the canvas still holds it
  capture() {
    this.wantShot = false;
    const canvas = this.game.renderer.domElement;
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `starsea-${stamp}.png`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    }, 'image/png');
    this.flash();
  }

  flash() {
    const d = document.createElement('div');
    d.className = 'photo-flash';
    document.body.appendChild(d);
    setTimeout(() => d.remove(), 450);
  }
}
