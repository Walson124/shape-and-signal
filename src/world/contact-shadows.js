import * as THREE from 'three';

// Soft contact shadows under people and beasts on a world's surface. There are no
// shadow maps (surfaces sit millions of metres from the scene origin, where shadow
// coordinates shake), so each body gets a dark, soft-edged disc laid on the ground
// under it, tilted to the slope, fading as the body rises. It grounds characters that
// otherwise seem to float. One instanced draw call.

const MAX = 48;
const tA = new THREE.Vector3(), tB = new THREE.Vector3(), tC = new THREE.Vector3(), tN = new THREE.Vector3();
const tQ = new THREE.Quaternion(), tS = new THREE.Vector3(), tM = new THREE.Matrix4();
const Y = new THREE.Vector3(0, 1, 0);

function discTexture() {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  // a gaussian falloff that reaches nothing at the rim: a soft shadow, not a hole.
  // Painted in opaque greys: an alpha map reads the green channel, not alpha.
  for (let i = 0; i <= 10; i++) {
    const r = i / 10;
    const v = Math.round(255 * Math.exp(-r * r * 4.5) * (1 - r));
    grad.addColorStop(r, `rgb(${v},${v},${v})`);
  }
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

export class ContactShadows {
  constructor(root) {
    const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: typeof document !== 'undefined' ? discTexture() : null, transparent: true, depthWrite: false, fog: false });
    // the instance colour's red channel carries each disc's strength
    mat.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <alphamap_fragment>', `#include <alphamap_fragment>
      #ifdef USE_INSTANCING_COLOR
        diffuseColor.a *= vColor.r;
      #endif
      diffuseColor.rgb = vec3(0.0);`);
    };
    mat.customProgramCacheKey = () => 'contact-shadow';
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.mesh.count = 0;
    root.add(this.mesh);
    this.root = root;
    this.cache = new Map(); // key -> { at, normal }: the slope, re-measured once a body moves
    this.frame = null;
  }

  // casters: [{ pos (local frame, the body's foot point), size (m), lift (height above its ground, m) }]
  update(frame, camPos, casters) {
    const m = this.mesh;
    if (frame !== this.frame) { this.frame = frame; this.cache.clear(); }
    if (!frame || !frame.terrain || !casters.length) { m.count = 0; return; }
    if (this.cache.size > 400) this.cache.clear();
    let n = 0;
    for (const c of casters) {
      if (n >= MAX) break;
      const fade = (1 - c.lift / (c.size * 2.5 + 1.5)) * (1 - THREE.MathUtils.smoothstep(camPos.distanceTo(c.pos), 90, 160));
      if (fade <= 0.02) continue;
      // the ground under the body, tilted to the slope from two samples a metre either side
      const up = tA.copy(c.pos).normalize();
      const ground = c.ground ?? frame.groundBelow(c.pos);
      const p = tB.copy(up).multiplyScalar(ground);
      let hit = c.key && this.cache.get(c.key);
      if (!hit || hit.at.distanceToSquared(p) > 0.16) {
        const e = tC.copy(Math.abs(up.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : Y).cross(up).normalize();
        const f = tN.crossVectors(up, e);
        const sample = (dx, dz) => {
          const q = up.clone().multiplyScalar(ground).addScaledVector(e, dx).addScaledVector(f, dz);
          return q.setLength(frame.groundBelow(q));
        };
        const a = sample(1, 0), b = sample(-1, 0), cc = sample(0, 1), d = sample(0, -1);
        const nrm = new THREE.Vector3().crossVectors(cc.sub(d), a.sub(b)).normalize();
        if (nrm.dot(up) < 0) nrm.negate();
        if (nrm.dot(up) < 0.5) nrm.copy(up);
        hit = { at: p.clone(), normal: nrm };
        if (c.key) this.cache.set(c.key, hit);
      }
      const normal = hit.normal;
      p.addScaledVector(normal, 0.05);
      tQ.setFromUnitVectors(Y, normal);
      const size = c.size * (1 + c.lift * 0.15);
      tS.set(size, 1, size);
      tM.compose(p, tQ, tS);
      m.setMatrixAt(n, tM);
      m.instanceColor.setXYZ(n, Math.max(0, fade) * (c.strength ?? 0.55), 0, 0);
      n++;
    }
    m.count = n;
    m.instanceMatrix.needsUpdate = true;
    m.instanceColor.needsUpdate = true;
  }
}
