import { esc, toast, copyText, css, savedName, saveName } from '../platform/shell.js';
import { loadMap } from './maps.js';
import { MapView } from './map-view.js';
import { rank, tally, verdict } from './score.js';
import { analyze, toPlane, fromPlane, whoAt, missingFrom, strokeCounts, planeToMeters } from './shade.js';
import { api, KIND, rememberPlan, forgetPlan, ownerKey, deletePlan, myIdentity, saveIdentity } from './common.js';

// A plan's page: the map, your picks, everyone's overlap and the best spots.
// Spot plans mark whole spots; shaded plans (a real map, or a picture with shade: true)
// paint strokes with a brush, and the best areas come from shade.js.

const $ = (id) => document.getElementById(id);
const POLL_MS = 5000;

const P = {
  id: null, plan: null, v: 0, responses: [], def: null, view: null, spotsById: new Map(),
  me: null,               // { name, password }
  marks: {},              // my marks: spotId -> 1 | 2
  mode: 'group',          // mine | group
  tool: 'yes',
  peek: null,             // a person whose picks the group map is showing
  dirty: false, saving: false, saveTimer: 0,
  // shaded plans
  shade: false, surface: null, strokes: [], live: null, brushPx: 20,
  analysis: null, focus: 0, names: new Map(),
};
const isShade = (plan) => plan?.map?.type === 'geo' || plan?.map?.shade === true;

export async function showPlan(id) {
  P.id = id;
  let data;
  try {
    data = await api('GET', `/api/plan/${encodeURIComponent(id)}`);
  } catch (e) {
    if (e.status === 404) { forgetPlan(id); $('missing').classList.remove('hidden'); return; }
    $('missing').classList.remove('hidden');
    $('missing').querySelector('h1').textContent = 'Couldn\'t load this plan';
    $('missing').querySelector('p').textContent = e.message;
    return;
  }
  P.plan = data.plan;
  P.v = data.v;
  P.responses = data.responses;
  rememberPlan(id, P.plan.title);
  document.title = `${P.plan.title} · Whereto`;
  $('plan').classList.remove('hidden');
  renderHead();

  const who = myIdentity(id);
  if (who?.name) {
    P.me = who;
    const mine = findResponse(who.name);
    P.marks = { ...(mine?.marks || {}) };
    P.strokes = [...(mine?.strokes || [])];
    P.mode = 'mine';
  } else {
    $('me-name').value = savedName();
    P.mode = P.responses.length ? 'group' : 'mine';
  }
  renderMe();

  P.shade = isShade(P.plan);
  $('brush-ctl').classList.toggle('hidden', !P.shade);
  const narrow = window.innerWidth < 600;
  try {
    if (P.plan.map.type === 'geo') {
      const { GeoView } = await import('./geo-view.js');
      P.def = { spots: [], w: 1, h: 1 };
      P.surface = { kind: 'geo' };
      $('map-stage').innerHTML = '';
      $('map-stage').style.aspectRatio = narrow ? '0.95' : '1.6';
      P.view = new GeoView($('map-stage'), { view: P.plan.map.view, brush, onHover: (pt, x, y) => hoverAt(pt, x, y) });
    } else {
      P.def = await loadMap(P.plan, `/api/plan/${encodeURIComponent(id)}/image`);
    }
  } catch {
    $('map-stage').innerHTML = '<div class="loading muted">Couldn\'t load the map. Reload to try again.</div>';
    return;
  }
  P.spotsById = new Map(P.def.spots.map((s) => [s.id, s]));
  if (!P.view) {
    $('map-stage').innerHTML = '';
    P.view = new MapView($('map-stage'), P.def, P.shade ? {
      brush,
      onHover: (sid, x, y) => hoverAt(x == null ? null : P.view.surfaceAt(x, y), x, y),
    } : {
      onPaintStart: paintStart,
      onPaint: paint,
      onHover: hover,
      onClick: (sid) => { if (P.mode === 'group') P.view.highlight([sid]); },
    });
    if (P.shade) P.surface = { kind: 'image', aspect: P.def.h / P.def.w };
    $('map-stage').classList.toggle('kind-image', !!P.def.overlay);
    // frame the map at roughly its own shape (squarer on phones, where pinch-zoom does the rest)
    const ratio = P.def.w / P.def.h;
    $('map-stage').style.aspectRatio = String(narrow ? Math.max(1.1, Math.min(1.4, ratio)) : Math.max(1.3, Math.min(2, ratio)));
  }
  setBrush(P.brushPx);
  setMode(P.mode);
  setTool(P.tool);
  renderAll();
  setInterval(poll, POLL_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
  window.addEventListener('themechange', () => paintMap());
  window.addEventListener('beforeunload', (e) => { if (P.dirty) { save(); e.preventDefault(); } });
}

const findResponse = (name) => P.responses.find((r) => r.name.toLowerCase() === String(name).trim().toLowerCase());
const kind = () => KIND[P.plan.kind] || KIND.other;

function renderHead() {
  $('plan-kind').textContent = kind().label;
  $('plan-name').textContent = P.plan.title;
  $('plan-note').textContent = P.plan.note || kind().question;
  $('lbl-yes').textContent = kind().yes;
  $('lbl-maybe').textContent = kind().maybe;
  $('delete-plan').classList.toggle('hidden', !ownerKey(P.id));
}

$('delete-plan').addEventListener('click', async () => {
  if (!confirm(`Delete "${P.plan.title}" for everyone? Everyone's picks go with it. This can't be undone.`)) return;
  try { await deletePlan(P.id); } catch (ex) { toast(ex.message, 3500); return; }
  location.href = './';
});

$('copy-plan').addEventListener('click', async () => {
  const url = `${location.origin}${location.pathname}?p=${P.id}`;
  toast(await copyText(url) ? 'Link copied. Send it to the group!' : url, 3000);
});

// ------------------------------------------------------------------ who am I

$('signin').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('me-name').value.trim();
  const password = $('me-pw').value;
  const err = $('signin-error');
  err.classList.add('hidden');
  if (!name) { $('me-name').focus(); return; }
  const existing = findResponse(name);
  if (existing?.locked) {
    // check the password by saving their picks back unchanged
    try { await api('POST', `/api/plan/${P.id}/respond`, { name, password, marks: existing.marks, strokes: existing.strokes || [] }); } catch (ex) {
      err.textContent = ex.message;
      err.classList.remove('hidden');
      return;
    }
  }
  P.me = { name: existing?.name || name, password };
  P.marks = { ...(existing?.marks || {}) };
  P.strokes = [...(existing?.strokes || [])];
  saveIdentity(P.id, P.me);
  saveName(name);
  renderMe();
  setMode('mine');
  if (existing) toast(`Welcome back, ${P.me.name}`);
});

