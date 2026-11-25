// Whereto's answer: which spots work for the most people. Pure, so tests can run it.
//
// Each response marks spots 2 ("works") or 1 ("if needed"). A spot's score counts a
// "works" as 1 and an "if needed" as 0.5. Spots that everyone can do come first; among
// those, more "works" wins; then the score; then the name.

export function tally(spots, responses) {
  const byId = new Map(spots.map((s) => [s.id, { id: s.id, name: s.name, sub: s.sub, yes: [], maybe: [] }]));
  for (const r of responses) {
    for (const [id, v] of Object.entries(r.marks || {})) {
      const t = byId.get(id);
      if (!t) continue;
      (v === 2 ? t.yes : t.maybe).push(r.name);
    }
  }
  const n = responses.length;
  for (const t of byId.values()) {
    t.score = t.yes.length + t.maybe.length * 0.5;
    t.count = t.yes.length + t.maybe.length;
    t.all = n > 0 && t.count === n;
    t.frac = n ? t.score / n : 0;
  }
  return byId;
}

export function rank(spots, responses) {
  return [...tally(spots, responses).values()]
    .filter((t) => t.count > 0)
    .sort((a, b) => (b.all - a.all) || (b.count - a.count) || (b.yes.length - a.yes.length) || (b.score - a.score) || a.name.localeCompare(b.name));
}

// a one-line verdict for the top of the plan
export function verdict(ranked, n) {
  if (!n) return { kind: 'empty' };
  if (!ranked.length) return { kind: 'none' };
  const top = ranked[0];
  if (top.all) {
    const ties = ranked.filter((t) => t.all && t.yes.length === top.yes.length && t.count === top.count);
    return { kind: 'all', top, ties: ties.length };
  }
  return { kind: 'closest', top };
}
