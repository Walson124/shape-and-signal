import * as THREE from 'three';
import { NOISE_GLSL } from '../core/glsl.js';
import { mulberry32, range, pick, clamp } from '../core/rng.js';
import { GALAXIES, STAR_TYPES, GALAXY_PLANETS, ROMAN } from '../game/data.js';
import { glowTexture, puffTexture, softDotTexture } from './textures.js';
import { texPool } from './texpool.js';
import { buildStation, buildGate } from './models.js';

const tmpV = new THREE.Vector3();
const tmpM = new THREE.Matrix3();

function dataTexture(data, w, h, srgb) {
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

// A star system: star, planets, belts, energy nebulae, station, gate. Built
// asynchronously (planet textures come from workers), then attached.
export class StarSystem {
  constructor(scene, def, preset) {
    this.scene = scene;
    this.def = def;
    this.preset = preset;
    this.galaxy = GALAXIES[def.galaxy];
    this.rand = mulberry32(def.seed);
    this.group = new THREE.Group();
    this.textures = [];
    this.planets = [];
    this.hotspots = [];
    this.colliders = [];
    this.spawnPoints = [];
    this.time = 0;
  }

  static async create(scene, def, preset, onProgress) {
    const s = new StarSystem(scene, def, preset);
    await s.build(onProgress);
    return s;
  }

  async build(onProgress = () => {}) {
    const r = this.rand;
    this.entryAngle = r() * Math.PI * 2;
    this.buildStar();
    const planetDefs = this.planPlanets();
    let done = 0;
    const total = planetDefs.length + 1;
    onProgress(0, total);
    const results = await Promise.all(planetDefs.map(async (pd) => {
      const tex = await texPool.run('planet', { type: pd.type, seed: pd.seed, w: this.preset.texRes });
      let ring = null;
      if (pd.ring) ring = await texPool.run('ring', { stops: tex.ringColors, seed: pd.seed + 3 });
      onProgress(++done, total);
      return { pd, tex, ring };
    }));
    for (const res of results) this.buildPlanet(res);
    this.outerOrbit = planetDefs.length ? planetDefs[planetDefs.length - 1].orbit : 2000;
    this.buildBelt();
    this.buildHotspots();

    const R = this.starRadius;
    const ea = this.entryAngle;
    this.entryPoint = new THREE.Vector3(Math.cos(ea) * (R + 1500), 70, Math.sin(ea) * (R + 1500));
    if (this.def.station) {
      const pos = this.entryPoint.clone().add(new THREE.Vector3(Math.cos(ea + 1.2) * 320, -20, Math.sin(ea + 1.2) * 320));
      const name = this.def.galaxy === 0 ? 'Martial Hall' : `${this.def.name} Exchange`;
      const st = buildStation(name, 0x3ef2ff);
      st.group.position.copy(pos);
      const sa = Math.atan2(pos.z, pos.x);
      st.group.lookAt(pos.x - Math.sin(sa) * 100, pos.y, pos.z + Math.cos(sa) * 100);
      this.group.add(st.group);
      st.group.updateMatrixWorld(true);
      const spawn = st.group.localToWorld(new THREE.Vector3(0, -55, 240));
      const look = st.group.localToWorld(new THREE.Vector3(0, -70, 0));
      this.station = { ...st, pos, name, spawn, look };
      for (let k = -2; k <= 2; k++) {
        this.colliders.push({ kind: 'station', pos: pos.clone().add(new THREE.Vector3(0, k * 30, 0)), radius: 14 });
      }
      this.colliders.push({ kind: 'station', pos: pos.clone().add(new THREE.Vector3(0, -86, 0)), radius: 24 });
    }
    if (this.def.gate) {
      const ga = ea - 0.9;
      const pos = new THREE.Vector3(Math.cos(ga) * (R + 2100), 260, Math.sin(ga) * (R + 2100));
      const gate = buildGate(this.galaxy.sky[0], this.galaxy.sky[3]);
      gate.group.position.copy(pos);
      gate.group.lookAt(0, pos.y, 0);
      this.group.add(gate.group);
      this.gate = { ...gate, pos, name: 'Universe Gate' };
    }
    const ba = ea + Math.PI;
    this.bossPoint = new THREE.Vector3(Math.cos(ba) * (R + 2300), 40, Math.sin(ba) * (R + 2300));
    this.buildSpawnPoints();
    onProgress(total, total);
  }

  attach() {
    this.scene.add(this.group);
  }

  // ---------------------------------------------------------------- star --
  buildStar() {
    const r = this.rand;
    const st = STAR_TYPES[this.def.starType];
    const R = range(r, st.r[0], st.r[1]);
    this.starRadius = R;
    this.starType = st;
    this.starUniforms = { time: { value: 0 }, core: { value: new THREE.Color(st.core) }, edge: { value: new THREE.Color(st.edge) } };
    const star = new THREE.Mesh(new THREE.SphereGeometry(R, 96, 48), new THREE.ShaderMaterial({
      uniforms: this.starUniforms,
      vertexShader: /* glsl */ `
        varying vec3 vPos;
        varying vec3 vNormal;
        varying vec3 vView;
        void main() {
          vPos = normalize(position);
          vNormal = normalize(normalMatrix * normal);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vView = -mv.xyz;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform float time;
        uniform vec3 core;
        uniform vec3 edge;
        varying vec3 vPos;
        varying vec3 vNormal;
        varying vec3 vView;
        ${NOISE_GLSL}
        void main() {
          vec3 p = vPos * 4.0;
          vec3 warp = vec3(fbm(p + time * 0.03), fbm(p + 7.1 - time * 0.02), fbm(p + 3.3));
          float n = fbm(p * 1.6 + warp * 2.0 + time * 0.05);
          float cells = pow(fbm(vPos * 22.0 + warp * 3.0 - time * 0.12), 2.0);
          float heat = n * 0.7 + cells * 0.6;
          vec3 col = mix(edge, core, smoothstep(0.3, 0.85, heat));
          float mu = max(dot(normalize(vNormal), normalize(vView)), 0.0);
          col *= 0.62 + 0.5 * pow(mu, 0.5);
          col += edge * pow(1.0 - mu, 2.5) * 1.8;
          gl_FragColor = vec4(col * 2.2, 1.0);
        }`,
    }));
    this.group.add(star);
    this.star = star;

    this.coronaUniforms = { time: { value: 0 }, color: { value: new THREE.Color(st.glow) } };
    const corona = new THREE.Mesh(new THREE.PlaneGeometry(R * 7, R * 7), new THREE.ShaderMaterial({
      uniforms: this.coronaUniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float time;
        uniform vec3 color;
        varying vec2 vUv;
        ${NOISE_GLSL}
        void main() {
          vec2 p = vUv * 2.0 - 1.0;
          float r = length(p);
          float a = atan(p.y, p.x);
          float inner = 1.0 / 3.5;
          float rays = fbm(vec3(cos(a) * 4.0, sin(a) * 4.0, time * 0.12 - r * 1.5));
          float fine = vnoise(vec3(cos(a) * 30.0, sin(a) * 30.0, time * 0.3));
          float fall = pow(clamp(1.0 - (r - inner) / (1.0 - inner), 0.0, 1.0), 2.6);
          float glow = fall * (0.35 + rays * 1.1 + fine * 0.25);
          glow *= smoothstep(inner * 0.9, inner * 1.05, r);
          gl_FragColor = vec4(color * glow * 0.9, 1.0);
        }`,
    }));
    this.group.add(corona);
    this.corona = corona;

    const glow = new THREE.Color(st.glow);
    const outer = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: glow.clone().multiplyScalar(0.3), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    outer.scale.setScalar(R * 9);
    this.group.add(outer);

    this.sunColor = new THREE.Color(st.core).lerp(new THREE.Color(0xffffff), 0.35);
    const light = new THREE.PointLight(this.sunColor, 2.6, 0, 0);
    this.group.add(light);
    this.colliders.push({ kind: 'star', pos: new THREE.Vector3(), radius: R });
  }

  // ------------------------------------------------------------- planets --
  planPlanets() {
    const r = this.rand;
    const def = this.def;
    const count = 3 + Math.floor(r() * 4);
    let orbit = this.starRadius + 520;
    const types = GALAXY_PLANETS[this.galaxy.id];
    const ruinIndex = def.index > 0 && (def.index % 2 === 0 || def.boss !== null) ? 1 + Math.floor(r() * (count - 1)) : -1;
    const list = [];
    for (let i = 0; i < count; i++) {
      let type = pick(r, types);
      if (def.galaxy === 0 && def.index === 0 && i === 0) type = 'terran';
      const radius = type === 'gas' ? range(r, 95, 160) : range(r, 30, 72);
      orbit += radius + range(r, 280, 500);
      list.push({
        i, type, radius, orbit,
        seed: (def.seed + i * 7919) >>> 0,
        ring: type === 'gas' && r() < 0.6,
        tiltX: range(r, -0.06, 0.06), tiltZ: range(r, -0.06, 0.06),
        phase: r() * Math.PI * 2, axial: range(r, -0.4, 0.4),
        speed: (0.012 + r() * 0.01) * (900 / orbit), spin: 0.015 + r() * 0.04,
        ruin: i === ruinIndex, ringTilt: range(r, -0.35, 0.35),
      });
    }
    return list;
  }

  buildPlanet({ pd, tex, ring }) {
    const def = this.def;
    const { type, radius, orbit } = pd;
    const map = dataTexture(tex.color, tex.w, tex.h, true);
    const surface = dataTexture(tex.surface, tex.w, tex.h, false);
    this.textures.push(map, surface);
    let emissiveMap = null;
    if (tex.emissive) {
      emissiveMap = dataTexture(tex.emissive, tex.w, tex.h, true);
      this.textures.push(emissiveMap);
    }

    const tilt = new THREE.Group();
    tilt.rotation.set(pd.tiltX, 0, pd.tiltZ);
    const pivot = new THREE.Group();
    pivot.rotation.y = pd.phase;
    tilt.add(pivot);
    this.group.add(tilt);

    const sunDirView = { value: new THREE.Vector3(1, 0, 0) };
    const nightOnly = { value: type === 'terran' ? 1 : 0 };
    const mat = new THREE.MeshStandardMaterial({
      map,
      bumpMap: surface,
      bumpScale: type === 'gas' ? 0.6 : type === 'terran' ? 2.5 : 4,
      roughnessMap: surface,
      roughness: 1,
      metalness: 0,
      emissiveMap,
      emissive: emissiveMap ? 0xffffff : 0x000000,
      emissiveIntensity: type === 'lava' ? 2.2 : type === 'crystal' ? 1.6 : 0.9,
      envMapIntensity: 0.12,
    });
    if (emissiveMap) {
      mat.onBeforeCompile = (shader) => {
        shader.uniforms.sunDirView = sunDirView;
        shader.uniforms.nightOnly = nightOnly;
        shader.fragmentShader = `uniform vec3 sunDirView;\nuniform float nightOnly;\n${shader.fragmentShader}`.replace(
          '#include <emissivemap_fragment>',
          `#ifdef USE_EMISSIVEMAP
            vec4 emissiveColor = texture2D( emissiveMap, vEmissiveMapUv );
            float nl = dot(normal, normalize(sunDirView));
            totalEmissiveRadiance *= emissiveColor.rgb * mix(1.0, smoothstep(0.12, -0.3, nl), nightOnly);
          #endif`,
        );
      };
      mat.customProgramCacheKey = () => 'planet-night';
    }
    const seg = this.preset.planetSeg;
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, seg, seg / 2), mat);
    mesh.position.set(orbit, 0, 0);
    mesh.rotation.z = pd.axial;
    pivot.add(mesh);

    const atmoColor = { terran: 0x5aa8ff, toxic: 0xc8ff5a, ice: 0xbfe6ff, gas: 0xffe8c8, lava: 0xff6a2a, crystal: 0xc49aff, rocky: 0x9a9aaa }[type];
    const atmo = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.07, 64, 32), new THREE.ShaderMaterial({
      uniforms: {
        color: { value: new THREE.Color(atmoColor) },
        sunColor: { value: this.sunColor },
        strength: { value: type === 'rocky' ? 0.35 : type === 'gas' ? 0.8 : 1.2 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vN;
        varying vec3 vP;
        void main() {
          vN = normalize(mat3(modelMatrix) * normal);
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vP = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 color;
        uniform vec3 sunColor;
        uniform float strength;
        varying vec3 vN;
        varying vec3 vP;
        void main() {
          vec3 V = normalize(cameraPosition - vP);
          vec3 L = normalize(-vP);
          float fres = pow(1.0 - max(dot(vN, V), 0.0), 2.4);
          float lit = smoothstep(-0.3, 0.55, dot(vN, L));
          float fwd = pow(max(dot(-V, L), 0.0), 8.0);
          float a = fres * (lit + fwd * 2.0) * strength;
          vec3 c = mix(color, sunColor, fwd * 0.6 + 0.1);
          gl_FragColor = vec4(c * a * 1.4, a);
        }`,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    }));
    mesh.add(atmo);

    let clouds = null;
    if (tex.clouds) {
      const cloudMap = dataTexture(tex.clouds, tex.w, tex.h, true);
      this.textures.push(cloudMap);
      clouds = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.035, seg, seg / 2), new THREE.MeshStandardMaterial({ map: cloudMap, transparent: true, depthWrite: false, roughness: 1, envMapIntensity: 0.15 }));
      mesh.add(clouds);
    }
    if (ring) {
      const inner = radius * 1.4, outerR = radius * 2.4;
      const geo = new THREE.RingGeometry(inner, outerR, 160, 1);
      const pos = geo.attributes.position, uv = geo.attributes.uv;
      for (let k = 0; k < pos.count; k++) {
        const d = Math.hypot(pos.getX(k), pos.getY(k));
        uv.setXY(k, (d - inner) / (outerR - inner), 0.5);
      }
      const ringTex = new THREE.DataTexture(ring.data, ring.w, ring.h, THREE.RGBAFormat);
      ringTex.colorSpace = THREE.SRGBColorSpace;
      ringTex.magFilter = THREE.LinearFilter;
      ringTex.minFilter = THREE.LinearMipmapLinearFilter;
      ringTex.generateMipmaps = true;
      ringTex.needsUpdate = true;
      this.textures.push(ringTex);
      const ringMesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: ringTex, side: THREE.DoubleSide, transparent: true, depthWrite: false, roughness: 1, envMapIntensity: 0.2 }));
      ringMesh.rotation.x = -Math.PI / 2 + pd.ringTilt;
      mesh.add(ringMesh);
    }

    const lineGeo = new THREE.BufferGeometry().setFromPoints(
      Array.from({ length: 256 }, (_, k) => new THREE.Vector3(Math.cos((k / 256) * Math.PI * 2) * orbit, 0, Math.sin((k / 256) * Math.PI * 2) * orbit)),
    );
    tilt.add(new THREE.LineLoop(lineGeo, new THREE.LineBasicMaterial({ color: new THREE.Color(this.galaxy.sky[3]), transparent: true, opacity: 0.07, depthWrite: false })));

    let name = `${def.name} ${ROMAN[pd.i]}`;
    if (def.galaxy === 0 && def.index === 0 && pd.i === 0) name = 'Terra Nova';
    const planet = {
      id: `${def.galaxy}:${def.index}:${pd.i}`, index: pd.i, name, type, radius, orbit, mesh, pivot, clouds, sunDirView,
      ruin: pd.ruin, speed: pd.speed, spin: pd.spin, worldPos: new THREE.Vector3(),
    };
    mesh.getWorldPosition(planet.worldPos);
    this.planets.push(planet);
    this.colliders.push({ kind: 'planet', pos: planet.worldPos, radius: radius * 1.02 });
  }

  // ---------------------------------------------------------- asteroids --
  buildBelt() {
    const r = this.rand;
    this.belt = null;
    if (this.planets.length < 2 || r() > 0.75) return;
    const sorted = [...this.planets].sort((a, b) => a.orbit - b.orbit);
    const k = Math.floor(r() * (sorted.length - 1));
    const radius = (sorted[k].orbit + sorted[k + 1].orbit) / 2;
    const width = 200;
    const geo = new THREE.IcosahedronGeometry(1, 2);
    const p = geo.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const n = 0.75 + 0.35 * Math.sin(v.x * 3.1 + v.y * 1.7) * Math.cos(v.z * 2.3 + v.x) + 0.15 * Math.sin(v.y * 7 + v.z * 5);
      v.multiplyScalar(n);
      p.setXYZ(i, v.x, v.y, v.z);
    }
    geo.computeVertexNormals();
    const count = this.preset.belt;
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0.05, flatShading: true }), count);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), ps = new THREE.Vector3();
    const c = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const a = r() * Math.PI * 2;
      const d = radius + (r() + r() - 1) * width * 0.6;
      ps.set(Math.cos(a) * d, (r() + r() - 1) * 30, Math.sin(a) * d);
      e.set(r() * 6, r() * 6, r() * 6);
      q.setFromEuler(e);
      const s = r() < 0.02 ? 16 + r() * 14 : 1.5 + Math.pow(r(), 2) * 10;
      sc.set(s, s * (0.55 + r() * 0.5), s * (0.8 + r() * 0.3));
      m.compose(ps, q, sc);
      mesh.setMatrixAt(i, m);
      const g = 0.32 + r() * 0.25;
      c.setRGB(g * (1 + r() * 0.15), g, g * (0.9 + r() * 0.1));
      mesh.setColorAt(i, c);
    }
    this.group.add(mesh);
    this.belt = { mesh, radius, width };
  }

  // -------------------------------------------------- energy nebulae --
  buildHotspots() {
    const r = this.rand;
    const n = 2 + Math.floor(r() * 3);
    const cA = new THREE.Color(this.galaxy.sky[0]);
    const cB = new THREE.Color(this.galaxy.sky[1]);
    const cD = new THREE.Color(this.galaxy.sky[3]);
    const puff = puffTexture();
    for (let i = 0; i < n; i++) {
      const a = r() * Math.PI * 2;
      const d = this.starRadius + range(r, 600, 2600);
      const pos = new THREE.Vector3(Math.cos(a) * d, range(r, -180, 220), Math.sin(a) * d);
      const radius = range(r, 160, 230);
      const density = range(r, 2.5, 4.2);
      const g = new THREE.Group();
      g.position.copy(pos);
      const puffs = [];
      for (let k = 0; k < 46; k++) {
        const u = r() * 2 - 1, th = r() * Math.PI * 2, s = Math.sqrt(1 - u * u);
        const rr = radius * Math.pow(r(), 0.7) * 0.85;
        const col = cA.clone().lerp(cB, r()).lerp(cD, r() * 0.25).multiplyScalar(0.18 + r() * 0.2);
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: puff, color: col, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, rotation: r() * 6.28 }));
        sp.position.set(s * Math.cos(th) * rr, u * rr * 0.5, s * Math.sin(th) * rr);
        sp.scale.setScalar(radius * (0.5 + r() * 0.7));
        sp.userData.base = 1;
        g.add(sp);
        puffs.push(sp);
      }
      const count = 260;
      const arr = new Float32Array(count * 3);
      for (let k = 0; k < count; k++) {
        const u = r() * 2 - 1, th = r() * Math.PI * 2, s = Math.sqrt(1 - u * u);
        const rr = radius * Math.pow(r(), 0.5);
        arr.set([s * Math.cos(th) * rr, u * rr * 0.55, s * Math.sin(th) * rr], k * 3);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
      const sparks = new THREE.Points(geo, new THREE.PointsMaterial({ size: 3, map: softDotTexture(), color: cD.clone().multiplyScalar(1.6), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, sizeAttenuation: true }));
      g.add(sparks);
      const core = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: cA.clone().lerp(cD, 0.5).multiplyScalar(0.9), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.7 }));
      core.scale.setScalar(radius * 1.4);
      g.add(core);
      this.group.add(g);
      this.hotspots.push({ pos, radius, density, group: g, puffs, sparks, spin: (r() - 0.5) * 0.06 });
    }
  }

  buildSpawnPoints() {
    const r = this.rand;
    for (const h of this.hotspots) this.spawnPoints.push({ kind: 'hotspot', pos: h.pos.clone() });
    if (this.belt) {
      for (let i = 0; i < 4; i++) {
        const a = r() * Math.PI * 2;
        this.spawnPoints.push({ kind: 'belt', pos: new THREE.Vector3(Math.cos(a) * this.belt.radius, 0, Math.sin(a) * this.belt.radius) });
      }
    }
    for (let i = 0; i < 6; i++) {
      const a = r() * Math.PI * 2;
      const d = this.starRadius + range(r, 600, 3000);
      this.spawnPoints.push({ kind: 'open', pos: new THREE.Vector3(Math.cos(a) * d, range(r, -250, 250), Math.sin(a) * d) });
    }
  }

  densityAt(p) {
    let d = 1;
    const ds = p.length();
    d += 3.2 * clamp(1 - (ds - this.starRadius) / 1500, 0, 1);
    for (const h of this.hotspots) {
      const k = 1 - p.distanceTo(h.pos) / h.radius;
      if (k > 0) d += h.density * (0.45 + 0.55 * k);
    }
    return d;
  }

  interactables() {
    const list = [];
    if (this.station) list.push({ kind: 'station', name: this.station.name, pos: this.station.pos, range: 190 });
    if (this.gate) list.push({ kind: 'gate', name: this.gate.name, pos: this.gate.pos, range: 260 });
    for (const p of this.planets) list.push({ kind: 'planet', name: p.name, pos: p.worldPos, range: p.radius + 90, planet: p });
    return list;
  }

  markers() {
    const list = [{ key: 'star', kind: 'star', label: this.starType.label, pos: this.colliders[0].pos }];
    for (const p of this.planets) list.push({ key: p.id, kind: 'planet', label: p.name, pos: p.worldPos, planet: p });
    if (this.station) list.push({ key: 'station', kind: 'station', label: this.station.name, pos: this.station.pos });
    if (this.gate) list.push({ key: 'gate', kind: 'gate', label: 'Universe Gate', pos: this.gate.pos });
    this.hotspots.forEach((h, i) => list.push({ key: `hs${i}`, kind: 'hotspot', label: 'Energy nebula', pos: h.pos }));
    return list;
  }

  update(dt, camera) {
    this.time += dt;
    this.starUniforms.time.value = this.time;
    this.coronaUniforms.time.value = this.time;
    this.corona.quaternion.copy(camera.quaternion);
    this.star.rotation.y += dt * 0.008;
    tmpM.setFromMatrix4(camera.matrixWorldInverse);
    for (const p of this.planets) {
      p.pivot.rotation.y += p.speed * dt;
      p.mesh.rotation.y += p.spin * dt;
      if (p.clouds) p.clouds.rotation.y += dt * 0.01;
      p.mesh.getWorldPosition(p.worldPos);
      p.sunDirView.value.copy(p.worldPos).negate().normalize().applyMatrix3(tmpM).normalize();
    }
    if (this.belt) this.belt.mesh.rotation.y += dt * 0.003;
    for (const h of this.hotspots) {
      h.group.rotation.y += h.spin * dt;
      const camD = camera.position.distanceTo(h.pos);
      if (camD < h.radius * 2.2) {
        for (const sp of h.puffs) {
          sp.getWorldPosition(tmpV);
          const d = tmpV.distanceTo(camera.position);
          sp.material.opacity = clamp((d - sp.scale.x * 0.15) / (sp.scale.x * 0.5), 0, 1);
        }
      } else if (h.puffs[0].material.opacity !== 1) {
        for (const sp of h.puffs) sp.material.opacity = 1;
      }
    }
    if (this.station) this.station.update(dt);
    if (this.gate) this.gate.update(dt);
  }

  resolveCollision(pos, radius) {
    let hit = null;
    for (const c of this.colliders) {
      tmpV.subVectors(pos, c.pos);
      const d = tmpV.length();
      const min = c.radius + radius;
      if (d < min && d > 0.0001) {
        pos.addScaledVector(tmpV.divideScalar(d), min - d);
        hit = c;
      }
    }
    return hit;
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) m.dispose();
      }
    });
    for (const t of this.textures) t.dispose();
  }
}
