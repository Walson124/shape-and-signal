import { mulberry32 } from '../core/rng.js';

// Each world has its own beasts. Terra's are hand-made; every other world
// gets a deterministic set built from its climate and seed.

const FOOT = { wolf: 0.71, rhino: 0.5, lizard: 0.3, bear: 0.6, serpent: 0.3, insect: 0.42, golem: 1.05 };
const footing = (arch, variant) => FOOT[variant] ?? FOOT[arch] ?? 0.6;

function sp(o) {
  return {
    cores: 1, xp: 1, coins: 1, aggro: 240, fireRate: 2.2, shotSpeed: 150, minTier: 0, pack: [1, 2],
    ...o,
    walker: o.arch !== 'avian',
    footing: footing(o.arch, o.variant),
    behavior: o.behavior || 'swarm',
  };
}

// 怪兽 of the homeworld.
const TERRA = [
  sp({ id: 'ironwolf', name: 'Ironhide Wolf', cn: '铁甲狼', arch: 'quad', variant: 'wolf', color: 0x4c5260, accent: 0x7ad8ff, radius: 2.1, hp: 0.5, dmg: 0.45, xp: 0.6, coins: 0.6, speed: 64, behavior: 'swarm', pack: [3, 6], minTier: 0, desc: 'Pack hunters with fused steel-grey hides. The first beasts most warriors kill.' }),
  sp({ id: 'bladehawk', name: 'Bladewing Hawk', cn: '刃翼鹰', arch: 'avian', color: 0x7a5a36, accent: 0xffd060, radius: 2.4, hp: 0.55, dmg: 0.55, xp: 0.7, coins: 0.7, speed: 90, behavior: 'swarm', pack: [1, 3], minTier: 0, desc: 'Their wing edges cut like knives. They dive from above.' }),
  sp({ id: 'thunderlizard', name: 'Thunder Lizard', cn: '雷霆蜥', arch: 'quad', variant: 'lizard', color: 0x2c5a44, accent: 0x9ff0ff, radius: 2.8, hp: 0.9, dmg: 0.8, xp: 1, coins: 1, speed: 46, behavior: 'ranged', fireRate: 2.4, shotSpeed: 140, pack: [1, 3], minTier: 0.25, desc: 'Spits balls of lightning from a distance.' }),
  sp({ id: 'shadowmantis', name: 'Shadow Mantis', cn: '影螳螂', arch: 'insect', color: 0x1e2a1e, accent: 0x7aff8a, radius: 2.5, hp: 0.8, dmg: 1.0, xp: 1, coins: 1, speed: 80, behavior: 'swarm', pack: [2, 4], minTier: 0.45, desc: 'Fast and silent. Its scythes find the gaps in armour.' }),
  sp({ id: 'goldhorn', name: 'Golden-horn Rhino', cn: '金角犀', arch: 'quad', variant: 'rhino', color: 0x5c4838, accent: 0xffc040, radius: 5.2, hp: 3, dmg: 1.6, xp: 2.4, coins: 2.5, cores: 3, speed: 38, behavior: 'tank', pack: [1, 2], minTier: 0.6, desc: 'A living battering ram. Get out of the way when it lowers its horn.' }),
  sp({ id: 'frostbear', name: 'Frostclaw Bear', cn: '冰爪熊', arch: 'quad', variant: 'bear', color: 0xbfc8d4, accent: 0x7ab8ff, radius: 4.2, hp: 2.2, dmg: 1.4, xp: 1.8, coins: 1.8, cores: 2, speed: 44, behavior: 'tank', pack: [1, 2], minTier: 0.9, desc: 'Roams the colder lands far from the cities.' }),
  sp({ id: 'earthwyrm', name: 'Earth Wyrm', cn: '地龙', arch: 'serpent', color: 0x6a4e2c, accent: 0xff8040, radius: 6.5, hp: 4.2, dmg: 1.9, xp: 3.2, coins: 3, cores: 4, speed: 40, behavior: 'tank', pack: [1, 1], minTier: 1.1, desc: 'A burrowing dragon-kin. Only the strongest War Gods hunt them.' }),
  sp({ id: 'stonegiant', name: 'Mountain Golem', cn: '山岳巨兽', arch: 'golem', color: 0x6a645c, accent: 0xff6a2a, radius: 7, hp: 5, dmg: 2.1, xp: 3.8, coins: 3.5, cores: 5, speed: 26, behavior: 'tank', pack: [1, 1], minTier: 1.35, desc: 'Molten veins glow through its stone hide.' }),
];

