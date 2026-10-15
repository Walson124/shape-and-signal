import * as THREE from 'three';
import { mulberry32 } from '../core/rng.js';
import { REGIONS, regionForTier, makeName, BOSSES } from '../game/data.js';

// An endless, deterministic galaxy. Space is split into cubic sectors (light
// years); each sector's stars come from a hash of its coordinates, so any
// star can be regenerated from its key alone.
export const SECTOR = 25;
export const HOME_KEY = 'home';
export const CORE_KEY = 'core';
export const ATLAS_KEY = 'atlas-reach';
export const CORE_POS = new THREE.Vector3(60, 0, -470);

function sectorSeed(x, y, z) {
  let h = Math.imul(x | 0, 73856093) ^ Math.imul(y | 0, 19349663) ^ Math.imul(z | 0, 83492791);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

function poisson(r, mean) {
  const L = Math.exp(-mean);
  let k = 0, p = 1;
  do { k++; p *= r(); } while (p > L && k < 12);
  return k - 1;
}

function makeStar(key, pos, seed, forced = {}) {
  const r = mulberry32(seed);
  const d = pos.length();
  let tier = Math.max(0, Math.min(9, d / 48 + (r() - 0.5) * 0.8));
  if (forced.tier !== undefined) tier = forced.tier;
  const region = regionForTier(tier);
  const reg = REGIONS[region];
  const cls = forced.cls || reg.stars[Math.floor(r() * reg.stars.length)];
  let name = forced.name || makeName(r);
  if (!forced.name && r() < 0.35) name += ` ${['Prime', 'Minor', 'Major', 'Reach', 'Deep', 'Verge', 'Gate'][Math.floor(r() * 7)]}`;
  let boss = forced.boss ?? null;
  if (boss === null && key !== HOME_KEY && tier >= reg.minTier + 0.3 && r() < 0.07 && reg.boss !== BOSSES.length - 1) boss = reg.boss;
  return { key, pos, seed, tier, region, cls, name, boss, designation: `${reg.cn}-${(seed % 9000) + 1000}` };
}

const HOME = makeStar(HOME_KEY, new THREE.Vector3(0, 0, 0), 0x51ace, { tier: 0, cls: 'yellow', name: 'Solace' });
const CORE = makeStar(CORE_KEY, CORE_POS.clone(), 0xc0de, { tier: 8.6, cls: 'violet', name: 'Primordial Heart', boss: BOSSES.length - 1 });
const ATLAS = makeStar(ATLAS_KEY, new THREE.Vector3(0, 0, -180), 0xa71a5, { tier: 3.6, cls: 'yellow', name: 'Atlas Reach' });

const sectorCache = new Map();
export function sectorStars(sx, sy, sz) {
  const key = `${sx},${sy},${sz}`;
  let list = sectorCache.get(key);
  if (list) return list;
  const seed = sectorSeed(sx, sy, sz);
  const r = mulberry32(seed);
  const cy = (sy + 0.5) * SECTOR;
  const disc = Math.exp(-((cy / 240) ** 2));
  const n = Math.min(6, poisson(r, 2.6 * disc));
  list = [];
  for (let i = 0; i < n; i++) {
    const pos = new THREE.Vector3((sx + r()) * SECTOR, (sy + r()) * SECTOR, (sz + r()) * SECTOR);
    if (pos.length() < 5 || pos.distanceTo(CORE_POS) < 8) continue;
    list.push(makeStar(`${key}:${i}`, pos, (seed + i * 2654435761) >>> 0));
  }
  sectorCache.set(key, list);
  if (sectorCache.size > 6000) sectorCache.delete(sectorCache.keys().next().value);
  return list;
}

export function getStar(key) {
  if (key === HOME_KEY) return HOME;
  if (key === CORE_KEY) return CORE;
  if (key === ATLAS_KEY) return ATLAS;
  const [sec, idx] = key.split(':');
  const [sx, sy, sz] = sec.split(',').map(Number);
  return sectorStars(sx, sy, sz).find((s) => s.key === key) || HOME;
}

// Stars within `radius` light years of `pos`, nearest first (excluding `pos` itself).
export function starsNear(pos, radius) {
  const out = [];
  const r = Math.ceil(radius / SECTOR);
  const cx = Math.floor(pos.x / SECTOR), cy = Math.floor(pos.y / SECTOR), cz = Math.floor(pos.z / SECTOR);
  for (let x = cx - r; x <= cx + r; x++) {
    for (let y = cy - r; y <= cy + r; y++) {
      for (let z = cz - r; z <= cz + r; z++) {
        for (const s of sectorStars(x, y, z)) {
          const d = s.pos.distanceTo(pos);
          if (d <= radius && d > 0.01) out.push({ star: s, dist: d });
        }
      }
    }
  }
  for (const s of [HOME, CORE, ATLAS]) {
    const d = s.pos.distanceTo(pos);
    if (d <= radius && d > 0.01) out.push({ star: s, dist: d });
  }
  out.sort((a, b) => a.dist - b.dist);
  return out;
}

// Direction toward the galactic core, used to light the sky.
export function coreDirection(pos) {
  return CORE_POS.clone().sub(pos).normalize();
}
