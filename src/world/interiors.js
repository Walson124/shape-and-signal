import * as THREE from 'three';
import { bevelBox } from './geometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { signTexture } from './textures.js';

// Venue kinds: what each walk-in building offers and how it looks inside.
export const VENUES = {
  exchange: { name: 'Star Exchange', cn: '兑换所', color: 0xffe44d, sign: '兑换所 EXCHANGE', desc: 'Sell star metal and essence. Buy pills and technique manuals.' },
  forge: { name: 'Armory', cn: '兵器铺', color: 0x3ef2ff, sign: '兵器铺 ARMORY', desc: 'Weapons for every discipline, the sword forge, and essence refining.' },
  pills: { name: 'Pill Pavilion', cn: '丹药阁', color: 0x5dffa8, sign: '丹药 PILLS', desc: 'Pills and elixirs at fair prices.' },
  clinic: { name: 'Gene Clinic', cn: '基因诊所', color: 0xff3c7d, sign: '基因 GENE LAB', desc: 'Permanent genetic enhancement of body and mind.' },
  chamber: { name: 'Cultivation Chamber', cn: '修炼室', color: 0xb98cff, sign: '修炼室 CHAMBER', desc: 'Rent a gravity chamber. Cultivation inside is far faster.' },
  bar: { name: 'Teahouse', cn: '茶馆', color: 0xffa040, sign: '茶馆 TEAHOUSE', desc: 'Odd jobs, gossip and rumours of treasure in the wilds.' },
  food: { name: 'Noodle Bar', cn: '面馆', color: 0xff6a4a, sign: '面馆 NOODLES', desc: 'Hot meals that keep you going in a fight.' },
  home: { name: 'Apartments', cn: '公寓', color: 0x7ad8ff, sign: '公寓 HOME', desc: 'Rent a room: a bed, a respawn point and a safe night’s sleep.' },
  hall: { name: 'Martial Hall', cn: '武馆', color: 0xffe44d, sign: '武馆', desc: 'Bounties, trials and skill resets.' },
  dealer: { name: 'Vehicle Dealer', cn: '车行', color: 0xff8a4a, sign: '车行 VEHICLES', desc: 'Hoverbikes, rovers and racers.' },
  arena: { name: 'Arena', cn: '竞技场', color: 0xff3c7d, sign: '竞技场 ARENA', desc: 'Fight waves of beasts for prize money.' },
  lobby: { name: 'Residential Block', cn: '住宅', color: 0x8fb8ff, sign: null, desc: '' },
};
// Order functional venues are handed out, closest to the plaza first.
export const VENUE_ORDER = ['exchange', 'forge', 'pills', 'chamber', 'bar', 'clinic', 'home', 'food', 'dealer'];

let shared = null;
function mats() {
  if (shared) return shared;
  const tile = document.createElement('canvas');
  tile.width = tile.height = 128;
  const c = tile.getContext('2d');
  c.fillStyle = '#20242c';
  c.fillRect(0, 0, 128, 128);
  c.strokeStyle = '#2e343e';
  c.lineWidth = 2;
  for (let i = 0; i <= 128; i += 32) {
    c.beginPath(); c.moveTo(i, 0); c.lineTo(i, 128); c.stroke();
    c.beginPath(); c.moveTo(0, i); c.lineTo(128, i); c.stroke();
  }
  const floorTex = new THREE.CanvasTexture(tile);
  floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping;
  floorTex.colorSpace = THREE.SRGBColorSpace;
  shared = {
    floor: new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.35, metalness: 0.4 }),
    wall: new THREE.MeshStandardMaterial({ color: 0x3a404c, roughness: 0.6, metalness: 0.3 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x15181e, roughness: 0.5, metalness: 0.6 }),
    wood: new THREE.MeshStandardMaterial({ color: 0x5a3a26, roughness: 0.7 }),
    metal: new THREE.MeshStandardMaterial({ color: 0x8a94a4, roughness: 0.3, metalness: 0.9 }),
    cloth: new THREE.MeshStandardMaterial({ color: 0x6a2a3a, roughness: 0.9 }),
    sand: new THREE.MeshStandardMaterial({ color: 0xb09a70, roughness: 1 }),
    skin: new THREE.MeshStandardMaterial({ color: 0xe0b896, roughness: 0.7 }),
    glow: new Map(),
  };
  return shared;
}
function glowMat(hex, mul = 2.4) {
  const m = mats();
  const k = `${hex}:${mul}`;
  if (!m.glow.has(k)) m.glow.set(k, new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(mul) }));
  return m.glow.get(k);
}

