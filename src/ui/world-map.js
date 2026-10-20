import * as THREE from 'three';

// The map of the world under your feet: the real terrain, coloured and hill-shaded,
// seen from straight above you (north up), with its cities, the sites you've found or
// heard of, other cultivators, and you. Three zooms, from half the world to your valley.

export const ZOOMS = [
  { id: 'world', label: 'World', s: 1.4 },
  { id: 'region', label: 'Region', s: 0.35 },
  { id: 'local', label: 'Local', s: 0.08 },
];
const N = 128;          // terrain samples across the map
const SIZE = 560;       // pixels on screen
const KIND = {
  ruin: ['Ancient Ruins', '#ffc857', '◆'], spring: ['Energy Spring', '#7affd8', '✦'], ore: ['Star Metal', '#3ef2ff', '⬢'],
  nest: ['Beast Nest', '#ff6a7a', '✖'], wreck: ['Wreck', '#c8d0dc', '▲'], lair: ['Overlord Lair', '#ff3c64', '☠'],
  obelisk: ['Trial Obelisk', '#b98cff', '▮'], camp: ['Hunters Camp', '#ffb070', '⌂'],
};
const cache = new Map();
const lin2srgb = (c) => Math.round(255 * Math.min(1, Math.max(0, c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055)));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// the view: centred above you, north up
function frameOf(up) {
  const Y = new THREE.Vector3(0, 1, 0);
  let n = Y.clone().addScaledVector(up, -Y.dot(up));
  if (n.lengthSq() < 1e-6) n = new THREE.Vector3(0, 0, -1).addScaledVector(up, -up.z);
  n.normalize();
  const e = new THREE.Vector3().crossVectors(n, up).normalize();
  return { u: up, e, n };
}

// a unit direction for a point on the map (px, py in -1..1, y down)
function dirAt(F, s, px, py, out) {
  return out.copy(F.u).addScaledVector(F.e, px * s).addScaledVector(F.n, -py * s).normalize();
}

// where a unit direction lands on the map, or null if it's out of view
export function project(F, s, d) {
  const z = d.dot(F.u);
  if (z <= 0.02) return null;
  const x = d.dot(F.e) / z / s, y = -d.dot(F.n) / z / s;
  if (Math.abs(x) > 1.04 || Math.abs(y) > 1.04) return null;
  return [(x * 0.5 + 0.5) * SIZE, (y * 0.5 + 0.5) * SIZE];
}

function terrainImage(planet, F, s, key) {
  if (cache.has(key)) return cache.get(key);
  const t = planet.terrain;
  const h = new Float32Array(N * N);
  const col = new Float32Array(N * N * 3);
  const d = new THREE.Vector3(), out = [0, 0, 0, 0];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    dirAt(F, s, (i + 0.5) / N * 2 - 1, (j + 0.5) / N * 2 - 1, d);
    const hh = t.height(d.x, d.y, d.z);
    h[j * N + i] = hh;
    t.color(d.x, d.y, d.z, hh, 0, out);
    col.set([out[0], out[1], out[2]], (j * N + i) * 3);
  }
  // light from the north-west: slopes facing it brighten, the far side darkens
  const cell = (planet.R * 2 * Math.atan(s)) / N;
  const img = new ImageData(N, N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = j * N + i;
    const hx = h[j * N + Math.min(N - 1, i + 1)] - h[j * N + Math.max(0, i - 1)];
    const hy = h[Math.min(N - 1, j + 1) * N + i] - h[Math.max(0, j - 1) * N + i];
    const water = t.sea !== null && h[k] < t.sea;
    let r = col[k * 3], gg = col[k * 3 + 1], b = col[k * 3 + 2];
    if (water) {
      // water reads as water on a map: blue, darker the deeper it gets
      const depth = Math.min(1, (t.sea - h[k]) / Math.max(1, t.amp * 0.08));
      r = 0.03 - 0.02 * depth; gg = 0.13 - 0.08 * depth; b = 0.26 - 0.13 * depth;
    }
    const shade = water ? 1 : THREE.MathUtils.clamp(1 - (hx + hy) / (cell * 2) * 0.9, 0.45, 1.5);
    img.data[k * 4] = lin2srgb(r * shade);
    img.data[k * 4 + 1] = lin2srgb(gg * shade);
    img.data[k * 4 + 2] = lin2srgb(b * shade);
    img.data[k * 4 + 3] = 255;
  }
  const c = document.createElement('canvas');
  c.width = c.height = N;
  c.getContext('2d').putImageData(img, 0, 0);
  if (cache.size > 12) cache.delete(cache.keys().next().value);
  cache.set(key, c);
  return c;
}

