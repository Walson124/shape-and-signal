import { power, stageXpNeed } from './data.js';

const SAVE_KEY = 'starsea-ascension-save-v1';

export function newState() {
  return {
    v: 1,
    realm: 0,
    stage: 0,
    xp: 0,
    coins: 40,
    mastery: { bolt: 1, swords: 1, burst: 1, body: 1 },
    devour: false,
    pills: { heal: 2, energy: 1, cult: 0 },
    galaxy: 0,
    system: 0,
    explored: [],
    bosses: [],
    kills: 0,
    playtime: 0,
    won: false,
    hintsShown: false,
  };
}

export function loadState() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || data.v !== 1) return null;
    const base = newState();
    return { ...base, ...data, mastery: { ...base.mastery, ...data.mastery }, pills: { ...base.pills, ...data.pills } };
  } catch {
    return null;
  }
}

export function saveState(state) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable: progress lasts for this session only */
  }
}

export function clearSave() {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    /* ignore */
  }
}

// Stats that follow from realm, stage and boss trophies.
export function derive(s) {
  const p = power(s.realm) * (1 + 0.18 * s.stage);
  const trophy = 1 + 0.1 * s.bosses.length;
  return {
    maxHp: Math.round(100 * p * trophy),
    atk: 10 * p * trophy,
    maxEnergy: 100 + 20 * s.realm,
    regen: 11 + 2.5 * s.realm,
    speed: 70 * (1 + 0.38 * s.realm + 0.06 * s.stage),
    xpNeed: stageXpNeed(s.realm, s.stage),
  };
}
