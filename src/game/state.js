import { power, stageXpNeed, swordCount } from './data.js';
import { PATHS, TECHS, skillMods } from './paths.js';

const SAVE_KEY = 'starsea-ascension-save-v1';
const VERSION = 4;
const baseMastery = () => Object.fromEntries(Object.keys(TECHS).map((k) => [k, 1]));

export function newState() {
  return {
    v: VERSION,
    realm: 0,
    stage: 0,
    xp: 0,
    coins: 150,
    essence: 0,
    ore: 0,
    swordGrade: 0,
    mastery: baseMastery(),
    path: null,
    skills: {},
    home: null,
    stash: 0,
    arena: 0,
    jobsDone: 0,
    gene: 0,
    rumors: [],
    chamberUntil: 0,
    meal: null,
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
  const out = { ...base, ...data, mastery: { ...base.mastery, ...data.mastery }, pills: { ...base.pills, ...data.pills }, skills: { ...(data.skills || {}) } };
  if (data.v < 4) {
    // paths arrived: old mastery maps onto the Mind Control path
    const m = data.mastery || {};
    out.mastery.volley = m.swords || 1;
    out.mastery.storm = m.storm || 1;
    out.path = null;
  }
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
  const path = PATHS[s.path] || PATHS.mind;
  const mods = skillMods(s);
  const p = power(s.realm) * (1 + 0.18 * s.stage);
  const trophy = (1 + 0.1 * s.bosses.length) * (1 + 0.06 * (s.gene || 0));
  const speed = 1 + (mods.speed || 0);
  return {
    maxHp: Math.round(100 * p * trophy * path.hpMult * (1 + (mods.hp || 0))),
    atk: 10 * p * trophy * (1 + (mods.dmg || 0)),
    maxEnergy: Math.round((100 + 20 * s.realm) * path.energyMult),
    regen: (11 + 2.5 * s.realm) * (1 + (mods.regen || 0)),
    maxSpirit: Math.round((100 + 15 * s.realm) * path.spiritMult * (1 + (mods.spirit || 0))),
    spiritRegen: (18 + 2.5 * s.realm) * path.spiritMult * (1 + (mods.regen || 0)),
    // movement grows a lot with realm so each one feels different
    walk: 6 * (1 + 0.28 * s.realm) * speed,
    jump: (8 + s.realm * 4.5) * Math.sqrt(speed),
    flySpeed: (40 + s.realm * 30) * speed,
    spaceSpeed: 150 * (1 + 0.6 * s.realm) * speed,
    cruiseCap: 20000 * Math.pow(2.2, Math.max(0, s.realm - 2)) * (s.realm >= 8 ? 10 : 1),
    xpNeed: stageXpNeed(s.realm, s.stage),
    swords: Math.max(1, Math.round(swordCount(s.realm) * path.swordMult) + (mods.swords || 0)),
    crit: 0.08 + (mods.crit || 0),
    armor: Math.min(0.6, mods.armor || 0),
    lifesteal: mods.lifesteal || 0,
    cdr: Math.min(0.5, mods.cdr || 0),
    cultivate: 1 + (mods.cultivate || 0),
    loot: 1 + (mods.loot || 0),
    reach: 1 + (mods.reach || 0),
    swordDmg: 1 + (mods.swordDmg || 0),
    costMult: s.realm >= 9 ? 0.5 : 1,
    mods,
  };
}
