import * as THREE from 'three';

// Close-up surface detail for the sculpted beasts, computed in the shader from the body's
// rest-pose position (so it moves with the skin as the beast animates, and needs no
// textures or UVs):
//   scale   - interlocking reptile scales: domed, each its own shade, dark between
//   fur     - fine strands combed down the body, darker at the roots, with a soft sheen
//   chitin  - glossy armour plates with seams and fine pitting
//   stone   - rough rock with cracks
//   leather - thick hide folded into wrinkles
// Light catches the relief through a bump computed from the same pattern.

export const SKIN_FOR_PLAN = { wolf: 'fur', bear: 'fur', lizard: 'scale', wyrm: 'scale', raptor: 'scale', rhino: 'leather', mantis: 'chitin', golem: 'stone' };

const GLSL = /* glsl */ `
  vec3 bsHash3(vec3 p) {
    p = vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6)));
    return fract(sin(p) * 43758.5453);
  }
  float bsHash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
  float bsNoise(vec3 x) {
    vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(bsHash(i), bsHash(i + vec3(1, 0, 0)), f.x), mix(bsHash(i + vec3(0, 1, 0)), bsHash(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(bsHash(i + vec3(0, 0, 1)), bsHash(i + vec3(1, 0, 1)), f.x), mix(bsHash(i + vec3(0, 1, 1)), bsHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }
  // distance to the nearest and second-nearest cell centre, and the nearest cell's id
  vec3 bsVoronoi(vec3 x, out float id) {
    vec3 p = floor(x), f = fract(x);
    float d1 = 8.0, d2 = 8.0; id = 0.0;
    for (int k = -1; k <= 1; k++) for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      vec3 b = vec3(float(i), float(j), float(k));
      vec3 o = bsHash3(p + b);
      vec3 r = b + o - f;
      float d = dot(r, r);
      if (d < d1) { d2 = d1; d1 = d; id = bsHash(p + b); } else if (d < d2) d2 = d;
    }
    return vec3(sqrt(d1), sqrt(d2), 0.0);
  }
`;

