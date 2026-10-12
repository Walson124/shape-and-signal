// Pure planet texture generator. Runs inside a Web Worker (or on the main
// thread as a fallback). Produces typed arrays for DataTextures:
//   color    RGBA  albedo
//   emissive RGBA  glow (lava, crystal veins, city lights)
//   surface  RGBA  R = height (bump), G = roughness
//   clouds   RGBA  optional cloud layer (alpha)
// Rows are bottom-up to match DataTexture's default orientation.

function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PERM = new Uint8Array(512);
{
  const r = mulberry32(1337);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    const t = p[i]; p[i] = p[j]; p[j] = t;
  }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
}

function vnoise(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const X = xi & 255, Y = yi & 255, Z = zi & 255;
  const a = PERM[X] + Y, b = PERM[X + 1] + Y;
  const aa = PERM[a] + Z, ab = PERM[a + 1] + Z, ba = PERM[b] + Z, bb = PERM[b + 1] + Z;
  const x1 = PERM[aa] + (PERM[ba] - PERM[aa]) * u;
  const x2 = PERM[ab] + (PERM[bb] - PERM[ab]) * u;
  const x3 = PERM[aa + 1] + (PERM[ba + 1] - PERM[aa + 1]) * u;
  const x4 = PERM[ab + 1] + (PERM[bb + 1] - PERM[ab + 1]) * u;
  const y1 = x1 + (x2 - x1) * v;
  const y2 = x3 + (x4 - x3) * v;
  return (y1 + (y2 - y1) * w) / 255;
}

function fbm(x, y, z, oct) {
  let v = 0, a = 0.5, n = 0;
  for (let i = 0; i < oct; i++) {
    v += a * vnoise(x, y, z);
    n += a;
    x = x * 2.03 + 17.1; y = y * 2.03 + 3.7; z = z * 2.03 + 9.3;
    a *= 0.5;
  }
  return v / n;
}

function ridged(x, y, z, oct) {
  let v = 0, a = 0.5, n = 0;
  for (let i = 0; i < oct; i++) {
    const s = 1 - Math.abs(vnoise(x, y, z) * 2 - 1);
    v += a * s * s;
    n += a;
    x = x * 2.1 + 5.1; y = y * 2.1 + 1.7; z = z * 2.1 + 8.3;
    a *= 0.5;
  }
  return v / n;
}

const hex = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
function grad(stops, t) {
  if (t <= stops[0][0]) return hex(stops[0][1]);
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const [t0, c0] = stops[i - 1];
      const [t1, c1] = stops[i];
      const f = (t - t0) / (t1 - t0);
      const a = hex(c0), b = hex(c1);
      return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
    }
  }
  return hex(stops[stops.length - 1][1]);
}

const PAL = {
  rocky: [
    [[0, 0x2e2925], [0.4, 0x5f554c], [0.7, 0x948576], [1, 0xcdc2b4]],
    [[0, 0x24262c], [0.5, 0x555a65], [1, 0xa8adb7]],
    [[0, 0x3a1e12], [0.5, 0x8a4a2c], [1, 0xd8a070]],
  ],
  gas: [
    [[0, 0xb8743e], [0.22, 0xf2d6a2], [0.45, 0x9c5a32], [0.7, 0xead0a0], [0.85, 0xc89060], [1, 0x7a3e22]],
    [[0, 0x2f52a6], [0.3, 0x9ec8ff], [0.55, 0x23367e], [0.8, 0xd0e6ff], [1, 0x4366d0]],
    [[0, 0x5a2e8a], [0.3, 0xd0a2ff], [0.6, 0x3e2270], [0.85, 0xe8c8ff], [1, 0x7a4ab0]],
    [[0, 0x9a3020], [0.3, 0xffb07a], [0.6, 0x6a1414], [0.85, 0xffd8a8], [1, 0xb85030]],
    [[0, 0x1a6a6a], [0.3, 0x8af0e0], [0.6, 0x10404a], [1, 0xc8fff4]],
  ],
  ice: [[0, 0x5a80aa], [0.35, 0xa8cceb], [0.7, 0xe4f2ff], [1, 0xffffff]],
  toxic: [[0, 0x3e4c0c], [0.35, 0x8fae28], [0.6, 0xd2e45a], [0.8, 0x5e7e1a], [1, 0xeeff9a]],
  crystal: [
    [[0, 0x140830], [0.4, 0x40247e], [0.7, 0x9466ff], [1, 0xe6d8ff]],
    [[0, 0x082430], [0.4, 0x16707e], [0.7, 0x52ffe0], [1, 0xe0fff8]],
  ],
};

