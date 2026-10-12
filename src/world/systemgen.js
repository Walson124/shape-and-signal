import { mulberry32 } from '../core/rng.js';
import { REGIONS, STAR_TYPES, PLANET_INFO, makeName, ROMAN } from '../game/data.js';
import { HOME_KEY } from './galaxy.js';
import { makeTerrain } from './terrain.js';

// Search the bare terrain for a flat, dry spot to build a settlement on.
function findSite(body, siteR, prefLat, fine) {
  const T = makeTerrain({ key: 'probe', type: body.type, seed: body.seed, radius: body.radius, amp: body.amp, sea: body.sea });
  const sea = body.sea ?? -Infinity;
  const R = body.radius;
  const latStep = fine ? 3 : 8, lonStep = fine ? 5 : 12;
  let best = null, bestScore = -Infinity;
  for (let lat = -42; lat <= 42; lat += latStep) {
    for (let lon = 0; lon < 360; lon += lonStep) {
      const d = dirFromLatLon(lat, lon);
      const h0 = T.height(d[0], d[1], d[2]);
      if (h0 < sea + body.amp * 0.05) continue;
      const east = [-d[2], 0, d[0]];
      const el = Math.hypot(...east) || 1;
      east[0] /= el; east[2] /= el;
      const north = [d[1] * east[2] - d[2] * east[1], d[2] * east[0] - d[0] * east[2], d[0] * east[1] - d[1] * east[0]];
      let minH = h0, maxH = h0, sum = h0, n = 1;
      for (const rr of fine ? [0.5, 1, 1.6, 2.4] : [0.8, 1.6]) {
        const a = (rr * siteR) / R;
        for (let k = 0; k < 8; k++) {
          const th = (k / 8) * Math.PI * 2;
          const v = [0, 1, 2].map((i) => d[i] + (east[i] * Math.cos(th) + north[i] * Math.sin(th)) * a);
          const vl = Math.hypot(...v);
          const h = T.height(v[0] / vl, v[1] / vl, v[2] / vl);
          minH = Math.min(minH, h); maxH = Math.max(maxH, h); sum += h; n++;
        }
      }
      if (minH < sea + body.amp * 0.01) continue;
      const score = -(maxH - minH) / body.amp * 10 - Math.abs(lat - prefLat) * 0.05;
      if (score > bestScore) { bestScore = score; best = { d, h: Math.max(sum / n, sea + body.amp * 0.04) }; }
    }
  }
  if (!best) best = { d: dirFromLatLon(prefLat, 40), h: Math.max(0, sea) + body.amp * 0.1 };
  return { x: best.d[0], y: best.d[1], z: best.d[2], height: best.h };
}
const latLonOf = (s) => [Math.asin(s.y) * 180 / Math.PI, Math.atan2(s.z, s.x) * 180 / Math.PI];

// Lays out a star system: star, planets on inclined elliptical orbits, moons,
// belts, comets, stations, cities and points of interest. Units are metres
// and seconds.

// Everything is laid out at a compact base scale, then multiplied by WORLD_SCALE.
export const WORLD_SCALE = 3;
const S = WORLD_SCALE;
const ATMO_HEIGHT = { terran: 0.15, toxic: 0.15, desert: 0.11, ice: 0.09, lava: 0.11, crystal: 0.1, gas: 0.04, rocky: 0 };
const AMP = { terran: 0.075, desert: 0.05, ice: 0.06, lava: 0.07, toxic: 0.05, crystal: 0.085, rocky: 0.06 };
const range = (r, a, b) => a + (b - a) * r();

function orbitRate(a, scale = 300e3, k = 0.00035) {
  return k * Math.pow(scale / a, 1.5);
}

function dirFromLatLon(lat, lon) {
  const la = (lat * Math.PI) / 180, lo = (lon * Math.PI) / 180;
  return [Math.cos(la) * Math.cos(lo), Math.sin(la), Math.cos(la) * Math.sin(lo)];
}

