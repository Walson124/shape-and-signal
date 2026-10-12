// Player settings with graphics presets, persisted in localStorage.
const KEY = 'starsea-settings-v1';

export const PRESETS = {
  low: { label: 'Low', pixelRatio: 1, msaa: 0, bloomStrength: 0.7, texRes: 512, skyRes: 1024, particles: 5000, dust: 700, belt: 500, flare: false, planetSeg: 64 },
  medium: { label: 'Medium', pixelRatio: 1.25, msaa: 2, bloomStrength: 0.8, texRes: 1024, skyRes: 1024, particles: 8000, dust: 1400, belt: 900, flare: true, planetSeg: 96 },
  high: { label: 'High', pixelRatio: 1.5, msaa: 4, bloomStrength: 0.85, texRes: 1024, skyRes: 2048, particles: 12000, dust: 2200, belt: 1400, flare: true, planetSeg: 128 },
  ultra: { label: 'Ultra', pixelRatio: 2, msaa: 4, bloomStrength: 0.9, texRes: 2048, skyRes: 2048, particles: 16000, dust: 3000, belt: 2200, flare: true, planetSeg: 160 },
};

const DEFAULTS = {
  quality: 'high',
  renderScale: 1,
  dynamicRes: true,
  fov: 80,
  sensitivity: 1,
  invertY: false,
  master: 0.8,
  music: 0.5,
  sfx: 0.85,
  camera: 'first',
  shake: true,
  damageNumbers: true,
  speedBlur: true,
  grain: true,
  aberration: true,
  showFps: false,
};

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

class Settings {
  constructor() {
    this.data = { ...DEFAULTS, ...load() };
    if (!PRESETS[this.data.quality]) this.data.quality = DEFAULTS.quality;
    this.listeners = new Set();
  }

  get(k) {
    return this.data[k];
  }

  set(k, v) {
    if (this.data[k] === v) return;
    this.data[k] = v;
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      /* storage unavailable */
    }
    for (const fn of this.listeners) fn(k, v);
  }

  reset() {
    for (const [k, v] of Object.entries(DEFAULTS)) this.set(k, v);
  }

  get preset() {
    return PRESETS[this.data.quality];
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

export const settings = new Settings();
