// Martial disciplines, their techniques and skill trees, plus the abilities
// every realm unlocks regardless of discipline.
//
// Everyone starts with bare fists. Each other discipline comes with a weapon
// bought at an Armory; owning it opens its skill tree, where its techniques
// are learned with skill points. One cultivator can master several.

export const PATHS = {
  fist: {
    name: 'Fist Arts', cn: '拳法', color: 0xff8a4a,
    title: 'Fist Saint', titleCn: '拳圣',
    desc: 'Your own two hands. Fast combos up close, ground-shaking slams and a body like iron. Everyone starts here.',
    style: 'Melee · combos · tough',
    weapon: { name: 'Bare Fists', cn: '赤手', price: 0, desc: 'You were born with them.' },
    primary: 'punch', secondary: 'guard',
    skills: ['rush', 'quake', 'iron', 'meteor'],
  },
  blade: {
    name: 'Saber', cn: '刀法', color: 0xffb347,
    title: 'Blade Saint', titleCn: '刀者',
    desc: 'Close the distance and cut. Wide sweeping strikes, waves of blade light and a guard that turns shots aside.',
    style: 'Melee · cleave · burst',
    weapon: { name: 'Alloy Saber', cn: '合金战刀', price: 300, desc: 'A heavy single-edged war saber, standard issue for beast hunters.' },
    primary: 'saber', secondary: 'guard',
    skills: ['dash', 'crescent', 'will', 'heaven'],
  },
  spear: {
    name: 'Spear', cn: '枪法', color: 0x6ad8ff,
    title: 'Spear King', titleCn: '枪王',
    desc: 'Reach is everything. Piercing thrusts that skewer whole lines of beasts, spinning sweeps and a javelin throw.',
    style: 'Reach · pierce · sweeps',
    weapon: { name: 'War Spear', cn: '战枪', price: 450, desc: 'Two and a half metres of beast-bone shaft and alloy head.' },
    primary: 'thrust', secondary: 'guard',
    skills: ['lunge', 'whirl', 'javelin', 'dragon'],
  },
  knives: {
    name: 'Throwing Knives', cn: '飞刀', color: 0xc8d4e0,
    title: 'Shadow Hand', titleCn: '暗器宗师',
    desc: 'A belt of balanced knives. Rapid throws, poisoned edges, and stepping through shadows to strike from behind.',
    style: 'Fast ranged · crits · poison',
    weapon: { name: 'Throwing Knife Belt', cn: '飞刀囊', price: 350, desc: 'Twenty-four balanced knives that you somehow never run out of.' },
    primary: 'knife', secondary: 'aim',
    skills: ['fan', 'venom', 'shadow', 'rain'],
  },
  bow: {
    name: 'Archery', cn: '弓术', color: 0x9aff6a,
    title: 'Star Archer', titleCn: '星弓',
    desc: 'Patience and range. Heavy arrows from far away, explosive heads, snares, and volleys that blot out the sky.',
    style: 'Long range · heavy hits',
    weapon: { name: 'Energy Recurve Bow', cn: '能量反曲弓', price: 600, desc: 'Draws a bowstring of light. The arrows are condensed energy.' },
    primary: 'arrow', secondary: 'aim',
    skills: ['multishot', 'snare', 'blast', 'starfall'],
  },
  mind: {
    name: 'Flying Swords', cn: '御剑', color: 0x3ef2ff,
    title: 'Mind Master', titleCn: '念师',
    desc: 'Command a host of flying swords with pure thought, and fire starlight from your palms. Wide reach and many blades.',
    style: 'Ranged · control · many swords',
    weapon: { name: 'Spirit Sword Set', cn: '飞剑', price: 1200, desc: 'Three resonant blades that answer a trained mind. More join you as your realm grows.' },
    primary: 'bolt', secondary: 'steer',
    skills: ['volley', 'prison', 'barrier', 'storm'],
  },
  psychic: {
    name: 'Mental Attack', cn: '精神攻击', color: 0xc070ff,
    title: 'Soul Striker', titleCn: '精神念师',
    desc: 'Strike the mind directly. Attacks land instantly, ignore distance, and can seize, stun or terrify whole packs.',
    style: 'Instant hits · crowd control',
    weapon: { name: 'Psionic Focus', cn: '精神水晶', price: 900, desc: 'A crystal circlet that sharpens thought into a weapon.' },
    primary: 'spike', secondary: 'grip',
    skills: ['lance', 'shock', 'terror', 'annihilate'],
  },
};
export const PATH_IDS = Object.keys(PATHS);