function randomDir(r) {
  const u = r() * 2 - 1, th = r() * Math.PI * 2, s = Math.sqrt(1 - u * u);
  return [s * Math.cos(th), u * 0.85, s * Math.sin(th)].map((v, i, a) => v / Math.hypot(...a));
}

function makeBody(r, def) {
  const info = PLANET_INFO[def.type];
  const radius = def.radius * S;
  const body = {
    id: def.id,
    kind: def.kind,
    parent: def.parent || null,
    name: def.name,
    type: def.type,
    radius,
    seed: def.seed,
    tier: def.tier,
    landable: info.landable,
    amp: def.type === 'gas' ? 0 : radius * AMP[def.type],
    sea: null,
    atmo: null,
    ocean: null,
    clouds: false,
    rings: null,
    orbit: {
      a: def.a * S,
      e: def.e ?? range(r, 0, 0.08),
      inc: def.inc ?? range(r, -0.12, 0.12),
      node: r() * Math.PI * 2,
      peri: r() * Math.PI * 2,
      phase: def.phase ?? r() * Math.PI * 2,
      rate: def.rate ?? orbitRate(def.a),
    },
    spin: { period: def.spin ?? range(r, 1500, 4800), tilt: def.tilt ?? range(r, -0.35, 0.35) },
    sites: { city: null, outposts: [] },
    pois: [],
  };
  if (info.atmo && !(def.kind === 'moon' && def.type === 'rocky')) {
    body.atmo = { color: info.atmo, height: ATMO_HEIGHT[def.type] };
  }
  if (info.ocean) {
    body.ocean = info.ocean === 'lava' ? { lava: true, color: 0xff5a1a } : { lava: false, color: info.ocean };
    body.sea = def.type === 'lava' ? body.amp * 0.02 : 0;
  }
  body.clouds = def.type === 'terran' || def.type === 'toxic' || (def.type === 'ice' && r() < 0.5);
  if (def.type === 'gas' && (def.rings ?? r() < 0.6)) body.rings = { inner: radius * 1.4, outer: radius * 2.3, tilt: range(r, -0.3, 0.3) };
  return body;
}

function addPois(r, body, counts) {
  const kinds = [];
  for (const [k, n] of Object.entries(counts)) for (let i = 0; i < n; i++) kinds.push(k);
  kinds.forEach((kind, i) => {
    body.pois.push({ id: `${body.id}:${kind}${i}`, kind, dir: randomDir(r), seed: Math.floor(r() * 1e9) });
  });
}

