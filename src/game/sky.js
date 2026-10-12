import * as THREE from 'three';
import { NOISE_GLSL } from './glsl.js';
import { mulberry32, hashString } from './rng.js';
import { galaxyTexture } from './textures.js';
import { GALAXIES } from './data.js';

// Procedural nebula sky dome, a twinkling starfield and distant galaxies.
// The whole group follows the camera so it always reads as infinitely far.
export class Sky {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.renderOrder = -10;
    scene.add(this.group);

    this.uniforms = {
      colA: { value: new THREE.Color() },
      colB: { value: new THREE.Color() },
      colC: { value: new THREE.Color() },
      seed: { value: 0 },
      bandDir: { value: new THREE.Vector3(0.2, 1, 0.1).normalize() },
    };
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(20000, 64, 32),
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        side: THREE.BackSide,
        depthWrite: false,
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = position;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 colA;
          uniform vec3 colB;
          uniform vec3 colC;
          uniform float seed;
          uniform vec3 bandDir;
          varying vec3 vDir;
          ${NOISE_GLSL}
          void main() {
            vec3 d = normalize(vDir);
            vec3 p = d * 2.3 + vec3(seed);
            float h = dot(d, bandDir);
            float band = exp(-h * h * 9.0);
            float n = fbm(p);
            float n2 = fbm(p * 2.1 + n * 1.7);
            float neb = smoothstep(0.42, 0.9, n2);
            vec3 col = colC * 0.35;
            col += mix(colA, colB, smoothstep(0.35, 0.7, n)) * neb * (0.18 + 0.82 * band) * 0.55;
            float dust = smoothstep(0.52, 0.72, fbm(p * 3.3 + 7.0));
            col *= 1.0 - 0.65 * dust * band;
            col += band * 0.05 * mix(colA, vec3(1.0, 0.9, 0.8), 0.5);
            gl_FragColor = vec4(col, 1.0);
          }`,
      }),
    );
    dome.renderOrder = -10;
    this.group.add(dome);

    // starfield
    const count = 7000;
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const size = new Float32Array(count);
    const phase = new Float32Array(count);
    const r = mulberry32(42);
    const c = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const u = r() * 2 - 1, th = r() * Math.PI * 2, s = Math.sqrt(1 - u * u);
      const R = 16000;
      pos[i * 3] = s * Math.cos(th) * R;
      pos[i * 3 + 1] = u * R;
      pos[i * 3 + 2] = s * Math.sin(th) * R;
      const t = r();
      c.setHSL(t < 0.6 ? 0.6 : t < 0.85 ? 0.12 : 0.02, 0.5 + r() * 0.4, 0.75 + r() * 0.25);
      const bright = r() < 0.04 ? 2.2 : 0.6 + r() * 0.8;
      col[i * 3] = c.r * bright; col[i * 3 + 1] = c.g * bright; col[i * 3 + 2] = c.b * bright;
      size[i] = r() < 0.03 ? 3.5 + r() * 2.5 : 1 + r() * 1.6;
      phase[i] = r() * 100;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(size, 1));
    geo.setAttribute('phase', new THREE.BufferAttribute(phase, 1));
    this.starUniforms = { time: { value: 0 }, pixelRatio: { value: 1 } };
    const stars = new THREE.Points(geo, new THREE.ShaderMaterial({
      uniforms: this.starUniforms,
      depthWrite: false,
      transparent: true,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        attribute vec3 color;
        attribute float size;
        attribute float phase;
        uniform float time;
        uniform float pixelRatio;
        varying vec3 vColor;
        void main() {
          vColor = color * (0.75 + 0.25 * sin(time * 1.7 + phase));
          gl_PointSize = size * pixelRatio;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.05, d);
          gl_FragColor = vec4(vColor * a, 1.0);
        }`,
    }));
    stars.renderOrder = -9;
    stars.frustumCulled = false;
    this.group.add(stars);

    this.galaxySprites = [];
  }

  setGalaxy(gIndex) {
    const g = GALAXIES[gIndex];
    this.uniforms.colA.value.set(g.sky[0]).convertSRGBToLinear();
    this.uniforms.colB.value.set(g.sky[1]).convertSRGBToLinear();
    this.uniforms.colC.value.set(g.sky[2]).convertSRGBToLinear();
    this.uniforms.seed.value = (hashString(g.id) % 1000) / 37;
    const r = mulberry32(hashString(`sky:${g.id}`));
    this.uniforms.bandDir.value.set(r() - 0.5, 1, r() - 0.5).normalize();

    for (const s of this.galaxySprites) {
      this.group.remove(s);
      s.material.map.dispose();
      s.material.dispose();
    }
    this.galaxySprites = [];
    // the other galaxies hang in the sky as distant spirals
    GALAXIES.forEach((other, i) => {
      if (i === gIndex) return;
      const tex = galaxyTexture(other.sky[0], hashString(other.id));
      const mat = new THREE.SpriteMaterial({ map: tex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.9 });
      const sp = new THREE.Sprite(mat);
      const u = r() * 1.4 - 0.7, th = r() * Math.PI * 2, s = Math.sqrt(1 - u * u);
      sp.position.set(s * Math.cos(th), u, s * Math.sin(th)).multiplyScalar(15000);
      sp.scale.setScalar(1200 + r() * 900);
      mat.rotation = r() * Math.PI;
      sp.renderOrder = -8;
      this.group.add(sp);
      this.galaxySprites.push(sp);
    });
  }

  update(camera, t, pixelRatio) {
    this.group.position.copy(camera.position);
    this.starUniforms.time.value = t;
    this.starUniforms.pixelRatio.value = pixelRatio;
  }
}
