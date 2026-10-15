import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { bevelBox } from './geometry.js';
import { blockMaterials } from './block-materials.js';
import { addCompiled, cancelAdd } from '../core/precompile.js';

export const TERRA_BLOCK_BOUNDS = { x0: 17, x1: 76, z0: -85, z1: -27 };
export const inTerraBlock = (x, z, w = 0, d = 0) => x + w / 2 > 17 && x - w / 2 < 76 && z + d / 2 > -85 && z - d / 2 < -27;
const ORIGIN = { x: 46, z: -56 };
export const CONCOURSE_BUILDINGS = [
  { x: -16, z: -12, w: 18, d: 14, floors: 4, kind: 'food', name: 'Meridian Noodles', label: 1, front: 1, skin: 'brick' },
  { x: 6, z: -12, w: 17, d: 14, floors: 5, kind: 'forge', name: 'Kite Armory & Repairs', label: 2, front: 1, skin: 'plaster' },
  { x: -8, z: 13, w: 21, d: 14, floors: 3, kind: 'home', name: 'South Court Reception', label: 3, front: -1, skin: 'plaster', through: true },
  { x: 18, z: 13, w: 14, d: 14, floors: 5, kind: 'pills', name: 'Botanica Apothecary', label: 4, front: -1, skin: 'brick' },
];

// A composed, human-scale city block: four functional ground floors, a lane,
// rear passage and accessible terrace. Detailed geometry only lives nearby.
export class TerraBlock {
  constructor({ parent, drop, addBox, toLocal, cityName }) {
    Object.assign(this, { drop, addBox, toLocal, cityName });
    this.group = new THREE.Group(); this.group.name = 'South Concourse';
    this.group.position.set(ORIGIN.x, drop(ORIGIN.x, ORIGIN.z), ORIGIN.z); parent.add(this.group);
    this.materials = blockMaterials(); this.rooms = []; this.services = []; this.disposed = false;
    this.stats = { meshes: 0, triangles: 0 };
    this.proxy = new THREE.Group(); this.proxy.name = 'Concourse distant silhouettes'; this.group.add(this.proxy);
    const proxies = [];
    for (const b of CONCOURSE_BUILDINGS) {
      const h = 3.6 + b.floors * 3.05;
      proxies.push(new THREE.BoxGeometry(b.w, h, b.d).translate(b.x, h / 2, b.z).toNonIndexed());
      this.registerBuilding(b, h);
    }
    const geo = mergeGeometries(proxies); proxies.forEach(g => g.dispose());
    const white = new Float32Array(geo.attributes.position.count * 3).fill(1);
    geo.setAttribute('color', new THREE.BufferAttribute(white, 3));
    geo.setAttribute('bakedLight', new THREE.BufferAttribute(new Float32Array(white.length), 3));
    this.proxy.add(new THREE.Mesh(geo, this.materials.plaster));
    // Terrace slab: ceiling underneath, walkable deck above.
    this.collider(16, 25, 3.35, 3.6, -17, -7.7, { ceil: true });
    for (let i = 0; i < 18; i++) this.collider(22.2, 24.6, 0, (i + 1) * 0.2, -2.3 - (i + 1) * 0.3, -2.3 - i * 0.3);
    for (const x of [22.2, 24.6]) for (let i = 0; i < 18; i++) this.collider(x - 0.04, x + 0.04, 0, (i + 1) * 0.2 + 1, -2.3 - (i + 1) * 0.3, -2.3 - i * 0.3);
    this.collider(16, 25, 3.6, 4.65, -17, -16.8);
    this.collider(16, 22, 3.6, 4.65, -7.9, -7.7);
    for (const x of [16, 25]) this.collider(x - 0.08, x + 0.08, 3.6, 4.65, -17, -7.7);
    for (const x of [16.3, 24.7]) for (const z of [-16.7, -8.1]) this.collider(x - 0.12, x + 0.12, 0, 3.35, z - 0.12, z + 0.12);
    for (const [x, z, w, d, y] of [[-18, -9, 1.1, 5, 0.95], [4, -9, 1, 5.5, 1], [-11, 17, 5, 1, 1], [20, 16, 4, 1, 1]]) {
      this.collider(x - w / 2, x + w / 2, 0, y, z - d / 2, z + d / 2);
    }
    for (const [x, z] of [[-21, -14], [-14, -14], [-21, -8], [-10, -15], [-10, -10], [-14, -8]]) this.collider(x - 0.48, x + 0.48, 0, 0.75, z - 0.48, z + 0.48);
    for (const [x, z] of [[-22, -20.5], [0, -20.5], [24, 21.5]]) this.collider(x - 0.65, x + 0.65, 0, 1.2, z - 0.5, z + 0.5);
  }

