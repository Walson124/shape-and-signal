// The star map's memory and route finding: which jumps you've made, and the
// shortest chain of known systems that gets you somewhere within warp range.

const MAX_JUMPS = 300;

// Remember a warp from one system to another (once per pair, either direction).
export function recordJump(state, from, to) {
  if (!from || !to || from === to) return;
  const jumps = state.jumps || (state.jumps = []);
  if (jumps.some(([a, b]) => (a === from && b === to) || (a === to && b === from))) return;
  jumps.push([from, to]);
  if (jumps.length > MAX_JUMPS) jumps.shift();
}

// Fewest jumps (then shortest distance) from one star to another through
// `stars` (objects with key and pos), each jump no longer than `range`.
// Returns the list of stars after the start, or null if there's no way.
export function findRoute(stars, fromKey, toKey, range) {
  const byKey = new Map(stars.map((s) => [s.key, s]));
  const start = byKey.get(fromKey), goal = byKey.get(toKey);
  if (!start || !goal || range <= 0) return null;
  if (fromKey === toKey) return [];
  const best = new Map([[fromKey, { hops: 0, dist: 0, prev: null }]]);
  const open = [fromKey];
  while (open.length) {
    open.sort((a, b) => best.get(a).hops - best.get(b).hops || best.get(a).dist - best.get(b).dist);
    const k = open.shift();
    if (k === toKey) break;
    const here = best.get(k), from = byKey.get(k);
    for (const s of stars) {
      if (s.key === k) continue;
      const d = from.pos.distanceTo(s.pos);
      if (d > range) continue;
      const cand = { hops: here.hops + 1, dist: here.dist + d, prev: k };
      const cur = best.get(s.key);
      if (!cur || cand.hops < cur.hops || (cand.hops === cur.hops && cand.dist < cur.dist - 1e-9)) {
        best.set(s.key, cand);
        if (!open.includes(s.key)) open.push(s.key);
      }
    }
  }
  if (!best.has(toKey)) return null;
  const path = [];
  for (let k = toKey; k !== fromKey; k = best.get(k).prev) path.unshift(byKey.get(k));
  return path;
}
