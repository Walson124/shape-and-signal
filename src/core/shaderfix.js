import * as THREE from 'three';

// Three's flat-shading and bump-mapping chunks normalize screen-space
// derivatives without a guard. On sub-pixel triangles (distant asteroids,
// far planets) those derivatives can be zero on some GPU drivers (seen on
// AMD/D3D11), producing NaN pixels that bloom smears into flickering black
// squares. Patch both chunks to fall back to a sane normal instead.

const SAFE = /* glsl */ `
vec3 safeNormalize( vec3 v, vec3 fallback ) {
  float l2 = dot( v, v );
  return l2 > 1e-24 ? v * inversesqrt( l2 ) : fallback;
}
`;

function patch(name, from, to) {
  const src = THREE.ShaderChunk[name];
  if (!src.includes(from)) {
    console.warn(`shaderfix: ${name} changed upstream, patch skipped`);
    return;
  }
  THREE.ShaderChunk[name] = src.replace(from, to);
}

let applied = false;
export function applyShaderFixes() {
  if (applied) return;
  applied = true;

  patch(
    'normal_fragment_begin',
    'vec3 normal = normalize( cross( fdx, fdy ) );',
    'vec3 normal = safeNormalize( cross( fdx, fdy ), vec3( 0.0, 0.0, 1.0 ) );',
  );
  // make safeNormalize available to every lit material
  patch('common', '#define PI 3.141592653589793', `#define PI 3.141592653589793\n${SAFE}`);

  patch(
    'bumpmap_pars_fragment',
    `		vec3 vSigmaX = normalize( dFdx( surf_pos.xyz ) );
		vec3 vSigmaY = normalize( dFdy( surf_pos.xyz ) );`,
    `		vec3 vSigmaX = safeNormalize( dFdx( surf_pos.xyz ), vec3( 1.0, 0.0, 0.0 ) );
		vec3 vSigmaY = safeNormalize( dFdy( surf_pos.xyz ), vec3( 0.0, 1.0, 0.0 ) );`,
  );
  patch(
    'bumpmap_pars_fragment',
    '		return normalize( abs( fDet ) * surf_norm - vGrad );',
    '		return safeNormalize( abs( fDet ) * surf_norm - vGrad, surf_norm );',
  );
}
