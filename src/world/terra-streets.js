import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../core/rng.js';
import { bevelBox } from './geometry.js';
import { addCompiled, cancelAdd } from '../core/precompile.js';

const CELL = 48;
const LABELS = ['STAR HARBOR', 'MARTIAL HALL', 'SOUTH MARKET', 'RESIDENTIAL', 'TRANSIT 07', 'BOTANICAL COURT',
  'STAR EXCHANGE', 'ARMORY', 'PILL PAVILION', 'GENE CLINIC', 'CULTIVATION', 'TEAHOUSE', 'NOODLES', 'APARTMENTS', 'VEHICLE DEALER', 'SERVICE ACCESS'];
let textures;
function streetTextures() {
  if (textures) return textures;
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 512;
  const c = canvas.getContext('2d');
  c.fillStyle = '#101e28'; c.fillRect(0, 0, 512, 512);
  LABELS.forEach((label, i) => {
    c.fillStyle = i % 2 ? '#e7d8ac' : '#89d4d9';
    c.fillRect(8, i * 32 + 6, 3, 20);
    c.font = 'bold 20px sans-serif'; c.textBaseline = 'middle';
    c.fillText(label, 22, i * 32 + 16);
    c.fillStyle = '#344650'; c.fillRect(0, i * 32 + 31, 512, 1);
  });
  const signs = new THREE.CanvasTexture(canvas);
  signs.colorSpace = THREE.SRGBColorSpace;
  signs.anisotropy = 4;
  const tile = document.createElement('canvas');
  tile.width = tile.height = 128;
  const p = tile.getContext('2d'), r = mulberry32(701);
  p.fillStyle = '#91958f'; p.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 1500; i++) {
    const v = 110 + Math.floor(r() * 60);
    p.fillStyle = `rgb(${v},${v + 2},${v})`;
    p.fillRect(Math.floor(r() * 128), Math.floor(r() * 128), 1, 1);
  }
  p.fillStyle = '#5d6563'; p.fillRect(0, 0, 128, 2); p.fillRect(0, 0, 2, 128);
  p.fillStyle = '#adb1aa'; p.fillRect(2, 2, 126, 1); p.fillRect(2, 2, 1, 126);
  const paving = new THREE.CanvasTexture(tile);
  paving.colorSpace = THREE.SRGBColorSpace;
  paving.wrapS = paving.wrapT = THREE.RepeatWrapping;
  paving.anisotropy = 4;
  return textures = { signs, paving };
}

