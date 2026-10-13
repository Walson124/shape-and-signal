// Cultivation paths (classes), their techniques and skill trees, plus the
// abilities every realm unlocks regardless of path.

export const PATHS = {
  mind: {
    name: 'Mind Control', cn: '精神掌控', color: 0x3ef2ff,
    title: 'Mind Master', titleCn: '念师',
    desc: 'Command a host of flying swords with pure thought. The widest reach and the most blades of any path.',
    style: 'Ranged · control · many swords',
    swordMult: 1.5, hpMult: 0.9, spiritMult: 1.35, energyMult: 1,
    primary: 'bolt', secondary: 'steer',
    skills: ['volley', 'prison', 'barrier', 'storm'],
  },
  blade: {
    name: 'Blade', cn: '刀者', color: 0xffb347,
    title: 'Blade Saint', titleCn: '刀者',
    desc: 'Close the distance and cut. A heavy saber, a guard that turns shots aside, and the toughest body of any path.',
    style: 'Melee · tank · burst',
    swordMult: 0.5, hpMult: 1.45, spiritMult: 0.8, energyMult: 1.2,
    primary: 'saber', secondary: 'guard',
    skills: ['dash', 'crescent', 'will', 'heaven'],
  },
  psychic: {
    name: 'Mental Attack', cn: '精神攻击', color: 0xc070ff,
    title: 'Soul Striker', titleCn: '精神念师',
    desc: 'Strike the mind directly. Attacks land instantly, ignore distance, and can seize, stun or terrify whole packs.',
    style: 'Instant hits · crowd control',
    swordMult: 0.5, hpMult: 0.85, spiritMult: 1.6, energyMult: 1,
    primary: 'spike', secondary: 'grip',
    skills: ['lance', 'shock', 'terror', 'annihilate'],
  },
};
export const PATH_IDS = Object.keys(PATHS);

// res: which pool pays the cost. unlockRealm gates the technique.
export const TECHS = {
  // ---- shared
  bolt: { name: 'Star Bolt', cn: '星芒', cost: 3, cd: 0.15, res: 'energy', unlockRealm: 0, desc: 'Fire condensed starlight from your palms.' },
  steer: { name: 'Steer Swords', cn: '御剑', cost: 0, cd: 0, res: 'spirit', unlockRealm: 0, desc: 'Hold to steer every flying sword with your mind. The wheel sets their reach.' },
  // ---- mind
  volley: { name: 'Sword Volley', cn: '飞剑齐发', cost: 25, cd: 2.4, res: 'spirit', unlockRealm: 0, desc: 'Loose your swords at the targets in front of you.' },
  prison: { name: 'Thought Prison', cn: '念力囚笼', cost: 40, cd: 9, res: 'spirit', unlockRealm: 1, desc: 'Seize every beast near your aim point in a vice of thought. They hang helpless and are slowly crushed.' },
  barrier: { name: 'Mind Barrier', cn: '精神屏障', cost: 35, cd: 16, duration: 6, res: 'energy', unlockRealm: 2, desc: 'A shell of will absorbs 70% of damage and turns aside enemy shots.' },
  storm: { name: 'Ten Thousand Swords', cn: '万剑归宗', cost: 90, cd: 30, res: 'energy', unlockRealm: 4, desc: 'Call a storm of phantom swords down upon every beast around you.' },
  // ---- blade
  saber: { name: 'Saber Strike', cn: '刀击', cost: 0, cd: 0.42, res: 'energy', unlockRealm: 0, desc: 'Cut everything in front of you. Every third strike throws a wave of blade light.' },
  guard: { name: 'Guard', cn: '格挡', cost: 0, cd: 0, res: 'energy', unlockRealm: 0, desc: 'Hold to block 75% of damage from the front. Raise it just before a hit to parry and stagger the attacker.' },
  dash: { name: 'Flash Cut', cn: '瞬斩', cost: 18, cd: 4, res: 'energy', unlockRealm: 0, desc: 'Dash forward in a blink, cutting through everything in your path.' },
  crescent: { name: 'Crescent Wave', cn: '月牙刀芒', cost: 30, cd: 6, res: 'energy', unlockRealm: 1, desc: 'A giant arc of blade light that tears through every beast in a line.' },
  will: { name: 'Battle Will', cn: '战意', cost: 25, cd: 18, duration: 8, res: 'energy', unlockRealm: 2, desc: 'For 8 seconds: +50% damage, and every hit heals you.' },
  heaven: { name: 'Heaven-Splitting Blade', cn: '开天一刀', cost: 90, cd: 28, res: 'energy', unlockRealm: 4, desc: 'One cut that splits the land for hundreds of metres.' },
  // ---- psychic
  spike: { name: 'Mind Spike', cn: '精神刺', cost: 4, cd: 0.28, res: 'spirit', unlockRealm: 0, desc: 'An instant psychic strike on whatever you aim at. It cannot miss.' },
  grip: { name: 'Mind Grip', cn: '精神控制', cost: 0, cd: 0, res: 'spirit', unlockRealm: 0, desc: 'Hold to lift your target and crush it. Release to hurl it.' },
  lance: { name: 'Soul Lance', cn: '灵魂之枪', cost: 22, cd: 3.5, res: 'spirit', unlockRealm: 0, desc: 'A spear of thought that pierces every beast along a line.' },
  shock: { name: 'Psychic Shockwave', cn: '精神冲击', cost: 40, cd: 9, res: 'spirit', unlockRealm: 1, desc: 'A blast of will that damages and stuns every beast around you.' },
  terror: { name: 'Terror', cn: '精神震慑', cost: 35, cd: 16, duration: 8, res: 'spirit', unlockRealm: 2, desc: 'Beasts nearby flee in terror and take 40% more damage for 8 seconds.' },
  annihilate: { name: 'Soul Annihilation', cn: '灭魂', cost: 90, cd: 30, res: 'spirit', unlockRealm: 4, desc: 'Every hostile mind within sight is torn apart. Wounded beasts die outright.' },
};

