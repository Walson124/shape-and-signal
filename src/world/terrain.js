// Pure terrain functions shared by the main thread (collision, placement)
// and the chunk workers (mesh generation). Everything works on unit
// direction vectors from the planet centre and returns metres.

function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const P = new Uint8Array(512);
{
  const r = mulberry32(2025);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    const t = p[i]; p[i] = p[j]; p[j] = t;
  }
  for (let i = 0; i < 512; i++) P[i] = p[i & 255];
}

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
function grad(h, x, y, z) {
  const u = h < 8 ? x : y;
  const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
  return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
}

// Improved Perlin noise, roughly in [-1, 1].
export function perlin(x, y, z) {
  const fx = Math.floor(x), fy = Math.floor(y), fz = Math.floor(z);
  const X = fx & 255, Y = fy & 255, Z = fz & 255;
  x -= fx; y -= fy; z -= fz;
  const u = fade(x), v = fade(y), w = fade(z);
  const A = P[X] + Y, AA = P[A] + Z, AB = P[A + 1] + Z;
  const B = P[X + 1] + Y, BA = P[B] + Z, BB = P[B + 1] + Z;
  const l = (t, a, b) => a + t * (b - a);
  return l(w,
    l(v, l(u, grad(P[AA] & 15, x, y, z), grad(P[BA] & 15, x - 1, y, z)), l(u, grad(P[AB] & 15, x, y - 1, z), grad(P[BB] & 15, x - 1, y - 1, z))),
    l(v, l(u, grad(P[AA + 1] & 15, x, y, z - 1), grad(P[BA + 1] & 15, x - 1, y, z - 1)), l(u, grad(P[AB + 1] & 15, x, y - 1, z - 1), grad(P[BB + 1] & 15, x - 1, y - 1, z - 1))));
}

export function fbm(x, y, z, oct) {
  let v = 0, a = 0.5, f = 1;
  for (let i = 0; i < oct; i++) {
    v += a * perlin(x * f, y * f, z * f);
    f *= 2.03;
    a *= 0.5;
  }
  return v;
}

export function ridged(x, y, z, oct) {
  let v = 0, a = 0.5, f = 1, w = 1;
  for (let i = 0; i < oct; i++) {
    let s = 1 - Math.abs(perlin(x * f, y * f, z * f));
    s *= s * w;
    w = Math.min(1, s * 2);
    v += a * s;
    f *= 2.1;
    a *= 0.5;
  }
  return v;
}

function cellHash(x, y, z, k) {
  return P[(P[(P[(x + k) & 255] + y) & 255] + z) & 255] / 255;
}

// Distance to the nearest feature point in a jittered 3D grid (Worley F1).
export function worley(x, y, z) {
  const fx = Math.floor(x), fy = Math.floor(y), fz = Math.floor(z);
  let best = 9;
  let bestR = 0;
  for (let k = -1; k <= 1; k++) for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const cx = fx + i, cy = fy + j, cz = fz + k;
    const px = cx + cellHash(cx, cy, cz, 0), py = cy + cellHash(cx, cy, cz, 71), pz = cz + cellHash(cx, cy, cz, 151);
    const d = (px - x) ** 2 + (py - y) ** 2 + (pz - z) ** 2;
    if (d < best) { best = d; bestR = cellHash(cx, cy, cz, 33); }
  }
  return [Math.sqrt(best), bestR];
}

const smooth = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const mix = (a, b, t) => a + (b - a) * t;
const lin = (c) => Math.pow(c / 255, 2.2);
const hexLin = (h) => [lin((h >> 16) & 255), lin((h >> 8) & 255), lin(h & 255)];
function mixC(out, a, b, t) {
  out[0] = a[0] + (b[0] - a[0]) * t;
  out[1] = a[1] + (b[1] - a[1]) * t;
  out[2] = a[2] + (b[2] - a[2]) * t;
}