// Terra-only, close-range street dressing. A small number of cells is built
// incrementally; each cell uses at most five material batches. No per-prop
// update loop, dynamic lights, shadow maps, or individual sign textures.
export class TerraStreets {
  constructor({ parent, radius, plaza, padX, buildings, venues, drop, addBox, range = 80, exclude = null }) {
    Object.assign(this, { parent, radius, plaza, drop });
    this.range = Math.max(36, Math.min(90, range));
    this.cells = new Map(); this.live = new Map(); this.disposed = false;
    const tex = streetTextures();
    this.materials = {
      surface: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0.05 }),
      metal: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.48, metalness: 0.55 }),
      paving: new THREE.MeshStandardMaterial({ map: tex.paving, vertexColors: true, roughness: 0.92 }),
      glow: new THREE.MeshBasicMaterial({ vertexColors: true }),
      sign: new THREE.MeshBasicMaterial({ map: tex.signs }),
    };
    this.stats = { cells: 0, meshes: 0, triangles: 0 };
    const add = (type, x, z, ry = 0, data = {}) => {
      if (exclude?.(x, z, 12, 12)) return;
      if (Math.hypot(x, z) > radius - 24 || (x > padX - 70 && Math.abs(z) < 74)) return;
      const key = `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
      if (!this.cells.has(key)) this.cells.set(key, []);
      const entry = { type, x, z, ry, ...data };
      this.cells.get(key).push(entry);
      if (data.collider) {
        const [w, h, d] = data.collider;
        const ex = (Math.abs(Math.cos(ry)) * w + Math.abs(Math.sin(ry)) * d) / 2;
        const ez = (Math.abs(Math.sin(ry)) * w + Math.abs(Math.cos(ry)) * d) / 2;
        addBox(x - ex, x + ex, 0, h, z - ez, z + ez);
      }
    };
    const clear = (x, z, w, d) => !buildings.some(b => Math.abs(x - b.x) < (w + b.w) / 2 + 1 && Math.abs(z - b.z) < (d + b.d) / 2 + 1);
    for (let t = -radius + 36; t < radius - 36; t += 8) {
      if (Math.abs(t) < plaza + 6) continue;
      for (const side of [-1, 1]) for (const axis of [0, 1]) {
        const x = axis ? t : side * 9, z = axis ? side * 9 : t;
        if (clear(x, z, axis ? 8 : 3, axis ? 3 : 8)) add('pavement', x, z, axis * Math.PI / 2);
      }
    }
    // Street furniture stays outside the crossing, market stalls and doors.
    for (let t = -radius + 64, i = 0; t < radius - 64; t += 48, i++) {
      if (Math.abs(t) < plaza + 22) continue;
      for (const side of [-1, 1]) {
        const x = side * 10.4;
        if (t > 0 && clear(x, t, 2.6, 4)) add(i % 3 ? 'planter' : 'bench', x, t, side * Math.PI / 2,
          { collider: i % 3 ? [2.5, 0.75, 1.1] : [2.6, 0.5, 0.65] });
        if (clear(t, x, 4, 2.6)) add(i % 3 ? 'planter' : 'bench', t, x, side > 0 ? Math.PI : 0,
          { collider: i % 3 ? [2.5, 0.75, 1.1] : [2.6, 0.5, 0.65] });
      }
    }
    // Two planted courts beside the starting plaza give arrival a human scale.
    for (const side of plaza >= 50 ? [-1, 1] : []) {
      const x = side * 29, z = -plaza * 0.72;
      add('court', x, z, 0);
      add('bench', x, z - 4, 0, { collider: [2.6, 0.5, 0.65] });
      add('bench', x, z + 4, Math.PI, { collider: [2.6, 0.5, 0.65] });
      add('planter', x - 4.2, z, Math.PI / 2, { collider: [2.5, 0.75, 1.1] });
      add('tree', x + 4.2, z, 0, { collider: [1.8, 0.8, 1.8] });
      add('wayfinding', x + side * 5, z - 4, 0, { label: side > 0 ? 0 : 5 });
    }
    for (const side of [-1, 1]) {
      const z = plaza + 30, x = side * 11;
      if (clear(x, z, 3, 7)) add('shelter', x, z, side * Math.PI / 2);
      add('wayfinding', side * 10, -plaza - 4, 0, { label: 2 });
      add('crossing', 0, side * (plaza + 8), 0);
    }
    const labels = { exchange: 6, forge: 7, pills: 8, clinic: 9, chamber: 10, bar: 11, food: 12, home: 13, dealer: 14, hall: 1, lobby: 3 };
    for (const v of venues) {
      if (v.noInterior || v.authored || !v.frame) continue;
      const [x, z] = v.frame(0, -v.bd / 2 - 0.2);
      add('storefront', x, z, v.ry, { width: v.bw, label: labels[v.kind] ?? 15 });
    }
  }

  build(key) {
    const entries = this.cells.get(key), group = new THREE.Group();
    const [cx, cz] = key.split(',').map(Number).map(v => (v + 0.5) * CELL);
    const parts = Object.fromEntries(Object.keys(this.materials).map(k => [k, []]));
    for (const e of entries) {
      const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), e.ry);
      const origin = new THREE.Vector3(e.x - cx, this.drop(e.x, e.z), e.z - cz);
      const put = (kind, geo, color, x = 0, y = 0, z = 0) => {
        geo.translate(x, y, z);
        geo.applyQuaternion(rotation); geo.translate(origin.x, origin.y, origin.z);
        const position = geo.attributes.position;
        for (let i = 0; i < position.count; i++) position.setY(i, position.getY(i) + this.drop(position.getX(i) + cx, position.getZ(i) + cz) - origin.y);
        if (kind !== 'sign') {
          const c = new THREE.Color(color), p = geo.attributes.position, arr = new Float32Array(p.count * 3);
          for (let i = 0; i < p.count; i++) {
            const shade = kind === 'glow' ? 1 : 0.86 + 0.14 * Math.min(1, Math.max(0, p.getY(i) - origin.y));
            arr.set([c.r * shade, c.g * shade, c.b * shade], i * 3);
          }
          geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
        }
        parts[kind].push(geo.index ? geo.toNonIndexed() : geo);
      };
      const box = (kind, color, w, h, d, x, y, z) => put(kind, bevelBox(w, h, d), color, x, y, z);
      const sign = (label, w, x, y, z) => {
        const geo = new THREE.PlaneGeometry(w, w / 16);
        const uv = geo.attributes.uv;
        for (let i = 0; i < uv.count; i++) uv.setY(i, (15 - label + uv.getY(i)) / 16);
        put('sign', geo, null, x, y, z);
      };
      const bench = (z = 0) => {
        for (const x of [-1, 1]) box('metal', 0x3b474d, 0.13, 0.48, 0.7, x, 0.24, z);
        for (let k = 0; k < 4; k++) box('surface', 0x88694b, 2.6, 0.08, 0.13, 0, 0.5, z - 0.24 + k * 0.16);
        for (let k = 0; k < 3; k++) box('surface', 0x88694b, 2.6, 0.11, 0.08, 0, 0.72 + k * 0.14, z + 0.32);
      };
      if (e.type === 'pavement') {
        const geo = new THREE.BoxGeometry(3, 0.1, 8.05), uv = geo.attributes.uv;
        for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 3, uv.getY(i) * 8);
        put('paving', geo, 0xb5bbb5, 0, 0, 0);
        box('surface', 0x697577, 0.15, 0.16, 8.05, -1.5, 0.03, 0);
        // Recessed drainage and tactile edging, baked into the same batches.
        box('metal', 0x252e33, 0.26, 0.03, 1.3, -1.25, 0.065, 0);
        for (let k = 0; k < 6; k++) box('metal', 0x657176, 0.3, 0.025, 0.045, -1.25, 0.085, -0.5 + k * 0.2);
        box('surface', 0xb29e68, 0.22, 0.015, 8, -0.95, 0.065, 0);
      } else if (e.type === 'bench') bench();
      else if (e.type === 'court') {
        const geo = new THREE.BoxGeometry(11, 0.08, 11), uv = geo.attributes.uv;
        for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 11, uv.getY(i) * 11);
        put('paving', geo, 0xa5aaa6, 0, 0, 0);
        box('glow', 0x57948c, 0.06, 0.025, 10.5, -5.2, 0.06, 0);
      } else if (e.type === 'planter' || e.type === 'tree') {
        const tree = e.type === 'tree';
        box('surface', 0x697472, tree ? 1.8 : 2.5, 0.75, tree ? 1.8 : 1.1, 0, 0.375, 0);
        box('surface', 0x302b23, tree ? 1.55 : 2.25, 0.05, tree ? 1.55 : 0.85, 0, 0.77, 0);
        if (tree) {
          put('surface', new THREE.CylinderGeometry(0.12, 0.2, 2.8, 7), 0x69533b, 0, 2.1, 0);
          for (const [x, y, z, s] of [[0, 3.8, 0, 1.45], [-0.9, 3.4, 0.3, 1.0], [0.8, 4.1, -0.3, 1]]) {
            put('surface', new THREE.IcosahedronGeometry(s, 1).scale(1, 0.75, 1), 0x557b49, x, y, z);
          }
        } else for (let i = 0; i < 5; i++) put('surface', new THREE.IcosahedronGeometry(0.42, 1).scale(1, 0.8, 0.85), 0x52784a, -0.9 + i * 0.45, 1, 0);
      } else if (e.type === 'wayfinding') {
        box('metal', 0x3f4c51, 0.12, 3.5, 0.12, 0, 1.75, 0);
        box('metal', 0x28343e, 3.4, 0.65, 0.15, 0, 3.1, 0);
        sign(e.label, 3.2, 0, 3.14, 0.081);
        sign(3, 2.6, 0, 2.8, 0.081);
      } else if (e.type === 'shelter') {
        for (const x of [-2.1, 2.1]) box('metal', 0x465760, 0.12, 2.8, 0.12, x, 1.4, 0.65);
        box('metal', 0x3c4c55, 4.8, 0.14, 2.1, 0, 2.85, 0);
        for (let i = 0; i < 6; i++) box('surface', 0x596e76, 0.05, 1.4, 0.08, -1.9 + i * 0.35, 1.8, 0.66);
        box('glow', 0x92c3c1, 3.8, 0.035, 0.08, 0, 2.76, -0.7);
        sign(4, 3.5, 0, 2.64, -0.9);
        bench(0.35);
      } else if (e.type === 'crossing') {
        for (let i = 0; i < 9; i++) box('surface', 0xa9aaa0, 0.65, 0.015, 2.8, -5.2 + i * 1.3, 0.12, 0);
      } else if (e.type === 'storefront') {
        const w = Math.min(9, e.width - 2);
        box('metal', 0x35424c, w, 0.16, 1.6, 0, 4.9, -0.65);
        box('surface', 0x53575b, w, 0.35, 0.18, 0, 4.7, -1.4);
        box('glow', 0x88b7b0, w * 0.65, 0.025, 0.06, 0, 4.79, -1.2);
        // Front is local -Z. Rotate the atlas plane to face the street.
        const plate = new THREE.PlaneGeometry(w * 0.82, w * 0.82 / 16).rotateY(Math.PI);
        const uv = plate.attributes.uv;
        for (let i = 0; i < uv.count; i++) uv.setY(i, (15 - e.label + uv.getY(i)) / 16);
        put('sign', plate, null, 0, 4.55, -1.51);
        for (const side of [-1, 1]) {
          const x = side * Math.min(e.width * 0.33, 5.5);
          box('metal', 0x35434e, 1.7, 1.3, 0.12, x, 1.9, -0.12);
          for (let i = 0; i < 4; i++) box('metal', 0x78858a, 1.5, 0.04, 0.16, x, 1.4 + i * 0.3, -0.22);
          box('metal', 0x3e4c50, 0.08, 3.6, 0.08, side * (w / 2 + 0.2), 2.1, -0.17);
        }
      }
    }
    let triangles = 0;
    for (const [kind, list] of Object.entries(parts)) {
      if (!list.length) continue;
      const geo = mergeGeometries(list);
      list.forEach(g => g.dispose());
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, this.materials[kind]);
      group.add(mesh); triangles += geo.attributes.position.count / 3;
    }
    group.position.set(cx, 0, cz);
    group.userData.triangles = triangles;
    addCompiled(this.parent, group, 'terra-streets');
    this.live.set(key, group);
  }

  update(position) {
    if (this.disposed) return;
    const altitude = position.y - this.drop(position.x, position.z);
    const wanted = [];
    if (altitude < 65 && altitude > -12) for (const key of this.cells.keys()) {
      const [x, z] = key.split(',').map(Number).map(v => (v + 0.5) * CELL);
      const distance = Math.hypot(position.x - x, position.z - z);
      if (distance < this.range) wanted.push([key, distance]);
    }
    wanted.sort((a, b) => a[1] - b[1]);
    const keep = new Set(wanted.slice(0, 9).map(([key]) => key));
    for (const [key, group] of this.live) if (!keep.has(key)) {
      cancelAdd(group); group.removeFromParent();
      group.traverse(o => o.geometry?.dispose()); this.live.delete(key);
    }
    // At most one cell construction per frame, even after a teleport.
    const next = wanted.find(([key]) => keep.has(key) && !this.live.has(key));
    if (next) this.build(next[0]);
    this.stats.cells = this.live.size;
    this.stats.meshes = [...this.live.values()].reduce((sum, g) => sum + g.children.length, 0);
    this.stats.triangles = [...this.live.values()].reduce((sum, g) => sum + g.userData.triangles, 0);
  }

  surfaceAt(position) {
    const cx = Math.floor(position.x / CELL), cz = Math.floor(position.z / CELL);
    for (let x = cx - 1; x <= cx + 1; x++) for (let z = cz - 1; z <= cz + 1; z++) {
      for (const e of this.cells.get(`${x},${z}`) || []) {
        if (e.type !== 'pavement' && e.type !== 'court') continue;
        const dx = position.x - e.x, dz = position.z - e.z;
        const lx = dx * Math.cos(e.ry) - dz * Math.sin(e.ry), lz = dx * Math.sin(e.ry) + dz * Math.cos(e.ry);
        if (Math.abs(lx) < (e.type === 'court' ? 5.5 : 1.5) && Math.abs(lz) < (e.type === 'court' ? 5.5 : 4)) return true;
      }
    }
    return false;
  }

  dispose() {
    for (const group of this.live.values()) {
      cancelAdd(group); group.removeFromParent(); group.traverse(o => o.geometry?.dispose());
    }
    this.live.clear(); this.cells.clear(); this.disposed = true;
    Object.values(this.materials).forEach(m => m.dispose());
  }
}