$('me-switch').addEventListener('click', async () => {
  if (P.dirty) await save();
  P.me = null;
  P.marks = {};
  P.strokes = [];
  saveIdentity(P.id, null);
  $('me-pw').value = '';
  renderMe();
  setMode('group');
});

$('me-clear').addEventListener('click', () => {
  if (!Object.keys(P.marks).length && !P.strokes.length) return;
  if (!confirm(P.shade ? 'Clear all your shading?' : 'Clear all your picks?')) return;
  P.marks = {};
  P.strokes = [];
  changed();
});

$('me-forget').addEventListener('click', async () => {
  if (!P.me || !confirm(`Remove ${P.me.name} from this plan?`)) return;
  try {
    await api('POST', `/api/plan/${P.id}/forget`, { name: P.me.name, password: P.me.password || '' });
  } catch (ex) { toast(ex.message, 3500); return; }
  P.dirty = false;
  P.responses = P.responses.filter((r) => r.name.toLowerCase() !== P.me.name.toLowerCase());
  P.me = null;
  P.marks = {};
  P.strokes = [];
  saveIdentity(P.id, null);
  renderMe();
  setMode('group');
  renderAll();
  toast('Removed');
});

function renderMe() {
  const on = !!P.me;
  $('signin').classList.toggle('hidden', on);
  $('me-box').classList.toggle('hidden', !on);
  $('me-title').textContent = on ? 'Your picks' : 'Add your picks';
  if (!on) return;
  $('me-who').textContent = P.me.name;
  const touch = matchMedia('(pointer: coarse)').matches;
  if (P.shade) {
    const [y, m] = strokeCounts(P.strokes);
    $('me-yes').textContent = `${y} ${kind().yes.toLowerCase()} ${y === 1 ? 'area' : 'areas'}`;
    $('me-maybe').textContent = `${m} ${kind().maybe.toLowerCase()}`;
    $('me-help').textContent = P.mode === 'mine'
      ? `Pick ${kind().yes} or ${kind().maybe} above the map, then drag over the places that suit you to shade them. Zoom in for detail${touch ? ' (pinch)' : ' (scroll)'}; move the map with ✋ Move${touch ? ' or two fingers' : ''}.${P.plan.map.type === 'geo' ? ' The search box jumps to any place.' : ''}`
      : 'Switch to "Your picks" above the map to change them.';
    return;
  }
  const vals = Object.values(P.marks);
  $('me-yes').textContent = `${vals.filter((v) => v === 2).length} ${kind().yes.toLowerCase()}`;
  $('me-maybe').textContent = `${vals.filter((v) => v === 1).length} ${kind().maybe.toLowerCase()}`;
  $('me-help').textContent = P.mode === 'mine'
    ? `Pick a brush above the map, then click or drag across spots. Drag with ✋ Move (or the right mouse button) to move the map${touch ? '; pinch to zoom' : '; scroll to zoom'}.`
    : 'Switch to "Your picks" above the map to change them.';
}

