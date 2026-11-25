// Place search and naming for the real map, from OpenStreetMap's Nominatim service
// (https://nominatim.org). Its usage policy asks for at most one request a second, no
// search-as-you-type, and caching, so: searches run only on Enter, names are cached, and
// every request waits its turn in one queue.

const BASE = 'https://nominatim.openstreetmap.org';
let last = 0;
let queue = Promise.resolve();

function call(path) {
  const run = queue.then(async () => {
    const wait = last + 1100 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    last = Date.now();
    const sep = path.includes('?') ? '&' : '?';
    const res = await fetch(`${BASE}${path}${sep}format=jsonv2&accept-language=${encodeURIComponent(navigator.language || 'en')}`);
    if (!res.ok) throw new Error('Place lookup failed');
    return res.json();
  });
  queue = run.catch(() => {});
  return run;
}

// [{ name, bbox: [west, south, east, north] }]
export async function searchPlaces(q) {
  const rows = await call(`/search?q=${encodeURIComponent(q)}&limit=5`);
  return rows.map((r) => {
    const [s, n, w, e] = r.boundingbox.map(Number);
    return { name: r.display_name, short: r.name || r.display_name.split(',')[0], bbox: [w, s, e, n] };
  });
}

const names = new Map();
const KEY = 'sas:whereto:names';
try { for (const [k, v] of JSON.parse(localStorage.getItem(KEY) || '[]')) names.set(k, v); } catch { /* no storage */ }
const keep = () => { try { localStorage.setItem(KEY, JSON.stringify([...names].slice(-300))); } catch { /* full or blocked */ } };

// A short name for an area around (lon, lat) about `meters` across: a neighbourhood or town
// for small areas, a region for bigger ones, a country for huge ones.
export function placeName(lon, lat, meters) {
  const zoom = meters > 1_500_000 ? 3 : meters > 300_000 ? 5 : meters > 60_000 ? 8 : meters > 8_000 ? 10 : 14;
  const key = `${lon.toFixed(zoom >= 10 ? 2 : 1)},${lat.toFixed(zoom >= 10 ? 2 : 1)},${zoom}`;
  if (names.has(key)) return Promise.resolve(names.get(key));
  return call(`/reverse?lat=${lat}&lon=${lon}&zoom=${zoom}`).then((r) => {
    const a = r?.address || {};
    const local = a.suburb || a.neighbourhood || a.quarter || a.city_district;
    const town = a.city || a.town || a.village || a.municipality || a.county;
    const region = a.state || a.region || a.province || a.state_district;
    const parts = zoom >= 14 ? [local, town] : zoom >= 10 ? [town, region || a.country] : zoom >= 5 ? [region || town, a.country] : [a.country];
    const out = [...new Set(parts.filter(Boolean))].join(', ') || r?.name || null;
    names.set(key, out);
    keep();
    return out;
  }).catch(() => null);
}