  collider(x0, x1, y0, y1, z0, z1, extra = {}) {
    this.addBox(x0 + ORIGIN.x, x1 + ORIGIN.x, y0, y1, z0 + ORIGIN.z, z1 + ORIGIN.z, extra);
  }

  registerBuilding(b, h) {
    const { x, z, w, d } = b, front = z + b.front * d / 2, back = z - b.front * d / 2;
    this.collider(x - w / 2, x - w / 2 + 0.3, 0, h, z - d / 2, z + d / 2);
    this.collider(x + w / 2 - 0.3, x + w / 2, 0, h, z - d / 2, z + d / 2);
    const wall = (at, opening) => {
      const z0 = at - 0.15, z1 = at + 0.15;
      if (!opening) this.collider(x - w / 2, x + w / 2, 0, h, z0, z1);
      else {
        this.collider(x - w / 2, x - 1.2, 0, h, z0, z1);
        this.collider(x + 1.2, x + w / 2, 0, h, z0, z1);
        this.collider(x - 1.2, x + 1.2, 2.85, h, z0, z1, { ceil: true });
      }
    };
    wall(front, true); wall(back, b.through);
    this.collider(x - w / 2, x + w / 2, 3.35, h, z - d / 2, z + d / 2, { ceil: true });
    const ry = b.front === 1 ? Math.PI : 0;
    const frame = (lx, lz) => [ORIGIN.x + x + lx * Math.cos(ry) + lz * Math.sin(ry), ORIGIN.z + z - lx * Math.sin(ry) + lz * Math.cos(ry)];
    const room = { kind: b.kind, name: b.name, cn: '', x: ORIGIN.x + x, z: ORIGIN.z + z, w, d, bw: w, bd: d, ry,
      h, G: 3.35, authored: true, frame, door: this.toLocal(ORIGIN.x + x, 0.5, ORIGIN.z + front + b.front * 0.5), interior: null };
    this.rooms.push(room);
    this.services.push({ kind: b.kind, name: b.name, pos: this.toLocal(ORIGIN.x + x, 1.6, ORIGIN.z + z), range: 4.5, venue: room, city: this.cityName });
  }