// res: which pool pays the cost. unlockRealm: the realm a technique can first be learned at.
export const TECHS = {
  // ---- fist
  punch: { name: 'Strike', cn: '拳击', cost: 0, cd: 0.3, res: 'energy', unlockRealm: 0, desc: 'A fast punch. Every fourth hit in a row lands a shock that knocks beasts back.' },
  guard: { name: 'Guard', cn: '格挡', cost: 0, cd: 0, res: 'energy', unlockRealm: 0, desc: 'Hold to block 75% of damage from the front. Raise it just before a hit to parry and stagger the attacker.' },
  rush: { name: 'Rushing Fist', cn: '冲拳', cost: 16, cd: 4, res: 'energy', unlockRealm: 0, desc: 'Charge forward and punch through everything in your path.' },
  quake: { name: 'Earthshaker', cn: '震地', cost: 30, cd: 8, res: 'energy', unlockRealm: 1, desc: 'Slam the ground. Beasts around you are thrown into the air and the ground cracks.' },
  iron: { name: 'Iron Body', cn: '铁布衫', cost: 25, cd: 18, duration: 8, res: 'energy', unlockRealm: 2, desc: 'For 8 seconds take 50% less damage and shrug off knockback.' },
  meteor: { name: 'Meteor Fist', cn: '流星拳', cost: 90, cd: 30, res: 'energy', unlockRealm: 4, desc: 'A fist of light falls from the sky where you aim and leaves a crater.' },
  // ---- saber
  saber: { name: 'Saber Strike', cn: '刀击', cost: 0, cd: 0.42, res: 'energy', unlockRealm: 0, desc: 'Cut everything in front of you. Every third strike throws a wave of blade light.' },
  dash: { name: 'Flash Cut', cn: '瞬斩', cost: 18, cd: 4, res: 'energy', unlockRealm: 0, desc: 'Dash forward in a blink, cutting through everything in your path.' },
  crescent: { name: 'Crescent Wave', cn: '月牙刀芒', cost: 30, cd: 6, res: 'energy', unlockRealm: 1, desc: 'A giant arc of blade light that tears through every beast in a line.' },
  will: { name: 'Battle Will', cn: '战意', cost: 25, cd: 18, duration: 8, res: 'energy', unlockRealm: 2, desc: 'For 8 seconds: +50% damage, and every hit heals you.' },
  heaven: { name: 'Heaven-Splitting Blade', cn: '开天一刀', cost: 90, cd: 28, res: 'energy', unlockRealm: 4, desc: 'One cut that splits the land for hundreds of metres.' },
  // ---- spear
  thrust: { name: 'Thrust', cn: '刺', cost: 0, cd: 0.5, res: 'energy', unlockRealm: 0, desc: 'A long thrust that skewers every beast in a line in front of you.' },
  lunge: { name: 'Dragon Lunge', cn: '龙突', cost: 18, cd: 4.5, res: 'energy', unlockRealm: 0, desc: 'Charge spear-first over a long distance, piercing everything in the way.' },
  whirl: { name: 'Whirlwind Sweep', cn: '横扫千军', cost: 28, cd: 7, res: 'energy', unlockRealm: 1, desc: 'Spin your spear in a wide circle, hurling back every beast around you.' },
  javelin: { name: 'Javelin', cn: '投枪', cost: 30, cd: 6, res: 'energy', unlockRealm: 2, desc: 'Hurl a spear of light that pierces everything along a long line.' },
  dragon: { name: 'Sky-Piercing Dragon', cn: '破天龙枪', cost: 90, cd: 30, res: 'energy', unlockRealm: 4, desc: 'A dragon of light bursts from your spear and tears through everything ahead.' },
  // ---- knives
  knife: { name: 'Throw', cn: '飞刀', cost: 2, cd: 0.16, res: 'energy', unlockRealm: 0, desc: 'Throw a knife. Fast, cheap and accurate.' },
  aim: { name: 'Aim', cn: '瞄准', cost: 0, cd: 0, res: 'energy', unlockRealm: 0, desc: 'Hold to zoom in and steady your hand. Ranged hits while aiming crit 25% more often and hit 40% harder.' },
  fan: { name: 'Fan of Knives', cn: '天女散花', cost: 15, cd: 3, res: 'energy', unlockRealm: 0, desc: 'Throw seven knives in a spread.' },
  venom: { name: 'Venom Edge', cn: '淬毒', cost: 20, cd: 14, duration: 10, res: 'energy', unlockRealm: 1, desc: 'For 10 seconds your knives poison what they hit, dealing damage over time.' },
  shadow: { name: 'Shadow Step', cn: '影步', cost: 25, cd: 8, res: 'energy', unlockRealm: 2, desc: 'Step through the shadows to appear behind your target. Your next hit is a guaranteed triple-damage critical.' },
  rain: { name: 'Thousand Knife Rain', cn: '万刃雨', cost: 90, cd: 30, res: 'energy', unlockRealm: 4, desc: 'A storm of knives falls on the area you aim at.' },
  // ---- bow
  arrow: { name: 'Arrow', cn: '射箭', cost: 4, cd: 0.55, res: 'energy', unlockRealm: 0, desc: 'Loose a heavy arrow of light that flies far and pierces.' },
  multishot: { name: 'Split Shot', cn: '连珠箭', cost: 18, cd: 3.5, res: 'energy', unlockRealm: 0, desc: 'Fire five arrows in a fan.' },
  snare: { name: 'Snare Arrow', cn: '缚灵箭', cost: 25, cd: 10, res: 'energy', unlockRealm: 1, desc: 'An arrow that bursts into binding light, holding every beast nearby in place for 3 seconds.' },
  blast: { name: 'Blast Arrow', cn: '爆裂箭', cost: 30, cd: 7, res: 'energy', unlockRealm: 2, desc: 'An arrow that explodes on impact and blasts a crater.' },
  starfall: { name: 'Starfall Volley', cn: '流星箭雨', cost: 90, cd: 30, res: 'energy', unlockRealm: 4, desc: 'Arrows of light rain down over a huge area.' },
  // ---- flying swords
  bolt: { name: 'Star Bolt', cn: '星芒', cost: 3, cd: 0.15, res: 'energy', unlockRealm: 0, desc: 'Fire condensed starlight from your palms.' },
  steer: { name: 'Steer Swords', cn: '御剑', cost: 0, cd: 0, res: 'spirit', unlockRealm: 0, desc: 'Hold to steer every flying sword with your mind. The wheel sets their reach.' },
  volley: { name: 'Sword Volley', cn: '飞剑齐发', cost: 25, cd: 2.4, res: 'spirit', unlockRealm: 0, desc: 'Loose your swords at the targets in front of you.' },
  prison: { name: 'Thought Prison', cn: '念力囚笼', cost: 40, cd: 9, res: 'spirit', unlockRealm: 1, desc: 'Seize every beast near your aim point in a vice of thought. They hang helpless and are slowly crushed.' },
  barrier: { name: 'Mind Barrier', cn: '精神屏障', cost: 35, cd: 16, duration: 6, res: 'energy', unlockRealm: 2, desc: 'A shell of will absorbs 70% of damage and turns aside enemy shots.' },
  storm: { name: 'Ten Thousand Swords', cn: '万剑归宗', cost: 90, cd: 30, res: 'energy', unlockRealm: 4, desc: 'Call a storm of phantom swords down upon every beast around you.' },
  // ---- mental attack
  spike: { name: 'Mind Spike', cn: '精神刺', cost: 4, cd: 0.28, res: 'spirit', unlockRealm: 0, desc: 'An instant psychic strike on whatever you aim at. It cannot miss.' },
  grip: { name: 'Mind Grip', cn: '精神控制', cost: 0, cd: 0, res: 'spirit', unlockRealm: 0, desc: 'Hold to lift your target and crush it. Release to hurl it.' },
  lance: { name: 'Soul Lance', cn: '灵魂之枪', cost: 22, cd: 3.5, res: 'spirit', unlockRealm: 0, desc: 'A spear of thought that pierces every beast along a line.' },
  shock: { name: 'Psychic Shockwave', cn: '精神冲击', cost: 40, cd: 9, res: 'spirit', unlockRealm: 1, desc: 'A blast of will that damages and stuns every beast around you.' },
  terror: { name: 'Terror', cn: '精神震慑', cost: 35, cd: 16, duration: 8, res: 'spirit', unlockRealm: 2, desc: 'Beasts nearby flee in terror and take 40% more damage for 8 seconds.' },
  annihilate: { name: 'Soul Annihilation', cn: '灭魂', cost: 90, cd: 30, res: 'spirit', unlockRealm: 4, desc: 'Every hostile mind within sight is torn apart. Wounded beasts die outright.' },
};

