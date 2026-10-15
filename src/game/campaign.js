import * as THREE from 'three';
import { buildNPC } from '../world/interiors.js';
import { signTexture, glowTexture } from '../world/textures.js';
import { speciesForBody } from './bestiary.js';
import { LORE, RUIN_NAMES } from './lore.js';
import { settings } from '../core/settings.js';
import { codeLabel } from '../core/bindings.js';
import { PlanetaryEncounter } from './planetary-encounter.js';
import { PLANETARY_BOSSES } from './planetary-bosses.js';

// Story mode. Act I: an ordinary kid in Base City 07 buys a first weapon, earns
// a living hunting beasts, gets a radar and a Skyjet, then survives a convoy
// ambush in the ruins, finds a ring holding Nix, passes the Warrior's Exam and
// holds the city against a beast tide. Missions are lists of steps; the engine
// tracks objectives, waypoints, dialogue, cutscenes and rewards.

const EYE = 1.7;
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

const TIDE_KING = {
  id: 'tideking', name: 'Ironjaw, the Tide King', cn: '铁颚兽王', arch: 'quad', variant: 'wolf', color: 0x2a2228, accent: 0xff3a2a,
  radius: 10, hp: 22, dmg: 1.8, xp: 14, coins: 12, cores: 14, speed: 48, behavior: 'tank', aggro: 900, walker: true, footing: 0.71,
  fireRate: 2, shotSpeed: 150, minTier: 9, pack: [1, 1], horns: true, spikes: 1,
};

const key = (a) => `<kbd>${codeLabel(settings.key(a))}</kbd>`;
const tip = (c, text, kind = 'yl') => c.g.hud.notify(text, kind);

