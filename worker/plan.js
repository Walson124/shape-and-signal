import { DurableObject } from 'cloudflare:workers';
import { validateResponse, nameKey, hashPassword, decodeDataUrl, isShadePlan, MAX_RESPONSES } from './plan-protocol.js';

// One Whereto plan: a Durable Object per plan id, keeping the plan, its uploaded map
// picture and everyone's marks in its own storage. The Worker forwards these requests:
//   POST /create             (internal) store a new, already validated plan
//   GET  /                   the plan and all responses (?v=N answers {same:true} if unchanged)
//   GET  /image              the uploaded map picture
//   POST /respond            { name, password?, marks | strokes } add or replace your marks
//   POST /forget             { name, password? } remove your response
//   POST /delete             { key } the creator deletes the whole plan
//
// A plan nobody has opened for KEEP_MS deletes itself (an alarm wipes its storage), so old
// trips don't pile up.

export const KEEP_MS = 60 * 24 * 60 * 60 * 1000;   // 60 days without a visit
const TOUCH_MS = 6 * 60 * 60 * 1000;                // note visits at most this often

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export class Plan extends DurableObject {
  // PLAN_KEEP_MS only exists so a local test server can shorten the wait
  get keepMs() { return Number(this.env?.PLAN_KEEP_MS) || KEEP_MS; }

  // push the self-delete date back after a visit (cheaply: at most every few hours)
  async touch(force = false) {
    const s = this.ctx.storage, now = Date.now();
    const seen = await s.get('seen');
    if (!force && seen && now - seen < Math.min(TOUCH_MS, this.keepMs / 4)) return;
    await s.put('seen', now);
    await s.setAlarm(now + this.keepMs);
  }

  async wipe() {
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }

  async alarm() {
    const s = this.ctx.storage;
    const plan = await s.get('plan');
    if (!plan) { await this.wipe(); return; }
    const last = (await s.get('seen')) || plan.created || 0;
    if (Date.now() < last + this.keepMs) await s.setAlarm(last + this.keepMs);
    else await this.wipe();
  }

  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/+/, '');
    const s = this.ctx.storage;
    if (path === 'create' && request.method === 'POST') {
      if (await s.get('plan')) return json(409, { error: 'Taken.' });
      const { plan, image } = await request.json();
      // the creator's browser keeps this key; only its hash is stored
      const key = crypto.randomUUID().replace(/-/g, '');
      const salt = crypto.randomUUID();
      await s.put({ plan: { ...plan, created: Date.now() }, v: 1, owner: { hash: await hashPassword(key, salt), salt } });
      if (image) await s.put('image', image);
      await this.touch(true);
      return json(200, { ok: true, key });
    }
    const plan = await s.get('plan');
    if (!plan) return json(404, { error: 'No plan here. Check the link?' });

    if (path === 'delete' && request.method === 'POST') {
      let body;
      try { body = JSON.parse(await request.text()); } catch { return json(400, { error: 'Bad request.' }); }
      const owner = await s.get('owner');
      const key = typeof body?.key === 'string' ? body.key.slice(0, 64) : '';
      if (!owner || !key || (await hashPassword(key, owner.salt)) !== owner.hash) return json(403, { error: 'Only the person who made this plan can delete it.' });
      await this.wipe();
      return json(200, { ok: true });
    }

    if (path === '' && request.method === 'GET') {
      await this.touch();
      const v = (await s.get('v')) || 1;
      if (Number(url.searchParams.get('v')) === v) return json(200, { same: true, v });
      const rows = await s.list({ prefix: 'r:' });
      const responses = [...rows.values()]
        .map((r) => ({ name: r.name, marks: r.marks, ...(r.strokes ? { strokes: r.strokes } : {}), at: r.at, locked: !!r.pw }))
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
      if (raw.length > 200_000) return json(413, { error: 'Too much.' });
      let body;
      try { body = JSON.parse(raw); } catch { return json(400, { error: 'Bad request.' }); }
      const r = validateResponse(body, plan);
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
        const row = { name: prev?.name || r.name, marks: r.marks, at: prev?.at || Date.now(), pw, salt };
        if (isShadePlan(plan)) row.strokes = r.strokes;
        await s.put(key, row);
      }
      await s.put('v', ((await s.get('v')) || 1) + 1);
      await this.touch();
      return json(200, { ok: true });
    }
    return json(404, { error: 'Not found.' });
  }
}