const PAL = {
  terran: { deep: hexLin(0x1c2a2a), sand: hexLin(0xc9b78a), grass: hexLin(0x4c7a2e), forest: hexLin(0x2c4f1f), dry: hexLin(0x9a8a52), rock: hexLin(0x6e665c), snow: hexLin(0xf1f4f8), dirt: hexLin(0x6a5434) },
  desert: { sand: hexLin(0xd9a066), dune: hexLin(0xe8b878), rock: hexLin(0x9a4e2c), dark: hexLin(0x6a3420) },
  ice: { snow: hexLin(0xeef6ff), ice: hexLin(0x9fd0f0), crack: hexLin(0x3a78b0), rock: hexLin(0x6a7a8a) },
  lava: { basalt: hexLin(0x1c1614), ash: hexLin(0x3a302c), glow: hexLin(0xff6a1a), crust: hexLin(0x50281a) },
  rocky: { dust: hexLin(0x8a847a), dark: hexLin(0x4a4642), light: hexLin(0xb0aaa0), crater: hexLin(0x5c5850) },
  toxic: { mud: hexLin(0x4a5a1a), moss: hexLin(0x86a22a), acid: hexLin(0xc8e04a), purple: hexLin(0x6a3a7a) },
  crystal: { base: hexLin(0x2a1c4a), shard: hexLin(0x8a6aff), glow: hexLin(0xd0b8ff), pale: hexLin(0x5a4a8a) },
};

export const PROP = { PINE: 0, BROAD: 1, ROCK: 2, CACTUS: 3, CRYSTAL: 4, SHROOM: 5, DEAD: 6, ICE: 7 };

/**
 * @param {{type: string, seed: number, radius: number, amp: number, sea: number|null, city?: {x:number,y:number,z:number,radius:number,height:number}}} params
 */
