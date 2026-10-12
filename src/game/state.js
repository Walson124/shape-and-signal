import { power, stageXpNeed, swordCount } from './data.js';

const SAVE_KEY = 'starsea-ascension-save-v1';
const VERSION = 3;

export function newState() {
  return {
    v: VERSION,
    realm: 0,
    stage: 0,
    xp: 0,
    coins: 60,
    essence: 0,
    ore: 0,
    swordGrade: 0,
    mastery: { bolt: 1, swords: 1, burst: 1, body: 1, storm: 1 },
    devour: false,
    pills: { heal: 2, energy: 1, cult: 0 },
    explored: [],
    discovered: [],
    bosses: [],
    visited: ['home'],
    kills: 0,
    playtime: 0,
    worldTime: 60,
    won: false,
    intro: false,
    bounties: [],
    offers: [],
    bountySeq: 0,
    completedBounties: 0,
    // where the player is: star key, body id (or null for open space), local position and view
    loc: null,
    ship: null,
    bind: null,
  };
}

function migrate(data) {
  const base = newState();
  const out = { ...base, ...data, mastery: { ...base.mastery, ...data.mastery }, pills: { ...base.pills, ...data.pills } };
  if (data.v < 3) {
    // the world changed shape: keep cultivation progress, restart at home
    out.bosses = (data.bosses || []).map((b) => (typeof b === 'number' ? `legacy:${b}` : b));
    out.loc = null;
    out.ship = null;
    out.bind = null;
    out.offers = [];
    out.bounties = [];
    out.explored = [];
    out.discovered = [];
    out.visited = ['home'];
    out.intro = false;
    delete out.galaxy;
    delete out.system;
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
    walk: 6 + s.realm * 0.6,
    jump: 8 + s.realm * 1.6,
    flySpeed: 40 + s.realm * 25,
    spaceSpeed: 150 * (1 + 0.6 * s.realm),
    cruiseCap: 20000 * Math.pow(2.2, Math.max(0, s.realm - 2)),
    xpNeed: stageXpNeed(s.realm, s.stage),
    swords: swordCount(s.realm),
  };
}
