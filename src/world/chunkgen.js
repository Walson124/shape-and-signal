import { makeTerrain, cubeToSphere, craterOffset } from './terrain.js';

// Builds one terrain chunk of a cube-sphere quadtree. Pure (runs in workers).
const terrains = new Map();
export function getTerrain(params) {
  let t = terrains.get(params.key);
  if (!t) {
    t = makeTerrain(params);
    terrains.set(params.key, t);
    if (terrains.size > 24) terrains.delete(terrains.keys().next().value);
  }
  return t;
}

const indexCache = new Map();
export function chunkIndex(res) {
  if (indexCache.has(res)) return indexCache.get(res);
  const n = res + 1;
  const idx = [];
  const v = (i, j) => j * n + i;
  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) {
      const a = v(i, j), b = v(i + 1, j), c = v(i, j + 1), d = v(i + 1, j + 1);
      idx.push(a, b, d, a, d, c);
    }
  }
  const base = n * n;
  const edges = [
    Array.from({ length: n }, (_, i) => v(i, 0)),
    Array.from({ length: n }, (_, i) => v(i, res)),
    Array.from({ length: n }, (_, j) => v(0, j)),
    Array.from({ length: n }, (_, j) => v(res, j)),
  ];
  edges.forEach((edge, e) => {
    for (let k = 0; k < res; k++) {
      const a = edge[k], b = edge[k + 1];
      const sa = base + e * n + k, sb = base + e * n + k + 1;
      idx.push(a, b, sb, a, sb, sa, a, sb, b, a, sa, sb);
    }
  });
  const arr = (n * n + 4 * n) > 65535 ? new Uint32Array(idx) : new Uint16Array(idx);
  indexCache.set(res, arr);
  return arr;
}