// Abilities every cultivator gains on reaching a realm. These are what make
// realms feel different beyond bigger numbers.
export const REALM_PERKS = [
  { realm: 0, name: 'Tempered Body', desc: 'You can run, leap and fight. Your body is bound to your homeworld.' },
  { realm: 1, name: 'Flight', desc: 'Double-tap jump to fly anywhere within an atmosphere. Leaps carry you over rooftops.' },
  { realm: 2, name: 'Void Body', desc: 'You survive the vacuum of space. Leave the atmosphere and fly between worlds.' },
  { realm: 3, name: 'Star Step', desc: 'Blink a long distance forward in an instant (Star Step key).' },
  { realm: 4, name: 'Aura of Dread', desc: 'Beasts two or more grades below you flee rather than fight.' },
  { realm: 5, name: 'Domain', desc: 'Your domain slows beasts within 70 m and makes them take 20% more damage.' },
  { realm: 6, name: 'Pressure', desc: 'Beasts three or more grades below you are crushed by your presence alone.' },
  { realm: 7, name: 'Undying', desc: 'Once every 5 minutes a fatal blow leaves you at 30% life instead.' },
  { realm: 8, name: 'Light Speed', desc: 'Your cruise speed through space is ten times faster.' },
  { realm: 9, name: 'Master of the Cosmos', desc: 'All techniques cost half as much.' },
];
export const hasPerk = (realm, r) => realm >= r;

// ---------------------------------------------------------------------------
// Skill trees. One point per stage advance, two per breakthrough.
// mods are summed per rank. req: [nodeId, rank] prerequisites.
// ---------------------------------------------------------------------------
const node = (id, name, cn, branch, max, cost, mods, desc, req = null, realm = 0) => ({ id, name, cn, branch, max, cost, mods, desc, req, realm });

