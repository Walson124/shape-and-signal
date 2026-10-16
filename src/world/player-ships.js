import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { bevelBox, taperedHull } from './geometry.js';
import { glowTexture, hullTextures } from './textures.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// The Blender-built ships (tools/blender/make_ships.py), loaded once. Each ship
// starts as the code-built model below and swaps to its modelled version when
// this arrives.
let modelled = null;
function loadShips() {
  if (typeof document === 'undefined') return Promise.resolve(null);
  if (!modelled) {
    const url = `${import.meta.env?.BASE_URL ?? './'}models/ships.glb`;
    modelled = new GLTFLoader().loadAsync(url).then((g) => g.scene).catch((e) => { console.warn('ship models failed to load', e); return null; });
  }
  return modelled;
}

const NAMES = ['Skyjet', 'Corvette', 'Frigate', 'Cruiser', 'Star Ark'];

// Five different silhouettes within the existing flight/collision envelope.
// Static parts are batched by material; only exhaust and landing gear move.
export function buildPlayerShip(tier, accentHex) {
  if (!Number.isInteger(tier) || tier < 0 || tier >= NAMES.length) throw new RangeError('Unknown ship tier');
  const group = new THREE.Group(), gear = new THREE.Group();
  group.name = NAMES[tier]; gear.name = 'Landing gear';
  const { map, rough } = hullTextures(), accent = new THREE.Color(accentHex);
  const materials = {
    hull: new THREE.MeshStandardMaterial({ map, roughnessMap: rough, color: 0xd8dde6, metalness: 0.45, roughness: 0.42, envMapIntensity: 1 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x29313b, metalness: 0.6, roughness: 0.42 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x142b3c, metalness: 0.8, roughness: 0.09, envMapIntensity: 1.8, emissive: accent.clone().multiplyScalar(0.12) }),
    neon: new THREE.MeshBasicMaterial({ color: accent.clone().multiplyScalar(2.6) }),
  };
  const parts = Object.fromEntries(Object.keys(materials).map(k => [k, []]));
  const put = (kind, geo, x = 0, y = 0, z = 0, rz = 0) => {
    geo.rotateZ(rz).translate(x, y, z);
    const flat = geo.index ? geo.toNonIndexed() : geo;
    if (flat !== geo) geo.dispose();
    parts[kind].push(flat);
  };
  const box = (kind, w, h, d, x = 0, y = 0, z = 0) => put(kind, bevelBox(w, h, d, Math.min(w, h, d) * 0.12, true), x, y, z);
  const shell = (w, h, d, x, y, z, nose = 0.6) => put('hull', taperedHull(w, h, d, nose), x, y, z);
  const plate = (points, depth = 0.3, y = 0, kind = 'hull') => {
    const shape = new THREE.Shape();
    points.forEach(([x, z], i) => i ? shape.lineTo(x, z) : shape.moveTo(x, z));
    shape.closePath();
    put(kind, new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSize: 0.07, bevelThickness: 0.07, bevelSegments: 1, curveSegments: 1 })
      .rotateX(Math.PI / 2), 0, y + depth / 2, 0);
  };
  const fins = (x, z, height) => {
    for (const side of [-1, 1]) {
      // Thin, swept vertical stabilisers rather than upright rectangular slabs.
      const shape = new THREE.Shape();
      shape.moveTo(-1.8, 0); shape.lineTo(1.4, 0); shape.lineTo(0.6, height); shape.lineTo(-0.3, height * 0.7); shape.closePath();
      const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.16, bevelEnabled: false }).rotateY(Math.PI / 2);
      put('hull', geo, side * x, 0.8, z, side * -0.12);
    }
  };
  const canopy = (w, h, d, x, y, z) => put('glass', new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(w, h, d), x, y, z);
  const engineLocations = [];
  const engine = (x, y, z, radius = 0.8, length = 3) => {
    put('dark', new THREE.CylinderGeometry(radius, radius * 1.15, length, 12).rotateX(Math.PI / 2), x, y, z);
    const exit = z + length / 2;
    put('neon', new THREE.TorusGeometry(radius * 0.85, radius * 0.12, 4, 16), x, y, exit + 0.02);
    put('dark', new THREE.CylinderGeometry(radius * 0.6, radius * 0.8, 0.3, 12).rotateX(Math.PI / 2), x, y, exit + 0.08);
    engineLocations.push({ x, y, z: exit + 0.45, radius });
  };

  if (tier === 0) {
    // Compact single-engine delta-wing shuttle.
    shell(2.8, 2, 17.5, 0, 0, -0.3, 0.4);
    plate([[0, -5.3], [8.5, 4.2], [7.4, 6.1], [0, 3.6], [-7.4, 6.1], [-8.5, 4.2]], 0.3, -0.4);
    canopy(0.85, 0.65, 2.4, 0, 0.8, -3.9);
    fins(0.5, 5.5, 1.8);
    engine(0, 0, 6.7, 0.95, 3.6);
    for (const side of [-1, 1]) box('neon', 0.1, 0.06, 2, side * 7.4, -0.14, 4.2);
  } else if (tier === 1) {
    // Compact escort: narrow fuselage, swept stub wings and close-set drives.
    shell(3.7, 2.1, 17.5, 0, 0, -0.5, 0.5);
    for (const side of [-1, 1]) {
      plate([[side * 1.2, -2], [side * 5.4, 3.4], [side * 4.7, 5.6], [side * 1.2, 4.3]], 0.32, -0.35);
      engine(side * 1.8, -0.1, 6.8, 0.8, 3.2);
      box('dark', 0.3, 0.18, 4.5, side * 1.4, 1, 1.2);
      box('neon', 0.08, 0.06, 2.5, side * 4.35, -0.12, 3.8);
    }
    canopy(1, 0.6, 1.85, 0, 0.9, -3.4);
    fins(1.4, 4.8, 1.3);
  } else if (tier === 2) {
    // Substantial patrol frigate: full bow, raised bridge and equipment bays.
    shell(6.6, 3.1, 22.4, 0, 0, -0.2, 0.55);
    shell(5.1, 1.6, 10.5, 0, 1.7, 0.3, 0.65);
    box('glass', 3.8, 0.5, 0.4, 0, 2.2, -4.2);
    for (const side of [-1, 1]) {
      shell(2, 2, 11, side * 3.8, -0.1, 2, 0.8);
      plate([[side * 2.5, -1], [side * 6.3, 3.5], [side * 5.6, 7.8], [side * 2.5, 6]], 0.55, -0.4);
      engine(side * 4.2, -0.1, 7, 1.15, 4.8);
      for (let i = 0; i < 4; i++) box('dark', 1.9, 0.14, 0.65, side * 3.8, 1, -1.5 + i * 1.65);
      box('neon', 0.08, 0.08, 5.5, side * 4.8, 0.95, 1.5);
    }
    fins(2.5, 5.2, 2);
  } else if (tier === 3) {
    // Wide wedge battleship with layered armor and four exhausts.
    plate([[-0.8, -11], [0.8, -11], [8.5, -3], [10, 5], [6.8, 8.5], [-6.8, 8.5], [-10, 5], [-8.5, -3]], 1.9);
    shell(9.3, 2.2, 14, 0, 1.5, 0.2, 0.4);
    shell(5.3, 1.5, 8, 0, 2.6, 1, 0.65);
    box('glass', 4.6, 0.5, 0.5, 0, 3, -2.5);
    for (const side of [-1, 1]) {
      for (let i = 0; i < 3; i++) box('dark', 1.5, 0.35, 3.5, side * (5.4 + i * 1.2), 1, 2 + i * 0.4);
      box('neon', 0.1, 0.1, 6.4, side * 7.8, 1.05, 2);
    }
    for (const x of [-5.7, -1.9, 1.9, 5.7]) engine(x, -0.2, 7.7, 0.85, 3.2);
  } else {
    // Twin habitat hulls joined by a central spine and an exposed drive hoop.
    shell(4.6, 3, 23.5, 0, 0, -0.15, 0.55);
    for (const side of [-1, 1]) {
      shell(4.1, 3.5, 16.8, side * 5, 0, 0.6, 0.8);
      box('hull', 13.4, 0.7, 2, 0, -0.9, side > 0 ? 4.5 : -3.8);
      for (let i = 0; i < 4; i++) {
        box('dark', 4.25, 0.18, 0.3, side * 5, 1.6, -3.5 + i * 2.8);
        box('glass', 2.7, 0.12, 0.5, side * 5, 1.78, -3 + i * 2.8);
      }
      box('neon', 0.08, 0.08, 12, side * 7.1, 1.25, 0.5);
    }
    put('dark', new THREE.TorusGeometry(3.25, 0.35, 6, 32), 0, 1.4, 2);
    put('neon', new THREE.TorusGeometry(3.25, 0.07, 4, 32), 0, 1.4, 2.38);
    shell(3.8, 1.3, 6, 0, 1.8, -4, 0.65);
    box('glass', 3.4, 0.45, 0.3, 0, 2.1, -6.8);
    for (const x of [-6, -3.4, -1.1, 1.1, 3.4, 6]) engine(x, -0.3, 7.5, 0.75, 4);
  }

  for (const [kind, list] of Object.entries(parts)) {
    if (!list.length) continue;
    const geometry = mergeGeometries(list);
    list.forEach(g => g.dispose());
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, materials[kind]);
    mesh.name = kind; group.add(mesh);
  }
  const gearParts = [];
  const spread = tier >= 3 ? 4.8 : tier === 1 ? 2.5 : 1.9;
  const frontSpread = tier === 0 || tier === 2 ? 0.9 : tier === 1 ? 1.05 : spread;
  for (const [x, z] of [[-frontSpread, -4.8], [frontSpread, -4.8], [-spread, 5], [spread, 5]]) {
    gearParts.push(new THREE.CylinderGeometry(0.15, 0.18, 2.6, 6).translate(x, -2.3, z).toNonIndexed());
    gearParts.push(new THREE.CylinderGeometry(0.5, 0.6, 0.25, 8).translate(x, -3.6, z).toNonIndexed());
  }
  const gearGeo = mergeGeometries(gearParts); gearParts.forEach(g => g.dispose());
  gear.add(new THREE.Mesh(gearGeo, materials.dark)); group.add(gear);
  const exhaustMat = new THREE.SpriteMaterial({ map: glowTexture(), color: accent.clone().multiplyScalar(1.6),
    blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
  const flames = engineLocations.map(({ x, y, z, radius }) => {
    const sprite = new THREE.Sprite(exhaustMat);
    sprite.position.set(x, y, z); sprite.userData.radius = radius;
    group.add(sprite); return sprite;
  });
  group.scale.setScalar(1 + tier * 0.18);
  group.userData.shipDesign = { name: NAMES[tier], engines: flames.length };
  let lastThrust = 0;
  const result = {
    group, gear,
    setThrust(value) {
      const v = THREE.MathUtils.clamp(value, 0, 1);
      lastThrust = v;
      for (const f of flames) f.scale.setScalar((2.2 + v * 5.5) * f.userData.radius);
      exhaustMat.opacity = 0.4 + v * 0.6;
    },
    dispose() {
      // Sprite quads are shared internally by Three.js, outside this model.
      group.traverse(o => { if (o.isMesh) o.geometry.dispose(); });
      Object.values(materials).forEach(m => m.dispose());
      exhaustMat.dispose();
    },
  };
  result.setThrust(0);
  let disposed = false;
  const dispose = result.dispose;
  result.dispose = () => { disposed = true; dispose(); };
  // swap in the modelled ship: same materials (panelled hull, accent trim), same engines and gear
  loadShips().then((scene) => {
    const src = scene && !disposed && scene.getObjectByName(`ship${tier}`);
    if (!src) return;
    const own = group.children.filter((o) => o.isMesh);
    const oldGear = [...gear.children];
    const hull = materials.hull.clone();
    hull.map = materials.hull.map.clone(); hull.map.repeat.set(5, 5); hull.map.wrapS = hull.map.wrapT = THREE.RepeatWrapping; hull.map.needsUpdate = true;
    hull.roughnessMap = materials.hull.roughnessMap.clone(); hull.roughnessMap.repeat.set(5, 5); hull.roughnessMap.wrapS = hull.roughnessMap.wrapT = THREE.RepeatWrapping; hull.roughnessMap.needsUpdate = true;
    const mats = { hull, dark: materials.dark, glass: materials.glass, neon: materials.neon };
    const copy = src.clone(true);
    copy.traverse((o) => {
      if (!o.isMesh) return;
      const kind = o.material.name;
      if (mats[kind]) o.material = mats[kind];
      else o.material = o.material.clone();
    });
    const gearSrc = copy.getObjectByName(`ship${tier}_gear`);
    if (gearSrc) { gearSrc.removeFromParent(); for (const m of oldGear) m.visible = false; gear.add(gearSrc); }
    const engines = [];
    const num = (o) => Number(/_engine_(d+)$/.exec(o.name)?.[1] ?? -1);
    copy.traverse((o) => { if (num(o) >= 0) engines.push(o); });
    engines.sort((a, b) => num(a) - num(b));
    engines.forEach((e, i) => { if (flames[i]) { flames[i].position.copy(e.position); flames[i].userData.radius = e.userData.radius ?? flames[i].userData.radius; } });
    for (const m of own) m.visible = false;
    copy.position.set(0, 0, 0);
    group.add(copy);
    result.setThrust(lastThrust);
    const disposeCopy = result.dispose;
    result.dispose = () => { disposeCopy(); hull.map.dispose(); hull.roughnessMap.dispose(); hull.dispose(); };
  });
  return result;
}
