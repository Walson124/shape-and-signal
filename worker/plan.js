import { DurableObject } from 'cloudflare:workers';
import { validateResponse, nameKey, hashPassword, decodeDataUrl, MAX_RESPONSES } from './plan-protocol.js';

// One Whereto plan: a Durable Object per plan id, keeping the plan, its uploaded map
// picture and everyone's marks in its own storage. The Worker forwards these requests:
//   POST /create             (internal) store a new, already validated plan
//   GET  /                   the plan and all responses (?v=N answers {same:true} if unchanged)
//   GET  /image              the uploaded map picture
//   POST /respond            { name, password?, marks } add or replace your marks
//   POST /forget             { name, password? } remove your response

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export class Plan extends DurableObject {
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/+/, '');
    const s = this.ctx.storage;
    if (path === 'create' && request.method === 'POST') {
      if (await s.get('plan')) return json(409, { error: 'Taken.' });
      const { plan, image } = await request.json();
      await s.put({ plan: { ...plan, created: Date.now() }, v: 1 });
      if (image) await s.put('image', image);
      return json(200, { ok: true });
    }
    const plan = await s.get('plan');
    if (!plan) return json(404, { error: 'No plan here. Check the link?' });

    if (path === '' && request.method === 'GET') {
      const v = (await s.get('v')) || 1;
      if (Number(url.searchParams.get('v')) === v) return json(200, { same: true, v });
      const rows = await s.list({ prefix: 'r:' });
      const responses = [...rows.values()]
        .map((r) => ({ name: r.name, marks: r.marks, at: r.at, locked: !!r.pw }))
        .sort((a, b) => a.at - b.at);
      return json(200, { v, plan, responses });
    }
    if (path === 'image' && request.method === 'GET') {
      const img = decodeDataUrl(await s.get('image'));
      if (!img) return json(404, { error: 'No picture.' });
      return new Response(img.bytes, { headers: { 'content-type': img.type, 'cache-control': 'public, max-age=31536000, immutable' } });
    }
    if ((path === 'respond' || path === 'forget') && request.method === 'POST') {
      const raw = await request.text();
      if (raw.length > 64000) return json(413, { error: 'Too much.' });
      let body;
      try { body = JSON.parse(raw); } catch { return json(400, { error: 'Bad request.' }); }
      const r = validateResponse(body);
      if (!r.ok) return json(400, { error: r.error });
      const key = `r:${nameKey(r.name)}`;
      const prev = await s.get(key);
      if (prev?.pw) {
        const pw = await hashPassword(r.password, prev.salt);
        if (pw !== prev.pw) return json(403, { error: `"${prev.name}" is password-protected. Enter its password, or use a different name.` });
      }
      if (path === 'forget') {
        if (prev) await s.delete(key);
      } else {
        if (!prev && (await s.list({ prefix: 'r:' })).size >= MAX_RESPONSES) return json(429, { error: 'This plan is full.' });
        const salt = prev?.salt || crypto.randomUUID();
        const pw = prev?.pw || (r.password ? await hashPassword(r.password, salt) : null);
        await s.put(key, { name: prev?.name || r.name, marks: r.marks, at: prev?.at || Date.now(), pw, salt });
      }
      await s.put('v', ((await s.get('v')) || 1) + 1);
      return json(200, { ok: true });
    }
    return json(404, { error: 'Not found.' });
  }
}
