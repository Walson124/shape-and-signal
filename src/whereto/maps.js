import { geoNaturalEarth1, geoPath } from 'd3-geo';
import { feature, mesh } from 'topojson-client';
import worldUrl from 'world-atlas/countries-50m.json?url';
import usUrl from 'us-atlas/states-albers-10m.json?url';

// The maps a Whereto plan can use. Each one comes out as a "map def":
//   { w, h, under, over, spots: [{ id, name, ... }], labels, pointR }
// where `under`/`over` are SVG drawn below/above the spots, and each spot is an area
// (`d`, an SVG path), a point (`cx`, `cy`) or a box (`x`, `y`, `w`, `h`, in map units).
// Spot ids are what people's marks are stored under, so they must never change.

export const BUILTINS = {
  world: { label: 'World · countries', blurb: 'Pick countries. Good for big trips.', kinds: ['travel'] },
  cities: { label: 'World · cities', blurb: '120+ popular destinations.', kinds: ['travel'] },
  usa: { label: 'United States', blurb: 'Pick states. Road trips, reunions.', kinds: ['travel', 'meet'] },
  office: { label: 'Sample office', blurb: 'A floor plan with rooms. Try it, then upload yours.', kinds: ['meet'] },
};

const slug = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const cache = new Map();
const getJson = (url) => {
  if (!cache.has(url)) cache.set(url, fetch(url).then((r) => { if (!r.ok) throw new Error('map download failed'); return r.json(); }));
  return cache.get(url);
};

// ------------------------------------------------------------------ world

async function worldBase() {
  const topo = await getJson(worldUrl);
  const all = feature(topo, topo.objects.countries).features;
  const countries = all.filter((f) => f.properties.name !== 'Antarctica');
  const W = 960, H = 500;
  const projection = geoNaturalEarth1().fitExtent([[6, 6], [W - 6, H - 6]], { type: 'FeatureCollection', features: countries });
  const path = geoPath(projection).digits(1);
  const borders = path(mesh(topo, topo.objects.countries, (a, b) => a !== b));
  const h = Math.ceil(path.bounds({ type: 'FeatureCollection', features: countries })[1][1] + 6);
  return { W, H: h, projection, path, countries, borders };
}

async function worldMap() {
  const b = await worldBase();
  const spots = b.countries.map((f) => ({
    id: `c${f.id ?? slug(f.properties.name)}`,
    name: f.properties.name,
    d: b.path(f),
  })).filter((s) => s.d);
  return { w: b.W, h: b.H, under: '', over: `<path class="borders" d="${b.borders}"/>`, spots, labels: false };
}

