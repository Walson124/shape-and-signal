import * as THREE from 'three';
import { bevelBox } from './geometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { signTexture, glowTexture } from './textures.js';
import { VENUES, interiorLayout, buildInterior, buildNPC } from './interiors.js';

// An orbital station you can land on: a gravity deck with shop booths around
// a central spire and landing pads for ships. Everything is in the station's
// own frame: the deck top is the plane y = 0 and +y is "up" on the deck.
export const DECK_R = 72;
const BOOTHS = [['exchange', 0], ['forge', Math.PI / 2], ['bar', Math.PI], ['hall', -Math.PI / 2]];

export function buildDockStation(name, accentHex = 0x3ef2ff) {
  const g = new THREE.Group();
  const accent = new THREE.Color(accentHex);
  const hull = new THREE.MeshStandardMaterial({ color: 0x5a6270, metalness: 0.75, roughness: 0.4 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1c2028, metalness: 0.7, roughness: 0.45 });
  const deckMat = new THREE.MeshStandardMaterial({ color: 0x2a3038, metalness: 0.5, roughness: 0.6 });
  const neonMat = new THREE.MeshBasicMaterial({ color: accent.clone().multiplyScalar(2.4) });
  const ylMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffe44d).multiplyScalar(2.2) });
  const parts = { hull: [], dark: [], neon: [], yl: [] };
  const put = (list, geo, x, y, z, ry = 0) => {
    geo.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry), new THREE.Vector3(1, 1, 1)));
    list.push(geo.index ? geo.toNonIndexed() : geo);
  };
  const boxes = [];
  const addBox = (x0, x1, y0, y1, z0, z1) => boxes.push({ x0: Math.min(x0, x1), x1: Math.max(x0, x1), y0, y1, z0: Math.min(z0, z1), z1: Math.max(z0, z1) });

  // deck and underside
  const deck = new THREE.Mesh(new THREE.CylinderGeometry(DECK_R, DECK_R, 3, 64), deckMat);
  deck.position.y = -1.5;
  g.add(deck);
  put(parts.dark, new THREE.CylinderGeometry(DECK_R - 2, 18, 40, 32, 1, true), 0, -23, 0);
  put(parts.hull, new THREE.CylinderGeometry(18, 6, 60, 16), 0, -73, 0);
  put(parts.neon, new THREE.TorusGeometry(DECK_R + 0.5, 0.6, 6, 96).rotateX(Math.PI / 2), 0, -0.2, 0);
  put(parts.neon, new THREE.TorusGeometry(DECK_R - 14, 0.25, 4, 96).rotateX(Math.PI / 2), 0, 0.03, 0);
  // rails
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    put(parts.dark, new THREE.CylinderGeometry(0.15, 0.15, 1.2, 5), Math.cos(a) * (DECK_R - 1), 0.6, Math.sin(a) * (DECK_R - 1));
  }
  put(parts.yl, new THREE.TorusGeometry(DECK_R - 1, 0.08, 4, 96).rotateX(Math.PI / 2), 0, 1.2, 0);
  // central spire
  put(parts.hull, new THREE.CylinderGeometry(5, 7, 60, 12), 0, 30, 0);
  put(parts.neon, new THREE.TorusGeometry(7.2, 0.3, 6, 24).rotateX(Math.PI / 2), 0, 8, 0);
  put(parts.neon, new THREE.TorusGeometry(5.6, 0.3, 6, 24).rotateX(Math.PI / 2), 0, 40, 0);
  put(parts.dark, new THREE.CylinderGeometry(0.4, 0.4, 30, 6), 0, 75, 0);
  addBox(-6.5, 6.5, 0, 60, -6.5, 6.5);
  // habitat rings above
  const ring = new THREE.Mesh(new THREE.TorusGeometry(46, 3, 10, 64), hull);
  ring.position.y = 55;
  ring.rotation.x = Math.PI / 2;
  g.add(ring);
  for (let k = 0; k < 4; k++) put(parts.dark, bevelBox(46, 1.2, 1.2).translate(23, 0, 0), 0, 55, 0, (k / 4) * Math.PI * 2);

  // landing pads
  const pads = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const x = Math.cos(a) * 52, z = Math.sin(a) * 52;
    put(parts.dark, new THREE.CylinderGeometry(13, 13, 0.3, 32), x, 0.15, z);
    put(parts.yl, new THREE.TorusGeometry(12, 0.25, 4, 40).rotateX(Math.PI / 2), x, 0.32, z);
    put(parts.neon, new THREE.TorusGeometry(5, 0.2, 4, 32).rotateX(Math.PI / 2), x, 0.32, z);
    pads.push(new THREE.Vector3(x, 0.3, z));
  }

  // shop booths facing the spire
  const services = [];
  const interiors = [];
  const W = 13, D = 9, H = 5.2, T = 0.4;
  for (const [kind, a] of BOOTHS) {
    const v = VENUES[kind];
    const bx = Math.cos(a) * 34, bz = Math.sin(a) * 34;
    // booth frame: local -z opens toward the centre
    const ry = Math.atan2(bx, bz);
    const toW = (lx, lz) => {
      const c = Math.cos(ry), s = Math.sin(ry);
      return [bx + lx * c + lz * s, bz - lx * s + lz * c];
    };
    const wall = (lx, lz, w, d, y0, y1) => {
      const [cx, cz] = toW(lx, lz);
      put(parts.hull, bevelBox(w, y1 - y0, d), cx, (y0 + y1) / 2, cz, ry);
      const along = Math.abs(Math.sin(ry)) > 0.7;
      const ex = along ? d / 2 : w / 2, ez = along ? w / 2 : d / 2;
      addBox(cx - ex, cx + ex, y0, y1, cz - ez, cz + ez);
    };
    wall(0, D / 2 - T / 2, W, T, 0, H);
    wall(-W / 2 + T / 2, 0, T, D, 0, H);
    wall(W / 2 - T / 2, 0, T, D, 0, H);
    wall(0, 0, W + 0.6, D + 0.6, H, H + 0.6);
    const [fx, fz] = toW(0, -D / 2);
    put(parts.neon, bevelBox(W, 0.2, 0.2), fx, H + 0.7, fz, ry);
    const inter = buildInterior(kind, W, D, H, kind.length * 1013, v.name);
    inter.group.position.set(bx, 0, bz);
    inter.group.rotation.y = ry;
    g.add(inter.group);
    interiors.push(inter);
    const tex = signTexture(v.sign || v.name, `#${v.color.toString(16).padStart(6, '0')}`);
    const smat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, color: new THREE.Color(1.8, 1.8, 1.8) });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(10, 1.6), smat);
    const [sx, sz] = toW(0, -D / 2 - 0.2);
    sign.position.set(sx, H + 1.8, sz);
    sign.rotation.y = ry + Math.PI;
    g.add(sign);
    const lay = interiorLayout(kind, W, D);
    for (const b of lay.boxes) {
      const [cx, cz] = toW(b.x, b.z);
      const along = Math.abs(Math.sin(ry)) > 0.7;
      const ex = along ? b.d / 2 : b.w / 2, ez = along ? b.w / 2 : b.d / 2;
      addBox(cx - ex, cx + ex, 0, b.h, cz - ez, cz + ez);
    }
    const [svx, svz] = toW(lay.service.x, lay.service.z);
    services.push({ kind, name: `${name} ${v.name}`, local: new THREE.Vector3(svx, 1.6, svz), range: 4.5 });
  }
  // a shipyard registrar by the pads
  const reg = buildNPC(0x2a3040, 0xffe44d);
  reg.group.position.set(0, 0, 18);
  g.add(reg.group);
  put(parts.dark, bevelBox(3, 1.1, 1.1), 0, 0.55, 16.5);
  addBox(-1.5, 1.5, 0, 1.1, 15.9, 17.1);
  services.push({ kind: 'shipyard', name: `${name} Shipyard`, local: new THREE.Vector3(0, 1.6, 14.8), range: 4.5 });

  for (const [k, mat] of [['hull', hull], ['dark', dark], ['neon', neonMat], ['yl', ylMat]]) {
    const list = parts[k];
    if (!list.length) continue;
    const merged = mergeGeometries(list.map((x) => { if (k === 'neon' || k === 'yl') { x.deleteAttribute('uv'); x.deleteAttribute('normal'); } else if (x.attributes.uv) x.deleteAttribute('uv'); return x; }));
    g.add(new THREE.Mesh(merged, mat));
  }
  const beacon = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: accent.clone().multiplyScalar(2), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  beacon.position.y = 92;
  beacon.scale.setScalar(40);
  g.add(beacon);
  const nameTex = signTexture(name.toUpperCase(), `#${accent.getHexString()}`);
  const nameMat = new THREE.MeshBasicMaterial({ map: nameTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, color: new THREE.Color(2, 2, 2) });
  const nameSign = new THREE.Mesh(new THREE.PlaneGeometry(40, 6.4), nameMat);
  nameSign.position.set(0, 66, 0);
  g.add(nameSign);
  g.scale.setScalar(1);

  let t = 0;
  const pc = new THREE.Vector3();
  return {
    group: g,
    services,
    pads,
    boxes,
    deckR: DECK_R,
    // True when a station-local point is in the deck's gravity volume.
    onDeck(p) {
      return Math.hypot(p.x, p.z) < DECK_R && p.y > -2 && p.y < 26;
    },
    // Resolve a station-local point against booth walls and furniture.
    // Returns the height of a surface the feet rest on, if any.
    collide(p, rad, eye = 0) {
      let roof = null;
      for (const b of boxes) {
        const feet = p.y - eye;
        if (feet > b.y1 + 0.5 || p.y < b.y0 - 0.3) continue;
        if (p.x < b.x0 - rad || p.x > b.x1 + rad || p.z < b.z0 - rad || p.z > b.z1 + rad) continue;
        if (feet > b.y1 - 0.6) { roof = Math.max(roof ?? -1e9, b.y1); continue; }
        if (feet < b.y0 - 0.2 && b.y0 > 3) { p.y = Math.min(p.y, b.y0 - 0.25); continue; }
        const dx0 = p.x - (b.x0 - rad), dx1 = b.x1 + rad - p.x, dz0 = p.z - (b.z0 - rad), dz1 = b.z1 + rad - p.z;
        const m = Math.min(dx0, dx1, dz0, dz1);
        if (m === dx0) p.x -= dx0; else if (m === dx1) p.x += dx1; else if (m === dz0) p.z -= dz0; else p.z += dz1;
      }
      void pc;
      return roof;
    },
    update(dt) {
      t += dt;
      ring.rotation.z += dt * 0.05;
      reg.anim(t);
      for (const i of interiors) i.update(dt);
      beacon.material.opacity = 0.6 + 0.4 * Math.sin(t * 2);
    },
    dispose() {
      for (const i of interiors) i.dispose();
      g.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material && !o.isSprite) o.material.dispose?.();
      });
      nameTex.dispose();
    },
  };
}
