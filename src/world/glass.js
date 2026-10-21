import { windowLight } from './floorplan.js';
import { wetUpView } from './weather.js';

// Glass that mirrors the sky. The environment map is the starfield, so windows would
// otherwise reflect space at noon; instead they reflect the sky's own colour (windowLight,
// which the game keeps in step with the time of day and the weather), bright where they
// look up at it and darker where they reflect the street, and strongly at grazing angles
// like real glass. `mask` is a GLSL expression (0..1) for which pixels are glass, evaluated
// after the base colour is known (diffuseColor is available).
export function addSkyReflection(mat, { mask = '1.0', strength = 0.8, key = '' } = {}) {
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey;
  mat.onBeforeCompile = (shader, renderer) => {
    if (prev) prev.call(mat, shader, renderer);
    shader.uniforms.uSkyTint = { value: windowLight };
    shader.uniforms.uSkyUp = wetUpView;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uSkyTint;\nuniform vec3 uSkyUp;\nfloat glassMask;')
      .replace('#include <color_fragment>', `#include <color_fragment>\nglassMask = clamp(${mask}, 0.0, 1.0);`)
      .replace('#include <opaque_fragment>', `{
          vec3 V = normalize(vViewPosition);
          vec3 Nn = normalize(normal);
          float fres = pow(1.0 - clamp(abs(dot(Nn, V)), 0.0, 1.0), 4.0);
          vec3 R = reflect(-V, Nn);
          float upness = dot(R, uSkyUp);
          // sky above the horizon, the dim street below it, a bright band at the horizon
          vec3 sky = uSkyTint * (upness > 0.0 ? 1.0 + 0.35 * (1.0 - upness) : 0.22 + 0.2 * exp(upness * 6.0));
          float k = glassMask * ${strength.toFixed(2)} * (0.18 + 0.82 * fres);
          outgoingLight = mix(outgoingLight, sky, k);
          diffuseColor.a = mix(diffuseColor.a, 1.0, glassMask * fres * 0.7);
        }
        #include <opaque_fragment>`);
  };
  mat.customProgramCacheKey = () => `${prevKey ? prevKey.call(mat) : ''}|glass${key}`;
  return mat;
}