// [name, country, lat, lon]
const CITIES = [
  ['London', 'UK', 51.507, -0.128], ['Paris', 'France', 48.857, 2.352], ['Rome', 'Italy', 41.903, 12.496],
  ['Barcelona', 'Spain', 41.385, 2.173], ['Madrid', 'Spain', 40.417, -3.704], ['Lisbon', 'Portugal', 38.722, -9.139],
  ['Porto', 'Portugal', 41.158, -8.629], ['Seville', 'Spain', 37.389, -5.984], ['Amsterdam', 'Netherlands', 52.368, 4.904],
  ['Brussels', 'Belgium', 50.85, 4.352], ['Berlin', 'Germany', 52.52, 13.405], ['Munich', 'Germany', 48.135, 11.582],
  ['Prague', 'Czechia', 50.075, 14.438], ['Vienna', 'Austria', 48.208, 16.373], ['Budapest', 'Hungary', 47.498, 19.04],
  ['Kraków', 'Poland', 50.065, 19.945], ['Zurich', 'Switzerland', 47.377, 8.54], ['Nice', 'France', 43.71, 7.262],
  ['Milan', 'Italy', 45.464, 9.19], ['Venice', 'Italy', 45.441, 12.316], ['Florence', 'Italy', 43.77, 11.256],
  ['Amalfi Coast', 'Italy', 40.634, 14.603], ['Dubrovnik', 'Croatia', 42.65, 18.094], ['Athens', 'Greece', 37.984, 23.728],
  ['Santorini', 'Greece', 36.393, 25.461], ['Istanbul', 'Türkiye', 41.008, 28.978], ['Dublin', 'Ireland', 53.35, -6.26],
  ['Edinburgh', 'UK', 55.953, -3.189], ['Copenhagen', 'Denmark', 55.676, 12.568], ['Stockholm', 'Sweden', 59.329, 18.069],
  ['Oslo', 'Norway', 59.914, 10.752], ['Helsinki', 'Finland', 60.17, 24.938], ['Reykjavík', 'Iceland', 64.147, -21.943],
  ['Tbilisi', 'Georgia', 41.716, 44.783],
  ['Dubai', 'UAE', 25.205, 55.271], ['Doha', 'Qatar', 25.285, 51.531], ['Jerusalem', 'Israel', 31.768, 35.214],
  ['Petra', 'Jordan', 30.329, 35.444], ['Cairo', 'Egypt', 30.044, 31.236], ['Marrakech', 'Morocco', 31.629, -7.981],
  ['Cape Town', 'South Africa', -33.925, 18.424], ['Nairobi', 'Kenya', -1.292, 36.822], ['Zanzibar', 'Tanzania', -6.165, 39.202],
  ['Victoria Falls', 'Zimbabwe', -17.925, 25.856], ['Lagos', 'Nigeria', 6.524, 3.379], ['Accra', 'Ghana', 5.604, -0.187],
  ['Mauritius', 'Mauritius', -20.161, 57.501],
  ['Tokyo', 'Japan', 35.676, 139.65], ['Kyoto', 'Japan', 35.012, 135.768], ['Osaka', 'Japan', 34.694, 135.502],
  ['Seoul', 'South Korea', 37.566, 126.978], ['Busan', 'South Korea', 35.18, 129.075], ['Beijing', 'China', 39.904, 116.407],
  ['Shanghai', 'China', 31.23, 121.474], ['Chengdu', 'China', 30.573, 104.066], ["Xi'an", 'China', 34.341, 108.94],
  ['Hong Kong', 'China', 22.32, 114.17], ['Taipei', 'Taiwan', 25.033, 121.565], ['Singapore', 'Singapore', 1.352, 103.82],
  ['Bangkok', 'Thailand', 13.756, 100.502], ['Chiang Mai', 'Thailand', 18.788, 98.985], ['Phuket', 'Thailand', 7.88, 98.392],
  ['Bali', 'Indonesia', -8.65, 115.217], ['Hanoi', 'Vietnam', 21.028, 105.854], ['Ho Chi Minh City', 'Vietnam', 10.823, 106.63],
  ['Siem Reap', 'Cambodia', 13.364, 103.86], ['Kuala Lumpur', 'Malaysia', 3.139, 101.687], ['Manila', 'Philippines', 14.599, 120.984],
  ['Mumbai', 'India', 19.076, 72.878], ['Delhi', 'India', 28.614, 77.209], ['Jaipur', 'India', 26.912, 75.787],
  ['Goa', 'India', 15.3, 74.124], ['Kathmandu', 'Nepal', 27.717, 85.324], ['Maldives', 'Maldives', 4.175, 73.509],
  ['Colombo', 'Sri Lanka', 6.927, 79.861], ['Ulaanbaatar', 'Mongolia', 47.886, 106.906],
  ['Sydney', 'Australia', -33.869, 151.209], ['Melbourne', 'Australia', -37.814, 144.963], ['Brisbane', 'Australia', -27.47, 153.026],
  ['Perth', 'Australia', -31.95, 115.86], ['Cairns', 'Australia', -16.92, 145.77], ['Auckland', 'New Zealand', -36.848, 174.763],
  ['Queenstown', 'New Zealand', -45.031, 168.663], ['Fiji', 'Fiji', -17.78, 177.416], ['Bora Bora', 'French Polynesia', -16.5, -151.741],
  ['Honolulu', 'USA', 21.307, -157.858],
  ['New York', 'USA', 40.713, -74.006], ['Boston', 'USA', 42.36, -71.059], ['Washington, DC', 'USA', 38.907, -77.037],
  ['Miami', 'USA', 25.762, -80.192], ['Orlando', 'USA', 28.538, -81.379], ['New Orleans', 'USA', 29.951, -90.072],
  ['Nashville', 'USA', 36.163, -86.781], ['Chicago', 'USA', 41.878, -87.63], ['Austin', 'USA', 30.267, -97.743],
  ['Denver', 'USA', 39.739, -104.99], ['Las Vegas', 'USA', 36.17, -115.14], ['Grand Canyon', 'USA', 36.107, -112.113],
  ['Yellowstone', 'USA', 44.428, -110.588], ['Los Angeles', 'USA', 34.052, -118.244], ['San Francisco', 'USA', 37.775, -122.419],
  ['Seattle', 'USA', 47.606, -122.332], ['Anchorage', 'USA', 61.218, -149.9], ['Toronto', 'Canada', 43.653, -79.383],
  ['Montreal', 'Canada', 45.502, -73.567], ['Quebec City', 'Canada', 46.813, -71.208], ['Vancouver', 'Canada', 49.283, -123.121],
  ['Banff', 'Canada', 51.178, -115.571], ['Mexico City', 'Mexico', 19.433, -99.133], ['Oaxaca', 'Mexico', 17.073, -96.726],
  ['Cancún', 'Mexico', 21.162, -86.851], ['Tulum', 'Mexico', 20.211, -87.465], ['Havana', 'Cuba', 23.114, -82.366],
  ['San Juan', 'Puerto Rico', 18.466, -66.106], ['Punta Cana', 'Dominican Republic', 18.582, -68.405],
  ['San José', 'Costa Rica', 9.928, -84.091], ['Panama City', 'Panama', 8.983, -79.517],
  ['Bogotá', 'Colombia', 4.711, -74.072], ['Medellín', 'Colombia', 6.244, -75.581], ['Cartagena', 'Colombia', 10.391, -75.479],
  ['Quito', 'Ecuador', -0.18, -78.468], ['Galápagos', 'Ecuador', -0.743, -90.313], ['Lima', 'Peru', -12.046, -77.043],
  ['Cusco', 'Peru', -13.532, -71.968], ['La Paz', 'Bolivia', -16.49, -68.119], ['Salar de Uyuni', 'Bolivia', -20.134, -67.489],
  ['Rio de Janeiro', 'Brazil', -22.907, -43.173], ['São Paulo', 'Brazil', -23.551, -46.633], ['Iguazu Falls', 'Argentina', -25.695, -54.437],
  ['Buenos Aires', 'Argentina', -34.604, -58.382], ['Montevideo', 'Uruguay', -34.901, -56.164], ['Santiago', 'Chile', -33.449, -70.669],
  ['Patagonia', 'Argentina', -50.338, -72.265],
];

