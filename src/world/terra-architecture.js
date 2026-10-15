import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { hashString, mulberry32 } from '../core/rng.js';
import { blockMaterials } from './block-materials.js';
import { addCompiled, cancelAdd } from '../core/precompile.js';

const CELL = 96;
export const TERRA_STYLES = ['brick-residence', 'court-apartments', 'stepped-office', 'workshop', 'garden-housing', 'commercial'];
const PALETTES = [0xbca698, 0xd0c8b4, 0x92a3a3, 0x89978e, 0xc3ba9d, 0xa4b6bb];

export function terraCityProfile(site) {
  const seed = hashString(`${site.x},${site.y},${site.z}/architecture-v1`), r = mulberry32(seed);
  return { seed, character: Math.floor(r() * 6), height: 0.72 + r() * 0.5, floorHeight: 3.05 + r() * 0.4,
    hue: r() * 0.12 - 0.06, warmth: 0.82 + r() * 0.25, roof: Math.floor(r() * 4), trim: 0.72 + r() * 0.25,
    spacing: 44 + Math.floor(r() * 4) * 4 };
}

// Pure recipes: no saved meshes, per-building files or random global state.
// Neighbourhoods bias the mix; a lot's seed controls all of its fine detail.
export function planTerraBuilding(site, lot) {
  const profile = terraCityProfile(site);
  const identity = `${site.x},${site.y},${site.z}`;
  const seed = hashString(`${identity}/${lot.x.toFixed(3)},${lot.z.toFixed(3)}`);
  const r = mulberry32(seed);
  const district = hashString(`${identity}/${Math.floor(lot.x / 180)},${Math.floor(lot.z / 180)}`) % 6;
  const mix = r(), style = mix < 0.43 ? profile.character : mix < 0.78 ? district : Math.floor(r() * TERRA_STYLES.length);
  const ground = lot.enter ? 7 : 3.8;
  const limit = [38, 48, 150, 20, 32, 110][style] * profile.height;
  const floorHeight = profile.floorHeight;
  const floors = Math.max(2, Math.floor(Math.min(lot.h * profile.height, limit) / floorHeight));
  const h = ground + floors * floorHeight;
  const skin = style === 0 ? 'brick' : style === 3 ? 'metal' : style === 5 ? 'stone' : 'plaster';
  const tint = new THREE.Color(PALETTES[style]).offsetHSL(profile.hue + (r() - 0.5) * 0.035, 0, (r() - 0.5) * 0.1).multiplyScalar(profile.warmth).getHex();
  const plan = { ...lot, seed, district, style: TERRA_STYLES[style], skin, tint, ground, floorHeight, floors, h, masses: [],
    label: Math.floor(r() * 4), balconies: style === 0 || style === 1 || style === 4, phase: r() * 6,
    roof: (profile.roof + (r() < 0.25 ? 1 : 0)) % 4, trim: profile.trim };
  const bottom = lot.enter ? 6.7 : 0;
  if (style === 2 || style === 5) {
    const split = ground + Math.max(1, Math.floor(floors * 0.38)) * floorHeight;
    plan.masses.push({ w: lot.w, d: lot.d, y0: bottom, y1: split });
    plan.masses.push({ w: lot.w * 0.73, d: lot.d * 0.78, y0: split, y1: h });
  } else plan.masses.push({ w: lot.w, d: lot.d, y0: bottom, y1: h });
  return plan;
}

let labels;
let glazingMaps;
function windowMaps() {
  if (glazingMaps) return glazingMaps;
  const n = 256, pixels = new Uint8Array(n * n * 4), emission = new Uint8Array(n * n * 4), r = mulberry32(8102);
  for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++) {
    const lit = r() < 0.22;
    for (let y = 8; y < 25; y++) for (let x = 5; x < 27; x++) {
      const i = ((row * 32 + y) * n + col * 32 + x) * 4, mullion = x === 15 || y === 20;
      const color = mullion ? [51, 65, 65] : lit ? [188, 163, 119] : y > 17 ? [66, 91, 101] : [41, 62, 72];
      for (let k = 0; k < 3; k++) { pixels[i + k] = color[k]; emission[i + k] = lit && !mullion ? color[k] : 0; }
      pixels[i + 3] = emission[i + 3] = 255;
    }
  }
  const map = new THREE.DataTexture(pixels, n, n), emissiveMap = new THREE.DataTexture(emission, n, n);
  for (const t of [map, emissiveMap]) {
    t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true; t.anisotropy = 4; t.needsUpdate = true;
  }
  return glazingMaps = { map, emissiveMap };
}

