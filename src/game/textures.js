import * as THREE from 'three';
import { mulberry32 } from './rng.js';

// ---------------------------------------------------------------------------
// CPU value noise for baking planet textures onto canvases. Sampling 3D noise
// on the unit sphere means the textures have no seam and no pole pinching.
// ---------------------------------------------------------------------------
const PERM = new Uint8Array(512);
{
  const r = mulberry32(1337);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
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
  const l = (t, p, q) => p + t * (q - p);
  return l(w,
    l(v, l(u, PERM[aa], PERM[ba]), l(u, PERM[ab], PERM[bb])),
    l(v, l(u, PERM[aa + 1], PERM[ba + 1]), l(u, PERM[ab + 1], PERM[bb + 1]))) / 255;
}

function fbm(x, y, z, oct = 5) {
  let v = 0, a = 0.5, n = 0;
  for (let i = 0; i < oct; i++) {
    v += a * vnoise(x, y, z);
    n += a;
    x = x * 2.03 + 17.1; y = y * 2.03 + 3.7; z = z * 2.03 + 9.3;
    a *= 0.5;
  }
  return v / n;
}

function hexToRgb(hex) {
  return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
}

// Sample a gradient of [t, hex] stops.
function gradient(stops, t) {
  if (t <= stops[0][0]) return hexToRgb(stops[0][1]);
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const [t0, c0] = stops[i - 1];
      const [t1, c1] = stops[i];
      const f = (t - t0) / (t1 - t0);
      const a = hexToRgb(c0), b = hexToRgb(c1);
      return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
    }
  }
  return hexToRgb(stops[stops.length - 1][1]);
}

const PALETTES = {
  rocky: [[[0, 0x3a332e], [0.45, 0x6d6157], [0.7, 0x9a8c7e], [1, 0xc9bfb2]], [[0, 0x2b2d33], [0.5, 0x5a5f6a], [1, 0xa6abb5]], [[0, 0x4a2618], [0.5, 0x8f4b2c], [1, 0xd09060]]],
  gas: [
    [[0, 0xc98a52], [0.25, 0xf2d6a2], [0.5, 0xa8623a], [0.75, 0xe8c08a], [1, 0x8a4a2a]],
    [[0, 0x3a5fb0], [0.3, 0x9ec8ff], [0.55, 0x2a3e8a], [0.8, 0xc9e2ff], [1, 0x4a6ad0]],
    [[0, 0x6a3a9a], [0.3, 0xd0a2ff], [0.6, 0x4a2a7a], [1, 0xf0d8ff]],
    [[0, 0xa83a2a], [0.3, 0xffb07a], [0.6, 0x7a1a1a], [1, 0xffd8a8]],
  ],
  ice: [[[0, 0x6a90b8], [0.4, 0xb8d8f0], [0.7, 0xe8f4ff], [1, 0xffffff]]],
  toxic: [[[0, 0x4a5a10], [0.35, 0x9ab830], [0.6, 0xd8e860], [0.8, 0x6a8a20], [1, 0xf0ff9a]]],
  crystal: [[[0, 0x1a0a3a], [0.4, 0x4a2a8a], [0.7, 0x9a6aff], [1, 0xe0d0ff]], [[0, 0x0a2a3a], [0.4, 0x1a7a8a], [0.7, 0x5affe0], [1, 0xe0fff8]]],
};

/**
 * Bake color (and optionally emissive) maps for a planet.
 * Returns { map, emissiveMap?, cloudMap?, ringHue }.
 */