// Patch a beast's hide material. radius: the body's size in its own units.
export function applySkin(mat, kind, radius) {
  if (!kind) return mat;
  const freq = { scale: 26, fur: 140, chitin: 7, stone: 9, leather: 14, suit: 32 }[kind] / Math.max(0.05, radius);
  const K = { scale: 0, fur: 1, chitin: 2, stone: 3, leather: 4, suit: 5 }[kind];
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.bsFreq = { value: freq };
    shader.vertexShader = `varying vec3 vBsP;\nvarying vec3 vBsN;\nuniform float bsFreq;\n${shader.vertexShader}`.replace('#include <begin_vertex>', '#include <begin_vertex>\nvBsP = position * bsFreq;\nvBsN = normal;');
    shader.fragmentShader = `varying vec3 vBsP;\nvarying vec3 vBsN;\n${GLSL}\nfloat bsH;\n${shader.fragmentShader}`
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          float id;
          #if ${K} == 0
            // scales: a little elongated along the body, domed, with dark creases between
            vec3 v = bsVoronoi(vBsP * vec3(1.0, 1.35, 1.0), id);
            float edge = smoothstep(0.0, 0.14, v.y - v.x);
            bsH = (1.0 - v.x * 0.9) * edge;
            diffuseColor.rgb *= (0.62 + 0.38 * edge) * (0.86 + 0.28 * id);
            diffuseColor.rgb *= 0.92 + 0.12 * bsNoise(vBsP * 0.21);
          #elif ${K} == 1
            // fur: strands combed down and back, root shadow, per-tuft tone
            float s = bsNoise(vBsP * vec3(1.0, 0.12, 1.0)) * 0.65 + bsNoise(vBsP * vec3(2.3, 0.25, 2.3)) * 0.35;
            float tuft = bsNoise(vBsP * 0.07);
            bsH = s;
            diffuseColor.rgb *= (0.55 + 0.6 * s) * (0.85 + 0.3 * tuft);
          #elif ${K} == 2
            // chitin: big plates with deep seams and fine pits
            vec3 v = bsVoronoi(vBsP, id);
            float seam = smoothstep(0.0, 0.07, v.y - v.x);
            float pit = smoothstep(0.62, 0.7, bsNoise(vBsP * 9.0));
            bsH = seam * 0.8 - pit * 0.15 + v.x * 0.15;
            diffuseColor.rgb *= (0.45 + 0.55 * seam) * (0.9 + 0.2 * id) * (1.0 - 0.25 * pit);
          #elif ${K} == 3
            // stone: lumpy, cracked
            vec3 v = bsVoronoi(vBsP, id);
            float crack = smoothstep(0.0, 0.05, v.y - v.x);
            float lump = bsNoise(vBsP * 2.0) * 0.6 + bsNoise(vBsP * 5.0) * 0.4;
            bsH = crack * (0.5 + 0.5 * lump);
            diffuseColor.rgb *= (0.5 + 0.5 * crack) * (0.8 + 0.35 * lump) * (0.9 + 0.2 * id);
          #elif ${K} == 5
            // a combat suit: a fine hexagonal weave in slight relief, cut into panels by seams
            vec3 v = bsVoronoi(vBsP, id);
            float cell = smoothstep(0.0, 0.1, v.y - v.x);
            float pid;
            vec3 pv = bsVoronoi(vBsP * 0.11, pid);
            float seam = smoothstep(0.0, 0.025, pv.y - pv.x);
            // the weave only shows up close (further off it would just sparkle); seams carry further
            float vd = length(vViewPosition);
            float nearW = 1.0 - smoothstep(1.2, 3.5, vd), nearS = 1.0 - smoothstep(4.0, 14.0, vd);
            cell = mix(1.0, cell, nearW);
            seam = mix(1.0, seam, nearS * 0.85);
            bsH = (cell * 0.6 + seam * 0.4) * nearS;
            diffuseColor.rgb *= (0.86 + 0.14 * cell) * (0.6 + 0.4 * seam) * (0.96 + 0.08 * pid);
          #else
            // leather: folds and wrinkles, coarser on the flanks
            float w1 = abs(bsNoise(vBsP * vec3(1.0, 2.6, 1.0)) * 2.0 - 1.0);
            float w2 = abs(bsNoise(vBsP * 3.1) * 2.0 - 1.0);
            bsH = 1.0 - (w1 * 0.7 + w2 * 0.3);
            diffuseColor.rgb *= 0.7 + 0.35 * bsH;
          #endif
        }`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          // bump from the pattern's height, fading with distance before it shimmers
          vec3 dx = dFdx(-vViewPosition), dy = dFdy(-vViewPosition);
          vec3 r1 = cross(dy, normal), r2 = cross(normal, dx);
          float det = dot(dx, r1);
          vec3 grad = sign(det) * (dFdx(bsH) * r1 + dFdy(bsH) * r2) / max(abs(det), 1e-6);
          float far = 1.0 - smoothstep(8.0, 45.0, length(vViewPosition));
          float strength = ${K === 1 ? '0.018' : K === 0 ? '0.03' : K === 5 ? '0.012' : '0.035'} * (${K === 5 ? '1.0 - smoothstep(2.0, 9.0, length(vViewPosition))' : 'far'});
          vec3 bump = grad * strength;
          normal = normalize(normal - bump / max(1.0, length(bump) * 1.4));
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        ${K === 0 ? 'roughnessFactor = mix(0.85, 0.42, bsH);' : K === 2 ? 'roughnessFactor = 0.32;' : K === 1 ? 'roughnessFactor = 0.95;' : K === 5 ? 'roughnessFactor = mix(roughnessFactor, mix(0.62, 0.34, bsH), 0.8);' : ''}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        ${K === 1 ? '// fur catches light along its edges\n        totalEmissiveRadiance += diffuseColor.rgb * pow(1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0), 3.0) * 0.45;' : ''}`);
  };
  mat.customProgramCacheKey = () => `beast-skin-${kind}-${freq.toFixed(2)}`;
  mat.needsUpdate = true;
  return mat;
}