// Which discipline a technique belongs to (shared ones like Guard map to the first owner).
export const TECH_PATH = {};
for (const [id, p] of Object.entries(PATHS)) for (const t of [p.primary, p.secondary, ...p.skills]) if (!TECH_PATH[t]) TECH_PATH[t] = id;

// Abilities every cultivator gains on reaching a realm. These are what make
// realms feel different beyond bigger numbers.
export const REALM_PERKS = [
  { realm: 0, name: 'Tempered Body', desc: 'You can run, leap and fight. Your body is bound to your homeworld.' },
  { realm: 1, name: 'Flight', desc: 'Double-tap jump to fly anywhere within an atmosphere. Leaps carry you over rooftops.' },
  { realm: 2, name: 'Void Body', desc: 'You survive the vacuum of space. Leave the atmosphere and fly between worlds.' },
  { realm: 3, name: 'Star Step', desc: 'Your dodge becomes Star Step: blink a long distance forward in an instant.' },
  { realm: 4, name: 'Aura of Dread', desc: 'Beasts two or more grades below you flee rather than fight.' },
  { realm: 5, name: 'Domain', desc: 'Your domain slows beasts within 70 m and makes them take 20% more damage.' },
  { realm: 6, name: 'Pressure', desc: 'Beasts three or more grades below you are crushed by your presence alone.' },
  { realm: 7, name: 'Undying', desc: 'Once every 5 minutes a fatal blow leaves you at 30% life instead.' },
  { realm: 8, name: 'Light Speed', desc: 'Your cruise speed through space is ten times faster.' },
  { realm: 9, name: 'Master of the Cosmos', desc: 'All techniques cost half as much.' },
];
export const hasPerk = (realm, r) => realm >= r;

