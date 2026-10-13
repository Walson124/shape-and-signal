import * as THREE from 'three';
import { NOISE_GLSL } from '../core/glsl.js';
import { withLogDepth } from '../core/logdepth.js';
import { mulberry32 } from '../core/rng.js';
import { STAR_TYPES, REGIONS } from '../game/data.js';
import { glowTexture, puffTexture, softDotTexture } from './textures.js';
import { buildDockStation } from './station.js';
import { generateSystem } from './systemgen.js';
import { Planet } from './planet.js';

const tA = new THREE.Vector3();
const tB = new THREE.Vector3();

export function orbitPosition(o, t, out) {
  const M = o.phase + o.rate * t;
  let E = M;
  for (let k = 0; k < 4; k++) E = M + o.e * Math.sin(E);
  const x = o.a * (Math.cos(E) - o.e);
  const z = o.a * Math.sqrt(1 - o.e * o.e) * Math.sin(E);
  const cp = Math.cos(o.peri || 0), sp = Math.sin(o.peri || 0);
  const px = x * cp - z * sp, pz = x * sp + z * cp;
  const ci = Math.cos(o.inc || 0), si = Math.sin(o.inc || 0);
  const py2 = -pz * si, pz2 = pz * ci;
  const cn = Math.cos(o.node || 0), sn = Math.sin(o.node || 0);
  return out.set(px * cn - pz2 * sn, py2, px * sn + pz2 * cn);
}

// Asteroids generated in cells around the player while inside a belt, so
// belts look dense up close without millions of rocks.
class AsteroidField {
  constructor(root, belts) {
    this.root = root;
    this.belts = belts;
    this.cell = 3500;
    const geo = new THREE.IcosahedronGeometry(1, 2);
    const p = geo.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const n = 0.75 + 0.3 * Math.sin(v.x * 3.1 + v.y * 1.7) * Math.cos(v.z * 2.3 + v.x) + 0.12 * Math.sin(v.y * 7 + v.z * 5);
      v.multiplyScalar(n);
      p.setXYZ(i, v.x, v.y, v.z);
    }
    geo.computeVertexNormals();
    this.max = 700;
    this.mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.93, flatShading: true, envMapIntensity: 0.3 }), this.max);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    root.add(this.mesh);
    this.key = '';
    this.colliders = [];
    this.inBelt = 0;
    this.bands = belts.map((b) => {
      const r = mulberry32(b.seed);
      const n = 9000;
      const pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const a = r() * Math.PI * 2;
        const d = b.radius + (r() + r() - 1) * b.width * 0.5;
        const y = (r() + r() - 1) * b.thickness * 0.5;
        pos.set([Math.cos(a) * d, y, Math.sin(a) * d], i * 3);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const pts = new THREE.Points(g, new THREE.PointsMaterial({ color: 0x8a8070, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0.55, depthWrite: false, fog: false }));
      pts.rotation.x = b.inc;
      root.add(pts);
      return pts;
    });
  }

  beltDensity(p) {
    let best = 0;
    for (const b of this.belts) {
      const ci = Math.cos(-b.inc), si = Math.sin(-b.inc);
      const y = p.y * ci - p.z * si, z = p.y * si + p.z * ci;
      const r = Math.hypot(p.x, z);
      const fr = 1 - Math.abs(r - b.radius) / (b.width * 0.5);
      const fy = 1 - Math.abs(y) / (b.thickness * 0.5);
      best = Math.max(best, Math.min(fr, fy));
    }
    return Math.max(0, best);
  }

  update(sysPos) {
    const density = this.beltDensity(sysPos);
    this.inBelt = density;
    const c = this.cell;
    const cx = Math.floor(sysPos.x / c), cy = Math.floor(sysPos.y / c), cz = Math.floor(sysPos.z / c);
    const key = density > 0 ? `${cx},${cy},${cz}` : 'none';
    if (key === this.key) return;
    this.key = key;
    this.colliders = [];
    if (density <= 0) {
      this.mesh.count = 0;
      return;
    }
    this.mesh.position.set(cx * c, cy * c, cz * c);
    let k = 0;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), pp = new THREE.Vector3();
    const col = new THREE.Color();
    for (let x = -2; x <= 2; x++) for (let y = -1; y <= 1; y++) for (let z = -2; z <= 2; z++) {
      const r = mulberry32(((cx + x) * 73856093) ^ ((cy + y) * 19349663) ^ ((cz + z) * 83492791));
      const d = this.beltDensity(tA.set((cx + x + 0.5) * c, (cy + y + 0.5) * c, (cz + z + 0.5) * c));
      const n = Math.floor(d * 9 + r() * d * 4);
      for (let i = 0; i < n && k < this.max; i++) {
        pp.set((x + r()) * c, (y + r()) * c, (z + r()) * c);
        const big = r() < 0.12;
        const size = big ? 60 + r() * 260 : 4 + r() * r() * 40;
        e.set(r() * 6, r() * 6, r() * 6);
        q.setFromEuler(e);
        s.set(size, size * (0.6 + r() * 0.5), size * (0.8 + r() * 0.3));
        m.compose(pp, q, s);
        this.mesh.setMatrixAt(k, m);
        const g = 0.28 + r() * 0.25;
        col.setRGB(g * (1 + r() * 0.2), g, g * 0.92);
        this.mesh.setColorAt(k, col);
        this.colliders.push({ local: pp.clone(), radius: size * 0.85 });
        k++;
      }
    }
    this.mesh.count = k;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

