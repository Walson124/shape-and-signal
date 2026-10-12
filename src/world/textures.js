import * as THREE from 'three';
import { mulberry32 } from '../core/rng.js';

// Small procedural textures shared across the game. Each is built once.
const cache = new Map();
function once(key, fn) {
  if (!cache.has(key)) cache.set(key, fn());
  return cache.get(key);
}

function canvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

export const glowTexture = () => once('glow', () => {
  const [c, ctx] = canvas(128);
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.15, 'rgba(255,255,255,0.75)');
  g.addColorStop(0.42, 'rgba(255,255,255,0.2)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
});

export const softDotTexture = () => once('softdot', () => {
  const [c, ctx] = canvas(64);
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
});

export const ringTexture = () => once('ring', () => {
  const [c, ctx] = canvas(256);
  const g = ctx.createRadialGradient(128, 128, 60, 128, 128, 128);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.7, 'rgba(255,255,255,0.0)');
  g.addColorStop(0.86, 'rgba(255,255,255,0.5)');
  g.addColorStop(0.92, 'rgba(255,255,255,0.15)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(c);
});

export const hexTexture = () => once('hex', () => {
  const [c, ctx] = canvas(128);
  ctx.translate(64, 64);
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    ctx[i ? 'lineTo' : 'moveTo'](Math.cos(a) * 56, Math.sin(a) * 56);
  }
  ctx.closePath();
  const g = ctx.createRadialGradient(0, 0, 10, 0, 0, 60);
  g.addColorStop(0, 'rgba(255,255,255,0.25)');
  g.addColorStop(0.85, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0.1)');
  ctx.fillStyle = g;
  ctx.filter = 'blur(2px)';
  ctx.fill();
  return new THREE.CanvasTexture(c);
});

export const streakTexture = () => once('streak', () => {
  const [c, ctx] = canvas(512, 32);
  const g = ctx.createLinearGradient(0, 0, 512, 0);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.5, 'rgba(255,255,255,1)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 512, 32);
  const v = ctx.getImageData(0, 0, 512, 32);
  for (let y = 0; y < 32; y++) {
    const f = Math.exp(-((y - 15.5) ** 2) / 18);
    for (let x = 0; x < 512; x++) v.data[(y * 512 + x) * 4 + 3] *= f;
  }
  ctx.putImageData(v, 0, 0);
  return new THREE.CanvasTexture(c);
});