const PALETTES = {
  terran: [[0x4a5a3a, 0x9aff6a], [0x5a4a3a, 0xffc060], [0x3a4a5a, 0x7ad8ff]],
  desert: [[0x9a7a4a, 0xff9a3a], [0x7a5a3a, 0xffd060], [0x6a4a2a, 0xff5a3a]],
  ice: [[0xb8c8d8, 0x7ab8ff], [0x8a9aaa, 0x9ff0ff], [0xd8e0ea, 0xb08cff]],
  lava: [[0x2a1a14, 0xff5a1a], [0x3a2018, 0xffa040], [0x1a1414, 0xff2a2a]],
  toxic: [[0x3a4a1a, 0xb4ff4a], [0x2a3a2a, 0x7aff9a], [0x4a3a1a, 0xe0ff4a]],
  crystal: [[0x3a2a5a, 0xc08cff], [0x2a3a5a, 0x7affe0], [0x5a3a5a, 0xff8ad8]],
  rocky: [[0x5a5450, 0xff8a4a], [0x4a4a52, 0x9ad8ff], [0x5a4a40, 0xffd060]],
};
const ADJ = {
  terran: ['Thorn', 'Moss', 'Grove', 'Bramble', 'Verdant'],
  desert: ['Sand', 'Dune', 'Scorch', 'Dust', 'Sun'],
  ice: ['Frost', 'Rime', 'Glacier', 'Snow', 'Hoar'],
  lava: ['Magma', 'Cinder', 'Ember', 'Ash', 'Slag'],
  toxic: ['Spore', 'Blight', 'Venom', 'Mire', 'Rot'],
  crystal: ['Prism', 'Shard', 'Geode', 'Glass', 'Gleam'],
  rocky: ['Crag', 'Iron', 'Grit', 'Basalt', 'Flint'],
};
const CN_ADJ = { terran: '荆', desert: '沙', ice: '霜', lava: '炎', toxic: '毒', crystal: '晶', rocky: '岩' };
const KINDS = [
  { arch: 'quad', variant: 'wolf', noun: ['Stalker', 'Hound', 'Prowler'], cn: '狼', radius: [1.9, 2.6], hp: 0.55, dmg: 0.5, speed: 66, behavior: 'swarm', pack: [3, 5], minTier: 0 },
  { arch: 'insect', noun: ['Crawler', 'Mantis', 'Scuttler'], cn: '虫', radius: [2.2, 3], hp: 0.75, dmg: 0.9, speed: 78, behavior: 'swarm', pack: [2, 4], minTier: 0 },
  { arch: 'avian', noun: ['Glider', 'Raptor', 'Wing'], cn: '鹰', radius: [2.2, 3], hp: 0.6, dmg: 0.6, speed: 92, behavior: 'swarm', pack: [1, 3], minTier: 0 },
  { arch: 'quad', variant: 'lizard', noun: ['Spitter', 'Basilisk', 'Drake'], cn: '蜥', radius: [2.6, 3.4], hp: 0.95, dmg: 0.8, speed: 46, behavior: 'ranged', pack: [1, 3], minTier: 0.2 },
  { arch: 'quad', variant: 'rhino', noun: ['Behemoth', 'Ram', 'Tusker'], cn: '犀', radius: [4.6, 6], hp: 3, dmg: 1.6, speed: 38, behavior: 'tank', pack: [1, 2], minTier: 0.4, cores: 3 },
  { arch: 'quad', variant: 'bear', noun: ['Mauler', 'Brute', 'Ravager'], cn: '熊', radius: [3.8, 4.8], hp: 2.2, dmg: 1.4, speed: 44, behavior: 'tank', pack: [1, 2], minTier: 0.3, cores: 2 },
  { arch: 'serpent', noun: ['Wyrm', 'Worm', 'Serpent'], cn: '蛇', radius: [5.5, 8], hp: 4, dmg: 1.9, speed: 40, behavior: 'tank', pack: [1, 1], minTier: 0.6, cores: 4 },
  { arch: 'golem', noun: ['Colossus', 'Golem', 'Titan'], cn: '巨像', radius: [6, 8], hp: 5, dmg: 2.1, speed: 26, behavior: 'tank', pack: [1, 1], minTier: 0.8, cores: 5 },
];

const cache = new Map();

export function speciesForBody(body) {
  if (cache.has(body.id + body.seed)) return cache.get(body.id + body.seed);
  let list;
  if (body.id === 'p2' && body.name === 'Terra') list = TERRA;
  else {
    const r = mulberry32((body.seed ^ 0xbea57) >>> 0);
    const type = PALETTES[body.type] ? body.type : 'rocky';
    const pal = PALETTES[type];
    const adj = ADJ[type];
    // always one small pack hunter, then a random mix
    const pool = KINDS.slice();
    const picks = [pool.splice(Math.floor(r() * 2), 1)[0]];
    const want = 4 + Math.floor(r() * 2);
    while (picks.length < want && pool.length) picks.push(pool.splice(Math.floor(r() * pool.length), 1)[0]);
    list = picks.map((k, i) => {
      const [color, accent] = pal[Math.floor(r() * pal.length)];
      const noun = k.noun[Math.floor(r() * k.noun.length)];
      const a = adj[Math.floor(r() * adj.length)];
      return sp({
        id: `${body.id}:${i}`, name: `${a} ${noun}`, cn: `${CN_ADJ[type]}${k.cn}`, arch: k.arch, variant: k.variant, color, accent,
        radius: k.radius[0] + r() * (k.radius[1] - k.radius[0]), hp: k.hp * (0.85 + r() * 0.3), dmg: k.dmg * (0.85 + r() * 0.3),
        xp: k.hp * 0.8 + 0.2, coins: k.hp * 0.8 + 0.2, cores: k.cores || 1, speed: k.speed * (0.9 + r() * 0.2), behavior: k.behavior,
        pack: k.pack, minTier: k.minTier, horns: r() < 0.4, spikes: r() < 0.5 ? 0.3 + r() * 0.6 : 0,
        desc: `Native to ${body.name}.`,
      });
    });
  }
  cache.set(body.id + body.seed, list);
  return list;
}

// Pick a species for a spawn, weighted toward the tier band.
export function pickSpecies(list, tier, rand = Math.random) {
  const ok = list.filter((s) => s.minTier <= tier + 0.05);
  const pool = ok.length ? ok : list;
  // prefer species near the top of what this tier allows
  const weights = pool.map((s) => 1 + Math.max(0, 1 - Math.abs(tier - s.minTier - 0.3)) * 1.5);
  let t = rand() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < pool.length; i++) {
    t -= weights[i];
    if (t <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}
