import { EmailMessage } from 'cloudflare:email';
import { validateFeedback, buildEmail } from './feedback.js';

// The site's Worker: serves the built game from dist/, plus one endpoint,
// POST /api/feedback, which emails player feedback to FEEDBACK_TO.

const WINDOW = 10 * 60 * 1000, PER_WINDOW = 5;
const recent = new Map(); // ip -> send times (per Worker instance: a soft limit)

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

async function feedback(request, env) {
  if (request.method !== 'POST') return json(405, { error: 'POST only.' });
  if (!env.FEEDBACK_EMAIL || !env.FEEDBACK_TO || !env.FEEDBACK_FROM) return json(503, { error: 'Feedback is not set up on this server.' });
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const now = Date.now();
  const times = (recent.get(ip) || []).filter((t) => now - t < WINDOW);
  if (times.length >= PER_WINDOW) return json(429, { error: 'That\'s a lot of feedback at once. Try again in a few minutes.' });
  const raw = await request.text();
  if (raw.length > 16000) return json(413, { error: 'That message is too long.' });
  let body;
  try { body = JSON.parse(raw); } catch { return json(400, { error: 'Bad request.' }); }
  const v = validateFeedback(body);
  // pretend spam went through, so bots learn nothing
  if (v.spam) return json(200, { ok: true });
  if (!v.ok) return json(400, { error: v.error });
  times.push(now);
  recent.set(ip, times);
  if (recent.size > 5000) recent.delete(recent.keys().next().value);
  try {
    const mail = buildEmail({ from: env.FEEDBACK_FROM, to: env.FEEDBACK_TO, data: v.data });
    await env.FEEDBACK_EMAIL.send(new EmailMessage(env.FEEDBACK_FROM, env.FEEDBACK_TO, mail));
  } catch (e) {
    console.error('feedback email failed', e);
    return json(502, { error: 'Couldn\'t send right now. Please try again later.' });
  }
  return json(200, { ok: true });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/feedback') return feedback(request, env);
    return env.ASSETS.fetch(request);
  },
};
