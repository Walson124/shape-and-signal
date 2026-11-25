import { esc, toast } from '../platform/shell.js';
import { BUILTINS, gridName } from './maps.js';
import { api, rememberPlan, recentPlans, forgetPlan, deletePlan, KIND } from './common.js';
import { searchPlaces } from './geocode.js';

// The "new plan" page: what kind of plan, a name, and a map: the real map (people shade
// areas), a built-in one, or an uploaded picture with spots drawn on it, a grid over it, or
// free shading.

const $ = (id) => document.getElementById(id);
const MAX_SIDE = 1600;
const MAX_CHARS = 1_400_000;

const state = { kind: 'travel', map: 'geo', img: null, editMode: 'spots', spots: [], cols: 16, sel: null, touchedTitle: false, view: null };
let spotSeq = 0;

export function showCreate() {
  $('create').classList.remove('hidden');
  renderKinds();
  renderMaps();
  renderRecent();
  $('title').addEventListener('input', () => { state.touchedTitle = true; });
}

function renderKinds() {
  const box = $('kinds');
  const paint = () => {
    for (const b of box.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.kind === state.kind));
    $('title').placeholder = KIND[state.kind].placeholder;
  };
  box.onclick = (e) => {
    const b = e.target.closest('[data-kind]');
    if (!b) return;
    state.kind = b.dataset.kind;
    // steer the map to something that fits, unless they've uploaded one
    if (!state.img) state.map = 'geo';
    paint();
    renderMaps();
  };
  paint();
}

function renderMaps() {
  const box = $('maps');
  const opts = [...Object.entries(BUILTINS).filter(([, m]) => !m.hidden), ['upload', { label: 'Upload your own', blurb: 'Floor plans, campus maps, anything.' }]];
  box.innerHTML = opts.map(([id, m]) => `
    <button type="button" data-map="${id}" aria-pressed="${state.map === id}" class="${id === 'upload' ? 'up' : ''} ${m.kinds && !m.kinds.includes(state.kind) ? 'dim' : ''}">
      <span class="mthumb m-${id}" aria-hidden="true"></span>
      <b>${esc(m.label)}</b><span class="muted small">${esc(m.blurb)}</span>
    </button>`).join('');
  box.onclick = (e) => {
    const b = e.target.closest('[data-map]');
    if (!b) return;
    state.map = b.dataset.map;
    renderMaps();
  };
  $('upload').classList.toggle('hidden', state.map !== 'upload');
  $('geo-start').classList.toggle('hidden', state.map !== 'geo');
}

// the real map can start zoomed in on a place
$('geo-find').addEventListener('click', findStart);
$('geo-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); findStart(); } });
async function findStart() {
  const q = $('geo-q').value.trim();
  const out = $('geo-picked');
  if (!q) { state.view = null; out.textContent = 'The map will start on the whole world.'; return; }
  out.textContent = 'Searching…';
  let found = [];
  try { found = await searchPlaces(q); } catch { /* offline */ }
  if (!found.length) { state.view = null; out.textContent = `Couldn't find "${q}". The map will start on the whole world.`; return; }
  const [w, s, e, n] = found[0].bbox;
  state.view = [Math.max(-180, w), Math.max(-85, s), Math.min(180, e), Math.min(85, n)];
  out.textContent = `Starts at: ${found[0].name}`;
}

// ------------------------------------------------------------------ upload + editor

$('file').addEventListener('change', (e) => { const f = e.target.files?.[0]; if (f) loadFile(f); e.target.value = ''; });
$('replace-img').addEventListener('click', () => $('file').click());
const drop = $('drop');
drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => {
  e.preventDefault();
  drop.classList.remove('over');
  const f = e.dataTransfer.files?.[0];
  if (f) loadFile(f);
});

async function loadFile(file) {
  if (!file.type.startsWith('image/')) { toast('That isn\'t a picture'); return; }
  let bmp;
  try { bmp = await createImageBitmap(file); } catch { toast('Couldn\'t read that picture'); return; }
  let scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  let url, w, h;
  for (let tries = 0; tries < 6; tries++) {
    w = Math.max(16, Math.round(bmp.width * scale));
    h = Math.max(16, Math.round(bmp.height * scale));
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bmp, 0, 0, w, h);
    url = cv.toDataURL('image/jpeg', 0.86 - tries * 0.06);
    if (url.length <= MAX_CHARS) break;
    scale *= 0.8;
  }
  if (url.length > MAX_CHARS) { toast('That picture is too large'); return; }
  state.img = { url, w, h };
  state.spots = [];
  state.sel = null;
  $('drop').classList.add('hidden');
  $('editor').classList.remove('hidden');
  if (!state.touchedTitle && !$('title').value) $('title').value = file.name.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ').slice(0, 80);
  renderEditor();
}