// ------------------------------------------------------------------ modes & tools

$('view-mode').addEventListener('click', (e) => { const b = e.target.closest('[data-v]'); if (b) setMode(b.dataset.v); });
$('tools').addEventListener('click', (e) => { const b = e.target.closest('[data-tool]'); if (b) setTool(b.dataset.tool); });

function setMode(mode) {
  P.mode = mode;
  P.peek = null;
  for (const b of $('view-mode').querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.v === mode));
  $('tools').classList.toggle('hidden', mode !== 'mine');
  $('legend').classList.toggle('hidden', mode !== 'group');
  if (P.view) {
    P.view.setPaintable(mode === 'mine' && !!P.me);
    P.view.setTool(mode === 'mine' && P.tool !== 'move' ? 'paint' : 'move');
    P.view.highlight?.([]);
  }
  if (mode === 'mine' && !P.me) {
    $('map-foot').textContent = 'Enter your name on the right to start picking.';
    setTimeout(() => $('me-name').focus(), 50);
  }
  renderMe();
  paintMap();
  renderFoot();
}

function setTool(tool) {
  P.tool = tool;
  for (const b of $('tools').querySelectorAll('[data-tool]')) b.setAttribute('aria-pressed', String(b.dataset.tool === tool));
  P.view?.setTool(tool === 'move' || P.mode !== 'mine' ? 'move' : 'paint');
}

// ------------------------------------------------------------------ shading (brush)

$('brush-size').addEventListener('click', (e) => { const b = e.target.closest('[data-size]'); if (b) setBrush(Number(b.dataset.size)); });
$('undo').addEventListener('click', () => {
  if (!P.strokes.length || !P.me) return;
  P.strokes.pop();
  changed();
});

function setBrush(px) {
  P.brushPx = px;
  for (const b of $('brush-size').querySelectorAll('[data-size]')) b.setAttribute('aria-pressed', String(Number(b.dataset.size) === px));
}

const MAX_STROKES = 300, MAX_POINTS = 4000;
const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;
const pointCount = () => P.strokes.reduce((n, s) => n + s.p.length / 2, 0);

