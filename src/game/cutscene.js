import * as THREE from 'three';

// In-engine cutscenes: scripted camera shots, letterbox bars, subtitles with
// speaker names and timed events. Also plays dialogue during normal play.
//
// script = {
//   shots: [{ dur, from: () => Vector3, to?: () => Vector3, look: () => Vector3, lookTo?: () => Vector3, up?: () => Vector3, fov? }],
//   lines: [{ at, who, text, dur? }],
//   events: [{ at, fn }],
// }
// Positions are in the game's local frame.

const ease = (t) => t * t * (3 - 2 * t);
const SPEAKER_COLORS = { Nix: '#c08cff', 'Instructor Hale': '#ffc857', Kade: '#ff6a5a', Driver: '#7ad8ff', Guard: '#7ad8ff', You: '#ffffff' };

export class Cutscene {
  constructor(game) {
    this.g = game;
    this.bars = document.getElementById('letterbox');
    this.sub = document.getElementById('subtitle');
    this.skipEl = document.getElementById('skip-hint');
    this.active = null;
    this.talk = null;
  }

  play(script) {
    return new Promise((resolve) => {
      const total = script.shots.reduce((a, s) => a + s.dur, 0);
      this.active = { script, t: 0, total, resolve, fired: new Set(), shotsCache: new Map() };
      this.bars.classList.add('on');
      this.skipEl.classList.remove('hidden');
    });
  }

  get playing() {
    return !!this.active;
  }

  skip() {
    const a = this.active;
    if (!a) return;
    // run any events that haven't happened yet, in order
    for (const [i, e] of (a.script.events || []).entries()) if (!a.fired.has(i)) { a.fired.add(i); e.fn(); }
    this.finish();
  }

  finish() {
    const a = this.active;
    this.active = null;
    this.bars.classList.remove('on');
    this.skipEl.classList.add('hidden');
    this.hideSub();
    if (a) a.resolve();
  }

  showSub(who, text) {
    const col = SPEAKER_COLORS[who] || '#9fe6ff';
    this.sub.innerHTML = who ? `<b style="color:${col}">${who}</b>${text}` : `<i>${text}</i>`;
    this.sub.classList.remove('hidden');
  }

  hideSub() {
    this.sub.classList.add('hidden');
  }

  // Dialogue during play: lines appear one after another, no camera control.
  say(lines) {
    this.talk = { lines: lines.map(([who, text, dur]) => ({ who, text, dur: dur || 2.2 + text.length * 0.045 })), i: 0, t: 0 };
    this.showSub(this.talk.lines[0].who, this.talk.lines[0].text);
  }

  update(dt) {
    if (this.talk && !this.active) {
      const tk = this.talk;
      tk.t += dt;
      if (tk.t > tk.lines[tk.i].dur) {
        tk.i++;
        tk.t = 0;
        if (tk.i >= tk.lines.length) {
          this.talk = null;
          this.hideSub();
        } else this.showSub(tk.lines[tk.i].who, tk.lines[tk.i].text);
      }
    }
    const a = this.active;
    if (!a) return false;
    a.t += dt;
    const sc = a.script;
    if (sc.tick) sc.tick(a.t, dt);
    (sc.events || []).forEach((e, i) => {
      if (!a.fired.has(i) && a.t >= e.at) {
        a.fired.add(i);
        e.fn();
      }
    });
    // subtitles
    let line = null;
    for (const l of sc.lines || []) if (a.t >= l.at && a.t < l.at + (l.dur || 2.4 + l.text.length * 0.045)) line = l;
    if (line) this.showSub(line.who, line.text);
    else this.hideSub();
    // camera
    let acc = 0;
    let shot = sc.shots[sc.shots.length - 1], k = 1;
    for (const s of sc.shots) {
      if (a.t < acc + s.dur) {
        shot = s;
        k = (a.t - acc) / s.dur;
        break;
      }
      acc += s.dur;
    }
    const cam = this.g.camera;
    const e = ease(Math.min(1, Math.max(0, k)));
    const from = shot.from(), to = shot.to ? shot.to() : from;
    const look = shot.look(), lookTo = shot.lookTo ? shot.lookTo() : look;
    cam.position.lerpVectors(from, to, e);
    const target = new THREE.Vector3().lerpVectors(look, lookTo, e);
    const up = shot.up ? shot.up() : cam.position.clone().normalize();
    const m = new THREE.Matrix4().lookAt(cam.position, target, up);
    cam.quaternion.setFromRotationMatrix(m);
    if (shot.fov && Math.abs(cam.fov - shot.fov) > 0.1) {
      cam.fov += (shot.fov - cam.fov) * Math.min(1, dt * 3);
      cam.updateProjectionMatrix();
    }
    cam.updateMatrixWorld();
    if (a.t >= a.total) this.finish();
    return true;
  }
}