/**
 * @param {{type: string, seed: number, w: number}} job
 */
export function generatePlanet({ type, seed, w }) {
  const h = w / 2;
  const rnd = mulberry32(seed);
  const ox = rnd() * 50, oy = rnd() * 50, oz = rnd() * 50;
  const pick = (list) => list[Math.floor(rnd() * list.length)];
  const color = new Uint8Array(w * h * 4);
  const surface = new Uint8Array(w * h * 4);
  const hasEmissive = type === 'lava' || type === 'crystal' || type === 'terran';
  const emissive = hasEmissive ? new Uint8Array(w * h * 4) : null;
  const clouds = type === 'terran' || type === 'toxic' ? new Uint8Array(w * h * 4) : null;

  const gasPal = pick(PAL.gas);
  const rockPal = pick(PAL.rocky);
  const crystalPal = pick(PAL.crystal);
  const bandFreq = 5 + rnd() * 7;
  const storms = Array.from({ length: 1 + Math.floor(rnd() * 3) }, () => [rnd() * Math.PI * 2, (rnd() - 0.5) * 1.4, 0.08 + rnd() * 0.12]);
  const sea = 0.47 + rnd() * 0.08;
  const craters = [];
  if (type === 'rocky' || type === 'ice' || type === 'crystal') {
    const n = type === 'rocky' ? 60 : 24;
    for (let i = 0; i < n; i++) {
      const th = Math.acos(2 * rnd() - 1), ph = rnd() * Math.PI * 2;
      craters.push([Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph), 0.02 + Math.pow(rnd(), 3) * 0.25]);
    }
  }
  const detail = w >= 1024 ? 7 : 6;
  const cox = rnd() * 40, coy = rnd() * 40;

  for (let y = 0; y < h; y++) {
    // bottom-up rows: y = 0 is the south pole
    const theta = (1 - (y + 0.5) / h) * Math.PI;
    const st = Math.sin(theta), ct = Math.cos(theta);
    for (let x = 0; x < w; x++) {
      const phi = ((x + 0.5) / w) * Math.PI * 2;
      const dx = -st * Math.cos(phi), dy = ct, dz = st * Math.sin(phi);
      let c, e = null, height = 0.5, rough = 0.85;

      if (type === 'gas') {
        const turb = fbm(dx * 2.2 + ox, dy * 7 + oy, dz * 2.2 + oz, 5);
        const fine = fbm(dx * 9 + oz, dy * 30 + ox, dz * 9 + oy, 3);
        let t = 0.5 + 0.5 * Math.sin(dy * bandFreq * 2.4 + turb * 5.0 + fine * 0.8);
        for (const [sp, sy, sr] of storms) {
          const lon = Math.atan2(dz, -dx);
          let dl = Math.abs(lon - sp);
          if (dl > Math.PI) dl = Math.PI * 2 - dl;
          const d = Math.sqrt((dl * 0.6) ** 2 + ((dy - sy * 0.6) * 1.8) ** 2) / sr;
          if (d < 1) {
            const swirl = Math.sin(d * 14 - Math.atan2(dy - sy * 0.6, dl) * 2 + turb * 4);
            t = t * d + (1 - d) * (0.5 + 0.5 * swirl);
          }
        }
        c = grad(gasPal, t);
        height = 0.5 + (t - 0.5) * 0.15;
        rough = 0.95;
      } else if (type === 'terran') {
        const n = fbm(dx * 2.0 + ox, dy * 2.0 + oy, dz * 2.0 + oz, detail);
        const m = ridged(dx * 4 + oz, dy * 4 + ox, dz * 4 + oy, 5);
        const land = n + (n > sea ? m * 0.12 : 0);
        if (n < sea) {
          const depth = n / sea;
          c = grad([[0, 0x041236], [0.7, 0x0b3576], [0.95, 0x1a6fb0], [1, 0x3aa0c8]], depth);
          height = 0.42;
          rough = 0.25;
        } else {
          const t = (land - sea) / (1 - sea);
          const lat = Math.abs(dy);
          const arid = fbm(dx * 3 + 9, dy * 3 + 9, dz * 3 + 9, 4);
          const green = lat < 0.3 && arid > 0.55 ? [[0, 0xd2bc7e], [0.15, 0xb89a5a], [0.5, 0x8a6a40], [0.8, 0x8a8078], [1, 0xf0f0f0]] : [[0, 0xc8b47a], [0.06, 0x3c7a2c], [0.35, 0x2a5a20], [0.62, 0x6a5a38], [0.82, 0x7e776e], [1, 0xf4f4f4]];
          c = grad(green, Math.min(1, t * 1.3));
          height = 0.5 + t * 0.5;
          rough = 0.9;
          const city = fbm(dx * 34 + 5, dy * 34 + 5, dz * 34 + 5, 3) * fbm(dx * 6 + 2, dy * 6 + 2, dz * 6 + 2, 2);
          if (city > 0.36 && t < 0.35 && lat < 0.7) {
            const k = Math.min(1, (city - 0.36) * 9);
            e = [255 * k, 190 * k, 110 * k];
          }
        }
        const ice = Math.abs(dy) + fbm(dx * 4, dy * 4, dz * 4, 3) * 0.16;
        if (ice > 0.86) { c = [236, 243, 250]; rough = 0.5; height = Math.max(height, 0.55); e = null; }
      } else if (type === 'lava') {
        const n = fbm(dx * 3 + ox, dy * 3 + oy, dz * 3 + oz, detail);
        const r = fbm(dx * 5 + oy, dy * 5 + oz, dz * 5 + ox, 5);
        const crack = Math.abs(r - 0.5);
        c = grad([[0, 0x0e0604], [0.5, 0x2a140e], [1, 0x52301e]], n);
        height = 0.4 + n * 0.6;
        rough = 0.95;
        if (crack < 0.045) {
          const g = 1 - crack / 0.045;
          c = [c[0] + (255 - c[0]) * g, c[1] + (110 - c[1]) * g, c[2] + (20 - c[2]) * g];
          e = [255 * g, 100 * g * g + 20 * g, 14 * g];
          height = 0.3;
        }
      } else if (type === 'ice') {
        const n = fbm(dx * 3 + ox, dy * 3 + oy, dz * 3 + oz, detail);
        c = grad(PAL.ice, n);
        const r = Math.abs(fbm(dx * 6 + oz, dy * 6 + ox, dz * 6 + oy, 4) - 0.5);
        height = 0.5 + n * 0.3;
        rough = 0.35;
        if (r < 0.018) { c = [c[0] * 0.55, c[1] * 0.72, c[2] * 0.9]; height = 0.3; }
      } else if (type === 'toxic') {
        const turb = fbm(dx * 2.5 + ox, dy * 2.5 + oy, dz * 2.5 + oz, 5);
        c = grad(PAL.toxic, 0.5 + 0.5 * Math.sin(dy * 6 + turb * 8));
        height = 0.5 + turb * 0.2;
        rough = 0.8;
      } else if (type === 'crystal') {
        const n = fbm(dx * 3 + ox, dy * 3 + oy, dz * 3 + oz, detail);
        c = grad(crystalPal, n);
        height = 0.4 + n * 0.6;
        rough = 0.3;
        const r = Math.abs(fbm(dx * 4 + oz, dy * 4 + ox, dz * 4 + oy, 5) - 0.5);
        if (r < 0.03) {
          const g = 1 - r / 0.03;
          const hi = hex(crystalPal[3][1]);
          e = [hi[0] * g, hi[1] * g, hi[2] * g];
          c = [c[0] + (hi[0] - c[0]) * g, c[1] + (hi[1] - c[1]) * g, c[2] + (hi[2] - c[2]) * g];
          height = 0.9;
        }
      } else {
        const n = fbm(dx * 3 + ox, dy * 3 + oy, dz * 3 + oz, detail);
        const m = ridged(dx * 5 + oz, dy * 5 + ox, dz * 5 + oy, 4);
        c = grad(rockPal, n * 0.8 + m * 0.2);
        height = n * 0.7 + m * 0.3;
        rough = 0.95;
      }

      for (let k = 0; k < craters.length; k++) {
        const cr = craters[k];
        const dot = dx * cr[0] + dy * cr[1] + dz * cr[2];
        if (dot < 0.9) continue;
        const dist = Math.acos(Math.min(1, dot));
        if (dist < cr[3] * 1.3) {
          const f = dist / cr[3];
          const shade = f < 1 ? 0.75 + 0.18 * f : 1.12 - 0.4 * (f - 1);
          c = [c[0] * shade, c[1] * shade, c[2] * shade];
          height = f < 1 ? height * 0.6 + 0.12 * f : height + 0.18 * (1.3 - f);
        }
      }

      const i = (y * w + x) * 4;
      color[i] = c[0]; color[i + 1] = c[1]; color[i + 2] = c[2]; color[i + 3] = 255;
      surface[i] = Math.max(0, Math.min(255, height * 255));
      surface[i + 1] = rough * 255;
      surface[i + 2] = 0;
      surface[i + 3] = 255;
      if (emissive) {
        emissive[i] = e ? e[0] : 0; emissive[i + 1] = e ? e[1] : 0; emissive[i + 2] = e ? e[2] : 0; emissive[i + 3] = 255;
      }
      if (clouds) {
        const cn = fbm(dx * 3 + cox, dy * 3.6 + coy, dz * 3, 6);
        const band = type === 'toxic' ? 0.5 + 0.5 * Math.sin(dy * 9 + cn * 6) : 1;
        const a = Math.max(0, Math.min(1, (cn - 0.5) * 3.4)) * band;
        clouds[i] = type === 'toxic' ? 230 : 255;
        clouds[i + 1] = type === 'toxic' ? 245 : 255;
        clouds[i + 2] = type === 'toxic' ? 190 : 255;
        clouds[i + 3] = a * (type === 'toxic' ? 150 : 235);
      }
    }
  }
  return { w, h, color, surface, emissive, clouds, ringColors: gasPal };
}

export function generateRing({ stops, seed }) {
  const rnd = mulberry32(seed);
  const w = 1024, h = 4;
  const data = new Uint8Array(w * h * 4);
  const phase = rnd() * 10;
  const gap = 0.55 + rnd() * 0.15;
  for (let x = 0; x < w; x++) {
    const t = x / w;
    const c = grad(stops, 0.5 + 0.5 * Math.sin(t * 17 + phase));
    let a = 0.2 + 0.8 * vnoise(t * 60 + phase, 0.5, 0.5) * (0.6 + 0.4 * vnoise(t * 200, 1.5, 0.5));
    a *= Math.pow(Math.sin(t * Math.PI), 0.5);
    if (Math.abs(t - gap) < 0.025) a *= 0.08;
    for (let y = 0; y < h; y++) {
      const i = (y * w + x) * 4;
      data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = a * 225;
    }
  }
  return { w, h, data };
}
