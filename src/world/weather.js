import * as THREE from 'three';

// Weather on worlds with air: clear spells, overcast, rain and thunderstorms on green
// worlds, acid rain on toxic ones, snow and blizzards on ice, dust storms on deserts,
// ash falls on lava worlds.
//
// The forecast runs on the real clock (not a save's world time), seeded by the planet,
// so every player standing on the same world shares the same sky.
//
// Precipitation is one draw call: a box of particles around the camera, laid out in the
// local horizon frame and scrolled on the CPU (in double precision) as you move and as it
// falls, then wrapped in the shader, so the drops stay put in the world and the box never
// shows its edges.

const SLOT_MS = 7 * 60 * 1000;   // each spell of weather lasts about seven minutes
const BLEND_MS = 50 * 1000;      // and turns into the next over most of a minute
const BOX = 44;                  // metres of falling particles around the camera
const COUNT = 9000;

const KINDS = {
  rain: { fall: 9.5, len: 0.85, width: 0.018, size: 0, color: [0.72, 0.78, 0.86], alpha: 0.32, wind: 1.2 },
  acid: { fall: 8.5, len: 0.75, width: 0.02, size: 0, color: [0.62, 0.86, 0.36], alpha: 0.32, wind: 1.0 },
  snow: { fall: 1.3, len: 0, width: 0, size: 0.07, color: [0.95, 0.97, 1.0], alpha: 0.85, wind: 1.6 },
  dust: { fall: 0.4, len: 0, width: 0, size: 0.45, color: [0.78, 0.6, 0.4], alpha: 0.16, wind: 13 },
  ash: { fall: 0.9, len: 0, width: 0, size: 0.06, color: [0.28, 0.26, 0.25], alpha: 0.9, wind: 2.2 },
};

const hash = (a, b) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };

// What the sky is doing over one spell. kind is the precipitation, if any.
function spell(body, slot) {
  const h = hash(body.seed % 9973, slot), h2 = hash(slot, body.seed % 7919);
  const t = body.type;
  if (t === 'terran') {
    if (h < 0.42) return { kind: null, precip: 0, cover: 0.1 + h2 * 0.25, storm: 0 };
    if (h < 0.62) return { kind: null, precip: 0, cover: 0.75 + h2 * 0.2, storm: 0 };
    if (h < 0.88) return { kind: 'rain', precip: 0.45 + h2 * 0.4, cover: 0.9, storm: 0 };
    return { kind: 'rain', precip: 1, cover: 1, storm: 1 };
  }
  if (t === 'toxic') {
    if (h < 0.45) return { kind: null, precip: 0, cover: 0.5 + h2 * 0.3, storm: 0 };
    return { kind: 'acid', precip: 0.5 + h2 * 0.5, cover: 0.95, storm: h > 0.88 ? 1 : 0 };
  }
  if (t === 'ice') {
    if (h < 0.4) return { kind: null, precip: 0, cover: 0.2 + h2 * 0.4, storm: 0 };
    if (h < 0.85) return { kind: 'snow', precip: 0.4 + h2 * 0.5, cover: 0.85, storm: 0 };
    return { kind: 'snow', precip: 1, cover: 1, storm: 0, blizzard: 1 };
  }
  if (t === 'desert') {
    if (h < 0.7) return { kind: null, precip: 0, cover: h2 * 0.15, storm: 0 };
    return { kind: 'dust', precip: 0.55 + h2 * 0.45, cover: 0.3, storm: 0 };
  }
  if (t === 'lava') {
    if (h < 0.6) return { kind: null, precip: 0, cover: 0.3, storm: 0 };
    return { kind: 'ash', precip: 0.5 + h2 * 0.5, cover: 0.7, storm: 0 };
  }
  return { kind: null, precip: 0, cover: 0.2, storm: 0 };
}

// The weather on a world right now, blended between spells.
// a fixed spell for testing (e.g. { kind: 'rain', precip: 1, cover: 1, storm: 1 }); null follows the clock
let forced = null;
export function forceWeather(w) { forced = w; }

