import * as THREE from 'three';
import { NOISE_GLSL } from './glsl.js';
import { mulberry32, range, pick, clamp } from './rng.js';
import { GALAXIES, STAR_TYPES, GALAXY_PLANETS, ROMAN } from './data.js';
import { makePlanetTextures, makeRingTexture, glowTexture } from './textures.js';

const tmpV = new THREE.Vector3();

// A single star system: its star, planets, belts, energy nebulae, and any
// station, universe gate or boss lair. Built on arrival, disposed on departure.
export class StarSystem {
  constructor(scene, def) {
    this.scene = scene;
    this.def = def;
    this.galaxy = GALAXIES[def.galaxy];
    this.rand = mulberry32(def.seed);
    this.group = new THREE.Group();
    this.textures = [];
    this.planets = [];
    this.hotspots = [];
    this.colliders = [];
    this.spawnPoints = [];
    this.time = 0;
    scene.add(this.group);

    const r = this.rand;
    this.entryAngle = r() * Math.PI * 2;
    this.buildStar();
    this.buildPlanets();
    this.buildBelt();
    this.buildHotspots();

    const R = this.starRadius;
    const ea = this.entryAngle;
    this.entryPoint = new THREE.Vector3(Math.cos(ea) * (R + 1500), 70, Math.sin(ea) * (R + 1500));
    if (def.station) this.buildStation(this.entryPoint.clone().add(new THREE.Vector3(Math.cos(ea + 1.2) * 160, -20, Math.sin(ea + 1.2) * 160)));
    if (def.gate) {
      const ga = ea - 0.9;
      this.buildGate(new THREE.Vector3(Math.cos(ga) * (R + 2000), 260, Math.sin(ga) * (R + 2000)));
    }
    const ba = ea + Math.PI;
    this.bossPoint = new THREE.Vector3(Math.cos(ba) * (R + 2300), 40, Math.sin(ba) * (R + 2300));
    this.buildSpawnPoints();
  }

