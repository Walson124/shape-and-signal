// Whereto plans: what a new plan and a response may contain, and their clean forms.
// Pure functions with no Cloudflare APIs, so the tests can run them directly.
//
// A plan is a map everyone marks up:
//   - a built-in map (world countries, US states, a sample office), where each person marks
//     the spots that work for them (2) or would do if needed (1);
//   - an uploaded picture with spots drawn on it, or a grid over it, marked the same way;
//   - a real, zoomable world map ("geo") or an uploaded picture with `shade: true`, where
//     people shade areas freely with a brush. A response is then a list of strokes.

export const BUILTIN_MAPS = new Set(['world', 'cities', 'usa', 'office']);
export const KINDS = new Set(['travel', 'meet', 'other']);
export const MAX_IMAGE = 1_500_000;         // characters of data URL
export const MAX_SPOTS = 200;
export const MAX_GRID = 40;                 // cells per side
export const MAX_MARKS = 1600;
export const MAX_RESPONSES = 100;
export const MAX_STROKES = 300;
export const MAX_POINTS = 4000;             // across all of one person's strokes

const SPOT_ID = /^[A-Za-z0-9:_,.-]{1,40}$/;
const IMAGE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/;

export const cleanText = (raw, max) => String(raw ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);

const frac = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, Math.round(v * 10000) / 10000)) : null);

export function cleanPlanId(raw) {
  const s = String(raw ?? '');
  return /^[a-z0-9]{8,16}$/.test(s) ? s : null;
}

export function newPlanId() {
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(bytes, (b) => abc[b % abc.length]).join('');
}

// spots on an uploaded image: rectangles in 0..1 fractions of the picture
function cleanSpots(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [], seen = new Set();
  for (const s of raw.slice(0, MAX_SPOTS)) {
    if (!s || typeof s !== 'object') continue;
    const id = SPOT_ID.test(s.id) ? s.id : null;
    const name = cleanText(s.name, 40);
    const x = frac(s.x), y = frac(s.y), w = frac(s.w), h = frac(s.h);
    if (!id || seen.has(id) || !name || [x, y, w, h].includes(null) || w < 0.002 || h < 0.002) continue;
    seen.add(id);
    out.push({ id, name, x, y, w: Math.min(w, 1 - x), h: Math.min(h, 1 - y) });
  }
  return out;
}

// { ok, plan, image } or { ok: false, error }
export function validatePlan(body) {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Bad request.' };
  const title = cleanText(body.title, 80);
  if (!title) return { ok: false, error: 'Give the plan a name.' };
  const note = cleanText(body.note, 280);
  const kind = KINDS.has(body.kind) ? body.kind : 'other';
  const m = body.map;
  if (!m || typeof m !== 'object') return { ok: false, error: 'Pick a map.' };
  if (m.type === 'geo') {
    // optional starting view: [west, south, east, north]
    const b = Array.isArray(m.view) && m.view.length === 4 && m.view.every((x) => typeof x === 'number' && Number.isFinite(x)) ? m.view : null;
    const view = b && b[0] >= -180 && b[2] <= 180 && b[1] >= -85 && b[3] <= 85 && b[0] < b[2] && b[1] < b[3]
      ? b.map((x) => Math.round(x * 1e4) / 1e4) : null;
    return { ok: true, plan: { title, note, kind, map: { type: 'geo', view } }, image: null };
  }
  if (m.type === 'builtin') {
    if (!BUILTIN_MAPS.has(m.id)) return { ok: false, error: 'Unknown map.' };
    return { ok: true, plan: { title, note, kind, map: { type: 'builtin', id: m.id } }, image: null };
  }
  if (m.type === 'image') {
    const img = typeof m.img === 'string' ? m.img : '';
    if (!img) return { ok: false, error: 'Upload a picture of the map.' };
    if (img.length > MAX_IMAGE) return { ok: false, error: 'That picture is too large.' };
    if (!IMAGE.test(img)) return { ok: false, error: 'That file is not a picture we can use.' };
    const iw = Math.round(Number(m.w)), ih = Math.round(Number(m.h));
    if (!(iw >= 16 && ih >= 16 && iw <= 4096 && ih <= 4096)) return { ok: false, error: 'Bad picture size.' };
    const spots = cleanSpots(m.spots);
    const shade = m.shade === true;
    let grid = null;
    if (!spots.length && !shade) {
      const cols = Math.round(Number(m.grid?.cols)), rows = Math.round(Number(m.grid?.rows));
      if (!(cols >= 2 && rows >= 2 && cols <= MAX_GRID && rows <= MAX_GRID)) return { ok: false, error: 'Draw some spots or choose a grid.' };
      grid = { cols, rows };
    }
    return { ok: true, plan: { title, note, kind, map: { type: 'image', w: iw, h: ih, spots, grid, ...(shade ? { shade: true } : {}) } }, image: img };
  }
  return { ok: false, error: 'Pick a map.' };
}