export function weatherAt(body, now = Date.now()) {
  if (!body || !body.atmo || !body.landable) return { kind: null, precip: 0, cover: 0, storm: 0, blizzard: 0, label: 'CLEAR' };
  const slot = Math.floor(now / SLOT_MS);
  const into = now - slot * SLOT_MS;
  const a = spell(body, slot);
  const k = into > SLOT_MS - BLEND_MS ? THREE.MathUtils.smoothstep(into, SLOT_MS - BLEND_MS, SLOT_MS) : 0;
  const b = k > 0 ? spell(body, slot + 1) : a;
  const L = (x, y) => x + (y - x) * k;
  // the precipitation type changes only once the old one has stopped
  if (forced) { a.kind = b.kind = forced.kind ?? null; Object.assign(a, forced); Object.assign(b, forced); }
  const kind = k < 0.5 ? a.kind || b.kind : b.kind || a.kind;
  const precip = (a.kind === kind ? a.precip : 0) * (1 - k) + (b.kind === kind ? b.precip : 0) * k;
  const w = { kind: precip > 0.01 ? kind : null, precip, cover: L(a.cover, b.cover), storm: L(a.storm, b.storm), blizzard: L(a.blizzard || 0, b.blizzard || 0) };
  w.label = w.storm > 0.5 ? 'THUNDERSTORM' : w.blizzard > 0.5 ? 'BLIZZARD' : w.kind === 'rain' ? (w.precip > 0.7 ? 'HEAVY RAIN' : 'RAIN')
    : w.kind === 'acid' ? 'ACID RAIN' : w.kind === 'snow' ? 'SNOW' : w.kind === 'dust' ? 'DUST STORM' : w.kind === 'ash' ? 'ASHFALL'
      : w.cover > 0.7 ? 'OVERCAST' : w.cover > 0.4 ? 'CLOUDY' : 'CLEAR';
  return w;
}

// How wet surfaces are, shared by the terrain, props and city materials, and which way is
// up in view space (the planet is round; across one view the camera's own up is close enough).
export const wetness = { value: 0 };
export const wetUpView = { value: new THREE.Vector3(0, 1, 0) };

