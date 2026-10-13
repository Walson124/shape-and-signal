import { BEASTS, BOSSES, REGIONS, stageXpNeed, essenceFor } from './data.js';
import { starsNear, getStar } from '../world/galaxy.js';

export const MAX_BOUNTIES = 4;

const HUNT_FLAVOR = {
  mite: ['Cull the Mite Swarm', 'Void Mites are chewing through cargo lanes.'],
  ray: ['Ray Season', 'Star Rays have been strafing survey drones.'],
  rockback: ['Shell Breaker', 'Rockback Devourers are eating the mining fields.'],
  wraith: ['Ghost Hunt', 'Nebula Wraiths haunt the energy springs.'],
};
const HUNT_TITLES = ['Cull the Pack', 'Beast Tide', 'Wilderness Patrol', 'Clear the Roads', 'Trophy Hunt', 'Protect the Farms'];

/**
 * Bounty offers posted at a settlement or station.
 * ctx: { star, species?: local beast list, cities?: [{name, body, bodyName}] , here?: city name }
 */
export function generateOffers(state, ctx, count = 3) {
  const { star } = ctx;
  const reg = REGIONS[star.region];
  const T = Math.max(star.tier, Math.min(state.realm, star.tier + 1));
  const stageXp = stageXpNeed(state.realm, state.stage);
  const coin = (k) => Math.round(k * 3 * Math.pow(2.2, T));
  const offers = [];
  const types = ['hunt', 'hunt', 'elite', 'explore', 'cultivate', 'mine'];
  const others = (ctx.cities || []).filter((c) => c.name !== ctx.here);
  if (others.length) types.push('courier', 'courier');
  const lairs = starsNear(star.pos, 120).filter((s) => s.star.boss !== null && !state.bosses.includes(s.star.key));
  if (lairs.length) types.push('overlord');
  const taken = new Set([...state.bounties, ...state.offers].map((b) => b.type + (b.target || '')));
  let guard = 0;
  while (offers.length < count && guard++ < 40) {
    const type = types[Math.floor(Math.random() * types.length)];
    const id = ++state.bountySeq;
    let b;
    if (type === 'hunt') {
      const local = (ctx.species || []).filter((s) => s.minTier <= T + 0.4);
      if (local.length) {
        const sp = local[Math.floor(Math.random() * local.length)];
        const big = sp.behavior === 'tank';
        const need = big ? 2 + Math.floor(Math.random() * 3) : 5 + Math.floor(Math.random() * 6);
        const title = HUNT_TITLES[Math.floor(Math.random() * HUNT_TITLES.length)];
        b = { id, type, target: sp.id, targetName: sp.name, need, title, desc: `${sp.name}s (${sp.cn}) are threatening the settlements. Slay ${need}.`, reward: { coins: coin((big ? 30 : 10) * need), xp: Math.round(stageXp * 0.3), essence: essenceFor(T) * need * (big ? 3 : 1) } };
      } else {
        const pool = ['mite', 'ray', 'rockback', ...(T >= 2 ? ['wraith'] : [])];
        const target = pool[Math.floor(Math.random() * pool.length)];
        const need = target === 'rockback' ? 3 + Math.floor(Math.random() * 3) : 6 + Math.floor(Math.random() * 6);
        const [title, desc] = HUNT_FLAVOR[target];
        b = { id, type, target, targetName: BEASTS[target].name, need, title, desc: `${desc} Slay ${need} ${BEASTS[target].name}s anywhere in the ${reg.name}.`, reward: { coins: coin(10 * need), xp: Math.round(stageXp * 0.3), essence: essenceFor(T) * need } };
      }
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
    } else if (type === 'courier') {
      const c = others[Math.floor(Math.random() * others.length)];
      b = { id, type, target: c.name, targetName: c.name, need: 1, title: `Courier to ${c.name}`, desc: `Carry a sealed case to any service counter in ${c.name}${c.bodyName ? ` on ${c.bodyName}` : ''}. Beasts on the road are your problem.`, reward: { coins: coin(70 + (c.dist || 0) / 200), xp: Math.round(stageXp * 0.2), essence: essenceFor(T) * 2 } };
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

// The Martial Hall's breakthrough trial: hunt beasts at or above your grade.
export function insightTrial(state) {
  const id = ++state.bountySeq;
  const stageXp = stageXpNeed(state.realm, state.stage);
  return {
    id, type: 'insight', need: 6, progress: 0, region: 0,
    title: 'Breakthrough Trial',
    desc: 'The masters will grant a Realm Insight to a cultivator who proves themselves. Slay 6 beasts of your own grade or higher, anywhere.',
    reward: { coins: Math.round(60 * Math.pow(2.2, state.realm)), xp: Math.round(stageXp * 0.1), essence: essenceFor(state.realm) * 4, insight: 1 },
  };
}

export function progressBounties(state, event) {
  const done = [];
  for (const b of state.bounties) {
    if (b.progress >= b.need) continue;
    let inc = 0;
    if (event.kind === 'kill') {
      if (b.type === 'hunt' && event.type === b.target) inc = 1;
      else if (b.type === 'elite' && event.elite) inc = 1;
      else if (b.type === 'insight' && event.tier !== undefined && event.tier >= event.realm - 0.25) inc = 1;
      else if (b.type === 'overlord' && event.bossStar && event.bossStar === b.target) inc = 1;
    } else if (event.kind === 'discover' && b.type === 'explore') inc = 1;
    else if (event.kind === 'mine' && b.type === 'mine') inc = 1;
    else if (event.kind === 'cultivate' && b.type === 'cultivate') inc = event.amount;
    else if (event.kind === 'arrive' && b.type === 'courier' && event.city === b.target) inc = 1;
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
