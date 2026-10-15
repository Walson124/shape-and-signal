import * as THREE from 'three';
import { bevelBox } from './geometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { NOISE_GLSL } from '../core/glsl.js';
import { glowTexture } from './textures.js';

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
  const fuller = new THREE.Mesh(bevelBox(0.02, 0.078, 1.35), glowMat);
  fuller.position.z = 0.82;
  g.add(fuller);
  for (const s of [-1, 1]) {
    const edge = new THREE.Mesh(bevelBox(0.012, 0.012, 1.7).translate(0, 0, 0.85), glowMat);
    edge.position.x = s * 0.118;
    edge.rotation.y = s * -0.028;
    g.add(edge);
  }
  const guardMat = new THREE.MeshStandardMaterial({ color: 0x2a2f3c, metalness: 0.9, roughness: 0.3 });
  const guard = new THREE.Mesh(bevelBox(0.46, 0.07, 0.09), guardMat);
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

// Small flying craft used for city traffic and wrecks.
export function buildShip(accentHex) {
  const g = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color: 0x9aa4b4, metalness: 0.8, roughness: 0.35 });
  const fus = new THREE.Mesh(new THREE.ConeGeometry(1.4, 7, 6).rotateX(Math.PI / 2), body);
  g.add(fus);
  const wing = new THREE.Mesh(bevelBox(7, 0.25, 2.2), body);
  wing.position.z = -1.5;
  g.add(wing);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: new THREE.Color(accentHex).multiplyScalar(2), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  glow.scale.setScalar(5);
  glow.position.z = -3.8;
  g.add(glow);
  return g;
}

// Tier-specific player hulls share the existing model interface.
export { buildPlayerShip } from './player-ships.js';
