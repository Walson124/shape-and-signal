import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { smoothSurface } from './geometry.js';
import { PROP } from './terrain.js';

// Low-poly props with baked vertex colours, merged into one geometry each so
// a chunk can draw hundreds of them with one instanced draw call per type.
function colored(geo, hex, jitter = 0.08) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const c = new THREE.Color(hex);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  const p = g.attributes.position;
  for (let i = 0; i < n; i++) {
    // Continuous variation keeps shared corners the same colour, eliminating
    // the random triangle patchwork without adding texture lookups.
    const k = 1 + Math.sin(p.getX(i) * 1.7 + p.getY(i) * 0.7 + p.getZ(i) * 1.3) * jitter;
    arr.set([c.r * k, c.g * k, c.b * k], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  const glow = new Float32Array(n);
  g.setAttribute('glow', new THREE.BufferAttribute(glow, 1));
  g.deleteAttribute('uv');
  return g;
}
function glowing(geo, hex) {
  const g = colored(geo, hex, 0.02);
  g.attributes.glow.array.fill(1);
  return g;
}
const merge = (parts) => {
  const m = mergeGeometries(parts);
  // Keep the source normals: spheres/capsules are smooth, crystals stay sharp.
  return m;
};

let cache = null;
export function propGeometries() {
  if (cache) return cache;
  const pine = merge([
    colored(new THREE.CylinderGeometry(0.25, 0.4, 3, 6).translate(0, 1.5, 0), 0x5a3a22),
    colored(new THREE.ConeGeometry(2.6, 5, 7).translate(0, 4.5, 0), 0x3a7a40),
    colored(new THREE.ConeGeometry(2.0, 4, 7).translate(0, 7, 0), 0x448a48),
    colored(new THREE.ConeGeometry(1.3, 3.2, 7).translate(0, 9.2, 0), 0x4e9a50),
  ]);
  const broad = merge([
    colored(new THREE.CylinderGeometry(0.3, 0.5, 4, 6).translate(0, 2, 0), 0x6a4a2a),
    colored(new THREE.IcosahedronGeometry(3.2, 1).scale(1, 0.8, 1).translate(0, 6, 0), 0x5a9a3a),
    colored(new THREE.IcosahedronGeometry(2.2, 1).translate(1.6, 7.2, 0.6), 0x6aaa42),
    colored(new THREE.IcosahedronGeometry(2.0, 1).translate(-1.4, 6.8, -0.8), 0x4e8a34),
  ]);
  const rock = (() => {
    const g = new THREE.DodecahedronGeometry(1.6, 1);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const s = 0.75 + Math.sin(p.getX(i) * 3.1 + p.getZ(i) * 2.3) * 0.2 + Math.cos(p.getY(i) * 4.2) * 0.1;
      p.setXYZ(i, p.getX(i) * s, p.getY(i) * s * 0.7, p.getZ(i) * s);
    }
    const smooth = smoothSurface(g);
    return merge([colored(smooth.translate(0, 0.6, 0), 0x9a948a, 0.1)]);
  })();
  const cactus = merge([
    colored(new THREE.CapsuleGeometry(0.45, 4, 3, 8).translate(0, 2.4, 0), 0x4a7a3a),
    colored(new THREE.CapsuleGeometry(0.3, 1.6, 3, 8).rotateZ(Math.PI / 2).translate(0.9, 2.6, 0), 0x4a7a3a),
    colored(new THREE.CapsuleGeometry(0.28, 1.4, 3, 8).translate(1.6, 3.2, 0), 0x4a7a3a),
  ]);
  const crystal = merge([
    glowing(new THREE.OctahedronGeometry(1, 0).scale(0.7, 3.4, 0.7).translate(0, 2.6, 0), 0xa98cff),
    glowing(new THREE.OctahedronGeometry(1, 0).scale(0.45, 2.2, 0.45).rotateZ(0.5).translate(1.1, 1.6, 0.2), 0x7affe0),
    glowing(new THREE.OctahedronGeometry(1, 0).scale(0.4, 1.8, 0.4).rotateZ(-0.6).translate(-0.9, 1.3, -0.3), 0xc0a0ff),
  ]);
  const shroom = merge([
    colored(new THREE.CylinderGeometry(0.35, 0.55, 3.5, 7).translate(0, 1.75, 0), 0xd8d0b0),
    glowing(new THREE.SphereGeometry(2.4, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.55, 1).translate(0, 3.4, 0), 0xb4ff4a),
  ]);
  const dead = merge([
    colored(new THREE.CylinderGeometry(0.15, 0.35, 5, 5).translate(0, 2.5, 0), 0x2a2420),
    colored(new THREE.CylinderGeometry(0.08, 0.15, 2.4, 4).rotateZ(0.9).translate(0.8, 3.6, 0), 0x2a2420),
    colored(new THREE.CylinderGeometry(0.08, 0.14, 2, 4).rotateZ(-1.0).translate(-0.7, 3.0, 0.2), 0x2a2420),
  ]);
  const ice = merge([
    colored(new THREE.ConeGeometry(0.9, 6, 5).translate(0, 3, 0), 0xcfe8ff, 0.04),
    colored(new THREE.ConeGeometry(0.6, 3.5, 5).rotateZ(0.3).translate(0.9, 1.6, 0.3), 0xb0d8ff, 0.04),
  ]);
  cache = {
    [PROP.PINE]: pine, [PROP.BROAD]: broad, [PROP.ROCK]: rock, [PROP.CACTUS]: cactus,
    [PROP.CRYSTAL]: crystal, [PROP.SHROOM]: shroom, [PROP.DEAD]: dead, [PROP.ICE]: ice,
  };
  return cache;
}

