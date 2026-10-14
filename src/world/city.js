import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../core/rng.js';
import { signTexture } from './textures.js';
import { buildShip } from './models.js';
import { addCompiled, cancelAdd } from '../core/precompile.js';
import { VENUES, VENUE_ORDER, interiorLayout, buildInterior, npcGeometry } from './interiors.js';

let facadeTex = null;
function facadeTextures() {
  if (facadeTex) return facadeTex;
  const s = 256;
  const c = document.createElement('canvas');
  c.width = s; c.height = s;
  const e = document.createElement('canvas');
  e.width = s; e.height = s;
  const ctx = c.getContext('2d');
  const ex = e.getContext('2d');
  const r = mulberry32(99);
  ctx.fillStyle = '#4a5462';
  ctx.fillRect(0, 0, s, s);
  ex.fillStyle = '#000';
  ex.fillRect(0, 0, s, s);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const px = x * 32 + 5, py = y * 32 + 7;
      ctx.fillStyle = '#1a2230';
      ctx.fillRect(px, py, 22, 18);
      if (r() < 0.38) {
        const warm = r() < 0.72;
        const a = 0.5 + r() * 0.5;
        ex.fillStyle = warm ? `rgba(255,${190 + Math.floor(r() * 50)},${120 + Math.floor(r() * 40)},${a})` : r() < 0.5 ? `rgba(120,230,255,${a})` : `rgba(255,90,170,${a})`;
        ex.fillRect(px + 1, py + 1, 20, 16);
      }
    }
  }
  ctx.fillStyle = '#5c6676';
  for (let y = 0; y < 8; y++) ctx.fillRect(0, y * 32, s, 3);
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = 8;
  const emap = new THREE.CanvasTexture(e);
  emap.colorSpace = THREE.SRGBColorSpace;
  emap.wrapS = emap.wrapT = THREE.RepeatWrapping;
  facadeTex = { map, emap };
  return facadeTex;
}

// Box with UVs scaled so windows stay the same size on any building.
function facadeBox(w, h, d) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const n = g.attributes.normal;
  for (let i = 0; i < uv.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i));
    const sx = ay > 0.5 ? w / 32 : ax > 0.5 ? d / 32 : w / 32;
    const sy = ay > 0.5 ? d / 32 : h / 26;
    uv.setXY(i, uv.getX(i) * sx, uv.getY(i) * sy);
  }
  return g;
}

const SIGNS = [['武馆', '#ff3c7d'], ['星港', '#3ef2ff'], ['丹药', '#5dffa8'], ['NEON 07', '#ffe44d'], ['基地市', '#3ef2ff'], ['剑阁', '#b98cff'], ['MARTIAL', '#ff3c7d'], ['兑换所', '#ffe44d'], ['飞剑', '#3ef2ff'], ['BEAST BOUNTY', '#ff4466'], ['面馆', '#ff6a4a'], ['基因', '#ff3c7d']];
const GROUND_FLOOR = 7;

/**
 * Builds a walled city, a town or a small outpost in the planet's rotating
 * frame. site.size is 'capital' | 'city' | 'outpost' (older sites use main).
 * Returns the group plus colliders, services and walk-in venues.
 */