async function citiesMap() {
  const b = await worldBase();
  const land = b.path({ type: 'FeatureCollection', features: b.countries });
  const spots = CITIES.map(([name, country, lat, lon]) => {
    const [cx, cy] = b.projection([lon, lat]);
    return { id: `p:${slug(name)}`, name, sub: country, cx: Math.round(cx * 10) / 10, cy: Math.round(cy * 10) / 10 };
  });
  return {
    w: b.W, h: b.H,
    under: `<path class="land" d="${land}"/><path class="borders" d="${b.borders}"/>`,
    over: '', spots, labels: false, pointR: 4.2,
  };
}

// ------------------------------------------------------------------ USA

async function usaMap() {
  const topo = await getJson(usUrl);
  const path = geoPath().digits(1);
  const states = feature(topo, topo.objects.states).features;
  const spots = states.map((f) => ({ id: `s${f.id}`, name: f.properties.name, d: path(f) }));
  const borders = path(mesh(topo, topo.objects.states, (a, b) => a !== b));
  return { w: 975, h: 610, under: '', over: `<path class="borders" d="${borders}"/>`, spots, labels: false };
}

// ------------------------------------------------------------------ sample office

const OFFICE_ROOMS = [
  ['boardroom', 'Boardroom', 40, 40, 220, 170],
  ['training', 'Training room', 40, 230, 220, 160],
  ['library', 'Library', 40, 410, 220, 170],
  ['huddle-a', 'Huddle A', 280, 40, 120, 110],
  ['huddle-b', 'Huddle B', 410, 40, 120, 110],
  ['phones', 'Phone booths', 540, 40, 90, 110],
  ['kitchen', 'Kitchen', 650, 40, 160, 150],
  ['lounge', 'Lounge', 830, 40, 130, 250],
  ['desks-n', 'Open desks (north)', 280, 180, 350, 120],
  ['desks-s', 'Open desks (south)', 280, 320, 350, 120],
  ['games', 'Game room', 650, 210, 160, 110],
  ['reception', 'Reception', 650, 340, 160, 100],
  ['terrace', 'Roof terrace', 830, 310, 130, 270],
  ['focus-1', 'Focus 1', 280, 470, 100, 110],
  ['focus-2', 'Focus 2', 390, 470, 100, 110],
  ['focus-3', 'Focus 3', 500, 470, 100, 110],
  ['focus-4', 'Focus 4', 610, 470, 100, 110],
  ['wellness', 'Wellness room', 720, 470, 90, 110],
];

function officeMap() {
  const spots = OFFICE_ROOMS.map(([id, name, x, y, w, h]) => ({ id: `r:${id}`, name, x, y, w, h }));
  const under = `
    <rect class="floor" x="20" y="20" width="960" height="580" rx="6"/>
    <path class="corridor" d="M265 160h375v10H265zM265 450h560v10H265zM635 20v560h10V20zM815 20v560h10V20z"/>
    <rect class="outside" x="826" y="306" width="138" height="278" rx="4"/>
    <g class="compass" transform="translate(940 585)"><text text-anchor="middle" y="-2">N ↑</text></g>`;
  return { w: 1000, h: 620, under, over: '', spots, labels: true };
}

// ------------------------------------------------------------------ uploaded pictures

const COLS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
export const gridName = (c, r) => `${c < 26 ? COLS[c] : COLS[Math.floor(c / 26) - 1] + COLS[c % 26]}${r + 1}`;

export function imageMap(map, imageUrl) {
  const { w, h } = map;
  let spots;
  if (map.spots?.length) {
    spots = map.spots.map((s) => ({ id: s.id, name: s.name, x: s.x * w, y: s.y * h, w: s.w * w, h: s.h * h }));
  } else {
    const { cols, rows } = map.grid;
    const cw = w / cols, ch = h / rows;
    spots = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) spots.push({ id: `g:${c},${r}`, name: gridName(c, r), x: c * cw, y: r * ch, w: cw, h: ch, cell: true });
    }
  }
  return {
    w, h, image: imageUrl,
    under: `<image href="${imageUrl}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="none"/>`,
    over: '', spots, labels: !!map.spots?.length, overlay: true,
  };
}

// a plan's map def
export async function loadMap(plan, imageUrl) {
  const m = plan.map;
  if (m.type === 'image') return imageMap(m, imageUrl);
  if (m.id === 'world') return worldMap();
  if (m.id === 'cities') return citiesMap();
  if (m.id === 'usa') return usaMap();
  return officeMap();
}