function hash4(a, b, c, d) {
  let h = 2166136261;
  for (const v of [a, b, c, d]) {
    h ^= v & 0xffff; h = Math.imul(h, 16777619);
    h ^= v >>> 16; h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildChunk({ params, face, level, x, y, res, props, craters }) {
  const burnOut = [0];
  const B = craters && craters.length ? new Float64Array((res + 3) * (res + 3)) : null;
  const T = getTerrain(params);
  const R = params.radius;
  const n = res + 1, N = n + 2;
  const P = new Float64Array(N * N * 3);
  const D = new Float64Array(N * N * 3);
  const H = new Float64Array(N * N);
  const scale = 1 / (1 << level);
  const d3 = [0, 0, 0];
  let minH = Infinity, maxH = -Infinity;
  for (let j = -1; j <= n; j++) {
    for (let i = -1; i <= n; i++) {
      const s = -1 + 2 * (x + i / res) * scale;
      const t = -1 + 2 * (y + j / res) * scale;
      cubeToSphere(face, s, t, d3);
      let h = T.height(d3[0], d3[1], d3[2]);
      const k = (j + 1) * N + (i + 1);
      if (B) {
        h += craterOffset(d3[0], d3[1], d3[2], craters, burnOut);
        B[k] = burnOut[0];
      }
      D[k * 3] = d3[0]; D[k * 3 + 1] = d3[1]; D[k * 3 + 2] = d3[2];
      H[k] = h;
      const rr = R + h;
      P[k * 3] = d3[0] * rr; P[k * 3 + 1] = d3[1] * rr; P[k * 3 + 2] = d3[2] * rr;
      if (i >= 0 && i < n && j >= 0 && j < n) { if (h < minH) minH = h; if (h > maxH) maxH = h; }
    }
  }
  const ck = (Math.floor(res / 2) + 1) * N + (Math.floor(res / 2) + 1);
  const cx = P[ck * 3], cy = P[ck * 3 + 1], cz = P[ck * 3 + 2];
  const total = n * n + 4 * n;
  const positions = new Float32Array(total * 3);
  const normals = new Float32Array(total * 3);
  const colors = new Float32Array(total * 3);
  const glow = new Float32Array(total);
  const ppos = new Float32Array(total * 3);
  const col = [0, 0, 0, 0];
  let maxR2 = 0;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = (j + 1) * N + (i + 1);
      const ax = P[(k + 1) * 3] - P[(k - 1) * 3], ay = P[(k + 1) * 3 + 1] - P[(k - 1) * 3 + 1], az = P[(k + 1) * 3 + 2] - P[(k - 1) * 3 + 2];
      const bx = P[(k + N) * 3] - P[(k - N) * 3], by = P[(k + N) * 3 + 1] - P[(k - N) * 3 + 1], bz = P[(k + N) * 3 + 2] - P[(k - N) * 3 + 2];
      let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
      const nl = Math.hypot(nx, ny, nz) || 1;
      nx /= nl; ny /= nl; nz /= nl;
      const dx = D[k * 3], dy = D[k * 3 + 1], dz = D[k * 3 + 2];
      if (nx * dx + ny * dy + nz * dz < 0) { nx = -nx; ny = -ny; nz = -nz; }
      const slope = Math.max(0, 1 - (nx * dx + ny * dy + nz * dz));
      T.color(dx, dy, dz, H[k], Math.min(1, slope * 4), col);
      if (B && B[k] > 0) {
        // scorched, churned earth in and around a crater
        const b = B[k];
        col[0] = col[0] * (1 - 0.7 * b) + 0.05 * b;
        col[1] = col[1] * (1 - 0.75 * b) + 0.035 * b;
        col[2] = col[2] * (1 - 0.8 * b) + 0.025 * b;
      }
      const o = j * n + i;
      const px = P[k * 3] - cx, py = P[k * 3 + 1] - cy, pz = P[k * 3 + 2] - cz;
      positions[o * 3] = px; positions[o * 3 + 1] = py; positions[o * 3 + 2] = pz;
      ppos[o * 3] = P[k * 3]; ppos[o * 3 + 1] = P[k * 3 + 1]; ppos[o * 3 + 2] = P[k * 3 + 2];
      normals[o * 3] = nx; normals[o * 3 + 1] = ny; normals[o * 3 + 2] = nz;
      colors[o * 3] = col[0]; colors[o * 3 + 1] = col[1]; colors[o * 3 + 2] = col[2];
      glow[o] = col[3];
      const r2 = px * px + py * py + pz * pz;
      if (r2 > maxR2) maxR2 = r2;
    }
  }
  const arc = (Math.PI / 2) * R * scale;
  const skirt = arc * 0.04 + 3;
  const edges = [
    (k) => [k, 0], (k) => [k, res], (k) => [0, k], (k) => [res, k],
  ];
  edges.forEach((f, e) => {
    for (let k = 0; k < n; k++) {
      const [i, j] = f(k);
      const src = j * n + i;
      const dst = n * n + e * n + k;
      const g = (j + 1) * N + (i + 1);
      positions[dst * 3] = positions[src * 3] - D[g * 3] * skirt;
      positions[dst * 3 + 1] = positions[src * 3 + 1] - D[g * 3 + 1] * skirt;
      positions[dst * 3 + 2] = positions[src * 3 + 2] - D[g * 3 + 2] * skirt;
      normals[dst * 3] = normals[src * 3]; normals[dst * 3 + 1] = normals[src * 3 + 1]; normals[dst * 3 + 2] = normals[src * 3 + 2];
      colors[dst * 3] = colors[src * 3]; colors[dst * 3 + 1] = colors[src * 3 + 1]; colors[dst * 3 + 2] = colors[src * 3 + 2];
      glow[dst] = glow[src];
      ppos[dst * 3] = positions[dst * 3] + cx; ppos[dst * 3 + 1] = positions[dst * 3 + 1] + cy; ppos[dst * 3 + 2] = positions[dst * 3 + 2] + cz;
    }
  });

  let propData = null;
  if (props) {
    const G = Math.max(3, Math.min(14, Math.round(arc / 5)));
    const list = [];
    for (let cj = 0; cj < G; cj++) {
      for (let ci = 0; ci < G; ci++) {
        const r = rng(hash4(params.seed ^ face, level * 4096 + x, y, cj * 64 + ci));
        const u = (ci + r()) / G, w = (cj + r()) / G;
        const s = -1 + 2 * (x + u) * scale, t = -1 + 2 * (y + w) * scale;
        cubeToSphere(face, s, t, d3);
        if (craters && craters.length) {
          craterOffset(d3[0], d3[1], d3[2], craters, burnOut);
          if (burnOut[0] > 0) continue;
        }
        const h = T.height(d3[0], d3[1], d3[2]);
        const e = 0.6 / R;
        const hx = T.height(d3[0] + e, d3[1], d3[2]) - h, hz = T.height(d3[0], d3[1], d3[2] + e) - h;
        const slope = Math.min(1, Math.hypot(hx, hz) / 0.6 * 0.5);
        const type = T.prop(d3[0], d3[1], d3[2], h, slope, r());
        if (type < 0) continue;
        const rr = R + h - 0.3;
        list.push(type, d3[0] * rr - cx, d3[1] * rr - cy, d3[2] * rr - cz, 0.7 + r() * 0.7, r() * Math.PI * 2);
      }
    }
    propData = new Float32Array(list);
  }
  return { positions, normals, colors, glow, ppos, center: [cx, cy, cz], radius: Math.sqrt(maxR2) + skirt, minH, maxH, props: propData };
}
