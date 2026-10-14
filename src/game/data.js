import { pick } from '../core/rng.js';

// ---------------------------------------------------------------------------
// Cultivation ladder: ten realms of four stages each. A lightning tribulation
// separates one realm from the next.
// ---------------------------------------------------------------------------
export const REALMS = [
  { name: 'Warrior', cn: '战士', color: 0x8fb8ff, blurb: 'A mortal body tempered by cosmic energy. You can run, leap and fight, but you are bound to your homeworld.' },
  { name: 'War God', cn: '战神', color: 0x3ef2ff, blurb: 'Your strikes shatter boulders. You can take to the skies of any world and leap over rooftops.' },
  { name: 'Planetary', cn: '行星级', color: 0x5dffa8, blurb: 'Your body survives the void. The stars are open to you, and you may own a starship.' },
  { name: 'Stellar', cn: '恒星级', color: 0xffe066, blurb: 'Your body burns like a star. Star Step lets you blink across a battlefield.' },
  { name: 'Cosmic', cn: '宇宙级', color: 0xffa040, blurb: 'Space bends around you. Lesser beasts sense your aura and flee.' },
  { name: 'Domain Lord', cn: '域主', color: 0xff3c7d, blurb: 'You rule a domain of your own. Within it, beasts slow and weaken.' },
  { name: 'Realm Lord', cn: '界主', color: 0xe05cff, blurb: 'The laws of the universe obey you. Weak beasts are crushed by your presence alone.' },
  { name: 'Immortal', cn: '不朽', color: 0xb69cff, blurb: 'Your soul can no longer be extinguished by ordinary means. Death itself hesitates.' },
  { name: 'Venerable', cn: '尊者', color: 0xf2f4ff, blurb: 'Galaxies bow as you pass. You cross a star system in moments.' },
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
export const stageXpNeed = (realm, stage) => Math.round(220 * xpScale(realm) * (1 + 0.5 * stage));
export const realmOf = (tier) => REALMS[Math.max(0, Math.min(MAX_REALM, Math.floor(tier)))];
export const swordCount = (realm) => Math.min(12, 3 + realm);

// ---------------------------------------------------------------------------
// Techniques. Energy fuels bolts and arts; spirit sense fuels the swords.
// ---------------------------------------------------------------------------
export const DEVOUR = { name: 'Devouring Art', cn: '吞噬秘法', desc: 'Passive. Slain beasts restore your life and you cultivate 50% faster. Found only in ancient ruins.' };
export const masteryMult = (m) => 1 + 0.25 * (m - 1);

// Sword grades are forged at stations with star coins and beast essence.
export const SWORD_GRADES = [
  { name: 'Cold Iron', cn: '寒铁', mult: 1, blade: 0xb8c8dc, glow: 0x8fd8ff, coins: 0, essence: 0 },
  { name: 'Star Steel', cn: '星钢', mult: 1.7, blade: 0xd8e4ff, glow: 0x3ef2ff, coins: 250, essence: 120 },
  { name: 'Void Crystal', cn: '虚晶', mult: 2.9, blade: 0xc8b0ff, glow: 0xb06cff, coins: 4000, essence: 2500 },
  { name: 'Nebula Jade', cn: '星玉', mult: 4.8, blade: 0xb8ffe0, glow: 0x3dffb0, coins: 60000, essence: 40000 },
  { name: 'Primordial Edge', cn: '原初', mult: 8, blade: 0xfff0d0, glow: 0xff3c7d, coins: 900000, essence: 700000 },
];

export const PILLS = {
  heal: { name: 'Rejuvenation Pill', cn: '回春丹', key: '1', price: 15, desc: 'Restore 60% of your life.' },
  energy: { name: 'Primal Elixir', cn: '元能液', key: '2', price: 10, desc: 'Restore all energy and spirit sense.' },
  cult: { name: 'Cultivation Pill', cn: '修炼丹', key: '3', price: 70, desc: 'Gain a third of your current stage experience.' },
};
export const MANUAL_PRICE = 160;
// What the exchange pays for raw materials.
export const SELL = { ore: (realm) => Math.round(9 * Math.pow(1.9, realm)), essence: 0.5 };

// Scanners. reveal: how far unexplored sites show on the HUD. ping: range of an
// active pulse. finds: which kinds of site a pulse can pick out.
export const RADARS = [
  { name: 'Militia Radar', cn: '民用雷达', range: 600, reveal: 900, ping: 2500, finds: ['ore', 'wreck'], price: 150, desc: 'A basic handheld scanner. Picks out ore veins and wrecks within a couple of kilometres.' },
  { name: 'Hunter Radar', cn: '猎人雷达', range: 900, reveal: 1400, ping: 5000, finds: ['ore', 'wreck', 'camp'], price: 400, desc: 'Finds wrecks and hunters’ camps as well as ore.' },
  { name: 'Prospector Array', cn: '勘探阵列', range: 1300, reveal: 2200, ping: 9000, finds: ['ore', 'wreck', 'camp', 'ruin', 'spring'], price: 3500, desc: 'Reads ruins and energy springs through rock.' },
  { name: 'Seeker Matrix', cn: '寻踪矩阵', range: 2000, reveal: 3500, ping: 16000, finds: ['ore', 'wreck', 'camp', 'ruin', 'spring', 'obelisk', 'nest'], price: 40000, desc: 'Senses obelisks and beast nests far away.' },
  { name: 'Oracle Core', cn: '天机核心', range: 3000, reveal: 6000, ping: 40000, finds: ['ore', 'wreck', 'camp', 'ruin', 'spring', 'obelisk', 'nest', 'lair'], price: 600000, desc: 'Nothing on a world can hide from it, Overlord lairs included.' },
];
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
// The galaxy is endless. Danger rises with distance from home, and the bands
// of danger are named regions with their own skies, stars and Overlords.
// sky: [nebula A, nebula B, base, highlight]
// ---------------------------------------------------------------------------
export const REGIONS = [
  {
    id: 'azure', name: 'Azure Reach', cn: '青域', minTier: 0, boss: 0,
    sky: ['#2a5cff', '#8a3cff', '#060a24', '#3ef2ff'], chords: [[57, 64, 67, 71], [53, 60, 64, 69], [48, 55, 64, 67], [55, 62, 66, 69]],
    stars: ['yellow', 'yellow', 'blue', 'white', 'violet', 'red'], planets: ['terran', 'rocky', 'desert', 'ice', 'lava', 'toxic'],
    desc: 'The quiet spiral arm around your homeworld. Young stars and beasts a fresh cultivator can handle.',
  },
  {
    id: 'crimson', name: 'Crimson Expanse', cn: '赤域', minTier: 2.5, boss: 1,
    sky: ['#ff3a1a', '#ffaa2a', '#1c0404', '#ff3c7d'], chords: [[52, 59, 62, 67], [48, 55, 60, 64], [50, 57, 60, 65], [47, 54, 59, 62]],
    stars: ['red', 'red', 'yellow', 'white'], planets: ['lava', 'desert', 'rocky', 'toxic', 'lava'],
    desc: 'Red giants and burning dust. Its beasts hunt Stellar cultivators for sport.',
  },
  {
    id: 'jade', name: 'Jade Abyss', cn: '翠渊', minTier: 4.5, boss: 2,
    sky: ['#12e6a0', '#2a7cff', '#021612', '#b8ffe0'], chords: [[50, 57, 62, 66], [55, 62, 66, 69], [52, 59, 64, 67], [47, 54, 62, 66]],
    stars: ['green', 'blue', 'green', 'white'], planets: ['toxic', 'terran', 'crystal', 'ice'],
    desc: 'Emerald nebulae hide colossal predators and the bones of fallen lords.',
  },
  {
    id: 'ruin', name: 'Shattered Ancients', cn: '古碎星域', minTier: 6.5, boss: 3,
    sky: ['#a86cff', '#ffc46a', '#100620', '#ff3c7d'], chords: [[49, 56, 61, 64], [45, 52, 57, 61], [47, 54, 59, 62], [44, 51, 56, 63]],
    stars: ['violet', 'white', 'red'], planets: ['crystal', 'rocky', 'ice', 'lava'],
    desc: 'The broken remains of an ancient civilization. Their guardians still keep watch.',
  },
  {
    id: 'origin', name: 'Primordial Core', cn: '原初之核', minTier: 8.2, boss: 4,
    sky: ['#ff2a9a', '#ffd86a', '#160214', '#ffffff'], chords: [[45, 52, 55, 60], [41, 48, 53, 57], [43, 50, 55, 58], [40, 47, 52, 56]],
    stars: ['violet', 'white', 'red'], planets: ['crystal', 'lava', 'rocky'],
    desc: 'The heart of the galaxy. Whatever devours stars here bars the path to Universe Master.',
  },
];
export const regionForTier = (tier) => {
  let r = 0;
  REGIONS.forEach((g, i) => { if (tier >= g.minTier) r = i; });
  return r;
};

export const STAR_TYPES = {
  yellow: { label: 'Yellow star', core: 0xfff1b0, edge: 0xff9a2a, glow: 0xffb347, r: [42000, 60000], lum: 1 },
  blue: { label: 'Blue giant', core: 0xe6f0ff, edge: 0x3a6cff, glow: 0x6a9cff, r: [60000, 80000], lum: 3 },
  red: { label: 'Red giant', core: 0xffb48a, edge: 0xc42a10, glow: 0xff4a24, r: [70000, 95000], lum: 1.4 },
  white: { label: 'White dwarf', core: 0xffffff, edge: 0x9ab8ff, glow: 0xcfe0ff, r: [22000, 30000], lum: 0.6 },
  violet: { label: 'Violet star', core: 0xffd8ff, edge: 0x9a2aff, glow: 0xc060ff, r: [48000, 66000], lum: 1.6 },
  green: { label: 'Jade star', core: 0xeaffef, edge: 0x10b070, glow: 0x40ffb0, r: [46000, 62000], lum: 1.3 },
};

export const PLANET_INFO = {
  terran: { label: 'Living world', atmo: [0.45, 0.62, 1.0], ocean: 0x0a3a6a, landable: true },
  desert: { label: 'Desert world', atmo: [1.0, 0.72, 0.45], ocean: null, landable: true },
  ice: { label: 'Ice world', atmo: [0.7, 0.85, 1.0], ocean: null, landable: true },
  lava: { label: 'Volcanic world', atmo: [1.0, 0.45, 0.25], ocean: 'lava', landable: true },
  toxic: { label: 'Toxic world', atmo: [0.75, 1.0, 0.35], ocean: 0x3a5a10, landable: true },
  crystal: { label: 'Crystal world', atmo: [0.75, 0.55, 1.0], ocean: null, landable: true },
  rocky: { label: 'Barren rock', atmo: null, ocean: null, landable: true },
  gas: { label: 'Gas giant', atmo: [1.0, 0.85, 0.65], ocean: null, landable: false },
};

// Which realm unlocks which kind of movement.
export const FLIGHT = {
  canFly: (realm) => realm >= 1,
  canSpace: (realm) => realm >= 2,
};

// Starships, built at a city shipyard once you reach the Planetary realm.
export const SHIPS = [
  { name: 'Skyjet', cn: '飞梭', range: 15, cruise: 120000, speed: 900, hull: 1, coins: 800, ore: 12, essence: 40, color: 0x3ef2ff },
  { name: 'Corvette', cn: '护卫舰', range: 35, cruise: 300000, speed: 1400, hull: 2.6, coins: 12000, ore: 60, essence: 2000, color: 0x5dffa8 },
  { name: 'Frigate', cn: '巡航舰', range: 80, cruise: 800000, speed: 2200, hull: 7, coins: 150000, ore: 200, essence: 30000, color: 0xffe066 },
  { name: 'Cruiser', cn: '战列舰', range: 170, cruise: 2000000, speed: 3500, hull: 18, coins: 2000000, ore: 600, essence: 400000, color: 0xff3c7d },
  { name: 'Star Ark', cn: '星槎', range: 450, cruise: 5000000, speed: 6000, hull: 50, coins: 25000000, ore: 2000, essence: 5000000, color: 0xfff0b8 },
];

const SYL_A = ['Ka', 'Vel', 'Or', 'Zeph', 'Tal', 'Mir', 'Sar', 'Quo', 'Ny', 'Ar', 'Lux', 'Dra', 'Ser', 'Xi', 'Hel', 'Cor', 'Ves', 'Ul', 'Rhe', 'Tau', 'Ae', 'Bel', 'Cyr', 'Eld', 'Fen', 'Gal', 'Ith', 'Jor'];
const SYL_B = ['ion', 'ara', 'eth', 'ux', 'an', 'oria', 'is', 'enth', 'os', 'yra', 'ova', 'ael', 'un', 'ix', 'ari', 'eon', 'iel', 'oth', 'ade'];
export const makeName = (rand) => pick(rand, SYL_A) + pick(rand, SYL_B);
export const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

export const TIPS = [
  'Three paths: Mind Control steers a host of flying swords, Blade fights up close with a saber, Mental Attack strikes the mind directly.',
  'You earn a skill point every stage and two every breakthrough. Spend them in your skill tree.',
  'Terra has six walled base cities and several outposts. Walk into any building with a glowing door.',
  'Rent a Cultivation Chamber in any city: cultivating inside is two and a half times faster.',
  'The capital has an Arena. Each wave you clear pays more than the last.',
  'Buy a round at a teahouse and the hunters will tell you where treasure lies.',
  'Every world has its own beasts. Terra’s wolves and rhinos are nothing like the crawlers of a lava world.',
  'At the Stellar realm you learn Star Step, an instant blink. At higher realms weak beasts flee, then simply die in your presence.',
  'Ancient obelisks hold a trial. Beat the guardians to earn a bonus skill point.',
  'Orbital stations can be landed on. Fly or pilot your ship onto the deck to trade at the booths.',
  'Every star in the sky is a real system. Build a starship, aim at a star and warp there.',
  'At Peak stage, face the Heavenly Tribulation to break through. Keep moving.',
  'Change every key, your view and your graphics detail in Settings.',
];