export class Weather {
  constructor(root) {
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    const pos = new Float32Array(COUNT * 4 * 3), corner = new Float32Array(COUNT * 4 * 2), seed = new Float32Array(COUNT * 4);
    const idx = new Uint32Array(COUNT * 6);
    for (let i = 0; i < COUNT; i++) {
      const x = Math.random() * BOX, y = Math.random() * BOX, z = Math.random() * BOX, s = Math.random();
      for (let c = 0; c < 4; c++) {
        const v = i * 4 + c;
        pos.set([x, y, z], v * 3);
        corner.set(corners[c], v * 2);
        seed[v] = s;
      }
      idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('corner', new THREE.BufferAttribute(corner, 2));
    geo.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    this.uniforms = {
      uScroll: { value: new THREE.Vector3() },
      uVel: { value: new THREE.Vector3(0, -9, 0) },
      uLen: { value: 0.8 },
      uWidth: { value: 0.02 },
      uSize: { value: 0 },
      uColor: { value: new THREE.Color() },
      uAlpha: { value: 0 },
      uTime: { value: 0 },
      uBox: { value: BOX },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        attribute vec2 corner;
        attribute float seed;
        uniform vec3 uScroll, uVel;
        uniform float uLen, uWidth, uSize, uTime, uBox;
        varying vec2 vC;
        varying float vFade;
        #include <common>
        #include <logdepthbuf_pars_vertex>
        void main() {
          // the camera sits at this mesh's origin; wrap each particle into the box around it
          vec3 p = mod(position + uScroll + vec3(sin(uTime * 0.7 + seed * 40.0), 0.0, cos(uTime * 0.6 + seed * 31.0)) * uSize * 6.0, uBox) - 0.5 * uBox;
          vec3 toCam = normalize(-p + 1e-4);
          vec3 off;
          if (uLen > 0.0) {
            // a streak along the fall, turned to face the camera
            vec3 axis = normalize(uVel);
            vec3 side = normalize(cross(axis, toCam));
            off = side * corner.x * uWidth + axis * corner.y * uLen * (0.7 + seed * 0.6);
          } else {
            // a flake facing the camera
            vec3 side = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));
            vec3 up = cross(toCam, side);
            off = (side * corner.x + up * corner.y) * uSize * (0.6 + seed * 0.8);
          }
          float d = length(p);
          // flakes right at the lens would be blobs: they fade out further from the camera than streaks
          vFade = (uLen > 0.0 ? smoothstep(0.6, 2.5, d) : smoothstep(2.5, 6.0, d)) * (1.0 - smoothstep(uBox * 0.3, uBox * 0.5, d));
          vC = corner;
          vec4 mv = modelViewMatrix * vec4(p + off, 1.0);
          gl_Position = projectionMatrix * mv;
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uAlpha, uLen;
        varying vec2 vC;
        varying float vFade;
        #include <logdepthbuf_pars_fragment>
        void main() {
          #include <logdepthbuf_fragment>
          float a = uLen > 0.0 ? (1.0 - abs(vC.x)) * (1.0 - vC.y * vC.y) : max(0.0, 1.0 - dot(vC, vC));
          gl_FragColor = vec4(uColor, a * uAlpha * vFade);
        }`,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = 5;
    root.add(this.mesh);
    this.scroll = new THREE.Vector3();
    this.lastCam = null;
    this.basis = new THREE.Matrix4();
    this.state = weatherAt(null);
    this.lightningT = 8;
  }

  // frame: the world you're on (or null); cam: camera position in the local frame
  update(dt, time, frame, cam, { hidden = false, fog } = {}) {
    const w = (this.state = weatherAt(frame && frame.body));
    const kind = w.kind && KINDS[w.kind];
    // wetness soaks in while it rains and dries slowly after
    const wetTarget = w.kind === 'rain' || w.kind === 'acid' ? Math.min(1, w.precip * 1.3) : 0;
    wetness.value += (wetTarget - wetness.value) * Math.min(1, dt * (wetTarget > wetness.value ? 0.08 : 0.02));
    const show = !!kind && !hidden && frame && frame.terrain;
    this.mesh.visible = show;
    if (!show) { this.lastCam = null; return w; }
    // a horizon frame at the camera: y is up
    const up = cam.clone().normalize();
    const ref = Math.abs(up.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const ex = new THREE.Vector3().crossVectors(ref, up).normalize();
    const ez = new THREE.Vector3().crossVectors(ex, up);
    this.basis.makeBasis(ex, up, ez);
    this.mesh.position.copy(cam);
    this.mesh.quaternion.setFromRotationMatrix(this.basis);
    // scroll by the camera's own movement (so drops stay put in the world) and by their fall
    const u = this.uniforms;
    const gust = 1 + 0.5 * Math.sin(time * 0.37) + 0.3 * Math.sin(time * 1.3);
    const windMul = w.blizzard ? 6 : 1;
    const vel = new THREE.Vector3(kind.wind * gust * windMul, -kind.fall * (w.blizzard ? 2.5 : 1), kind.wind * 0.4 * gust * windMul);
    if (this.lastCam) {
      const d = cam.clone().sub(this.lastCam);
      if (d.length() < 50) this.scroll.sub(new THREE.Vector3(d.dot(ex), d.dot(up), d.dot(ez)));
    }
    this.lastCam = cam.clone();
    this.scroll.addScaledVector(vel, dt);
    this.scroll.set(((this.scroll.x % BOX) + BOX) % BOX, ((this.scroll.y % BOX) + BOX) % BOX, ((this.scroll.z % BOX) + BOX) % BOX);
    u.uScroll.value.copy(this.scroll);
    u.uVel.value.copy(vel);
    u.uLen.value = kind.len;
    u.uWidth.value = kind.width;
    u.uSize.value = kind.size;
    u.uTime.value = time;
    // lit like the air around it: take the fog's colour, never fully dark
    u.uColor.value.setRGB(...kind.color);
    if (fog) u.uColor.value.multiply(new THREE.Color(0.35, 0.35, 0.35).add(fog.clone().multiplyScalar(2.2))).multiplyScalar(0.8);
    u.uAlpha.value = kind.alpha * Math.min(1, w.precip * 1.15);
    this.mesh.geometry.setDrawRange(0, Math.floor(COUNT * Math.min(1, 0.2 + w.precip * 0.8)) * 6);
    return w;
  }

  // a lightning strike is due (thunderstorms only)
  strike(dt) {
    if (this.state.storm < 0.5 || !this.mesh.visible) return false;
    this.lightningT -= dt;
    if (this.lightningT > 0) return false;
    this.lightningT = 5 + Math.random() * 14;
    return true;
  }
}

// Let a standard material get wet: darker, and glossy where it faces the sky. Chains onto
// any shader patch the material already has.
export function addWetness(mat, { gloss = 0.16, darken = 0.3, key = '' } = {}) {
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey;
  mat.onBeforeCompile = (shader, renderer) => {
    if (prev) prev.call(mat, shader, renderer);
    shader.uniforms.uWet = wetness;
    shader.uniforms.uWetUp = wetUpView;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uWetUp;\nvarying float vWetUp;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWetUp = dot(normalize(transformedNormal), uWetUp);');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uWet;\nvarying float vWetUp;')
      .replace('#include <color_fragment>', `#include <color_fragment>\ndiffuseColor.rgb *= 1.0 - ${darken.toFixed(2)} * uWet;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, ${gloss.toFixed(2)}, uWet * smoothstep(0.2, 0.8, vWetUp));`);
  };
  mat.customProgramCacheKey = () => `${prevKey ? prevKey.call(mat) : ''}|wet${key}`;
  return mat;
}
