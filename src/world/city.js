import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../core/rng.js';
import { signTexture, glowTexture } from './textures.js';
import { buildShip } from './models.js';

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

const SIGNS = [['武馆', '#ff3c7d'], ['星港', '#3ef2ff'], ['丹药', '#5dffa8'], ['NEON 07', '#ffe44d'], ['基地市', '#3ef2ff'], ['剑阁', '#b98cff'], ['MARTIAL', '#ff3c7d'], ['兑换所', '#ffe44d'], ['飞剑', '#3ef2ff'], ['BEAST BOUNTY', '#ff4466']];

/**
 * Builds a walled city (or a small outpost) in the planet's rotating frame.
 * Returns the group plus colliders and service points in planet-local space.
 */
export function buildSettlement(site, R, opts = {}) {
  const outpost = !site.main;
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
  const services = [];
  const drop = (x, z) => -(x * x + z * z) / (2 * Rs);
  const toLocal = (x, y, z) => up.clone().multiplyScalar(Rs + y + drop(x, z)).addScaledVector(east, x).addScaledVector(north, z);

  const { map, emap } = facadeTextures();
  const towerMat = new THREE.MeshStandardMaterial({ map, emissiveMap: emap, emissive: 0xffffff, emissiveIntensity: 1.15, roughness: 0.5, metalness: 0.45, envMapIntensity: 0.8 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x1a1d24, roughness: 0.6, metalness: 0.6 });
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x6a707c, roughness: 0.7, metalness: 0.35 });
  const neonParts = { cy: [], mg: [], yl: [] };
  const towerParts = [];
  const darkParts = [];
  const wallParts = [];
  const place = (list, geo, x, y, z, ry = 0) => {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y + drop(x, z), z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry), new THREE.Vector3(1, 1, 1));
    list.push(geo.applyMatrix4(m));
  };
  const neon = (key, geo, x, y, z, ry) => place(neonParts[key], geo, x, y, z, ry);
  const addCollider = (x, z, radius, height) => colliders.push({ pos: toLocal(x, 0, z), up: up.clone(), radius, height });

  const radius = site.radius;
  const plaza = outpost ? 26 : 70;
  // ---- buildings
  const step = outpost ? 34 : 46;
  for (let gx = -radius; gx <= radius; gx += step) {
    for (let gz = -radius; gz <= radius; gz += step) {
      const x = gx + (r() - 0.5) * 10, z = gz + (r() - 0.5) * 10;
      const d = Math.hypot(x, z);
      if (d < plaza || d > radius - 34) continue;
      if (!outpost && x > 120 && Math.abs(z) < 70) continue; // shipyard
      if (Math.abs(x) < 8 || Math.abs(z) < 8) continue; // avenues
      if (outpost && r() < 0.35) continue;
      const w = 12 + r() * 16, dd = 12 + r() * 16;
      const centerBoost = outpost ? 0.4 : 1 - d / radius;
      const h = (outpost ? 14 : 22) + r() * 40 + centerBoost * centerBoost * (outpost ? 30 : 150);
      place(towerParts, facadeBox(w, h, dd), x, h / 2, z);
      addCollider(x, z, Math.max(w, dd) * 0.62, h);
      if (r() < 0.55) {
        const k = ['cy', 'mg', 'yl'][Math.floor(r() * 3)];
        for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) neon(k, new THREE.BoxGeometry(0.5, h, 0.5), x + (sx * w) / 2, h / 2, z + (sz * dd) / 2);
      }
      if (r() < 0.5) place(darkParts, new THREE.BoxGeometry(w * 0.5, 4 + r() * 6, dd * 0.5), x, h + 3, z);
      if (r() < 0.35) place(darkParts, new THREE.CylinderGeometry(0.4, 0.4, 14, 5), x + w * 0.2, h + 7, z);
    }
  }

  // ---- wall and towers
  if (!outpost) {
    const segs = 56;
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      if (i % 14 === 0) continue; // gates
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

  // ---- central hall: futuristic pagoda
  const hallH = outpost ? 0 : 150;
  if (!outpost) {
    let y = 0;
    for (let t = 0; t < 6; t++) {
      const s = 34 - t * 4.6;
      const h = t === 0 ? 30 : 20;
      place(towerParts, facadeBox(s, h, s), 0, y + h / 2, 0, Math.PI / 4);
      place(darkParts, new THREE.BoxGeometry(s * 1.5, 1.6, s * 1.5), 0, y + h + 0.8, 0, Math.PI / 4);
      neon(t % 2 ? 'yl' : 'cy', new THREE.TorusGeometry(s * 0.95, 0.35, 4, 4).rotateX(Math.PI / 2), 0, y + h + 1.8, 0, 0);
      y += h + 1.6;
    }
    place(darkParts, new THREE.CylinderGeometry(0.6, 2.4, 40, 8), 0, y + 20, 0);
    neon('mg', new THREE.SphereGeometry(2.2, 12, 8), 0, y + 42, 0);
    addCollider(0, 0, 26, hallH);
  }

  // ---- shipyard pad
  const padX = outpost ? radius * 0.55 : 200;
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
  if (darkParts.length) group.add(new THREE.Mesh(mergeGeometries(darkParts), darkMat));
  if (wallParts.length) group.add(new THREE.Mesh(mergeGeometries(wallParts), wallMat));
  const neonColors = { cy: 0x3ef2ff, mg: 0xff3c7d, yl: 0xffe44d };
  const neonMats = [];
  for (const [k, parts] of Object.entries(neonParts)) {
    if (!parts.length) continue;
    const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(neonColors[k]).multiplyScalar(2.4) });
    neonMats.push(m);
    group.add(new THREE.Mesh(mergeGeometries(parts.map((g) => (g.index ? g : g)).map((g) => { const c = g.clone(); c.deleteAttribute('uv'); c.deleteAttribute('normal'); return c.index ? c.toNonIndexed() : c; })), m));
  }

  // ---- holographic signs
  const signs = [];
  const signCount = outpost ? 3 : 18;
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
    const tex = signTexture('MARTIAL HALL · 武馆', '#ffe44d');
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, color: new THREE.Color(2, 2, 2) });
    const big = new THREE.Mesh(new THREE.PlaneGeometry(60, 9.4), mat);
    big.position.set(0, 38, -24);
    group.add(big);
    signs.push({ mesh: big, mat, phase: 0, flicker: false });
  }

  // ---- street lamps
  const lampGeo = new THREE.SphereGeometry(0.7, 8, 6);
  const lamps = new THREE.InstancedMesh(lampGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 2.0, 1.4) }), outpost ? 20 : 120);
  const poleGeo = new THREE.CylinderGeometry(0.12, 0.18, 7, 5).translate(0, 3.5, 0);
  const poles = new THREE.InstancedMesh(poleGeo, darkMat, lamps.count);
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < lamps.count; i++) {
    const axis = i % 2;
    const t = (r() * 2 - 1) * (radius - 30);
    const side = (r() < 0.5 ? -1 : 1) * (6 + r() * 2);
    const x = axis ? t : side, z = axis ? side : t;
    m4.makeTranslation(x, 7.2 + drop(x, z), z);
    lamps.setMatrixAt(i, m4);
    m4.makeTranslation(x, drop(x, z), z);
    poles.setMatrixAt(i, m4);
  }
  group.add(lamps, poles);

  // ---- flying traffic
  const craft = [];
  for (let i = 0; i < (outpost ? 2 : 12); i++) {
    const ship = buildShip(r() < 0.5 ? 0x3ef2ff : 0xff3c7d);
    ship.scale.setScalar(0.7);
    ship.userData = { a: r() * Math.PI * 2, rad: 60 + r() * (radius - 80), y: 50 + r() * 90, s: (0.05 + r() * 0.08) * (r() < 0.5 ? 1 : -1) };
    group.add(ship);
    craft.push(ship);
  }

  // ---- services
  const svc = (kind, name, x, z) => services.push({ kind, name, pos: toLocal(x, 1.5, z), range: 22 });
  if (outpost) {
    svc('station', site.name, 0, 0);
    svc('shipyard', `${site.name} Shipyard`, padX, 0);
  } else {
    svc('hall', 'Martial Hall', 0, -27);
    svc('station', 'Exchange & Forge', -30, 20);
    svc('shipyard', 'Star Harbor Shipyard', padX - 40, 0);
  }
  const markerMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 2.6, 3), transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false });
  for (const s of services) {
    const local = group.worldToLocal ? null : null;
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 30, 16, 1, true), markerMat);
    const lp = s.pos.clone().sub(group.position).applyQuaternion(group.quaternion.clone().invert());
    beam.position.copy(lp).add(new THREE.Vector3(0, 14, 0));
    group.add(beam);
    void local;
  }

  const light = new THREE.PointLight(0xffb070, outpost ? 1 : 3, outpost ? 200 : 700, 1.4);
  light.position.set(0, 120, 0);
  group.add(light);

  let t = 0;
  return {
    group,
    colliders,
    services,
    padLocal: toLocal(padX, 2, 0),
    spawnLocal: toLocal(0, 2, -60),
    radius,
    update(dt) {
      t += dt;
      for (const s of signs) s.mat.opacity = s.flicker ? (Math.sin(t * 13 + s.phase) > -0.85 ? 1 : 0.2) : 0.85 + 0.15 * Math.sin(t * 2 + s.phase);
      for (const c of craft) {
        const u = c.userData;
        u.a += u.s * dt;
        const x = Math.cos(u.a) * u.rad, z = Math.sin(u.a) * u.rad;
        c.position.set(x, u.y + drop(x, z), z);
        c.lookAt(Math.cos(u.a + Math.sign(u.s) * 0.1) * u.rad, u.y + drop(x, z), Math.sin(u.a + Math.sign(u.s) * 0.1) * u.rad);
      }
    },
    dispose() {
      group.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material && o.material !== towerMat) o.material.dispose?.();
      });
      for (const s of signs) s.mat.map?.dispose();
      towerMat.dispose();
      void glowTexture;
    },
  };
}
