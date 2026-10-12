// The renderer uses a logarithmic depth buffer so a cultivator's fingertips
// and a planet a thousand kilometres away can share one depth range. Custom
// ShaderMaterials must opt in, or their depth won't match built-in materials.
// Includes must start on their own line, so they are inserted after a newline.
export function withLogDepth(mat) {
  if (mat.userData.logDepth) return mat;
  mat.userData.logDepth = true;
  mat.vertexShader = `#include <common>\n#include <logdepthbuf_pars_vertex>\n${mat.vertexShader.replace(/}\s*$/, '\n#include <logdepthbuf_vertex>\n}\n')}`;
  mat.fragmentShader = `#include <logdepthbuf_pars_fragment>\n${mat.fragmentShader.replace(/}\s*$/, '\n#include <logdepthbuf_fragment>\n}\n')}`;
  return mat;
}
