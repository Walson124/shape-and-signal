// The space ring (空间戒指): a pocket of folded space that stores what you
// carry. Beast parts for crafting, things to build, a vehicle, tamed beasts.
// Capacity is counted in slots: one per kind of item (stacks of up to 99),
// and some big things take several.

export const RING_TIERS = [
  { name: 'Battered Ring', cn: '残破戒指', slots: 12, coins: 0, ore: 0, essence: 0, desc: 'Nix’s old ring. Cramped, scratched, and talks too much.' },
  { name: 'Iron Storage Ring', cn: '铁质储物戒', slots: 24, coins: 600, ore: 20, essence: 60, desc: 'Room for a vehicle, if you fold it carefully.' },
  { name: 'Jade Storage Ring', cn: '玉质储物戒', slots: 48, coins: 6000, ore: 80, essence: 600, desc: 'A proper warrior’s ring.' },
  { name: 'Starsteel Ring', cn: '星钢储物戒', slots: 96, coins: 60000, ore: 300, essence: 6000, desc: 'A small warehouse on your finger.' },
  { name: 'Void Ring', cn: '虚空戒指', slots: Infinity, coins: 600000, ore: 1200, essence: 60000, desc: 'A pocket universe. It never fills.' },
];

const STACK = 99;

// Part names by body plan: [common, rare].
const PART_NOUNS = {
  quad: ['Hide', 'Fang'], avian: ['Feather', 'Talon'], insect: ['Carapace', 'Scythe'], serpent: ['Scale', 'Fang'],
  golem: ['Stone Shard', 'Core'], default: ['Hide', 'Claw'],
};
const PART_CN = { Hide: '兽皮', Fang: '獠牙', Feather: '羽毛', Talon: '利爪', Carapace: '甲壳', Scythe: '镰刃', Scale: '鳞片', 'Stone Shard': '石片', Core: '晶核', Claw: '兽爪' };

// A beast part: its id records species, rarity and grade (the beast's tier).
export function partFor(def, tier, rare) {
  const nouns = PART_NOUNS[def.arch] || PART_NOUNS.default;
  const noun = nouns[rare ? 1 : 0];
  const grade = Math.max(0, Math.floor(tier));
  return {
    id: `part:${def.id}:${rare ? 1 : 0}:${grade}`,
    kind: 'part', rare: !!rare, grade,
    name: `${def.name} ${noun}`, cn: `${def.cn || ''}${PART_CN[noun] || ''}`,
    color: rare ? 0xffc857 : 0xc8a882,
  };
}

// Things you can make and carry.
export const ITEMS = {
  tent: { kind: 'place', name: 'Camp Tent', cn: '帐篷', slots: 1, desc: 'Pitch it anywhere. Rest inside to heal fully, and your body reforms here if you fall.' },
  turret: { kind: 'place', name: 'Guard Turret', cn: '守卫炮台', slots: 1, desc: 'Fires at any beast that comes close. Good around a camp.' },
  totem: { kind: 'place', name: 'Cultivation Totem', cn: '修炼图腾', slots: 1, desc: 'Gathers energy: cultivating within 15 m of it is 60% faster.' },
  collar: { kind: 'tool', name: 'Taming Collar', cn: '驯兽项圈', slots: 1, desc: 'Use it on a beast you have beaten down below a third of its life to make it yours.' },
};

// Recipes made at an Armory. need: { commons, rares, grade } of beast parts, plus resources.
export const RECIPES = [
  { id: 'heal', name: 'Rejuvenation Pill', cn: '回春丹', out: { pill: 'heal' }, need: { commons: 3, grade: 0 }, desc: 'Brew a healing pill from beast hides.' },
  { id: 'energy', name: 'Primal Elixir', cn: '元能液', out: { pill: 'energy' }, need: { commons: 2, rares: 1, grade: 0 }, desc: 'Distil an energy elixir.' },
  { id: 'tent', name: 'Camp Tent', cn: '帐篷', out: { item: 'tent' }, need: { commons: 6, grade: 0 }, desc: ITEMS.tent.desc },
  { id: 'collar', name: 'Taming Collar', cn: '驯兽项圈', out: { item: 'collar' }, need: { rares: 2, grade: 0, ore: 10, coins: 200 }, desc: ITEMS.collar.desc },
  { id: 'turret', name: 'Guard Turret', cn: '守卫炮台', out: { item: 'turret' }, need: { rares: 2, grade: 0, ore: 25, coins: 300 }, desc: ITEMS.turret.desc },
  { id: 'totem', name: 'Cultivation Totem', cn: '修炼图腾', out: { item: 'totem' }, need: { rares: 4, grade: 0, essence: 40, coins: 400 }, desc: ITEMS.totem.desc },
];

