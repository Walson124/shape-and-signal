import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../core/rng.js';

// A field of the lost Aurean Concord's city: broken towers, fallen towers,
// highway fragments, rusted cars, a colossal statue or crashed aircraft, and
// sometimes a bunker with a working terminal. Built in a frame at the field
// centre where +y is up; everything is merged into a few meshes.

let tex = null;
function ruinTextures() {
  if (tex) return tex;
  const s = 256;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const x = c.getContext('2d');
  const r = mulberry32(7);
  x.fillStyle = '#7a7670';
  x.fillRect(0, 0, s, s);
  // stains and grime
  for (let i = 0; i < 260; i++) {
    x.fillStyle = `rgba(${40 + r() * 40},${38 + r() * 40},${30 + r() * 30},${0.05 + r() * 0.12})`;
    const w = 4 + r() * 40;
    x.fillRect(r() * s, r() * s, w, w * (0.3 + r() * 3));
  }
  // empty window holes, some smashed through
  for (let gy = 0; gy < 8; gy++) {
    for (let gx = 0; gx < 8; gx++) {
      if (r() < 0.12) continue;
      x.fillStyle = r() < 0.15 ? '#2a2a26' : '#0c0c0b';
      x.fillRect(gx * 32 + 6, gy * 32 + 8, 20, 16);
    }
  }
  // moss creeping up from the bottom
  for (let i = 0; i < 120; i++) {
    x.fillStyle = `rgba(${50 + r() * 30},${90 + r() * 40},${40 + r() * 20},${0.12 + r() * 0.2})`;
    x.beginPath();
    x.arc(r() * s, s - Math.pow(r(), 2) * s, 3 + r() * 12, 0, Math.PI * 2);
    x.fill();
  }
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = 4;
  tex = map;
  return tex;
}

function uvBox(w, h, d) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv, n = g.attributes.normal;
  for (let i = 0; i < uv.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i));
    uv.setXY(i, uv.getX(i) * (ay > 0.5 ? w : ax > 0.5 ? d : w) / 32, uv.getY(i) * (ay > 0.5 ? d : h) / 26);
  }
  return g;
}

