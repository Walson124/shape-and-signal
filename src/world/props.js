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
// deterministic randomness so every tree of a kind is the same mesh (they're instanced)
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// Push vertices in and out with smooth noise so foliage clumps read as lumpy masses.
function lumpy(geo, amount, freq, seed = 0) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const p = g.attributes.position;
  const v = new THREE.Vector3(), c = new THREE.Vector3();
  g.computeBoundingBox(); g.boundingBox.getCenter(c);
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const d = v.clone().sub(c);
    const n = Math.sin(v.x * freq + seed) * Math.cos(v.y * freq * 1.3 + seed * 2) * Math.sin(v.z * freq * 0.9 + seed * 3)
      + 0.5 * Math.sin(v.x * freq * 2.7 + v.z * freq * 2.1 + seed);
    v.addScaledVector(d.normalize(), n * amount);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

// Darken a prop where light can't reach: low down, under the canopy and on undersides.
// It's baked into the vertex colours, so it costs nothing to draw.
function occlude(geo, top, strength = 0.55) {
  const p = geo.attributes.position, n = geo.attributes.normal, c = geo.attributes.color;
  for (let i = 0; i < p.count; i++) {
    const h = Math.max(0, Math.min(1, p.getY(i) / top));
    const under = Math.max(0, -n.getY(i));
    const rad = Math.min(1, Math.hypot(p.getX(i), p.getZ(i)) / (top * 0.35));
    const k = 1 - strength * (1 - h) * 0.6 - strength * under * 0.5 + strength * 0.25 * rad * h;
    c.setXYZ(i, c.getX(i) * k, c.getY(i) * k, c.getZ(i) * k);
  }
  return geo;
}

const merge = (parts) => {
  const m = mergeGeometries(parts);
  // Keep the source normals: spheres/capsules are smooth, crystals stay sharp.
  return m;
};