const brush = {
  start(x, y) {
    if (!P.me || P.mode !== 'mine' || P.tool === 'move') return;
    if (P.strokes.length >= MAX_STROKES || pointCount() >= MAX_POINTS) { toast('That\'s a lot of shading. Undo or clear some to add more.', 3500); return; }
    const geo = P.surface.kind === 'geo';
    const r = geo
      ? Math.round(Math.min(2_000_000, Math.max(20, P.view.brushRadius(P.brushPx, y))))
      : round(Math.min(0.4, Math.max(0.001, P.view.brushRadius(P.brushPx))), 4);
    P.live = { v: P.tool === 'yes' ? 2 : P.tool === 'maybe' ? 1 : 0, r, p: [round(x, geo ? 5 : 4), round(y, geo ? 5 : 4)] };
    drawShade();
  },
  move(x, y) {
    const s = P.live;
    if (!s) return;
    // keep points a few pixels apart: smooth enough, and small to store
    const n = s.p.length;
    const [ax, ay] = P.view.toScreen(s.p[n - 2], s.p[n - 1]), [bx, by] = P.view.toScreen(x, y);
    if (Math.hypot(bx - ax, by - ay) < Math.max(3, P.brushPx / 4)) return;
    if (pointCount() + n / 2 >= MAX_POINTS) return;
    const d = P.surface.kind === 'geo' ? 5 : 4;
    s.p.push(round(x, d), round(y, d));
    drawShade();
  },
  end() {
    if (!P.live) return;
    P.strokes.push(P.live);
    P.live = null;
    changed();
  },
  cancel() { P.live = null; drawShade(); },
};

function drawShade() {
  if (!P.view || !P.shade) return;
  const yes = colorYes(), maybe = colorMaybe();
  if (P.mode === 'mine') { P.view.show({ mine: { strokes: P.strokes, yes, maybe }, live: P.live }); return; }
  if (P.peek) {
    const r = P.responses.find((x) => x.name === P.peek);
    P.view.show({ mine: { strokes: r?.strokes || [], yes, maybe } });
    return;
  }
  const people = P.responses.map((r) => r.strokes || []).filter((l) => l.some((s) => s.v));
  const reg = P.analysis?.regions[P.focus] || P.analysis?.regions[0];
  const marker = reg ? { plane: reg.center, r: Math.max(reg.bounds[2] - reg.bounds[0], reg.bounds[3] - reg.bounds[1]) * 0.6, color: css('--ink') } : null;
  P.view.show({ group: { people, color: css('--accent') }, marker });
}

// what's under the pointer (shaded plans)
function hoverAt(pt, x, y) {
  if (!pt || P.mode !== 'group' || P.peek || !P.analysis) { tip.classList.add('hidden'); return; }
  const here = whoAt(P.analysis, ...toPlane(P.surface, pt[0], pt[1]));
  if (!here.length) { tip.classList.add('hidden'); return; }
  const yes = here.filter((h) => h.v === 2).map((h) => h.name), maybe = here.filter((h) => h.v === 1).map((h) => h.name);
  const none = P.responses.map((r) => r.name).filter((n) => !here.some((h) => h.name === n));
  tip.innerHTML = `<b>${here.length} of ${P.responses.length} shaded here</b><div class="tip-body">
    ${yes.length ? `<div><span class="dot yes"></span>${esc(yes.join(', '))}</div>` : ''}
    ${maybe.length ? `<div><span class="dot maybe"></span>${esc(maybe.join(', '))}</div>` : ''}
    ${none.length ? `<div class="muted"><span class="dot"></span>${esc(none.join(', '))}</div>` : ''}</div>`;
  placeTip(x, y);
}

// a name for one of the best areas: what's there on a real map, or the drawn spot it's in
function regionName(reg) {
  if (P.surface.kind === 'geo') {
    const [lon, lat] = fromPlane(P.surface, ...reg.rep);
    const key = `${lon.toFixed(2)},${lat.toFixed(2)}`;
    if (P.names.has(key)) return P.names.get(key);
    P.names.set(key, null);
    const meters = planeToMeters(Math.max(reg.bounds[2] - reg.bounds[0], reg.bounds[3] - reg.bounds[1]), reg.center[1]);
    // the representative point may be in the sea: try a few more points in the area
    const points = [reg.rep, ...(reg.samples || [])].map((q) => fromPlane(P.surface, ...q));
    import('./geocode.js').then(async ({ placeName }) => {
      for (const [x, y] of points.slice(0, 4)) { const nm = await placeName(x, y, meters); if (nm) return nm; }
      return null;
    }).then((name) => {
      P.names.set(key, name ? `Around ${name}` : `Near ${Math.abs(lat).toFixed(1)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(1)}°${lon >= 0 ? 'E' : 'W'}`);
      renderResults();
    });
    return null;
  }
  const fx = reg.rep[0], fy = reg.rep[1] / P.surface.aspect;
  const x = fx * P.def.w, y = fy * P.def.h;
  const spot = P.def.spots.find((s) => s.w && x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h);
  if (spot) return spot.name;
  const col = fx < 0.34 ? 'left' : fx > 0.66 ? 'right' : '', row = fy < 0.34 ? 'top' : fy > 0.66 ? 'bottom' : '';
  return `Area at the ${[row, col].filter(Boolean).join(' ') || 'middle'}`;
}