export const ACT1 = [
  { id: 'ordinary', title: 'An Ordinary Day', cn: '平凡的一天', steps: [
    { type: 'cutscene', text: '', play: (c) => c.introScene() },
    { type: 'reach', text: 'Visit the Armory and choose your first weapon', where: (c) => c.svc('forge'), radius: 6,
      start: (c) => {
        const s = c.g.state;
        s.coins = Math.max(s.coins, 500);
        c.g.cutscene.say([['You', 'Five hundred coins. Two years of saving. Enough for a real weapon.'], ['City Broadcast', 'Planetary watch: a world-eater signature has been detected beneath Terra. Keep evacuation routes clear.'], ['', 'Follow the gold marker to the Armory.']]);
        tip(c, `Follow the <b>gold objective marker</b>. Move with <kbd>W A S D</kbd>, sprint with ${key('sprint')}, jump with ${key('jump')}.`);
      } },
    { type: 'event', on: 'weapon', text: 'Buy a weapon (press E at the counter)', test: (c) => (c.g.state.weapons || []).length > 0,
      start: (c) => {
        c.g.cutscene.say([['Armory Keeper', 'First blade? Saber hits hard up close. Knives and spears if you like distance. Choose well, kid.']]);
        tip(c, `Press ${key('interact')} at the counter to browse. Every weapon is its own fighting style with its own skill tree.`);
      } },
    { type: 'event', on: 'learn', text: 'Open your skill tree and learn your weapon\u2019s first technique', test: (c) => Object.keys(c.g.state.skills || {}).some((k) => k.startsWith('tech_')),
      start: (c) => tip(c, `Press ${key('panelSkills')} to open your skill tree. Techniques marked ◆ cost skill points; you have some to spend.`) },
  ], reward: { coins: 100 } },
  { id: 'bounty', title: 'Beast Bounty', cn: '赏金', steps: [
    { type: 'reach', text: 'Go to the Martial Hall', where: (c) => c.svc('hall'), radius: 6,
      start: (c) => tip(c, 'The <b>Martial Hall</b> pays hunters for beast cores. Its gold marker is on your compass.'),
      done: (c) => {
        c.spawnNPC('kade', c.offset(c.svc('hall'), 4, 2), 0x3a1a1a, 0xff5a3a, 'Kade');
        c.g.cutscene.say([
          ['Instructor Hale', 'Another hopeful. The beasts outside the wall don\u2019t care how much you saved.'],
          ['Instructor Hale', 'Bring me five kills and I\u2019ll pay you like a hunter. Stay close to the walls.'],
          ['Kade', 'Ha. Don\u2019t get eaten, civilian.'],
        ]);
      } },
    { type: 'kill', text: 'Hunt beasts outside the walls', count: 5,
      start: (c) => tip(c, `${key('fire')} attacks. Hold ${key('focus')} to guard or aim. Beasts get stronger the further you go from a city.`) },
    { type: 'reach', text: 'Return to the Martial Hall for your pay', where: (c) => c.svc('hall'), radius: 6,
      done: (c) => { c.removeNPC('kade'); c.g.cutscene.say([['Instructor Hale', 'Not bad. Here\u2019s your pay. Now get yourself some wheels: out there, walking is how hunters die.']]); } },
  ], reward: { coins: 450 } },
  { id: 'wheels', title: 'Wheels', cn: '座驾', steps: [
    { type: 'event', on: 'vehicle', text: 'Buy a Hoverbike at the Vehicle Dealer', where: (c) => c.svc('dealer'), radius: 0,
      test: (c) => (c.g.state.vehicles || []).length > 0,
      start: (c) => tip(c, 'The <b>Vehicle Dealer</b> sells hoverbikes, rovers and racers. Follow the marker.') },
    { type: 'check', text: 'Ride your bike out through the city gate', where: (c) => (c.g.vehicleObj && !c.g.rt.inVehicle ? c.g.vehicleObj.pos.clone() : c.gate().out), radius: 0,
      test: (c) => c.g.rt.inVehicle && c.g.player.pos.distanceTo(c.gate().out) < 70,
      start: (c) => tip(c, `Your bike is parked outside the dealer. Walk up to it and press ${key('interact')} to ride. Steer with the mouse, ${key('sprint')} to boost.`) },
  ], reward: { coins: 400 } },
  { id: 'radar', title: 'Eyes in the Wilds', cn: '雷达', steps: [
    { type: 'event', on: 'radar', text: 'Buy a radar at the Star Exchange', where: (c) => c.svc('exchange'), radius: 0, test: (c) => (c.g.state.radar ?? -1) >= 0,
      start: (c) => c.g.cutscene.say([['Instructor Hale', 'Next, a radar. The wilds hide more than beasts.']]) || tip(c, `The <b>Star Exchange</b> sells radars, pills and technique manuals. Press ${key('interact')} at its counter.`) },
    { type: 'event', on: 'ping', text: 'Scroll to your radar scanner', test: (c) => c.g.rt.scanner,
      start: (c) => tip(c, `Scroll the mouse wheel (or press ${key('weaponNext')}) until you hold the radar. It pulses every few seconds and marks what it finds; ${key('fire')} pulses it by hand.`) },
    { type: 'event', on: 'mine', text: 'Shatter a star metal deposit', where: (c) => c.nearestPoi('ore'), radius: 0, test: (c) => c.g.state.explored.some((id) => /:(ore|vein)\d/.test(id)),
      start: (c) => tip(c, 'Star metal deposits glow blue. Attack one until it shatters, then walk over the pieces to collect them.') },
  ], reward: { coins: 200 } },
  { id: 'wreck', title: 'The Wreck', cn: '残骸', steps: [
    { type: 'reach', text: 'Find the crashed ship your radar picked up', where: (c) => c.nearestPoi('wreck'), radius: 45, test: (c) => c.g.state.explored.some((id) => /:(wreck|hulk)\d/.test(id)),
      start: (c) => c.g.cutscene.say([['', 'Your scanner found a crashed ship. Wrecks hold coins, pills and star metal, if the beasts haven\u2019t moved in.']]) },
    { type: 'event', on: 'search', text: 'Search the wreck (hold E)', where: (c) => c.nearestPoi('wreck'), radius: 0, test: (c) => c.g.state.explored.some((id) => /:(wreck|hulk)\d/.test(id)),
      start: (c) => tip(c, `Hold ${key('interact')} next to the wreck to search it.`) },
  ], reward: { coins: 300, pills: { heal: 1 } } },
  { id: 'wings', title: 'Wings', cn: '飞梭', steps: [
    { type: 'check', text: () => 'Save up for a Skyjet', progress: (c) => { const s = c.g.state; return `${Math.min(s.coins, 800)}/800 ◈ · ${Math.min(s.ore, 12)}/12 ⬢ · ${Math.min(Math.floor(s.essence), 40)}/40 ✦`; },
      test: (c) => { const s = c.g.state; return !!s.ship || (s.coins >= 800 && s.ore >= 12 && s.essence >= 40); },
      start: (c) => {
        c.g.cutscene.say([['You', 'Walking everywhere is slow, and the beasts are fast. A Skyjet would change everything.']]);
        tip(c, 'A <b>Skyjet</b> costs coins, star metal (from deposits and wrecks) and essence (from beasts). Hunt and mine until you have enough.');
      } },
    { type: 'event', on: 'ship', text: 'Buy the Skyjet at the Star Harbor Shipyard', where: (c) => c.svc('shipyard'), radius: 0,
      test: (c) => !!c.g.state.ship },
    { type: 'check', text: 'Board your Skyjet and climb above 150 m', where: (c) => (c.g.shipObj && !c.g.rt.inShip ? c.g.shipObj.pos.clone() : null), radius: 0,
      test: (c) => c.g.rt.inShip && c.g.env.alt > 150,
      start: (c) => tip(c, `Press ${key('interact')} by your Skyjet to board. ${key('jump')} climbs, <kbd>W</kbd> flies forward, ${key('interact')} again to climb out.`) },
  ], reward: { coins: 300 } },
  { id: 'prologue', title: 'The Salvage Run', cn: '打捞', steps: [
    { type: 'reach', text: 'Meet the salvage convoy at the city gate', where: (c) => c.gate().pos, radius: 40,
      start: (c) => c.g.cutscene.say([['Instructor Hale', 'A salvage convoy leaves for Meridian Sprawl today and needs a hunter riding guard. You\u2019re hired. Don\u2019t make me regret it.']]) },
    { type: 'cutscene', text: '', play: (c) => c.convoyScene() },
    { type: 'kill', text: 'Fight for your life: kill the Ironhide Wolves', count: 4, tag: 'prologue',
      spawn: (c) => c.spawnPack('prologue', 'ironwolf', 4 - c.st.p, c.offset(c.g.player.pos, 30, 0), -0.2),
      start: (c) => c.g.cutscene.say([['Driver', 'Rookie... you alive? Use what you\u2019ve got. Fight!']]) },
    { type: 'reach', text: 'Take shelter in the old bunker', where: (c) => c.bunker(0), radius: 7,
      start: (c) => c.g.cutscene.say([['Driver', 'There’s a Concord bunker... past the towers. Get inside. The old ones built them to last...'], ['Driver', 'Tell my wife I— ...'], ['', 'The radio goes silent.']]) },
  ], reward: { coins: 50 } },
  { id: 'ring', title: 'The Ring in the Dark', cn: '黑暗中的戒指', steps: [
    { type: 'cutscene', text: '', play: (c) => c.ringScene() },
    { type: 'reach', text: 'Get back to Base City 07', where: (c) => c.gate().out, radius: 40,
      start: (c) => { c.spawnPack('ring', 'ironwolf', 3, c.between(c.bunker(0), c.gate().out, 0.45), 0); c.nix('Wolves between us and the wall. Of course there are.'); } },
    { type: 'reach', text: 'Report to the Martial Hall', where: (c) => c.svc('hall'), radius: 6,
      done: (c) => {
        c.spawnNPC('kade', c.offset(c.svc('hall'), 5, 2), 0x3a1a1a, 0xff5a3a, 'Kade');
        c.g.cutscene.say([
          ['Instructor Hale', 'You walked out of Meridian Sprawl alive. The convoy crew wasn\u2019t so lucky.'],
          ['Instructor Hale', 'Hm. Where did you get that ring?'],
          ['Nix', '(Don’t tell him about me. Mysterious is a good look on you.)'],
          ['Instructor Hale', 'Keep your secrets. The Warrior’s Exam is soon. Cultivate, hunt, learn your tools. Then come back.'],
          ['Kade', 'Ha. The civilian survived. Try not to faint in front of the examiners.'],
        ]);
      } },
  ], reward: { coins: 150, pills: { heal: 2 } } },
  { id: 'training', title: 'Training Days', cn: '修炼', steps: [
    { type: 'cultivate', text: 'Cultivate to gain experience', count: 60, start: (c) => c.nix('Sit down and cultivate. Press {cultivate}. Energy springs and chambers are faster; your bedroom floor is slower.') },
    { type: 'count', on: 'part', text: 'Hunt beasts and collect their parts with your ring', count: 4, start: (c) => c.nix('My ring folds space. Walk over the hides and fangs beasts drop and they go inside. Yes, with me. I\u2019m thrilled.') },
    { type: 'event', on: 'craft', text: 'Craft something at an Armory', where: (c) => c.svc('forge'), radius: 0,
      start: (c) => c.nix('Armory smiths turn beast parts into gear. Temper your weapon, make a tent, a turret, even a collar to tame a beast.') },
  ], reward: { coins: 200, point: 1 } },
  { id: 'plugged', title: 'Plugged In', cn: '虚拟宇宙', steps: [
    { type: 'event', on: 'vuEnter', text: () => `Log in to the Virtual Universe (${codeLabel(settings.key('virtual'))})`,
      start: (c) => c.nix('Everyone who matters is in the Virtual Universe. Your body stays out here while you browse, so pick a quiet spot first.') },
    { type: 'event', on: 'order', text: 'Order something from the Star Mall', start: (c) => c.nix('The Star Mall delivers anywhere. Even to you.') },
    { type: 'event', on: 'pod', text: 'Log out and open your delivery pod', where: (c) => (c.g.pods && c.g.pods[0] ? c.g.pods[0].pos.clone() : null), radius: 0 },
  ], reward: { coins: 200 } },
  { id: 'exam', title: 'The Warrior’s Exam', cn: '战士考核', steps: [
    { type: 'reach', text: 'Go to the Arena for your exam', where: (c) => c.svc('arena'), radius: 8,
      done: (c) => c.g.cutscene.say([['Instructor Hale', 'One wave. No dying. Speak to the registrar when you’re ready.'], ['Kade', 'Passed mine yesterday. Without breaking a sweat.']]) },
    { type: 'event', text: 'Clear an arena wave', on: 'arenaWave',
      done: (c) => c.g.cutscene.say([['Instructor Hale', 'Pass. Welcome to the ranks, Warrior.'], ['Kade', 'Lucky.'], ['Nix', 'He’s jealous. I’d be jealous too, if I were him. Which, thankfully, I’m not.']]) },
  ], reward: { coins: 300, pills: { heal: 2, energy: 2 } } },
  { id: 'echoes', title: 'Echoes of the Concord', cn: '遗迹回响', steps: [
    { type: 'lore', text: () => `Search the terminal in ${RUIN_NAMES[1]}`, index: 1, where: (c) => c.bunker(1), radius: 6,
      start: (c) => c.nix('That bunker had records. There are more out there. I want to know who Seren was, and why I can’t remember her.') },
    { type: 'kill', text: 'Kade is in trouble: kill the Golden-horn Rhino', count: 1, tag: 'kade', where: (c) => c.ruinCenter(2), radius: 0,
      start: (c) => c.nix('Kade went out to the Concord ruins alone. Showing off, no doubt. I have a bad feeling.'),
      spawn: (c) => {
        const at = c.offset(c.ruinCenter(2), -40, 10);
        c.spawnNPC('kade', at, 0x3a1a1a, 0xff5a3a, 'Kade');
        c.spawnPack('kade', 'goldhorn', 1, c.offset(at, 18, 0), 0.5, true, false);
        c.g.cutscene.say([['Kade', 'Hey! Rookie! I— I’ve got this under control! ...Mostly!']]);
      },
      done: (c) => c.g.cutscene.say([['Kade', 'I had it handled.'], ['Kade', '...Thanks. Don’t tell anyone.'], ['Nix', 'I’m telling everyone.']]) },
    { type: 'lore', text: () => `Search the terminal in ${RUIN_NAMES[2]}`, index: 2, where: (c) => c.bunker(2), radius: 6 },
  ], reward: { coins: 300, point: 1 } },
  { id: 'insight', title: 'The Bottleneck', cn: '瓶颈', steps: [
    { type: 'check', text: 'Reach the Peak of the Warrior realm', test: (c) => c.g.state.realm > 0 || (c.g.state.stage === 3 && c.g.state.xp >= c.g.stats.xpNeed) },
    { type: 'check', text: 'Earn a Realm Insight: win the obelisk trial outside the city', test: (c) => (c.g.state.insight || 0) >= 1 || c.g.state.realm > 0, where: (c) => c.obelisk(), radius: 0,
      start: (c) => c.g.cutscene.say([['Instructor Hale', 'You’ve hit the wall every Warrior hits. Energy alone won’t carry you through.'], ['Instructor Hale', 'There’s an obelisk outside the walls. Beat its guardians and you’ll understand.']]) },
  ], reward: { coins: 200 } },
  { id: 'tide', title: 'The Beast Tide', cn: '兽潮', steps: [
    { type: 'reach', text: 'Return to Base City 07', where: (c) => c.capital().group.position.clone(), radius: 700,
      start: (c) => c.nix('Something\u2019s wrong. The wilds have gone quiet. Let\u2019s head back to the city.') },
    { type: 'cutscene', text: '', play: (c) => c.tideScene() },
    { type: 'reach', text: 'Get to the gate and hold the wall', where: (c) => c.gate().pos, radius: 45, start: (c) => c.buildTurrets() },
    { type: 'waves', text: 'Hold the gate against the tide', waves: [['ironwolf', 7], ['bladehawk', 5, 'ironwolf', 4], ['thunderlizard', 4, 'shadowmantis', 4]] },
    { type: 'boss', text: 'Slay Ironjaw, the Tide King' },
    { type: 'cutscene', text: '', play: (c) => c.victoryScene() },
  ], reward: { coins: 1000, point: 1, insight: 1 } },
  { id: 'worldbreaker', act: 1, title: 'The Black Crown', cn: '玄冕降临', steps: [
    { type: 'check', text: 'Prepare for Vesper: break through to the second realm', test: c => c.g.state.realm >= 1,
      start: c => c.g.cutscene.say([['Nix', 'Ironjaw was fleeing something. The Concord called it Vesper: a juvenile world-eater that feeds through a planet’s core.'], ['Instructor Hale', 'The evacuation fleet cannot carry everyone. Break through, prepare your equipment, and meet it outside the walls.']]) },
    { type: 'reach', text: 'Confront Vesper outside Base City 07 — defeat means Terra is destroyed', where: c => c.planetary.arena('vesper'), radius: 280 },
    { type: 'planetary', boss: 'vesper', text: 'Save Terra: slay Vesper and interrupt its World Rend' },
    { type: 'event', on: 'planetary-briefing', text: 'Read the surviving Concord coordinates', test: () => true,
      start: c => c.g.cutscene.say([['Nix', 'Terra lives. But Vesper was following a signal. Its core holds coordinates for a buried Concord engine on Dune.'], ['Instructor Hale', 'Find whoever woke it. We cannot survive another siege.']]) },
  ], reward: { coins: 1800, point: 2, insight: 1 }, actEnd: 1 },
  { id: 'buried-sun', act: 2, planet: 'p3', title: 'The Buried Sun', cn: '葬日之下', steps: [
    { type: 'check', text: 'Fly to Dune — investigate the signal that called Vesper', test: c => c.g.star.key === 'home' && c.g.frame?.body.id === 'p3',
      start: c => c.nix('Dune is our next destination. The buried engine is still transmitting. Follow the planetary navigation marker, then my ground coordinates. Recommended: realm 2 and upgraded equipment.') },
    { type: 'reach', text: 'Approach the Concord excavation on Dune', where: c => c.planetary.arena('serekh'), radius: 280,
      start: c => c.g.cutscene.say([['Nix', 'The engine has a guardian. Serekh feels movement through the sand. Watch for eruptions; its mouth opens after a lunge.'], ['Nix', 'Defeat here means Dune’s core will ignite. We need the engine intact to trace the source.']]) },
    { type: 'planetary', boss: 'serekh', text: 'Defeat Serekh and sever the buried engine' },
  ], reward: { coins: 3000, point: 2, insight: 1 }, actEnd: 2 },
  { id: 'silent-choir', act: 3, planet: 'p5', title: 'The Silent Choir', cn: '寂霜终曲', steps: [
    { type: 'check', text: 'Fly to Glacis — shut down the Concord relay', test: c => c.g.star.key === 'home' && c.g.frame?.body.id === 'p5',
      start: c => c.g.cutscene.say([['Nix', 'Dune’s records point to Glacis. The Concord built a planetary defense network. Something has turned it into a dinner bell.'], ['Nix', 'Ilyra guards the last relay. Silence its choir before another world-eater answers. Recommended: realm 3.']]) },
    { type: 'reach', text: 'Find the frozen relay on Glacis', where: c => c.planetary.arena('ilyra'), radius: 280 },
    { type: 'planetary', boss: 'ilyra', text: 'Defeat Ilyra and silence the relay before Glacis fractures' },
  ], reward: { coins: 5000, point: 3, insight: 1 }, final: true, actEnd: 3 },
];

