import { mulberry32, hashString, pick, range } from '../core/rng.js';

// ---------------------------------------------------------------------------
// Cultivation ladder: ten realms of four stages each. A lightning tribulation
// separates one realm from the next.
// ---------------------------------------------------------------------------
export const REALMS = [
  { name: 'Warrior', cn: '战士', color: 0x8fb8ff, blurb: 'A mortal body tempered by cosmic energy. Three spirit swords answer your will.' },
  { name: 'War God', cn: '战神', color: 0x3ef2ff, blurb: 'Your strikes shatter mountains and your spirit sense sharpens.' },
  { name: 'Planetary', cn: '行星级', color: 0x5dffa8, blurb: 'You survive the void unaided. Domain Burst awakens.' },
  { name: 'Stellar', cn: '恒星级', color: 0xffe066, blurb: 'Your body burns like a star and your swords move faster than sight.' },
  { name: 'Cosmic', cn: '宇宙级', color: 0xffa040, blurb: 'Space bends around you. The Golden Body manifests.' },
  { name: 'Domain Lord', cn: '域主', color: 0xff3c7d, blurb: 'You rule a domain of your own. Lesser beasts flee your presence.' },
  { name: 'Realm Lord', cn: '界主', color: 0xe05cff, blurb: 'The laws of the universe obey you. Ten Thousand Swords descend at your call.' },
  { name: 'Immortal', cn: '不朽', color: 0xb69cff, blurb: 'Your soul can no longer be extinguished by ordinary means.' },
  { name: 'Venerable', cn: '尊者', color: 0xf2f4ff, blurb: 'Galaxies bow as you pass. Only the Primordial Core remains.' },
  { name: 'Universe Master', cn: '宇宙之主', color: 0xfff0b8, blurb: 'You stand at the summit of the cosmos.' },
];
export const MAX_REALM = REALMS.length - 1;

export const STAGES = [
  { name: 'Early', cn: '初期' },
  { name: 'Middle', cn: '中期' },
  { name: 'Late', cn: '后期' },
  { name: 'Peak', cn: '巅峰' },
];

export const power = (tier) => Math.pow(2.6, tier);
export const xpScale = (tier) => Math.pow(3, tier);
export const stageXpNeed = (realm, stage) => Math.round(100 * xpScale(realm) * (1 + 0.5 * stage));
export const realmOf = (tier) => REALMS[Math.max(0, Math.min(MAX_REALM, Math.floor(tier)))];
export const swordCount = (realm) => Math.min(12, 3 + realm);

// ---------------------------------------------------------------------------
// Techniques. Energy fuels bolts and arts; spirit sense fuels the swords.
// ---------------------------------------------------------------------------
export const TECHNIQUES = {
  bolt: { name: 'Star Bolt', cn: '星芒', key: 'LMB', cost: 3, cd: 0.15, unlockRealm: 0, res: 'energy', desc: 'Fire condensed starlight from your palms.' },
  swords: { name: 'Flying Swords', cn: '飞剑', key: 'RMB · Q', cost: 25, cd: 2.4, unlockRealm: 0, res: 'spirit', desc: 'Hold right mouse to steer your swords with your mind. Q looses them at targets. Z switches formation.' },
  burst: { name: 'Domain Burst', cn: '领域爆发', key: 'R', cost: 40, cd: 7, unlockRealm: 2, res: 'energy', desc: 'Expand your domain in a shockwave that crushes nearby beasts.' },
  body: { name: 'Golden Body', cn: '金身', key: 'F', cost: 30, cd: 16, duration: 6, unlockRealm: 4, res: 'energy', desc: 'Harden your body for 6 seconds, taking 70% less damage.' },
  storm: { name: 'Ten Thousand Swords', cn: '万剑归宗', key: 'V', cost: 90, cd: 30, unlockRealm: 6, res: 'energy', desc: 'Call a storm of phantom swords down upon every beast around you.' },
  devour: { name: 'Devouring Art', cn: '吞噬秘法', key: 'passive', unlockRealm: 99, desc: 'Passive. Slain beasts restore your life and you cultivate 50% faster. Found only in ancient ruins.' },
};
export const ACTIVE_TECHNIQUES = ['bolt', 'swords', 'burst', 'body', 'storm'];
export const masteryMult = (m) => 1 + 0.25 * (m - 1);

