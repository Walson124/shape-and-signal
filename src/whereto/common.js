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
  try { return JSON.parse(store.get(RECENT) || '[]').slice(0, 12); } catch { return []; }
}
export function rememberPlan(id, title) {
  const list = recentPlans().filter((p) => p.id !== id);
  list.unshift({ id, title, at: Date.now() });
  store.set(RECENT, JSON.stringify(list.slice(0, 12)));
}

export function myIdentity(id) {
  try { return JSON.parse(store.get(`sas:whereto:me:${id}`) || 'null'); } catch { return null; }
}
export function saveIdentity(id, who) {
  store.set(`sas:whereto:me:${id}`, who ? JSON.stringify(who) : null);
}
