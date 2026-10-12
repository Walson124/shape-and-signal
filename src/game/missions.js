import { BEASTS, BOSSES, REGIONS, stageXpNeed, essenceFor } from './data.js';
import { starsNear, getStar } from '../world/galaxy.js';

export const MAX_BOUNTIES = 3;

const HUNT_FLAVOR = {
  mite: ['Cull the Mite Swarm', 'Void Mites are chewing through cargo lanes and farmland.'],
  ray: ['Ray Season', 'Star Rays have been strafing survey drones.'],
  rockback: ['Shell Breaker', 'Rockback Devourers are eating the mining fields.'],
  wraith: ['Ghost Hunt', 'Nebula Wraiths haunt the energy springs.'],
};

// Bounty offers posted at a settlement or station.
export function generateOffers(state, ctx, count = 3) {
  const { star } = ctx;
  const reg = REGIONS[star.region];
  const T = Math.max(star.tier, Math.min(state.realm, star.tier + 1));
  const stageXp = stageXpNeed(state.realm, state.stage);
  const coin = (k) => Math.round(k * Math.pow(2.2, T));
  const offers = [];
  const types = ['hunt', 'hunt', 'elite', 'explore', 'cultivate', 'mine'];
  const lairs = starsNear(star.pos, 120).filter((s) => s.star.boss !== null && !state.bosses.includes(s.star.key));
  if (lairs.length) types.push('overlord');
  const taken = new Set([...state.bounties, ...state.offers].map((b) => b.type + (b.target || '')));
  let guard = 0;
  while (offers.length < count && guard++ < 40) {
    const type = types[Math.floor(Math.random() * types.length)];
    const id = ++state.bountySeq;
    let b;
    if (type === 'hunt') {
      const pool = ['mite', 'ray', 'rockback', ...(T >= 2 ? ['wraith'] : [])];
      const target = pool[Math.floor(Math.random() * pool.length)];
      const need = target === 'rockback' ? 3 + Math.floor(Math.random() * 3) : 6 + Math.floor(Math.random() * 6);
      const [title, desc] = HUNT_FLAVOR[target];
      b = { id, type, target, need, title, desc: `${desc} Slay ${need} ${BEASTS[target].name}s anywhere in the ${reg.name}.`, reward: { coins: coin(10 * need), xp: Math.round(stageXp * 0.3), essence: essenceFor(T) * need } };
    } else if (type === 'elite') {
      b = { id, type, need: 1, title: 'Golden Quarry', desc: 'A gold-marked elite beast prowls nearby. Slay any elite.', reward: { coins: coin(140), xp: Math.round(stageXp * 0.4), essence: essenceFor(T) * 8 } };
    } else if (type === 'explore') {
      const need = 2 + Math.floor(Math.random() * 3);
      b = { id, type, need, title: 'Survey Contract', desc: `The Survey Guild pays for fresh data. Discover ${need} new ruins, springs, wrecks or nests on any world.`, reward: { coins: coin(60 * need), xp: Math.round(stageXp * 0.35), essence: essenceFor(T) * 3 } };
    } else if (type === 'cultivate') {
      const need = Math.round(stageXp * 0.5);
      b = { id, type, need, title: 'Still Waters', desc: 'Your master wants proof of discipline. Gather experience through cultivation.', reward: { coins: coin(90), xp: 0, essence: essenceFor(T) * 6 } };
    } else if (type === 'mine') {
      const need = 2 + Math.floor(Math.random() * 3);
      b = { id, type, need, title: 'Star Metal Run', desc: `The shipyards are short of star metal. Shatter ${need} glowing ore deposits.`, reward: { coins: coin(80 * need), xp: Math.round(stageXp * 0.25), essence: essenceFor(T) * 4 } };
    } else {
      const lair = lairs[0];
      const boss = BOSSES[lair.star.boss];
      b = { id, type: 'overlord', target: lair.star.key, need: 1, title: 'Overlord Writ', desc: `The ${boss.name} has made its lair in the ${lair.star.name} system, ${lair.dist.toFixed(0)} light years away. Slay it.`, reward: { coins: coin(900), xp: Math.round(stageXp * 1.2), essence: essenceFor(T) * 60 } };
    }
    const key = b.type + (b.target || '');
    if (taken.has(key)) continue;
    taken.add(key);
    b.progress = 0;
    b.region = star.region;
    offers.push(b);
  }
  return offers;
}

export function progressBounties(state, event) {
  const done = [];
  for (const b of state.bounties) {
    if (b.progress >= b.need) continue;
    let inc = 0;
    if (event.kind === 'kill') {
      if (b.type === 'hunt' && event.type === b.target && (b.region === undefined || event.region === b.region)) inc = 1;
      else if (b.type === 'elite' && event.elite) inc = 1;
      else if (b.type === 'overlord' && event.bossStar && event.bossStar === b.target) inc = 1;
    } else if (event.kind === 'discover' && b.type === 'explore') inc = 1;
    else if (event.kind === 'mine' && b.type === 'mine') inc = 1;
    else if (event.kind === 'cultivate' && b.type === 'cultivate') inc = event.amount;
    if (inc) {
      b.progress = Math.min(b.need, b.progress + inc);
      if (b.progress >= b.need) done.push(b);
    }
  }
  if (done.length) state.bounties = state.bounties.filter((b) => !done.includes(b));
  return done;
}

export function describeTarget(key) {
  const s = getStar(key);
  return s ? s.name : key;
}