export const TREES = {
  general: [
    node('g_vital', 'Vitality', '气血', 'Body', 3, 1, { hp: 0.1 }, '+10% life per rank.'),
    node('g_sea', 'Spirit Sea', '精神海', 'Mind', 3, 1, { spirit: 0.15 }, '+15% spirit sense per rank.'),
    node('g_focus', 'Focused Cultivation', '专注', 'Mind', 3, 1, { cultivate: 0.15 }, '+15% experience from cultivating per rank.'),
    node('g_wealth', 'Treasure Sense', '寻宝', 'Body', 2, 1, { loot: 0.2 }, '+20% coins and essence from beasts per rank.'),
    node('g_swift', 'Swift Body', '身法', 'Body', 2, 1, { speed: 0.1 }, '+10% movement and flight speed per rank.', ['g_vital', 1]),
    node('g_meridian', 'Open Meridians', '经脉', 'Mind', 2, 2, { regen: 0.25 }, '+25% energy and spirit regeneration per rank.', ['g_sea', 1], 1),
  ],
  mind: [
    node('m_host', 'Sword Host', '剑群', 'Swords', 3, 1, { swords: 1 }, '+1 flying sword per rank.'),
    node('m_edge', 'Thought Edge', '念锋', 'Swords', 3, 1, { swordDmg: 0.15 }, '+15% sword damage per rank.'),
    node('m_reach', 'Far Reach', '远御', 'Swords', 2, 1, { reach: 0.25 }, '+25% sword control range per rank.', ['m_host', 1]),
    node('m_whirl', 'Whirling Blades', '剑旋', 'Swords', 1, 2, { swordSpeed: 0.3 }, 'Swords fly 30% faster.', ['m_edge', 2], 2),
    node('m_bolt', 'Piercing Star', '穿星', 'Will', 2, 1, { boltPierce: 1 }, 'Star Bolts pass through one more beast per rank.'),
    node('m_cage', 'Iron Cage', '铁笼', 'Will', 2, 1, { prison: 0.4 }, 'Thought Prison holds longer, reaches further and crushes harder.', null, 1),
    node('m_ward', 'Unbreakable Will', '不屈', 'Will', 2, 1, { armor: 0.08 }, 'Take 8% less damage per rank.'),
    node('m_reflect', 'Mirror Mind', '镜心', 'Will', 1, 2, { reflect: 1 }, 'Mind Barrier hurls blocked shots back at their owners.', ['m_ward', 1], 2),
    node('m_calm', 'Still Water', '止水', 'Insight', 3, 1, { cdr: 0.06 }, 'Techniques recover 6% faster per rank.'),
    node('m_storm', 'Endless Storm', '剑雨', 'Insight', 1, 2, { stormPlus: 1 }, 'Ten Thousand Swords falls twice.', ['m_calm', 2], 4),
    node('m_crit', 'Clear Sight', '明察', 'Insight', 2, 1, { crit: 0.06 }, '+6% critical chance per rank.'),
  ],
  blade: [
    node('b_keen', 'Keen Edge', '锋锐', 'Edge', 3, 1, { dmg: 0.1 }, '+10% damage per rank.'),
    node('b_rend', 'Rending Cuts', '撕裂', 'Edge', 2, 1, { crit: 0.07 }, '+7% critical chance per rank.'),
    node('b_wave', 'Wave Mastery', '刀芒', 'Edge', 1, 2, { waveEvery: 1 }, 'Saber Strike throws a blade wave every second hit.', ['b_keen', 2], 1),
    node('b_crescent', 'Full Moon', '满月', 'Edge', 1, 2, { crescentPlus: 1 }, 'Crescent Wave grows twice as wide and 40% stronger.', ['b_wave', 1], 2),
    node('b_iron', 'Iron Body', '铁骨', 'Body', 3, 1, { hp: 0.12 }, '+12% life per rank.'),
    node('b_parry', 'Perfect Parry', '完美格挡', 'Body', 1, 1, { parry: 1 }, 'A wider parry window. Parried beasts are stunned for 2 seconds.'),
    node('b_hunger', 'Battle Hunger', '嗜战', 'Body', 2, 1, { lifesteal: 0.03 }, 'Heal 3% of damage dealt per rank.', ['b_iron', 1]),
    node('b_wall', 'Unyielding', '不动', 'Body', 2, 2, { armor: 0.1 }, 'Take 10% less damage per rank.', ['b_iron', 2], 2),
    node('b_feet', 'Swift Feet', '疾步', 'Speed', 2, 1, { speed: 0.1 }, '+10% movement speed per rank.'),
    node('b_flow', 'Flowing Combo', '连斩', 'Speed', 2, 1, { atkSpeed: 0.12 }, 'Saber Strike swings 12% faster per rank.'),
    node('b_phantom', 'Phantom Dash', '幻影', 'Speed', 1, 2, { dashReset: 1 }, 'Flash Cut reaches 50% further and resets when it kills.', ['b_feet', 1], 1),
    node('b_split', 'Sky Splitter', '裂天', 'Speed', 1, 2, { heavenPlus: 1 }, 'Heaven-Splitting Blade recovers 40% faster and cuts twice as far.', ['b_flow', 2], 4),
  ],
  psychic: [
    node('p_sharp', 'Sharpened Thought', '锐念', 'Assault', 3, 1, { dmg: 0.1 }, '+10% damage per rank.'),
    node('p_chain', 'Chain Spike', '连锁', 'Assault', 2, 1, { spikeChain: 1 }, 'Mind Spike jumps to one more nearby beast per rank.'),
    node('p_lance', 'Twin Lance', '双枪', 'Assault', 1, 2, { lancePlus: 1 }, 'Soul Lance fires a second spear.', ['p_sharp', 2], 1),
    node('p_execute', 'Mind Breaker', '碎念', 'Assault', 1, 2, { execute: 0.1 }, 'Soul Annihilation kills beasts below 35% life instead of 25%.', ['p_lance', 1], 4),
    node('p_grip', 'Crushing Grip', '碎握', 'Control', 2, 1, { gripDmg: 0.5 }, 'Mind Grip crushes 50% harder per rank.'),
    node('p_throw', 'Hurl', '抛掷', 'Control', 1, 1, { gripThrow: 1 }, 'Hurled beasts explode on impact, hurting their pack.', ['p_grip', 1]),
    node('p_shock', 'Resonance', '共振', 'Control', 2, 1, { shockPlus: 0.4 }, 'Psychic Shockwave reaches further and stuns longer.', null, 1),
    node('p_dread', 'Dread Lord', '恐惧', 'Control', 1, 2, { terrorPlus: 1 }, 'Terror also stuns beasts for 2 seconds.', ['p_shock', 1], 2),
    node('p_sea', 'Boundless Mind', '无垠', 'Soul', 3, 1, { spirit: 0.2 }, '+20% spirit sense per rank.'),
    node('p_flow', 'Thought Flow', '念流', 'Soul', 2, 1, { regen: 0.2 }, '+20% spirit regeneration per rank.', ['p_sea', 1]),
    node('p_ward', 'Mental Ward', '心障', 'Soul', 2, 1, { armor: 0.07 }, 'Take 7% less damage per rank.'),
    node('p_crit', 'Weak Point', '破绽', 'Soul', 2, 1, { crit: 0.08 }, '+8% critical chance per rank.', ['p_ward', 1]),
  ],
};