// ---------------------------------------------------------------------------
// Skill trees. Points: one per stage advance, five per breakthrough.
// mods are summed per rank. req: [nodeId, rank] prerequisites.
// Technique nodes (tech) teach the discipline's four techniques.
// ---------------------------------------------------------------------------
const node = (id, name, cn, branch, max, cost, mods, desc, req = null, realm = 0) => ({ id, name, cn, branch, max, cost, mods, desc, req, realm });

// The four technique nodes of a discipline, each needing the one before.
function techNodes(pathId) {
  const costs = [1, 1, 2, 3];
  return PATHS[pathId].skills.map((t, i) => ({
    ...node(`tech_${t}`, TECHS[t].name, TECHS[t].cn, 'Techniques', 1, costs[i], {}, TECHS[t].desc, i ? [`tech_${PATHS[pathId].skills[i - 1]}`, 1] : null, TECHS[t].unlockRealm),
    tech: t,
  }));
}

export const TREES = {
  general: [
    node('g_vital', 'Vitality', '气血', 'Body', 3, 1, { hp: 0.1 }, '+10% life per rank.'),
    node('g_sea', 'Spirit Sea', '精神海', 'Mind', 3, 1, { spirit: 0.15 }, '+15% spirit sense per rank.'),
    node('g_focus', 'Focused Cultivation', '专注', 'Mind', 3, 1, { cultivate: 0.15 }, '+15% experience from cultivating per rank.'),
    node('g_wealth', 'Treasure Sense', '寻宝', 'Body', 2, 1, { loot: 0.2 }, '+20% coins and essence from beasts per rank.'),
    node('g_swift', 'Swift Body', '身法', 'Body', 2, 1, { speed: 0.1 }, '+10% movement and flight speed per rank.', ['g_vital', 1]),
    node('g_meridian', 'Open Meridians', '经脉', 'Mind', 2, 2, { regen: 0.25 }, '+25% energy and spirit regeneration per rank.', ['g_sea', 1], 1),
  ],
  fist: [
    ...techNodes('fist'),
    node('f_power', 'Heavy Hands', '重拳', 'Power', 3, 1, { dmg: 0.1 }, '+10% damage per rank.'),
    node('f_combo', 'Rapid Fists', '连拳', 'Power', 2, 1, { atkSpeed: 0.12 }, 'Punch and swing 12% faster per rank.'),
    node('f_crit', 'Pressure Points', '点穴', 'Power', 2, 1, { crit: 0.07 }, '+7% critical chance per rank.', ['f_power', 1]),
    node('f_quake', 'Aftershock', '余震', 'Power', 1, 2, { quakePlus: 1 }, 'Earthshaker reaches 50% further and stuns for 2 seconds.', ['f_combo', 1], 1),
    node('f_body', 'Bronze Skin', '铜皮', 'Body', 3, 1, { hp: 0.12 }, '+12% life per rank.'),
    node('f_armor', 'Stone Stance', '马步', 'Body', 2, 1, { armor: 0.08 }, 'Take 8% less damage per rank.', ['f_body', 1]),
    node('f_hunger', 'Blood Fist', '血拳', 'Body', 2, 1, { lifesteal: 0.03 }, 'Heal 3% of damage dealt per rank.', ['f_body', 1]),
    node('f_feet', 'Light Feet', '轻身', 'Body', 2, 1, { speed: 0.1 }, '+10% movement speed per rank.'),
  ],
  blade: [
    ...techNodes('blade'),
    node('b_keen', 'Keen Edge', '锋锐', 'Edge', 3, 1, { dmg: 0.1 }, '+10% damage per rank.'),
    node('b_rend', 'Rending Cuts', '撕裂', 'Edge', 2, 1, { crit: 0.07 }, '+7% critical chance per rank.'),
    node('b_wave', 'Wave Mastery', '刀芒', 'Edge', 1, 2, { waveEvery: 1 }, 'Saber Strike throws a blade wave every second hit.', ['b_keen', 2], 1),
    node('b_crescent', 'Full Moon', '满月', 'Edge', 1, 2, { crescentPlus: 1 }, 'Crescent Wave grows twice as wide and 40% stronger.', ['b_wave', 1], 2),
    node('b_iron', 'Iron Body', '铁骨', 'Body', 3, 1, { hp: 0.12 }, '+12% life per rank.'),
    node('b_parry', 'Perfect Parry', '完美格挡', 'Body', 1, 1, { parry: 1 }, 'A wider parry window. Parried beasts are stunned for 2 seconds.'),
    node('b_hunger', 'Battle Hunger', '嗜战', 'Body', 2, 1, { lifesteal: 0.03 }, 'Heal 3% of damage dealt per rank.', ['b_iron', 1]),
    node('b_wall', 'Unyielding', '不动', 'Body', 2, 2, { armor: 0.1 }, 'Take 10% less damage per rank.', ['b_iron', 2], 2),
    node('b_feet', 'Swift Feet', '疾步', 'Speed', 2, 1, { speed: 0.1 }, '+10% movement speed per rank.'),
    node('b_flow', 'Flowing Combo', '连斩', 'Speed', 2, 1, { atkSpeed: 0.12 }, 'Strikes swing 12% faster per rank.'),
    node('b_phantom', 'Phantom Dash', '幻影', 'Speed', 1, 2, { dashReset: 1 }, 'Flash Cut reaches 50% further and resets when it kills.', ['b_feet', 1], 1),
    node('b_split', 'Sky Splitter', '裂天', 'Speed', 1, 2, { heavenPlus: 1 }, 'Heaven-Splitting Blade recovers 40% faster and cuts twice as far.', ['b_flow', 2], 4),
  ],
  spear: [
    ...techNodes('spear'),
    node('s_keen', 'Spearhead', '枪锋', 'Point', 3, 1, { dmg: 0.1 }, '+10% damage per rank.'),
    node('s_reach', 'Long Reach', '长枪', 'Point', 2, 1, { spearReach: 0.2 }, 'Thrusts reach 20% further per rank.'),
    node('s_crit', 'Piercing Point', '透甲', 'Point', 2, 1, { crit: 0.07 }, '+7% critical chance per rank.', ['s_keen', 1]),
    node('s_jav', 'Returning Javelin', '回枪', 'Point', 1, 2, { javPlus: 1 }, 'Javelin recovers 40% faster and throws two spears.', ['s_keen', 2], 2),
    node('s_body', 'Iron Shaft', '铁杆', 'Stance', 3, 1, { hp: 0.1 }, '+10% life per rank.'),
    node('s_wall', 'Spear Wall', '枪林', 'Stance', 2, 1, { armor: 0.08 }, 'Take 8% less damage per rank.', ['s_body', 1]),
    node('s_sweep', 'Wide Sweep', '扫荡', 'Stance', 1, 2, { whirlPlus: 0.5 }, 'Whirlwind Sweep reaches 50% further and hits harder.', null, 1),
    node('s_charge', 'Charging Dragon', '冲锋', 'Stance', 1, 2, { lungePlus: 1 }, 'Dragon Lunge reaches 50% further and resets when it kills.', ['s_reach', 1], 1),
  ],
  knives: [
    ...techNodes('knives'),
    node('k_sharp', 'Honed Edges', '利刃', 'Edge', 3, 1, { dmg: 0.1 }, '+10% damage per rank.'),
    node('k_quick', 'Quick Hands', '快手', 'Edge', 2, 1, { atkSpeed: 0.12 }, 'Throw 12% faster per rank.'),
    node('k_crit', 'Vital Strike', '要害', 'Edge', 2, 1, { crit: 0.08 }, '+8% critical chance per rank.', ['k_sharp', 1]),
    node('k_fan', 'Wide Fan', '散花', 'Edge', 1, 2, { fanPlus: 4 }, 'Fan of Knives throws four more knives.', ['k_quick', 1], 1),
    node('k_aim', 'Deadeye', '神眼', 'Shadow', 2, 1, { aimCrit: 0.15 }, '+15% critical chance while aiming per rank.'),
    node('k_venom', 'Lingering Venom', '剧毒', 'Shadow', 2, 1, { venomPlus: 0.5 }, 'Poison deals 50% more damage per rank.', null, 1),
    node('k_shadow', 'Shadow Dancer', '影舞', 'Shadow', 1, 2, { shadowPlus: 1 }, 'Shadow Step resets when the backstab kills.', ['k_aim', 1], 2),
    node('k_feet', 'Silent Step', '无声', 'Shadow', 2, 1, { speed: 0.1 }, '+10% movement speed per rank.'),
  ],
  bow: [
    ...techNodes('bow'),
    node('a_draw', 'Strong Draw', '强弓', 'Draw', 3, 1, { dmg: 0.1 }, '+10% damage per rank.'),
    node('a_quick', 'Quick Nock', '快箭', 'Draw', 2, 1, { atkSpeed: 0.12 }, 'Loose arrows 12% faster per rank.'),
    node('a_pierce', 'Piercing Arrows', '穿云', 'Draw', 2, 1, { arrowPierce: 1 }, 'Arrows pass through one more beast per rank.', ['a_draw', 1]),
    node('a_blast', 'Big Bang', '爆炎', 'Draw', 1, 2, { blastPlus: 0.5 }, 'Blast Arrow explodes 50% wider and harder.', ['a_draw', 2], 2),
    node('a_eye', 'Eagle Eye', '鹰眼', 'Hunt', 2, 1, { crit: 0.07 }, '+7% critical chance per rank.'),
    node('a_aim', 'Steady Aim', '凝神', 'Hunt', 2, 1, { aimCrit: 0.15 }, '+15% critical chance while aiming per rank.', ['a_eye', 1]),
    node('a_multi', 'Split Volley', '分矢', 'Hunt', 1, 2, { multiPlus: 2 }, 'Split Shot fires two more arrows.', null, 1),
    node('a_feet', 'Ranger', '游侠', 'Hunt', 2, 1, { speed: 0.1 }, '+10% movement speed per rank.'),
  ],
  mind: [
    ...techNodes('mind'),
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
  psychic: [
    ...techNodes('psychic'),
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
for (const [k, list] of Object.entries(TREES)) for (const n of list) n.disc = k === 'general' ? null : k;
export const ALL_NODES = Object.values(TREES).flat();

export const owns = (state, pathId) => pathId === 'fist' || (state.weapons || []).includes(pathId);
export const ownedPaths = (state) => PATH_IDS.filter((id) => owns(state, id));
export const activePath = (state) => (owns(state, state.weapon) ? state.weapon : 'fist');

// A technique is usable if its weapon is owned and (for the four techniques) it was learned.
export function knows(state, techId) {
  const p = Object.values(PATHS).find((x) => x.skills.includes(techId));
  if (!p) return true;
  return (state.skills?.[`tech_${techId}`] || 0) > 0;
}

// Nodes shown for one tree (general, or one discipline).
export function treeFor(key) {
  return TREES[key] || [];
}

export function nodeById(id) {
  return ALL_NODES.find((n) => n.id === id);
}

// Summed modifiers from a state's skill ranks.
export function skillMods(state) {
  const mods = {};
  const ranks = state.skills || {};
  for (const n of ALL_NODES) {
    const r = ranks[n.id] || 0;
    if (!r) continue;
    for (const [k, v] of Object.entries(n.mods)) mods[k] = (mods[k] || 0) + v * r;
  }
  return mods;
}

export const pointsEarned = (state) => 2 + state.realm * 5 + state.stage + (state.bonusPoints || 0);
export function pointsSpent(state) {
  let n = 0;
  for (const nd of ALL_NODES) n += (state.skills?.[nd.id] || 0) * nd.cost;
  return n;
}
export const pointsFree = (state) => pointsEarned(state) - pointsSpent(state);

export function canLearn(state, nd) {
  const r = state.skills?.[nd.id] || 0;
  if (r >= nd.max) return { ok: false, why: 'Mastered' };
  if (nd.disc && !owns(state, nd.disc)) return { ok: false, why: 'Buy the weapon' };
  if (state.realm < nd.realm) return { ok: false, why: `Needs realm ${nd.realm + 1}` };
  if (nd.req && (state.skills?.[nd.req[0]] || 0) < nd.req[1]) return { ok: false, why: 'Locked' };
  if (pointsFree(state) < nd.cost) return { ok: false, why: 'No points' };
  return { ok: true };
}