// ---------------------------------------------------------------- people --
const NPC_GEO = (() => {
  const parts = [
    new THREE.CapsuleGeometry(0.26, 0.6, 4, 8).translate(0, 1.15, 0),
    new THREE.SphereGeometry(0.17, 10, 8).translate(0, 1.72, 0),
    new THREE.CapsuleGeometry(0.09, 0.62, 3, 6).translate(-0.12, 0.42, 0),
    new THREE.CapsuleGeometry(0.09, 0.62, 3, 6).translate(0.12, 0.42, 0),
  ];
  const g = mergeGeometries(parts.map((p) => p.toNonIndexed()));
  // Preserve the capsule/sphere normals through batching.
  return g;
})();
export const npcGeometry = () => NPC_GEO;

export function buildNPC(color, accent) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(NPC_GEO, new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.2 }));
  g.add(body);
  const visor = new THREE.Mesh(bevelBox(0.28, 0.05, 0.05), glowMat(accent, 2.6));
  visor.position.set(0, 1.74, 0.15);
  g.add(visor);
  const arms = [-1, 1].map((s) => {
    const a = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.5, 3, 6).translate(0, -0.3, 0), body.material);
    a.position.set(s * 0.33, 1.42, 0);
    g.add(a);
    return a;
  });
  const phase = Math.random() * 10;
  return {
    group: g,
    anim(t) {
      body.rotation.y = Math.sin(t * 0.5 + phase) * 0.15;
      arms[0].rotation.x = Math.sin(t * 1.3 + phase) * 0.25;
      arms[1].rotation.x = -Math.sin(t * 1.1 + phase) * 0.2;
    },
    dispose() {
      body.material.dispose();
      visor.geometry.dispose();
      arms.forEach((a) => a.geometry.dispose());
    },
  };
}

// --------------------------------------------------------------- layout --
// Furniture that blocks movement, computed at layout time (cheap) so walls
// and counters collide even before the interior meshes exist.
// All coordinates are in the building's own frame: x across, z into the room
// (door at z = -d/2), y up from the floor.
export function interiorLayout(kind, w, d) {
  const boxes = [];
  const counter = { x: 0, z: d / 2 - 3.2, w: Math.min(w - 4, 7), d: 1.1, h: 1.1 };
  if (kind !== 'lobby' && kind !== 'chamber') boxes.push(counter);
  if (kind === 'bar' || kind === 'food') {
    for (const [x, z] of [[-w / 4, -d / 6], [w / 4, -d / 6], [-w / 4, d / 10], [w / 4, d / 10]]) boxes.push({ x, z, w: 1.4, d: 1.4, h: 0.85 });
  }
  if (kind === 'exchange' || kind === 'pills' || kind === 'forge') {
    for (const s of [-1, 1]) boxes.push({ x: s * (w / 2 - 1.2), z: 0, w: 1, d: d * 0.5, h: 2.6 });
  }
  if (kind === 'clinic') for (const s of [-1, 1]) boxes.push({ x: s * (w / 2 - 2), z: -d / 8, w: 1.6, d: 2.6, h: 1.0 });
  const npcAt = kind === 'chamber' || kind === 'lobby' ? { x: w / 2 - 2.5, z: d / 2 - 2.5 } : { x: 0, z: counter.z + 1.1 };
  const service = kind === 'lobby' ? null : { x: npcAt.x, z: kind === 'chamber' ? npcAt.z - 1.5 : counter.z - 1.6 };
  return { boxes, counter, npcAt, service };
}

