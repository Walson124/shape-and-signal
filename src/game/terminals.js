// What's on an office terminal: the owner's inbox. Mostly the ordinary business of a
// city on a frontier world, with now and then something useful: a rumour of a site in
// the wilds, or a credit chit someone forgot to claim.

const FIRST = ['Lin', 'Wei', 'Mei', 'Jun', 'Hao', 'Yan', 'Rui', 'Xiao', 'Feng', 'Lan', 'Bo', 'Qing', 'Tao', 'Ying', 'Kai', 'Shu'];
const LAST = ['Chen', 'Zhao', 'Wang', 'Liu', 'Sun', 'Zhou', 'Wu', 'Xu', 'He', 'Gao', 'Lin', 'Guo', 'Ma', 'Luo', 'Song', 'Tang'];
const DEPTS = ['Accounts', 'Facilities', 'Security', 'Logistics', 'HR', 'Field Survey', 'Procurement', 'IT'];

function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const pick = (r, a) => a[Math.floor(r() * a.length)];
const person = (r) => `${pick(r, FIRST)} ${pick(r, LAST)}`;

const MAILS = [
  (r, c) => ({ subject: 'Lift maintenance, Thursday', body: `The ${pick(r, ['east', 'west'])} lift will be out between nine and noon. Please use the stairs, or, for those of you past the War God realm, the window.` }),
  (r, c) => ({ subject: 'Beast sightings near the wall', body: `Patrols report ${pick(r, ['ironhide wolves', 'bladewing hawks', 'a golden-horn rhino', 'thunder lizards'])} within two kilometres of the ${pick(r, ['north', 'south', 'east', 'west'])} gate. Staff are asked not to take lunch outside the wall until further notice.` }),
  (r, c) => ({ subject: 'Re: quarterly figures', body: `Numbers are up ${Math.floor(3 + r() * 14)}% on star metal throughput. Whoever keeps taking the good chair in meeting room ${Math.floor(1 + r() * 6)}, please stop.` }),
  (r, c) => ({ subject: 'Cultivation pill reimbursement', body: `As of this month, Rejuvenation Pills bought for work injuries can be claimed back through ${pick(r, DEPTS)}. Breakthrough pills cannot. We have been over this.` }),
  (r, c) => ({ subject: 'Lost: one space ring', body: 'Plain band, scratched, contains (I think) three bento boxes and my father\'s sword. Reward offered. Please check the break room.' }),
  (r, c) => ({ subject: 'The vending machine', body: `It has eaten my coins for the ${pick(r, ['third', 'fourth', 'fifth'])} time. I have reported it. I have reasoned with it. Next time I am using a technique on it.` }),
  (r, c) => ({ subject: 'Welcome our new hire', body: `Please welcome ${person(r)}, joining ${pick(r, DEPTS)} from ${pick(r, ['the orbital docks', 'Yangzhou', 'a hunting team in the wilds', 'the Martial Hall'])}. They are a Warrior, so be gentle with the doors.` }),
  (r, c) => ({ subject: 'Thunderstorm protocol', body: 'When storms hit, cultivators on staff may take their breaks on the roof. The charged air thickens the qi. Do not stand next to the antenna.' }),
  (r, c) => ({ subject: 'Arena tickets', body: `I have two spare for wave ${Math.floor(5 + r() * 20)} on Friday. Free to anyone who covers my shift.` }),
  (r, c) => ({ subject: `${c.city} power grid`, body: 'Brownouts expected in the lower blocks this week while the reactor is serviced. Save your work. The terminals do not survive being punched.' }),
];

// The inbox on one terminal. reward: { kind: 'rumor' | 'coins' } or null, decided by the caller.
export function terminalInbox(seed, ctx, reward) {
  const r = rng(seed);
  const owner = person(r);
  const mails = [];
  const used = new Set();
  const n = 3 + Math.floor(r() * 2);
  while (mails.length < n) {
    const i = Math.floor(r() * MAILS.length);
    if (used.has(i)) continue;
    used.add(i);
    mails.push({ from: `${person(r)} · ${pick(r, DEPTS)}`, ...MAILS[i](r, ctx) });
  }
  if (reward && reward.kind === 'rumor') {
    mails.unshift({ from: `${person(r)} · Field Survey`, subject: `Don't share this: ${reward.label}`, body: `Survey drones picked up ${reward.label.toLowerCase()} about ${reward.dist} to the ${reward.dir} of the city. Not on the public charts yet. I've marked it on your map. Keep it quiet until we've staked a claim.`, flag: true });
  } else if (reward && reward.kind === 'coins') {
    mails.unshift({ from: `${person(r)} · Accounts`, subject: 'Unclaimed expenses', body: `Your expense chit for ${reward.amount} ◈ was never collected. I've released it to whoever is logged into this terminal. That's you, I assume.`, flag: true });
  }
  return { owner, mails };
}