export function generateSystem(star) {
  const r = mulberry32(star.seed ^ 0x9e3779b9);
  const st = STAR_TYPES[star.cls];
  const reg = REGIONS[star.region];
  const isHome = star.key === HOME_KEY;
  const sys = {
    star,
    starRadius: range(r, st.r[0], st.r[1]),
    bodies: [],
    belts: [],
    comets: [],
    stations: [],
    nebulae: [],
    boss: star.boss,
  };
  const tierOf = () => Math.max(0, star.tier + (r() - 0.5) * 0.6);

  if (isHome) {
    sys.starRadius = 52000;
    const defs = [
      { id: 'p0', name: 'Ember', type: 'lava', radius: 2600, a: 420e3, tier: 0.6 },
      { id: 'p1', name: 'Cinder', type: 'rocky', radius: 3200, a: 700e3, tier: 0.5 },
      { id: 'p2', name: 'Terra', type: 'terran', radius: 6200, a: 1.15e6, tier: 0, spin: 1800, tilt: 0.2, e: 0.02, inc: 0.0, phase: 0.6 },
      { id: 'p3', name: 'Dune', type: 'desert', radius: 4400, a: 1.8e6, tier: 0.8 },
      { id: 'p4', name: 'Titanus', type: 'gas', radius: 30000, a: 3.0e6, tier: 1.2, rings: true },
      { id: 'p5', name: 'Glacis', type: 'ice', radius: 3800, a: 4.6e6, tier: 1.5 },
    ];
    for (const d of defs) sys.bodies.push(makeBody(r, { ...d, kind: 'planet', seed: Math.floor(r() * 1e9) }));
    const terra = sys.bodies[2];
    terra.sites.city = { ...findSite(terra, 340, 18, true), radius: 340, name: 'Base City 07', main: true };
    const [cLat, cLon] = latLonOf(terra.sites.city);
    addPois(r, terra, { ruin: 3, spring: 6, ore: 12, nest: 8, wreck: 4 });
    // guarantee a spring and an ore field near the city
    const near = (dlat, dlon) => dirFromLatLon(cLat + dlat / S, cLon + dlon / S);
    terra.pois.find((p) => p.kind === 'spring').dir = near(-4.5, 6);
    terra.pois.find((p) => p.kind === 'ore').dir = near(5, -7);
    terra.pois.find((p) => p.kind === 'nest').dir = near(-9, -10);
    terra.pois.find((p) => p.kind === 'ruin').dir = near(15, 14);
    terra.pois.find((p) => p.kind === 'wreck').dir = near(-16, 13);
    const moons = [
      { id: 'p2m0', parent: 'p2', name: 'Luna', type: 'rocky', radius: 1500, a: 30e3, rate: 0.0028, tier: 0.4, spin: 3600 },
      { id: 'p4m0', parent: 'p4', name: 'Rime', type: 'ice', radius: 1900, a: 100e3, rate: 0.0016, tier: 1.3 },
      { id: 'p4m1', parent: 'p4', name: 'Vesk', type: 'rocky', radius: 1300, a: 150e3, rate: 0.0011, tier: 1.2 },
      { id: 'p4m2', parent: 'p4', name: 'Toxa', type: 'toxic', radius: 2300, a: 210e3, rate: 0.0008, tier: 1.6 },
    ];
    for (const m of moons) sys.bodies.push(makeBody(r, { ...m, kind: 'moon', seed: Math.floor(r() * 1e9), e: 0.01, inc: range(r, -0.08, 0.08) }));
    for (const b of sys.bodies) {
      if (b.id === 'p2' || !b.landable) continue;
      addPois(r, b, { ruin: b.id === 'p2m0' || r() < 0.5 ? 1 + Math.floor(r() * 2) : 0, spring: 2 + Math.floor(r() * 3), ore: 4 + Math.floor(r() * 5), nest: 2 + Math.floor(r() * 3), wreck: 1 + Math.floor(r() * 2) });
    }
    sys.stations.push({ id: 's0', name: 'Martial Hall Orbital', parent: 'p2', a: 15000 * S, rate: 0.006, phase: 1.2, inc: 0.15 });
    sys.belts.push({ radius: 2.35e6 * S, width: 180e3 * S, thickness: 18e3 * S, inc: 0.03, seed: Math.floor(r() * 1e9) });
    sys.comets.push({ a: 3.2e6 * S, e: 0.82, inc: 0.4, node: 1.1, peri: 2.2, phase: 0.3, rate: orbitRate(3.2e6, 300e3, 0.0012), seed: Math.floor(r() * 1e9) });
    sys.nebulae.push({ dir: [0.3, 0.2, -0.93], dist: 5.4e6 * S, radius: 120e3 * S, density: 4 });
    sys.starRadius *= S;
    return sys;
  }

  const lumR = Math.sqrt(st.lum);
  const count = 4 + Math.floor(r() * 5);
  let a = sys.starRadius * 6 + range(r, 250e3, 420e3);
  const civilized = star.tier <= 4.2;
  for (let i = 0; i < count; i++) {
    const zone = a / (1.3e6 * lumR);
    let type;
    if (zone < 0.6) type = r() < 0.6 ? 'lava' : r() < 0.5 ? 'rocky' : 'desert';
    else if (zone < 1.6) type = reg.planets[Math.floor(r() * reg.planets.length)];
    else type = r() < 0.55 ? 'gas' : r() < 0.6 ? 'ice' : 'rocky';
    if (type === 'terran' && star.region > 2 && r() < 0.6) type = 'crystal';
    const radius = type === 'gas' ? range(r, 22000, 40000) : type === 'terran' ? range(r, 4800, 7000) : range(r, 2400, 5200);
    const body = makeBody(r, { id: `p${i}`, kind: 'planet', name: `${star.name.split(' ')[0]} ${ROMAN[i]}`, type, radius, a, tier: tierOf(), seed: Math.floor(r() * 1e9) });
    sys.bodies.push(body);
    const moonCount = type === 'gas' ? 1 + Math.floor(r() * 3) : radius > 4000 && r() < 0.4 ? 1 : 0;
    for (let m = 0; m < moonCount; m++) {
      const mt = r() < 0.5 ? 'rocky' : type === 'gas' ? (r() < 0.5 ? 'ice' : reg.planets[Math.floor(r() * reg.planets.length)]) : 'rocky';
      const mr = range(r, 1000, 2400);
      const ma = radius * (type === 'gas' ? 3.2 + m * 1.8 : 4.5 + m * 2) + range(r, 0, radius);
      sys.bodies.push(makeBody(r, { id: `p${i}m${m}`, parent: body.id, kind: 'moon', name: `${body.name}-${String.fromCharCode(97 + m)}`, type: mt === 'gas' ? 'rocky' : mt, radius: mr, a: ma, rate: 0.03 / Math.pow(ma / 1000, 0.75), tier: tierOf(), seed: Math.floor(r() * 1e9), e: range(r, 0, 0.04) }));
    }
    a *= range(r, 1.45, 1.85);
    if (i === Math.floor(count / 2) && r() < 0.65) {
      sys.belts.push({ radius: a * 0.82 * S, width: a * 0.08 * S, thickness: a * 0.008 * S, inc: range(r, -0.05, 0.05), seed: Math.floor(r() * 1e9) });
    }
  }
  const landable = sys.bodies.filter((b) => b.landable);
  for (const b of landable) {
    const t = b.tier;
    addPois(r, b, { ruin: (r() < 0.45 + t * 0.06 ? 1 : 0) + (r() < 0.3 ? 1 : 0), spring: 2 + Math.floor(r() * 3), ore: 4 + Math.floor(r() * 5), nest: 2 + Math.floor(r() * 3), wreck: 1 + Math.floor(r() * 2) });
    if (civilized && b.atmo && b.kind === 'planet' && r() < 0.45) {
      b.sites.outposts.push({ ...findSite(b, 120, (r() - 0.5) * 60, false), radius: 120, name: `${b.name} Outpost` });
    }
  }
  if (civilized && sys.bodies.length) {
    const host = sys.bodies.filter((b) => b.kind === 'planet')[Math.floor(r() * count)];
    if (host) sys.stations.push({ id: 's0', name: `${star.name.split(' ')[0]} Exchange`, parent: host.id, a: host.radius * 2.6 + 4000 * S, rate: 0.004, phase: r() * 6.28, inc: range(r, -0.3, 0.3) });
  }
  if (star.boss !== null && landable.length) {
    const lair = landable[landable.length - 1];
    lair.pois.push({ id: `${lair.id}:lair`, kind: 'lair', dir: randomDir(r), seed: 7 });
    sys.lairBody = lair.id;
  }
  const cometCount = Math.floor(r() * 3);
  for (let i = 0; i < cometCount; i++) {
    const ca = a * range(r, 0.6, 1.1);
    sys.comets.push({ a: ca * S, e: range(r, 0.6, 0.9), inc: range(r, -0.8, 0.8), node: r() * 6.28, peri: r() * 6.28, phase: r() * 6.28, rate: orbitRate(ca, 300e3, 0.001), seed: Math.floor(r() * 1e9) });
  }
  const nebCount = Math.floor(r() * 3);
  for (let i = 0; i < nebCount; i++) {
    sys.nebulae.push({ dir: randomDir(r), dist: a * range(r, 0.5, 1.1) * S, radius: range(r, 80e3, 160e3) * S, density: range(r, 3, 5) });
  }
  sys.starRadius *= S;
  return sys;
}