// Sword grades are forged at stations with star coins and beast essence.
export const SWORD_GRADES = [
  { name: 'Cold Iron', cn: '寒铁', mult: 1, blade: 0xb8c8dc, glow: 0x8fd8ff, coins: 0, essence: 0 },
  { name: 'Star Steel', cn: '星钢', mult: 1.7, blade: 0xd8e4ff, glow: 0x3ef2ff, coins: 600, essence: 300 },
  { name: 'Void Crystal', cn: '虚晶', mult: 2.9, blade: 0xc8b0ff, glow: 0xb06cff, coins: 14000, essence: 9000 },
  { name: 'Nebula Jade', cn: '星玉', mult: 4.8, blade: 0xb8ffe0, glow: 0x3dffb0, coins: 300000, essence: 220000 },
  { name: 'Primordial Edge', cn: '原初', mult: 8, blade: 0xfff0d0, glow: 0xff3c7d, coins: 6000000, essence: 5000000 },
];

export const PILLS = {
  heal: { name: 'Rejuvenation Pill', cn: '回春丹', key: '1', price: 30, desc: 'Restore 60% of your life.' },
  energy: { name: 'Primal Elixir', cn: '元能液', key: '2', price: 20, desc: 'Restore all energy and spirit sense.' },
  cult: { name: 'Cultivation Pill', cn: '修炼丹', key: '3', price: 140, desc: 'Gain a third of your current stage experience.' },
};
export const MANUAL_PRICE = 320;
export const priceFor = (base, realm) => Math.round(base * Math.pow(2.2, realm));
export const essenceFor = (tier) => Math.round(4 * xpScale(tier));

// ---------------------------------------------------------------------------
// Cosmic beasts.
// ---------------------------------------------------------------------------
export const BEASTS = {
  mite: { name: 'Void Mite', cn: '虚空蚁', hp: 0.5, dmg: 0.55, xp: 0.6, coins: 0.5, cores: 1, speed: 92, radius: 3, behavior: 'swarm', color: 0xa060ff, aggro: 380 },
  ray: { name: 'Star Ray', cn: '星鳐', hp: 1.0, dmg: 0.9, xp: 1.0, coins: 1, cores: 1, speed: 78, radius: 6.5, behavior: 'ranged', color: 0x2fd6ff, aggro: 460, fireRate: 1.9, shotSpeed: 170 },
  rockback: { name: 'Rockback Devourer', cn: '噬岩兽', hp: 3.4, dmg: 1.7, xp: 2.4, coins: 2.5, cores: 3, speed: 42, radius: 13, behavior: 'tank', color: 0xff7a2a, aggro: 340 },
  wraith: { name: 'Nebula Wraith', cn: '星云魅影', hp: 1.3, dmg: 1.2, xp: 1.7, coins: 1.6, cores: 2, speed: 120, radius: 6, behavior: 'blink', color: 0x7dffcf, aggro: 520, shotSpeed: 210 },
};

export const BOSSES = [
  { name: 'Abyssal Leviathan', cn: '深渊巨鲸', color: 0x3aa0ff, accent: 0x9fe6ff, hp: 45, dmg: 1.3, xp: 40, coins: 60, radius: 48, speed: 70 },
  { name: 'Crimson Sky-Wyrm', cn: '赤霄龙', color: 0xff3b2f, accent: 0xffc06a, hp: 50, dmg: 1.4, xp: 40, coins: 60, radius: 52, speed: 85 },
  { name: 'Jadebone Colossus', cn: '翠骨巨像', color: 0x2fe39a, accent: 0xd8ffe8, hp: 60, dmg: 1.5, xp: 40, coins: 60, radius: 60, speed: 60 },
  { name: 'Ancient Sentinel', cn: '远古守卫', color: 0xc08bff, accent: 0xffe1a8, hp: 65, dmg: 1.5, xp: 40, coins: 60, radius: 58, speed: 75 },
  { name: 'Primordial Devourer', cn: '原初吞噬者', color: 0xff2fa0, accent: 0xfff2a8, hp: 80, dmg: 1.6, xp: 60, coins: 100, radius: 72, speed: 80 },
];
export const FINAL_BOSS = BOSSES.length - 1;