// Four-point star spikes for bright stars.
export const spikeTexture = () => once('spike', () => {
  const [c, ctx] = canvas(128);
  const img = ctx.createImageData(128, 128);
  for (let y = 0; y < 128; y++) {
    for (let x = 0; x < 128; x++) {
      const dx = (x - 63.5) / 64, dy = (y - 63.5) / 64;
      const r = Math.sqrt(dx * dx + dy * dy);
      let a = Math.exp(-r * r * 60) + 0.5 * Math.exp(-Math.abs(dx) * 60) * Math.exp(-Math.abs(dy) * 3.5) + 0.5 * Math.exp(-Math.abs(dy) * 60) * Math.exp(-Math.abs(dx) * 3.5);
      a = Math.min(1, a) * Math.max(0, 1 - r);
      const i = (y * 128 + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = a * 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return new THREE.CanvasTexture(c);
});

export const puffTexture = () => once('puff', () => {
  const [c, ctx] = canvas(128);
  const img = ctx.createImageData(128, 128);
  const r = mulberry32(9);
  const blobs = Array.from({ length: 14 }, () => [32 + r() * 64, 32 + r() * 64, 12 + r() * 26]);
  for (let y = 0; y < 128; y++) {
    for (let x = 0; x < 128; x++) {
      let a = 0;
      for (const [bx, by, br] of blobs) {
        const d = Math.hypot(x - bx, y - by) / br;
        a += Math.max(0, 1 - d * d) * 0.35;
      }
      const edge = Math.max(0, 1 - Math.hypot(x - 64, y - 64) / 64);
      const i = (y * 128 + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.min(255, a * edge * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  return new THREE.CanvasTexture(c);
});

// Vertical fade used for sword and bolt trails (u along trail, v across).
export const trailTexture = () => once('trail', () => {
  const [c, ctx] = canvas(64, 64);
  const img = ctx.createImageData(64, 64);
  for (let y = 0; y < 64; y++) {
    const v = Math.abs(y / 63 - 0.5) * 2;
    for (let x = 0; x < 64; x++) {
      const u = x / 63;
      const a = Math.pow(1 - v, 1.6) * Math.pow(u, 1.3);
      const i = (y * 64 + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = a * 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return new THREE.CanvasTexture(c);
});

// Greebled hull panels for stations, gates and ships.
export const hullTextures = () => once('hull', () => {
  const s = 512;
  const [c, ctx] = canvas(s);
  const [rc, rctx] = canvas(s);
  const r = mulberry32(77);
  ctx.fillStyle = '#7a8392';
  ctx.fillRect(0, 0, s, s);
  rctx.fillStyle = '#7a7a7a';
  rctx.fillRect(0, 0, s, s);
  const panel = (x, y, w, h, depth) => {
    const shade = 100 + Math.floor(r() * 50);
    ctx.fillStyle = `rgb(${shade},${shade + 6},${shade + 16})`;
    ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
    ctx.strokeStyle = 'rgba(20,24,32,0.85)';
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
    const rough = 90 + Math.floor(r() * 90);
    rctx.fillStyle = `rgb(${rough},${rough},${rough})`;
    rctx.fillRect(x, y, w, h);
    if (depth > 0 && w > 24 && h > 24 && r() < 0.75) {
      if (r() < 0.5) {
        const k = 0.3 + r() * 0.4;
        panel(x, y, w * k, h, depth - 1);
        panel(x + w * k, y, w * (1 - k), h, depth - 1);
      } else {
        const k = 0.3 + r() * 0.4;
        panel(x, y, w, h * k, depth - 1);
        panel(x, y + h * k, w, h * (1 - k), depth - 1);
      }
    } else if (r() < 0.3) {
      ctx.fillStyle = 'rgba(30,34,44,0.6)';
      for (let i = 0; i < 4; i++) ctx.fillRect(x + 6 + i * 7, y + 6, 4, Math.min(h - 12, 20));
    }
  };
  for (let y = 0; y < s; y += 128) for (let x = 0; x < s; x += 128) panel(x, y, 128, 128, 4);
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = 8;
  const rough = new THREE.CanvasTexture(rc);
  rough.wrapS = rough.wrapT = THREE.RepeatWrapping;
  return { map, rough };
});

// Lit windows for habitat rings.
export const windowTexture = () => once('windows', () => {
  const [c, ctx] = canvas(512, 64);
  const r = mulberry32(31);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, 512, 64);
  for (let row = 0; row < 3; row++) {
    for (let x = 4; x < 508; x += 9) {
      if (r() < 0.62) {
        const warm = r() < 0.7;
        ctx.fillStyle = warm ? `rgba(255,${200 + Math.floor(r() * 40)},140,${0.6 + r() * 0.4})` : `rgba(140,230,255,${0.6 + r() * 0.4})`;
        ctx.fillRect(x, 12 + row * 16, 5, 7);
      }
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  return t;
});

// Neon circuitry for the cyber gauntlets.
export const circuitTexture = () => once('circuit', () => {
  const s = 256;
  const [c, ctx] = canvas(s);
  const r = mulberry32(5);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, s, s);
  ctx.strokeStyle = '#fff';
  ctx.lineCap = 'round';
  for (let i = 0; i < 26; i++) {
    let x = Math.floor(r() * 16) * 16, y = Math.floor(r() * 16) * 16;
    ctx.lineWidth = r() < 0.3 ? 2.5 : 1.4;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let k = 0; k < 5; k++) {
      if (r() < 0.5) x += (r() < 0.5 ? -1 : 1) * 16 * (1 + Math.floor(r() * 3));
      else y += 16 * (1 + Math.floor(r() * 3));
      ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(x, y, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
});

// Neon sign text for stations.
export function signTexture(text, color = '#3ef2ff') {
  const [c, ctx] = canvas(1024, 160);
  ctx.font = '700 92px Orbitron, Rajdhani, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = color;
  ctx.shadowBlur = 24;
  ctx.fillStyle = color;
  ctx.fillText(text, 512, 84);
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#ffffff';
  ctx.globalAlpha = 0.85;
  ctx.fillText(text, 512, 84);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// A small spiral galaxy for the skybox.
export function galaxyTexture(color, seed) {
  const rnd = mulberry32(seed);
  const s = 256;
  const [c, ctx] = canvas(s);
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,245,230,0.95)');
  g.addColorStop(0.1, 'rgba(255,230,200,0.4)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const arms = 2 + Math.floor(rnd() * 2);
  for (let i = 0; i < 3200; i++) {
    const arm = i % arms;
    const t = Math.pow(rnd(), 0.7);
    const ang = t * 7 + (arm / arms) * Math.PI * 2 + (rnd() - 0.5) * 0.55;
    const r = t * s * 0.46;
    const x = s / 2 + Math.cos(ang) * r + (rnd() - 0.5) * 7;
    const y = s / 2 + Math.sin(ang) * r * 0.55 + (rnd() - 0.5) * 5;
    const a = (1 - t) * 0.55;
    ctx.fillStyle = rnd() < 0.3 ? `rgba(255,255,255,${a})` : `${color}${Math.floor(a * 255).toString(16).padStart(2, '0')}`;
    ctx.fillRect(x, y, 1.5, 1.5);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