export function makeTerrain(params) {
  const { type, seed, radius: R, amp: A } = params;
  const r = mulberry32(seed);
  const o = Array.from({ length: 8 }, () => [r() * 200 - 100, r() * 200 - 100, r() * 200 - 100]);
  const dune = [r() - 0.5, r() - 0.5, r() - 0.5];
  const dl = Math.hypot(...dune);
  dune[0] /= dl; dune[1] /= dl; dune[2] /= dl;
  const sea = params.sea;
  const city = params.city || null;
  const outpost = params.outposts || [];
  const ruins = params.ruins || [];
  const craterFreq = 3 + r() * 3;

  function raw(x, y, z) {
    if (type === 'terran') {
      const c = fbm(x * 1.1 + o[0][0], y * 1.1 + o[0][1], z * 1.1 + o[0][2], 5) * 1.6;
      const land = smooth(-0.05, 0.2, c);
      const mtn = ridged(x * 3.2 + o[1][0], y * 3.2 + o[1][1], z * 3.2 + o[1][2], 6);
      const mask = smooth(0.0, 0.35, fbm(x * 1.7 + o[2][0], y * 1.7 + o[2][1], z * 1.7 + o[2][2], 3) + 0.15);
      const hills = fbm(x * 9 + o[3][0], y * 9 + o[3][1], z * 9 + o[3][2], 4);
      const det = fbm(x * 48 + o[4][0], y * 48 + o[4][1], z * 48 + o[4][2], 3);
      let h = c * 0.22 * A + land * (mtn * mtn * mask * A * 0.9 + hills * A * 0.07) + det * A * 0.012;
      // terraced cliffs in some regions
      const tm = smooth(0.18, 0.32, fbm(x * 1.3 + o[5][0], y * 1.3 + o[5][1], z * 1.3 + o[5][2], 3));
      if (tm > 0 && h > 0) {
        const st = A * 0.055;
        const k = h / st;
        const f = k - Math.floor(k);
        h = mix(h, (Math.floor(k) + smooth(0.7, 0.95, f)) * st, tm);
      }
      // rivers: winding channels cut below sea level so water fills them
      if (sea !== null && h > sea - A * 0.01) {
        const rv = Math.abs(fbm(x * 4.2 + o[7][0], y * 4.2 + o[7][1], z * 4.2 + o[7][2], 3) + fbm(x * 19 + o[6][0], y * 19 + o[6][1], z * 19 + o[6][2], 2) * 0.08);
        const bank = 1 - smooth(0.012, 0.05, rv);
        if (bank > 0) {
          const bed = sea - A * 0.025;
          h = mix(h, Math.min(h, bed), smooth(0, 1, bank));
        }
      }
      return h;
    }
    if (type === 'desert') {
      const base = fbm(x * 1.6 + o[0][0], y * 1.6 + o[0][1], z * 1.6 + o[0][2], 4);
      const warp = fbm(x * 6 + o[1][0], y * 6 + o[1][1], z * 6 + o[1][2], 3);
      const d = Math.abs(Math.sin((x * dune[0] + y * dune[1] + z * dune[2]) * 70 + warp * 4));
      const m = fbm(x * 3 + o[2][0], y * 3 + o[2][1], z * 3 + o[2][2], 4);
      const mesa = m > 0.18 ? Math.min(1, Math.floor((m - 0.18) * 12) / 3 + 0.4) : 0;
      return base * A * 0.25 + (1 - d) * A * 0.05 * smooth(-0.1, 0.2, base) + mesa * A * 0.55 + fbm(x * 40, y * 40, z * 40, 2) * A * 0.01;
    }
    if (type === 'ice') {
      const b = fbm(x * 2 + o[0][0], y * 2 + o[0][1], z * 2 + o[0][2], 5);
      const rr = ridged(x * 5 + o[1][0], y * 5 + o[1][1], z * 5 + o[1][2], 5);
      return b * A * 0.35 + rr * rr * rr * A * 0.8 + fbm(x * 30, y * 30, z * 30, 3) * A * 0.01;
    }
    if (type === 'lava') {
      const rr = ridged(x * 3 + o[0][0], y * 3 + o[0][1], z * 3 + o[0][2], 6);
      const b = fbm(x * 1.4 + o[1][0], y * 1.4 + o[1][1], z * 1.4 + o[1][2], 4);
      return b * A * 0.45 + rr * A * 0.6 + fbm(x * 25, y * 25, z * 25, 3) * A * 0.02 - A * 0.08;
    }
    if (type === 'toxic') {
      const b = fbm(x * 2 + o[0][0], y * 2 + o[0][1], z * 2 + o[0][2], 5);
      const h = fbm(x * 12 + o[1][0], y * 12 + o[1][1], z * 12 + o[1][2], 3);
      return b * A * 0.4 + h * A * 0.08 + ridged(x * 4, y * 4, z * 4, 4) ** 3 * A * 0.4;
    }
    if (type === 'crystal') {
      const b = fbm(x * 2 + o[0][0], y * 2 + o[0][1], z * 2 + o[0][2], 4);
      const s = ridged(x * 6 + o[1][0], y * 6 + o[1][1], z * 6 + o[1][2], 5);
      return b * A * 0.3 + Math.pow(s, 4) * A * 1.1 + fbm(x * 30, y * 30, z * 30, 2) * A * 0.01;
    }
    // rocky moons: craters at two scales
    let h = fbm(x * 2.5 + o[0][0], y * 2.5 + o[0][1], z * 2.5 + o[0][2], 5) * A * 0.3;
    for (const [f, depth] of [[craterFreq, 0.35], [craterFreq * 4, 0.1]]) {
      const [d, cr] = worley(x * f + o[1][0], y * f + o[1][1], z * f + o[1][2]);
      const rad = 0.25 + cr * 0.25;
      if (d < rad * 1.4) {
        const t = d / rad;
        h += (t < 1 ? (t * t - 1) * depth : Math.max(0, 1 - (t - 1) / 0.4) * depth * 0.35) * A;
      }
    }
    return h + fbm(x * 40, y * 40, z * 40, 2) * A * 0.012;
  }

  function flatten(x, y, z, h, site) {
    const dot = x * site.x + y * site.y + z * site.z;
    const d = Math.acos(Math.max(-1, Math.min(1, dot))) * R;
    if (d > site.radius * 1.8) return h;
    const w = 1 - smooth(site.radius, site.radius * 1.8, d);
    return mix(h, site.height, w);
  }

  function height(x, y, z) {
    let h = raw(x, y, z);
    if (city) h = flatten(x, y, z, h, city);
    for (const s of outpost) h = flatten(x, y, z, h, s);
    return h;
  }

  function inSite(x, y, z, pad = 1.2) {
    const sites = city ? [city, ...outpost] : outpost;
    for (const s of sites) {
      const d = Math.acos(Math.max(-1, Math.min(1, x * s.x + y * s.y + z * s.z))) * R;
      if (d < s.radius * pad) return true;
    }
    return false;
  }

  // 0..1: how strongly a point lies inside a lost-civilisation ruin field.
  function inRuin(x, y, z) {
    let best = 0;
    for (const s of ruins) {
      const d = Math.acos(Math.max(-1, Math.min(1, x * s.x + y * s.y + z * s.z))) * R;
      if (d < s.radius * 1.3) best = Math.max(best, 1 - smooth(s.radius * 0.6, s.radius * 1.3, d));
    }
    return best;
  }

  // Surface radius including liquid (what you stand on).
  function floorHeight(x, y, z) {
    const h = height(x, y, z);
    return sea !== null && h < sea ? sea : h;
  }

  const pal = PAL[type] || PAL.rocky;
  const tmp = [0, 0, 0];

  // rgb in linear space plus glow in out[3]
  function color(x, y, z, h, slope, out) {
    const lat = Math.abs(y);
    const n = fbm(x * 14 + o[5][0], y * 14 + o[5][1], z * 14 + o[5][2], 3);
    out[3] = 0;
    if (type === 'terran') {
      const hs = h / A;
      if (h < 0) {
        mixC(out, pal.sand, pal.deep, smooth(0, -0.12, hs));
      } else if (hs < 0.012) {
        mixC(out, pal.sand, pal.grass, hs / 0.012 * 0.3);
      } else {
        const moist = fbm(x * 2.2 + o[6][0], y * 2.2 + o[6][1], z * 2.2 + o[6][2], 3) + 0.1 - lat * 0.3;
        mixC(out, pal.dry, pal.grass, smooth(-0.15, 0.1, moist));
        mixC(tmp, out, pal.forest, smooth(0.05, 0.25, moist + n * 0.2));
        out[0] = tmp[0]; out[1] = tmp[1]; out[2] = tmp[2];
        const rock = Math.max(smooth(0.3, 0.55, slope), smooth(0.35, 0.55, hs));
        mixC(tmp, out, mix(0, 1, n > 0 ? 1 : 0) ? pal.rock : pal.dirt, rock);
        out[0] = tmp[0]; out[1] = tmp[1]; out[2] = tmp[2];
        const snow = Math.max(smooth(0.55, 0.7, hs + n * 0.05), smooth(0.82, 0.9, lat)) * (1 - smooth(0.55, 0.8, slope));
        mixC(tmp, out, pal.snow, snow);
        out[0] = tmp[0]; out[1] = tmp[1]; out[2] = tmp[2];
      }
    } else if (type === 'desert') {
      mixC(out, pal.sand, pal.dune, 0.5 + n * 0.8);
      mixC(tmp, out, n > 0 ? pal.rock : pal.dark, smooth(0.25, 0.5, slope));
      out[0] = tmp[0]; out[1] = tmp[1]; out[2] = tmp[2];
    } else if (type === 'ice') {
      mixC(out, pal.snow, pal.ice, smooth(-0.1, 0.3, n));
      mixC(tmp, out, pal.rock, smooth(0.45, 0.7, slope));
      out[0] = tmp[0]; out[1] = tmp[1]; out[2] = tmp[2];
      if (Math.abs(n) < 0.015) mixC(out, out, pal.crack, 0.6);
    } else if (type === 'lava') {
      mixC(out, pal.basalt, pal.ash, smooth(-0.2, 0.3, n));
      if (sea !== null && h < sea + A * 0.02) { out[0] = pal.glow[0]; out[1] = pal.glow[1]; out[2] = pal.glow[2]; out[3] = 1; }
      const crack = Math.abs(fbm(x * 30 + o[7][0], y * 30 + o[7][1], z * 30 + o[7][2], 2));
      if (crack < 0.03 && slope < 0.5) { const g = 1 - crack / 0.03; mixC(out, out, pal.glow, g); out[3] = Math.max(out[3], g); }
    } else if (type === 'toxic') {
      mixC(out, pal.mud, pal.moss, smooth(-0.2, 0.25, n));
      mixC(tmp, out, pal.purple, smooth(0.35, 0.6, slope));
      out[0] = tmp[0]; out[1] = tmp[1]; out[2] = tmp[2];
      if (sea !== null && h < sea + A * 0.01) { mixC(out, out, pal.acid, 0.7); out[3] = 0.3; }
    } else if (type === 'crystal') {
      mixC(out, pal.base, pal.pale, smooth(-0.2, 0.3, n));
      const hs = h / A;
      const g = smooth(0.35, 0.6, hs);
      mixC(tmp, out, pal.shard, g);
      out[0] = tmp[0]; out[1] = tmp[1]; out[2] = tmp[2];
      out[3] = smooth(0.55, 0.8, hs) * 0.8;
    } else {
      mixC(out, pal.dark, pal.light, smooth(-0.35, 0.35, n + h / A * 0.6));
      mixC(tmp, out, pal.crater, smooth(0.3, 0.6, slope));
      out[0] = tmp[0]; out[1] = tmp[1]; out[2] = tmp[2];
    }
    // simple ambient occlusion on steep ground
    const ao = 1 - slope * 0.25;
    out[0] *= ao; out[1] *= ao; out[2] *= ao;
    if (inSite(x, y, z, 1.05) && h >= (sea ?? -1e9)) {
      // paved city ground
      out[0] = 0.05; out[1] = 0.055; out[2] = 0.065;
    } else if (ruins.length && h >= (sea ?? -1e9)) {
      // cracked old concrete where the lost cities stood
      const ru = inRuin(x, y, z);
      if (ru > 0) {
        const cr = Math.abs(fbm(x * 260 + o[3][0], y * 260 + o[3][1], z * 260 + o[3][2], 2));
        const c = cr < 0.012 ? 0.07 : 0.13 + n * 0.04;
        // grass breaks through the old concrete in patches
        const k = ru * 0.8 * smooth(-0.05, 0.25, fbm(x * 90 + o[2][0], y * 90 + o[2][1], z * 90 + o[2][2], 3) + 0.15);
        out[0] = mix(out[0], c, k); out[1] = mix(out[1], c * 1.02, k); out[2] = mix(out[2], c * 1.05, k);
      }
    }
  }

  // Which prop (if any) grows here. Returns -1 for none.
  function prop(x, y, z, h, slope, rnd) {
    if ((sea !== null && h < sea + A * 0.012) || slope > 0.45) return -1;
    if (inSite(x, y, z, 1.25)) return -1;
    if (ruins.length && inRuin(x, y, z) > 0.6 && rnd < 0.7) return rnd < 0.08 ? PROP.ROCK : -1;
    const n = fbm(x * 6 + o[6][0], y * 6 + o[6][1], z * 6 + o[6][2], 3);
    if (type === 'terran') {
      const hs = h / A;
      if (hs > 0.5) return rnd < 0.15 ? PROP.ROCK : -1;
      const moist = fbm(x * 2.2 + o[6][0], y * 2.2 + o[6][1], z * 2.2 + o[6][2], 3) + 0.1 - Math.abs(y) * 0.3;
      if (moist > 0.12 && rnd < 0.6) return hs > 0.25 || Math.abs(y) > 0.55 ? PROP.PINE : (n > 0 ? PROP.BROAD : PROP.PINE);
      if (rnd < 0.12) return PROP.ROCK;
      if (moist > -0.05 && rnd < 0.25) return PROP.BROAD;
      return -1;
    }
    if (type === 'desert') return rnd < 0.06 ? PROP.CACTUS : rnd < 0.1 ? PROP.ROCK : -1;
    if (type === 'ice') return rnd < 0.08 ? PROP.ICE : -1;
    if (type === 'lava') return rnd < 0.05 ? PROP.DEAD : rnd < 0.1 ? PROP.ROCK : -1;
    if (type === 'toxic') return n > -0.1 && rnd < 0.4 ? PROP.SHROOM : -1;
    if (type === 'crystal') return rnd < 0.12 ? PROP.CRYSTAL : -1;
    return rnd < 0.05 ? PROP.ROCK : -1;
  }

  return { height, floorHeight, color, prop, sea, amp: A, radius: R, type, inSite, inRuin };
}

