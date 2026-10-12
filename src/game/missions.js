import { BEASTS, BOSSES, GALAXIES, stageXpNeed, essenceFor } from './data.js';

export const MAX_BOUNTIES = 3;

const HUNT_FLAVOR = {
  mite: ['Cull the Mite Swarm', 'Void Mites are chewing through cargo lanes. Thin them out.'],
  ray: ['Ray Season', 'Star Rays have been strafing survey drones. Bring them down.'],
  rockback: ['Shell Breaker', 'Rockback Devourers are eating the mining belts. Crack their shells.'],
  wraith: ['Ghost Hunt', 'Nebula Wraiths haunt the energy nebulae. Banish them.'],
};

// Bounty offers at a station, scaled to the galaxy and the player's realm.
export function generateOffers(state, count = 3) {
  const g = GALAXIES[state.galaxy];
  const T = Math.min(g.tiers[g.tiers.length - 1], Math.max(g.tiers[0], state.realm));
  const stageXp = stageXpNeed(state.realm, state.stage);
  const coin = (k) => Math.round(k * Math.pow(2.2, T));
  const offers = [];
  const types = ['hunt', 'hunt', 'elite', 'explore', 'cultivate'];
  if (!state.bosses.includes(g.boss)) types.push('overlord');
  const taken = new Set([...state.bounties, ...state.offers].map((b) => b.type + (b.target || '')));
  let guard = 0;
  while (offers.length < count && guard++ < 30) {
    const type = types[Math.floor(Math.random() * types.length)];
    const id = ++state.bountySeq;
    let b;
    if (type === 'hunt') {
      const pool = ['mite', 'ray', 'rockback', ...(T >= 2 ? ['wraith'] : [])];
      const target = pool[Math.floor(Math.random() * pool.length)];
      const need = target === 'rockback' ? 3 + Math.floor(Math.random() * 3) : 6 + Math.floor(Math.random() * 6);
      const [title, desc] = HUNT_FLAVOR[target];
      b = { id, type, target, need, title, desc: `${desc} Slay ${need} ${BEASTS[target].name}s in the ${g.name}.`, reward: { coins: coin(10 * need), xp: Math.round(stageXp * 0.3), essence: essenceFor(T) * need } };
    } else if (type === 'elite') {
      b = { id, type, need: 1, title: 'Golden Quarry', desc: `A gold-marked elite beast has been sighted in the ${g.name}. Slay any elite.`, reward: { coins: coin(140), xp: Math.round(stageXp * 0.4), essence: essenceFor(T) * 8 } };
    } else if (type === 'explore') {
      const need = 2 + Math.floor(Math.random() * 2);
      b = { id, type, need, title: 'Survey Contract', desc: `The Survey Guild pays for fresh data. Explore ${need} worlds you have not explored before.`, reward: { coins: coin(70 * need), xp: Math.round(stageXp * 0.35), essence: essenceFor(T) * 3 } };
    } else if (type === 'cultivate') {
      const need = Math.round(stageXp * 0.5);
      b = { id, type, need, title: 'Still Waters', desc: 'Your master wants proof of discipline. Gather experience through cultivation.', reward: { coins: coin(90), xp: 0, essence: essenceFor(T) * 6 } };
    } else {
      const boss = BOSSES[g.boss];
      b = { id, type: 'overlord', target: String(g.boss), need: 1, title: 'Overlord Writ', desc: `Every station in the ${g.name} has pooled a bounty on the ${boss.name}. Slay it.`, reward: { coins: coin(900), xp: Math.round(stageXp * 1.2), essence: essenceFor(T) * 60 } };
    }
    const key = b.type + (b.target || '');
    if (taken.has(key)) continue;
    taken.add(key);
    b.progress = 0;
    b.galaxy = state.galaxy;
    offers.push(b);
  }
  return offers;
}

// Apply a game event to active bounties. Returns the bounties it completed.
export function progressBounties(state, event) {
  const done = [];
  for (const b of state.bounties) {
    if (b.progress >= b.need) continue;
    let inc = 0;
    if (event.kind === 'kill') {
      if (b.type === 'hunt' && b.galaxy === state.galaxy && event.type === b.target) inc = 1;
      else if (b.type === 'elite' && event.elite) inc = 1;
      else if (b.type === 'overlord' && event.boss !== undefined && String(event.boss) === b.target) inc = 1;
    } else if (event.kind === 'explore' && b.type === 'explore') inc = 1;
    else if (event.kind === 'cultivate' && b.type === 'cultivate') inc = event.amount;
    if (inc) {
      b.progress = Math.min(b.need, b.progress + inc);
      if (b.progress >= b.need) done.push(b);
    }
  }
  if (done.length) state.bounties = state.bounties.filter((b) => !done.includes(b));
  return done;
}