// The Aurean Concord at its height, raised for the opening cutscene over a
// ruin field: gleaming towers, skybridges, a spire and flying traffic. Towers
// can topple (for the Night of Teeth).
function buildMemoryCity(at, up, e, n) {
  const group = new THREE.Group();
  const mats = [];
  const geos = [];
  const mat = (m) => { mats.push(m); return m; };
  const geo = (gm) => { geos.push(gm); return gm; };
  const hull = mat(new THREE.MeshStandardMaterial({ color: 0xe6dfd0, metalness: 0.55, roughness: 0.28, emissive: 0x2a1d0a }));
  const glass = mat(new THREE.MeshStandardMaterial({ color: 0x8fb6d8, metalness: 0.9, roughness: 0.1, emissive: 0x0a1a2a }));
  const gold = mat(new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 1.9, 0.9) }));
  const cyan = mat(new THREE.MeshBasicMaterial({ color: new THREE.Color(0.8, 2.2, 2.6) }));
  const basis = new THREE.Matrix4().makeBasis(e, up, n);
  const q = new THREE.Quaternion().setFromRotationMatrix(basis);
  const towers = [];
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const place = (obj, x, y, z) => { obj.position.copy(at(x, y, z)); obj.quaternion.copy(q); group.add(obj); return obj; };
  for (let i = 0; i < 46; i++) {
    const ang = rnd() * Math.PI * 2, r = 40 + Math.sqrt(rnd()) * 420;
    const x = Math.cos(ang) * r, z = Math.sin(ang) * r;
    const h = 70 + rnd() * 190 * (1 - r / 600);
    const w = 14 + rnd() * 16;
    const pivot = place(new THREE.Group(), x, -2, z);
    const round = rnd() < 0.35;
    const body = new THREE.Mesh(geo(round ? new THREE.CylinderGeometry(w * 0.45, w * 0.55, h, 16) : new THREE.BoxGeometry(w, h, w * (0.7 + rnd() * 0.5))), rnd() < 0.3 ? glass : hull);
    body.position.y = h / 2;
    pivot.add(body);
    // glowing window bands and a crown
    const bands = Math.floor(3 + rnd() * 6);
    for (let k = 1; k <= bands; k++) {
      const band = new THREE.Mesh(geo(round ? new THREE.CylinderGeometry(w * 0.47, w * 0.47, 0.8, 16) : new THREE.BoxGeometry(w + 0.6, 0.8, w * 0.9)), rnd() < 0.8 ? gold : cyan);
      band.position.y = (h * k) / (bands + 1);
      pivot.add(band);
    }
    const crown = new THREE.Mesh(geo(new THREE.ConeGeometry(w * 0.3, w * 1.2, 6)), gold);
    crown.position.y = h + w * 0.6;
    pivot.add(crown);
    towers.push({ pivot, h, axis: new THREE.Vector3(Math.cos(rnd() * 6.28), 0, Math.sin(rnd() * 6.28)).normalize(), fall: 9.6 + rnd() * 6.5 - Math.max(0, 300 - r) * 0.004, x, z, boomed: false });
  }
  // the great spire at the centre
  const spire = place(new THREE.Group(), 0, -2, 0);
  const s1 = new THREE.Mesh(geo(new THREE.CylinderGeometry(6, 22, 320, 12)), hull);
  s1.position.y = 160;
  const s2 = new THREE.Mesh(geo(new THREE.CylinderGeometry(1.5, 6, 120, 8)), gold);
  s2.position.y = 380;
  const halo = new THREE.Mesh(geo(new THREE.TorusGeometry(34, 1.2, 6, 40).rotateX(Math.PI / 2)), cyan);
  halo.position.y = 250;
  spire.add(s1, s2, halo);
  towers.push({ pivot: spire, h: 440, axis: new THREE.Vector3(1, 0, 0.3).normalize(), fall: 14.5, x: 0, z: 0, boomed: false });
  // skybridges between neighbours
  for (let i = 0; i < 20; i++) {
    const A = towers[Math.floor(rnd() * 40)], B = towers[Math.floor(rnd() * 40)];
    const d = Math.hypot(A.x - B.x, A.z - B.z);
    if (A === B || d > 140 || d < 30) continue;
    const y = Math.min(A.h, B.h) * (0.4 + rnd() * 0.4);
    const bridge = new THREE.Mesh(geo(new THREE.BoxGeometry(d, 2, 4)), glass);
    const mid = place(new THREE.Group(), (A.x + B.x) / 2, y, (A.z + B.z) / 2);
    bridge.rotation.y = -Math.atan2(B.z - A.z, B.x - A.x);
    mid.add(bridge);
  }
  // flying traffic on looping lanes
  const cars = [];
  for (let i = 0; i < 40; i++) {
    const car = new THREE.Mesh(geo(new THREE.CapsuleGeometry(0.9, 3, 2, 6).rotateZ(Math.PI / 2)), rnd() < 0.5 ? gold : cyan);
    group.add(car);
    cars.push({ car, r: 80 + rnd() * 380, y: 40 + rnd() * 180, w: (rnd() < 0.5 ? -1 : 1) * (0.05 + rnd() * 0.08), p: rnd() * 6.28 });
  }
  const tmp = new THREE.Vector3();
  return {
    group,
    update(t, dt, nightT) {
      for (const c of cars) {
        const ang = c.p + t * c.w;
        tmp.copy(at(Math.cos(ang) * c.r, c.y - (nightT > 0 ? nightT * nightT * 4 : 0), Math.sin(ang) * c.r));
        c.car.position.copy(tmp);
        c.car.quaternion.copy(q);
        c.car.rotateY(-ang + (c.w > 0 ? -Math.PI / 2 : Math.PI / 2));
      }
      if (nightT < 0) return;
      for (const tw of towers) {
        const k = Math.max(0, Math.min(1, (t - tw.fall) / 3.2));
        if (k <= 0) continue;
        if (!tw.boomed) {
          tw.boomed = true;
          tw.boomAt = tw.pivot.position.clone();
          this.onBoom && this.onBoom(tw.boomAt, tw.h);
        }
        tw.pivot.quaternion.copy(q).multiply(new THREE.Quaternion().setFromAxisAngle(tw.axis, k * k * 1.35));
        tw.pivot.position.copy(at(tw.x, -2 - k * tw.h * 0.08, tw.z));
      }
    },
    dispose() {
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
    },
  };
}