// Height change from craters at a unit direction: a bowl with a raised rim.
// craters: [{ x, y, z (unit dir), r (angular radius), d (depth in metres) }].
// Writes the scorch amount (0..1) into out[0] if given.
export function craterOffset(x, y, z, craters, out) {
  let h = 0, burn = 0;
  if (craters) {
    for (const c of craters) {
      const dot = x * c.x + y * c.y + z * c.z;
      if (dot < c.cos) continue;
      const t = Math.acos(Math.min(1, dot)) / c.r;
      if (t < 1) h -= c.d * (1 - t * t);
      const rim = (t - 1) / 0.25;
      h += c.d * 0.22 * Math.exp(-rim * rim);
      burn = Math.max(burn, 1 - t / 1.25);
    }
  }
  if (out) out[0] = Math.max(0, burn);
  return h;
}

// Map cube-face coordinates (s, t in [-1, 1]) to a unit sphere direction.
export function cubeToSphere(face, s, t, out) {
  let x, y, z;
  switch (face) {
    case 0: x = 1; y = t; z = -s; break;
    case 1: x = -1; y = t; z = s; break;
    case 2: x = s; y = 1; z = -t; break;
    case 3: x = s; y = -1; z = t; break;
    case 4: x = s; y = t; z = 1; break;
    default: x = -s; y = t; z = -1; break;
  }
  const x2 = x * x, y2 = y * y, z2 = z * z;
  out[0] = x * Math.sqrt(1 - y2 / 2 - z2 / 2 + (y2 * z2) / 3);
  out[1] = y * Math.sqrt(1 - z2 / 2 - x2 / 2 + (z2 * x2) / 3);
  out[2] = z * Math.sqrt(1 - x2 / 2 - y2 / 2 + (x2 * y2) / 3);
  return out;
}