// Weapon tempering and hide armour: five levels each, costs grow.
export const MAX_TEMPER = 5;
export const temperCost = (level) => ({ commons: 4 * (level + 1), rares: level, grade: Math.max(0, level - 1), ore: 5 * (level + 1), coins: 100 * (level + 1) * (level + 1) });
export const armorCost = (level) => ({ commons: 6 * (level + 1), rares: level, grade: Math.max(0, level - 1), coins: 150 * (level + 1) * (level + 1) });

// ---------------------------------------------------------------- state
export function hasRing(s) {
  return s.nixAwake !== false;
}

export function ringOf(s) {
  if (!s.ring) s.ring = { tier: 0, items: {} };
  return s.ring;
}

export function capacity(s) {
  return RING_TIERS[ringOf(s).tier].slots;
}

export function slotsUsed(s) {
  const r = ringOf(s);
  let n = 0;
  for (const [id, it] of Object.entries(r.items)) {
    if (!it.qty) continue;
    const big = ITEMS[id] ? ITEMS[id].slots : 1;
    n += Math.ceil(it.qty / STACK) * big;
  }
  if (s.vehicleStored) n += 4;
  n += (s.pets || []).length;
  return n;
}

// Room for one more of this item?
export function canFit(s, id, big = 1) {
  const it = ringOf(s).items[id];
  if (it && it.qty % STACK !== 0) return true;
  return slotsUsed(s) + big <= capacity(s);
}

export function addItem(s, item, qty = 1) {
  const r = ringOf(s);
  const id = item.id || item;
  const big = ITEMS[id] ? ITEMS[id].slots : 1;
  let added = 0;
  for (let i = 0; i < qty; i++) {
    if (!canFit(s, id, big)) break;
    if (!r.items[id]) r.items[id] = { qty: 0, ...(typeof item === 'object' ? { name: item.name, cn: item.cn, kind: item.kind, rare: item.rare, grade: item.grade } : {}) };
    r.items[id].qty++;
    added++;
  }
  return added;
}

export function count(s, id) {
  const it = ringOf(s).items[id];
  return it ? it.qty : 0;
}

export function removeItem(s, id, qty = 1) {
  const r = ringOf(s);
  const it = r.items[id];
  if (!it || it.qty < qty) return false;
  it.qty -= qty;
  if (it.qty <= 0) delete r.items[id];
  return true;
}

// How many parts match a filter.
function parts(s, rare, grade) {
  return Object.entries(ringOf(s).items).filter(([id, it]) => id.startsWith('part:') && !!it.rare === rare && (it.grade || 0) >= grade);
}

export function partCount(s, rare, grade) {
  return parts(s, rare, grade).reduce((n, [, it]) => n + it.qty, 0);
}

// Can these costs be paid?
export function affordable(s, need) {
  if ((need.commons || 0) > partCount(s, false, need.grade || 0)) return false;
  if ((need.rares || 0) > partCount(s, true, need.grade || 0)) return false;
  if ((need.ore || 0) > s.ore) return false;
  if ((need.coins || 0) > s.coins) return false;
  if ((need.essence || 0) > s.essence) return false;
  return true;
}

// Pay them, spending the lowest-grade parts that qualify first.
export function pay(s, need) {
  if (!affordable(s, need)) return false;
  for (const [rare, n0] of [[false, need.commons || 0], [true, need.rares || 0]]) {
    let n = n0;
    const list = parts(s, rare, need.grade || 0).sort((a, b) => (a[1].grade || 0) - (b[1].grade || 0));
    for (const [id, it] of list) {
      if (n <= 0) break;
      const take = Math.min(n, it.qty);
      removeItem(s, id, take);
      n -= take;
    }
  }
  s.ore -= need.ore || 0;
  s.coins -= need.coins || 0;
  s.essence -= need.essence || 0;
  return true;
}

// A short description of a cost, for the menus.
export function costText(need) {
  const bits = [];
  if (need.commons) bits.push(`${need.commons} beast hides/scales${need.grade ? ` (grade ${need.grade}+)` : ''}`);
  if (need.rares) bits.push(`${need.rares} fangs/talons${need.grade ? ` (grade ${need.grade}+)` : ''}`);
  if (need.ore) bits.push(`${need.ore} ⬢`);
  if (need.essence) bits.push(`${need.essence} ✦`);
  if (need.coins) bits.push(`${need.coins} ◈`);
  return bits.join(' · ');
}
