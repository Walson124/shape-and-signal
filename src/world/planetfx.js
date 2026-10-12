import * as THREE from 'three';
import { NOISE_GLSL } from '../core/glsl.js';
import { withLogDepth } from '../core/logdepth.js';

// ------------------------------------------------------------ atmosphere --
// Single-scattering Rayleigh + Mie, evaluated in view space so precision holds
// whether the camera is on the ground or a million kilometres away.
export function makeAtmosphere(body) {
  const R = body.radius;
  const height = body.atmo.height;
  const AR = R * (1 + height);
  const c = body.atmo.color;
  const m = Math.max(...c);
  const uniforms = {
    uPlanetView: { value: new THREE.Vector3() },
    uSunDir: { value: new THREE.Vector3(1, 0, 0) },
    uR: { value: R },
    uAR: { value: AR / R },
    uBetaR: { value: new THREE.Vector3((c[0] / m) * 0.75, (c[1] / m) * 1.7, (c[2] / m) * 4.0) },
    uBetaM: { value: body.type === 'gas' ? 1.2 : 1.6 },
    uHR: { value: height * 0.24 },
    uHM: { value: height * 0.06 },
    uSunI: { value: 70 },
  };
  const mat = withLogDepth(new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.ZeroFactor,
    blendDstAlpha: THREE.OneFactor,
    vertexShader: /* glsl */ `
      varying vec3 vView;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vView = mv.xyz;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uPlanetView;
      uniform vec3 uSunDir;
      uniform float uR;
      uniform float uAR;
      uniform vec3 uBetaR;
      uniform float uBetaM;
      uniform float uHR;
      uniform float uHM;
      uniform float uSunI;
      varying vec3 vView;
      vec2 raySphere(vec3 o, vec3 d, float r) {
        float b = dot(o, d);
        float c = dot(o, o) - r * r;
        float h = b * b - c;
        if (h < 0.0) return vec2(1e9, -1e9);
        h = sqrt(h);
        return vec2(-b - h, -b + h);
      }
      void main() {
        vec3 rd = normalize(vView);
        vec3 ro = -uPlanetView / uR;
        vec2 ta = raySphere(ro, rd, uAR);
        if (ta.x > ta.y || ta.y < 0.0) discard;
        float t0 = max(ta.x, 0.0);
        float t1 = ta.y;
        vec2 tp = raySphere(ro, rd, 0.997);
        if (tp.x < tp.y && tp.x > 0.0) t1 = min(t1, tp.x);
        const int STEPS = 12;
        const int LSTEPS = 4;
        float dt = (t1 - t0) / float(STEPS);
        float odR = 0.0, odM = 0.0;
        vec3 sumR = vec3(0.0), sumM = vec3(0.0);
        vec3 L = normalize(uSunDir);
        for (int i = 0; i < STEPS; i++) {
          vec3 p = ro + rd * (t0 + dt * (float(i) + 0.5));
          float h = max(length(p) - 1.0, 0.0);
          float dR = exp(-h / uHR) * dt;
          float dM = exp(-h / uHM) * dt;
          odR += dR;
          odM += dM;
          vec2 sp = raySphere(p, L, 0.997);
          if (sp.x < sp.y && sp.x > 0.0) continue;
          vec2 tl = raySphere(p, L, uAR);
          float dl = tl.y / float(LSTEPS);
          float lR = 0.0, lM = 0.0;
          for (int j = 0; j < LSTEPS; j++) {
            vec3 q = p + L * dl * (float(j) + 0.5);
            float hq = max(length(q) - 1.0, 0.0);
            lR += exp(-hq / uHR) * dl;
            lM += exp(-hq / uHM) * dl;
          }
          vec3 tau = uBetaR * (odR + lR) + uBetaM * 1.1 * (odM + lM);
          vec3 att = exp(-tau);
          sumR += dR * att;
          sumM += dM * att;
        }
        float mu = dot(rd, L);
        float pR = 0.0596831 * (1.0 + mu * mu);
        float g = 0.76;
        float pM = 0.1193662 * ((1.0 - g * g) * (1.0 + mu * mu)) / ((2.0 + g * g) * pow(max(1.0 + g * g - 2.0 * g * mu, 1e-4), 1.5));
        // full strength from the ground, softer from high up so the surface reads from orbit
        float camAlt = clamp((length(ro) - 1.0) / (uAR - 1.0), 0.0, 1.0);
        vec3 col = uSunI * mix(1.0, 0.3, camAlt) * (sumR * uBetaR * pR + sumM * uBetaM * pM);
        vec3 trans = exp(-(uBetaR * odR + uBetaM * 1.1 * odM));
        float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
        // a bright sky hides the stars behind it
        float inside = step(length(ro), uAR);
        float sky = (tp.x < tp.y && tp.x > 0.0) ? 0.0 : 1.0;
        float alpha = clamp(max(1.0 - (trans.r + trans.g + trans.b) / 3.0, inside * sky * smoothstep(0.0, 0.35, lum)), 0.0, 1.0);
        gl_FragColor = vec4(max(col, vec3(0.0)), alpha);
      }`,
  }));
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(AR, 96, 48), mat);
  mesh.renderOrder = 2;
  mesh.frustumCulled = false;
  return { mesh, uniforms, radius: AR, mat };
}

