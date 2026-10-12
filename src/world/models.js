import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { NOISE_GLSL } from '../core/glsl.js';
import { glowTexture, hullTextures, windowTexture, signTexture } from './textures.js';

// MeshStandardMaterial with a fresnel rim glow injected into the emissive term.
export function rimMaterial({ rim = 0xffffff, rimPower = 2.5, rimStrength = 1, ...opts } = {}) {
  const m = new THREE.MeshStandardMaterial(opts);
  const u = {
    rimColor: { value: new THREE.Color(rim) },
    rimPower: { value: rimPower },
    rimStrength: { value: rimStrength },
  };
  m.userData.rim = u;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.fragmentShader = `uniform vec3 rimColor;\nuniform float rimPower;\nuniform float rimStrength;\n${shader.fragmentShader}`.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
      float rimF = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), rimPower);
      totalEmissiveRadiance += rimColor * rimF * rimStrength;`,
    );
  };
  m.customProgramCacheKey = () => 'rim-v1';
  return m;
}

function bladeGeometry(profile) {
  const pos = [];
  const ring = (z, w, t) => [[w, 0, z], [0, t, z], [-w, 0, z], [0, -t, z]];
  for (let s = 0; s < profile.length - 1; s++) {
    const a = ring(...profile[s]);
    const b = ring(...profile[s + 1]);
    for (let k = 0; k < 4; k++) {
      const k2 = (k + 1) % 4;
      pos.push(...a[k], ...b[k], ...b[k2], ...a[k], ...b[k2], ...a[k2]);
    }
  }
  // cap at the guard
  const a = ring(...profile[0]);
  pos.push(...a[0], ...a[2], ...a[1], ...a[0], ...a[3], ...a[2]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

// A spirit sword pointing down +Z. Returns { group, glowMat, bladeMat }.
export function buildSword(grade) {
  const g = new THREE.Group();
  const bladeMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(grade.blade).multiplyScalar(0.55), metalness: 0.95, roughness: 0.3, flatShading: true, envMapIntensity: 0.8 });
  const blade = new THREE.Mesh(bladeGeometry([[0, 0.12, 0.034], [0.35, 0.125, 0.036], [1.25, 0.11, 0.032], [1.75, 0.075, 0.024], [2.15, 0, 0]]), bladeMat);
  g.add(blade);
  const glowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(grade.glow).multiplyScalar(1.8) });
  const fuller = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.078, 1.35), glowMat);
  fuller.position.z = 0.82;
  g.add(fuller);
  for (const s of [-1, 1]) {
    const edge = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.012, 1.7).translate(0, 0, 0.85), glowMat);
    edge.position.x = s * 0.118;
    edge.rotation.y = s * -0.028;
    g.add(edge);
  }
  const guardMat = new THREE.MeshStandardMaterial({ color: 0x2a2f3c, metalness: 0.9, roughness: 0.3 });
  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.07, 0.09), guardMat);
  g.add(guard);
  for (const s of [-1, 1]) {
    const wing = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.18, 4).rotateZ(s * Math.PI / 2), guardMat);
    wing.position.set(s * 0.3, 0, 0.02);
    g.add(wing);
  }
  const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.05), glowMat);
  gem.position.z = 0.01;
  gem.position.y = 0.04;
  g.add(gem);
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.042, 0.44, 8).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x14161c, roughness: 0.8 }));
  grip.position.z = -0.25;
  g.add(grip);
  const pommel = new THREE.Mesh(new THREE.OctahedronGeometry(0.075), glowMat);
  pommel.position.z = -0.5;
  g.add(pommel);
  return { group: g, glowMat, bladeMat };
}

// --------------------------------------------------------------- station --
export function buildStation(name, accentHex = 0x3ef2ff) {
  const root = new THREE.Group();
  const { map, rough } = hullTextures();
  const hull = new THREE.MeshStandardMaterial({ map, roughnessMap: rough, color: 0xb8c0cc, metalness: 0.75, roughness: 0.55, envMapIntensity: 1.1 });
  const dark = new THREE.MeshStandardMaterial({ map, color: 0x3a404c, metalness: 0.8, roughness: 0.5 });
  const accent = new THREE.Color(accentHex);
  const neon = new THREE.MeshBasicMaterial({ color: accent.clone().multiplyScalar(2.6) });
  const warm = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 1.6, 0.6) });

  const hullParts = [];
  const darkParts = [];
  const neonParts = [];
  const add = (list, geo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1));
    list.push(geo.applyMatrix4(m));
  };
  // spine
  add(hullParts, new THREE.CylinderGeometry(9, 9, 150, 24, 1));
  for (let i = -3; i <= 3; i++) {
    add(darkParts, new THREE.CylinderGeometry(11.5, 11.5, 5, 24), 0, i * 20, 0);
    add(neonParts, new THREE.TorusGeometry(11.8, 0.35, 6, 32), 0, i * 20 + 2.6, 0, Math.PI / 2);
  }
  add(hullParts, new THREE.SphereGeometry(14, 24, 16), 0, 78, 0);
  add(darkParts, new THREE.CylinderGeometry(1.2, 1.2, 50, 8), 0, 110, 0);
  add(darkParts, new THREE.CylinderGeometry(0.5, 0.5, 30, 6), 6, 100, 0);
  // docking bay
  add(hullParts, new THREE.BoxGeometry(34, 24, 34), 0, -86, 0);
  add(darkParts, new THREE.BoxGeometry(26, 14, 2), 0, -86, 17.2);
  add(neonParts, new THREE.BoxGeometry(28, 0.8, 0.8), 0, -78, 17.6);
  add(neonParts, new THREE.BoxGeometry(28, 0.8, 0.8), 0, -94, 17.6);
  // solar arrays
  const solarMat = new THREE.MeshStandardMaterial({ color: 0x14306a, metalness: 0.5, roughness: 0.25, emissive: new THREE.Color(0x0a2050), emissiveIntensity: 0.6, envMapIntensity: 1.6 });
  const solarParts = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const cx = Math.cos(a), cz = Math.sin(a);
    add(darkParts, new THREE.BoxGeometry(70, 1.2, 1.2), cx * 45, 45, cz * 45, 0, -a, 0);
    for (let k = 0; k < 3; k++) {
      const d = 30 + k * 22;
      add(solarParts, new THREE.BoxGeometry(18, 0.4, 26), cx * d, 45, cz * d, 0, -a, 0);
    }
  }
  root.add(new THREE.Mesh(mergeGeometries(hullParts), hull));
  root.add(new THREE.Mesh(mergeGeometries(darkParts), dark));
  root.add(new THREE.Mesh(mergeGeometries(neonParts), neon));
  root.add(new THREE.Mesh(mergeGeometries(solarParts), solarMat));

  // rotating habitat ring
  const ringGroup = new THREE.Group();
  const winTex = windowTexture();
  winTex.repeat.set(10, 1);
  const ringMat = new THREE.MeshStandardMaterial({ map, color: 0xaab3c2, metalness: 0.7, roughness: 0.5, emissiveMap: winTex, emissive: 0xffffff, emissiveIntensity: 2.2 });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(64, 7, 20, 128), ringMat);
  ring.rotation.x = Math.PI / 2;
  ringGroup.add(ring);
  const spokeParts = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    add(spokeParts, new THREE.CylinderGeometry(1.6, 1.6, 54, 8), Math.cos(a) * 36, 0, Math.sin(a) * 36, 0, -a, Math.PI / 2);
  }
  ringGroup.add(new THREE.Mesh(mergeGeometries(spokeParts), dark));
  const ringNeon = new THREE.Mesh(new THREE.TorusGeometry(64, 0.5, 6, 128), neon);
  ringNeon.rotation.x = Math.PI / 2;
  ringNeon.position.y = 7.2;
  ringGroup.add(ringNeon);
  ringGroup.position.y = 10;
  root.add(ringGroup);

  // blinking nav lights
  const navRed = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.4, 0.3) });
  const navGreen = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 4, 0.8) });
  const beacons = [];
  const navGeo = new THREE.SphereGeometry(1.4, 10, 8);
  for (const [x, y, z, mat] of [[0, 136, 0, navRed], [72, 10, 0, navRed], [-72, 10, 0, navGreen], [0, -100, 18, warm]]) {
    const m = new THREE.Mesh(navGeo, mat);
    m.position.set(x, y, z);
    root.add(m);
    beacons.push(m);
  }

  // neon sign
  const signTex = signTexture(name.toUpperCase(), `#${accent.getHexString()}`);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(60, 9.4), new THREE.MeshBasicMaterial({ map: signTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, color: new THREE.Color(1.8, 1.8, 1.8) }));
  sign.position.set(0, -64, 20);
  root.add(sign);

  // traffic
  const ships = [];
  for (let i = 0; i < 7; i++) {
    const ship = buildShip(i % 2 ? 0xff3c7d : accentHex);
    ship.userData = { a: Math.random() * Math.PI * 2, r: 110 + Math.random() * 90, y: -60 + Math.random() * 140, s: (0.12 + Math.random() * 0.15) * (Math.random() < 0.5 ? 1 : -1), tilt: (Math.random() - 0.5) * 0.6 };
    root.add(ship);
    ships.push(ship);
  }

  const light = new THREE.PointLight(accent, 3, 400, 1.2);
  light.position.set(0, -40, 60);
  root.add(light);

  let t = 0;
  return {
    group: root,
    update(dt) {
      t += dt;
      ringGroup.rotation.y += dt * 0.06;
      const blink = Math.sin(t * 3) > 0.7;
      navRed.color.setRGB(blink ? 4 : 0.3, blink ? 0.4 : 0.03, blink ? 0.3 : 0.02);
      navGreen.color.setRGB(blink ? 0.3 : 0.03, blink ? 4 : 0.3, blink ? 0.8 : 0.06);
      for (const s of ships) {
        const u = s.userData;
        u.a += u.s * dt;
        const x = Math.cos(u.a) * u.r, z = Math.sin(u.a) * u.r;
        s.position.set(x, u.y + Math.sin(u.a * 2) * 10, z);
        s.lookAt(Math.cos(u.a + Math.sign(u.s) * 0.1) * u.r, u.y + Math.sin((u.a + 0.1) * 2) * 10, Math.sin(u.a + Math.sign(u.s) * 0.1) * u.r);
      }
    },
  };
}