// Shared material for terrain chunks and props: vertex colours, a glow mask,
// and procedural micro-detail so close-up ground doesn't look smeared.
export function terrainMaterial(detailScale = 0.35) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93, metalness: 0, envMapIntensity: 0.25 });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = `attribute float glow;\nattribute vec3 ppos;\nvarying float vGlow;\nvarying vec3 vPP;\n${shader.vertexShader}`.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\nvGlow = glow;\nvPP = ppos;',
    );
    shader.fragmentShader = `varying float vGlow;\nvarying vec3 vPP;\n
      float th(vec3 p){ p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
      float vn(vec3 x){ vec3 i = floor(x); vec3 f = fract(x); f = f*f*(3.0-2.0*f);
        return mix(mix(mix(th(i), th(i+vec3(1,0,0)), f.x), mix(th(i+vec3(0,1,0)), th(i+vec3(1,1,0)), f.x), f.y),
                   mix(mix(th(i+vec3(0,0,1)), th(i+vec3(1,0,1)), f.x), mix(th(i+vec3(0,1,1)), th(i+vec3(1,1,1)), f.x), f.y), f.z); }
      ${shader.fragmentShader}`.replace(
      '#include <color_fragment>',
      `#include <color_fragment>
      float groundDetail = vn(vPP * ${detailScale.toFixed(3)}) * 0.55 + vn(vPP * ${(detailScale * 4.1).toFixed(3)}) * 0.3 + vn(vPP * 0.031) * 0.35;
      diffuseColor.rgb *= 0.72 + 0.5 * groundDetail;`,
    ).replace(
      '#include <normal_fragment_maps>',
      `#include <normal_fragment_maps>
      // Surface-gradient bump from the existing detail signal. No new noise
      // evaluations or texture reads; fades before distant pixels shimmer.
      vec3 groundDx = dFdx(-vViewPosition);
      vec3 groundDy = dFdy(-vViewPosition);
      vec3 groundR1 = cross(groundDy, normal);
      vec3 groundR2 = cross(normal, groundDx);
      float groundDet = dot(groundDx, groundR1);
      vec3 groundGrad = sign(groundDet) * (dFdx(groundDetail) * groundR1 + dFdy(groundDetail) * groundR2) / max(abs(groundDet), 0.000001);
      float groundRelief = 0.35 * (1.0 - smoothstep(25.0, 130.0, length(vViewPosition)));
      normal = normalize(normal - groundGrad * groundRelief);`,
    ).replace(
      '#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * vGlow * 3.0;',
    );
  };
  mat.customProgramCacheKey = () => `terrain-relief-v2-${detailScale}`;
  return mat;
}

export function propMaterial() {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, envMapIntensity: 0.3 });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = `attribute float glow;\nvarying float vGlow;\n${shader.vertexShader}`.replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = glow;');
    shader.fragmentShader = `varying float vGlow;\n${shader.fragmentShader}`.replace(
      '#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * vGlow * 2.2;',
    );
  };
  mat.customProgramCacheKey = () => 'prop-glow';
  return mat;
}