export class Campaign {
  constructor(game) {
    this.g = game;
    this.npcs = {};
    this.turrets = [];
    this.trucks = [];
    this.temp = [];
    this.el = document.getElementById('mission');
    this.busy = false;
    this.time = 0;
    this.planetary = new PlanetaryEncounter(this);
  }

  get st() {
    return this.g.state.campaign;
  }

  get mission() {
    return this.st ? ACT1[this.st.mi] : null;
  }

  get step() {
    const m = this.mission;
    return m ? m.steps[this.st.si] : null;
  }

  // ------------------------------------------------------- locations --
  terra() { return this.g.homePlanet(); }
  onTerra() { return this.g.star.key === 'home' && this.g.frame?.body.id === 'p2'; }
  capital() { const t = this.terra(); return t.ensureSettlement(t.body.sites.city); }
  svc(kind) { const s = this.capital().services.find((x) => x.kind === kind); return s ? s.pos.clone() : this.capital().spawnLocal.clone(); }
  ruinCenter(i) {
    const t = this.terra();
    const site = t.body.sites.ruins[i];
    const d = V(site.x, site.y, site.z).normalize();
    return d.multiplyScalar(t.floorRadius(d.x, d.y, d.z) + EYE);
  }
  bunker(i) {
    const r = this.terra().ensureRuin(i);
    const sv = r && r.services.find((x) => x.kind === 'lore');
    return sv ? sv.pos.clone() : this.ruinCenter(i);
  }
  gate() {
    const st = this.capital();
    const ruin = this.ruinCenter(0);
    let best = st.gates[0], bd = Infinity;
    for (const g of st.gates) {
      const d = g.out.distanceTo(ruin);
      if (d < bd) { bd = d; best = g; }
    }
    return best;
  }
  obelisk() {
    const t = this.terra();
    t.buildDetails();
    const c = this.capital().group.position;
    const list = t.details.pois.filter((p) => p.poi.kind === 'obelisk').sort((a, b) => a.pos.distanceTo(c) - b.pos.distanceTo(c));
    return list.length ? list[0].pos.clone() : c.clone();
  }
  // The nearest unexplored point of interest of a kind (to the player if on Terra).
  nearestPoi(kind) {
    const t = this.terra();
    t.buildDetails();
    const s = this.g.state;
    const from = this.onTerra() ? this.g.player.pos : this.capital().group.position;
    let best = null, bd = Infinity;
    for (const p of t.details.pois) {
      if (p.poi.kind !== kind || s.explored.includes(p.poi.id)) continue;
      const d = p.pos.distanceTo(from);
      if (d < bd) { bd = d; best = p; }
    }
    return best ? best.pos.clone().addScaledVector(best.up, 2) : null;
  }

  ground(p, lift = EYE) {
    const t = this.terra();
    const d = p.clone().normalize();
    return d.multiplyScalar(t.floorRadius(d.x, d.y, d.z) + lift);
  }
  between(a, b, k) { return this.ground(a.clone().lerp(b, k)); }
  offset(p, dx, dz) {
    const up = p.clone().normalize();
    const e = V(1, 0, 0).projectOnPlane(up).normalize();
    const n = V().crossVectors(e, up);
    return this.ground(p.clone().addScaledVector(e, dx).addScaledVector(n, dz));
  }

  // --------------------------------------------------------- helpers --
  nix(text) {
    this.g.nix.say(this.g.nix.fill(text), 1, true);
  }

