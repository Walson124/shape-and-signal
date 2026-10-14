import { perlin } from './terrain.js';
import { getTerrain } from './chunkgen.js';

// Diggable terrain. The planet is a heightfield; wherever it has been blasted
// (or where you are underground) it is rebuilt as cubes of real volume, so
// holes, tunnels and hidden caves exist. Pure functions: run in workers.
//
// Density convention: positive = solid rock, negative = air.

export const CELL = 24; // metres per cell side
export const VOX = 0.75; // metres per voxel
export const N = CELL / VOX; // voxels per side

const lin = (c) => Math.pow(c / 255, 2.2);
const DIRT = [lin(92), lin(68), lin(46)];
const ROCK = [lin(86), lin(82), lin(78)];
const DEEP = [lin(58), lin(56), lin(60)];
const VEIN = [0.15, 0.55, 0.85];

// Winding tunnels: where two noise fields are both near zero. Only below
// `depth` 5 m, so they never break the surface by themselves.
export function caveDensity(x, y, z, depth) {
  if (depth < 4) return 99;
  const s = 0.017;
  const a = perlin(x * s, y * s, z * s);
  const b = perlin(x * s + 31.7, y * s - 12.1, z * s + 7.3);
  const tunnel = (Math.max(Math.abs(a), Math.abs(b)) - 0.075) * 55;
  // big chambers, rarer and deeper
  const c = perlin(x * 0.006 + 5.1, y * 0.006, z * 0.006 - 3.3);
  const chamber = depth > 14 ? (0.42 - c) * 90 : 99;
  return Math.max(Math.min(tunnel, chamber), 5 - depth);
}

// Dug holes are spheres of air.
function digDensity(x, y, z, digs) {
  let d = 99;
  if (!digs) return d;
  for (let i = 0; i < digs.length; i++) {
    const g = digs[i];
    const dx = x - g[0], dy = y - g[1], dz = z - g[2];
    const v = Math.sqrt(dx * dx + dy * dy + dz * dz) - g[3];
    if (v < d) d = v;
  }
  return d;
}

// Exact density at a point (main thread queries).
export function density(T, R, x, y, z, digs) {
  const L = Math.sqrt(x * x + y * y + z * z);
  const h = T.height(x / L, y / L, z / L);
  const depth = R + h - L;
  return Math.min(depth, caveDensity(x, y, z, depth), digDensity(x, y, z, digs));
}

