import * as THREE from 'three';
import { NOISE_GLSL } from '../core/glsl.js';
import { mulberry32, hashString } from '../core/rng.js';
import { galaxyTexture, spikeTexture } from './textures.js';
import { REGIONS, STAR_TYPES } from '../game/data.js';
import { starsNear, coreDirection } from './galaxy.js';

// Bakes the galaxy's sky (domain-warped nebulae, three star layers, distant
// galaxies) into a cubemap once, then derives a PMREM environment from it so
// metal surfaces reflect the actual sky.
export class SkyBaker {
  constructor(renderer) {
    this.renderer = renderer;
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.current = null;
  }

  // Bake the sky as seen from `galPos` (light years): region nebulae, the
  // galactic band, the core glow and every real star within 160 ly.
  bake(regionIndex, galPos, size) {
    const g = REGIONS[regionIndex];
    const r = mulberry32(hashString(`sky:${g.id}:${Math.round(galPos.x)},${Math.round(galPos.y)},${Math.round(galPos.z)}`));
    const scene = new THREE.Scene();
    const disposables = [];
    const track = (o) => { disposables.push(o); return o; };

    const band = new THREE.Vector3(0, 1, 0);
    const core = coreDirection(galPos);
    const lin = (hex) => new THREE.Color(hex).convertSRGBToLinear();
    const skyMat = track(new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        colA: { value: lin(g.sky[0]) },
        colB: { value: lin(g.sky[1]) },
        colC: { value: lin(g.sky[2]) },
        colD: { value: lin(g.sky[3]) },
        seed: { value: (hashString(g.id) % 1000) / 37 },
        bandDir: { value: band },
        coreDir: { value: core },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform vec3 colA;
        uniform vec3 colB;
        uniform vec3 colC;
        uniform vec3 colD;
        uniform float seed;
        uniform vec3 bandDir;
        uniform vec3 coreDir;
        varying vec3 vDir;
        ${NOISE_GLSL}
        void main() {
          vec3 d = normalize(vDir);
          vec3 p = d * 1.7 + vec3(seed);
          vec3 q = vec3(fbm(p), fbm(p + vec3(5.2, 1.3, 2.8)), fbm(p + vec3(1.7, 9.2, 4.1)));
          float n = fbm7(p + 2.2 * q);
          float h = dot(d, bandDir);
          float band = exp(-h * h * 10.0);
          float bandWide = exp(-h * h * 2.5);
          float coreGlow = pow(clamp(dot(d, coreDir), 0.0, 1.0), 10.0) * band;
          vec3 neb = mix(colA, colB, clamp(q.x * 1.8 - 0.4, 0.0, 1.0));
          neb = mix(neb, colD, clamp(q.z * 2.2 - 1.35, 0.0, 1.0) * 0.6);
          float density = smoothstep(0.38, 0.92, n) * (0.15 + 0.85 * bandWide);
          vec3 col = colC * 0.18;
          col += neb * density * 0.85;
          float fil = pow(clamp(1.0 - abs(fbm(p * 3.6 + q * 3.0) * 2.0 - 1.0), 0.0, 1.0), 7.0);
          col += neb * fil * bandWide * 0.35;
          float dust = smoothstep(0.48, 0.74, fbm7(p * 2.6 + q * 2.0 + 7.0));
          col *= 1.0 - 0.8 * dust * band;
          col += vec3(1.0, 0.92, 0.84) * band * 0.05 * (0.4 + n);
          col += mix(vec3(1.0, 0.86, 0.7), colD, 0.2) * coreGlow * 0.9;
          gl_FragColor = vec4(col, 1.0);
        }`,
    }));
    scene.add(new THREE.Mesh(track(new THREE.SphereGeometry(100, 64, 32)), skyMat));

    const sizeScale = size / 1024;
    const starLayer = (count, minSize, maxSize, bright, bandBias) => {
      const pos = new Float32Array(count * 3);
      const col = new Float32Array(count * 3);
      const sz = new Float32Array(count);
      const c = new THREE.Color();
      const v = new THREE.Vector3();
      for (let i = 0; i < count; i++) {
        // bias stars toward the galactic band
        for (let k = 0; k < 4; k++) {
          const u = r() * 2 - 1, th = r() * Math.PI * 2, s = Math.sqrt(1 - u * u);
          v.set(s * Math.cos(th), u, s * Math.sin(th));
          const hh = v.dot(band);
          if (r() < bandBias * Math.exp(-hh * hh * 6) + (1 - bandBias)) break;
        }
        v.multiplyScalar(90);
        pos.set([v.x, v.y, v.z], i * 3);
        const t = r();
        c.setHSL(t < 0.55 ? 0.6 : t < 0.85 ? 0.11 : 0.02, 0.35 + r() * 0.5, 0.72 + r() * 0.28);
        const b = bright * (0.4 + r() * 0.8);
        col.set([c.r * b, c.g * b, c.b * b], i * 3);
        sz[i] = (minSize + r() * (maxSize - minSize)) * sizeScale;
      }
      const geo = track(new THREE.BufferGeometry());
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      geo.setAttribute('size', new THREE.BufferAttribute(sz, 1));
      const mat = track(new THREE.ShaderMaterial({
        depthWrite: false,
        transparent: true,
        blending: THREE.AdditiveBlending,
        vertexShader: /* glsl */ `
          attribute vec3 color;
          attribute float size;
          varying vec3 vColor;
          void main() { vColor = color; gl_PointSize = size; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */ `
          varying vec3 vColor;
          void main() {
            float d = length(gl_PointCoord - 0.5);
            float a = smoothstep(0.5, 0.0, d);
            gl_FragColor = vec4(vColor * a * a, 1.0);
          }`,
      }));
      scene.add(new THREE.Points(geo, mat));
    };
    starLayer(18000, 1.0, 2.0, 0.45, 0.7);
    starLayer(2500, 1.8, 3.0, 0.8, 0.5);

    // bright stars with diffraction spikes
    const spike = spikeTexture();
    const near = starsNear(galPos, 160);
    const starMats = new Map();
    for (const { star, dist } of near) {
      const st = STAR_TYPES[star.cls];
      const bright = Math.min(3, (st.lum * 260) / (dist * dist + 30));
      let m = starMats.get(star.cls);
      if (!m) {
        m = track(new THREE.SpriteMaterial({ map: spike, color: new THREE.Color(st.glow).lerp(new THREE.Color(0xffffff), 0.45).multiplyScalar(1.5), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
        starMats.set(star.cls, m);
      }
      const sp = new THREE.Sprite(m);
      sp.position.copy(star.pos).sub(galPos).normalize().multiplyScalar(85);
      sp.scale.setScalar(0.6 + Math.sqrt(bright) * 2.4);
      scene.add(sp);
    }

    REGIONS.forEach((other, i) => {
      if (i === regionIndex) return;
      const tex = track(galaxyTexture(other.sky[0], hashString(other.id)));
      const m = track(new THREE.SpriteMaterial({ map: tex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.85 }));
      const sp = new THREE.Sprite(m);
      const u = r() * 1.4 - 0.7, th = r() * Math.PI * 2, s = Math.sqrt(1 - u * u);
      sp.position.set(s * Math.cos(th), u, s * Math.sin(th)).multiplyScalar(80);
      sp.scale.setScalar(6 + r() * 5);
      m.rotation = r() * Math.PI;
      scene.add(sp);
    });

    const rt = new THREE.WebGLCubeRenderTarget(size, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
    const cam = new THREE.CubeCamera(1, 1000, rt);
    cam.update(this.renderer, scene);
    const envRT = this.pmrem.fromCubemap(rt.texture);
    for (const d of disposables) d.dispose();

    if (this.current) {
      this.current.rt.dispose();
      this.current.envRT.dispose();
    }
    this.current = { rt, envRT, background: rt.texture, env: envRT.texture };
    return this.current;
  }
}