function focusRegion(i) {
  const reg = P.analysis?.regions[i];
  if (!reg) return;
  if (P.mode !== 'group') setMode('group');
  P.focus = i;
  if (P.surface.kind === 'geo') P.view.focus(reg.bounds);
  else P.view.focusPlane(reg.bounds);
  drawShade();
  $('map-stage').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

// ------------------------------------------------------------------ painting

function paintStart(id) {
  const cur = P.marks[id] || 0;
  if (P.tool === 'yes') return cur === 2 ? 0 : 2;
  if (P.tool === 'maybe') return cur === 1 ? 0 : 1;
  return 0;
}

function paint(id, value) {
  if (!P.me || P.mode !== 'mine') return;
  if ((P.marks[id] || 0) === value) return;
  if (value) P.marks[id] = value;
  else delete P.marks[id];
  styleMine(id);
  changed();
}

function changed() {
  P.dirty = true;
  $('save-state').textContent = 'Saving…';
  clearTimeout(P.saveTimer);
  P.saveTimer = setTimeout(save, 700);
  // show myself in the group results right away
  const mine = findResponse(P.me.name);
  if (mine) { mine.marks = { ...P.marks }; mine.strokes = [...P.strokes]; }
  else P.responses.push({ name: P.me.name, marks: { ...P.marks }, strokes: [...P.strokes], at: Date.now(), locked: !!P.me.password });
  renderMe();
  renderResults();
  if (P.shade) drawShade();
  else if (P.mode === 'mine') { if (!P.view) return; for (const id of P.spotsById.keys()) styleMine(id); }
  else paintMap();
}

async function save() {
  if (!P.me || !P.dirty || P.saving) return;
  P.saving = true;
  P.dirty = false;
  clearTimeout(P.saveTimer);
  try {
    await api('POST', `/api/plan/${P.id}/respond`, { name: P.me.name, password: P.me.password || '', marks: P.marks, ...(P.shade ? { strokes: P.strokes } : {}) });
    $('save-state').textContent = 'Saved ✓';
  } catch (ex) {
    $('save-state').textContent = 'Not saved';
    toast(ex.message, 4000);
    if (ex.status === 403) { P.me = null; saveIdentity(P.id, null); renderMe(); setMode('group'); }
    else P.dirty = true;
  } finally {
    P.saving = false;
    if (P.dirty) P.saveTimer = setTimeout(save, 1500);
  }
}

// ------------------------------------------------------------------ drawing the map

const colorYes = () => css('--good');
const colorMaybe = () => css('--warn');

function styleMine(id) {
  const v = P.marks[id];
  P.view.style(id, v === 2 ? colorYes() : v === 1 ? colorMaybe() : '', P.def.overlay ? 0.55 : 0.9);
}

function paintMap() {
  if (!P.view) return;
  if (P.shade) { drawShade(); return; }
  if (P.mode === 'mine') {
    for (const id of P.spotsById.keys()) styleMine(id);
    P.view.highlight([]);
    return;
  }
  if (P.peek) {
    const r = P.responses.find((x) => x.name === P.peek);
    for (const id of P.spotsById.keys()) {
      const v = r?.marks?.[id];
      P.view.style(id, v === 2 ? colorYes() : v === 1 ? colorMaybe() : '', P.def.overlay ? 0.55 : 0.9);
    }
    P.view.highlight([]);
    return;
  }
  const t = tally(P.def.spots, P.responses);
  const g = css('--accent');
  const all = [];
  for (const [id, s] of t) {
    if (!s.count) { P.view.style(id, ''); continue; }
    P.view.style(id, g, (P.def.overlay ? 0.12 : 0.18) + s.frac * (P.def.overlay ? 0.6 : 0.82));
    if (s.all) all.push(id);
  }
  P.view.root.querySelectorAll('.spot.all').forEach((el) => el.classList.remove('all'));
  for (const id of all) P.view.els.get(id)?.classList.add('all');
}

function renderFoot() {
  if (!P.def) return;
  const n = P.responses.length;
  if (P.shade) {
    if (P.mode === 'group') $('map-foot').textContent = n ? 'Darker means more people shaded it. The dashed circle marks the best area; hover to see who.' : 'Nobody has shaded anything yet.';
    else if (P.me) $('map-foot').textContent = 'Tip: the brush stays the same size on screen, so zoom in to shade small places.';
    return;
  }
  if (P.mode === 'group') $('map-foot').textContent = n ? `Stronger color means more people can do it. Outlined spots work for all ${n}.` : 'Nobody has added picks yet.';
  else if (P.me) $('map-foot').textContent = P.def.spots.length > 300 ? 'Tip: drag across squares to paint many at once.' : 'Tip: drag across spots to paint many at once.';
}

// ------------------------------------------------------------------ tooltips

const tip = $('tip');
function hover(id, x, y) {
  if (!id) { tip.classList.add('hidden'); return; }
  const s = P.spotsById.get(id);
  if (!s) return;
  let body = '';
  if (P.mode === 'mine') {
    const v = P.marks[id];
    body = v ? `<span class="pill ${v === 2 ? 'good' : 'warn'}">${v === 2 ? kind().yes : kind().maybe}</span>` : '';
  } else {
    const t = tally([s], P.responses).get(id);
    const none = P.responses.filter((r) => !r.marks?.[id]).map((r) => r.name);
    body = `${t.yes.length ? `<div><span class="dot yes"></span>${esc(t.yes.join(', '))}</div>` : ''}
      ${t.maybe.length ? `<div><span class="dot maybe"></span>${esc(t.maybe.join(', '))}</div>` : ''}
      ${none.length && P.responses.length ? `<div class="muted"><span class="dot"></span>${esc(none.join(', '))}</div>` : ''}`;
  }
  tip.innerHTML = `<b>${esc(s.name)}</b>${s.sub ? ` <span class="muted">${esc(s.sub)}</span>` : ''}${body ? `<div class="tip-body">${body}</div>` : ''}`;
  placeTip(x, y);
}

function placeTip(x, y) {
  tip.classList.remove('hidden');
  const r = tip.getBoundingClientRect();
  tip.style.left = `${Math.min(window.innerWidth - r.width - 8, x + 14)}px`;
  tip.style.top = `${Math.max(8, y - r.height - 10)}px`;
}

// ------------------------------------------------------------------ results

function renderAll() {
  renderResults();
  paintMap();
  renderFoot();
}

function renderResults() {
  if (P.shade) { renderShadeResults(); return; }
  const n = P.responses.length;
  const ranked = P.def ? rank(P.def.spots, P.responses) : [];
  // verdict
  const v = verdict(ranked, n);
  const box = $('verdict');
  if (v.kind === 'empty') box.innerHTML = `<div class="v-main"><span class="v-icon">👋</span><div><b>No picks yet.</b> <span class="muted">Add yours, then send the link to the group.</span></div></div>`;
  else if (v.kind === 'none') box.innerHTML = `<div class="v-main"><span class="v-icon">🤔</span><div><b>Nothing picked yet.</b> <span class="muted">${n} ${n === 1 ? 'person has' : 'people have'} joined but marked no spots.</span></div></div>`;
  else if (v.kind === 'all') box.innerHTML = `<div class="v-main"><span class="v-icon">🎯</span><div><div class="muted small">${n === 1 ? 'So far' : `Works for all ${n}`}</div><b class="v-top">${esc(v.top.name)}</b>${v.top.sub ? ` <span class="muted">${esc(v.top.sub)}</span>` : ''}
      <div class="small">${v.top.yes.length} ${esc(kind().yes.toLowerCase())}${v.top.maybe.length ? `, ${v.top.maybe.length} ${esc(kind().maybe.toLowerCase())}` : ''}${v.ties > 1 ? ` · tied with ${v.ties - 1} more` : ''}</div></div></div>
      <button class="btn small" data-focus="${esc(v.top.id)}">Show on map</button>`;
  else box.innerHTML = `<div class="v-main"><span class="v-icon">🧭</span><div><div class="muted small">No spot works for everyone yet. Closest:</div><b class="v-top">${esc(v.top.name)}</b>
      <div class="small">${v.top.count} of ${n} can do it · missing ${esc(P.responses.filter((r) => !r.marks?.[v.top.id]).map((r) => r.name).join(', '))}</div></div></div>
      <button class="btn small" data-focus="${esc(v.top.id)}">Show on map</button>`;

  // ranking
  const list = $('ranking');
  list.innerHTML = ranked.length ? ranked.slice(0, 12).map((t, i) => `
    <li data-id="${esc(t.id)}" class="${t.all ? 'all' : ''}">
      <span class="rk mono">${i + 1}</span>
      <div class="rinfo">
        <div class="rname">${esc(t.name)}${t.sub ? ` <span class="muted small">${esc(t.sub)}</span>` : ''}${t.all ? ' <span class="pill good">everyone</span>' : ''}</div>
        <div class="rbar"><i class="y" style="width:${(t.yes.length / n) * 100}%"></i><i class="m" style="width:${(t.maybe.length / n) * 100}%"></i></div>
      </div>
      <span class="rcount mono">${t.count}/${n}</span>
    </li>`).join('') : '<li class="empty muted small">Spots show up here once people pick them.</li>';

  // people
  $('people-count').textContent = n ? `· ${n}` : '';
  $('people').innerHTML = n ? P.responses.map((r) => {
    const c = Object.keys(r.marks || {}).length;
    const me = P.me && r.name.toLowerCase() === P.me.name.toLowerCase();
    return `<li data-name="${esc(r.name)}" class="${P.peek === r.name ? 'on' : ''}"><span class="pname">${esc(r.name)}${me ? ' <span class="muted">(you)</span>' : ''}${r.locked ? ' <span title="Password protected">🔒</span>' : ''}</span><span class="muted small">${c} ${c === 1 ? 'pick' : 'picks'}</span></li>`;
  }).join('') : '<li class="empty muted small">Nobody yet. Be the first!</li>';
}

function renderShadeResults() {
  const n = P.responses.length;
  P.analysis = P.surface ? analyze(P.responses, P.surface) : null;
  const regions = P.analysis?.regions || [];
  if (P.focus >= regions.length) P.focus = 0;
  const name = (r) => regionName(r) || 'Finding the place name…';
  const box = $('verdict');
  const top = regions[0];
  if (!n) box.innerHTML = `<div class="v-main"><span class="v-icon">👋</span><div><b>No shading yet.</b> <span class="muted">Shade the areas that work for you, then send the link to the group.</span></div></div>`;
  else if (!top) box.innerHTML = `<div class="v-main"><span class="v-icon">🤔</span><div><b>Nothing shaded yet.</b> <span class="muted">${n} ${n === 1 ? 'person has' : 'people have'} joined but shaded nothing.</span></div></div>`;
  else if (top.all) box.innerHTML = `<div class="v-main"><span class="v-icon">🎯</span><div><div class="muted small">${n === 1 ? 'So far' : `Works for all ${n}`}</div><b class="v-top">${esc(name(top))}</b>
      <div class="small">${top.yes.length} ${esc(kind().yes.toLowerCase())}${top.maybe.length ? `, ${top.maybe.length} ${esc(kind().maybe.toLowerCase())}` : ''}</div></div></div>
      <button class="btn small" data-area="0">Show on map</button>`;
  else box.innerHTML = `<div class="v-main"><span class="v-icon">🧭</span><div><div class="muted small">No area works for everyone yet. Closest:</div><b class="v-top">${esc(name(top))}</b>
      <div class="small">${top.count} of ${n} shaded it · missing ${esc(missingFrom(top, P.responses).join(', '))}</div></div></div>
      <button class="btn small" data-area="0">Show on map</button>`;

  $('ranking-title').textContent = 'Best areas';
  $('ranking').innerHTML = regions.length ? regions.map((t, i) => `
    <li data-area="${i}" class="${t.all ? 'all' : ''}">
      <span class="rk mono">${i + 1}</span>
      <div class="rinfo">
        <div class="rname">${esc(name(t))}${t.all ? ' <span class="pill good">everyone</span>' : ''}</div>
        <div class="rbar"><i class="y" style="width:${(t.yes.length / n) * 100}%"></i><i class="m" style="width:${(t.maybe.length / n) * 100}%"></i></div>
      </div>
      <span class="rcount mono">${t.count}/${n}</span>
    </li>`).join('') : '<li class="empty muted small">The best areas show up here once people shade.</li>';

  $('people-count').textContent = n ? `· ${n}` : '';
  $('people').innerHTML = n ? P.responses.map((r) => {
    const c = (r.strokes || []).filter((s) => s.v).length;
    const me = P.me && r.name.toLowerCase() === P.me.name.toLowerCase();
    return `<li data-name="${esc(r.name)}" class="${P.peek === r.name ? 'on' : ''}"><span class="pname">${esc(r.name)}${me ? ' <span class="muted">(you)</span>' : ''}${r.locked ? ' <span title="Password protected">🔒</span>' : ''}</span><span class="muted small">${c ? `${c} ${c === 1 ? 'area' : 'areas'}` : 'nothing yet'}</span></li>`;
  }).join('') : '<li class="empty muted small">Nobody yet. Be the first!</li>';
}

$('verdict').addEventListener('click', (e) => {
  const a = e.target.closest('[data-area]'); if (a) { focusRegion(Number(a.dataset.area)); return; }
  const b = e.target.closest('[data-focus]'); if (b) focusSpot(b.dataset.focus);
});
$('ranking').addEventListener('click', (e) => {
  const a = e.target.closest('li[data-area]'); if (a) { focusRegion(Number(a.dataset.area)); return; }
  const li = e.target.closest('li[data-id]'); if (li) focusSpot(li.dataset.id);
});

function focusSpot(id) {
  if (P.mode !== 'group') setMode('group');
  P.view?.focus(id);
  P.view?.highlight([id]);
  $('map-stage').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

const people = $('people');
people.addEventListener('pointerover', (e) => { const li = e.target.closest('li[data-name]'); if (li && e.pointerType !== 'touch' && P.mode === 'group') peek(li.dataset.name); });
people.addEventListener('pointerleave', (e) => { if (e.pointerType !== 'touch' && P.mode === 'group') peek(null); });
people.addEventListener('click', (e) => { const li = e.target.closest('li[data-name]'); if (li) peek(P.peek === li.dataset.name ? null : li.dataset.name); });

function peek(name) {
  if (P.peek === name) return;
  if (name && P.mode !== 'group') setMode('group');
  P.peek = name;
  for (const li of people.querySelectorAll('li[data-name]')) li.classList.toggle('on', li.dataset.name === name);
  $('map-foot').textContent = name ? `Showing ${name}'s picks.` : '';
  if (!name) renderFoot();
  paintMap();
}

// ------------------------------------------------------------------ live updates

async function poll() {
  if (document.hidden || P.saving || P.dirty) return;
  let data;
  try { data = await api('GET', `/api/plan/${P.id}?v=${P.v}`); } catch { return; }
  if (data.same || P.dirty) return;
  P.v = data.v;
  P.responses = data.responses;
  if (P.me) {
    const mine = findResponse(P.me.name);
    if (mine) { P.marks = { ...mine.marks }; P.strokes = [...(mine.strokes || [])]; }
  }
  renderMe();
  renderResults();
  paintMap();
  renderFoot();
}