$('edit-mode').addEventListener('click', (e) => {
  const b = e.target.closest('[data-v]');
  if (!b) return;
  state.editMode = b.dataset.v;
  renderEditor();
});
$('grid-cols').addEventListener('input', (e) => { state.cols = Number(e.target.value); renderEditor(); });

const rowsFor = (cols) => Math.max(2, Math.min(40, Math.round(cols * state.img.h / state.img.w)));

function renderEditor() {
  const { url, w, h } = state.img;
  for (const b of $('edit-mode').querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.v === state.editMode));
  const grid = state.editMode === 'grid';
  $('grid-ctl').classList.toggle('hidden', !grid);
  $('spot-list').classList.toggle('hidden', grid);
  $('edit-help').textContent = grid
    ? 'People will paint squares of this grid. Use this when there are no clear rooms or areas.'
    : state.editMode === 'shade'
      ? 'People will shade any part of the picture with a brush. Optional: draw and name boxes (rooms, buildings) so Whereto can name the best area.'
      : 'Drag on the picture to draw a box around each spot (a room, a building, an area), then name it below.';
  const stage = $('stage');
  stage.style.aspectRatio = `${w} / ${h}`;
  let overlay = '';
  if (grid) {
    const cols = state.cols, rows = rowsFor(cols);
    $('grid-size').textContent = `${cols} × ${rows} (${gridName(cols - 1, rows - 1)} is the last square)`;
    let lines = '';
    for (let c = 1; c < cols; c++) lines += `M${(c * w / cols).toFixed(1)} 0V${h}`;
    for (let r = 1; r < rows; r++) lines += `M0 ${(r * h / rows).toFixed(1)}H${w}`;
    overlay = `<path d="${lines}" class="gridlines"/>`;
  } else {
    overlay = state.spots.map((s) => `
      <g class="espot ${s.id === state.sel ? 'sel' : ''}" data-id="${s.id}">
        <rect x="${s.x * w}" y="${s.y * h}" width="${s.w * w}" height="${s.h * h}" rx="4"/>
        <text x="${(s.x + s.w / 2) * w}" y="${(s.y + s.h / 2) * h}" text-anchor="middle" dominant-baseline="central" font-size="${Math.max(12, Math.min(28, w / 50))}">${esc(s.name)}</text>
      </g>`).join('');
  }
  stage.innerHTML = `<img src="${url}" alt="" draggable="false"/><svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">${overlay}<rect class="ghost hidden" rx="4"/></svg>`;
  if (!grid) bindDraw(stage.querySelector('svg'));
  renderSpotList();
}

function bindDraw(svg) {
  const { w, h } = state.img;
  const ghost = svg.querySelector('.ghost');
  const at = (e) => {
    const r = svg.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };
  let start = null;
  svg.addEventListener('pointerdown', (e) => {
    const hit = e.target.closest('.espot');
    if (hit) { selectSpot(hit.dataset.id); return; }
    svg.setPointerCapture(e.pointerId);
    start = at(e);
    ghost.classList.remove('hidden');
  });
  svg.addEventListener('pointermove', (e) => {
    if (!start) return;
    const p = at(e);
    ghost.setAttribute('x', Math.min(start.x, p.x) * w);
    ghost.setAttribute('y', Math.min(start.y, p.y) * h);
    ghost.setAttribute('width', Math.abs(p.x - start.x) * w);
    ghost.setAttribute('height', Math.abs(p.y - start.y) * h);
  });
  const end = (e) => {
    if (!start) return;
    const p = at(e);
    const box = { x: Math.min(start.x, p.x), y: Math.min(start.y, p.y), w: Math.abs(p.x - start.x), h: Math.abs(p.y - start.y) };
    start = null;
    ghost.classList.add('hidden');
    if (box.w * w < 8 || box.h * h < 8) return;
    if (state.spots.length >= 200) { toast('That\'s the most spots a map can have'); return; }
    spotSeq++;
    const s = { id: `r${Date.now().toString(36)}${spotSeq}`, name: `Spot ${state.spots.length + 1}`, ...box };
    state.spots.push(s);
    state.sel = s.id;
    renderEditor();
    const input = document.querySelector(`#spot-list [data-id="${s.id}"] input`);
    input?.focus();
    input?.select();
  };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', () => { start = null; ghost.classList.add('hidden'); });
}

function selectSpot(id) {
  state.sel = id;
  for (const g of document.querySelectorAll('#stage .espot')) g.classList.toggle('sel', g.dataset.id === id);
  for (const li of document.querySelectorAll('#spot-list li')) li.classList.toggle('sel', li.dataset.id === id);
  document.querySelector(`#spot-list [data-id="${id}"] input`)?.focus();
}