export class StarSystem {
  constructor(scene, star, preset) {
    this.scene = scene;
    this.star = star;
    this.preset = preset;
    this.gen = generateSystem(star);
    this.region = REGIONS[star.region];
    this.root = new THREE.Group();
    this.root.name = `system:${star.key}`;
    this.planets = [];
    this.stations = [];
    this.comets = [];
    this.nebulae = [];
  }

  static async create(scene, star, preset, onProgress) {
    const s = new StarSystem(scene, star, preset);
    await s.build(onProgress);
    return s;
  }

  async build(onProgress = () => {}) {
    const g = this.gen;
    this.starRadius = g.starRadius;
    this.starType = STAR_TYPES[this.star.cls];
    this.buildStar();
    const byId = new Map();
    const ctx = { starKey: this.star.key, preset: this.preset };
    for (const body of g.bodies) {
      const p = new Planet(body, ctx);
      byId.set(body.id, p);
      this.planets.push(p);
    }
    for (const p of this.planets) {
      const parent = p.body.parent ? byId.get(p.body.parent) : null;
      p.parent = parent;
      (parent ? parent.orbitGroup : this.root).add(p.orbitGroup);
    }
    this.byId = byId;
    let done = 0;
    const gas = this.planets.filter((p) => !p.body.landable);
    const total = gas.length + 1;
    onProgress(0, total);
    await Promise.all(gas.map((p) => p.setupGas().then(() => onProgress(++done, total))));
    this.field = new AsteroidField(this.root, g.belts);
    for (const st of g.stations) {
      const parent = byId.get(st.parent);
      const model = buildDockStation(st.name, 0x3ef2ff);
      const holder = new THREE.Group();
      holder.add(model.group);
      (parent ? parent.orbitGroup : this.root).add(holder);
      this.stations.push({ def: st, ...model, model, holder, parent, worldPos: new THREE.Vector3(), orbit: { a: st.a, e: 0, inc: st.inc, node: 0, peri: 0, phase: st.phase, rate: st.rate } });
    }
    for (const c of g.comets) this.buildComet(c);
    for (const n of g.nebulae) this.buildNebula(n);
    onProgress(total, total);
  }

  attach() {
    this.scene.add(this.root);
  }