export function treeFor(path) {
  return [...TREES.general, ...(TREES[path] || [])];
}

export function nodeById(path, id) {
  return treeFor(path).find((n) => n.id === id);
}

// Summed modifiers from a state's skill ranks.
export function skillMods(state) {
  const mods = {};
  const ranks = state.skills || {};
  for (const n of treeFor(state.path)) {
    const r = ranks[n.id] || 0;
    if (!r) continue;
    for (const [k, v] of Object.entries(n.mods)) mods[k] = (mods[k] || 0) + v * r;
  }
  return mods;
}

export const pointsEarned = (state) => 1 + state.realm * 5 + state.stage + (state.bonusPoints || 0);
export function pointsSpent(state) {
  let n = 0;
  for (const nd of treeFor(state.path)) n += (state.skills?.[nd.id] || 0) * nd.cost;
  return n;
}
export const pointsFree = (state) => pointsEarned(state) - pointsSpent(state);

export function canLearn(state, nd) {
  const r = state.skills?.[nd.id] || 0;
  if (r >= nd.max) return { ok: false, why: 'Mastered' };
  if (state.realm < nd.realm) return { ok: false, why: `Needs realm ${nd.realm + 1}` };
  if (nd.req && (state.skills?.[nd.req[0]] || 0) < nd.req[1]) return { ok: false, why: 'Locked' };
  if (pointsFree(state) < nd.cost) return { ok: false, why: 'No points' };
  return { ok: true };
}