// ------------------------------------------------------------------ ocean --
export function makeOcean(body) {
  const R = body.radius + body.sea;
  const time = { value: 0 };
  let mat;
  if (body.ocean.lava) {
    mat = new THREE.MeshStandardMaterial({ color: 0x2a0a02, emissive: 0xff4a10, emissiveIntensity: 1.6, roughness: 0.6 });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = time;
      shader.vertexShader = `varying vec3 vObj;\n${shader.vertexShader}`.replace('#include <begin_vertex>', '#include <begin_vertex>\nvObj = position;');
      shader.fragmentShader = `uniform float uTime;\nvarying vec3 vObj;\n${NOISE_GLSL}\n${shader.fragmentShader}`.replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        float lv = fbm(vObj * 0.01 + vec3(uTime * 0.02, 0.0, uTime * 0.015));
        totalEmissiveRadiance *= 0.25 + 1.4 * smoothstep(0.35, 0.8, lv);`,
      );
    };
  } else {
    mat = new THREE.MeshStandardMaterial({ color: body.ocean.color, roughness: 0.08, metalness: 0.05, transparent: true, opacity: 0.86, envMapIntensity: 0.7 });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = time;
      shader.vertexShader = `varying vec3 vObj;\n${shader.vertexShader}`.replace('#include <begin_vertex>', '#include <begin_vertex>\nvObj = position;');
      shader.fragmentShader = `uniform float uTime;\nvarying vec3 vObj;\n${NOISE_GLSL}\n${shader.fragmentShader}`.replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        vec3 wp = vObj * 0.08;
        float w1 = vnoise(wp + vec3(uTime * 0.6, 0.0, uTime * 0.4));
        float w2 = vnoise(wp * 2.7 - vec3(uTime * 0.5, uTime * 0.3, 0.0));
        vec3 tx = normalize(cross(normal, vec3(0.0, 1.0, 0.0)) + 1e-4);
        vec3 ty = cross(normal, tx);
        normal = normalize(normal + (w1 - 0.5) * 0.18 * tx + (w2 - 0.5) * 0.18 * ty);`,
      );
    };
    mat.customProgramCacheKey = () => 'ocean-water';
  }
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(R, 320, 160), mat);
  mesh.renderOrder = 1;
  return { mesh, time };
}

// ----------------------------------------------------------------- clouds --
export function makeClouds(body) {
  const R = body.radius + body.amp * 1.25;
  const uniforms = {
    uTime: { value: 0 },
    uSunDir: { value: new THREE.Vector3(1, 0, 0) },
    uColor: { value: new THREE.Color(body.type === 'toxic' ? 0xdaf0a0 : body.type === 'ice' ? 0xe8f4ff : 0xffffff) },
    uCover: { value: body.type === 'toxic' ? 0.42 : 0.5 },
    uSeed: { value: (body.seed % 1000) / 37 },
  };
  const mat = withLogDepth(new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      varying vec3 vObj;
      varying vec3 vN;
      void main() {
        vObj = position;
        vN = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uSunDir;
      uniform vec3 uColor;
      uniform float uCover;
      uniform float uSeed;
      varying vec3 vObj;
      varying vec3 vN;
      ${NOISE_GLSL}
      void main() {
        vec3 p = normalize(vObj);
        float n = fbm(p * 3.5 + vec3(uSeed + uTime * 0.003, 0.0, 0.0));
        float n2 = fbm(p * 14.0 + vec3(0.0, uSeed, uTime * 0.005));
        float c = smoothstep(uCover, uCover + 0.22, n * 0.75 + n2 * 0.35);
        float lit = clamp(dot(normalize(vN), normalize(uSunDir)) * 0.9 + 0.25, 0.04, 1.0);
        gl_FragColor = vec4(uColor * lit, c * 0.88);
      }`,
  }));
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(R, 128, 64), mat);
  mesh.renderOrder = 3;
  return { mesh, uniforms };
}

// ------------------------------------------------------------------ rings --
export function makeRings(body, ringData) {
  const { inner, outer, tilt } = body.rings;
  const geo = new THREE.RingGeometry(inner, outer, 256, 1);
  const pos = geo.attributes.position, uv = geo.attributes.uv;
  for (let k = 0; k < pos.count; k++) {
    const d = Math.hypot(pos.getX(k), pos.getY(k));
    uv.setXY(k, (d - inner) / (outer - inner), 0.5);
  }
  const tex = new THREE.DataTexture(ringData.data, ringData.w, ringData.h, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, transparent: true, depthWrite: false, roughness: 1, envMapIntensity: 0.2 }));
  mesh.rotation.x = -Math.PI / 2 + tilt;
  return { mesh, tex };
}
