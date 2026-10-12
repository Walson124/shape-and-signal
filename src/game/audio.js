// Tiny synthesized sound kit. Nothing is loaded from the network.
export class Sound {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.last = {};
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.55;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.startAmbient();
    } catch {
      this.ctx = null;
    }
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.55;
    return this.muted;
  }

  throttle(name, gap) {
    if (!this.ctx) return false;
    const now = this.ctx.currentTime;
    if (this.last[name] && now - this.last[name] < gap) return false;
    this.last[name] = now;
    return true;
  }

  tone({ freq = 440, type = 'sine', dur = 0.15, vol = 0.2, slide = 0, attack = 0.005, delay = 0 }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  noise({ dur = 0.3, vol = 0.3, freq = 1200, q = 0.8, slide = 0, delay = 0 }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(freq, t);
    if (slide) f.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  shot() { if (this.throttle('shot', 0.05)) this.tone({ freq: 980, type: 'triangle', dur: 0.09, vol: 0.05, slide: -600 }); }
  hit() { if (this.throttle('hit', 0.04)) this.noise({ dur: 0.08, vol: 0.12, freq: 2400 }); }
  enemyShot() { if (this.throttle('eshot', 0.08)) this.tone({ freq: 320, type: 'sawtooth', dur: 0.12, vol: 0.025, slide: -150 }); }
  hurt() { if (this.throttle('hurt', 0.15)) { this.noise({ dur: 0.2, vol: 0.22, freq: 600 }); this.tone({ freq: 140, type: 'square', dur: 0.15, vol: 0.06, slide: -60 }); } }
  boom(big = false) {
    if (!this.throttle('boom', 0.05)) return;
    this.noise({ dur: big ? 1.4 : 0.5, vol: big ? 0.5 : 0.25, freq: big ? 900 : 1600, slide: -700 });
    this.tone({ freq: big ? 70 : 110, type: 'sine', dur: big ? 1.2 : 0.4, vol: big ? 0.35 : 0.15, slide: -50 });
  }
  swords() {
    for (let i = 0; i < 3; i++) this.tone({ freq: 1400 + i * 300, type: 'sine', dur: 0.25, vol: 0.05, slide: 800, delay: i * 0.04 });
  }
  burst() {
    this.noise({ dur: 0.9, vol: 0.4, freq: 3000, slide: -2800 });
    this.tone({ freq: 90, type: 'sine', dur: 0.8, vol: 0.3, slide: -40 });
  }
  shieldOn() { this.tone({ freq: 440, type: 'triangle', dur: 0.6, vol: 0.12, slide: 440 }); this.tone({ freq: 660, type: 'sine', dur: 0.6, vol: 0.08, slide: 660 }); }
  pickup() { this.tone({ freq: 880, type: 'sine', dur: 0.12, vol: 0.08 }); this.tone({ freq: 1320, type: 'sine', dur: 0.18, vol: 0.07, delay: 0.07 }); }
  ui() { if (this.throttle('ui', 0.05)) this.tone({ freq: 660, type: 'sine', dur: 0.06, vol: 0.05 }); }
  deny() { this.tone({ freq: 200, type: 'square', dur: 0.12, vol: 0.05 }); }
  stageUp() { [523, 659, 784].forEach((f, i) => this.tone({ freq: f, type: 'triangle', dur: 0.35, vol: 0.09, delay: i * 0.08 })); }
  breakthrough() {
    [261, 329, 392, 523, 659, 784, 1046].forEach((f, i) => this.tone({ freq: f, type: 'triangle', dur: 1.6, vol: 0.09, delay: i * 0.09, attack: 0.05 }));
    this.noise({ dur: 2, vol: 0.3, freq: 5000, slide: -4800 });
  }
  thunder() {
    this.noise({ dur: 1.6, vol: 0.55, freq: 2500, slide: -2300 });
    this.tone({ freq: 55, type: 'sawtooth', dur: 1.0, vol: 0.12, slide: -20 });
  }
  warningTick() { if (this.throttle('warn', 0.2)) this.tone({ freq: 1200, type: 'square', dur: 0.05, vol: 0.03 }); }
  warp() {
    this.tone({ freq: 80, type: 'sawtooth', dur: 1.8, vol: 0.12, slide: 900, attack: 0.3 });
    this.noise({ dur: 1.9, vol: 0.25, freq: 300, slide: 6000 });
  }
  death() { this.tone({ freq: 300, type: 'sawtooth', dur: 1.6, vol: 0.12, slide: -260 }); }

  startAmbient() {
    if (!this.ctx) return;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 420;
    const g = this.ctx.createGain();
    g.gain.value = 0.05;
    f.connect(g).connect(this.master);
    this.amb = [0, 1, 2].map((i) => {
      const o = this.ctx.createOscillator();
      o.type = i === 2 ? 'triangle' : 'sawtooth';
      o.frequency.value = 55 * (i === 1 ? 1.5 : i === 2 ? 2 : 1);
      o.detune.value = (i - 1) * 7;
      o.connect(f);
      o.start();
      return o;
    });
    const lfo = this.ctx.createOscillator();
    const lg = this.ctx.createGain();
    lfo.frequency.value = 0.07;
    lg.gain.value = 180;
    lfo.connect(lg).connect(f.frequency);
    lfo.start();
  }

  setDrone(base) {
    if (!this.amb) return;
    const t = this.ctx.currentTime;
    this.amb[0].frequency.linearRampToValueAtTime(base, t + 2);
    this.amb[1].frequency.linearRampToValueAtTime(base * 1.5, t + 2);
    this.amb[2].frequency.linearRampToValueAtTime(base * 2, t + 2);
  }
}