// ---------------------------------------------------------------------------
// The universe: five galaxies, each a chain of star systems of rising danger.
// sky: [nebula A, nebula B, base, highlight]
// ---------------------------------------------------------------------------
export const GALAXIES = [
  {
    id: 'azure', name: 'Azure Spiral', cn: '青旋星系', reqRealm: 0, tiers: [0, 1, 1, 2, 2, 3], boss: 0,
    sky: ['#2a5cff', '#8a3cff', '#060a24', '#3ef2ff'], chords: [[57, 64, 67, 71], [53, 60, 64, 69], [48, 55, 64, 67], [55, 62, 66, 69]],
    desc: 'Your home galaxy. Young stars, gentle nebulae, and beasts a Warrior can handle.',
  },
  {
    id: 'crimson', name: 'Crimson Maelstrom', cn: '赤漩星系', reqRealm: 3, tiers: [3, 3, 4, 4, 5, 5], boss: 1,
    sky: ['#ff3a1a', '#ffaa2a', '#1c0404', '#ff3c7d'], chords: [[52, 59, 62, 67], [48, 55, 60, 64], [50, 57, 60, 65], [47, 54, 59, 62]],
    desc: 'A galaxy of red giants and burning dust. Its beasts hunt Stellar cultivators for sport.',
  },
  {
    id: 'jade', name: 'Jade Abyss', cn: '翠渊星系', reqRealm: 5, tiers: [5, 5, 6, 6, 7, 7], boss: 2,
    sky: ['#12e6a0', '#2a7cff', '#021612', '#b8ffe0'], chords: [[50, 57, 62, 66], [55, 62, 66, 69], [52, 59, 64, 67], [47, 54, 62, 66]],
    desc: 'Emerald nebulae hide colossal predators and the bones of fallen lords.',
  },
  {
    id: 'ruin', name: 'Shattered Ancients', cn: '古碎星域', reqRealm: 7, tiers: [7, 7, 7.5, 8, 8, 8], boss: 3,
    sky: ['#a86cff', '#ffc46a', '#100620', '#ff3c7d'], chords: [[49, 56, 61, 64], [45, 52, 57, 61], [47, 54, 59, 62], [44, 51, 56, 63]],
    desc: 'The broken remains of an ancient civilization. Their guardians still keep watch.',
  },
  {
    id: 'origin', name: 'Primordial Core', cn: '原初之核', reqRealm: 8, tiers: [8, 8.3, 8.6], boss: 4,
    sky: ['#ff2a9a', '#ffd86a', '#160214', '#ffffff'], chords: [[45, 52, 55, 60], [41, 48, 53, 57], [43, 50, 55, 58], [40, 47, 52, 56]],
    desc: 'The heart of the universe. Whatever devours stars here bars the path to Universe Master.',
  },
];