export function makePlanetTextures(type, seed, size = 512) {
  const rnd = mulberry32(seed);
  const w = size, h = size / 2;
  const ox = rnd() * 50, oy = rnd() * 50, oz = rnd() * 50;
  const pal = (list) => list[Math.floor(rnd() * list.length)];

  const cvs = document.createElement('canvas');
  cvs.width = w; cvs.height = h;
  const ctx = cvs.getContext('2d');
  const img = ctx.createImageData(w, h);
  const d = img.data;

  let emissive = null, ed = null, eimg = null, ectx = null;
  if (type === 'lava' || type === 'crystal' || type === 'terran') {
    emissive = document.createElement('canvas');
    emissive.width = w; emissive.height = h;
    ectx = emissive.getContext('2d');
    eimg = ectx.createImageData(w, h);
    ed = eimg.data;
  }

  const craters = [];
  if (type === 'rocky' || type === 'ice') {
    for (let i = 0; i < 26; i++) {
      const th = Math.acos(2 * rnd() - 1), ph = rnd() * Math.PI * 2;
      craters.push([Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph), 0.04 + rnd() * rnd() * 0.22]);
    }
  }

  const gasPal = pal(PALETTES.gas);
  const rockPal = pal(PALETTES.rocky);
  const crystalPal = pal(PALETTES.crystal);
  const bandFreq = 4 + rnd() * 6;
  const storm = [rnd() * 2 - 1, (rnd() - 0.5) * 0.8, rnd() * 2 - 1];
  const sea = 0.48 + rnd() * 0.08;

  for (let y = 0; y < h; y++) {
    const theta = ((y + 0.5) / h) * Math.PI;
    const st = Math.sin(theta), ct = Math.cos(theta);
    for (let x = 0; x < w; x++) {
      const phi = ((x + 0.5) / w) * Math.PI * 2;
      const dx = st * Math.cos(phi), dy = ct, dz = st * Math.sin(phi);
      let c;
      let e = null;
      if (type === 'gas') {
        const turb = fbm(dx * 2 + ox, dy * 6 + oy, dz * 2 + oz, 4);
        let t = 0.5 + 0.5 * Math.sin(dy * bandFreq * 2.2 + turb * 4.5);
        const sdx = dx - storm[0] * 0.7, sdy = dy - storm[1], sdz = dz - storm[2] * 0.7;
        const sd = Math.sqrt(sdx * sdx + sdy * sdy * 4 + sdz * sdz);
        if (sd < 0.22) t = t * (sd / 0.22) + (1 - sd / 0.22) * (0.5 + 0.5 * Math.sin(sd * 40 + turb * 6));
        c = gradient(gasPal, t);
      } else if (type === 'terran') {
        const n = fbm(dx * 2.2 + ox, dy * 2.2 + oy, dz * 2.2 + oz, 6);
        if (n < sea) {
          c = gradient([[0, 0x061a4a], [0.75, 0x0e3f8a], [1, 0x2a7ac0]], n / sea);
        } else {
          const t = (n - sea) / (1 - sea);
          c = gradient([[0, 0xc8b47a], [0.08, 0x3a7a2a], [0.4, 0x2a5a20], [0.65, 0x7a6a40], [0.85, 0x8a8078], [1, 0xf0f0f0]], t);
          // night-side city lights
          const city = fbm(dx * 14 + 5, dy * 14 + 5, dz * 14 + 5, 2);
          if (city > 0.62 && t < 0.5) e = [255 * (city - 0.62) * 4, 200 * (city - 0.62) * 4, 120 * (city - 0.62) * 4];
        }
        const ice = Math.abs(dy) + fbm(dx * 4, dy * 4, dz * 4, 3) * 0.15;
        if (ice > 0.86) c = [235, 242, 250];
      } else if (type === 'lava') {
        const n = fbm(dx * 3 + ox, dy * 3 + oy, dz * 3 + oz, 5);
        const r = fbm(dx * 5 + oy, dy * 5 + oz, dz * 5 + ox, 4);
        const crack = Math.abs(r - 0.5);
        c = gradient([[0, 0x120806], [0.5, 0x2e1610], [1, 0x5a3022]], n);
        if (crack < 0.05) {
          const g = 1 - crack / 0.05;
          c = [c[0] + (255 - c[0]) * g, c[1] + (120 - c[1]) * g, c[2] + (20 - c[2]) * g];
          e = [255 * g, 110 * g, 20 * g];
        }
      } else if (type === 'ice') {
        const n = fbm(dx * 3 + ox, dy * 3 + oy, dz * 3 + oz, 5);
        c = gradient(PALETTES.ice[0], n);
        const r = Math.abs(fbm(dx * 6 + oz, dy * 6 + ox, dz * 6 + oy, 3) - 0.5);
        if (r < 0.02) c = [c[0] * 0.6, c[1] * 0.75, c[2] * 0.9];
      } else if (type === 'toxic') {
        const turb = fbm(dx * 2.5 + ox, dy * 2.5 + oy, dz * 2.5 + oz, 5);
        c = gradient(PALETTES.toxic[0], 0.5 + 0.5 * Math.sin(dy * 5 + turb * 8));
      } else if (type === 'crystal') {
        const n = fbm(dx * 3 + ox, dy * 3 + oy, dz * 3 + oz, 5);
        c = gradient(crystalPal, n);
        const r = Math.abs(fbm(dx * 4 + oz, dy * 4 + ox, dz * 4 + oy, 4) - 0.5);
        if (r < 0.035) {
          const g = 1 - r / 0.035;
          const hi = hexToRgb(crystalPal[3][1]);
          e = [hi[0] * g, hi[1] * g, hi[2] * g];
          c = [c[0] + (hi[0] - c[0]) * g, c[1] + (hi[1] - c[1]) * g, c[2] + (hi[2] - c[2]) * g];
        }
      } else {
        const n = fbm(dx * 3 + ox, dy * 3 + oy, dz * 3 + oz, 6);
        c = gradient(rockPal, n);
      }
      if (craters.length) {
        for (let k = 0; k < craters.length; k++) {
          const cr = craters[k];
          const dot = dx * cr[0] + dy * cr[1] + dz * cr[2];
          const dist = Math.acos(Math.min(1, dot));
          if (dist < cr[3] * 1.25) {
            const f = dist / cr[3];
            const shade = f < 1 ? 0.72 + 0.2 * f : 1.15 - 0.6 * (f - 1);
            c = [c[0] * shade, c[1] * shade, c[2] * shade];
          }
        }
      }
      const i = (y * w + x) * 4;
      d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
      if (ed) {
        ed[i] = e ? e[0] : 0; ed[i + 1] = e ? e[1] : 0; ed[i + 2] = e ? e[2] : 0; ed[i + 3] = 255;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  const map = new THREE.CanvasTexture(cvs);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  const out = { map };
  if (ectx) {
    ectx.putImageData(eimg, 0, 0);
    out.emissiveMap = new THREE.CanvasTexture(emissive);
    out.emissiveMap.colorSpace = THREE.SRGBColorSpace;
  }
  if (type === 'terran') out.cloudMap = makeCloudTexture(seed + 7);
  out.ringColors = gasPal;
  return out;
}

function makeCloudTexture(seed) {
  const rnd = mulberry32(seed);
  const w = 512, h = 256;
  const cvs = document.createElement('canvas');
  cvs.width = w; cvs.height = h;
  const ctx = cvs.getContext('2d');
  const img = ctx.createImageData(w, h);
  const ox = rnd() * 40, oy = rnd() * 40;
  for (let y = 0; y < h; y++) {
    const theta = ((y + 0.5) / h) * Math.PI;
    const st = Math.sin(theta), ct = Math.cos(theta);
    for (let x = 0; x < w; x++) {
      const phi = ((x + 0.5) / w) * Math.PI * 2;
      const n = fbm(st * Math.cos(phi) * 3 + ox, ct * 3 + oy, st * Math.sin(phi) * 3, 5);
      const a = Math.max(0, Math.min(1, (n - 0.5) * 3.2));
      const i = (y * w + x) * 4;
      img.data[i] = 255; img.data[i + 1] = 255; img.data[i + 2] = 255; img.data[i + 3] = a * 235;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cvs);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function makeRingTexture(stops, seed) {
  const rnd = mulberry32(seed);
  const w = 512, h = 4;
  const cvs = document.createElement('canvas');
  cvs.width = w; cvs.height = h;
  const ctx = cvs.getContext('2d');
  const img = ctx.createImageData(w, h);
  const phase = rnd() * 10;
  for (let x = 0; x < w; x++) {
    const t = x / w;
    const c = gradient(stops, 0.5 + 0.5 * Math.sin(t * 13 + phase));
    let a = 0.25 + 0.75 * vnoise(t * 40 + phase, 0.5, 0.5);
    a *= Math.sin(t * Math.PI) ** 0.6;
    if (Math.abs(t - 0.62) < 0.03) a *= 0.1;
    for (let y = 0; y < h; y++) {
      const i = (y * w + x) * 4;
      img.data[i] = c[0]; img.data[i + 1] = c[1]; img.data[i + 2] = c[2]; img.data[i + 3] = a * 220;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cvs);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

let glowTex = null;
export function glowTexture() {
  if (glowTex) return glowTex;
  const s = 128;
  const cvs = document.createElement('canvas');
  cvs.width = s; cvs.height = s;
  const ctx = cvs.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.18, 'rgba(255,255,255,0.75)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.22)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  glowTex = new THREE.CanvasTexture(cvs);
  return glowTex;
}

let cloudPuffTex = null;
export function puffTexture() {
  if (cloudPuffTex) return cloudPuffTex;
  const s = 128;
  const cvs = document.createElement('canvas');
  cvs.width = s; cvs.height = s;
  const ctx = cvs.getContext('2d');
  const img = ctx.createImageData(s, s);
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const dx = x / s - 0.5, dy = y / s - 0.5;
      const r = Math.sqrt(dx * dx + dy * dy) * 2;
      const n = fbm(x / 24, y / 24, 0.5, 4);
      const a = Math.max(0, 1 - r) ** 1.5 * (0.4 + n);
      const i = (y * s + x) * 4;
      img.data[i] = 255; img.data[i + 1] = 255; img.data[i + 2] = 255; img.data[i + 3] = Math.min(255, a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  cloudPuffTex = new THREE.CanvasTexture(cvs);
  return cloudPuffTex;
}

// A small spiral galaxy for distant decoration in the sky.
export function galaxyTexture(color, seed) {
  const rnd = mulberry32(seed);
  const s = 256;
  const cvs = document.createElement('canvas');
  cvs.width = s; cvs.height = s;
  const ctx = cvs.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,245,230,0.9)');
  g.addColorStop(0.12, 'rgba(255,230,200,0.35)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const arms = 2 + Math.floor(rnd() * 2);
  for (let i = 0; i < 2600; i++) {
    const arm = i % arms;
    const t = Math.pow(rnd(), 0.7);
    const ang = t * 7 + (arm / arms) * Math.PI * 2 + (rnd() - 0.5) * 0.6;
    const r = t * s * 0.46;
    const x = s / 2 + Math.cos(ang) * r + (rnd() - 0.5) * 8;
    const y = s / 2 + Math.sin(ang) * r + (rnd() - 0.5) * 8;
    const a = (1 - t) * 0.5;
    ctx.fillStyle = rnd() < 0.3 ? `rgba(255,255,255,${a})` : `${color}${Math.floor(a * 255).toString(16).padStart(2, '0')}`;
    ctx.fillRect(x, y, 1.6, 1.6);
  }
  const tex = new THREE.CanvasTexture(cvs);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