function districtSigns() {
  if (labels) return labels;
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 1024;
  const c = canvas.getContext('2d');
  const names = ['CEDAR COURT', 'ORBIT RESIDENCES', 'NORTHLINE HOUSE', 'COMMON GROUND',
    'PRECISION WORKS', 'REPAIR & REUSE', 'FREIGHT SERVICES', 'MAINTENANCE',
    'GARDEN COURT', 'SEED EXCHANGE', 'SKY GARDENS', 'GREENHOUSE',
    'TRANSIT OFFICES', 'SOUTH EXCHANGE', 'RESEARCH ANNEX', 'CIVIC SERVICES'];
  names.forEach((name, i) => {
    c.fillStyle = i % 3 ? '#d8d5c5' : '#8dada5'; c.fillRect(0, i * 64, 512, 64);
    c.fillStyle = '#243638'; c.font = 'bold 26px sans-serif'; c.fillText(name, 20, i * 64 + 32);
    c.font = '12px sans-serif'; c.fillText(i < 4 ? 'RESIDENTIAL / RECEPTION' : i < 8 ? 'SERVICE ACCESS / KEEP CLEAR' : i < 12 ? 'TERRA / COMMUNITY' : 'VISITORS / RECEPTION', 22, i * 64 + 52);
  });
  labels = new THREE.CanvasTexture(canvas); labels.colorSpace = THREE.SRGBColorSpace; labels.anisotropy = 4;
  return labels;
}

// Geometry is baked in city coordinates then shifted into small cells for
// useful frustum culling. All cells share materials and cached texture maps.
function builder(materials, drop, cx = 0, cz = 0) {
  const parts = Object.fromEntries(Object.keys(materials).map(k => [k, []]));
  const put = (kind, geo, x, y, z, tint = 0xffffff, ry = 0) => {
    geo.rotateY(ry).translate(x, y, z);
    const p = geo.attributes.position, uv = geo.attributes.uv, n = geo.attributes.normal, color = new THREE.Color(tint), original = geo.attributes.color;
    const colors = new Float32Array(p.count * 3), light = new Float32Array(p.count * 3);
    const mapped = ['brick', 'plaster', 'stone', 'wood'].includes(kind);
    for (let i = 0; i < p.count; i++) {
      const px = p.getX(i), py = p.getY(i), pz = p.getZ(i);
      if (mapped) {
        const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
        uv.setXY(i, (ax > az ? pz : px) * 0.5, (ay > Math.max(ax, az) ? pz : py) * 0.5);
      }
      const ao = kind === 'light' ? 1 : 0.78 + 0.22 * Math.min(1, Math.max(0, py) / 1.2);
      colors.set([color.r * ao * (original?.getX(i) ?? 1), color.g * ao * (original?.getY(i) ?? 1), color.b * ao * (original?.getZ(i) ?? 1)], i * 3);
      p.setXYZ(i, px - cx, py + drop(px, pz), pz - cz);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('bakedLight', new THREE.BufferAttribute(light, 3));
    const flat = geo.index ? geo.toNonIndexed() : geo;
    if (flat !== geo) geo.dispose();
    parts[kind].push(flat);
  };
  const box = (kind, w, h, d, x, y, z, tint = 0xffffff) => put(kind, new THREE.BoxGeometry(w, h, d), x, y, z, tint);
  const finish = name => {
    const group = new THREE.Group(); group.name = name; group.position.set(cx, 0, cz);
    let triangles = 0;
    for (const [kind, list] of Object.entries(parts)) if (list.length) {
      const g = mergeGeometries(list); list.forEach(p => p.dispose()); g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, materials[kind]); mesh.name = kind; group.add(mesh);
      triangles += g.attributes.position.count / 3;
    }
    group.userData.triangles = triangles;
    return group;
  };
  return { put, box, finish };
}