export function buildShip(accentHex) {
  const g = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color: 0x9aa4b4, metalness: 0.8, roughness: 0.35 });
  const fus = new THREE.Mesh(new THREE.ConeGeometry(1.4, 7, 6).rotateX(Math.PI / 2), body);
  g.add(fus);
  const wing = new THREE.Mesh(new THREE.BoxGeometry(7, 0.25, 2.2), body);
  wing.position.z = -1.5;
  g.add(wing);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: new THREE.Color(accentHex).multiplyScalar(2), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  glow.scale.setScalar(5);
  glow.position.z = -3.8;
  g.add(glow);
  return g;
}

// ------------------------------------------------------------ player ship --
// A sleek fighter-shuttle, about 26 m long, pointing down -Z.
export function buildPlayerShip(tier, accentHex) {
  const g = new THREE.Group();
  const { map, rough } = hullTextures();
  const hull = new THREE.MeshStandardMaterial({ map, roughnessMap: rough, color: 0xd8dde6, metalness: 0.45, roughness: 0.42, envMapIntensity: 1.0 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a303c, metalness: 0.55, roughness: 0.4 });
  const accent = new THREE.Color(accentHex);
  const neon = new THREE.MeshBasicMaterial({ color: accent.clone().multiplyScalar(2.6) });
  const glass = new THREE.MeshStandardMaterial({ color: 0x0a1a2a, metalness: 1, roughness: 0.05, envMapIntensity: 2.2, emissive: accent.clone().multiplyScalar(0.15) });
  const s = 1 + tier * 0.18;

  const profile = [];
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    const r = Math.sin(Math.pow(t, 0.7) * Math.PI) * 2.2 * (t < 0.15 ? 0.6 + t * 2.6 : 1);
    profile.push(new THREE.Vector2(Math.max(0.05, r), (t - 0.5) * 24));
  }
  const fus = new THREE.Mesh(new THREE.LatheGeometry(profile, 20).rotateX(-Math.PI / 2), hull);
  fus.scale.set(1.15, 0.75, 1);
  g.add(fus);
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(1.4, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.7, 2.4), glass);
  canopy.position.set(0, 1.1, -5);
  g.add(canopy);
  const wingShape = new THREE.Shape();
  wingShape.moveTo(0, 4);
  wingShape.lineTo(11, -3);
  wingShape.lineTo(11, -5.5);
  wingShape.lineTo(0, -7);
  wingShape.lineTo(0, 4);
  const wingGeo = new THREE.ExtrudeGeometry(wingShape, { depth: 0.5, bevelEnabled: true, bevelSize: 0.15, bevelThickness: 0.15, bevelSegments: 1 }).rotateX(-Math.PI / 2);
  for (const side of [-1, 1]) {
    const w = new THREE.Mesh(wingGeo, hull);
    w.scale.x = side;
    w.position.set(side * 1.2, -0.4, 2);
    g.add(w);
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 3), neon);
    tip.position.set(side * 12.3, -0.1, 5.8);
    g.add(tip);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(9, 0.08, 0.25), neon);
    stripe.position.set(side * 6.5, 0.2, 2.8);
    stripe.rotation.y = side * 0.55;
    g.add(stripe);
    const eng = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.3, 6, 16).rotateX(Math.PI / 2), dark);
    eng.position.set(side * 3.4, -0.2, 8.5);
    g.add(eng);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.05, 0.16, 8, 24), neon);
    ring.position.set(side * 3.4, -0.2, 11.55);
    g.add(ring);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.3, 3.2, 3.6), hull);
    fin.position.set(side * 2.2, 2, 9);
    fin.rotation.z = side * -0.35;
    g.add(fin);
  }
  const exhaustMat = new THREE.SpriteMaterial({ map: glowTexture(), color: accent.clone().multiplyScalar(1.6), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
  const flames = [-1, 1].map((side) => {
    const f = new THREE.Sprite(exhaustMat);
    f.position.set(side * 3.4, -0.2, 12.4);
    f.scale.setScalar(4);
    g.add(f);
    return f;
  });
  const strip = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 14), neon);
  strip.position.set(0, 1.55, 2);
  g.add(strip);
  const gear = new THREE.Group();
  for (const [x, z] of [[-2.2, -6], [2.2, -6], [-3, 6], [3, 6]]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 2.4, 6).translate(0, -1.2, 0), dark);
    leg.position.set(x, -1.2, z);
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 0.25, 10), dark);
    foot.position.set(x, -3.6, z);
    gear.add(leg, foot);
  }
  g.add(gear);
  const light = new THREE.PointLight(accent, 1.5, 60, 1.6);
  light.position.set(0, 3, 0);
  g.add(light);
  g.scale.setScalar(s);
  return {
    group: g,
    gear,
    setThrust(v) {
      for (const f of flames) f.scale.setScalar(2.5 + v * 7);
      exhaustMat.opacity = 0.5 + v * 0.5;
    },
    dispose() {
      g.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material && !o.isSprite) o.material.dispose();
      });
      exhaustMat.dispose();
    },
  };
}