export function buildRuinField(site, planet, opts = {}) {
  const r = mulberry32(site.seed || 1);
  const R = planet.R;
  const up = new THREE.Vector3(site.x, site.y, site.z).normalize();
  const ref = Math.abs(up.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const east = new THREE.Vector3().crossVectors(ref, up).normalize();
  const north = new THREE.Vector3().crossVectors(east, up).normalize();
  const baseR = planet.groundRadius(up.x, up.y, up.z);
  const group = new THREE.Group();
  group.position.copy(up).multiplyScalar(baseR);
  group.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(east, up, north));
  const colliders = [];
  const services = [];
  const parts = { concrete: [], rust: [], stone: [], moss: [], glow: [], dark: [] };
  // ground height (field-local y) under a field-local x,z
  const groundY = (x, z) => {
    const d = up.clone().multiplyScalar(R).addScaledVector(east, x).addScaledVector(north, z).normalize();
    const g = planet.groundRadius(d.x, d.y, d.z);
    return d.multiplyScalar(g).sub(group.position).dot(up);
  };
  const toLocal = (x, y, z) => group.position.clone().addScaledVector(east, x).addScaledVector(up, y).addScaledVector(north, z);
  const put = (list, geo, x, y, z, rx = 0, ry = 0, rz = 0) => {
    geo.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1)));
    list.push(geo.index ? geo.toNonIndexed() : geo);
  };
  const collider = (x, z, radius, height, y0 = null) => {
    const gy = y0 ?? groundY(x, z);
    colliders.push({ pos: toLocal(x, gy, z), up: up.clone(), radius, height });
  };
  const rad = site.radius;
  const spot = () => {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * rad * 0.85;
    return [Math.cos(a) * d, Math.sin(a) * d];
  };
  const clear = [];
  const free = (x, z, need) => clear.every(([cx, cz, cr]) => Math.hypot(x - cx, z - cz) > cr + need);
  // the bunker claims its ground first so nothing lands on top of it
  const bunkerSpot = site.bunker ? (() => { const a = r() * Math.PI * 2, d = rad * (0.2 + r() * 0.4); return [Math.cos(a) * d, Math.sin(a) * d]; })() : null;
  if (bunkerSpot) clear.push([bunkerSpot[0], bunkerSpot[1], 16]);

  // ---- broken towers
  const towers = 8 + Math.floor(r() * 7);
  for (let i = 0; i < towers; i++) {
    let x, z, ok = false;
    for (let k = 0; k < 10 && !ok; k++) { [x, z] = spot(); ok = free(x, z, 22); }
    if (!ok) continue;
    const w = 14 + r() * 14, d = 14 + r() * 14, h = 18 + r() * 75;
    const gy = groundY(x, z) - 3;
    const tilt = r() < 0.3 ? (r() - 0.5) * 0.3 : 0;
    const ry = r() * Math.PI;
    put(parts.concrete, uvBox(w, h, d), x, gy + h / 2, z, tilt, ry, tilt * 0.5);
    // jagged broken top: a few stub floors
    for (let k = 0; k < 3; k++) {
      const sw = w * (0.25 + r() * 0.4), sd = d * (0.25 + r() * 0.4), sh = 3 + r() * 9;
      put(parts.concrete, uvBox(sw, sh, sd), x + (r() - 0.5) * (w - sw), gy + h + sh / 2 - 0.5, z + (r() - 0.5) * (d - sd), tilt, ry, tilt * 0.5);
    }
    // exposed floor slabs sticking out
    for (let k = 0; k < 3; k++) put(parts.dark, new THREE.BoxGeometry(w + 3, 0.6, d * (0.3 + r() * 0.5)), x, gy + h * (0.3 + r() * 0.6), z, tilt, ry, tilt * 0.5);
    // moss on top
    for (let k = 0; k < 4; k++) {
      const m = new THREE.IcosahedronGeometry(1.5 + r() * 2.5, 0);
      m.scale(1, 0.45, 1);
      put(parts.moss, m, x + (r() - 0.5) * w * 0.8, gy + h + 0.5, z + (r() - 0.5) * d * 0.8);
    }
    collider(x, z, Math.max(w, d) * 0.6, h + 4, gy);
    clear.push([x, z, Math.max(w, d) * 0.7]);
  }

  // ---- fallen towers lying in the rubble
  const fallen = 1 + Math.floor(r() * 3);
  for (let i = 0; i < fallen; i++) {
    const [x, z] = spot();
    if (!free(x, z, 30)) continue;
    const len = 40 + r() * 50, w = 12 + r() * 10;
    const a = r() * Math.PI * 2;
    const gy = groundY(x, z);
    put(parts.concrete, uvBox(w, w, len), x, gy + w * 0.3, z, 0.06, a, 0.04);
    for (let k = -1.5; k <= 1.5; k += 1) collider(x + Math.sin(a) * k * len * 0.28, z + Math.cos(a) * k * len * 0.28, w * 0.55, w * 0.8, gy - w * 0.2);
    clear.push([x, z, len * 0.5]);
  }

  // ---- an elevated highway crossing the field, one span collapsed
  if (r() < 0.7) {
    const a = r() * Math.PI;
    const dx = Math.cos(a), dz = Math.sin(a);
    const span = 30, n = Math.floor((rad * 1.7) / span);
    const broken = 1 + Math.floor(r() * (n - 2));
    const deckY = 14;
    for (let i = 0; i <= n; i++) {
      const t = (i - n / 2) * span;
      const x = dx * t, z = dz * t;
      const gy = groundY(x, z);
      const ph = Math.max(2, deckY - gy);
      put(parts.concrete, new THREE.CylinderGeometry(1.8, 2.2, ph + 2, 10), x, gy + ph / 2 - 1, z);
      collider(x, z, 2.4, ph, gy);
      if (i === n) break;
      const mx = x + dx * span / 2, mz = z + dz * span / 2;
      if (i === broken) {
        // the collapsed span leans down to the ground
        const g2 = groundY(mx, mz);
        put(parts.concrete, new THREE.BoxGeometry(18, 1.6, span), mx, g2 + deckY * 0.45, mz, 0.5, -a + Math.PI / 2, 0);
        continue;
      }
      put(parts.concrete, new THREE.BoxGeometry(18, 1.6, span + 0.2), mx, deckY, mz, 0, -a + Math.PI / 2, 0);
      put(parts.rust, new THREE.BoxGeometry(0.3, 1, span), mx + Math.sin(a) * 8.6, deckY + 1.2, mz - Math.cos(a) * 8.6, 0, -a + Math.PI / 2, 0);
      put(parts.rust, new THREE.BoxGeometry(0.3, 1, span), mx - Math.sin(a) * 8.6, deckY + 1.2, mz + Math.cos(a) * 8.6, 0, -a + Math.PI / 2, 0);
      for (let k = -1; k <= 1; k++) collider(mx + dx * k * 10, mz + dz * k * 10, 9, 1.8, deckY - 1);
      // abandoned cars on the deck
      if (r() < 0.6) put(parts.rust, new THREE.BoxGeometry(2, 1.4, 4.4), mx + (r() - 0.5) * 10, deckY + 1.5, mz + (r() - 0.5) * 6, 0, -a + r() * 0.5, 0);
    }
  }

  // ---- rusted cars and rubble on the ground
  for (let i = 0; i < 18; i++) {
    const [x, z] = spot();
    if (!free(x, z, 3)) continue;
    const gy = groundY(x, z);
    const ry = r() * Math.PI * 2, roll = r() < 0.2 ? Math.PI * (0.4 + r() * 0.6) : 0;
    put(parts.rust, new THREE.BoxGeometry(2.1, 1.1, 4.6), x, gy + 0.7, z, 0, ry, roll);
    put(parts.dark, new THREE.BoxGeometry(1.9, 0.8, 2.4), x, gy + 1.5 * (roll ? -0.1 : 1), z, 0, ry, roll);
    collider(x, z, 2.4, 1.6, gy);
  }
  for (let i = 0; i < 40; i++) {
    const [x, z] = spot();
    const g = new THREE.DodecahedronGeometry(1 + r() * 3, 0);
    g.scale(1, 0.5 + r() * 0.4, 1);
    put(r() < 0.5 ? parts.concrete : parts.stone, g, x, groundY(x, z) + 0.3, z, r(), r() * 3, r());
  }

  // ---- a colossus or a crashed aircraft
  if (r() < 0.45) {
    const [x, z] = spot();
    const gy = groundY(x, z);
    const s = 1 + r() * 0.6;
    // a toppled guardian statue: head, hand and a ring
    put(parts.stone, new THREE.SphereGeometry(9 * s, 14, 10), x, gy + 4 * s, z);
    put(parts.stone, new THREE.BoxGeometry(14 * s, 3 * s, 7 * s), x, gy + 7 * s, z + 3 * s, 0.3, 0, 0);
    put(parts.stone, new THREE.ConeGeometry(4 * s, 9 * s, 6), x, gy + 15 * s, z - 2 * s, -0.4, 0, 0);
    const hx = x + 22 * s, hz = z - 8 * s;
    const hy = groundY(hx, hz);
    put(parts.stone, new THREE.BoxGeometry(6 * s, 16 * s, 5 * s), hx, hy + 6 * s, hz, 0.25, 0.4, 0.15);
    for (let f = 0; f < 4; f++) put(parts.stone, new THREE.BoxGeometry(1.4 * s, 6 * s, 1.4 * s), hx - 2 * s + f * 1.4 * s, hy + 16 * s, hz + 0.5 * s, 0.4, 0.4, 0);
    put(parts.glow, new THREE.TorusGeometry(1.4 * s, 0.35 * s, 6, 16), hx - 0.6 * s, hy + 17 * s, hz + 0.5 * s, Math.PI / 2, 0.4, 0);
    collider(x, z, 10 * s, 14 * s, gy);
    collider(hx, hz, 4 * s, 20 * s, hy);
  } else if (r() < 0.5) {
    const [x, z] = spot();
    const gy = groundY(x, z);
    const a = r() * Math.PI * 2;
    put(parts.dark, new THREE.CylinderGeometry(5, 5, 60, 14), x, gy + 2, z, Math.PI / 2 - 0.1, a, 0.15);
    put(parts.dark, new THREE.BoxGeometry(46, 1.2, 9), x, gy + 1, z, 0.2, a, 0.25);
    put(parts.dark, new THREE.BoxGeometry(1.2, 12, 8), x + Math.sin(a) * 28, gy + 6, z + Math.cos(a) * 28, 0, a, 0.4);
    put(parts.glow, new THREE.SphereGeometry(0.5, 6, 4), x + Math.sin(a) * 31, gy + 11, z + Math.cos(a) * 31);
    for (let k = -2; k <= 2; k++) collider(x + Math.sin(a) * k * 12, z + Math.cos(a) * k * 12, 5.5, 6, gy - 2);
  }

  // ---- a bunker with a terminal that still works
  if (site.bunker) {
    const [x, z] = bunkerSpot;
    const gy = groundY(x, z);
    const ry = r() * Math.PI * 2;
    put(parts.concrete, uvBox(12, 6, 9), x, gy + 2.5, z, 0, ry, 0);
    put(parts.dark, new THREE.BoxGeometry(4, 3.4, 0.6), x + Math.sin(ry) * 4.6, gy + 1.9, z + Math.cos(ry) * 4.6, 0, ry, 0);
    put(parts.glow, new THREE.BoxGeometry(1.2, 0.8, 0.2), x + Math.sin(ry) * 4.95 + Math.cos(ry) * 2.8, gy + 1.6, z + Math.cos(ry) * 4.95 - Math.sin(ry) * 2.8, 0, ry, 0);
    collider(x, z, 6.8, 5.5, gy);
    const sx = x + Math.sin(ry) * 9, sz = z + Math.cos(ry) * 9;
    services.push({ kind: 'lore', name: 'Old Concord Terminal', pos: toLocal(sx, groundY(sx, sz) + 1.6, sz), range: 6, lore: site.index });
  }

  // ---- merge
  const mats = {
    concrete: new THREE.MeshStandardMaterial({ map: ruinTextures(), color: 0xd8d2c8, roughness: 0.95, metalness: 0.05, emissive: 0x18160f, emissiveIntensity: 1 }),
    rust: new THREE.MeshStandardMaterial({ color: 0x6a3a22, roughness: 0.85, metalness: 0.4, flatShading: true }),
    stone: new THREE.MeshStandardMaterial({ color: 0x8a8478, roughness: 1, flatShading: true }),
    moss: new THREE.MeshStandardMaterial({ color: 0x3e6a2c, roughness: 1, flatShading: true }),
    dark: new THREE.MeshStandardMaterial({ color: 0x2a2a2c, roughness: 0.8, metalness: 0.3 }),
    glow: new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 0.5, 0.3) }),
  };
  for (const [k, list] of Object.entries(parts)) {
    if (!list.length) continue;
    const geos = list.map((g) => {
      if (k !== 'concrete' && g.attributes.uv) g.deleteAttribute('uv');
      if (k === 'concrete' && !g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      return g;
    });
    group.add(new THREE.Mesh(mergeGeometries(geos), mats[k]));
  }
  void opts;
  let t = 0;
  return {
    site,
    group,
    colliders,
    services,
    radius: rad,
    update(dt) {
      t += dt;
      mats.glow.color.setRGB(2.4 * (0.6 + 0.4 * Math.sin(t * 3)), 0.5, 0.3);
    },
    dispose() {
      group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
      for (const m of Object.values(mats)) m.dispose();
    },
  };
}
