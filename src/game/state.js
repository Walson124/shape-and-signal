import { power, stageXpNeed, swordCount } from './data.js';

const SAVE_KEY = 'starsea-ascension-save-v1';
const VERSION = 2;

export function newState() {
  return {
    v: VERSION,
    realm: 0,
    stage: 0,
    xp: 0,
    coins: 60,
    essence: 0,
    swordGrade: 0,
    mastery: { bolt: 1, swords: 1, burst: 1, body: 1, storm: 1 },
    devour: false,
    pills: { heal: 2, energy: 1, cult: 0 },
    galaxy: 0,
    system: 0,
    explored: [],
    bosses: [],
    kills: 0,
    playtime: 0,
    won: false,
    intro: false,
    bounties: [],
    offers: [],
    bountySeq: 0,
    completedBounties: 0,
  };
}

function migrate(data) {
  const base = newState();
  const out = { ...base, ...data, mastery: { ...base.mastery, ...data.mastery }, pills: { ...base.pills, ...data.pills } };
  if (data.v === 1) {
    out.intro = !!data.hintsShown;
    delete out.hintsShown;
  }
  out.v = VERSION;
  return out;
}

export function loadState() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || typeof data.v !== 'number' || data.v > VERSION) return null;
    return migrate(data);
  } catch {
    return null;
  }
}

export function saveState(state) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function clearSave() {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    /* ignore */
  }
}

export function derive(s) {
  const p = power(s.realm) * (1 + 0.18 * s.stage);
  const trophy = 1 + 0.1 * s.bosses.length;
  return {
    maxHp: Math.round(100 * p * trophy),
    atk: 10 * p * trophy,
    maxEnergy: 100 + 20 * s.realm,
    regen: 11 + 2.5 * s.realm,
    maxSpirit: 100 + 15 * s.realm,
    spiritRegen: 18 + 2.5 * s.realm,
    speed: 72 * (1 + 0.38 * s.realm + 0.06 * s.stage),
    xpNeed: stageXpNeed(s.realm, s.stage),
    swords: swordCount(s.realm),
  };
}