export const nameKey = (name) => name.toLowerCase();

// does this plan's map take shaded strokes (rather than marked spots)?
export const isShadePlan = (plan) => plan?.map?.type === 'geo' || plan?.map?.shade === true;

const num = (v, digits) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 10 ** digits) / 10 ** digits : null);

// Strokes: [{ v: 2 | 1 | 0 (erase), r, p: [x0, y0, x1, y1, ...] }], applied in order.
// On a geo map points are [lon, lat] and r is in meters; on a picture points are fractions
// of its width and height and r is a fraction of its width.
export function cleanStrokes(raw, plan) {
  if (!Array.isArray(raw)) return [];
  const geo = plan?.map?.type === 'geo';
  const [xMin, xMax, yMin, yMax] = geo ? [-180, 180, -85.06, 85.06] : [0, 1, 0, 1];
  const [rMin, rMax] = geo ? [20, 2_000_000] : [0.001, 0.4];
  const digits = geo ? 5 : 4;
  const out = [];
  let points = 0;
  for (const s of raw.slice(0, MAX_STROKES)) {
    if (!s || typeof s !== 'object' || !Array.isArray(s.p) || s.p.length < 2 || s.p.length % 2) continue;
    const v = s.v === 0 || s.v === 1 || s.v === 2 ? s.v : null;
    const r = num(s.r, geo ? 0 : 4);
    if (v === null || r === null || r < rMin || r > rMax) continue;
    const p = [];
    for (let i = 0; i < s.p.length && points + p.length / 2 < MAX_POINTS; i += 2) {
      const x = num(s.p[i], digits), y = num(s.p[i + 1], digits);
      if (x === null || y === null || x < xMin || x > xMax || y < yMin || y > yMax) continue;
      p.push(x, y);
    }
    if (!p.length) continue;
    points += p.length / 2;
    out.push({ v, r, p });
    if (points >= MAX_POINTS) break;
  }
  return out;
}

// { ok, name, marks, strokes, password } or { ok: false, error }
export function validateResponse(body, plan = null) {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Bad request.' };
  const name = cleanText(body.name, 24);
  if (!name) return { ok: false, error: 'Enter your name.' };
  const password = typeof body.password === 'string' ? body.password.slice(0, 64) : '';
  const marks = {};
  let n = 0;
  if (body.marks && typeof body.marks === 'object' && !Array.isArray(body.marks)) {
    for (const [k, v] of Object.entries(body.marks)) {
      if (n >= MAX_MARKS) break;
      if (!SPOT_ID.test(k) || (v !== 1 && v !== 2)) continue;
      marks[k] = v;
      n++;
    }
  }
  const strokes = isShadePlan(plan) ? cleanStrokes(body.strokes, plan) : [];
  return { ok: true, name, marks, strokes, password };
}

export async function hashPassword(password, salt) {
  const data = new TextEncoder().encode(`${salt}:${password}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function decodeDataUrl(url) {
  const m = /^data:(image\/[a-z]+);base64,(.*)$/.exec(url || '');
  if (!m) return null;
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { type: m[1], bytes };
}