let cache = null;
export function propGeometries() {
  if (cache) return cache;
  // a conifer: a tapering trunk and seven tiers of drooping, ragged boughs, darker inside
  const pine = (() => {
    const r = rng(11);
    const parts = [colored(new THREE.CylinderGeometry(0.16, 0.42, 11, 7).translate(0, 5.5, 0), 0x4a3020, 0.12)];
    const tiers = 7;
    for (let t = 0; t < tiers; t++) {
      const k = t / (tiers - 1);
      const rad = 2.9 * (1 - k * 0.82) + 0.3;
      const y = 2.6 + t * 1.25;
      const g = new THREE.ConeGeometry(rad, 2.4 - k * 0.8, 12, 2, true);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), z = p.getZ(i), yy = p.getY(i);
        const a = Math.atan2(z, x);
        // ragged bough tips, and the skirt droops at its rim
        const rag = 1 + Math.sin(a * 6 + t * 1.7) * 0.16 + Math.sin(a * 11 + t) * 0.08;
        const rim = Math.hypot(x, z) / rad;
        p.setXYZ(i, x * rag, yy - rim * rim * 0.35 * rad, z * rag);
      }
      g.computeVertexNormals();
      const shade = [0x2b5233, 0x2f5a37, 0x36633b, 0x3d6c3d][Math.floor(r() * 4)];
      parts.push(colored(g.translate(0, y, 0), shade, 0.12));
    }
    return occlude(merge(parts), 11.5);
  })();
  // a broadleaf: a trunk that forks into branches, under a crown of lumpy leaf clumps
  const broad = (() => {
    const r = rng(23);
    const parts = [colored(new THREE.CylinderGeometry(0.32, 0.6, 4.4, 8).translate(0, 2.2, 0), 0x5a3e26, 0.12)];
    const crown = [[0, 7.2, 0, 3.1], [2.1, 6.4, 0.8, 2.2], [-1.9, 6.6, -0.9, 2.3], [0.6, 6.0, -2.0, 2.0], [-0.8, 5.9, 2.0, 2.0], [0.4, 8.6, 0.3, 2.0]];
    for (const [x, y, z] of crown.slice(1)) {
      // a branch from the fork to each outer clump
      const from = new THREE.Vector3(0, 4.2, 0), to = new THREE.Vector3(x * 0.8, y - 0.8, z * 0.8);
      const len = from.distanceTo(to);
      const br = new THREE.CylinderGeometry(0.12, 0.24, len, 5).translate(0, len / 2, 0);
      br.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize())).translate(from.x, from.y, from.z);
      parts.push(colored(br, 0x5a3e26, 0.1));
    }
    crown.forEach(([x, y, z, rad], i) => {
      const shade = [0x4d7836, 0x58823b, 0x628c40, 0x496e32][Math.floor(r() * 4)];
      parts.push(colored(lumpy(new THREE.IcosahedronGeometry(rad, 2).scale(1, 0.82, 1), rad * 0.16, 1.4, i * 3.1).translate(x, y, z), shade, 0.14));
    });
    return occlude(merge(parts), 10);
  })();
  // a boulder half sunk in the ground with a smaller stone beside it (tinted per world)
  const boulder = (seed, size) => {
    const g = new THREE.IcosahedronGeometry(size, 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      // blocky facets plus fine grain, flattened underneath
      const s = 0.82 + Math.sin(x * 2.3 + seed) * Math.cos(z * 2.7 + seed) * 0.16 + Math.sin(y * 5.1 + x * 3.3) * 0.05;
      p.setXYZ(i, x * s, Math.max(y * s * 0.72, -size * 0.25), z * s);
    }
    return smoothSurface(g);
  };
  const rock = occlude(merge([
    colored(boulder(1, 1.7).translate(0, 0.45, 0), 0x9a948a, 0.12),
    colored(boulder(4, 0.7).translate(1.7, 0.15, 0.6), 0x8e887e, 0.12),
  ]), 2.2, 0.6);
  // a saguaro: a ribbed column with two arms that rise from elbows
  const ribbed = (r0, len, segs = 12) => {
    const g = new THREE.CylinderGeometry(r0 * 0.85, r0, len, segs * 2, 6);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i), y = p.getY(i);
      const a = Math.atan2(z, x);
      const rib = 1 + Math.cos(a * segs) * 0.09;
      const top = y > len / 2 - 0.01 ? 0.55 : 1;
      p.setXYZ(i, x * rib * top, y, z * rib * top);
    }
    g.computeVertexNormals();
    return g;
  };
  const arm = (side, h, reach, up) => {
    const elbow = ribbed(0.3, reach).rotateZ(side * Math.PI / 2).translate(side * reach / 2, h, 0);
    const rise = ribbed(0.29, up).translate(side * reach, h + up / 2, 0);
    return [colored(elbow, 0x50694a, 0.1), colored(rise, 0x56714d, 0.1)];
  };
  const cactus = occlude(merge([
    colored(ribbed(0.48, 6).translate(0, 3, 0), 0x50694a, 0.1),
    ...arm(1, 2.6, 1.1, 1.8),
    ...arm(-1, 3.4, 0.9, 1.4),
  ]), 6.5, 0.45);
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
  // a cluster of hexagonal ice shards with sharp tips, leaning out, faintly glowing at the core
  const shard = (r, h, lean, yaw, x, z, hex) => {
    const g = new THREE.CylinderGeometry(r * 0.75, r, h, 6, 1).translate(0, h / 2, 0);
    const tip = new THREE.ConeGeometry(r * 0.75, r * 2.2, 6).translate(0, h + r * 1.1, 0);
    const m = mergeGeometries([g.toNonIndexed(), tip.toNonIndexed()]);
    m.rotateZ(lean).rotateY(yaw).translate(x, 0, z);
    return colored(m, hex, 0.06);
  };
  const ice = merge([
    shard(0.55, 4.2, 0.05, 0, 0, 0, 0x9ccbf2),
    shard(0.4, 2.8, 0.45, 0.8, 0.5, 0.2, 0x86bdee),
    shard(0.35, 2.2, -0.5, 2.1, -0.5, 0.3, 0xa6d2f5),
    shard(0.3, 1.6, 0.6, 4.0, 0.1, -0.6, 0x7ab4ea),
    shard(0.22, 1.1, -0.3, 5.2, -0.3, -0.5, 0xc0e2fa),
  ]);
  ice.attributes.glow.array.fill(0.12);
  cache = {
    [PROP.PINE]: pine, [PROP.BROAD]: broad, [PROP.ROCK]: rock, [PROP.CACTUS]: cactus,
    [PROP.CRYSTAL]: crystal, [PROP.SHROOM]: shroom, [PROP.DEAD]: dead, [PROP.ICE]: ice,
  };
  return cache;
}