// ----------------------------------------------------------- interiors --
// Builds the visible contents of a venue. Returns { group, update, dispose }.
export function buildInterior(kind, w, d, H, seed, label) {
  const m = mats();
  const v = VENUES[kind] || VENUES.lobby;
  const g = new THREE.Group();
  const own = [];
  const add = (geo, mat, x, y, z, ry = 0) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.rotation.y = ry;
    g.add(mesh);
    own.push(geo);
    return mesh;
  };
  const lay = interiorLayout(kind, w, d);
  // floor, inner walls and ceiling panels
  const floorGeo = new THREE.PlaneGeometry(w - 1.2, d - 1.2).rotateX(-Math.PI / 2);
  floorGeo.attributes.uv.array.forEach((_, i, a) => { a[i] *= i % 2 ? d / 4 : w / 4; });
  add(floorGeo, m.floor, 0, 0.06, 0);
  for (let i = -1; i <= 1; i++) add(bevelBox(w * 0.7, 0.08, 0.5), glowMat(0xfff4e0, 1.1), 0, H - 0.35, i * d * 0.25);
  // trim lights along the walls
  for (const s of [-1, 1]) {
    add(bevelBox(0.06, 0.06, d - 1.6), glowMat(v.color, 2), s * (w / 2 - 0.68), 0.25, 0);
    add(bevelBox(0.06, 0.06, d - 1.6), glowMat(v.color, 1.6), s * (w / 2 - 0.68), H - 0.8, 0);
  }
  // counter + holo screen
  const c = lay.counter;
  if (kind !== 'lobby' && kind !== 'chamber') {
    add(bevelBox(c.w, c.h, c.d), m.dark, c.x, c.h / 2, c.z);
    add(bevelBox(c.w, 0.05, c.d + 0.1), glowMat(v.color, 1.8), c.x, c.h + 0.03, c.z);
    const scr = add(new THREE.PlaneGeometry(1.6, 0.9), new THREE.MeshBasicMaterial({ color: new THREE.Color(v.color).multiplyScalar(1.4), transparent: true, opacity: 0.55, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }), c.x - c.w * 0.25, c.h + 0.8, c.z + 0.1, Math.PI);
    own.push(scr.material);
  }
  // back wall sign
  if (v.sign) {
    const tex = signTexture(v.sign, `#${v.color.toString(16).padStart(6, '0')}`);
    const smat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, color: new THREE.Color(1.5, 1.5, 1.5) });
    add(new THREE.PlaneGeometry(Math.min(w - 3, 9), Math.min(w - 3, 9) * 0.16), smat, 0, H - 1.9, d / 2 - 0.7, Math.PI);
    own.push(smat, tex);
  }
  const r = mulberryLite(seed);
  // kind-specific furniture
  if (kind === 'exchange' || kind === 'pills' || kind === 'forge') {
    const itemCol = kind === 'pills' ? 0x5dffa8 : kind === 'forge' ? 0x3ef2ff : 0xffe44d;
    for (const s of [-1, 1]) {
      const x = s * (w / 2 - 1.2);
      add(bevelBox(1, 2.6, d * 0.5), m.metal, x, 1.3, 0);
      for (let k = 0; k < 4; k++) for (let j = 0; j < 3; j++) {
        const item = kind === 'forge' ? bevelBox(0.06, 0.06, 0.9) : new THREE.SphereGeometry(0.12, 8, 6);
        add(item, glowMat(itemCol, 1.4 + r() * 1.2), x - s * 0.55, 0.6 + j * 0.7, -d * 0.2 + k * (d * 0.13));
      }
    }
    if (kind === 'forge') {
      add(new THREE.CylinderGeometry(1.1, 1.3, 1.2, 12), m.dark, -w / 4, 0.6, d / 2 - 6);
      add(new THREE.CylinderGeometry(0.9, 0.9, 0.1, 12), glowMat(0xff7a2a, 3), -w / 4, 1.22, d / 2 - 6);
    }
  } else if (kind === 'bar' || kind === 'food') {
    for (const b of lay.boxes.slice(1)) {
      add(new THREE.CylinderGeometry(0.75, 0.75, 0.08, 14), m.wood, b.x, 0.85, b.z);
      add(new THREE.CylinderGeometry(0.1, 0.25, 0.85, 8), m.dark, b.x, 0.42, b.z);
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2;
        add(new THREE.CylinderGeometry(0.28, 0.28, 0.5, 10), m.cloth, b.x + Math.cos(a) * 1.25, 0.25, b.z + Math.sin(a) * 1.25);
      }
      add(new THREE.SphereGeometry(0.1, 8, 6), glowMat(kind === 'food' ? 0xff6a4a : 0xffa040, 3), b.x, 0.98, b.z);
    }
    // hanging lanterns
    for (let k = 0; k < 4; k++) add(new THREE.SphereGeometry(0.35, 10, 8), glowMat(0xff4a3a, 2), -w / 3 + k * (w / 4.5), H - 1.6, 0);
  } else if (kind === 'clinic') {
    for (const s of [-1, 1]) {
      add(bevelBox(1.6, 1.0, 2.6), m.metal, s * (w / 2 - 2), 0.5, -d / 8);
      add(new THREE.CapsuleGeometry(0.75, 1.2, 4, 10).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff3c7d).multiplyScalar(0.8), transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false }), s * (w / 2 - 2), 1.4, -d / 8);
    }
    add(new THREE.TorusGeometry(1.2, 0.05, 6, 32), glowMat(0xff3c7d, 2.4), 0, 2.4, 0).rotation.x = Math.PI / 2;
  } else if (kind === 'chamber') {
    add(new THREE.CylinderGeometry(2.2, 2.2, 0.15, 24), m.dark, 0, 0.08, 0);
    add(new THREE.RingGeometry(1.6, 2.1, 32).rotateX(-Math.PI / 2), glowMat(0xb98cff, 2.4), 0, 0.17, 0);
    add(new THREE.CylinderGeometry(0.25, 0.25, H, 10, 1, true), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xb98cff).multiplyScalar(1.6), transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }), 0, H / 2, 0);
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      add(bevelBox(0.9, 0.08, 0.9), m.cloth, Math.cos(a) * (w / 3), 0.1, Math.sin(a) * (d / 3));
    }
  } else if (kind === 'home') {
    add(bevelBox(2.2, 0.5, 3.2), m.cloth, -w / 2 + 2.2, 0.25, d / 4);
    add(bevelBox(2.2, 0.2, 0.8), m.metal, -w / 2 + 2.2, 0.6, d / 4 + 1.2);
    add(bevelBox(1.6, 0.8, 0.8), m.wood, w / 2 - 2, 0.4, d / 4);
  } else if (kind === 'lobby') {
    add(bevelBox(0.7, 2.2, 0.7), m.metal, w / 2 - 1.5, 1.1, d / 2 - 1.5);
    for (let k = 0; k < 2; k++) add(bevelBox(1.8, 2.6, 0.1), glowMat(0x8fb8ff, 0.9), -w / 4 + k * (w / 2), 1.3, d / 2 - 0.65);
    add(bevelBox(2.6, 0.45, 0.9), m.cloth, 0, 0.23, 0);
  }
  // plants
  for (let k = 0; k < 2; k++) {
    const x = (k ? 1 : -1) * (w / 2 - 1.4), z = -d / 2 + 1.6;
    add(new THREE.CylinderGeometry(0.3, 0.25, 0.6, 8), m.dark, x, 0.3, z);
    add(new THREE.IcosahedronGeometry(0.55, 0), new THREE.MeshStandardMaterial({ color: 0x3a8a4a, flatShading: true }), x, 1.0, z);
  }
  // people
  const people = [];
  const keeperCol = [0x2a3040, 0x40283a, 0x283a40][Math.floor(r() * 3)];
  if (kind !== 'lobby') {
    const keeper = buildNPC(keeperCol, v.color);
    keeper.group.position.set(lay.npcAt.x, 0, lay.npcAt.z);
    keeper.group.rotation.y = Math.PI;
    g.add(keeper.group);
    people.push(keeper);
  }
  const patrons = kind === 'bar' || kind === 'food' ? 4 : kind === 'chamber' ? 2 : kind === 'lobby' ? 1 : 1;
  for (let k = 0; k < patrons; k++) {
    const p = buildNPC([0x3a4a5a, 0x5a3a3a, 0x3a5a4a, 0x4a4a5a][k % 4], [0x3ef2ff, 0xff3c7d, 0xffe44d][k % 3]);
    p.group.position.set((r() - 0.5) * (w - 4), 0, (r() - 0.5) * (d - 6));
    p.group.rotation.y = r() * Math.PI * 2;
    if (kind === 'chamber') p.group.scale.y = 0.6;
    g.add(p.group);
    people.push(p);
  }
  void label;
  let t = 0;
  return {
    group: g,
    update(dt) {
      t += dt;
      for (const p of people) p.anim(t);
    },
    dispose() {
      for (const p of people) p.dispose();
      const keep = new Set([...Object.values(m).filter((x) => x && x.isMaterial), ...m.glow.values()]);
      g.traverse((o) => {
        if (o.material && !keep.has(o.material)) o.material.dispose();
      });
      for (const o of own) o.dispose && o.dispose();
    },
  };
}

function mulberryLite(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