// Fill the map's canvas and return its SVG overlay (cities, sites, players, you).
export function drawWorldMap(game, canvas, zoomIndex) {
  const f = game.frame;
  const zoom = ZOOMS[zoomIndex] || ZOOMS[1];
  const s = zoom.s;
  const p = game.player;
  const up = p.pos.clone().normalize();
  const F = frameOf(up);
  // the terrain image only re-renders after you've moved a good way across it
  const q = (v) => Math.round(v * 400 / s);
  const key = `${f.body.id}:${zoom.id}:${q(up.x)},${q(up.y)},${q(up.z)}`;
  const g = canvas.getContext('2d');
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(terrainImage(f, F, s, key), 0, 0, SIZE, SIZE);
  // a soft edge
  const vg = g.createRadialGradient(SIZE / 2, SIZE / 2, SIZE * 0.35, SIZE / 2, SIZE / 2, SIZE * 0.72);
  vg.addColorStop(0, 'rgba(2,6,12,0)'); vg.addColorStop(1, 'rgba(2,6,12,0.65)');
  g.fillStyle = vg; g.fillRect(0, 0, SIZE, SIZE);

  const svg = [];
  const st = game.state;
  const label = (x, y, text, cls, dy = -12) => svg.push(`<text x="${x.toFixed(1)}" y="${(y + dy).toFixed(1)}" class="wm-label ${cls}">${esc(text)}</text>`);
  // cities, towns and outposts
  for (const site of f.allSites()) {
    const at = project(F, s, new THREE.Vector3(site.x, site.y, site.z).normalize());
    if (!at) continue;
    const big = site.size === 'capital' || site.main, mid = site.size === 'city';
    const r = big ? 7 : mid ? 5.5 : 4;
    svg.push(`<rect x="${(at[0] - r).toFixed(1)}" y="${(at[1] - r).toFixed(1)}" width="${r * 2}" height="${r * 2}" transform="rotate(45 ${at[0].toFixed(1)} ${at[1].toFixed(1)})" class="wm-city ${big ? 'big' : ''}"/>`);
    if (big || mid || zoomIndex > 0) label(at[0], at[1], site.name, big ? 'big' : '');
  }
  // sites you've found, and ones you've only heard about
  for (const poi of f.body.pois || []) {
    const found = st.discovered.includes(poi.id), rumor = st.rumors && st.rumors.includes(poi.id);
    if (!found && !rumor) continue;
    const at = project(F, s, (Array.isArray(poi.dir) ? new THREE.Vector3().fromArray(poi.dir) : poi.dir.clone()).normalize());
    if (!at) continue;
    const [name, color, glyph] = KIND[poi.kind] || ['Site', '#ffffff', '•'];
    const done = st.explored.includes(poi.id);
    svg.push(`<text x="${at[0].toFixed(1)}" y="${(at[1] + 5).toFixed(1)}" class="wm-poi" fill="${found ? color : '#9aa4b2'}" opacity="${done ? 0.5 : 1}">${found ? glyph : '?'}</text>`);
    if (zoomIndex > 0) label(at[0], at[1], found ? name : 'Rumoured site', 'poi', -10);
  }
  // other cultivators
  for (const o of game.net ? game.net.peers.values() : []) {
    if (!o.at) continue;
    const at = project(F, s, o.at.clone().normalize());
    if (!at) continue;
    svg.push(`<circle cx="${at[0].toFixed(1)}" cy="${at[1].toFixed(1)}" r="4.5" class="wm-peer"/>`);
    label(at[0], at[1], o.name, 'peer', -9);
  }
  // you: an arrow pointing the way you face
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(p.quat);
  const ang = Math.atan2(fwd.dot(F.e), fwd.dot(F.n)) * 180 / Math.PI;
  svg.push(`<g transform="translate(${SIZE / 2} ${SIZE / 2}) rotate(${ang.toFixed(1)})"><path d="M0,-11 L7,8 L0,4 L-7,8 Z" class="wm-me"/></g>`);
  // scale bar: a round number of metres about a fifth of the map wide
  const metresPerPx = (f.R * Math.atan(s) * 2) / SIZE;
  const want = metresPerPx * SIZE * 0.2;
  const mag = Math.pow(10, Math.floor(Math.log10(want)));
  const nice = [1, 2, 5, 10].map((m) => m * mag).find((v) => v >= want * 0.6) || mag * 10;
  const bar = nice / metresPerPx;
  svg.push(`<g class="wm-scale"><line x1="20" y1="${SIZE - 22}" x2="${(20 + bar).toFixed(1)}" y2="${SIZE - 22}"/><text x="20" y="${SIZE - 30}">${nice >= 1000 ? `${nice / 1000} KM` : `${nice} M`}</text></g>`);
  svg.push(`<text x="${SIZE / 2}" y="18" class="wm-north">N</text>`);
  return svg.join('');
}

export const MAP_SIZE = SIZE;