// Shared material for terrain chunks and props: vertex colours, a glow mask,
// and procedural micro-detail so close-up ground doesn't look smeared.
export function terrainMaterial(detailScale = 0.35, type = '') {
  // wind-combed ripples across sand worlds, carried into the relief below
  const ripples = type === 'desert' ? `groundDetail += 0.42 * sin((vPP.x * 0.83 + vPP.z * 0.47 + vPP.y * 0.31) * 1.3 + vn(vPP * 0.04) * 7.0) * (0.6 + 0.4 * vn(vPP * 0.11));` : '';
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93, metalness: 0, envMapIntensity: 0.25 });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = `attribute float glow;\nattribute vec3 ppos;\nvarying float vGlow;\nvarying vec3 vPP;\nvarying float vUpness;\n${shader.vertexShader}`.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\nvGlow = glow;\nvPP = ppos;\nvUpness = dot(normalize(objectNormal), normalize(ppos));',
    );
    shader.fragmentShader = `varying float vGlow;\nvarying vec3 vPP;\nvarying float vUpness;\n
      // hash of a lattice cell; wrapped first, because at planet-scale coordinates the raw hash
      // runs out of float precision and draws stripes
      float th(vec3 p){ p = fract(mod(p, 289.0) * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
      float vn(vec3 x){ vec3 i = floor(x); vec3 f = fract(x); f = f*f*(3.0-2.0*f);
        return mix(mix(mix(th(i), th(i+vec3(1,0,0)), f.x), mix(th(i+vec3(0,1,0)), th(i+vec3(1,1,0)), f.x), f.y),
                   mix(mix(th(i+vec3(0,0,1)), th(i+vec3(1,0,1)), f.x), mix(th(i+vec3(0,1,1)), th(i+vec3(1,1,1)), f.x), f.y), f.z); }
      ${shader.fragmentShader}`.replace(
      '#include <color_fragment>',
      `#include <color_fragment>
      float groundDetail = vn(vPP * ${detailScale.toFixed(3)}) * 0.55 + vn(vPP * ${(detailScale * 4.1).toFixed(3)}) * 0.3 + vn(vPP * 0.031) * 0.35;
      ${ripples}
      diffuseColor.rgb *= 0.72 + 0.5 * groundDetail;
      // steep ground is bare rock: the world's own colour, greyed, in layered strata
      float steep = 1.0 - smoothstep(0.6, 0.82, vUpness + (vn(vPP * 0.09) - 0.5) * 0.12);
      if (steep > 0.0) {
        float lumG = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
        vec3 rockC = mix(vec3(lumG) * vec3(1.06, 1.0, 0.94), diffuseColor.rgb, 0.4) * 1.25;
        float strata = sin(length(vPP) * 0.8 + vn(vPP * 0.05) * 6.0);
        rockC *= 0.82 + 0.18 * smoothstep(-0.4, 0.6, strata) + 0.12 * vn(vPP * 1.9 + strata);
        diffuseColor.rgb = mix(diffuseColor.rgb, rockC, steep);
      }`,
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
      // derivatives break into 2x2 blocks on surfaces seen edge-on, so the relief fades there
      float groundFacing = smoothstep(0.08, 0.3, abs(dot(normal, normalize(vViewPosition))));
      float groundRelief = 0.35 * groundFacing * (1.0 - smoothstep(25.0, 130.0, length(vViewPosition)));
      vec3 groundBump = groundGrad * groundRelief;
      normal = normalize(normal - groundBump / max(1.0, length(groundBump) * 1.5));`,
    ).replace(
      '#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * vGlow * 3.0;',
    );
  };
  mat.customProgramCacheKey = () => `terrain-relief-v5-${detailScale}-${type === 'desert' ? 'sand' : ''}`;
  return mat;
}

// one clock for every prop material, advanced by the game each frame
export const propWind = { value: 0 };

export function propMaterial() {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, envMapIntensity: 0.3 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uWind = propWind;
    shader.vertexShader = `attribute float glow;\nvarying float vGlow;\nuniform float uWind;\n${shader.vertexShader}`.replace('#include <begin_vertex>', `#include <begin_vertex>
vGlow = glow;
#ifdef USE_INSTANCING
  // sway: grows with height, phase from the instance's position so trees move independently
  float swayH = max(0.0, transformed.y - 2.0);
  float swayP = instanceMatrix[3].x * 0.07 + instanceMatrix[3].z * 0.05 + instanceMatrix[3].y * 0.03;
  float swayA = sin(uWind * 1.3 + swayP) * 0.6 + sin(uWind * 2.9 + swayP * 1.7) * 0.25;
  transformed.x += swayH * swayH * 0.0035 * swayA;
  transformed.z += swayH * swayH * 0.0025 * cos(uWind * 1.1 + swayP);
#endif`);
    shader.fragmentShader = `varying float vGlow;\n${shader.fragmentShader}`.replace(
      '#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * vGlow * 2.2;',
    ).replace(
      '#include <clipping_planes_fragment>',
      `#include <clipping_planes_fragment>
      // foliage right in front of the camera dissolves (interleaved gradient noise, no stripes) so a tree you're
      // standing in never fills the screen
      float nearFade = smoothstep(2.5, 7.0, length(vViewPosition));
      float dither = fract(52.9829189 * fract(dot(floor(gl_FragCoord.xy), vec2(0.06711056, 0.00583715))));
      if (nearFade < 1.0 && dither > nearFade) discard;`,
    );
  };
  mat.customProgramCacheKey = () => 'prop-glow-wind-fade-2';
  return mat;
}