function renderSpotList() {
  const list = $('spot-list');
  if (!state.spots.length) { list.innerHTML = `<li class="empty muted small">No spots yet. Drag on the picture to add one${state.editMode === 'shade' ? ' (optional)' : ''}.</li>`; return; }
  list.innerHTML = state.spots.map((s, i) => `
    <li data-id="${s.id}" class="${s.id === state.sel ? 'sel' : ''}">
      <span class="mono muted">${i + 1}</span>
      <input class="input" value="${esc(s.name)}" maxlength="40" aria-label="Spot name" />
      <button type="button" class="btn small ghost" data-del="${s.id}" aria-label="Remove spot">✕</button>
    </li>`).join('');
  list.oninput = (e) => {
    const li = e.target.closest('li[data-id]');
    const s = state.spots.find((x) => x.id === li?.dataset.id);
    if (!s) return;
    s.name = e.target.value;
    const t = document.querySelector(`#stage .espot[data-id="${s.id}"] text`);
    if (t) t.textContent = s.name;
  };
  list.onclick = (e) => {
    const del = e.target.closest('[data-del]');
    if (del) {
      state.spots = state.spots.filter((s) => s.id !== del.dataset.del);
      renderEditor();
      return;
    }
    const li = e.target.closest('li[data-id]');
    if (li) selectSpot(li.dataset.id);
  };
}

// ------------------------------------------------------------------ submit

$('create-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('create-error');
  err.classList.add('hidden');
  const fail = (text) => { err.textContent = text; err.classList.remove('hidden'); };
  const title = $('title').value.trim();
  if (!title) { $('title').focus(); fail('Give the plan a name.'); return; }
  let map;
  if (state.map === 'upload') {
    if (!state.img) { fail('Upload a picture of your map, or pick one of ours.'); return; }
    const { url, w, h } = state.img;
    if (state.editMode === 'shade') {
      const named = state.spots.map((s, i) => ({ ...s, name: s.name.trim() || `Spot ${i + 1}` }));
      map = { type: 'image', img: url, w, h, spots: named, shade: true };
    } else if (state.editMode === 'spots') {
      if (!state.spots.length) { fail('Draw at least one spot on the picture, or switch to "Paint a grid".'); return; }
      const named = state.spots.map((s, i) => ({ ...s, name: s.name.trim() || `Spot ${i + 1}` }));
      map = { type: 'image', img: url, w, h, spots: named };
    } else {
      map = { type: 'image', img: url, w, h, spots: [], grid: { cols: state.cols, rows: rowsFor(state.cols) } };
    }
  } else if (state.map === 'geo') {
    map = { type: 'geo', view: state.view };
  } else {
    map = { type: 'builtin', id: state.map };
  }
  const btn = $('create-btn');
  btn.disabled = true;
  btn.textContent = 'Creating…';
  try {
    const { id, key } = await api('POST', '/api/plan', { title, note: $('note').value.trim(), kind: state.kind, map });
    rememberPlan(id, title, key);
    location.href = `?p=${id}`;
  } catch (ex) {
    fail(ex.message);
    btn.disabled = false;
    btn.textContent = 'Create plan';
  }
});

function renderRecent() {
  const list = recentPlans();
  $('recent').classList.toggle('hidden', !list.length);
  $('recent-list').innerHTML = list.map((p) => `<li>
    <a href="?p=${encodeURIComponent(p.id)}">${esc(p.title)}</a>
    <span class="muted small">${p.key ? 'yours · ' : ''}${new Date(p.at).toLocaleDateString()}</span>
    ${p.key
    ? `<button type="button" class="linkish danger small" data-del="${esc(p.id)}">Delete</button>`
    : `<button type="button" class="linkish small" data-hide="${esc(p.id)}" aria-label="Remove from this list">Remove</button>`}
  </li>`).join('');
}

$('recent-list').addEventListener('click', async (e) => {
  const del = e.target.closest('[data-del]')?.dataset.del;
  const hide = e.target.closest('[data-hide]')?.dataset.hide;
  if (hide) { forgetPlan(hide); renderRecent(); return; }
  if (!del) return;
  const p = recentPlans().find((x) => x.id === del);
  if (!confirm(`Delete "${p?.title || 'this plan'}" for everyone? This can't be undone.`)) return;
  try { await deletePlan(del); toast('Plan deleted'); } catch (ex) {
    // already gone (expired or deleted elsewhere): just tidy the list
    if (ex.status === 404) forgetPlan(del); else { toast(ex.message, 3500); return; }
  }
  renderRecent();
});
