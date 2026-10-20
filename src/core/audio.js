import { settings } from './settings.js';
import { REGIONS } from '../game/data.js';

const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
const STEP = 60 / 112 / 4;

// Fully synthesized audio: generative music with a combat layer, reverb,
// positional sound effects and continuous engine / sword-wind loops.
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.last = {};
    this.muted = false;
    this.intensity = 0;
    this.trib = false;
    this.galaxy = 0;
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    let ctx;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch {
      return;
    }
    this.ctx = ctx;
    this.master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 4;
    comp.attack.value = 0.004;
    comp.release.value = 0.2;
    this.master.connect(comp).connect(ctx.destination);
    this.musicBus = ctx.createGain();
    this.sfxBus = ctx.createGain();
    this.musicBus.connect(this.master);
    this.sfxBus.connect(this.master);
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(3.4, 2.6);
    const revOut = ctx.createGain();
    revOut.gain.value = 0.7;
    this.reverb.connect(revOut).connect(this.master);
    const musicSend = ctx.createGain();
    musicSend.gain.value = 0.6;
    this.musicBus.connect(musicSend).connect(this.reverb);
    const sfxSend = ctx.createGain();
    sfxSend.gain.value = 0.16;
    this.sfxBus.connect(sfxSend).connect(this.reverb);

    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    this.applyVolumes();
    settings.onChange(() => this.applyVolumes());
    this.startLoops();
    this.startMusic();
  }

  impulse(dur, decay) {
    const rate = this.ctx.sampleRate;
    const len = Math.floor(rate * dur);
    const buf = this.ctx.createBuffer(2, len, rate);
    for (let c = 0; c < 2; c++) {
      const ch = buf.getChannelData(c);
      for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.muted ? 0 : settings.get('master'), t, 0.05);
    this.musicBus.gain.setTargetAtTime(settings.get('music') * 0.9, t, 0.05);
    this.sfxBus.gain.setTargetAtTime(settings.get('sfx'), t, 0.05);
  }

  toggleMute() {
    this.muted = !this.muted;
    this.applyVolumes();
    return this.muted;
  }

  setListener(camera) {
    if (!this.ctx) return;
    const l = this.ctx.listener;
    // sounds are positioned in the camera's parent frame
    const p = camera.position;
    const q = camera.quaternion;
    const fx = -(2 * (q.x * q.z + q.w * q.y)), fy = -(2 * (q.y * q.z - q.w * q.x)), fz = -(1 - 2 * (q.x * q.x + q.y * q.y));
    const ux = 2 * (q.x * q.y - q.w * q.z), uy = 1 - 2 * (q.x * q.x + q.z * q.z), uz = 2 * (q.y * q.z + q.w * q.x);
    const f = [fx, fy, fz];
    const u = [ux, uy, uz];
    if (l.positionX) {
      const t = this.ctx.currentTime;
      l.positionX.setValueAtTime(p.x, t); l.positionY.setValueAtTime(p.y, t); l.positionZ.setValueAtTime(p.z, t);
      l.forwardX.setValueAtTime(f[0], t); l.forwardY.setValueAtTime(f[1], t); l.forwardZ.setValueAtTime(f[2], t);
      l.upX.setValueAtTime(u[0], t); l.upY.setValueAtTime(u[1], t); l.upZ.setValueAtTime(u[2], t);
    } else if (l.setPosition) {
      l.setPosition(p.x, p.y, p.z);
      l.setOrientation(f[0], f[1], f[2], u[0], u[1], u[2]);
    }
  }

  throttle(name, gap) {
    if (!this.ctx) return false;
    const now = this.ctx.currentTime;
    if (this.last[name] && now - this.last[name] < gap) return false;
    this.last[name] = now;
    return true;
  }

  dest(pos) {
    if (!pos) return { node: this.sfxBus, done: null };
    const p = this.ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = 60;
    p.maxDistance = 6000;
    p.rolloffFactor = 0.85;
    if (p.positionX) {
      p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z;
    } else {
      p.setPosition(pos.x, pos.y, pos.z);
    }
    p.connect(this.sfxBus);
    return { node: p, done: () => p.disconnect() };
  }

  tone({ freq = 440, type = 'sine', dur = 0.15, vol = 0.2, slide = 0, attack = 0.004, delay = 0, pos = null, filter = 0, bus = null, detune = 0 }) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.detune.value = detune;
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let src = o;
    if (filter) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = filter;
      o.connect(f);
      src = f;
    }
    const d = bus ? { node: bus, done: null } : this.dest(pos);
    src.connect(g).connect(d.node);
    o.start(t);
    o.stop(t + dur + 0.05);
    if (d.done) o.onended = d.done;
  }

  noise({ dur = 0.3, vol = 0.3, freq = 1200, q = 0.8, type = 'lowpass', slide = 0, delay = 0, pos = null, attack = 0.002, bus = null }) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (slide) f.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const d = bus ? { node: bus, done: null } : this.dest(pos);
    src.connect(f).connect(g).connect(d.node);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
    if (d.done) src.onended = d.done;
  }

  // ------------------------------------------------------------ effects --
  footstep(surface = 'ground', speed = 5) {
    if (!this.throttle('footstep', 0.16)) return;
    const hard = surface === 'paving' || surface === 'interior';
    const strength = Math.min(1.4, 0.7 + speed / 18);
    this.tone({ freq: (hard ? 155 : 85) + Math.random() * 15, slide: -45, dur: 0.055, vol: 0.035 * strength, filter: 900 });
    this.noise({ dur: hard ? 0.045 : 0.09, vol: (hard ? 0.035 : 0.055) * strength, freq: hard ? 2000 : 750,
      type: 'bandpass', q: 0.6 });
  }

  bolt() {
    if (!this.throttle('bolt', 0.05)) return;
    this.tone({ freq: 1400, type: 'triangle', dur: 0.1, vol: 0.05, slide: -1000 });
    this.noise({ dur: 0.07, vol: 0.04, freq: 5000, type: 'highpass' });
  }
  hit(pos) {
    if (!this.throttle('hit', 0.035)) return;
    this.noise({ dur: 0.09, vol: 0.14, freq: 1800, type: 'bandpass', q: 1.2, pos });
    this.tone({ freq: 140, type: 'sine', dur: 0.1, vol: 0.12, slide: -60, pos });
  }
  swordHit(pos) {
    if (!this.throttle('shit', 0.03)) return;
    const base = 2200 + Math.random() * 900;
    this.tone({ freq: base, type: 'sine', dur: 0.35, vol: 0.06, pos });
    this.tone({ freq: base * 1.51, type: 'sine', dur: 0.25, vol: 0.035, pos });
    this.noise({ dur: 0.06, vol: 0.12, freq: 6000, type: 'highpass', pos });
    this.tone({ freq: 180, type: 'sine', dur: 0.08, vol: 0.08, slide: -80, pos });
  }
  swordLaunch() {
    this.noise({ dur: 0.45, vol: 0.18, freq: 500, type: 'bandpass', q: 2, slide: 3500 });
    for (let i = 0; i < 3; i++) this.tone({ freq: 1800 + i * 420, type: 'sine', dur: 0.3, vol: 0.03, slide: 1200, delay: i * 0.05 });
  }
  formation() {
    this.tone({ freq: 900, type: 'triangle', dur: 0.12, vol: 0.05 });
    this.tone({ freq: 1350, type: 'triangle', dur: 0.16, vol: 0.04, delay: 0.06 });
  }
  intercept(pos) {
    if (!this.throttle('icpt', 0.06)) return;
    this.tone({ freq: 3200, type: 'sine', dur: 0.2, vol: 0.05, pos });
    this.noise({ dur: 0.1, vol: 0.1, freq: 4000, type: 'bandpass', pos });
  }
  enemyShot(pos) {
    if (!this.throttle('eshot', 0.06)) return;
    this.tone({ freq: 380, type: 'sawtooth', dur: 0.16, vol: 0.04, slide: -200, pos, filter: 1800 });
  }
  hurt() {
    if (!this.throttle('hurt', 0.12)) return;
    this.noise({ dur: 0.25, vol: 0.28, freq: 700 });
    this.tone({ freq: 110, type: 'square', dur: 0.18, vol: 0.07, slide: -50, filter: 600 });
  }
  explosion(pos, big = false) {
    if (!this.throttle('boom', 0.04)) return;
    this.noise({ dur: big ? 2.2 : 0.8, vol: big ? 0.7 : 0.35, freq: big ? 1400 : 2200, slide: big ? -1300 : -2000, pos });
    this.tone({ freq: big ? 70 : 120, type: 'sine', dur: big ? 1.6 : 0.5, vol: big ? 0.5 : 0.25, slide: big ? -45 : -80, pos });
    this.noise({ dur: 0.15, vol: 0.2, freq: 3000, type: 'highpass', pos, delay: 0.02 });
  }
  burst() {
    this.tone({ freq: 70, type: 'sine', dur: 1.2, vol: 0.45, slide: -40 });
    this.noise({ dur: 1.0, vol: 0.45, freq: 5000, slide: -4800 });
    this.noise({ dur: 0.4, vol: 0.15, freq: 300, type: 'bandpass', slide: 2500, q: 3 });
  }
  shield() {
    [440, 660, 880].forEach((f, i) => this.tone({ freq: f, type: 'triangle', dur: 0.8, vol: 0.06, slide: f * 0.5, delay: i * 0.05 }));
  }
  storm() {
    this.noise({ dur: 2.5, vol: 0.3, freq: 600, type: 'bandpass', q: 1.5, slide: 4000 });
    for (let i = 0; i < 14; i++) this.tone({ freq: 2000 + Math.random() * 2000, type: 'sine', dur: 0.4, vol: 0.03, delay: 0.3 + i * 0.12 });
  }
  pickup() {
    if (!this.throttle('pick', 0.04)) return;
    this.tone({ freq: 1320 + Math.random() * 200, type: 'sine', dur: 0.12, vol: 0.05 });
  }
  reward() {
    this.tone({ freq: 880, type: 'triangle', dur: 0.14, vol: 0.07 });
    this.tone({ freq: 1320, type: 'triangle', dur: 0.2, vol: 0.06, delay: 0.08 });
    this.tone({ freq: 1760, type: 'triangle', dur: 0.3, vol: 0.05, delay: 0.16 });
  }
  ui() { if (this.throttle('ui', 0.04)) this.tone({ freq: 1200, type: 'square', dur: 0.04, vol: 0.025, filter: 3000 }); }
  hover() { if (this.throttle('hover', 0.03)) this.tone({ freq: 2400, type: 'sine', dur: 0.03, vol: 0.015 }); }
  confirm() { this.tone({ freq: 660, type: 'square', dur: 0.06, vol: 0.03, filter: 2500 }); this.tone({ freq: 990, type: 'square', dur: 0.1, vol: 0.03, filter: 2500, delay: 0.06 }); }
  deny() { this.tone({ freq: 180, type: 'square', dur: 0.14, vol: 0.05, filter: 900 }); }
  lock() { this.tone({ freq: 1600, type: 'square', dur: 0.05, vol: 0.025, filter: 4000 }); this.tone({ freq: 2100, type: 'square', dur: 0.06, vol: 0.025, filter: 4000, delay: 0.05 }); }
  stageUp() { [523, 659, 784, 1046].forEach((f, i) => this.tone({ freq: f, type: 'triangle', dur: 0.5, vol: 0.07, delay: i * 0.07 })); }
  breakthrough() {
    [261, 329, 392, 523, 659, 784, 1046, 1318].forEach((f, i) => this.tone({ freq: f, type: 'triangle', dur: 2.2, vol: 0.07, delay: i * 0.08, attack: 0.05 }));
    this.noise({ dur: 2.5, vol: 0.35, freq: 6000, slide: -5800 });
    this.tone({ freq: 55, type: 'sine', dur: 2.5, vol: 0.4, slide: -20 });
  }
  thunder(pos) {
    this.noise({ dur: 1.8, vol: 0.6, freq: 3000, slide: -2800, pos });
    this.noise({ dur: 0.08, vol: 0.5, freq: 8000, type: 'highpass', pos });
    this.tone({ freq: 50, type: 'sawtooth', dur: 1.2, vol: 0.14, slide: -20, filter: 300 });
  }
  warn() { if (this.throttle('warn', 0.25)) this.tone({ freq: 1500, type: 'square', dur: 0.06, vol: 0.03, filter: 3000 }); }
  warp() {
    this.tone({ freq: 60, type: 'sawtooth', dur: 2.4, vol: 0.14, slide: 1100, attack: 0.4, filter: 2500 });
    this.noise({ dur: 2.4, vol: 0.28, freq: 200, slide: 7000, attack: 0.3 });
  }
  arrive() {
    this.noise({ dur: 1.4, vol: 0.3, freq: 6000, slide: -5800 });
    this.tone({ freq: 90, type: 'sine', dur: 1.2, vol: 0.3, slide: -50 });
  }
  death() { this.tone({ freq: 320, type: 'sawtooth', dur: 2, vol: 0.12, slide: -280, filter: 1500 }); this.noise({ dur: 1.5, vol: 0.3, freq: 800, slide: -700 }); }
  scanTick() { if (this.throttle('scan', 0.1)) this.tone({ freq: 1800 + Math.random() * 600, type: 'sine', dur: 0.05, vol: 0.02 }); }

  // -------------------------------------------------------------- loops --
  startLoops() {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 800;
    this.windFilter.Q.value = 1.4;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    src.connect(this.windFilter).connect(this.windGain).connect(this.sfxBus);
    src.start();

    // weather: a hiss of rain, and a low howl of wind for storms
    const rain = ctx.createBufferSource();
    rain.buffer = this.noiseBuf;
    rain.loop = true;
    rain.playbackRate.value = 0.93;
    this.rainFilter = ctx.createBiquadFilter();
    this.rainFilter.type = 'bandpass';
    this.rainFilter.frequency.value = 2600;
    this.rainFilter.Q.value = 0.45;
    this.rainGain = ctx.createGain();
    this.rainGain.gain.value = 0;
    rain.connect(this.rainFilter).connect(this.rainGain).connect(this.sfxBus);
    rain.start();
    const gust = ctx.createBufferSource();
    gust.buffer = this.noiseBuf;
    gust.loop = true;
    gust.playbackRate.value = 0.71;
    this.gustFilter = ctx.createBiquadFilter();
    this.gustFilter.type = 'bandpass';
    this.gustFilter.frequency.value = 380;
    this.gustFilter.Q.value = 2.2;
    this.gustGain = ctx.createGain();
    this.gustGain.gain.value = 0;
    gust.connect(this.gustFilter).connect(this.gustGain).connect(this.sfxBus);
    gust.start();

    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = 48;
    const o2 = ctx.createOscillator();
    o2.type = 'sawtooth';
    o2.frequency.value = 48.6;
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 200;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    o.connect(this.engineFilter);
    o2.connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain).connect(this.sfxBus);
    o.start();
    o2.start();
    this.engineOsc = [o, o2];
  }

  updateLoops({ swordSpeed = 0, boost = 0, speed = 0 }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const w = Math.min(1, swordSpeed / 500);
    this.windGain.gain.setTargetAtTime(w * 0.16, t, 0.08);
    this.windFilter.frequency.setTargetAtTime(500 + w * 2500, t, 0.08);
    this.engineGain.gain.setTargetAtTime(boost * 0.07 + Math.min(1, speed / 400) * 0.02, t, 0.15);
    this.engineFilter.frequency.setTargetAtTime(150 + boost * 600 + speed * 0.5, t, 0.15);
    this.engineOsc[0].frequency.setTargetAtTime(44 + speed * 0.05, t, 0.2);
    this.engineOsc[1].frequency.setTargetAtTime(44.6 + speed * 0.05, t, 0.2);
  }

  // rain: 0..1 how hard it falls; gust: 0..1 how hard the wind blows; muffled under cover
  setWeather(rain, gust, time = 0) {
    if (!this.ctx || !this.rainGain) return;
    const t = this.ctx.currentTime;
    this.rainGain.gain.setTargetAtTime(rain * 0.16, t, 0.6);
    this.gustGain.gain.setTargetAtTime(gust * (0.12 + 0.08 * Math.sin(time * 0.6)), t, 0.4);
    this.gustFilter.frequency.setTargetAtTime(300 + gust * 260 * (1 + 0.4 * Math.sin(time * 0.9)), t, 0.4);
  }

  thunder(dist) {
    if (!this.ctx) return;
    const delay = Math.min(4, dist / 340);
    const near = Math.max(0.15, 1 - dist / 1600);
    if (dist < 500) this.noise({ dur: 0.35, vol: 0.5 * near, freq: 2500, type: 'highpass', delay });
    this.noise({ dur: 3.2, vol: 0.6 * near, freq: 240, slide: -160, delay: delay + 0.05, attack: 0.05 });
    this.noise({ dur: 2.2, vol: 0.3 * near, freq: 90, type: 'lowpass', delay: delay + 0.4, attack: 0.2 });
  }

  // -------------------------------------------------------------- music --
  setGalaxy(i) {
    this.galaxy = i;
  }

  setIntensity(x, trib) {
    this.intensity = x;
    this.trib = trib;
  }

  startMusic() {
    const ctx = this.ctx;
    this.padBus = ctx.createGain();
    this.padBus.gain.value = 0;
    this.padBus.gain.setTargetAtTime(1, ctx.currentTime, 2);
    this.padBus.connect(this.musicBus);
    this.combatBus = ctx.createGain();
    this.combatBus.gain.value = 0;
    this.combatBus.connect(this.musicBus);
    this.delay = ctx.createDelay(1.5);
    this.delay.delayTime.value = STEP * 3;
    const fb = ctx.createGain();
    fb.gain.value = 0.42;
    this.delay.connect(fb).connect(this.delay);
    this.delay.connect(this.padBus);
    this.arpBus = ctx.createGain();
    this.arpBus.gain.value = 1;
    this.arpBus.connect(this.delay);
    this.arpBus.connect(this.padBus);
    this.drone = ctx.createOscillator();
    this.drone.type = 'sine';
    this.droneGain = ctx.createGain();
    this.droneGain.gain.value = 0.06;
    this.drone.connect(this.droneGain).connect(this.padBus);
    this.drone.start();
    this.chordIdx = 0;
    this.nextChord = ctx.currentTime + 0.2;
    this.nextStep = ctx.currentTime + 0.2;
    this.step = 0;
    this.combatLevel = 0;
    this.timer = setInterval(() => this.schedule(), 50);
  }

  currentChord() {
    const chords = REGIONS[this.galaxy].chords;
    return chords[this.chordIdx % chords.length];
  }

  schedule() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    const ahead = 0.25;
    while (this.nextChord < now + ahead) {
      this.playChord(this.nextChord);
      this.nextChord += STEP * 64;
    }
    while (this.nextStep < now + ahead) {
      this.playStep(this.nextStep, this.step++);
      this.nextStep += STEP;
    }
    const target = Math.max(this.intensity, this.trib ? 1 : 0);
    this.combatLevel += (target - this.combatLevel) * 0.05;
    this.combatBus.gain.setTargetAtTime(this.combatLevel * 0.55, now, 0.3);
  }

  playChord(t) {
    const ctx = this.ctx;
    this.chordIdx++;
    const chord = this.currentChord();
    const len = STEP * 64;
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.setValueAtTime(500, t);
    filt.frequency.linearRampToValueAtTime(1400, t + len * 0.5);
    filt.frequency.linearRampToValueAtTime(600, t + len + 3);
    filt.Q.value = 0.7;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.03, t + 3);
    g.gain.setValueAtTime(0.03, t + len - 0.5);
    g.gain.linearRampToValueAtTime(0.0001, t + len + 3);
    filt.connect(g).connect(this.padBus);
    for (const n of chord) {
      for (const det of [-9, 7]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = midi(n);
        o.detune.value = det;
        o.connect(filt);
        o.start(t);
        o.stop(t + len + 3.2);
      }
    }
    this.drone.frequency.setTargetAtTime(midi(chord[0] - 24), t, 1.5);
  }

  playStep(t, step) {
    const chord = this.currentChord();
    if (step % 4 === 0 && Math.random() < 0.5) {
      const n = chord[Math.floor(Math.random() * chord.length)] + (Math.random() < 0.6 ? 24 : 12);
      this.toneAt(t, { freq: midi(n), type: 'triangle', dur: 0.7, vol: 0.022, bus: this.arpBus });
    }
    if (this.combatLevel < 0.02 && !this.trib) return;
    const bus = this.combatBus;
    if (step % 4 === 0) this.toneAt(t, { freq: 130, slide: -95, type: 'sine', dur: 0.28, vol: 0.5, bus });
    if (step % 2 === 1) this.noiseAt(t, { dur: 0.04, vol: 0.08, freq: 8000, type: 'highpass', bus });
    if (step % 8 === 4) this.noiseAt(t, { dur: 0.18, vol: 0.22, freq: 1600, type: 'bandpass', q: 0.8, bus });
    if (step % 2 === 0) {
      const pattern = [0, 0, 12, 0, 7, 0, 10, 12];
      const n = chord[0] - 12 + pattern[(step / 2) % 8];
      this.toneAt(t, { freq: midi(n), type: 'sawtooth', dur: STEP * 1.6, vol: 0.12, bus, filter: 700 });
    }
    if (this.trib && step % 8 === 0) {
      this.toneAt(t, { freq: 90, slide: -55, type: 'sine', dur: 0.6, vol: 0.6, bus });
      this.noiseAt(t, { dur: 0.3, vol: 0.25, freq: 400, bus });
    }
  }

  toneAt(t, o) {
    this.tone({ ...o, delay: Math.max(0, t - this.ctx.currentTime) });
  }

  noiseAt(t, o) {
    this.noise({ ...o, delay: Math.max(0, t - this.ctx.currentTime) });
  }
}
