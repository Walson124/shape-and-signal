import { DEFAULT_BINDINGS } from './bindings.js';

// Player settings with graphics presets, persisted in localStorage.
const KEY = 'starsea-settings-v1';

export const PRESETS = {
  minimal: { label: 'Minimal', pixelRatio: 0.75, msaa: 0, bloomStrength: 0.6, texRes: 512, skyRes: 512, particles: 3000, dust: 300, belt: 250, flare: false, planetSeg: 48, leaf: 160, split: 1.4, crowd: 0.25, interiorLights: false },
  low: { label: 'Low', pixelRatio: 1, msaa: 0, bloomStrength: 0.7, texRes: 512, skyRes: 1024, particles: 5000, dust: 700, belt: 500, flare: false, planetSeg: 64, leaf: 110, split: 1.7, crowd: 0.5, interiorLights: false },
  medium: { label: 'Medium', pixelRatio: 1.25, msaa: 2, bloomStrength: 0.8, texRes: 1024, skyRes: 1024, particles: 8000, dust: 1400, belt: 900, flare: true, planetSeg: 96, leaf: 70, split: 2.1, crowd: 0.8, interiorLights: true },
  high: { label: 'High', pixelRatio: 1.5, msaa: 4, bloomStrength: 0.85, texRes: 1024, skyRes: 2048, particles: 12000, dust: 2200, belt: 1400, flare: true, planetSeg: 128, leaf: 50, split: 2.5, crowd: 1, interiorLights: true },
  ultra: { label: 'Ultra', pixelRatio: 2, msaa: 4, bloomStrength: 0.9, texRes: 2048, skyRes: 2048, particles: 16000, dust: 3000, belt: 2200, flare: true, planetSeg: 160, leaf: 36, split: 2.9, crowd: 1.3, interiorLights: true },
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
  bloom: true,
  vignette: true,
  showFps: false,
  // gameplay
  cultivateMode: 'toggle',
  headBob: true,
  autoSprint: false,
  hudScale: 1,
  // world detail
  terrainDetail: 1,
  propDensity: 1,
  crowds: true,
  bindings: { ...DEFAULT_BINDINGS },
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
    const saved = load();
    this.data = { ...DEFAULTS, ...saved, bindings: { ...DEFAULT_BINDINGS, ...(saved.bindings || {}) } };
    if (!PRESETS[this.data.quality]) this.data.quality = DEFAULTS.quality;
    this.listeners = new Set();
  }

  get(k) {
    return this.data[k];
  }

  persist() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      /* storage unavailable */
    }
  }

  set(k, v) {
    if (this.data[k] === v) return;
    this.data[k] = v;
    this.persist();
    for (const fn of this.listeners) fn(k, v);
  }

  // Bind an action to a code. Any other action already using that code swaps
  // to the old code so nothing is left unreachable.
  bind(action, code) {
    const b = { ...this.data.bindings };
    const prev = b[action];
    for (const [k, c] of Object.entries(b)) if (c === code && k !== action) b[k] = prev;
    b[action] = code;
    this.set('bindings', b);
  }

  key(action) {
    return this.data.bindings[action];
  }

  resetBindings() {
    this.set('bindings', { ...DEFAULT_BINDINGS });
  }

  reset() {
    for (const [k, v] of Object.entries(DEFAULTS)) this.set(k, k === 'bindings' ? { ...v } : v);
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