  buildStar() {
    const st = this.starType;
    const R = this.starRadius;
    this.starUniforms = { time: { value: 0 }, core: { value: new THREE.Color(st.core) }, edge: { value: new THREE.Color(st.edge) } };
    const mat = withLogDepth(new THREE.ShaderMaterial({
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
          float cells = pow(clamp(fbm(vPos * 22.0 + warp * 3.0 - time * 0.12), 0.0, 1.0), 2.0);
          float heat = n * 0.7 + cells * 0.6;
          vec3 col = mix(edge, core, smoothstep(0.3, 0.85, heat));
          float mu = clamp(dot(normalize(vNormal), normalize(vView)), 0.0, 1.0);
          col *= 0.62 + 0.5 * pow(mu, 0.5);
          col += edge * pow(1.0 - mu, 2.5) * 1.8;
          gl_FragColor = vec4(col * 2.4, 1.0);
        }`,
    }));
    this.starMesh = new THREE.Mesh(new THREE.SphereGeometry(R, 96, 48), mat);
    this.root.add(this.starMesh);
    this.coronaUniforms = { time: { value: 0 }, color: { value: new THREE.Color(st.glow) } };
    this.corona = new THREE.Mesh(new THREE.PlaneGeometry(R * 7, R * 7), withLogDepth(new THREE.ShaderMaterial({
      uniforms: this.coronaUniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
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
          float fall = pow(clamp(1.0 - (r - inner) / (1.0 - inner), 0.0, 1.0), 2.6);
          float glow = fall * (0.35 + rays * 1.1) * smoothstep(inner * 0.9, inner * 1.05, r);
          gl_FragColor = vec4(color * glow * 0.9, 1.0);
        }`,
    })));
    this.root.add(this.corona);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: new THREE.Color(st.glow).multiplyScalar(0.3), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
    glow.scale.setScalar(R * 9);
    this.root.add(glow);
    this.sunColor = new THREE.Color(st.core).lerp(new THREE.Color(0xffffff), 0.35);
    this.light = new THREE.PointLight(this.sunColor, 2.7, 0, 0);
    this.root.add(this.light);
  }

  buildComet(c) {
    const g = new THREE.Group();
    const r = mulberry32(c.seed);
    const nucleus = new THREE.Mesh(new THREE.IcosahedronGeometry(500 + r() * 400, 2), new THREE.MeshStandardMaterial({ color: 0x9aa4b0, roughness: 0.9, flatShading: true }));
    g.add(nucleus);
    const coma = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: new THREE.Color(0.5, 0.9, 1.4), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
    coma.scale.setScalar(9000);
    g.add(coma);
    const tailMat = withLogDepth(new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(0.45, 0.85, 1.3) } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform vec3 uColor; varying vec2 vUv; void main() { float a = pow(clamp(vUv.y, 0.0, 1.0), 2.2) * 0.55; gl_FragColor = vec4(uColor * a, 1.0); }',
    }));
    const tail = new THREE.Mesh(new THREE.ConeGeometry(5000, 90000, 24, 1, true).translate(0, -45000, 0), tailMat);
    g.add(tail);
    this.root.add(g);
    this.comets.push({ def: c, group: g, tail, worldPos: g.position });
  }

  buildNebula(n) {
    const g = new THREE.Group();
    const pos = new THREE.Vector3(...n.dir).normalize().multiplyScalar(n.dist);
    g.position.copy(pos);
    const r = mulberry32(Math.floor(n.dist));
    const cA = new THREE.Color(this.region.sky[0]), cB = new THREE.Color(this.region.sky[1]), cD = new THREE.Color(this.region.sky[3]);
    for (let k = 0; k < 40; k++) {
      const u = r() * 2 - 1, th = r() * Math.PI * 2, s = Math.sqrt(1 - u * u);
      const rr = n.radius * Math.pow(r(), 0.7) * 0.8;
      const col = cA.clone().lerp(cB, r()).lerp(cD, r() * 0.25).multiplyScalar(0.16 + r() * 0.18);
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTexture(), color: col, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, rotation: r() * 6.28, fog: false }));
      sp.position.set(s * Math.cos(th) * rr, u * rr * 0.5, s * Math.sin(th) * rr);
      sp.scale.setScalar(n.radius * (0.5 + r() * 0.7));
      g.add(sp);
    }
    const count = 400;
    const arr = new Float32Array(count * 3);
    for (let k = 0; k < count; k++) {
      const u = r() * 2 - 1, th = r() * Math.PI * 2, s = Math.sqrt(1 - u * u);
      const rr = n.radius * Math.pow(r(), 0.5);
      arr.set([s * Math.cos(th) * rr, u * rr * 0.55, s * Math.sin(th) * rr], k * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    g.add(new THREE.Points(geo, new THREE.PointsMaterial({ size: 3, sizeAttenuation: false, map: softDotTexture(), color: cD.clone().multiplyScalar(1.4), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false })));
    this.root.add(g);
    this.nebulae.push({ def: n, group: g, pos, radius: n.radius, density: n.density });
  }

  // Innermost planet/moon whose sphere of influence contains a world point.
  frameAt(world) {
    let best = null;
    for (const p of this.planets) {
      const d = world.distanceTo(p.worldPos);
      if (d < p.soi && (!best || p.soi < best.soi)) best = p;
    }
    return best;
  }

  densityAt(world) {
    let d = 1;
    const ds = world.length();
    d += 3.2 * Math.max(0, 1 - (ds - this.starRadius) / (this.starRadius * 25));
    for (const n of this.nebulae) {
      const k = 1 - world.distanceTo(n.pos) / n.radius;
      if (k > 0) d += n.density * (0.45 + 0.55 * k);
    }
    return d;
  }

  update(dt, t, camera, playerWorld) {
    this.starUniforms.time.value = t;
    this.coronaUniforms.time.value = t;
    for (const p of this.planets) {
      orbitPosition(p.body.orbit, t, p.orbitGroup.position);
      p.prepare(t);
    }
    for (const s of this.stations) {
      orbitPosition(s.orbit, t, s.holder.position);
      s.update(dt);
    }
    for (const c of this.comets) {
      orbitPosition(c.def, t, c.group.position);
      tA.copy(c.group.position).normalize();
      c.group.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), tA);
      const near = 1 - Math.min(1, c.group.position.length() / (c.def.a * 1.4));
      c.tail.scale.set(0.4 + near, 0.3 + near * 1.6, 0.4 + near);
    }
    this.root.updateMatrixWorld(true);
    camera.updateMatrixWorld(true);
    this.corona.quaternion.copy(camera.getWorldQuaternion(new THREE.Quaternion()));
    for (const p of this.planets) p.update(dt, t, camera, this.root.position);
    for (const s of this.stations) s.group.getWorldPosition(s.worldPos);
    if (playerWorld) this.field.update(tB.copy(playerWorld));
  }

  // Asteroid colliders near a world point, in world space.
  rockColliders(world, radius = 3000) {
    const out = [];
    for (const c of this.field.colliders) {
      tA.copy(c.local).add(this.field.mesh.position);
      if (tA.distanceTo(world) < radius + c.radius) out.push({ pos: tA.clone(), radius: c.radius });
    }
    return out;
  }

  markers() {
    const list = [{ key: 'star', kind: 'star', label: this.star.name, ref: { worldPos: new THREE.Vector3() }, radius: this.starRadius }];
    for (const p of this.planets) list.push({ key: p.body.id, kind: p.body.kind === 'moon' ? 'moon' : 'planet', label: p.body.name, ref: p, radius: p.R, planet: p });
    for (const s of this.stations) list.push({ key: s.def.id, kind: 'station', label: s.def.name, ref: s, radius: 150, station: s });
    this.nebulae.forEach((n, i) => list.push({ key: `neb${i}`, kind: 'hotspot', label: 'Energy nebula', ref: { worldPos: n.pos }, radius: n.radius }));
    return list;
  }

  dispose() {
    this.scene.remove(this.root);
    for (const p of this.planets) p.dispose();
    this.root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose?.();
    });
  }
}