  spawnNPC(key, pos, color, accent, label) {
    this.removeNPC(key);
    const n = buildNPC(color, accent);
    const up = pos.clone().normalize();
    n.group.position.copy(pos).addScaledVector(up, -EYE);
    n.group.quaternion.setFromUnitVectors(V(0, 1, 0), up);
    const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: signTexture(label, '#ffc857'), transparent: true, depthWrite: false, depthTest: false }));
    tag.scale.set(3, 0.48, 1);
    tag.position.y = 2.4;
    n.group.add(tag);
    this.g.localRoot.add(n.group);
    this.npcs[key] = { ...n, tag };
  }

  removeNPC(key) {
    const n = this.npcs[key];
    if (!n) return;
    this.g.localRoot.remove(n.group);
    n.tag.material.map.dispose();
    n.tag.material.dispose();
    n.dispose();
    delete this.npcs[key];
  }

  species(id) {
    if (id === 'tideking') return TIDE_KING;
    return speciesForBody(this.terra().body).find((s) => s.id === id);
  }

  spawnPack(tag, id, n, center, tierBonus = 0, elite = false, aggro = true) {
    const g = this.g;
    const def = this.species(id);
    if (!def) return [];
    g.beasts.species.set(def.id, def);
    const out = [];
    for (let i = 0; i < n; i++) {
      const a = (i / Math.max(1, n)) * Math.PI * 2 + Math.random();
      const pos = this.offset(center, Math.cos(a) * (6 + Math.random() * 10), Math.sin(a) * (6 + Math.random() * 10));
      const p2 = pos.clone().addScaledVector(pos.clone().normalize(), def.radius * def.footing - EYE + 0.5);
      const b = g.beasts.spawn(def.id, p2, Math.max(0, g.state.realm * 0.9 + tierBonus), { aggro, elite });
      b.tag = tag;
      out.push(b);
    }
    return out;
  }

  // -------------------------------------------------------- lifecycle --
  begin() {
    const s = this.g.state;
    s.campaign = { mi: 0, si: 0, p: 0, wave: 0, started: true, done: [] };
    this.startStep();
  }

  startStep() {
    const step = this.step;
    if (!step) return;
    this.st.p = 0;
    this.st.wave = 0;
    this.spawned = false;
    if (step.start) step.start(this);
    if (step.type === 'cutscene') this.pendingCut = true;
    if (step.type === 'waves') this.nextWave();
    if (step.type === 'boss') this.spawnBoss();
    if (step.type === 'planetary') this.planetary.begin(step.boss);
    this.render();
    this.g.save();
  }

  advance() {
    const step = this.step;
    if (step && step.done) step.done(this);
    const m = this.mission;
    this.st.si++;
    if (this.st.si >= m.steps.length) return this.completeMission();
    this.startStep();
  }

  completeMission() {
    const g = this.g, s = g.state, m = this.mission;
    const rw = m.reward || {};
    if (rw.coins) s.coins += Math.round(rw.coins * Math.pow(2.2, s.realm));
    if (rw.point) s.bonusPoints = (s.bonusPoints || 0) + rw.point;
    if (rw.pills) for (const [k, n] of Object.entries(rw.pills)) s.pills[k] += n;
    if (rw.insight) g.gainInsight(m.act ? 'a planetary confrontation' : 'the battle for Base City 07');
    g.addXp(g.stats.xpNeed * 0.15);
    this.st.done.push(m.id);
    g.sound.reward();
    if (m.final) {
      g.hud.banner('CAMPAIGN COMPLETE', 'The signal is silent', 'Terra, Dune and Glacis endure. The wider galaxy remains open.', '#ffe44d', 6);
      this.st.campaignDone = true;
      this.st.mi = ACT1.length;
      this.cleanup();
      this.render();
      g.save();
      return;
    }
    if (m.actEnd) { if (m.actEnd === 1) this.st.act1Done = true; this.st.act = m.actEnd + 1; this.cleanup(); }
    g.hud.banner('MISSION COMPLETE', m.title, `<span class="cn">${m.cn}</span>`, '#ffc857', 3.5);
    this.st.mi++;
    this.st.si = 0;
    this.waiting = true;
    setTimeout(() => {
      this.waiting = false;
      const next = this.mission;
      if (!next) return;
      g.hud.banner('NEW MISSION', next.title, `<span class="cn">${next.cn}</span>`, '#3ef2ff', 3);
      this.startStep();
    }, 4200);
    this.render();
    g.save();
  }

  // Resume after loading a save mid-story.
  resume() {
    const step = this.step;
    if (!step) return this.render();
    if (step.type === 'planetary') {
      if (this.st.siegeFailure) {
        this.planetary.def = PLANETARY_BOSSES[step.boss]; this.planetary.planet = this.planetary.planetFor(step.boss);
        if (this.planetary.planet) { this.planetary.fail(this.st.siegeFailure); return; }
      }
      if (this.st.siegeCheckpoint) {
        this.planetary.def = PLANETARY_BOSSES[step.boss]; this.planetary.planet = this.planetary.planetFor(step.boss);
        if (this.planetary.planet) { this.planetary.retry(); return; }
      }
      this.spawned = false; return this.render();
    }
    if (step.type === 'cutscene') return this.startStep();
    if (step.type === 'waves' || step.type === 'boss') {
      // start the fight over
      this.st.si = this.mission.steps.findIndex((x) => x.type === 'reach' && x.start);
      if (this.st.si < 0) this.st.si = 0;
    }
    this.startStep();
  }

  rebase(m, q) {
    this.planetary.rebase(m, q);
    const objs = [...Object.values(this.npcs).map((n) => n.group), ...this.turrets.map((t) => t.group), ...this.trucks];
    for (const o of objs) {
      o.position.applyMatrix4(m);
      o.quaternion.premultiply(q);
    }
    for (const t of this.turrets) t.up.applyQuaternion(q);
  }

  cleanup() {
    this.planetary.dispose();
    for (const k of Object.keys(this.npcs)) this.removeNPC(k);
    for (const t of this.turrets) this.g.localRoot.remove(t.group);
    this.turrets = [];
    for (const t of this.trucks) this.g.localRoot.remove(t);
    this.trucks = [];
  }

  // ----------------------------------------------------------- events --
  // Returns true if the event was consumed (e.g. an interaction the story owns).
  event(kind, data) {
    if (kind === 'kill' && this.planetary.onKill(data)) return true;
    const step = this.step;
    if (!step || this.busy || this.waiting || this.pendingCut) return false;
    if (kind === 'kill' && step.type === 'kill') {
      if (step.tag && data.tag !== step.tag) return false;
      if (data.static) return false;
      this.st.p++;
      if (this.st.p >= step.count) this.advance();
      else this.render();
    } else if (kind === 'kill' && (step.type === 'waves' || step.type === 'boss')) {
      if (step.type === 'boss' && data.tag === 'tideking') this.advance();
      else if (step.type === 'waves' && data.tag === 'tide') {
        this.st.p++;
        if (!this.g.beasts.beasts.some((b) => b.alive && b.tag === 'tide')) {
          if (this.st.wave >= step.waves.length) this.advance();
          else setTimeout(() => this.nextWave(), 2500);
        }
        this.render();
      }
    } else if (kind === 'cultivate' && step.type === 'cultivate') {
      this.st.p += data;
      if (this.st.p >= step.count) this.advance();
      else this.render();
    } else if (kind === 'lore' && step.type === 'lore' && data === step.index) {
      this.advance();
    } else if (step.type === 'event' && kind === step.on) {
      this.advance();
    } else if (step.type === 'count' && kind === step.on) {
      this.st.p++;
      if (this.st.p >= step.count) this.advance();
      else this.render();
    }
    return false;
  }

  update(dt) {
    this.planetary.update(dt);
    this.time += dt;
    for (const n of Object.values(this.npcs)) n.anim(this.time);
    this.updateTurrets(dt);
    this.updateBoss(dt);
    const step = this.step;
    if (!step || this.busy || this.waiting || this.g.mode !== 'playing') return;
    if (this.mission.planet ? this.g.star.key !== 'home' || this.g.frame?.body.id !== this.mission.planet : !this.onTerra()) return;
    if (step.type === 'planetary' && this.planetary.status === 'idle' && !this.g.rt.inShip && !this.g.rt.inVehicle) this.planetary.begin(step.boss);
    const p = this.g.player.pos;
    if (this.pendingCut) {
      if (this.g.menus.overlayOpen || this.g.rt.inShip || this.g.rt.trib) return;
      this.pendingCut = false;
      this.busy = true;
      Promise.resolve(step.play(this)).then(() => {
        this.busy = false;
        this.advance();
      });
      return;
    }
    if (step.spawn && !this.spawned && !this.g.beasts.beasts.some((b) => b.alive && b.tag === step.tag)) {
      const w = step.where ? step.where(this) : null;
      if (!w || p.distanceTo(w) < 900) {
        this.spawned = true;
        step.spawn(this);
      }
    }
    if (step.type === 'reach' && step.test && step.test(this)) this.advance();
    else if (step.type === 'reach' && step.where && p.distanceTo(step.where(this)) < step.radius) this.advance();
    else if ((step.type === 'check' || step.type === 'event') && step.test && step.test(this)) this.advance();
    else if (step.type === 'lore' && this.g.state.lore.includes(step.index)) this.advance();
    this.renderTimer = (this.renderTimer || 0) - dt;
    if (this.renderTimer <= 0) {
      this.renderTimer = 0.5;
      this.render();
    }
  }

  // Waypoint for the HUD.
  target() {
    const step = this.step;
    if (!step || this.busy) return null;
    if (this.mission.planet ? this.g.star.key !== 'home' || this.g.frame?.body.id !== this.mission.planet : !this.onTerra()) return null;
    if (step.type === 'planetary') return this.planetary.target(step.boss);
    if (step.where) return step.where(this);
    if (step.type === 'kill' && step.tag) {
      const b = this.g.beasts.beasts.find((x) => x.alive && x.tag === step.tag);
      return b ? b.pos.clone() : null;
    }
    if (step.type === 'boss' && this.boss && this.boss.alive) return this.boss.pos.clone();
    if (step.type === 'waves') return this.gate().pos;
    return null;
  }

  render() {
    const el = this.el;
    const m = this.mission;
    if (!this.st || !this.st.started || !m) {
      el.classList.add('hidden');
      return;
    }
    const step = this.step;
    if (!step || step.type === 'cutscene') {
      el.classList.add('hidden');
      return;
    }
    let text = typeof step.text === 'function' ? step.text() : step.text;
    let prog = '';
    if (step.type === 'kill') prog = `${this.st.p}/${step.count}`;
    else if (step.type === 'cultivate') prog = `${Math.floor(this.st.p)}/${step.count}`;
    else if (step.type === 'waves') prog = `WAVE ${Math.min(this.st.wave, step.waves.length)}/${step.waves.length}`;
    else if (step.type === 'count') prog = `${this.st.p}/${step.count}`;
    else if (step.progress) prog = step.progress(this);
    const rightPlanet = m.planet ? this.g.star.key === 'home' && this.g.frame?.body.id === m.planet : this.onTerra();
    if (!rightPlanet) text = m.planet ? `Travel to ${m.planet === 'p3' ? 'Dune' : 'Glacis'} to continue the story` : 'Return to Terra to continue the story';
    const t = this.target();
    const dist = t ? Math.round(t.distanceTo(this.g.player.pos)) : null;
    el.innerHTML = `<div class="mono dim">ACT ${m.act || 1} · ${m.title.toUpperCase()}</div><div class="m-obj">${text}</div><div class="mono m-meta">${prog}${prog && dist !== null ? ' · ' : ''}${dist !== null ? (dist >= 1000 ? `${(dist / 1000).toFixed(1)} KM` : `${dist} M`) : ''}</div>`;
    el.classList.remove('hidden');
  }

  // --------------------------------------------------------- scenes --
  buildTruck() {
    const g = new THREE.Group();
    const hull = new THREE.MeshStandardMaterial({ color: 0x7a8494, metalness: 0.6, roughness: 0.45 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x22262e, metalness: 0.5, roughness: 0.5 });
    const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 2.2, 2.6) });
    const body = new THREE.Mesh(new THREE.BoxGeometry(3.2, 2.6, 7.5), hull);
    body.position.set(0, 1.9, -1);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(3, 2.2, 2.6), dark);
    cab.position.set(0, 1.7, 3.6);
    g.add(body, cab);
    for (const [x, z] of [[-1.3, -3.5], [1.3, -3.5], [-1.3, 2.5], [1.3, 2.5]]) {
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 0.2, 12), glow);
      pad.position.set(x, 0.5, z);
      g.add(pad);
    }
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.2, 0.1), glow);
    lamp.position.set(0, 2.2, 4.95);
    g.add(lamp);
    return g;
  }

  placeOnGround(obj, pos, look, lift = 0) {
    const up = pos.clone().normalize();
    obj.position.copy(this.ground(pos, lift));
    const m = new THREE.Matrix4().lookAt(obj.position, look, up);
    obj.quaternion.setFromRotationMatrix(m);
    obj.rotateY(Math.PI);
  }

  // The opening: the Concord at its height, the Night of Teeth, the ruins
  // today, life behind the walls, and you.
  introScene() {
    const g = this.g;
    const capital = this.capital().group.position.clone();
    const cup = capital.clone().normalize();
    const ce = V(1, 0, 0).projectOnPlane(cup).normalize();
    const cn = V().crossVectors(ce, cup);
    const ruinObj = this.terra().ensureRuin(0);
    const site = this.ruinCenter(0);
    const up = site.clone().normalize();
    const e = V().subVectors(capital, site).projectOnPlane(up).normalize();
    const n = V().crossVectors(e, up);
    const at = (x, y, z) => site.clone().addScaledVector(e, x).addScaledVector(up, y).addScaledVector(n, z);
    const tint = document.getElementById('tint');
    const fade = document.getElementById('fade');
    let memory = null;
    let beasts = [];
    let night = -1;
    let a = 0;
    const orbit = () => capital.clone().addScaledVector(cup, 520 - a * 120).addScaledVector(ce, Math.cos(a) * 900).addScaledVector(cn, Math.sin(a) * 900);
    const home = this.capital().spawnLocal.clone();
    const setTint = (color, opacity, blend) => {
      tint.style.background = color;
      tint.style.mixBlendMode = blend;
      tint.style.opacity = opacity;
    };
    const cleanup = () => {
      if (memory) {
        g.localRoot.remove(memory.group);
        memory.dispose();
        memory = null;
      }
      for (const b of beasts) g.beasts.removeBeast(b);
      beasts = [];
      if (ruinObj) ruinObj.group.visible = true;
      setTint('transparent', 0, 'normal');
    };
    return g.playCutscene({
      tick: (t, dt) => {
        a = Math.max(0, Math.min(1.6, (t - 21) * 0.08));
        if (!memory) return;
        memory.update(t, dt, night >= 0 ? t - night : -1);
        if (night >= 0) for (const b of beasts) if (b.alive) b.pos.addScaledVector(e, 14 * dt);
      },
      shots: [
        { dur: 9, from: () => at(-650, 240, 120), to: () => at(-260, 130, 40), look: () => at(0, 110, 0) },
        { dur: 3.5, from: () => at(-560, 70, 210), to: () => at(-520, 60, 190), look: () => at(0, 110, 0) },
        { dur: 4.5, from: () => at(-300, 18, 40), to: () => at(-260, 24, 20), look: () => at(-120, 6, 20) },
        { dur: 4.5, from: () => at(-300, 120, 60), to: () => at(-200, 80, 30), look: () => at(0, 10, 0) },
        { dur: 10, from: orbit, look: () => capital },
        { dur: 8.5, from: () => home.clone().addScaledVector(cup, 30).addScaledVector(ce, -40), to: () => home.clone().addScaledVector(cup, 6).addScaledVector(ce, -12), look: () => home },
      ],
      lines: [
        { at: 0.5, who: '', text: 'Two centuries ago, Terra belonged to the Aurean Concord.' },
        { at: 4.6, who: '', text: 'Their towers touched the clouds, and their skies never slept.' },
        { at: 9.5, who: '', text: 'Then came the Night of Teeth.' },
        { at: 12.6, who: '', text: 'In seventeen hours, the beasts took the world.' },
        { at: 17.3, who: '', text: 'Two hundred years later, the Concord is rubble and bones.' },
        { at: 21.8, who: '', text: 'The survivors built walls. Some were born with awakened genes: warriors, strong enough to fight back.' },
        { at: 27, who: '', text: 'Base City 07. Two million people, one wall, and beasts that grow stronger every year.' },
        { at: 31.8, who: '', text: 'You are seventeen. No awakened genes, no famous family. Just two years of savings and a stubborn dream.' },
        { at: 37, who: 'You', text: 'Today I stop dreaming.' },
      ],
      events: [
        { at: 0, fn: () => {
          memory = buildMemoryCity(at, up, e, n);
          memory.onBoom = (pos, h) => { g.combat.explosion(pos.clone().addScaledVector(up, 8), 0xff7a3a, 2 + h / 60); g.sound.explosion(pos, true); g.rt.shake = Math.max(g.rt.shake, 0.4); };
          g.localRoot.add(memory.group);
          if (ruinObj) ruinObj.group.visible = false;
          tint.style.transition = 'opacity 1.2s';
          setTint('#d9a85a', 0.28, 'soft-light');
        } },
        { at: 9.2, fn: () => {
          night = 9.2;
          tint.style.transition = 'opacity 0.6s, background 0.6s';
          setTint('#ff1a08', 0.42, 'multiply');
          g.post.fx.flash = 0.6;
          g.sound.thunder();
          beasts = [
            ...this.spawnPack('intro', 'ironwolf', 10, at(-250, 0, 30), 0, false, false),
            ...this.spawnPack('intro', 'goldhorn', 3, at(-280, 0, 0), 0, false, false),
            ...this.spawnPack('intro', 'shadowmantis', 5, at(-240, 0, 50), 0, false, false),
          ];
          for (const k of [0.6, 2.1, 3.4, 5.2, 6.6]) this.pending(k, () => { if (memory) g.combat.lightning(at((Math.random() - 0.5) * 300, 0, (Math.random() - 0.5) * 300), 0xff8a6a, 600, up); g.sound.thunder(); });
        } },
        { at: 16.9, fn: () => {
          fade.style.transition = 'none';
          fade.style.background = '#fff';
          fade.style.opacity = 1;
          cleanup();
          setTimeout(() => { fade.style.transition = 'opacity 1.4s'; fade.style.opacity = 0; }, 60);
          setTimeout(() => { fade.style.transition = ''; fade.style.background = ''; }, 1600);
        } },
        { at: 39.9, fn: cleanup },
      ],
    });
  }

  // Run fn after a delay (in real time; used for cutscene flourishes).
  pending(sec, fn) {
    setTimeout(fn, sec * 1000);
  }

  convoyScene() {
    const g = this.g;
    const gate = this.gate();
    const ruin = this.ruinCenter(0);
    const edge = this.between(gate.out, ruin, 0.82);
    const path = (k) => this.between(gate.out, edge, k);
    for (let i = 0; i < 3; i++) {
      const t = this.buildTruck();
      g.localRoot.add(t);
      this.trucks.push(t);
    }
    const moveTrucks = (k) => {
      this.trucks.forEach((t, i) => {
        const kk = Math.max(0, Math.min(1, k - i * 0.05));
        this.placeOnGround(t, path(kk), path(Math.min(1, kk + 0.02)), 1.2 - EYE);
      });
    };
    moveTrucks(0);
    let crash = false;
    let lastBreak = 0;
    const p = g.player;
    this.convoyDir = V().subVectors(edge, gate.out).normalize();
    const capital = this.capital().group.position;
    const up = (v) => v.clone().normalize();
    const lead = () => this.trucks[0].position.clone();
    return g.playCutscene({
      tick: (t) => {
        if (crash) return;
        moveTrucks(Math.min(1, t / 12.6));
        if (t - lastBreak > 0.25) {
          lastBreak = t;
          for (const tr of this.trucks) g.breakAt(tr.position, 5, this.heading());
        }
      },
      shots: [
        { dur: 5, from: () => capital.clone().addScaledVector(up(capital), 420).addScaledVector(V().subVectors(capital, gate.out).normalize(), 300), to: () => gate.pos.clone().addScaledVector(up(gate.pos), 140).addScaledVector(V().subVectors(capital, gate.out).normalize(), 120), look: () => gate.out },
        { dur: 7, from: () => lead().addScaledVector(up(lead()), 26).add(this.side(lead(), 22)).addScaledVector(this.heading(), -18), look: () => lead().addScaledVector(up(lead()), 2) },
        { dur: 4, from: () => edge.clone().addScaledVector(up(edge), 25).add(this.side(edge, -30)), look: () => edge },
        { dur: 2.5, from: () => edge.clone().addScaledVector(up(edge), 4).add(this.side(edge, 8)), to: () => edge.clone().addScaledVector(up(edge), 2).add(this.side(edge, 5)), look: () => edge },
      ],
      lines: [
        { at: 0.5, who: '', text: 'Terra. Two centuries after the Night of Teeth. Humanity lives behind walls.' },
        { at: 5.2, who: 'Driver', text: 'Salvage run to Meridian Sprawl. Easy money, they said.' },
        { at: 8.6, who: 'Driver', text: 'Rookie, keep your eyes on those ruins. Ironhides den out here.' },
        { at: 12.3, who: 'Driver', text: 'Contact! A whole pack — brace, brace!' },
      ],
      events: [
        { at: 12.6, fn: () => {
          crash = true;
          moveTrucks(1);
          this.spawnPack('prologue', 'ironwolf', 4, this.offset(edge, 14, 6), -0.2, false, false);
          this.trucks.forEach((t, i) => {
            g.combat.explosion(t.position, 0xff8a3a, 1.4);
            t.rotateZ(i % 2 ? 1.2 : -0.9);
            t.position.addScaledVector(up(t.position), -0.8);
          });
          g.rt.shake = 1.5;
          g.sound.explosion(edge, true);
        } },
        { at: 18.4, fn: () => {
          const at = this.offset(edge, -4, -6);
          p.placeAt(at, edge.clone(), up(at));
          p.mode = 'ground';
          g.camQuat.copy(p.quat);
          for (const b of g.beasts.beasts) if (b.tag === 'prologue') b.aggro = true;
        } },
      ],
    });
  }

  heading() {
    return this.convoyDir || V(1, 0, 0);
  }

  side(pos, d) {
    const up = pos.clone().normalize();
    const toCap = this.capital().group.position.clone().sub(pos).projectOnPlane(up).normalize();
    return V().crossVectors(toCap, up).normalize().multiplyScalar(d);
  }

  ringScene() {
    const g = this.g;
    const b = this.bunker(0);
    const up = b.clone().normalize();
    const ringPos = b.clone().addScaledVector(up, 0.3).add(this.side(b, 0.6));
    const ring = new THREE.Group();
    ring.add(new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.035, 8, 24), new THREE.MeshStandardMaterial({ color: 0x8a7a5a, metalness: 0.9, roughness: 0.3 })));
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.05, 0), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.0, 2.6) }));
    gem.position.y = 0.13;
    ring.add(gem);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: new THREE.Color(1.2, 0.7, 2.4), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    halo.scale.setScalar(0.9);
    ring.add(halo);
    ring.position.copy(ringPos);
    ring.quaternion.setFromUnitVectors(V(0, 1, 0), up);
    g.localRoot.add(ring);
    const fade = document.getElementById('fade');
    return g.playCutscene({
      tick: (t, dt) => { ring.rotateY(dt * 1.8); halo.material.opacity = 0.6 + 0.4 * Math.sin(t * 3.3); },
      shots: [
        { dur: 3, from: () => b.clone().addScaledVector(up, 1.5).add(this.side(b, -6)), to: () => b.clone().addScaledVector(up, 1).add(this.side(b, -2)), look: () => b },
        { dur: 9, from: () => ringPos.clone().addScaledVector(up, 0.25).add(this.side(b, -0.6)), to: () => ringPos.clone().addScaledVector(up, 0.35).add(this.side(b, -0.45)), look: () => ringPos },
        { dur: 7, from: () => ringPos.clone().addScaledVector(up, 0.4).add(this.side(b, -0.5)), look: () => ringPos },
      ],
      lines: [
        { at: 0.3, who: '', text: 'At the bunker door lie the bones of a guardian who never made it inside. On one finger, a battered ring still glows.' },
        { at: 4.5, who: 'Nix', text: '—and furthermore, if anyone thinks I’m going back to sleep for another— oh. Oh! A pulse!' },
        { at: 8.6, who: 'Nix', text: 'Hello! I’m Nix. Ancient intelligence, spatial ring, devastatingly charming. And you are... a teenager covered in wolf.' },
        { at: 13.4, who: 'Nix', text: 'Where’s Seren? She was just... I don’t remember. Never mind. Put me on and let’s get you home before more teeth arrive.' },
      ],
      events: [
        { at: 0, fn: () => { fade.style.transition = 'opacity 1.2s'; fade.style.background = '#000'; fade.style.opacity = 0.55; } },
        { at: 18.6, fn: () => {
          g.localRoot.remove(ring);
          ring.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
          fade.style.opacity = 0;
          setTimeout(() => { fade.style.background = ''; fade.style.transition = ''; }, 1300);
          g.state.nixAwake = true;
          if (!g.state.lore.includes(0)) g.state.lore.push(0);
          g.hud.notify(`Nix is bound to you. The ring is a <b>space ring</b>: it folds space to carry what you collect. Press ${key('panelRing')} to look inside.`, 'violet');
        } },
      ],
    });
  }

  tideScene() {
    const g = this.g;
    const gate = this.gate();
    const out = gate.out.clone();
    const dir = V().subVectors(out, gate.pos).normalize();
    const far = this.ground(out.clone().addScaledVector(dir, 240));
    const up = (v) => v.clone().normalize();
    // the horde gathering on the horizon
    const show = [
      ...this.spawnPack('tideshow', 'ironwolf', 9, far, 0, false, false),
      ...this.spawnPack('tideshow', 'goldhorn', 2, this.offset(far, 20, 10), 0, false, false),
      ...this.spawnPack('tideshow', 'shadowmantis', 4, this.offset(far, -25, -5), 0, false, false),
    ];
    return g.playCutscene({
      shots: [
        { dur: 5, from: () => gate.wall(0).addScaledVector(up(gate.pos), 6).addScaledVector(dir, -20), to: () => gate.wall(0).addScaledVector(up(gate.pos), 3).addScaledVector(dir, 5), look: () => far },
        { dur: 5, from: () => far.clone().addScaledVector(up(far), 9).addScaledVector(dir, -45).add(this.side(far, 18)), to: () => far.clone().addScaledVector(up(far), 6).addScaledVector(dir, -30).add(this.side(far, 10)), look: () => far },
        { dur: 4, from: () => gate.pos.clone().addScaledVector(up(gate.pos), 40).addScaledVector(dir, -80), look: () => out },
      ],
      lines: [
        { at: 0.5, who: 'Guard', text: 'Beast tide! Hundreds of them, coming out of the old city!' },
        { at: 4.8, who: 'Instructor Hale', text: 'Every warrior to the gate! Turrets online! Hold the wall!' },
        { at: 9.6, who: 'Nix', text: 'I’d like to point out that “hundreds” is a lot.' },
        { at: 12, who: 'Kade', text: 'Scared, rookie? Stay behind me.' },
      ],
      events: [
        { at: 0, fn: () => g.sound.thunder() },
        { at: 13.9, fn: () => { for (const b of show) g.beasts.removeBeast(b); } },
      ],
    });
  }

  victoryScene() {
    const g = this.g;
    const gate = this.gate();
    for (const b of g.beasts.beasts.slice()) if (b.tag && b.tag.startsWith('tide')) g.beasts.removeBeast(b);
    const stand = this.ground(gate.pos.clone().lerp(gate.out, 0.5));
    g.player.placeAt(stand, this.capital().group.position.clone(), stand.clone().normalize());
    g.player.vel.set(0, 0, 0);
    const p = stand.clone();
    const up = p.clone().normalize();
    const e = this.side(p, 1).normalize();
    const n = V().crossVectors(e, up);
    let a = 0;
    const orbit = () => p.clone().addScaledVector(up, 2.5).addScaledVector(e, Math.cos(a) * 7).addScaledVector(n, Math.sin(a) * 7);
    this.spawnNPC('kade', this.offset(p, 3, 2), 0x3a1a1a, 0xff5a3a, 'Kade');
    this.spawnNPC('hale', this.offset(p, -3, 2.5), 0x3a3020, 0xffc857, 'Instructor Hale');
    return g.playCutscene({
      showPlayer: true,
      tick: (t) => { a = t * 0.25; },
      shots: [{ dur: 15, from: orbit, look: () => p.clone().addScaledVector(up, -0.4) }],
      lines: [
        { at: 0.5, who: 'Instructor Hale', text: 'The tide is broken. Base City 07 stands because of you.' },
        { at: 4.2, who: 'Kade', text: '...Not bad, convoy rookie. Not bad at all.' },
        { at: 7.4, who: 'Nix', text: 'Feel that? Your meridians are begging to break through. Face the tribulation when you’re ready.' },
        { at: 11.3, who: 'Nix', text: 'Wait. Something larger is moving beneath the horizon. The tide wasn’t attacking us. It was running.' },
      ],
      events: [
        { at: 0, fn: () => g.sound.breakthrough() },
        { at: 14.9, fn: () => { this.removeNPC('kade'); this.removeNPC('hale'); } },
      ],
    });
  }

  // ------------------------------------------------- the beast tide --
  buildTurrets() {
    const g = this.g;
    const gate = this.gate();
    for (const off of [-34, -14, 14, 34]) {
      const pos = gate.wall(off);
      const up = pos.clone().normalize();
      const grp = new THREE.Group();
      grp.add(new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.6, 2.6), new THREE.MeshStandardMaterial({ color: 0x3a404c, metalness: 0.7, roughness: 0.4 })));
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.3, 3, 8).rotateX(Math.PI / 2).translate(0, 0, 1.4), new THREE.MeshStandardMaterial({ color: 0x1a1e26, metalness: 0.8 }));
      barrel.position.y = 1.1;
      grp.add(barrel);
      grp.add(new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.08, 4, 16).rotateX(Math.PI / 2).translate(0, 0.85, 0), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 2.2, 2.6) })));
      grp.position.copy(pos);
      grp.quaternion.setFromUnitVectors(V(0, 1, 0), up);
      g.localRoot.add(grp);
      this.turrets.push({ group: grp, barrel, cd: Math.random(), up });
    }
  }

  updateTurrets(dt) {
    const g = this.g;
    for (const t of this.turrets) {
      t.cd -= dt;
      if (t.cd > 0) continue;
      let best = null, bd = 320;
      for (const b of g.beasts.beasts) {
        if (!b.alive || b.static) continue;
        const d = b.pos.distanceTo(t.group.position);
        if (d < bd) { bd = d; best = b; }
      }
      if (!best) { t.cd = 0.5; continue; }
      t.cd = 1.1;
      const from = t.group.position.clone().addScaledVector(t.up, 1.2);
      const dir = best.pos.clone().sub(from).normalize();
      g.combat.firePlayerBolt(from, dir, g.stats.atk * 0.45, 0x3ef2ff, 520, { size: 0.9 });
    }
  }

  nextWave() {
    const step = this.step;
    if (!step || step.type !== 'waves') return;
    const w = step.waves[this.st.wave];
    if (!w) return;
    this.st.wave++;
    const gate = this.gate();
    const dir = V().subVectors(gate.out, gate.pos).normalize();
    for (let i = 0; i < w.length; i += 2) {
      const center = this.ground(gate.out.clone().addScaledVector(dir, 220 + Math.random() * 120).add(this.side(gate.out, (Math.random() - 0.5) * 160)));
      const pack = this.spawnPack('tide', w[i], w[i + 1], center, 0.1);
      for (const b of pack) b.home.copy(gate.pos);
    }
    this.g.hud.banner('BEAST TIDE', `Wave ${this.st.wave} of ${step.waves.length}`, '<span class="cn">兽潮</span>Hold the gate', '#ff4466', 2);
    this.g.sound.thunder();
    this.render();
  }

  spawnBoss() {
    const g = this.g;
    const gate = this.gate();
    const dir = V().subVectors(gate.out, gate.pos).normalize();
    const at = this.ground(gate.out.clone().addScaledVector(dir, 180));
    const [b] = this.spawnPack('tideking', 'tideking', 1, at, 0.7);
    if (!b) return;
    this.boss = b;
    this.bossPhase = 0;
    g.beasts.boss = b;
    this.spawnPack('tide-escort', 'ironwolf', 4, at, 0);
    g.hud.banner('TIDE KING', TIDE_KING.name, `<span class="cn">${TIDE_KING.cn}</span>`, '#ff3a2a', 3.5);
    this.nix('That’s the alpha. Kill it and the tide breaks. No pressure. Some pressure.');
    g.sound.thunder();
  }

  updateBoss() {
    const b = this.boss;
    if (!b || !b.alive) return;
    const g = this.g;
    const frac = b.hp / b.maxHp;
    const phase = frac < 0.33 ? 2 : frac < 0.66 ? 1 : 0;
    if (phase > this.bossPhase) {
      this.bossPhase = phase;
      // a roar that hurls you back, and the pack answers
      g.combat.shockwave(b.pos, 45, 0xff3a2a, 1);
      const pp = g.player.pos;
      if (pp.distanceTo(b.pos) < 45) g.player.vel.add(pp.clone().sub(b.pos).normalize().multiplyScalar(40));
      g.rt.shake = 1.2;
      g.sound.thunder();
      this.spawnPack('tide-escort', phase === 2 ? 'shadowmantis' : 'ironwolf', 3, this.ground(b.pos), 0.1);
      if (phase === 2) {
        b.def = { ...b.def, speed: b.def.speed * 1.4 };
        this.nix('It’s angry now. Angrier. Whatever comes after angry.');
      } else this.nix('It called for help. Rude.');
    }
  }
}