  buildDetails() {
    const parts = Object.fromEntries(Object.keys(this.materials).map(k => [k, []]));
    const put = (kind, geo, x = 0, y = 0, z = 0, color = 0xffffff, ry = 0) => {
      geo.rotateY(ry).translate(x, y, z);
      const p = geo.attributes.position, n = geo.attributes.normal, uv = geo.attributes.uv;
      const colors = new Float32Array(p.count * 3), baked = new Float32Array(p.count * 3), c = new THREE.Color(color);
      const textured = ['brick', 'plaster', 'stone', 'wood'].includes(kind);
      for (let i = 0; i < p.count; i++) {
        const px = p.getX(i), py = p.getY(i), pz = p.getZ(i);
        if (textured) {
          const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
          const scale = kind === 'stone' ? 1 : kind === 'wood' ? 0.5 : 0.5;
          uv.setXY(i, (ax > az ? pz : px) * scale, (ay > Math.max(ax, az) ? pz : py) * scale);
        }
        let shade = 0.75 + 0.25 * Math.min(1, Math.max(0, py) / 0.9);
        if (kind === 'stone' && py < 0.2) {
          let distance = 4;
          for (const b of CONCOURSE_BUILDINGS) distance = Math.min(distance, Math.hypot(Math.max(0, Math.abs(px - b.x) - b.w / 2), Math.max(0, Math.abs(pz - b.z) - b.d / 2)));
          shade *= 0.64 + 0.36 * Math.min(1, distance / 2.4);
        }
        colors.set([c.r * shade, c.g * shade, c.b * shade], i * 3);
        for (const b of CONCOURSE_BUILDINGS) if (py < 3.35 && Math.abs(px - b.x) < b.w / 2 && Math.abs(pz - b.z) < b.d / 2) {
          const dx = (px - b.x) % 3.5, dz = pz - b.z, dy = 3.2 - py;
          const strength = 1.1 / (1 + (dx * dx + dz * dz * 0.3 + dy * dy) / 8);
          baked.set([strength, strength * 0.76, strength * 0.48], i * 3);
        }
        p.setY(i, py + this.drop(px + ORIGIN.x, pz + ORIGIN.z) - this.group.position.y);
      }
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geo.setAttribute('bakedLight', new THREE.BufferAttribute(baked, 3));
      const flat = geo.index ? geo.toNonIndexed() : geo;
      if (flat !== geo) geo.dispose();
      parts[kind].push(flat);
    };
    const box = (kind, w, h, d, x, y, z, color = 0xffffff) => put(kind, bevelBox(w, h, d), x, y, z, color);
    const sign = (row, w, x, y, z, ry = 0) => {
      const g = new THREE.PlaneGeometry(w, w / 8), uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setY(i, (15 - row + uv.getY(i)) / 16);
      put('sign', g, x, y, z, 0xffffff, ry);
    };
    const cylinder = (kind, r, h, x, y, z, color = 0xffffff) => put(kind, new THREE.CylinderGeometry(r, r, h, 12), x, y, z, color);
    const rail = (x0, x1, y, z) => {
      box('metal', x1 - x0, 0.045, 0.045, (x0 + x1) / 2, y + 1, z);
      box('metal', x1 - x0, 0.035, 0.035, (x0 + x1) / 2, y + 0.25, z);
      for (let x = x0; x <= x1 + 0.01; x += 0.55) box('metal', 0.035, 1, 0.035, x, y + 0.5, z);
    };
    const plant = (x, y, z, size = 0.65) => {
      put('stone', new THREE.CylinderGeometry(size * 0.45, size * 0.35, size * 0.65, 12), x, y + size * 0.325, z);
      for (let i = 0; i < 5; i++) {
        const angle = i * 2.4;
        put('leaves', new THREE.SphereGeometry(size * 0.36, 8, 6).scale(0.5, 1.8, 0.5).rotateZ(Math.sin(angle) * 0.6), x + Math.cos(angle) * size * 0.23, y + size * 1.1, z + Math.sin(angle) * size * 0.23);
      }
    };
    const chair = (x, z, ry = 0, y = 0) => {
      // Construct furniture in a temporary frame, then bake its placement.
      const bits = [[0.46, 0.07, 0.48, 0, 0.45, 0], [0.46, 0.44, 0.065, 0, 0.72, 0.22]];
      for (const [w, h, d, lx, ly, lz] of bits) {
        const v = new THREE.Vector3(lx, ly, lz).applyAxisAngle(new THREE.Vector3(0, 1, 0), ry);
        put('wood', new THREE.BoxGeometry(w, h, d).rotateY(ry), x + v.x, y + v.y, z + v.z);
      }
      for (const lx of [-0.18, 0.18]) for (const lz of [-0.18, 0.18]) {
        const v = new THREE.Vector3(lx, 0.22, lz).applyAxisAngle(new THREE.Vector3(0, 1, 0), ry);
        box('metal', 0.035, 0.44, 0.035, x + v.x, y + v.y, z + v.z);
      }
    };
    const person = (x, z, ry, skin, coat) => {
      const part = (geo, px, py, pz, color) => {
        const v = new THREE.Vector3(px, py, pz).applyAxisAngle(new THREE.Vector3(0, 1, 0), ry);
        put('fabric', geo.rotateY(ry), x + v.x, v.y, z + v.z, color);
      };
      part(new THREE.CapsuleGeometry(0.2, 0.4, 3, 10), 0, 1.12, 0, coat);
      part(new THREE.SphereGeometry(0.17, 12, 8), 0, 1.65, 0, skin);
      part(new THREE.SphereGeometry(0.175, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.48), 0, 1.67, 0, 0x2b2926);
      for (const side of [-1, 1]) {
        part(new THREE.SphereGeometry(0.018, 6, 4), side * 0.06, 1.68, -0.155, 0x282a27);
        part(new THREE.SphereGeometry(0.065, 8, 6), side * 0.3, 0.76, 0, skin);
        part(new THREE.SphereGeometry(0.09, 8, 6).scale(1, 0.55, 1.5), side * 0.105, 0.08, -0.045, 0x242a2b);
      }
      part(new THREE.SphereGeometry(0.03, 6, 4), 0, 1.62, -0.17, skin);
      for (const side of [-1, 1]) {
        part(new THREE.CapsuleGeometry(0.075, 0.55, 3, 8), side * 0.105, 0.45, 0, 0x303c40);
        part(new THREE.CapsuleGeometry(0.065, 0.43, 3, 8).rotateZ(side * 0.15), side * 0.27, 1.04, 0, coat);
      }
    };

    // Continuous paving, not disconnected props scattered across bare terrain.
    put('stone', new THREE.PlaneGeometry(58, 56, 58, 56).rotateX(-Math.PI / 2), 0, 0.045, 0);
    for (const side of [-1, 1]) {
      box('stone', 54, 0.12, 0.16, -1, 0.06, side * 4.7);
      box('dark', 52, 0.025, 0.18, -1, 0.07, side * 4.4);
      for (let x = -25; x < 25; x += 0.5) box('metal', 0.03, 0.015, 0.2, x, 0.09, side * 4.4);
    }
    sign(0, 7, -24, 3.6, 3.8, -Math.PI / 2);
    box('metal', 0.14, 3.8, 0.14, -24, 1.9, 3.8);

    for (const b of CONCOURSE_BUILDINGS) {
      const { x, z, w, d, front } = b, h = 3.6 + b.floors * 3.05, fz = z + front * d / 2, back = z - front * d / 2;
      const ry = front === 1 ? 0 : Math.PI;
      // Solid side walls and a rear service entrance where appropriate.
      for (const side of [-1, 1]) box(b.skin, 0.3, h, d, x + side * (w / 2 - 0.15), h / 2, z);
      if (!b.through) box(b.skin, w, h, 0.3, x, h / 2, back);
      else {
        for (const side of [-1, 1]) box(b.skin, (w - 2.4) / 2, h, 0.3, x + side * (w + 2.4) / 4, h / 2, back);
        box(b.skin, 2.4, h - 2.85, 0.3, x, (h + 2.85) / 2, back);
      }
      box('stone', w - 0.4, 0.12, d - 0.4, x, 0, z);
      box('plaster', w, 0.25, d, x, 3.475, z);
      // Street-facing windows are openings with recessed glass and real jambs.
      const bays = Math.floor(w / 3), bw = w / bays;
      for (let floor = 0; floor < b.floors; floor++) {
        const base = 3.6 + floor * 3.05;
        box(b.skin, w, 0.85, 0.35, x, base + 0.425, fz);
        box(b.skin, w, 0.55, 0.35, x, base + 2.775, fz);
        for (let i = 0; i < bays; i++) {
          const wx = x - w / 2 + (i + 0.5) * bw, ww = bw - 0.45;
          box(b.skin, 0.45, 1.65, 0.35, wx - bw / 2 + 0.225, base + 1.675, fz);
          box('window', ww, 1.65, 0.055, wx + 0.225, base + 1.675, fz - front * 0.16, (i + floor) % 4 === 0 ? 0xd3b58e : 0x80949a);
          box('stone', ww + 0.17, 0.09, 0.52, wx + 0.225, base + 0.84, fz + front * 0.05);
          box('metal', 0.045, 1.65, 0.07, wx + 0.225, base + 1.675, fz - front * 0.1);
          box('metal', ww, 0.045, 0.07, wx + 0.225, base + 1.9, fz - front * 0.1);
          // Individual homes: curtains, partial blinds and occasional window boxes.
          // These opaque details share the existing batches and need no updates.
          if ((i + floor + b.label) % 3 === 0) {
            for (const side of [-1, 1]) box('fabric', ww * 0.2, 1.57, 0.035, wx + 0.225 + side * ww * 0.37, base + 1.675, fz - front * 0.12, b.label % 2 ? 0xb2a28c : 0x728b83);
          } else if ((i * 3 + floor + b.label) % 5 === 0) {
            for (let slat = 0; slat < 5; slat++) box('wood', ww - 0.08, 0.055, 0.04, wx + 0.225, base + 2.42 - slat * 0.1, fz - front * 0.09);
          }
          if (floor === 0 && i % 3 === 0) {
            box('stone', ww * 0.7, 0.22, 0.32, wx + 0.225, base + 0.78, fz + front * 0.25);
            for (let leaf = 0; leaf < 4; leaf++) put('leaves', new THREE.SphereGeometry(0.16, 6, 4).scale(1.2, 0.7, 1), wx + 0.225 + (leaf - 1.5) * 0.32, base + 0.94, fz + front * 0.25);
          }
          if (floor === 1 && i % 3 === 1) {
            box('stone', bw - 0.1, 0.14, 1.1, wx + 0.225, base + 0.65, fz + front * 0.55);
            rail(wx - ww / 2 + 0.225, wx + ww / 2 + 0.225, base + 0.7, fz + front * 1.05);
          }
        }
      }
      box('metal', w + 0.3, 0.15, d + 0.3, x, h + 0.08, z);
      box('stone', w + 0.18, 0.2, 0.4, x, h - 0.1, fz + front * 0.12);
      // Side elevations and the rear carry the same inhabited floor rhythm.
      // Deep sills/jambs recess the opaque upper glazing against the wall.
      for (let floor = 0; floor < b.floors; floor++) {
        const wy = 3.6 + floor * 3.05 + 1.7;
        for (const side of [-1, 1]) for (let i = 0; i < 4; i++) {
          const wz = z - d / 2 + 2 + i * 3.1, wx = x + side * (w / 2 + 0.025);
          box('window', 0.055, 1.5, 1.65, wx, wy, wz, (floor + i) % 5 ? 0x91a1a2 : 0xe1c7a4);
          box('stone', 0.45, 0.1, 1.9, wx + side * 0.08, wy - 0.78, wz);
          for (const edge of [-1, 1]) box('metal', 0.13, 1.6, 0.045, wx + side * 0.05, wy, wz + edge * 0.84);
          box('metal', 0.13, 1.5, 0.035, wx + side * 0.05, wy, wz);
        }
        for (let i = 0; i < Math.floor(w / 3); i++) {
          const wx = x - w / 2 + 1.5 + i * 3;
          box('window', 1.7, 1.5, 0.055, wx, wy, back - front * 0.18);
          box('stone', 1.95, 0.1, 0.45, wx, wy - 0.78, back - front * 0.23);
          box('metal', 0.045, 1.5, 0.13, wx, wy, back - front * 0.24);
        }
      }
      // Ground floor: transoms, shop windows, an open door and weather canopy.
      for (const side of [-1, 1]) {
        const sw = (w - 2.4) / 2, wx = x + side * (w + 2.4) / 4;
        box(b.skin, sw, 0.38, 0.3, wx, 0.19, fz);
        box('glass', sw - 0.2, 2.42, 0.025, wx, 1.59, fz - front * 0.08);
        box('metal', sw, 0.09, 0.14, wx, 0.38, fz);
        for (let gx = wx - sw / 2; gx <= wx + sw / 2; gx += 1.8) box('metal', 0.055, 2.5, 0.16, gx, 1.6, fz);
        box('metal', 0.07, 2.9, 0.15, x + side * 1.2, 1.45, fz);
      }
      box(b.skin, w, 0.65, 0.35, x, 3.075, fz);
      box('metal', w + 0.4, 0.12, 1.6, x, 3.4, fz + front * 0.65);
      box('wood', w + 0.1, 0.06, 1.3, x, 3.31, fz + front * 0.65);
      for (let sx = x - w / 2 + 1; sx < x + w / 2; sx += 3) box('light', 0.7, 0.025, 0.12, sx, 3.25, fz + front * 0.8);
      sign(b.label, Math.min(w - 1, 9), x, 3.08, fz + front * 1.47, ry);
      box('wood', w - 0.7, 0.1, 0.3, x, 2.95, z - front * (d / 2 - 0.5));
      // Back-of-house plumbing, condensers and ventilated plant cabinets.
      for (let i = 0; i < 2; i++) {
        const ax = x - w / 2 + 2 + i * 2;
        box('metal', 1.3, 0.8, 0.55, ax, 3.9, back - front * 0.32);
        put('dark', new THREE.TorusGeometry(0.26, 0.03, 4, 12), ax, 3.9, back - front * 0.62);
        for (let k = 0; k < 5; k++) box('dark', 0.8, 0.035, 0.03, ax, 3.65 + k * 0.1, back - front * 0.62);
      }
      cylinder('metal', 0.045, h - 0.3, x + w / 2 - 0.5, (h - 0.3) / 2, back - front * 0.25);
      for (let sx = x - w / 2 + 1.5; sx < x + w / 2; sx += 3.5) box('light', 1.3, 0.04, 0.22, sx, 3.28, z);
      // Roof plant and parapets give each silhouette a useful, inhabited top.
      for (const side of [-1, 1]) {
        box(b.skin, w, 0.45, 0.2, x, h + 0.3, z + side * (d / 2 - 0.1));
        box(b.skin, 0.2, 0.45, d, x + side * (w / 2 - 0.1), h + 0.3, z);
      }
      box('metal', 2.2, 0.9, 1.5, x - w * 0.2, h + 0.6, z);
      for (let vent = 0; vent < 7; vent++) box('dark', 1.8, 0.045, 0.03, x - w * 0.2, h + 0.25 + vent * 0.1, z + 0.76);
      cylinder('metal', 0.18, 1.3, x + w * 0.25, h + 0.75, z - 2);
      box('metal', 0.6, 0.08, 0.6, x + w * 0.25, h + 1.42, z - 2);
      // Door bells, kick plates and a perpendicular sign readable along the lane.
      box('metal', 0.15, 0.3, 0.04, x + 1.4, 1.35, fz + front * 0.19);
      box('light', 0.045, 0.045, 0.02, x + 1.4, 1.4, fz + front * 0.22);
      for (const side of [-1, 1]) box('metal', 0.08, 0.85, 0.05, x + side * 1.2, 0.6, fz + front * 0.1);
      const bladeX = x - w / 2 + 0.7, bladeZ = fz + front * 1.1;
      box('metal', 0.09, 0.09, 1.5, bladeX, 4.1, bladeZ);
      sign(b.label, 2.4, bladeX + 0.015, 3.85, bladeZ, Math.PI / 2);
      sign(b.label, 2.4, bladeX - 0.015, 3.85, bladeZ, -Math.PI / 2);
    }

    // Service lanes have practical clutter, kept against the walls and away
    // from the through route. Large bins have matching collision bounds.
    for (const [x, z] of [[-22, -20.5], [0, -20.5], [24, 21.5]]) {
      box('dark', 1.25, 1, 0.95, x, 0.65, z);
      box('metal', 1.32, 0.1, 1.02, x, 1.18, z);
      for (const side of [-1, 1]) cylinder('dark', 0.09, 0.12, x + side * 0.48, 0.12, z + 0.32);
      box('stone', 0.22, 0.14, 0.012, x, 0.8, z + 0.48, 0xc6cfb4);
    }
    for (const [x, z] of [[-20, -20.5], [2, -20.5]]) {
      for (let i = 0; i < 3; i++) {
        box('wood', 1.1, 0.08, 0.16, x, 0.08, z - 0.32 + i * 0.32);
        box('fabric', 0.5, 0.35 + i * 0.08, 0.5, x + (i % 2) * 0.32, 0.3 + i * 0.25, z, 0x998165);
      }
    }
    // A local noticeboard and shop posters reward slowing down to look.
    box('wood', 3.3, 1.65, 0.12, -17, 1.7, 5.77);
    sign(8, 2.9, -17, 2.22, 5.69, Math.PI);
    for (let i = 0; i < 3; i++) sign(9 + i, 0.96, -18.03 + i * 1.03, 1.68 - i * 0.09, 5.69, Math.PI);
    sign(12, 2.6, 4, 2.2, -19.18, Math.PI);
    sign(13, 2.6, -10.9, 2.15, 19.82);
    sign(14, 3.4, -21, 1.95, -5.02);

    // Meridian's counter, bowls, preparation area, tables and mismatched chairs.
    put('wood', new THREE.PlaneGeometry(17.4, 13.4, 12, 10).rotateX(-Math.PI / 2), -16, 0.06, -12);
    box('wood', 17.4, 0.9, 0.06, -16, 0.45, -18.8);
    box('wood', 0.06, 0.9, 13.4, -24.8, 0.45, -12);
    box('brick', 1.1, 0.92, 5, -18, 0.46, -9); box('wood', 1.4, 0.08, 5.2, -18, 0.96, -9);
    box('metal', 1.1, 0.55, 0.7, -18, 1.29, -10); cylinder('metal', 0.16, 0.42, -18, 1.25, -8);
    box('metal', 0.3, 0.04, 0.65, -17.4, 1.03, -10);
    for (const z of [-10.2, -9.8]) {
      put('dark', new THREE.CylinderGeometry(0.045, 0.045, 0.2, 8).rotateZ(Math.PI / 2), -17.35, 1.22, z);
      put('stone', new THREE.TorusGeometry(0.055, 0.01, 4, 10).rotateY(Math.PI / 2), -17.43, 1.45, z);
    }
    sign(6, 4, -19, 2.5, -18.7);
    for (let i = 0; i < 5; i++) {
      put('stone', new THREE.SphereGeometry(0.13, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI), -17.6, 1.08, -10.7 + i * 0.6);
      cylinder('stone', 0.065, 0.13, -18.25, 1.08, -10.7 + i * 0.6);
    }
    for (const [x, z] of [[-21, -14], [-14, -14], [-21, -8], [-10, -15], [-10, -10], [-14, -8]]) {
      box('wood', 0.95, 0.06, 0.95, x, 0.75, z); cylinder('dark', 0.08, 0.72, x, 0.36, z);
      chair(x, z - 0.9); chair(x, z + 0.9, Math.PI);
      cylinder('stone', 0.06, 0.12, x + 0.2, 0.84, z); plant(x - 0.2, 0.78, z, 0.18);
    }
    box('wood', 0.55, 1.8, 5, -24.5, 0.9, -13);
    for (let row = 0; row < 3; row++) {
      box('wood', 0.6, 0.08, 5, -24.4, 0.6 + row * 0.5, -13);
      for (let i = 0; i < 6; i++) cylinder('stone', 0.07, 0.12, -24.1, 0.72 + row * 0.5, -15 + i * 0.7);
    }
    // Kite: a workbench, parts bins, tool silhouettes and a repair cradle.
    box('dark', 1, 0.94, 5.5, 4, 0.47, -9); box('wood', 1.2, 0.08, 5.8, 4, 0.98, -9);
    for (let i = 0; i < 5; i++) {
      box('metal', 0.6, 0.22, 0.45, 4, 1.13, -11 + i * 0.85);
      box('dark', 0.13, 0.8, 0.12, 1 + i * 0.6, 2.1, -18.7);
      box('metal', 0.38, 0.08, 0.1, 1 + i * 0.6, 2.5, -18.65);
    }
    for (let i = 0; i < 3; i++) box('metal', 3, 0.08, 0.7, 10.5, 0.6 + i * 0.8, -17.7);
    cylinder('metal', 0.55, 0.75, 10, 0.375, -10); put('light', new THREE.TorusGeometry(0.4, 0.035, 4, 20).rotateX(Math.PI / 2), 10, 0.76, -10);
    // Residential lobby has an open rear door to the service lane.
    box('wood', 5, 1, 1, -11, 0.5, 17); box('dark', 0.6, 0.55, 0.08, -11, 1.3, 16.7);
    for (let row = 0; row < 3; row++) for (let i = 0; i < 6; i++) box('metal', 0.38, 0.23, 0.2, -16 + i * 0.42, 1.1 + row * 0.27, 19.7);
    box('fabric', 2.2, 0.35, 0.8, -2, 0.35, 17, 0x536565); box('fabric', 2.2, 0.5, 0.2, -2, 0.65, 17.35, 0x536565);
    sign(7, 4, -8, 2.5, 19.7, Math.PI);
    // Botanica: glazed specimen jars and timber shelving, not another empty room.
    box('wood', 4, 0.95, 1, 20, 0.475, 16);
    for (let row = 0; row < 3; row++) {
      box('wood', 0.7, 0.08, 7, 23.8, 0.6 + row * 0.8, 13);
      for (let i = 0; i < 8; i++) cylinder(i % 3 ? 'glass' : 'stone', 0.09, 0.25, 23.6, 0.77 + row * 0.8, 10 + i * 0.8);
    }
    for (const [x, z] of [[-24, -17], [-2, 18], [14, 18], [26, 2], [16, 2]]) plant(x, 0.06, z, 0.85);
    person(-19, -9, Math.PI / 2, 0xb48365, 0x526965);
    person(3, -9, -Math.PI / 2, 0xd6af8a, 0x44535f);
    person(-11, 18, Math.PI, 0xa17b60, 0x666052);
    person(20, 17, Math.PI, 0xcda480, 0x5d6d50);

    // Stair and a usable planted terrace, with a view back toward the plaza.
    box('stone', 9, 0.25, 9.3, 20.5, 3.475, -12.35);
    for (const x of [16.3, 24.7]) for (const z of [-16.7, -8.1]) box('metal', 0.24, 3.35, 0.24, x, 1.675, z);
    for (let i = 0; i < 18; i++) {
      const h = (i + 1) * 0.2;
      box('stone', 2.4, h, 0.3, 23.4, h / 2, -2.45 - i * 0.3);
      box('metal', 2.35, 0.025, 0.035, 23.4, h + 0.012, -2.32 - i * 0.3);
    }
    rail(16.1, 24.9, 3.6, -16.9); rail(16.1, 21.9, 3.6, -7.8);
    for (const x of [16.1, 24.9]) {
      for (let z = -16.8; z < -8; z += 0.55) box('metal', 0.035, 1, 0.035, x, 4.1, z);
      box('metal', 0.045, 0.045, 9.1, x, 4.6, -12.35);
    }
    for (const x of [22.2, 24.6]) {
      const a = new THREE.Vector3(x, 1.2, -2.45), b = new THREE.Vector3(x, 4.6, -7.55), delta = b.clone().sub(a);
      const handrail = new THREE.CylinderGeometry(0.025, 0.025, delta.length(), 8);
      handrail.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize()));
      const center = a.add(b).multiplyScalar(0.5); put('metal', handrail, center.x, center.y, center.z);
      for (let i = 0; i < 18; i += 3) box('metal', 0.04, 1, 0.04, x, (i + 1) * 0.2 + 0.5, -2.45 - i * 0.3);
    }
    plant(17, 3.6, -16, 1); plant(23.7, 3.6, -16, 1); plant(16.9, 3.6, -9, 0.8);
    chair(19, -12, 0, 3.6); chair(21, -12, Math.PI, 3.6);
    cylinder('wood', 0.6, 0.06, 20, 4.35, -12); cylinder('metal', 0.06, 0.7, 20, 3.95, -12);
    sign(5, 2.6, 25, 1.9, -1, -Math.PI / 2);

    const group = new THREE.Group(); group.name = 'Concourse detailed architecture';
    let triangles = 0;
    for (const [kind, list] of Object.entries(parts)) {
      if (!list.length) continue;
      const geo = mergeGeometries(list); list.forEach(g => g.dispose()); geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, this.materials[kind]); mesh.name = kind; group.add(mesh);
      triangles += geo.attributes.position.count / 3;
    }
    this.stats = { meshes: group.children.length, triangles };
    return group;
  }

  update(position) {
    if (this.disposed) return;
    const distance = Math.hypot(position.x - ORIGIN.x, position.z - ORIGIN.z);
    const close = distance < 135 && position.y - this.drop(position.x, position.z) < 65;
    if (close && !this.details) { this.details = this.buildDetails(); addCompiled(this.group, this.details, 'terra-concourse'); }
    if (this.details) this.details.visible = close;
    this.proxy.visible = !close || !this.details?.parent;
    if (this.details && distance > 350) {
      cancelAdd(this.details); this.details.removeFromParent(); this.details.traverse(o => o.geometry?.dispose()); this.details = null;
    }
  }

  surfaceAt(position) { return inTerraBlock(position.x, position.z); }

  dispose() {
    this.disposed = true;
    if (this.details) cancelAdd(this.details);
    this.group.removeFromParent(); this.group.traverse(o => o.geometry?.dispose());
    Object.values(this.materials).forEach(m => m.dispose());
  }
}
