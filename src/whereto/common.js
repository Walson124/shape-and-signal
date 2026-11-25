import { store } from '../platform/shell.js';

// Small helpers both Whereto pages use.

export const KIND = {
  travel: { label: 'Trip', yes: 'Want to go', maybe: 'Would go', placeholder: 'e.g. Summer trip 2027', question: 'Where should we go?' },
  meet: { label: 'Meetup', yes: 'Works', maybe: 'If needed', placeholder: 'e.g. Team planning day', question: 'Where should we meet?' },
  other: { label: 'Plan', yes: 'Works', maybe: 'If needed', placeholder: 'e.g. Saturday picnic spot', question: 'Which spot works?' },
};

export async function api(method, path, body) {
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('Couldn\'t reach the Whereto server. Check your connection.');
  }
  let data = null;
  try { data = await res.json(); } catch { /* not JSON */ }
  if (!res.ok) {
    const e = new Error(data?.error || (res.status === 404 ? 'Not found.' : 'Couldn\'t reach the Whereto server.'));
    e.status = res.status;
    throw e;
  }
  return data;
}

const RECENT = 'sas:whereto:plans';
export function recentPlans() {
  try { const l = JSON.parse(store.get(RECENT) || '[]'); return Array.isArray(l) ? l.slice(0, 40) : []; } catch { return []; }
}
// key: the creator's delete key (kept when a plan is opened again)
export function rememberPlan(id, title, key) {
  const all = recentPlans();
  const prev = all.find((p) => p.id === id);
  const list = all.filter((p) => p.id !== id);
  list.unshift({ id, title, at: Date.now(), ...(key || prev?.key ? { key: key || prev.key } : {}) });
  // never push out a plan you own: you'd lose the only way to delete it
  const keep = [...list.filter((p) => p.key), ...list.filter((p) => !p.key).slice(0, 12)];
  store.set(RECENT, JSON.stringify(list.filter((p) => keep.includes(p))));
}
export function forgetPlan(id) {
  store.set(RECENT, JSON.stringify(recentPlans().filter((p) => p.id !== id)));
  saveIdentity(id, null);
}
export const ownerKey = (id) => recentPlans().find((p) => p.id === id)?.key || null;
export async function deletePlan(id) {
  await api('POST', `/api/plan/${encodeURIComponent(id)}/delete`, { key: ownerKey(id) });
  forgetPlan(id);
}

export function myIdentity(id) {
  try { return JSON.parse(store.get(`sas:whereto:me:${id}`) || 'null'); } catch { return null; }
}
export function saveIdentity(id, who) {
  store.set(`sas:whereto:me:${id}`, who ? JSON.stringify(who) : null);
}