// Build one cell's mesh with surface nets. cell: integer [cx, cy, cz].
export function buildVoxelCell({ params, cell, digs }) {
  const T = getTerrain(params);
  const R = params.radius;
  const S = N + 3; // samples per axis, one margin each side plus the far edge
  const ox = cell[0] * CELL - VOX, oy = cell[1] * CELL - VOX, oz = cell[2] * CELL - VOX;
  const cxw = cell[0] * CELL + CELL / 2, cyw = cell[1] * CELL + CELL / 2, czw = cell[2] * CELL + CELL / 2;
  // heights on a 2D grid in the tangent plane at the cell centre, interpolated
  // per sample: far cheaper than a terrain lookup for every voxel
  const cl = Math.hypot(cxw, cyw, czw);
  const ux = cxw / cl, uy = cyw / cl, uz = czw / cl;
  let ex = -uz, ey = 0, ez = ux;
  if (Math.abs(uy) > 0.9) { ex = 1; ey = 0; ez = 0; }
  let el = Math.hypot(ex, ey, ez); ex /= el; ey /= el; ez /= el;
  const nx = uy * ez - uz * ey, ny = uz * ex - ux * ez, nz = ux * ey - uy * ex;
  const HG = 13, span = CELL * 1.2, step = span / (HG - 1);
  const HM = new Float64Array(HG * HG);
  for (let j = 0; j < HG; j++) {
    for (let i = 0; i < HG; i++) {
      const u = -span / 2 + i * step, v = -span / 2 + j * step;
      const px = cxw + ex * u + nx * v, py = cyw + ey * u + ny * v, pz = czw + ez * u + nz * v;
      const pl = Math.hypot(px, py, pz);
      HM[j * HG + i] = T.height(px / pl, py / pl, pz / pl);
    }
  }
  const heightAt = (px, py, pz) => {
    const dx = px - cxw, dy = py - cyw, dz = pz - czw;
    const u = (dx * ex + dy * ey + dz * ez + span / 2) / step;
    const v = (dx * nx + dy * ny + dz * nz + span / 2) / step;
    const i = Math.max(0, Math.min(HG - 2, Math.floor(u))), j = Math.max(0, Math.min(HG - 2, Math.floor(v)));
    const fu = Math.max(0, Math.min(1, u - i)), fv = Math.max(0, Math.min(1, v - j));
    const a = HM[j * HG + i], b = HM[j * HG + i + 1], c = HM[(j + 1) * HG + i], d = HM[(j + 1) * HG + i + 1];
    return a + (b - a) * fu + (c - a) * fv + (a - b - c + d) * fu * fv;
  };
  const V = new Float32Array(S * S * S);
  const DEP = new Float32Array(S * S * S);
  let pos = 0, neg = 0;
  for (let k = 0; k < S; k++) {
    for (let j = 0; j < S; j++) {
      for (let i = 0; i < S; i++) {
        const x = ox + i * VOX, y = oy + j * VOX, z = oz + k * VOX;
        const L = Math.sqrt(x * x + y * y + z * z);
        const depth = R + heightAt(x, y, z) - L;
        const v = Math.min(depth, caveDensity(x, y, z, depth), digDensity(x, y, z, digs));
        const idx = (k * S + j) * S + i;
        V[idx] = v;
        DEP[idx] = depth;
        if (v > 0) pos++; else neg++;
      }
    }
  }
  const empty = { positions: new Float32Array(0), normals: new Float32Array(0), colors: new Float32Array(0), glow: new Float32Array(0), ppos: new Float32Array(0), index: new Uint32Array(0), center: [cxw, cyw, czw], veins: [] };
  if (!pos || !neg) return empty;
  const at = (i, j, k) => V[(k * S + j) * S + i];
  // one vertex per cube that the surface passes through
  const C = S - 1;
  const vid = new Int32Array(C * C * C).fill(-1);
  const P = [], Nn = [], Cc = [], Gl = [], PP = [];
  const veins = [];
  const corner = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const cv = new Float32Array(8);
  for (let k = 0; k < C; k++) {
    for (let j = 0; j < C; j++) {
      for (let i = 0; i < C; i++) {
        let mask = 0;
        for (let c = 0; c < 8; c++) {
          cv[c] = at(i + corner[c][0], j + corner[c][1], k + corner[c][2]);
          if (cv[c] > 0) mask |= 1 << c;
        }
        if (mask === 0 || mask === 255) continue;
        let sx = 0, sy = 0, sz = 0, n = 0;
        for (const [a, b] of edges) {
          const va = cv[a], vb = cv[b];
          if ((va > 0) === (vb > 0)) continue;
          const t = va / (va - vb);
          sx += corner[a][0] + (corner[b][0] - corner[a][0]) * t;
          sy += corner[a][1] + (corner[b][1] - corner[a][1]) * t;
          sz += corner[a][2] + (corner[b][2] - corner[a][2]) * t;
          n++;
        }
        const x = ox + (i + sx / n) * VOX, y = oy + (j + sy / n) * VOX, z = oz + (k + sz / n) * VOX;
        // outward normal is down the density gradient
        let gx = (cv[1] + cv[3] + cv[5] + cv[7]) - (cv[0] + cv[2] + cv[4] + cv[6]);
        let gy = (cv[2] + cv[3] + cv[6] + cv[7]) - (cv[0] + cv[1] + cv[4] + cv[5]);
        let gz = (cv[4] + cv[5] + cv[6] + cv[7]) - (cv[0] + cv[1] + cv[2] + cv[3]);
        const gl = Math.hypot(gx, gy, gz) || 1;
        gx = -gx / gl; gy = -gy / gl; gz = -gz / gl;
        vid[(k * C + j) * C + i] = P.length / 3;
        P.push(x - cxw, y - cyw, z - czw);
        PP.push(x, y, z);
        Nn.push(gx, gy, gz);
        // colour: the original surface, then dirt, then rock, deep rock and veins
        const L = Math.sqrt(x * x + y * y + z * z);
        const dx = x / L, dy = y / L, dz = z / L;
        const depth = DEP[(k * S + j) * S + i];
        const upness = gx * dx + gy * dy + gz * dz;
        let col;
        let glow = 0;
        if (depth < 1.2 && upness > 0.55) {
          const out = [0, 0, 0, 0];
          T.color(dx, dy, dz, L - R, Math.min(1, (1 - upness) * 4), out);
          col = [out[0], out[1], out[2]];
          glow = out[3];
        } else {
          // layered rock: strata bands by depth, grain and cracks so walls read
          const grain = 0.75 + 0.5 * (0.5 + 0.5 * perlin(x * 0.35, y * 0.35, z * 0.35));
          const strata = 0.82 + 0.18 * Math.sin(depth * 1.3 + perlin(x * 0.05, y * 0.05, z * 0.05) * 6);
          const crack = Math.abs(perlin(x * 0.6 + 3.3, y * 0.6, z * 0.6)) < 0.04 ? 0.55 : 1;
          const base = depth < 4 ? DIRT : depth > 12 ? DEEP : ROCK;
          const k = grain * strata * crack;
          col = [base[0] * k, base[1] * k, base[2] * k];
          const vein = perlin(x * 0.11 + 9.1, y * 0.11, z * 0.11 - 4.2);
          if (depth > 8 && vein > 0.5) {
            col = VEIN;
            glow = 0.6;
            if (veins.length < 3 && vein > 0.56 && Math.abs(upness) < 0.6) veins.push([x, y, z, -gx, -gy, -gz]);
          }
        }
        Cc.push(col[0], col[1], col[2]);
        Gl.push(glow);
      }
    }
  }
  // quads across every sign-changing edge whose base sample lies in this cell
  const I = [];
  const cube = (i, j, k) => (i < 0 || j < 0 || k < 0 || i >= C || j >= C || k >= C ? -1 : vid[(k * C + j) * C + i]);
  const quad = (a, b, c, d, flip) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) I.push(a, c, b, a, d, c);
    else I.push(a, b, c, a, c, d);
  };
  for (let k = 1; k <= N; k++) {
    for (let j = 1; j <= N; j++) {
      for (let i = 1; i <= N; i++) {
        const v0 = at(i, j, k);
        const solid = v0 > 0;
        if (solid !== at(i + 1, j, k) > 0) quad(cube(i, j - 1, k - 1), cube(i, j, k - 1), cube(i, j, k), cube(i, j - 1, k), !solid);
        if (solid !== at(i, j + 1, k) > 0) quad(cube(i - 1, j, k - 1), cube(i - 1, j, k), cube(i, j, k), cube(i, j, k - 1), !solid);
        if (solid !== at(i, j, k + 1) > 0) quad(cube(i - 1, j - 1, k), cube(i, j - 1, k), cube(i, j, k), cube(i - 1, j, k), !solid);
      }
    }
  }
  return {
    positions: new Float32Array(P), normals: new Float32Array(Nn), colors: new Float32Array(Cc), glow: new Float32Array(Gl), ppos: new Float32Array(PP),
    index: new Uint32Array(I), center: [cxw, cyw, czw], veins,
  };
}