export class TerraArchitecture {
  constructor({ parent, plans, drop, addBox, range = 80 }) {
    Object.assign(this, { parent, plans, drop });
    this.range = range <= 48 ? 76 : 112; this.maxCells = range <= 48 ? 2 : 4;
    this.cells = new Map(); this.live = new Map(); this.disposed = false;
    this.materials = blockMaterials();
    // The showcase's sign map remains cached; this system owns only its material.
    this.materials.sign.map = districtSigns();
    Object.assign(this.materials.window, windowMaps(), { alphaTest: 0.45, color: new THREE.Color(0xffffff), emissive: new THREE.Color(0xffffff), emissiveIntensity: 0.38 });
    this.materials.metal.side = this.materials.fabric.side = THREE.DoubleSide;
    const base = builder(this.materials, drop);
    for (const p of plans) {
      const key = `${Math.floor(p.x / CELL)},${Math.floor(p.z / CELL)}`;
      if (!this.cells.has(key)) this.cells.set(key, []);
      this.cells.get(key).push(p);
      for (const m of p.masses) {
        addBox(p.x - m.w / 2, p.x + m.w / 2, m.y0, m.y1, p.z - m.d / 2, p.z + m.d / 2, p.enter ? { ceil: true } : {});
        base.box(p.skin, m.w, m.y1 - m.y0, m.d, p.x, (m.y0 + m.y1) / 2, p.z, p.tint);
        // One cutout quad per elevation provides the distant window pattern.
        // Brick/plaster shows through between panes; nearby frames align to
        // this shared 256px map rather than adding every distant window as a mesh.
        const start = Math.max(p.ground, m.y0), height = m.y1 - start;
        for (let face = 0; face < 4; face++) {
          const width = face % 2 ? m.d : m.w, bays = Math.max(2, Math.floor(width / 3.2));
          const x = p.x + (face % 2 ? (face === 1 ? 1 : -1) * (m.w / 2 + 0.015) : 0);
          const z = p.z + (face % 2 ? 0 : (face === 0 ? -1 : 1) * (m.d / 2 + 0.015));
          const g = new THREE.PlaneGeometry(width, height), uv = g.attributes.uv;
          for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * bays / 8 + (p.seed % 8) / 8, uv.getY(i) * height / p.floorHeight / 8 + (p.seed % 5) / 8);
          base.put('window', g, x, start + height / 2, z, 0xffffff, [Math.PI, Math.PI / 2, 0, -Math.PI / 2][face]);
        }
        base.box('stone', m.w + 0.1, 0.18, m.d + 0.1, p.x, m.y1, p.z);
      }
      const top = p.masses.at(-1);
      if (p.roof === 0) base.box('metal', p.w * 0.24, 1.1, p.d * 0.2, p.x, p.h + 0.6, p.z);
      else if (p.roof === 1) {
        for (let i = 0; i < 3; i++) base.put('metal', new THREE.BoxGeometry(top.w * 0.65, 0.08, top.d * 0.18).rotateX(-0.18), p.x, p.h + 0.45, p.z + (i - 1) * top.d * 0.25, 0x344d60);
      } else if (p.roof === 2) {
        base.put('metal', new THREE.CylinderGeometry(1, 1, 2.6, 10), p.x, p.h + 2, p.z);
        for (const dx of [-0.7, 0.7]) for (const dz of [-0.7, 0.7]) base.box('metal', 0.08, 0.8, 0.08, p.x + dx, p.h + 0.4, p.z + dz);
      } else {
        for (const side of [-1, 1]) {
          base.box('stone', top.w * 0.7, 0.4, 0.8, p.x, p.h + 0.25, p.z + side * top.d * 0.3);
          base.box('leaves', top.w * 0.65, 0.35, 0.6, p.x, p.h + 0.6, p.z + side * top.d * 0.3);
        }
      }
    }
    this.base = base.finish('Terra procedural skyline'); parent.add(this.base);
    this.stats = { cells: 0, meshes: 0, triangles: 0, buildings: plans.length, baseTriangles: this.base.userData.triangles };
  }

  build(key) {
    const [cx, cz] = key.split(',').map(Number).map(n => (n + 0.5) * CELL);
    const b = builder(this.materials, this.drop, cx, cz), { box, put } = b;
    const planter = (x, y, z, ry = 0) => {
      put('stone', new THREE.BoxGeometry(1.25, 0.25, 0.38), x, y, z, 0xffffff, ry);
      for (let i = 0; i < 3; i++) put('leaves', new THREE.IcosahedronGeometry(0.23, 0).scale(1, 0.65, 1), x + Math.cos(ry) * (i - 1) * 0.36, y + 0.2, z - Math.sin(ry) * (i - 1) * 0.36);
    };
    for (const p of this.cells.get(key)) {
      const r = mulberry32(p.seed);
      for (const m of p.masses) {
        // Spending detail at pedestrian height keeps tall skylines affordable.
        for (let y = Math.max(p.ground, m.y0) + p.floorHeight / 2; y < Math.min(16, m.y1 - 0.6); y += p.floorHeight) {
          for (let face = 0; face < 4; face++) {
            const ry = [Math.PI, Math.PI / 2, 0, -Math.PI / 2][face];
            const width = face % 2 ? m.d : m.w, bays = Math.max(2, Math.floor(width / 3.2));
            const point = (u, v, depth) => [p.x + Math.cos(ry) * u + Math.sin(ry) * depth, v, p.z - Math.sin(ry) * u + Math.cos(ry) * depth];
            const depth = (face % 2 ? m.w : m.d) / 2;
            const piece = (kind, w, h, d, u, v, offset, color = 0xffffff) => {
              const thin = (kind === 'metal' && d <= 0.15) || kind === 'fabric';
              put(kind, thin ? new THREE.PlaneGeometry(w, h) : new THREE.BoxGeometry(w, h, d), ...point(u, v, depth + offset + (thin ? d / 2 : 0)), color, ry);
            };
            // Orient local coordinates consistently with each facade's windows.
            for (let i = 0; i < bays; i++) {
              const u = -width / 2 + (i + 0.5) * width / bays, ww = width / bays * 0.68;
              piece('stone', ww + 0.16, 0.09, 0.36, u, y - 0.88, 0.07);
              for (const side of [-1, 1]) piece('metal', 0.045, 1.76, 0.13, u + side * ww / 2, y, 0.04);
              piece('metal', ww, 0.045, 0.13, u, y + 0.2, 0.04);
              if (p.style === 'commercial' || p.style === 'stepped-office') piece('metal', 0.12, p.floorHeight, 0.3, u - ww / 2 - 0.15, y, 0.15, 0xb4bfc0);
              if (r() < 0.32) for (const side of [-1, 1]) piece('fabric', ww * 0.2, 1.65, 0.025, u + side * ww * 0.36, y, 0.035, p.tint);
              if (p.balconies && y < 13 && i % 3 === 1) {
                piece('stone', ww + 0.35, 0.12, 0.75, u, y - 1.05, 0.35);
                piece('metal', ww + 0.35, 0.045, 0.045, u, y - 0.1, 0.73);
                for (let k = 0; k < 5; k++) piece('metal', 0.035, 0.9, 0.035, u + (k - 2) * ww / 4, y - 0.55, 0.73);
                if (p.style === 'garden-housing' || r() < 0.4) planter(...point(u, y - 0.85, depth + 0.42), ry);
              }
            }
          }
        }
      }
      // Pavement skirts stop at the footprint; nothing blocks the existing
      // venue doorway or the furniture/vehicle space outside it.
      box('stone', p.w + 2.6, 0.08, p.d + 2.6, p.x, 0.025, p.z, 0xb5b7ad);
      const front = p.enter ? p.ry + Math.PI : (Math.abs(p.x) > Math.abs(p.z) ? (p.x > 0 ? -Math.PI / 2 : Math.PI / 2) : p.z > 0 ? Math.PI : 0);
      const fw = Math.abs(Math.sin(front)) > 0.5 ? p.d : p.w;
      const fd = Math.abs(Math.sin(front)) > 0.5 ? p.w : p.d;
      const point = (u, y, offset) => [p.x + Math.cos(front) * u + Math.sin(front) * (fd / 2 + offset), y, p.z - Math.sin(front) * u + Math.cos(front) * (fd / 2 + offset)];
      const piece = (kind, w, h, d, u, y, offset, color = 0xffffff) => put(kind, new THREE.BoxGeometry(w, h, d), ...point(u, y, offset), color, front);
      if (p.enter) {
        // Clad the real hollow shell, preserving its 4.4m opening and lintel.
        // No facade is placed across a functional door or inside the room.
        const height = 6.7;
        for (let face = 0; face < 4; face++) {
          const ry = front + face * Math.PI / 2, width = face % 2 ? fd : fw, depth = (face % 2 ? fw : fd) / 2;
          const panel = (w, h, u, y) => put(p.skin, new THREE.PlaneGeometry(w, h),
            p.x + Math.cos(ry) * u + Math.sin(ry) * (depth + 0.025), y, p.z - Math.sin(ry) * u + Math.cos(ry) * (depth + 0.025), p.tint, ry);
          if (face === 0) {
            const sideW = (width - 4.4) / 2;
            for (const side of [-1, 1]) panel(sideW, height, side * (2.2 + sideW / 2), height / 2);
            panel(4.4, height - 4.6, 0, (height + 4.6) / 2);
          } else panel(width, height, 0, height / 2);
        }
        for (const side of [-1, 1]) {
          const u = side * (2.2 + (fw - 4.4) / 4), width = Math.min(3, (fw - 4.4) / 2 - 0.8);
          piece('dark', width, 1.9, 0.045, u, 2.5, 0.07);
          piece('stone', width + 0.15, 0.1, 0.26, u, 1.5, 0.13);
          piece('metal', 0.045, 1.9, 0.08, u, 2.5, 0.1);
        }
      }
      piece(p.style === 'workshop' ? 'metal' : 'wood', fw - 0.8, 0.14, 1.15, 0, p.enter ? 4.9 : 3.35, 0.45);
      for (const side of [-1, 1]) {
        piece('stone', 0.35, p.ground, 0.3, side * (fw / 2 - 0.25), p.ground / 2, 0.07);
        piece('light', 0.4, 0.05, 0.15, side * fw * 0.3, p.enter ? 4.8 : 3.24, 0.5);
      }
      if (!p.enter) {
        // Closed residential/service doors are decorative; walk-in services
        // retain the game's real hollow shells and interaction positions.
        piece('dark', p.style === 'workshop' ? 4 : 1.5, 2.75, 0.045, 0, 1.4, 0.03);
        if (p.style === 'workshop') for (let i = 0; i < 12; i++) piece('metal', 3.9, 0.035, 0.06, 0, 0.15 + i * 0.22, 0.06);
        else piece('metal', 0.06, 0.4, 0.05, 0.5, 1.2, 0.08);
        const label = (p.style === 'workshop' ? 4 : p.style === 'garden-housing' ? 8 : p.style === 'stepped-office' || p.style === 'commercial' ? 12 : 0) + p.label;
        const g = new THREE.PlaneGeometry(Math.min(6, fw - 2), 0.75), uv = g.attributes.uv;
        for (let i = 0; i < uv.count; i++) uv.setY(i, (15 - label + uv.getY(i)) / 16);
        put('sign', g, ...point(0, 3, 0.15), 0xffffff, front);
      }
      // Wall-mounted services vary without placing obstacles on walking routes.
      const side = front + Math.PI / 2, sx = p.x + Math.sin(side) * (fw / 2 + 0.2), sz = p.z + Math.cos(side) * (fw / 2 + 0.2);
      put('metal', new THREE.BoxGeometry(1.1, 0.7, 0.4), sx, 3.9, sz, 0xffffff, side);
      put('dark', new THREE.TorusGeometry(0.22, 0.025, 4, 10), sx + Math.sin(side) * 0.22, 3.9, sz + Math.cos(side) * 0.22, 0xffffff, side);
    }
    const group = b.finish('Terra streamed architecture');
    addCompiled(this.parent, group, 'terra-architecture'); this.live.set(key, group);
  }

  update(position) {
    if (this.disposed) return;
    const altitude = position.y - this.drop(position.x, position.z), wanted = [];
    if (altitude > -12 && altitude < 65) for (const [key, plans] of this.cells) {
      // Distance to actual footprints prevents a nearby facade from losing
      // detail simply because the centre of its cell is farther away.
      const distance = Math.min(...plans.map(p => Math.hypot(Math.max(0, Math.abs(position.x - p.x) - p.w / 2), Math.max(0, Math.abs(position.z - p.z) - p.d / 2))));
      if (distance < this.range) wanted.push([key, distance]);
    }
    wanted.sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));
    const keep = new Set(wanted.slice(0, this.maxCells).map(([key]) => key));
    for (const [key, group] of this.live) if (!keep.has(key)) {
      cancelAdd(group); group.removeFromParent(); group.traverse(o => o.geometry?.dispose()); this.live.delete(key);
    }
    const next = wanted.find(([key]) => keep.has(key) && !this.live.has(key));
    if (next) this.build(next[0]);
    this.stats.cells = this.live.size;
    this.stats.meshes = [...this.live.values()].reduce((n, g) => n + g.children.length, 0);
    this.stats.triangles = [...this.live.values()].reduce((n, g) => n + g.userData.triangles, 0);
  }

  dispose() {
    this.disposed = true;
    for (const group of this.live.values()) { cancelAdd(group); group.removeFromParent(); group.traverse(o => o.geometry?.dispose()); }
    this.live.clear(); this.cells.clear(); this.base.removeFromParent(); this.base.traverse(o => o.geometry?.dispose());
    Object.values(this.materials).forEach(m => m.dispose());
  }

  surfaceAt(position) {
    const cx = Math.floor(position.x / CELL), cz = Math.floor(position.z / CELL);
    for (let x = cx - 1; x <= cx + 1; x++) for (let z = cz - 1; z <= cz + 1; z++) {
      for (const p of this.cells.get(`${x},${z}`) || []) if (Math.abs(position.x - p.x) <= p.w / 2 + 1.3 && Math.abs(position.z - p.z) <= p.d / 2 + 1.3) return true;
    }
    return false;
  }
}
