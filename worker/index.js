import { cleanRoomCode } from './mines-match.js';
import { cleanPlanId, newPlanId, validatePlan } from './plan-protocol.js';

export { MinesRoom } from './mines-room.js';
export { Plan } from './plan.js';

// The site's Worker: serves the built apps from dist/, plus:
//   GET  /api/mines?room=CODE    a Minesweeper Duel match (a Durable Object per room code)
//   POST /api/plan               create a Whereto plan -> { id }
//   *    /api/plan/<id>[/...]    read or answer a plan (a Durable Object per plan)

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

// a soft per-instance limit on how often one address may do something
function allow(map, ip, per, windowMs) {
  const now = Date.now();
  const times = (map.get(ip) || []).filter((t) => now - t < windowMs);
  if (times.length >= per) return false;
  times.push(now);
  map.set(ip, times);
  if (map.size > 5000) map.delete(map.keys().next().value);
  return true;
}
const planCreates = new Map(), planCalls = new Map(), minesJoins = new Map();
const ipOf = (request) => request.headers.get('cf-connecting-ip') || 'unknown';

async function plans(request, env, url) {
  if (!env.PLANS) return json(503, { error: 'Whereto is not set up on this server.' });
  const ip = ipOf(request);
  // pages poll a plan every 5 s, so this is far above normal use
  if (!allow(planCalls, ip, 240, 60 * 1000)) return json(429, { error: 'Too many requests. Wait a minute and try again.' });
  const rest = url.pathname.slice('/api/plan'.length).replace(/^\/+/, '');
  if (!rest) {
    if (request.method !== 'POST') return json(405, { error: 'POST only.' });
    if (!allow(planCreates, ip, 20, 60 * 60 * 1000)) return json(429, { error: "That's a lot of plans. Try again later." });
    const raw = await request.text();
    if (raw.length > 1_600_000) return json(413, { error: 'That picture is too large.' });
    let body;
    try { body = JSON.parse(raw); } catch { return json(400, { error: 'Bad request.' }); }
    const v = validatePlan(body);
    if (!v.ok) return json(400, { error: v.error });
    for (let i = 0; i < 3; i++) {
      const id = newPlanId();
      const res = await env.PLANS.get(env.PLANS.idFromName(id)).fetch('https://plan/create', {
        method: 'POST', body: JSON.stringify({ plan: v.plan, image: v.image }),
      });
      if (res.ok) return json(200, { id, key: (await res.json()).key });
    }
    return json(500, { error: "Couldn't save the plan. Try again." });
  }
  const [id, ...sub] = rest.split('/');
  if (!cleanPlanId(id)) return json(404, { error: 'No plan here.' });
  const inner = new URL(`https://plan/${sub.join('/')}`);
  inner.search = url.search;
  return env.PLANS.get(env.PLANS.idFromName(id)).fetch(new Request(inner, request));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/mines') {
      const code = cleanRoomCode(url.searchParams.get('room'));
      if (!code) return json(400, { error: 'Bad room code.' });
      if (!env.MINES) return json(503, { error: 'Minesweeper Duel is not set up on this server.' });
      if (request.headers.get('Upgrade') !== 'websocket') return json(426, { error: 'Expected a WebSocket.' });
      if (!allow(minesJoins, ipOf(request), 30, 60 * 1000)) return json(429, { error: 'Too many connections. Wait a minute and try again.' });
      return env.MINES.get(env.MINES.idFromName(code)).fetch(request);
    }
    if (url.pathname === '/api/plan' || url.pathname.startsWith('/api/plan/')) return plans(request, env, url);
    if (url.pathname.startsWith('/api/')) return json(404, { error: 'Not found.' });
    return env.ASSETS.fetch(request);
  },
};