export function buildSettlement(site, R, opts = {}) {
  const size = site.size || (site.main ? 'capital' : 'outpost');
  const outpost = size === 'outpost';
  const capital = size === 'capital';
  const r = mulberry32(Math.floor((site.x + 2) * 1e6) ^ 0x5eed);
  const up = new THREE.Vector3(site.x, site.y, site.z).normalize();
  const ref = Math.abs(up.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const east = new THREE.Vector3().crossVectors(ref, up).normalize();
  const north = new THREE.Vector3().crossVectors(east, up).normalize();
  const Rs = R + site.height;
  const group = new THREE.Group();
  group.position.copy(up).multiplyScalar(Rs);
  group.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(east, up, north));
  const colliders = [];
  const boxes = [];
  const services = [];
  const venues = [];
  const crowdScale = opts.crowd ?? 1;
  const drop = (x, z) => -(x * x + z * z) / (2 * Rs);
  const toLocal = (x, y, z) => up.clone().multiplyScalar(Rs + y + drop(x, z)).addScaledVector(east, x).addScaledVector(north, z);
  const toCity = (p, out = new THREE.Vector3()) => {
    const v = p.clone().sub(group.position);
    return out.set(v.dot(east), v.dot(up), v.dot(north));
  };

  const { map, emap } = facadeTextures();
  const towerMat = new THREE.MeshStandardMaterial({ map, emissiveMap: emap, emissive: 0xffffff, emissiveIntensity: 1.15, roughness: 0.5, metalness: 0.45, envMapIntensity: 0.8 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x1a1d24, roughness: 0.6, metalness: 0.6 });
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x6a707c, roughness: 0.7, metalness: 0.35 });
  const streetMat = new THREE.MeshStandardMaterial({ color: 0x2a2e36, roughness: 0.85, metalness: 0.1 });
  const neonParts = { cy: [], mg: [], yl: [] };
  const towerParts = [];
  const darkParts = [];
  const wallParts = [];
  const streetParts = [];
  const place = (list, geo, x, y, z, ry = 0) => {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y + drop(x, z), z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry), new THREE.Vector3(1, 1, 1));
    list.push(geo.applyMatrix4(m));
  };
  const neon = (key, geo, x, y, z, ry) => place(neonParts[key], geo, x, y, z, ry);
  const addCollider = (x, z, radius, height) => colliders.push({ pos: toLocal(x, 0, z), up: up.clone(), radius, height });
  // axis-aligned box in city space, y measured from the ground at its centre
  const addBox = (x0, x1, y0, y1, z0, z1, extra = {}) => boxes.push({ x0: Math.min(x0, x1), x1: Math.max(x0, x1), y0, y1, z0: Math.min(z0, z1), z1: Math.max(z0, z1), ...extra });

  const radius = site.radius;
  const guardSpots = [];
  const gateAngles = [];
  const plaza = outpost ? 26 : capital ? 80 : 56;
  const padX = outpost ? radius * 0.55 : capital ? radius - 150 : radius - 110;
  const arena = capital ? { x: -radius * 0.45, z: radius * 0.42, r: 46 } : null;

  // ---- streets: a ring road and the two avenues
  if (!outpost) {
    // short segments so the road follows the planet's curve
    for (let t = -radius + 15; t < radius - 15; t += 20) {
      place(streetParts, new THREE.BoxGeometry(20.5, 0.12, 14), t + 10, 0.04, 0);
      place(streetParts, new THREE.BoxGeometry(14, 0.12, 20.5), 0, 0.04, t + 10);
    }
    for (let k = -1; k <= 1; k += 2) {
      for (let i = -radius + 30; i < radius - 30; i += 12) {
        place(neonParts.yl, new THREE.BoxGeometry(5, 0.05, 0.25), i, 0.12, 0);
        place(neonParts.yl, new THREE.BoxGeometry(0.25, 0.05, 5), 0, 0.12, i);
      }
      void k;
    }
  }

  // ---- buildings
  const step = outpost ? 34 : 46;
  const shells = [];
  const enterChance = outpost ? 0.55 : capital ? 0.42 : 0.38;
  for (let gx = -radius; gx <= radius; gx += step) {
    for (let gz = -radius; gz <= radius; gz += step) {
      const x = gx + (r() - 0.5) * 10, z = gz + (r() - 0.5) * 10;
      const d = Math.hypot(x, z);
      if (d < plaza || d > radius - 34) continue;
      if (x > padX - 70 && x < padX + 70 && Math.abs(z) < 70) continue; // shipyard
      if (arena && Math.hypot(x - arena.x, z - arena.z) < arena.r + 26) continue;
      if (Math.abs(x) < 16 || Math.abs(z) < 16) continue; // avenues
      if (outpost && r() < 0.35) continue;
      const w = 14 + r() * 14, dd = 14 + r() * 14;
      const centerBoost = outpost ? 0.4 : 1 - d / radius;
      const h = (outpost ? 14 : 22) + r() * 40 + centerBoost * centerBoost * (outpost ? 30 : capital ? 170 : 110);
      const enter = r() < enterChance;
      if (enter) shells.push({ x, z, w, d: dd, h, dist: d });
      else {
        place(towerParts, facadeBox(w, h, dd), x, h / 2, z);
        addCollider(x, z, Math.max(w, dd) * 0.62, h);
      }
      if (r() < 0.55) {
        const k = ['cy', 'mg', 'yl'][Math.floor(r() * 3)];
        for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) neon(k, new THREE.BoxGeometry(0.5, h, 0.5), x + (sx * w) / 2, h / 2, z + (sz * dd) / 2);
      }
      if (r() < 0.5) place(darkParts, new THREE.BoxGeometry(w * 0.5, 4 + r() * 6, dd * 0.5), x, h + 3, z);
      if (r() < 0.35) place(darkParts, new THREE.CylinderGeometry(0.4, 0.4, 14, 5), x + w * 0.2, h + 7, z);
    }
  }

  // ---- walk-in buildings: a hollow ground floor with a door, tower above
  shells.sort((a, b) => a.dist - b.dist);
  const order = outpost ? ['exchange', 'food', 'home'] : VENUE_ORDER;
  shells.forEach((sh, i) => {
    const kind = order[i] || 'lobby';
    const v = VENUES[kind];
    // the door faces the city centre along the dominant axis
    const alongX = Math.abs(sh.x) > Math.abs(sh.z);
    const face = alongX ? -Math.sign(sh.x) : -Math.sign(sh.z);
    // building frame: local z points into the room from the door
    const ry = alongX ? (face > 0 ? -Math.PI / 2 : Math.PI / 2) : face > 0 ? Math.PI : 0;
    const bw = alongX ? sh.d : sh.w; // across the door
    const bd = alongX ? sh.w : sh.d; // depth
    const G = GROUND_FLOOR;
    const T = 0.6;
    const doorW = 4.4, doorH = 4.6;
    const toWorldXZ = (lx, lz) => {
      const c = Math.cos(ry), s = Math.sin(ry);
      return [sh.x + lx * c + lz * s, sh.z - lx * s + lz * c];
    };
    const wallPiece = (lx, lz, w2, d2, y0, y1) => {
      const [cx, cz] = toWorldXZ(lx, lz);
      const geo = new THREE.BoxGeometry(w2, y1 - y0, d2);
      place(wallParts, geo, cx, (y0 + y1) / 2, cz, ry);
      const ex = alongX ? d2 / 2 : w2 / 2, ez = alongX ? w2 / 2 : d2 / 2;
      addBox(cx - ex, cx + ex, y0, y1, cz - ez, cz + ez);
    };
    // back and side walls
    wallPiece(0, bd / 2 - T / 2, bw, T, 0, G);
    wallPiece(-bw / 2 + T / 2, 0, T, bd, 0, G);
    wallPiece(bw / 2 - T / 2, 0, T, bd, 0, G);
    // front wall with a door gap and a lintel
    const sideW = (bw - doorW) / 2;
    wallPiece(-doorW / 2 - sideW / 2, -bd / 2 + T / 2, sideW, T, 0, G);
    wallPiece(doorW / 2 + sideW / 2, -bd / 2 + T / 2, sideW, T, 0, G);
    wallPiece(0, -bd / 2 + T / 2, doorW, T, doorH, G);
    // the tower above (solid, also a ceiling and a roof)
    place(towerParts, facadeBox(sh.w, sh.h - G, sh.d), sh.x, G + (sh.h - G) / 2, sh.z);
    addBox(sh.x - sh.w / 2, sh.x + sh.w / 2, G - 0.3, sh.h, sh.z - sh.d / 2, sh.z + sh.d / 2, { ceil: true });
    // door frame and storefront sign
    const [fx, fz] = toWorldXZ(0, -bd / 2 - 0.05);
    const frameKey = v.color === 0x3ef2ff || v.color === 0x7ad8ff || v.color === 0x8fb8ff ? 'cy' : v.color === 0xffe44d || v.color === 0xffa040 ? 'yl' : 'mg';
    neon(frameKey, new THREE.BoxGeometry(doorW + 0.6, 0.25, 0.25), fx, doorH + 0.1, fz, ry);
    for (const s of [-1, 1]) {
      const [px, pz] = toWorldXZ(s * (doorW / 2 + 0.2), -bd / 2 - 0.05);
      neon(frameKey, new THREE.BoxGeometry(0.25, doorH, 0.25), px, doorH / 2, pz, ry);
    }
    const venue = {
      kind, name: v.name, cn: v.cn, x: sh.x, z: sh.z, w: sh.w, d: sh.d, bw, bd, ry, h: sh.h, G,
      door: toLocal(fx, 0.5, fz), seed: Math.floor(r() * 1e9), interior: null, frame: toWorldXZ,
    };
    if (v.sign) {
      const tex = signTexture(v.sign, `#${v.color.toString(16).padStart(6, '0')}`);
      const smat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, color: new THREE.Color(1.8, 1.8, 1.8) });
      const sw = Math.min(bw - 2, 12);
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(sw, sw * 0.16), smat);
      const [sx, sz] = toWorldXZ(0, -bd / 2 - 0.4);
      sign.position.set(sx, doorH + 1.6 + drop(sx, sz), sz);
      sign.rotation.y = ry + Math.PI;
      group.add(sign);
      venue.sign = sign;
    }
    // furniture blocks movement even before the meshes exist
    const lay = interiorLayout(kind, bw, bd);
    for (const b of lay.boxes) {
      const [cx, cz] = toWorldXZ(b.x, b.z);
      const ex = alongX ? b.d / 2 : b.w / 2, ez = alongX ? b.w / 2 : b.d / 2;
      addBox(cx - ex, cx + ex, 0, b.h, cz - ez, cz + ez);
    }
    if (lay.service) {
      const [sx, sz] = toWorldXZ(lay.service.x, lay.service.z);
      services.push({ kind, name: v.name, pos: toLocal(sx, 1.6, sz), range: 4.5, venue, city: site.name });
    }
    venues.push(venue);
  });

  // ---- wall and towers
  if (!outpost) {
    const segs = capital ? 72 : 48;
    const gateEvery = capital ? 18 : 12;
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      if (i % gateEvery === 0) {
        gateAngles.push(a);
        // two guards stand at every gate
        for (const s of [-1, 1]) {
          const ga = a + s * 0.012;
          guardSpots.push([Math.cos(ga) * (radius - 14), Math.sin(ga) * (radius - 14), -a + Math.PI / 2]);
        }
        continue;
      }
      const wr = radius - 6;
      const x = Math.cos(a) * wr, z = Math.sin(a) * wr;
      const len = (2 * Math.PI * wr) / segs + 1;
      place(wallParts, new THREE.BoxGeometry(len, 24, 5), x, 12, z, -a + Math.PI / 2);
      neon('cy', new THREE.BoxGeometry(len, 0.6, 0.6), x, 24.4, z, -a + Math.PI / 2);
      for (let k = -1; k <= 1; k++) addCollider(x + Math.cos(a + Math.PI / 2) * k * len * 0.33, z + Math.sin(a + Math.PI / 2) * k * len * 0.33, 4.5, 24);
      if (i % 7 === 3) {
        place(wallParts, new THREE.CylinderGeometry(7, 8, 40, 10), x, 20, z);
        neon('mg', new THREE.TorusGeometry(7.2, 0.4, 6, 20).rotateX(Math.PI / 2), x, 36, z);
        addCollider(x, z, 8, 40);
      }
    }
  }

  // ---- central hall: futuristic pagoda with an open ground floor
  const hallH = outpost ? 0 : capital ? 150 : 100;
  if (!outpost) {
    const tiers = capital ? 6 : 4;
    const base = capital ? 34 : 28;
    let y = 0;
    for (let t = 0; t < tiers; t++) {
      const s = base - t * (capital ? 4.6 : 5);
      const h = t === 0 ? 30 : 20;
      if (t === 0) {
        // hollow first tier: walls with a door facing the spawn street (-z)
        const T = 0.8, G = 9, doorW = 6;
        const half = s / 2;
        const wall = (x0, x1, z0, z1, y0, y1) => {
          place(wallParts, new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
          addBox(x0, x1, y0, y1, z0, z1);
        };
        wall(-half, half, 0, h, half - T, half);
        wall(-half, -half + T, 0, h, -half, half);
        wall(half - T, half, 0, h, -half, half);
        wall(-half, -doorW / 2, 0, h, -half, -half + T);
        wall(doorW / 2, half, 0, h, -half, -half + T);
        wall(-doorW / 2, doorW / 2, G, h, -half, -half + T);
        place(towerParts, facadeBox(s, h - G - 0.5, s), 0, G + (h - G) / 2 + 0.25, 0);
        addBox(-half, half, G, hallH, -half, half, { ceil: true });
        neon('yl', new THREE.BoxGeometry(doorW + 1, 0.4, 0.4), 0, G + 0.2, -half - 0.1);
        const hall = {
          kind: 'hall', name: 'Martial Hall', cn: '武馆', x: 0, z: 0, w: s, d: s, bw: s - 2 * T, bd: s - 2 * T, ry: 0, h: hallH, G,
          door: toLocal(0, 0.5, -half), seed: 77, interior: null, frame: (lx, lz) => [lx, lz],
        };
        const lay = interiorLayout('hall', hall.bw, hall.bd);
        addBox(lay.counter.x - lay.counter.w / 2, lay.counter.x + lay.counter.w / 2, 0, lay.counter.h, lay.counter.z - lay.counter.d / 2, lay.counter.z + lay.counter.d / 2);
        services.push({ kind: 'hall', name: 'Martial Hall', pos: toLocal(lay.service.x, 1.6, lay.service.z), range: 5, venue: hall, city: site.name });
        venues.push(hall);
      } else {
        place(towerParts, facadeBox(s, h, s), 0, y + h / 2, 0, Math.PI / 4);
      }
      place(darkParts, new THREE.BoxGeometry(s * 1.5, 1.6, s * 1.5), 0, y + h + 0.8, 0, Math.PI / 4);
      neon(t % 2 ? 'yl' : 'cy', new THREE.TorusGeometry(s * 0.95, 0.35, 4, 4).rotateX(Math.PI / 2), 0, y + h + 1.8, 0, 0);
      y += h + 1.6;
    }
    place(darkParts, new THREE.CylinderGeometry(0.6, 2.4, 40, 8), 0, y + 20, 0);
    neon('mg', new THREE.SphereGeometry(2.2, 12, 8), 0, y + 42, 0);
    addBox(-base * 0.75, base * 0.75, 30, hallH, -base * 0.75, base * 0.75, { ceil: true });
  }

  // ---- arena (capital only): a ring wall with a gate and a sand floor
  if (arena) {
    const segs = 32;
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      if (i === 24 || i === 25) continue; // gate toward the centre-ish
      const x = arena.x + Math.cos(a) * arena.r, z = arena.z + Math.sin(a) * arena.r;
      const len = (2 * Math.PI * arena.r) / segs + 0.6;
      place(wallParts, new THREE.BoxGeometry(len, 14, 3), x, 7, z, -a + Math.PI / 2);
      neon(i % 2 ? 'mg' : 'yl', new THREE.BoxGeometry(len, 0.4, 0.4), x, 14.2, z, -a + Math.PI / 2);
      addCollider(x, z, 3.2, 14);
      // tiered stands outside the ring
      place(darkParts, new THREE.BoxGeometry(len, 5, 6), arena.x + Math.cos(a) * (arena.r + 5), 2.5, arena.z + Math.sin(a) * (arena.r + 5), -a + Math.PI / 2);
      place(darkParts, new THREE.BoxGeometry(len, 9, 5), arena.x + Math.cos(a) * (arena.r + 10), 4.5, arena.z + Math.sin(a) * (arena.r + 10), -a + Math.PI / 2);
    }
    place(darkParts, new THREE.CylinderGeometry(arena.r - 1, arena.r - 1, 0.2, 40), arena.x, 0.1, arena.z);
    neon('mg', new THREE.TorusGeometry(arena.r * 0.35, 0.3, 4, 40).rotateX(Math.PI / 2), arena.x, 0.3, arena.z);
    const ga = (24.5 / segs) * Math.PI * 2;
    const gx = arena.x + Math.cos(ga) * (arena.r - 5), gz = arena.z + Math.sin(ga) * (arena.r - 5);
    const tex = signTexture('竞技场 ARENA', '#ff3c7d');
    const smat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, color: new THREE.Color(2, 2, 2) });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(26, 4.2), smat);
    sign.position.set(arena.x, 22 + drop(arena.x, arena.z), arena.z);
    sign.rotation.y = -ga - Math.PI / 2;
    group.add(sign);
    const venue = { kind: 'arena', name: 'Arena', cn: '竞技场', x: arena.x, z: arena.z, r: arena.r, ry: 0, w: arena.r * 2, d: arena.r * 2, interior: null, center: toLocal(arena.x, 2, arena.z), noInterior: true };
    services.push({ kind: 'arena', name: 'Arena Registrar', pos: toLocal(gx, 1.6, gz), range: 7, venue, city: site.name });
    venues.push(venue);
    place(darkParts, new THREE.BoxGeometry(3, 1.2, 1.2), gx, 0.6, gz, -ga);
  }

  // ---- shipyard pad
  place(darkParts, new THREE.CylinderGeometry(outpost ? 22 : 38, outpost ? 22 : 38, 1.2, 40), padX, 0.6, 0);
  neon('yl', new THREE.TorusGeometry(outpost ? 20 : 35, 0.5, 6, 48).rotateX(Math.PI / 2), padX, 1.4, 0);
  neon('cy', new THREE.TorusGeometry(outpost ? 9 : 15, 0.4, 6, 32).rotateX(Math.PI / 2), padX, 1.4, 0);
  if (!outpost) {
    for (const s of [-1, 1]) {
      place(wallParts, new THREE.BoxGeometry(4, 46, 4), padX + s * 44, 23, -30);
      place(wallParts, new THREE.BoxGeometry(4, 46, 4), padX + s * 44, 23, 30);
      place(wallParts, new THREE.BoxGeometry(4, 4, 64), padX + s * 44, 46, 0);
      addCollider(padX + s * 44, -30, 3, 46);
      addCollider(padX + s * 44, 30, 3, 46);
    }
  }

  // ---- merge static geometry
  if (towerParts.length) group.add(new THREE.Mesh(mergeGeometries(towerParts), towerMat));
  if (darkParts.length) group.add(new THREE.Mesh(mergeGeometries(darkParts.map((g) => (g.index ? g.toNonIndexed() : g)).map(stripUv)), darkMat));
  if (wallParts.length) group.add(new THREE.Mesh(mergeGeometries(wallParts.map((g) => (g.index ? g.toNonIndexed() : g)).map(stripUv)), wallMat));
  if (streetParts.length) group.add(new THREE.Mesh(mergeGeometries(streetParts), streetMat));
  const neonColors = { cy: 0x3ef2ff, mg: 0xff3c7d, yl: 0xffe44d };
  for (const [k, parts] of Object.entries(neonParts)) {
    if (!parts.length) continue;
    const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(neonColors[k]).multiplyScalar(2.4) });
    group.add(new THREE.Mesh(mergeGeometries(parts.map((g) => { const c = g.clone(); c.deleteAttribute('uv'); c.deleteAttribute('normal'); return c.index ? c.toNonIndexed() : c; })), m));
  }

  // ---- holographic signs
  const signs = [];
  const signCount = outpost ? 3 : capital ? 22 : 12;
  for (let i = 0; i < signCount; i++) {
    const [text, col] = SIGNS[Math.floor(r() * SIGNS.length)];
    const tex = signTexture(text, col);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, color: new THREE.Color(1.6, 1.6, 1.6) });
    const w = 18 + r() * 22;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, w * 0.16), mat);
    const a = r() * Math.PI * 2, d = plaza + 10 + r() * (radius - plaza - 60);
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    mesh.position.set(x, 20 + r() * 60 + drop(x, z), z);
    mesh.rotation.y = -a + (r() < 0.5 ? 0 : Math.PI);
    group.add(mesh);
    signs.push({ mesh, mat, phase: r() * 10, flicker: r() < 0.3 });
  }
  if (!outpost) {
    const tex = signTexture(`${site.name.toUpperCase()} · 武馆`, '#ffe44d');
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, color: new THREE.Color(2, 2, 2) });
    const big = new THREE.Mesh(new THREE.PlaneGeometry(60, 9.4), mat);
    big.position.set(0, 38, -(capital ? 24 : 20));
    group.add(big);
    signs.push({ mesh: big, mat, phase: 0, flicker: false });
  }

  // ---- street lamps
  const lampGeo = new THREE.SphereGeometry(0.7, 8, 6);
  const lamps = new THREE.InstancedMesh(lampGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 2.0, 1.4) }), outpost ? 20 : capital ? 160 : 90);
  const poleGeo = new THREE.CylinderGeometry(0.12, 0.18, 7, 5).translate(0, 3.5, 0);
  const poles = new THREE.InstancedMesh(poleGeo, darkMat, lamps.count);
  const m4 = new THREE.Matrix4();
  const lampXZ = [];
  for (let i = 0; i < lamps.count; i++) {
    const axis = i % 2;
    const t = (r() * 2 - 1) * (radius - 30);
    const side = (r() < 0.5 ? -1 : 1) * (9 + r() * 2);
    const x = axis ? t : side, z = axis ? side : t;
    m4.makeTranslation(x, 7.2 + drop(x, z), z);
    lamps.setMatrixAt(i, m4);
    m4.makeTranslation(x, drop(x, z), z);
    poles.setMatrixAt(i, m4);
    lampXZ.push({ x, z, broken: 0 });
  }
  group.add(lamps, poles);

  // ---- a market street south of the plaza
  if (!outpost) {
    const awning = { cy: [], mg: [], yl: [] };
    const keys = ['cy', 'mg', 'yl'];
    const vendors = [];
    const marketLen = capital ? 140 : 90;
    let n = 0;
    for (let zz = -plaza - 14; zz > -plaza - marketLen; zz -= 14) {
      for (const sx of [-1, 1]) {
        const x = sx * 13, z = zz;
        place(darkParts, new THREE.BoxGeometry(5, 1.1, 2), x, 0.55, z, 0);
        for (const px of [-2.3, 2.3]) place(darkParts, new THREE.CylinderGeometry(0.08, 0.08, 3.2, 4), x + px, 1.6, z + sx * 1.6, 0);
        const k = keys[(n + (sx > 0 ? 1 : 0)) % 3];
        place(awning[k], new THREE.BoxGeometry(5.6, 0.12, 3.6), x, 3.2, z + sx * 0.6, 0);
        neon(k, new THREE.SphereGeometry(0.22, 6, 4), x, 2.7, z + sx * 2.1);
        addBox(x - 2.5, x + 2.5, 0, 1.1, z - 1, z + 1);
        vendors.push([x, z + sx * 1.6, sx > 0 ? -Math.PI / 2 : Math.PI / 2]);
        n++;
      }
    }
    const awnMat = { cy: 0x1f6f7a, mg: 0x7a1f4a, yl: 0x7a6a1f };
    for (const [k, list] of Object.entries(awning)) if (list.length) group.add(new THREE.Mesh(mergeGeometries(list), new THREE.MeshStandardMaterial({ color: awnMat[k], roughness: 0.8, emissive: awnMat[k], emissiveIntensity: 0.25 })));
    const vend = new THREE.InstancedMesh(npcGeometry(), new THREE.MeshStandardMaterial({ color: 0x5a4a3a, roughness: 0.7 }), vendors.length);
    vendors.forEach(([x, z, ry], i) => {
      vend.setMatrixAt(i, new THREE.Matrix4().compose(new THREE.Vector3(x, drop(x, z), z), new THREE.Quaternion().setFromAxisAngle(Y_AXIS, ry), new THREE.Vector3(1, 1, 1)));
    });
    group.add(vend);
    // two of the stalls do business with you
    const z1 = -plaza - 14, z2 = -plaza - 42;
    services.push({ kind: 'food', name: 'Street Food Stall', pos: toLocal(-13, 1.6, z1 + 2.4), range: 3.5, city: site.name });
    services.push({ kind: 'pills', name: 'Herb Stall', pos: toLocal(13, 1.6, z2 - 2.4), range: 3.5, city: site.name });
  }
  if (guardSpots.length) {
    const gm = new THREE.InstancedMesh(npcGeometry(), new THREE.MeshStandardMaterial({ color: 0x1c2a3a, roughness: 0.4, metalness: 0.6, emissive: 0x0a3a4a, emissiveIntensity: 0.6 }), guardSpots.length);
    guardSpots.forEach(([x, z, ry], i) => {
      gm.setMatrixAt(i, new THREE.Matrix4().compose(new THREE.Vector3(x, drop(x, z), z), new THREE.Quaternion().setFromAxisAngle(Y_AXIS, ry), new THREE.Vector3(1.15, 1.15, 1.15)));
    });
    group.add(gm);
  }

  // ---- pedestrians walking the avenues
  const walkers = [];
  const crowdN = Math.round((outpost ? 10 : capital ? 110 : 60) * crowdScale);
  let crowd = null;
  if (crowdN > 0) {
    crowd = new THREE.InstancedMesh(npcGeometry(), new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.2 }), crowdN);
    const palette = [0x2a3040, 0x40283a, 0x283a40, 0x4a4a5a, 0x5a3a2a, 0x2a4a3a, 0x6a6a7a];
    const col = new THREE.Color();
    for (let i = 0; i < crowdN; i++) {
      const axis = r() < 0.5 ? 0 : 1;
      const lane = (r() < 0.5 ? -1 : 1) * (4 + r() * 3.5);
      walkers.push({ axis, lane, t: (r() * 2 - 1) * (radius - 40), v: (1.1 + r() * 0.8) * (r() < 0.5 ? -1 : 1), span: radius - 40, bob: r() * 10, s: 0.9 + r() * 0.2 });
      crowd.setColorAt(i, col.set(palette[Math.floor(r() * palette.length)]));
    }
    crowd.frustumCulled = false;
    group.add(crowd);
  }

  // ---- flying traffic
  const craft = [];
  for (let i = 0; i < (outpost ? 2 : capital ? 14 : 8); i++) {
    const ship = buildShip(r() < 0.5 ? 0x3ef2ff : 0xff3c7d);
    ship.scale.setScalar(0.7);
    ship.userData = { a: r() * Math.PI * 2, rad: 60 + r() * (radius - 80), y: 50 + r() * 90, s: (0.05 + r() * 0.08) * (r() < 0.5 ? 1 : -1) };
    group.add(ship);
    craft.push(ship);
  }

  // ---- services that live outdoors
  const svc = (kind, name, x, z, range = 22) => services.push({ kind, name, pos: toLocal(x, 1.5, z), range, city: site.name });
  svc('shipyard', outpost ? `${site.name} Shipyard` : 'Star Harbor Shipyard', padX - (outpost ? 0 : 40), 0);
  const markerMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 2.6, 3), transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false });
  {
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 30, 16, 1, true), markerMat);
    beam.position.set(padX - (outpost ? 0 : 40), 14 + drop(padX, 0), 0);
    group.add(beam);
  }

  // the settlement's warm glow comes from the game's single city light (see Game.updateCityLight)
  const glow = { intensity: outpost ? 1 : 3, distance: outpost ? 200 : 700 };

  // grid for fast box lookups
  const CELL = 32;
  const grid = new Map();
  boxes.forEach((b, i) => {
    for (let cx = Math.floor(b.x0 / CELL); cx <= Math.floor(b.x1 / CELL); cx++) {
      for (let cz = Math.floor(b.z0 / CELL); cz <= Math.floor(b.z1 / CELL); cz++) {
        const k = cx * 4096 + cz;
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(i);
      }
    }
  });
  const pc = new THREE.Vector3();
  const interiors = new Set();
  let t = 0;
  return {
    site,
    group,
    colliders,
    boxes,
    services,
    venues,
    arena,
    padLocal: toLocal(padX, 2, 0),
    glow,
    gates: gateAngles.map((a) => ({ pos: toLocal(Math.cos(a) * (radius - 6), 0.2, Math.sin(a) * (radius - 6)), out: toLocal(Math.cos(a) * (radius + 60), 0.2, Math.sin(a) * (radius + 60)), wall: (off) => toLocal(Math.cos(a + off / radius) * (radius - 6), 24.5, Math.sin(a + off / radius) * (radius - 6)) })),
    spawnLocal: toLocal(0, 2, -(capital ? 60 : 44)),
    radius,
    size,
    toCity,
    toLocal,
    drop,
    // Push a point (with feet `eye` below it) out of walls and furniture.
    // Returns a roof radius if the feet rest on top of a box.
    collideBoxes(local, rad, eye = 0) {
      toCity(local, pc);
      let roof = null;
      const k0x = Math.floor((pc.x - rad) / CELL), k1x = Math.floor((pc.x + rad) / CELL);
      const k0z = Math.floor((pc.z - rad) / CELL), k1z = Math.floor((pc.z + rad) / CELL);
      const seen = new Set();
      let moved = false;
      for (let cx = k0x; cx <= k1x; cx++) {
        for (let cz = k0z; cz <= k1z; cz++) {
          const list = grid.get(cx * 4096 + cz);
          if (!list) continue;
          for (const i of list) {
            if (seen.has(i)) continue;
            seen.add(i);
            const b = boxes[i];
            const g0 = drop((b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2);
            const yEye = pc.y - g0;
            const feet = yEye - eye;
            if (feet > b.y1 + 0.5 || yEye < b.y0 - 0.3) continue;
            if (pc.x < b.x0 - rad || pc.x > b.x1 + rad || pc.z < b.z0 - rad || pc.z > b.z1 + rad) continue;
            if (b.ceil && feet < b.y0) {
              // head against a ceiling slab from below
              if (yEye + 0.25 > b.y0) { pc.y = g0 + b.y0 - 0.25; moved = true; }
              continue;
            }
            if (feet > b.y1 - Math.min(3, Math.max(0.6, (b.y1 - b.y0) * 0.2))) {
              roof = Math.max(roof ?? 0, Rs + g0 + b.y1);
              continue;
            }
            const dx0 = pc.x - (b.x0 - rad), dx1 = b.x1 + rad - pc.x;
            const dz0 = pc.z - (b.z0 - rad), dz1 = b.z1 + rad - pc.z;
            const m = Math.min(dx0, dx1, dz0, dz1);
            if (m === dx0) pc.x -= dx0; else if (m === dx1) pc.x += dx1; else if (m === dz0) pc.z -= dz0; else pc.z += dz1;
            moved = true;
          }
        }
      }
      if (moved) local.copy(group.position).addScaledVector(east, pc.x).addScaledVector(up, pc.y).addScaledVector(north, pc.z);
      return roof;
    },
    // Knock over street lamps near a point; they're repaired after a while.
    breakAt(local, rad) {
      toCity(local, pc);
      const hits = [];
      lampXZ.forEach((l, i) => {
        if (l.broken > 0 || Math.hypot(pc.x - l.x, pc.z - l.z) > rad + 1) return;
        l.broken = 120;
        lamps.setMatrixAt(i, new THREE.Matrix4().makeScale(0, 0, 0));
        poles.setMatrixAt(i, new THREE.Matrix4().makeScale(0, 0, 0));
        hits.push(toLocal(l.x, 4, l.z));
      });
      if (hits.length) {
        lamps.instanceMatrix.needsUpdate = true;
        poles.instanceMatrix.needsUpdate = true;
      }
      return hits;
    },
    // Pedestrians near a disturbance run away.
    panic(local) {
      toCity(local, pc);
      for (const wk of walkers) {
        const x = wk.axis ? wk.t : wk.lane, z = wk.axis ? wk.lane : wk.t;
        if (Math.hypot(pc.x - x, pc.z - z) > 70) continue;
        wk.panic = 6;
        const toward = wk.axis ? Math.sign(pc.x - x) : Math.sign(pc.z - z);
        if (Math.sign(wk.v) === toward) wk.v = -wk.v;
      }
    },
    // Which venue (if any) contains a planet-local point.
    venueAt(local) {
      toCity(local, pc);
      for (const v of venues) {
        if (v.kind === 'arena') {
          if (Math.hypot(pc.x - v.x, pc.z - v.z) < v.r - 2) return v;
          continue;
        }
        if (Math.abs(pc.x - v.x) < v.w / 2 && Math.abs(pc.z - v.z) < v.d / 2 && pc.y - drop(v.x, v.z) < (v.G || 7)) return v;
      }
      return null;
    },
    update(dt, playerLocal) {
      t += dt;
      lampXZ.forEach((l, i) => {
        if (l.broken <= 0) return;
        l.broken -= dt;
        if (l.broken <= 0) {
          m4.makeTranslation(l.x, 7.2 + drop(l.x, l.z), l.z);
          lamps.setMatrixAt(i, m4);
          m4.makeTranslation(l.x, drop(l.x, l.z), l.z);
          poles.setMatrixAt(i, m4);
          lamps.instanceMatrix.needsUpdate = true;
          poles.instanceMatrix.needsUpdate = true;
        }
      });
      for (const s of signs) s.mat.opacity = s.flicker ? (Math.sin(t * 13 + s.phase) > -0.85 ? 1 : 0.2) : 0.85 + 0.15 * Math.sin(t * 2 + s.phase);
      for (const c of craft) {
        const u = c.userData;
        u.a += u.s * dt;
        const x = Math.cos(u.a) * u.rad, z = Math.sin(u.a) * u.rad;
        c.position.set(x, u.y + drop(x, z), z);
        c.lookAt(Math.cos(u.a + Math.sign(u.s) * 0.1) * u.rad, u.y + drop(x, z), Math.sin(u.a + Math.sign(u.s) * 0.1) * u.rad);
      }
      if (crowd) {
        const q = new THREE.Quaternion();
        const sc = new THREE.Vector3();
        walkers.forEach((wk, i) => {
          wk.panic = Math.max(0, (wk.panic || 0) - dt);
          wk.t += wk.v * dt * (wk.panic > 0 ? 4.5 : 1);
          if (wk.t > wk.span) wk.t = -wk.span;
          if (wk.t < -wk.span) wk.t = wk.span;
          const x = wk.axis ? wk.t : wk.lane, z = wk.axis ? wk.lane : wk.t;
          q.setFromAxisAngle(Y_AXIS, wk.axis ? (wk.v > 0 ? Math.PI / 2 : -Math.PI / 2) : wk.v > 0 ? 0 : Math.PI);
          sc.set(wk.s, wk.s * (1 + Math.sin(t * 9 + wk.bob) * 0.02), wk.s);
          m4.compose(new THREE.Vector3(x, drop(x, z) + Math.abs(Math.sin(t * 6 + wk.bob)) * 0.05, z), q, sc);
          crowd.setMatrixAt(i, m4);
        });
        crowd.instanceMatrix.needsUpdate = true;
      }
      // interiors appear when you come close and vanish when you leave
      if (playerLocal) {
        toCity(playerLocal, pc);
        for (const v of venues) {
          if (v.noInterior) continue;
          const d = Math.hypot(pc.x - v.x, pc.z - v.z);
          if (!v.interior && d < 70) {
            v.interior = buildInterior(v.kind, v.bw, v.bd, v.G - 0.3, v.seed, v.name);
            const [cx, cz] = v.frame(0, 0);
            v.interior.group.position.set(cx, drop(cx, cz), cz);
            v.interior.group.rotation.y = v.ry;
            addCompiled(group, v.interior.group, `interior:${v.kind}`);
            interiors.add(v);
          } else if (v.interior && d > 120) {
            cancelAdd(v.interior.group);
            group.remove(v.interior.group);
            v.interior.dispose();
            v.interior = null;
            interiors.delete(v);
          }
        }
        for (const v of interiors) v.interior.update(dt);
      }
    },
    dispose() {
      for (const v of interiors) v.interior.dispose();
      group.traverse((o) => {
        if (o.geometry && o.geometry !== npcGeometry()) o.geometry.dispose();
        if (o.material && o.material !== towerMat) o.material.dispose?.();
      });
      for (const s of signs) s.mat.map?.dispose();
      for (const v of venues) if (v.sign) v.sign.material.map?.dispose();
      towerMat.dispose();
    },
  };
}

const Y_AXIS = new THREE.Vector3(0, 1, 0);
function stripUv(g) {
  if (g.attributes.uv) g.deleteAttribute('uv');
  return g;
}