export const STAR_TYPES = {
  yellow: { label: 'Yellow star', core: 0xfff1b0, edge: 0xff9a2a, glow: 0xffb347, r: [150, 200] },
  blue: { label: 'Blue giant', core: 0xe6f0ff, edge: 0x3a6cff, glow: 0x6a9cff, r: [190, 250] },
  red: { label: 'Red giant', core: 0xffb48a, edge: 0xc42a10, glow: 0xff4a24, r: [240, 310] },
  white: { label: 'White dwarf', core: 0xffffff, edge: 0x9ab8ff, glow: 0xcfe0ff, r: [90, 120] },
  violet: { label: 'Violet star', core: 0xffd8ff, edge: 0x9a2aff, glow: 0xc060ff, r: [170, 230] },
  green: { label: 'Jade star', core: 0xeaffef, edge: 0x10b070, glow: 0x40ffb0, r: [160, 220] },
};
const GALAXY_STARS = {
  azure: ['yellow', 'blue', 'white', 'yellow', 'violet'],
  crimson: ['red', 'red', 'yellow', 'white'],
  jade: ['green', 'blue', 'green', 'white'],
  ruin: ['violet', 'white', 'red', 'violet'],
  origin: ['violet', 'white', 'red'],
};
export const GALAXY_PLANETS = {
  azure: ['terran', 'rocky', 'gas', 'ice', 'lava', 'gas'],
  crimson: ['lava', 'rocky', 'gas', 'toxic', 'lava'],
  jade: ['toxic', 'terran', 'gas', 'crystal', 'ice'],
  ruin: ['crystal', 'rocky', 'ice', 'gas', 'lava'],
  origin: ['crystal', 'lava', 'gas', 'crystal'],
};

const SYL_A = ['Ka', 'Vel', 'Or', 'Zeph', 'Tal', 'Mir', 'Sar', 'Quo', 'Ny', 'Ar', 'Lux', 'Dra', 'Ser', 'Xi', 'Hel', 'Cor', 'Ves', 'Ul', 'Rhe', 'Tau'];
const SYL_B = ['ion', 'ara', 'eth', 'ux', 'an', 'oria', 'is', 'enth', 'os', 'yra', 'ova', 'ael', 'un', 'ix', 'ari', 'eon'];
const SYL_C = ['', '', ' Prime', ' Minor', ' Major', ' Reach', ' Deep', ' Verge'];
const systemName = (rand) => pick(rand, SYL_A) + pick(rand, SYL_B) + pick(rand, SYL_C);

const cache = new Map();
export function getGalaxySystems(gIndex) {
  if (cache.has(gIndex)) return cache.get(gIndex);
  const g = GALAXIES[gIndex];
  const rand = mulberry32(hashString(`galaxy:${g.id}`));
  const n = g.tiers.length;
  const used = new Set();
  const systems = g.tiers.map((tier, i) => {
    const seed = hashString(`${g.id}:${i}`);
    const r2 = mulberry32(seed);
    let name = systemName(r2);
    while (used.has(name)) name = systemName(r2);
    if (gIndex === 0 && i === 0) name = 'Solace';
    used.add(name);
    const starType = gIndex === 0 && i === 0 ? 'yellow' : pick(r2, GALAXY_STARS[g.id]);
    return {
      index: i, galaxy: gIndex, name, tier, seed, starType,
      station: i === 0, gate: i === 0, boss: i === n - 1 ? g.boss : null,
      mapX: 8 + (i / Math.max(1, n - 1)) * 84,
      mapY: 50 + Math.sin(i * 1.7 + rand() * 2) * 26 + range(rand, -6, 6),
    };
  });
  cache.set(gIndex, systems);
  return systems;
}

export const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];

export const TIPS = [
  'Hold right mouse to take direct control of your flying swords. Sweep them through beasts like a blade storm.',
  'Lance formation (Z) lines your swords into a piercing spear. Swarm formation surrounds a target.',
  'Idle swords guard you, knocking enemy projectiles out of the sky.',
  'Cosmic energy is densest near stars and inside glowing nebulae. Cultivate there.',
  'Beasts far below your realm teach you little. Seek stronger prey.',
  'Ancient ruins hide inheritances. Look for planets marked with ruins.',
  'Dock at a station to heal, take bounties, forge your swords and refine beast essence.',
  'At Peak stage, press B to face the Heavenly Tribulation. Keep moving.',
  'Press T while looking at a marker to set a course, then G to cruise there.',
  'Each galaxy Overlord you slay permanently strengthens your body.',
];