  // ---------------------------------------------------------------- star --
  buildStar() {
    const r = this.rand;
    const st = STAR_TYPES[this.def.starType];
    const R = range(r, st.r[0], st.r[1]);
    this.starRadius = R;
    this.starType = st;
    this.starUniforms = {
      time: { value: 0 },
      core: { value: new THREE.Color(st.core) },
      edge: { value: new THREE.Color(st.edge) },
    };
    const mat = new THREE.ShaderMaterial({
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
          float n = fbm(vPos * 5.0 + vec3(time * 0.05));
          float n2 = fbm(vPos * 13.0 - vec3(time * 0.09));
          float cells = n * 0.65 + n2 * 0.45;
          vec3 col = mix(edge, core, smoothstep(0.35, 0.85, cells));
          float mu = max(dot(normalize(vNormal), normalize(vView)), 0.0);
          col *= 0.7 + 0.45 * mu;
          col += edge * pow(1.0 - mu, 3.0) * 1.6;
          gl_FragColor = vec4(col * 2.6, 1.0);
        }`,
    });
    const star = new THREE.Mesh(new THREE.SphereGeometry(R, 64, 32), mat);
    this.group.add(star);
    this.star = star;

    const glow = new THREE.Color(st.glow);
    const inner = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: glow.clone().multiplyScalar(1.6), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    inner.scale.setScalar(R * 3.4);
    const outer = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: glow.clone().multiplyScalar(0.55), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    outer.scale.setScalar(R * 11);
    this.group.add(inner, outer);

    const light = new THREE.PointLight(new THREE.Color(st.core).lerp(new THREE.Color(0xffffff), 0.4), 2.5, 0, 0);
    this.group.add(light);
    this.colliders.push({ kind: 'star', pos: new THREE.Vector3(), radius: R });
  }

  // ------------------------------------------------------------- planets --
  buildPlanets() {
    const r = this.rand;
    const def = this.def;
    const count = 3 + Math.floor(r() * 4);
    let orbit = this.starRadius + 520;
    const types = GALAXY_PLANETS[this.galaxy.id];
    const ruinIndex = def.index > 0 && (def.index % 2 === 0 || def.boss !== null) ? 1 + Math.floor(r() * (count - 1)) : -1;
    for (let i = 0; i < count; i++) {
      let type = pick(r, types);
      if (def.galaxy === 0 && def.index === 0 && i === 0) type = 'terran';
      const radius = type === 'gas' ? range(r, 90, 150) : range(r, 28, 68);
      orbit += radius + range(r, 260, 480);
      const seed = (def.seed + i * 7919) >>> 0;
      const tex = makePlanetTextures(type, seed);
      this.textures.push(tex.map);
      if (tex.emissiveMap) this.textures.push(tex.emissiveMap);
      if (tex.cloudMap) this.textures.push(tex.cloudMap);

      const tilt = new THREE.Group();
      tilt.rotation.set(range(r, -0.07, 0.07), 0, range(r, -0.07, 0.07));
      const pivot = new THREE.Group();
      pivot.rotation.y = r() * Math.PI * 2;
      tilt.add(pivot);
      this.group.add(tilt);

      const emissiveIntensity = type === 'lava' ? 1.8 : type === 'crystal' ? 1.4 : 0.5;
      const mat = new THREE.MeshStandardMaterial({
        map: tex.map,
        roughness: type === 'ice' ? 0.55 : 0.9,
        metalness: 0,
        emissiveMap: tex.emissiveMap || null,
        emissive: tex.emissiveMap ? new THREE.Color(0xffffff) : new THREE.Color(0x000000),
        emissiveIntensity,
      });
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 64, 32), mat);
      mesh.position.set(orbit, 0, 0);
      mesh.rotation.z = range(r, -0.4, 0.4);
      pivot.add(mesh);

      const atmoColor = { terran: 0x4a9cff, toxic: 0xb8ff4a, ice: 0xbfe6ff, gas: 0xffffff, lava: 0xff5a1a, crystal: 0xb48aff, rocky: 0x8a8a9a }[type];
      const atmo = new THREE.Mesh(
        new THREE.SphereGeometry(radius * 1.1, 48, 24),
        new THREE.ShaderMaterial({
          uniforms: { color: { value: new THREE.Color(atmoColor) }, strength: { value: type === 'rocky' ? 0.35 : 1.0 } },
          vertexShader: /* glsl */ `
            varying vec3 vNormal;
            varying vec3 vView;
            void main() {
              vNormal = normalize(normalMatrix * normal);
              vec4 mv = modelViewMatrix * vec4(position, 1.0);
              vView = normalize(-mv.xyz);
              gl_Position = projectionMatrix * mv;
            }`,
          fragmentShader: /* glsl */ `
            uniform vec3 color;
            uniform float strength;
            varying vec3 vNormal;
            varying vec3 vView;
            void main() {
              float f = 1.0 - max(dot(vNormal, vView), 0.0);
              float a = pow(f, 3.0) * strength;
              gl_FragColor = vec4(color * a * 1.3, a);
            }`,
          blending: THREE.AdditiveBlending,
          transparent: true,
          depthWrite: false,
        }),
      );
      mesh.add(atmo);

      let clouds = null;
      if (tex.cloudMap) {
        clouds = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.03, 48, 24), new THREE.MeshStandardMaterial({ map: tex.cloudMap, transparent: true, depthWrite: false, roughness: 1 }));
        mesh.add(clouds);
      }
      if (type === 'gas' && r() < 0.6) {
        const inner = radius * 1.4, outerR = radius * 2.3;
        const geo = new THREE.RingGeometry(inner, outerR, 128, 1);
        const pos = geo.attributes.position, uv = geo.attributes.uv;
        for (let k = 0; k < pos.count; k++) {
          const d = Math.hypot(pos.getX(k), pos.getY(k));
          uv.setXY(k, (d - inner) / (outerR - inner), 0.5);
        }
        const ringTex = makeRingTexture(tex.ringColors, seed + 3);
        this.textures.push(ringTex);
        const ring = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: ringTex, side: THREE.DoubleSide, transparent: true, depthWrite: false, roughness: 1 }));
        ring.rotation.x = -Math.PI / 2 + range(r, -0.35, 0.35);
        mesh.add(ring);
      }

      const lineGeo = new THREE.BufferGeometry().setFromPoints(
        Array.from({ length: 160 }, (_, k) => new THREE.Vector3(Math.cos((k / 160) * Math.PI * 2) * orbit, 0, Math.sin((k / 160) * Math.PI * 2) * orbit)),
      );
      const line = new THREE.LineLoop(lineGeo, new THREE.LineBasicMaterial({ color: new THREE.Color(this.galaxy.sky[0]), transparent: true, opacity: 0.16, depthWrite: false }));
      tilt.add(line);

      let name = `${def.name} ${ROMAN[i]}`;
      if (def.galaxy === 0 && def.index === 0 && i === 0) name = 'Terra Nova';
      const planet = {
        id: `${def.galaxy}:${def.index}:${i}`,
        index: i,
        name,
        type,
        radius,
        orbit,
        mesh,
        pivot,
        clouds,
        ruin: i === ruinIndex,
        speed: (0.012 + r() * 0.01) * (900 / orbit),
        spin: 0.02 + r() * 0.05,
        worldPos: new THREE.Vector3(),
      };
      this.planets.push(planet);
      this.colliders.push({ kind: 'planet', pos: planet.worldPos, radius: radius * 1.02 });
    }
    this.outerOrbit = orbit;
  }

  // ---------------------------------------------------------- asteroids --
  buildBelt() {
    const r = this.rand;
    this.belt = null;
    if (this.planets.length < 2 || r() > 0.7) return;
    const k = Math.floor(r() * (this.planets.length - 1));
    const radius = (this.planets[k].orbit + this.planets[k + 1].orbit) / 2;
    const width = 170;
    const geo = new THREE.IcosahedronGeometry(1, 1);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const s = 0.75 + Math.random() * 0.5;
      p.setXYZ(i, p.getX(i) * s, p.getY(i) * s, p.getZ(i) * s);
    }
    geo.computeVertexNormals();
    const count = 900;
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: 0x7a6e66, roughness: 0.95, flatShading: true }), count);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), ps = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      const a = r() * Math.PI * 2;
      const d = radius + (r() - 0.5) * width;
      ps.set(Math.cos(a) * d, (r() - 0.5) * 40, Math.sin(a) * d);
      e.set(r() * 6, r() * 6, r() * 6);
      q.setFromEuler(e);
      const s = r() < 0.03 ? 14 + r() * 10 : 2 + r() * r() * 9;
      sc.set(s, s * (0.6 + r() * 0.5), s);
      m.compose(ps, q, sc);
      mesh.setMatrixAt(i, m);
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
    for (let i = 0; i < n; i++) {
      const a = r() * Math.PI * 2;
      const d = this.starRadius + range(r, 500, 2600);
      const pos = new THREE.Vector3(Math.cos(a) * d, range(r, -180, 220), Math.sin(a) * d);
      const radius = range(r, 150, 210);
      const density = range(r, 2.5, 4.2);
      const count = 520;
      const arr = new Float32Array(count * 3);
      const col = new Float32Array(count * 3);
      const c = new THREE.Color();
      for (let k = 0; k < count; k++) {
        const u = r() * 2 - 1, th = r() * Math.PI * 2, s = Math.sqrt(1 - u * u);
        const rr = radius * Math.pow(r(), 0.6);
        arr[k * 3] = s * Math.cos(th) * rr;
        arr[k * 3 + 1] = u * rr * 0.55;
        arr[k * 3 + 2] = s * Math.sin(th) * rr;
        c.copy(cA).lerp(cB, r()).multiplyScalar(0.5 + r() * 0.7);
        col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      const pts = new THREE.Points(geo, new THREE.PointsMaterial({
        size: 34, map: glowTexture(), vertexColors: true, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.55, sizeAttenuation: true,
      }));
      pts.position.copy(pos);
      const core = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: cA.clone().lerp(cB, 0.5).multiplyScalar(0.9), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.6 }));
      core.scale.setScalar(radius * 2.4);
      core.position.copy(pos);
      this.group.add(pts, core);
      this.hotspots.push({ pos, radius, density, points: pts, spin: (r() - 0.5) * 0.1 });
    }
  }

  // ------------------------------------------------------------ station --
  buildStation(pos) {
    const g = new THREE.Group();
    g.position.copy(pos);
    const metal = new THREE.MeshStandardMaterial({ color: 0x9aa6b8, metalness: 0.75, roughness: 0.32 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x2a3140, metalness: 0.6, roughness: 0.5 });
    const glowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x5ee8ff).multiplyScalar(2.5) });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(46, 4, 12, 72), metal);
    ring.rotation.x = Math.PI / 2;
    const ringGroup = new THREE.Group();
    ringGroup.add(ring);
    for (let i = 0; i < 4; i++) {
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(92, 2.4, 2.4), dark);
      spoke.rotation.y = (i * Math.PI) / 4;
      ringGroup.add(spoke);
    }
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const l = new THREE.Mesh(new THREE.SphereGeometry(1.4, 8, 6), glowMat);
      l.position.set(Math.cos(a) * 46, 4.5, Math.sin(a) * 46);
      ringGroup.add(l);
    }
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(11, 11, 34, 24), metal);
    const cap1 = new THREE.Mesh(new THREE.SphereGeometry(11, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), dark);
    cap1.position.y = 17;
    const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 40, 6), dark);
    antenna.position.y = 36;
    const beaconMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff6a4a).multiplyScalar(3) });
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(2, 10, 8), beaconMat);
    beacon.position.y = 56;
    const core = new THREE.Mesh(new THREE.TorusGeometry(12, 1.2, 8, 32), glowMat);
    core.rotation.x = Math.PI / 2;
    core.position.y = -10;
    g.add(ringGroup, hub, cap1, antenna, beacon, core);
    const light = new THREE.PointLight(0x9fd8ff, 2, 260, 1.5);
    light.position.y = 30;
    g.add(light);
    this.group.add(g);
    this.station = { group: g, ringGroup, beaconMat, pos, name: this.def.galaxy === 0 ? 'Martial Hall Station' : `${this.def.name} Exchange` };
  }

  // --------------------------------------------------------------- gate --
  buildGate(pos) {
    const g = new THREE.Group();
    g.position.copy(pos);
    g.lookAt(0, pos.y, 0);
    const frame = new THREE.Mesh(new THREE.TorusGeometry(110, 8, 16, 120), new THREE.MeshStandardMaterial({ color: 0x3a3450, metalness: 0.9, roughness: 0.25, emissive: new THREE.Color(this.galaxy.sky[1]), emissiveIntensity: 0.6 }));
    g.add(frame);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const p = new THREE.Mesh(new THREE.BoxGeometry(10, 26, 14), new THREE.MeshStandardMaterial({ color: 0x5a5470, metalness: 0.8, roughness: 0.3, emissive: 0xffffff, emissiveIntensity: 0.15 }));
      p.position.set(Math.cos(a) * 112, Math.sin(a) * 112, 0);
      p.rotation.z = a;
      g.add(p);
    }
    this.gateUniforms = { time: { value: 0 }, colA: { value: new THREE.Color(this.galaxy.sky[0]) }, colB: { value: new THREE.Color(this.galaxy.sky[1]) } };
    const disc = new THREE.Mesh(new THREE.CircleGeometry(104, 96), new THREE.ShaderMaterial({
      uniforms: this.gateUniforms,
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float time;
        uniform vec3 colA;
        uniform vec3 colB;
        varying vec2 vUv;
        ${NOISE_GLSL}
        void main() {
          vec2 p = vUv * 2.0 - 1.0;
          float r = length(p);
          float a = atan(p.y, p.x);
          float swirl = fbm(vec3(cos(a * 3.0 + r * 6.0 - time * 1.5), sin(a * 3.0 + r * 6.0 - time * 1.5), r * 3.0 - time * 0.4));
          vec3 col = mix(colA, colB, swirl) * (0.6 + swirl * 1.6);
          col += vec3(1.0) * pow(max(0.0, 1.0 - r * 2.4), 2.0) * 1.8;
          float alpha = smoothstep(1.0, 0.85, r);
          gl_FragColor = vec4(col * alpha * 1.4, alpha);
        }`,
    }));
    g.add(disc);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: new THREE.Color(this.galaxy.sky[1]).multiplyScalar(0.8), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.6 }));
    glow.scale.setScalar(520);
    g.add(glow);
    this.group.add(g);
    this.gate = { group: g, frame, pos, name: 'Universe Gate' };
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

  // Cosmic energy density at a point, which scales how fast you cultivate.
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
    if (this.station) list.push({ kind: 'station', name: this.station.name, pos: this.station.pos, range: 130 });
    if (this.gate) list.push({ kind: 'gate', name: this.gate.name, pos: this.gate.pos, range: 230 });
    for (const p of this.planets) list.push({ kind: 'planet', name: p.name, pos: p.worldPos, range: p.radius + 80, planet: p });
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

  update(dt) {
    this.time += dt;
    this.starUniforms.time.value = this.time;
    this.star.rotation.y += dt * 0.01;
    for (const p of this.planets) {
      p.pivot.rotation.y += p.speed * dt;
      p.mesh.rotation.y += p.spin * dt;
      if (p.clouds) p.clouds.rotation.y += dt * 0.012;
      p.mesh.getWorldPosition(p.worldPos);
    }
    if (this.belt) this.belt.mesh.rotation.y += dt * 0.004;
    for (const h of this.hotspots) h.points.rotation.y += h.spin * dt;
    if (this.station) {
      this.station.ringGroup.rotation.y += dt * 0.15;
      this.station.beaconMat.color.setRGB(3, 0.7, 0.4).multiplyScalar(0.3 + 0.7 * (Math.sin(this.time * 4) > 0.6 ? 1 : 0.15));
    }
    if (this.gate) {
      this.gateUniforms.time.value = this.time;
      this.gate.frame.rotation.z += dt * 0.05;
    }
  }

  // Push a sphere out of the star and planets; returns the collider hit, if any.
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
    const shared = glowTexture();
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) m.dispose();
      }
    });
    for (const t of this.textures) if (t !== shared) t.dispose();
  }
}
