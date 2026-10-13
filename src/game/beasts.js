import * as THREE from 'three';
import { BEASTS, BOSSES, power } from './data.js';
import { glowTexture } from '../world/textures.js';
import { rimMaterial } from '../world/models.js';
import { buildCreature } from './creatures.js';
import { pickSpecies } from './bestiary.js';

const UP = new THREE.Vector3(0, 1, 0);
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();

const glowMat = (color, mul = 3) => new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(mul) });

function skin(color, opts = {}) {
  return rimMaterial({
    color: opts.base ?? 0x161020,
    emissive: new THREE.Color(color),
    emissiveIntensity: opts.emissive ?? 0.08,
    metalness: opts.metalness ?? 0.35,
    roughness: opts.roughness ?? 0.42,
    flatShading: opts.flat ?? false,
    rim: color,
    rimPower: opts.rimPower ?? 3.0,
    rimStrength: (opts.rim ?? 1.3) * 0.55,
    side: opts.side ?? THREE.FrontSide,
  });
}

// Emissive cracks driven by a per-vertex "glow" attribute.
function crackMaterial(base, glowColor) {
  const m = new THREE.MeshStandardMaterial({ color: base, roughness: 0.95, metalness: 0.05, flatShading: true, emissive: new THREE.Color(glowColor), emissiveIntensity: 1 });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = `attribute float glow;\nvarying float vGlow;\n${shader.vertexShader}`.replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = glow;');
    shader.fragmentShader = `varying float vGlow;\n${shader.fragmentShader}`.replace(
      '#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= vGlow * 3.0;',
    );
  };
  m.customProgramCacheKey = () => 'crack-v1';
  return m;
}

function displacedRock(detail, amp, crackWidth) {
  const geo = new THREE.IcosahedronGeometry(1, detail);
  const p = geo.attributes.position;
  const glow = new Float32Array(p.count);
  const v = new THREE.Vector3();
  const seedA = Math.random() * 10;
  const n = (x, y, z) => Math.sin(x * 2.1 + seedA) * Math.cos(y * 2.7 + seedA * 0.5) + Math.sin(z * 3.3 + x * 1.3) * 0.5;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const d = n(v.x, v.y, v.z);
    v.multiplyScalar(1 + d * amp);
    p.setXYZ(i, v.x, v.y, v.z);
    glow[i] = Math.abs(d) < crackWidth ? 1 - Math.abs(d) / crackWidth : 0;
  }
  geo.setAttribute('glow', new THREE.BufferAttribute(glow, 1));
  geo.computeVertexNormals();
  return geo;
}

// ------------------------------------------------------------ models --
function buildMite(color) {
  const g = new THREE.Group();
  const body = skin(color, { emissive: 0.12, rim: 1.4 });
  const thorax = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), body);
  thorax.scale.set(1.1, 0.9, 1.3);
  const abdomen = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), body);
  abdomen.scale.set(1.3, 1.1, 1.9);
  abdomen.position.set(0, 0.3, -2.3);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.75, 16, 12), body);
  head.position.z = 1.55;
  g.add(thorax, abdomen, head);
  const stripe = glowMat(color, 2.5);
  for (let i = 0; i < 3; i++) {
    const t = new THREE.Mesh(new THREE.TorusGeometry(1.15 - i * 0.18, 0.06, 6, 24), stripe);
    t.position.set(0, 0.35, -1.8 - i * 0.6);
    t.scale.set(1.15, 1, 1);
    g.add(t);
  }
  const eye = glowMat(0xff3c5a, 4);
  for (const x of [-0.38, 0.38]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 8), eye);
    e.position.set(x, 0.22, 2.1);
    g.add(e);
    const mand = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.9, 5).rotateX(Math.PI / 2), body);
    mand.position.set(x * 0.9, -0.25, 2.3);
    mand.rotation.y = -x * 0.8;
    g.add(mand);
  }
  const legs = [];
  const legGeo = new THREE.CylinderGeometry(0.07, 0.05, 1.6, 5).translate(0, -0.8, 0);
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const hip = new THREE.Group();
      hip.position.set(side * 0.9, -0.2, 0.6 - i * 0.6);
      hip.rotation.z = side * 1.1;
      const upper = new THREE.Mesh(legGeo, body);
      hip.add(upper);
      const knee = new THREE.Group();
      knee.position.y = -1.6;
      knee.rotation.z = -side * 1.6;
      knee.add(new THREE.Mesh(legGeo, body));
      hip.add(knee);
      g.add(hip);
      legs.push({ hip, side, phase: i * 2.1 + (side > 0 ? Math.PI : 0) });
    }
  }
  const wingMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(0.8), transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const wingGeo = new THREE.PlaneGeometry(2.6, 1).translate(1.3, 0, 0);
  const wings = [-1, 1].map((s) => {
    const w = new THREE.Mesh(wingGeo, wingMat);
    w.position.set(s * 0.4, 0.8, -0.4);
    w.rotation.x = -Math.PI / 2;
    if (s < 0) w.rotation.y = Math.PI;
    g.add(w);
    return w;
  });
  g.scale.setScalar(1.15);
  return {
    group: g,
    flash: [body],
    anim: (t) => {
      for (const l of legs) l.hip.rotation.x = Math.sin(t * 10 + l.phase) * 0.45;
      wings[0].rotation.z = Math.sin(t * 40) * 0.5;
      wings[1].rotation.z = -Math.sin(t * 40) * 0.5;
      abdomen.rotation.x = Math.sin(t * 3) * 0.08;
    },
  };
}

function buildRay(color) {
  const g = new THREE.Group();
  const body = skin(color, { emissive: 0.1, rim: 1.1, base: 0x0a1626 });
  const torso = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 16), body);
  torso.scale.set(1.8, 0.55, 3.2);
  g.add(torso);
  const shape = new THREE.Shape();
  shape.moveTo(0, 2.6);
  shape.bezierCurveTo(2.5, 2.2, 5.5, 1.0, 7.2, -0.9);
  shape.quadraticCurveTo(4.2, -1.0, 0, -2.8);
  shape.lineTo(0, 2.6);
  const wingGeo = new THREE.ShapeGeometry(shape, 16).rotateX(-Math.PI / 2);
  const wp = wingGeo.attributes.position;
  for (let i = 0; i < wp.count; i++) {
    const x = wp.getX(i);
    wp.setY(i, Math.sin((x / 7.2) * Math.PI) * 0.25 - (x / 7.2) * 0.3);
  }
  wingGeo.computeVertexNormals();
  const wingMat = skin(color, { emissive: 0.15, rim: 1.6, base: 0x0c2032, side: THREE.DoubleSide });
  const wl = new THREE.Group();
  const wr = new THREE.Group();
  wl.add(new THREE.Mesh(wingGeo, wingMat));
  const rMesh = new THREE.Mesh(wingGeo, wingMat);
  rMesh.scale.x = -1;
  wr.add(rMesh);
  wl.position.x = 1.2;
  wr.position.x = -1.2;
  g.add(wl, wr);
  const spot = glowMat(color, 3);
  const spotGeo = new THREE.SphereGeometry(0.16, 6, 4);
  for (const wing of [wl, wr]) {
    for (let i = 0; i < 6; i++) {
      const s = new THREE.Mesh(spotGeo, spot);
      const x = 1 + i * 0.95;
      s.position.set((wing === wl ? 1 : -1) * x, 0.18 + Math.sin((x / 7.2) * Math.PI) * 0.25 - (x / 7.2) * 0.3, 0.6 - i * 0.25);
      wing.add(s);
    }
  }
  const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, -2.8), new THREE.Vector3(0, 0.2, -6), new THREE.Vector3(0, -0.2, -9), new THREE.Vector3(0, 0.3, -12)]);
  const tail = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.14, 6), body);
  g.add(tail);
  const tip = new THREE.Mesh(new THREE.OctahedronGeometry(0.45), spot);
  tip.position.set(0, 0.3, -12);
  g.add(tip);
  const eye = glowMat(0xffffff, 4);
  for (const x of [-0.8, 0.8]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), eye);
    e.position.set(x, 0.25, 2.7);
    g.add(e);
    const horn = new THREE.Mesh(new THREE.ConeGeometry(0.25, 1.6, 6).rotateX(Math.PI / 2), wingMat);
    horn.position.set(x * 1.3, 0, 3.2);
    horn.rotation.y = x * 0.2;
    g.add(horn);
  }
  return {
    group: g,
    flash: [body, wingMat],
    anim: (t) => {
      wl.rotation.z = Math.sin(t * 2.8) * 0.5;
      wr.rotation.z = -Math.sin(t * 2.8) * 0.5;
      tail.rotation.y = Math.sin(t * 2) * 0.15;
      tip.position.x = Math.sin(t * 2) * 1.6;
    },
  };
}

function buildRockback(color) {
  const g = new THREE.Group();
  const shellMat = crackMaterial(0x4a3c34, color);
  const shell = new THREE.Mesh(displacedRock(3, 0.18, 0.14), shellMat);
  shell.scale.set(10, 7.5, 12);
  g.add(shell);
  const crystal = skin(color, { emissive: 0.9, rim: 2, base: 0x3a1a08, flat: true });
  for (let i = 0; i < 11; i++) {
    const c = new THREE.Mesh(new THREE.ConeGeometry(1.1, 5 + Math.random() * 6, 5), crystal);
    const a = (i / 11) * Math.PI * 2;
    const v = new THREE.Vector3(Math.cos(a) * 0.55, 1, Math.sin(a) * 0.7 - 0.25).normalize();
    c.position.copy(v).multiplyScalar(7.2);
    c.quaternion.setFromUnitVectors(UP, v);
    g.add(c);
  }
  const headMat = skin(color, { emissive: 0.1, base: 0x2a2018, flat: true, rim: 0.8 });
  const head = new THREE.Mesh(new THREE.DodecahedronGeometry(4.2, 0), headMat);
  head.position.set(0, -1, 11);
  head.scale.set(1.2, 0.8, 1);
  g.add(head);
  const maw = new THREE.Mesh(new THREE.TorusGeometry(2.4, 0.6, 8, 20), glowMat(color, 3.5));
  maw.position.set(0, -1.6, 14.6);
  g.add(maw);
  const eye = glowMat(0xffe08a, 5);
  for (const [x, y] of [[-2.6, 1.2], [2.6, 1.2], [-1.4, 2], [1.4, 2]]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.45, 8, 6), eye);
    e.position.set(x, y - 1, 14);
    g.add(e);
  }
  const legs = [];
  for (const [x, z] of [[-7, 6], [7, 6], [-7, -6], [7, -6]]) {
    const l = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 0.9, 6, 6), headMat);
    l.position.set(x, -6, z);
    g.add(l);
    legs.push(l);
  }
  return {
    group: g,
    flash: [crystal, headMat],
    anim: (t) => {
      maw.rotation.z = t;
      maw.scale.setScalar(1 + Math.sin(t * 3) * 0.08);
      legs.forEach((l, i) => { l.rotation.x = Math.sin(t * 2 + i * 1.6) * 0.3; });
    },
  };
}

function buildWraith(color) {
  const g = new THREE.Group();
  const bellMat = new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(color) }, time: { value: 0 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      uniform float time;
      varying vec3 vN;
      varying vec3 vV;
      varying float vY;
      void main() {
        vec3 p = position;
        p.xz *= 1.0 + 0.08 * sin(time * 4.0 - p.y * 2.0);
        vY = position.y;
        vN = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 color;
      varying vec3 vN;
      varying vec3 vV;
      varying float vY;
      void main() {
        float f = pow(clamp(1.0 - abs(dot(vN, vV)), 0.0, 1.0), 2.0);
        float bands = 0.6 + 0.4 * sin(vY * 9.0);
        gl_FragColor = vec4(color * (f * 1.6 + 0.12) * bands, 1.0);
      }`,
  });
  const bell = new THREE.Mesh(new THREE.SphereGeometry(3.4, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.55), bellMat);
  bell.rotation.x = Math.PI / 2;
  bell.position.z = 1;
  g.add(bell);
  const coreMat = glowMat(color, 3);
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(1.1, 1), coreMat);
  core.position.z = 0.4;
  g.add(core);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: new THREE.Color(color).multiplyScalar(0.9), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  halo.scale.setScalar(14);
  g.add(halo);
  const tentMat = new THREE.LineBasicMaterial({ color: new THREE.Color(color).multiplyScalar(1.6), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const tentacles = [];
  for (let i = 0; i < 8; i++) {
    const pts = new Float32Array(14 * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pts, 3));
    const line = new THREE.Line(geo, tentMat);
    line.frustumCulled = false;
    g.add(line);
    tentacles.push({ geo, pts, a: (i / 8) * Math.PI * 2 });
  }
  return {
    group: g,
    flash: [],
    anim: (t) => {
      bellMat.uniforms.time.value = t;
      core.rotation.y = t * 1.5;
      for (const tc of tentacles) {
        for (let k = 0; k < 14; k++) {
          const s = k / 13;
          const r = 2.6 * (1 - s * 0.6);
          tc.pts[k * 3] = Math.cos(tc.a) * r + Math.sin(t * 3 + k * 0.5 + tc.a) * s * 1.6;
          tc.pts[k * 3 + 1] = Math.sin(tc.a) * r + Math.cos(t * 2.6 + k * 0.4 + tc.a) * s * 1.6;
          tc.pts[k * 3 + 2] = -s * 11;
        }
        tc.geo.attributes.position.needsUpdate = true;
      }
    },
    disposeExtra: [halo.material, tentMat],
  };
}

function buildBoss(def, index) {
  const g = new THREE.Group();
  const R = def.radius;
  const body = skin(def.color, { emissive: 0.12, rim: 1.4, flat: index === 2 || index === 3, base: 0x120e1a });
  const accent = skin(def.accent, { emissive: 0.8, rim: 2, base: 0x2a1c10 });
  const eyeMat = glowMat(def.accent, 4);
  const parts = { segments: [] };

  if (index === 3) {
    // Ancient Sentinel: mechanical core with rotating rings and shield plates
    const core = new THREE.Mesh(new THREE.OctahedronGeometry(R * 0.55, 1), body);
    g.add(core);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(R * 0.16, 20, 14), eyeMat);
    eye.position.z = R * 0.42;
    g.add(eye);
    parts.rings = [];
    for (let k = 0; k < 3; k++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(R * (0.8 + k * 0.22), R * 0.03, 8, 96), accent);
      ring.rotation.set(Math.random() * 3, Math.random() * 3, 0);
      g.add(ring);
      parts.rings.push(ring);
    }
    parts.plates = new THREE.Group();
    for (let k = 0; k < 8; k++) {
      const plate = new THREE.Mesh(new THREE.BoxGeometry(R * 0.3, R * 0.5, R * 0.06), body);
      const a = (k / 8) * Math.PI * 2;
      plate.position.set(Math.cos(a) * R * 1.3, Math.sin(a) * R * 1.3, 0);
      plate.rotation.z = a;
      parts.plates.add(plate);
    }
    g.add(parts.plates);
  } else {
    const headGeo = index === 2 ? new THREE.DodecahedronGeometry(1, 1) : new THREE.SphereGeometry(1, 40, 24);
    const head = new THREE.Mesh(headGeo, body);
    head.scale.set(R * 0.5, R * 0.42, R * (index === 4 ? 0.5 : 0.9));
    g.add(head);
    const segCount = index === 1 ? 12 : index === 4 ? 0 : 7;
    for (let i = 0; i < segCount; i++) {
      const s = 1 - i / (segCount + 2);
      const seg = new THREE.Mesh(index === 2 ? new THREE.DodecahedronGeometry(1, 0) : new THREE.SphereGeometry(1, 24, 14), body);
      seg.scale.set(R * 0.36 * s, R * 0.32 * s, R * 0.38 * s);
      seg.position.z = -R * (0.75 + i * (index === 1 ? 0.36 : 0.42));
      const ring = new THREE.Mesh(new THREE.TorusGeometry(R * 0.38 * s, R * 0.022, 6, 32), accent);
      ring.position.copy(seg.position);
      const spine = new THREE.Mesh(new THREE.ConeGeometry(R * 0.05 * s, R * 0.3 * s, 5), accent);
      spine.position.copy(seg.position).add(new THREE.Vector3(0, R * 0.32 * s, 0));
      spine.userData.dy = R * 0.32 * s;
      g.add(seg, ring, spine);
      parts.segments.push([seg, ring, spine]);
    }
    if (index === 0) {
      const fluke = new THREE.Mesh(new THREE.ConeGeometry(R * 0.5, R * 0.2, 3).rotateX(Math.PI / 2).scale(1.8, 0.2, 1), accent);
      fluke.position.z = -R * 3.8;
      g.add(fluke);
      parts.segments.push([fluke]);
    }
    for (const side of [-1, 1]) {
      const fin = new THREE.Mesh(new THREE.ConeGeometry(R * 0.18, R * (index === 1 ? 1.6 : 1.1), 4), accent);
      fin.position.set(side * R * 0.6, 0, -R * 0.1);
      fin.rotation.z = side * -Math.PI / 2.3;
      fin.rotation.x = -0.6;
      g.add(fin);
      for (let h = 0; h < (index === 1 ? 3 : 2); h++) {
        const horn = new THREE.Mesh(new THREE.ConeGeometry(R * 0.06, R * 0.65, 6), accent);
        horn.position.set(side * R * (0.2 + h * 0.12), R * 0.35, R * (0.55 - h * 0.15));
        horn.rotation.x = -1.0;
        horn.rotation.z = side * -0.4;
        g.add(horn);
      }
      const eye = new THREE.Mesh(new THREE.SphereGeometry(R * 0.07, 14, 10), eyeMat);
      eye.position.set(side * R * 0.22, R * 0.12, R * (index === 4 ? 0.45 : 0.85));
      g.add(eye);
    }
    if (index === 4) {
      parts.maw = new THREE.Group();
      for (let k = 0; k < 16; k++) {
        const tooth = new THREE.Mesh(new THREE.ConeGeometry(R * 0.045, R * 0.3, 5), eyeMat);
        const a = (k / 16) * Math.PI * 2;
        tooth.position.set(Math.cos(a) * R * 0.3, Math.sin(a) * R * 0.3, 0);
        tooth.rotation.set(Math.PI / 2, 0, a - Math.PI / 2);
        parts.maw.add(tooth);
      }
      parts.maw.position.z = R * 0.5;
      g.add(parts.maw);
      parts.tentacles = [];
      const tMat = new THREE.LineBasicMaterial({ color: new THREE.Color(def.color).multiplyScalar(2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
      parts.tMat = tMat;
      for (let k = 0; k < 10; k++) {
        const pts = new Float32Array(16 * 3);
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pts, 3));
        const line = new THREE.Line(geo, tMat);
        line.frustumCulled = false;
        g.add(line);
        parts.tentacles.push({ geo, pts, a: (k / 10) * Math.PI * 2 });
      }
      parts.rings = [];
      for (let k = 0; k < 3; k++) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(R * (0.95 + k * 0.2), R * 0.015, 6, 96), accent);
        ring.rotation.set(Math.random() * 3, Math.random() * 3, 0);
        g.add(ring);
        parts.rings.push(ring);
      }
    }
  }
  const aura = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: new THREE.Color(def.color).multiplyScalar(0.45), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.35 }));
  aura.scale.setScalar(R * 4);
  g.add(aura);
  return {
    group: g,
    flash: [body, accent],
    anim: (t) => {
      parts.segments.forEach((arr, i) => {
        const x = Math.sin(t * 1.5 - i * 0.55) * R * 0.05 * (i + 1);
        const y = Math.cos(t * 1.1 - i * 0.4) * R * 0.02 * (i + 1);
        for (const m of arr) { m.position.x = x; m.position.y = y + (m.userData.dy || 0); }
      });
      if (parts.rings) parts.rings.forEach((r, i) => { r.rotation.y += 0.004 * (i + 1); r.rotation.x += 0.003 * (i + 1); });
      if (parts.plates) parts.plates.rotation.z = t * 0.4;
      if (parts.maw) parts.maw.rotation.z = t * 0.8;
      if (parts.tentacles) {
        for (const tc of parts.tentacles) {
          for (let k = 0; k < 16; k++) {
            const s = k / 15;
            const r = R * 0.35 * (1 + s * 0.6);
            tc.pts[k * 3] = Math.cos(tc.a) * r + Math.sin(t * 2 + k * 0.4 + tc.a) * s * R * 0.4;
            tc.pts[k * 3 + 1] = Math.sin(tc.a) * r + Math.cos(t * 1.7 + k * 0.35 + tc.a) * s * R * 0.4;
            tc.pts[k * 3 + 2] = -s * R * 2.4;
          }
          tc.geo.attributes.position.needsUpdate = true;
        }
      }
    },
    disposeExtra: [aura.material, ...(parts.tMat ? [parts.tMat] : [])],
  };
}

const BUILDERS = { mite: buildMite, ray: buildRay, rockback: buildRockback, wraith: buildWraith };
const def0 = (b) => b.def;

// ----------------------------------------------------------- manager --
export class BeastManager {
  constructor(scene, particles, combat, sound) {
    this.scene = scene;
    this.particles = particles;
    this.combat = combat;
    this.sound = sound;
    this.beasts = [];
    this.groupId = 0;
    this.uid = 0;
    this.species = new Map();
    this.system = null;
    this.onKill = null;
  }

  // The environment supplies spawning, terrain and collision for the current
  // frame (a planet surface or open space). See Game.beastEnv().
  setEnv(env) {
    this.env = env;
    this.spawnTimer = Math.min(this.spawnTimer ?? 2, 2);
  }

  spawnRandomGroup(playerPos) {
    const env = this.env;
    if (!env || !env.spawn) return;
    const sp = env.spawn(playerPos);
    if (!sp) return;
    const tier = sp.tier;
    const roll = Math.random();
    let type;
    if (sp.kind === 'ground' && env.species && env.species.length) {
      const def = pickSpecies(env.species, tier);
      this.species.set(def.id, def);
      const n = def.pack[0] + Math.floor(Math.random() * (def.pack[1] - def.pack[0] + 1));
      this.spawnGroup(def.id, sp.pos, n, tier);
      return;
    }
    if (sp.kind === 'belt') type = roll < 0.6 ? 'rockback' : 'mite';
    else if (sp.kind === 'hotspot') type = tier >= 2 && roll < 0.45 ? 'wraith' : roll < 0.75 ? 'ray' : 'mite';
    else if (sp.kind === 'ground') type = roll < 0.5 ? 'mite' : roll < 0.75 ? 'ray' : tier >= 1 ? 'rockback' : 'mite';
    else type = roll < 0.45 ? 'mite' : roll < 0.8 ? 'ray' : tier >= 1 ? 'rockback' : 'mite';
    if (tier >= 2 && roll > 0.9) type = 'wraith';
    const counts = { mite: [2, 5], ray: [1, 3], rockback: [1, 2], wraith: [1, 2] }[type];
    const n = counts[0] + Math.floor(Math.random() * (counts[1] - counts[0] + 1));
    this.spawnGroup(type, sp.pos, n, tier);
  }

  // Inert targets such as ore deposits: they take hits and drop loot.
  spawnStatic({ pos, radius, hp, name, cn = '', color = 0x3ef2ff, onKill, tier = 0, cores = 0 }) {
    const holder = new THREE.Object3D();
    holder.position.copy(pos);
    this.scene.add(holder);
    const b = {
      uid: ++this.uid, type: 'static', def: { name, behavior: 'static', aggro: 0, radius, xp: 0.4, coins: 0.3, cores, color, speed: 0 },
      model: { group: holder, flash: [], anim: () => {} }, mesh: holder, pos: holder.position, vel: new THREE.Vector3(),
      hp, maxHp: hp, dmg: 0, tier, radius, elite: false, boss: false, static: true, name, cn,
      home: pos.clone(), wander: new THREE.Vector3(), wanderT: 0, gid: 0, alive: true, aggro: false,
      cd: 0, cd2: 0, cd3: 0, state: 'move', stateT: 0, flashT: 0, phase: 0, lastHit: -99, xpMult: 1, coinMult: 1, onKill,
    };
    this.beasts.push(b);
    return b;
  }

  removeBeast(b) {
    if (!b.alive) return;
    b.alive = false;
    this.removeModel(b);
    this.beasts.splice(this.beasts.indexOf(b), 1);
  }

  rebase(m, q) {
    for (const b of this.beasts) {
      b.pos.applyMatrix4(m);
      b.home.applyMatrix4(m);
      b.vel.applyQuaternion(q);
      b.mesh.quaternion.premultiply(q);
      if (b.chargeDir) b.chargeDir.applyQuaternion(q);
    }
  }

  spawnGroup(type, center, n, tier, aggro = false) {
    const gid = ++this.groupId;
    const out = [];
    for (let i = 0; i < n; i++) {
      const spread = this.species.has(type) ? 30 : 60;
      const pos = center.clone().add(new THREE.Vector3((Math.random() - 0.5) * spread, (Math.random() - 0.5) * spread * 0.5, (Math.random() - 0.5) * spread));
      out.push(this.spawn(type, pos, tier, { gid, elite: Math.random() < 0.08, aggro }));
    }
    return out;
  }

  spawn(type, pos, tier, { gid = 0, elite = false, aggro = false } = {}) {
    const def = BEASTS[type] || this.species.get(type);
    const model = BUILDERS[type] ? BUILDERS[type](elite ? 0xffd040 : def.color) : buildCreature(def, elite ? 0xffd040 : null);
    // higher-grade beasts are visibly bigger
    const scale = (elite ? 1.35 : 1) * (1 + Math.min(0.8, Math.max(0, tier) * 0.12));
    model.group.scale.multiplyScalar(scale);
    model.group.position.copy(pos);
    this.scene.add(model.group);
    const hp = 60 * power(tier) * def.hp * (elite ? 2.4 : 1);
    const b = {
      uid: ++this.uid, type, def, model, mesh: model.group, pos: model.group.position, vel: new THREE.Vector3(),
      hp, maxHp: hp, dmg: 8 * power(tier) * def.dmg * (elite ? 1.4 : 1),
      tier: tier + (elite ? 0.5 : 0), radius: def.radius * scale, elite, boss: false,
      name: `${elite ? 'Elite ' : ''}${def.name}`, cn: def.cn,
      home: pos.clone(), wander: new THREE.Vector3(), wanderT: 0, gid, alive: true, aggro,
      cd: Math.random() * 2, cd2: 2 + Math.random() * 3, cd3: 0, state: 'move', stateT: 0, flashT: 0,
      phase: Math.random() * 10, lastHit: -99, xpMult: elite ? 2.5 : 1, coinMult: elite ? 3 : 1,
    };
    this.beasts.push(b);
    return b;
  }

  spawnBoss(index, pos, tier) {
    const def = BOSSES[index];
    const model = buildBoss(def, index);
    model.group.position.copy(pos);
    this.scene.add(model.group);
    const hp = 60 * power(tier) * def.hp;
    const b = {
      uid: ++this.uid, type: 'boss', bossIndex: index, def: { ...def, behavior: 'boss', aggro: 900, cores: 30 }, model, mesh: model.group, pos: model.group.position,
      vel: new THREE.Vector3(), hp, maxHp: hp, dmg: 8 * power(tier) * def.dmg, tier, radius: def.radius * 0.8, elite: false, boss: true,
      name: def.name, cn: def.cn, home: pos.clone(), wander: new THREE.Vector3(), wanderT: 0, gid: -1, alive: true, aggro: false,
      cd: 2.5, cd2: 12, cd3: 0, state: 'move', stateT: 0, flashT: 0, phase: 0, pattern: 0, orbitA: 0, streamT: 0, lastHit: -99,
      xpMult: 1, coinMult: 1,
    };
    this.beasts.push(b);
    this.boss = b;
    return b;
  }

  get liveBoss() {
    return this.boss && this.boss.alive ? this.boss : null;
  }

  damage(b, amount, time, knock) {
    if (!b.alive) return false;
    b.hp -= amount;
    b.flashT = 0.1;
    b.lastHit = time;
    if (knock && !b.boss) b.vel.add(knock);
    if (!b.aggro) {
      b.aggro = true;
      if (b.gid > 0) for (const o of this.beasts) if (o.gid === b.gid && o.pos.distanceTo(b.pos) < 700) o.aggro = true;
    }
    if (b.hp <= 0) {
      this.kill(b);
      return true;
    }
    return false;
  }

  kill(b) {
    b.alive = false;
    if (b.static) {
      this.particles.burst(b.pos, new THREE.Color(b.def.color).multiplyScalar(2), 60, 40, 1.4, 1.2, 1.5);
      this.sound.explosion(b.pos, false);
      this.removeModel(b);
      this.beasts.splice(this.beasts.indexOf(b), 1);
      if (b.onKill) b.onKill(b);
      if (this.onKill) this.onKill(b);
      return;
    }
    const c = b.boss ? b.def.color : b.elite ? 0xffd040 : b.def.color;
    this.combat.explosion(b.pos, c, b.boss ? 6 : Math.max(1, b.radius / 4));
    this.combat.debris(b.pos, c, b.boss ? 40 : Math.round(6 + b.radius), b.radius * 0.25);
    if (b.boss) {
      this.combat.shockwave(b.pos, 450, b.def.accent, 1.4);
      this.particles.burst(b.pos, new THREE.Color(b.def.accent).multiplyScalar(2), 300, 260, 5, 2.5, 0.8);
    }
    this.sound.explosion(b.pos, b.boss || b.type === 'rockback');
    this.removeModel(b);
    this.beasts.splice(this.beasts.indexOf(b), 1);
    if (this.onKill) this.onKill(b);
  }

  removeModel(b) {
    this.scene.remove(b.mesh);
    b.mesh.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material && !o.isSprite) o.material.dispose();
    });
    if (b.model.disposeExtra) b.model.disposeExtra.forEach((m) => m.dispose());
  }

  clear() {
    for (const b of this.beasts) this.removeModel(b);
    this.beasts = [];
    this.boss = null;
  }

  aimAt(b, player, speed) {
    const d = b.pos.distanceTo(player.pos);
    return tmpA.copy(player.pos).addScaledVector(player.vel, d / speed).sub(b.pos).normalize().clone();
  }

  face(b, dir, dt, rate = 6, up = UP) {
    if (dir.lengthSq() < 0.0001) return;
    tmpM.lookAt(tmpB.copy(b.pos).add(dir), b.pos, up);
    tmpQ.setFromRotationMatrix(tmpM);
    b.mesh.quaternion.slerp(tmpQ, 1 - Math.exp(-dt * rate));
  }

  // Count of beasts currently hunting the player (drives the combat music).
  aggroCount() {
    let n = 0;
    for (const b of this.beasts) if (b.aggro) n += b.boss ? 4 : 1;
    return n;
  }

  update(dt, ctx) {
    const { player, playerAlive, time } = ctx;
    const env = this.env;
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0 && env) {
      this.spawnTimer = env.interval ?? 6;
      const normal = this.beasts.filter((b) => !b.boss && !b.static).length;
      if (normal < (env.max ?? 0) && playerAlive) this.spawnRandomGroup(player.pos);
    }
    // despawn stragglers far behind
    if (env) {
      for (let i = this.beasts.length - 1; i >= 0; i--) {
        const b = this.beasts[i];
        if (b.boss || b.static || b.aggro || b.tag) continue;
        if (b.pos.distanceTo(player.pos) > (env.despawn ?? 3000)) this.removeBeast(b);
      }
    }

    for (const b of this.beasts) {
      if (b.static) {
        if (b.flashT > 0) b.flashT -= dt;
        continue;
      }
      // status effects
      b.stunT = Math.max(0, (b.stunT || 0) - dt);
      b.fleeT = Math.max(0, (b.fleeT || 0) - dt);
      b.markT = Math.max(0, (b.markT || 0) - dt);
      if (b.held) {
        b.vel.set(0, 0, 0);
        b.model.anim(time * 3 + b.phase);
        if (b.flashT > 0) b.flashT -= dt;
        continue;
      }
      const disabled = b.stunT > 0 || b.fleeT > 0;
      const ground = env && env.ground ? env.ground(b.pos) : null;
      const bUp = ground ? ground.up : UP;
      const walker = def0(b).walker ?? (b.type === 'mite' || b.type === 'rockback');
      const toP = tmpA.subVectors(player.pos, b.pos);
      const d = toP.length();
      const dirP = toP.clone().divideScalar(Math.max(d, 0.001));
      const desired = new THREE.Vector3();
      const def = b.def;
      let faceDir = null;

      if (!b.aggro && playerAlive && d < def.aggro + b.radius) b.aggro = true;
      if (b.aggro && (!playerAlive || d > 1900 || b.pos.distanceTo(b.home) > 2600)) {
        b.aggro = false;
        b.hp = b.maxHp;
        b.state = 'move';
      }

      if (b.stunT > 0) {
        desired.set(0, 0, 0);
      } else if (b.fleeT > 0) {
        desired.copy(dirP).multiplyScalar(-def.speed * 1.3);
      } else if (!b.aggro) {
        b.wanderT -= dt;
        if (b.wanderT <= 0) {
          b.wanderT = 3 + Math.random() * 4;
          b.wander.set((Math.random() - 0.5) * 240, (Math.random() - 0.5) * 80, (Math.random() - 0.5) * 240);
        }
        desired.copy(b.home).add(b.wander).sub(b.pos);
        const dl = desired.length();
        desired.multiplyScalar(dl > 20 ? (def.speed * 0.35) / dl : 0);
      } else if (def.behavior === 'swarm') {
        const side = new THREE.Vector3().crossVectors(dirP, bUp).normalize().multiplyScalar(Math.sin(time * 2 + b.phase) * 0.6);
        desired.copy(dirP).add(side).normalize().multiplyScalar(def.speed * 1.15);
      } else if (def.behavior === 'ranged') {
        const ideal = 190;
        const radial = d > ideal + 30 ? 1 : d < ideal - 30 ? -1 : 0;
        const side = new THREE.Vector3().crossVectors(dirP, bUp).normalize();
        desired.copy(dirP).multiplyScalar(radial).addScaledVector(side, Math.sin(time * 0.5 + b.phase) > 0 ? 0.8 : -0.8).normalize().multiplyScalar(def.speed);
        faceDir = dirP;
        b.cd -= dt;
        if (b.cd <= 0 && d < 600 && playerAlive && !disabled) {
          b.cd = def.fireRate * (0.8 + Math.random() * 0.4);
          const muzzle = b.pos.clone().addScaledVector(dirP, b.radius);
          this.combat.enemyShot(muzzle, this.aimAt(b, player, def.shotSpeed), def.shotSpeed, b.dmg, b.elite ? 0xffd040 : def.color, 1.5);
        }
      } else if (def.behavior === 'tank') {
        b.cd2 -= dt;
        if (b.state === 'move') {
          desired.copy(dirP).multiplyScalar(def.speed);
          if (b.cd2 <= 0 && d < 420) { b.state = 'windup'; b.stateT = 0.8; }
        } else if (b.state === 'windup') {
          b.stateT -= dt;
          faceDir = dirP;
          b.pos.x += (Math.random() - 0.5) * 0.8;
          if (Math.random() < 0.5) this.particles.converge(b.pos, new THREE.Color(2, 0.8, 0.3), 2, b.radius * 2, b.radius * 3, 2);
          if (b.stateT <= 0) { b.state = 'charge'; b.stateT = 1.2; b.chargeDir = dirP.clone(); }
        } else if (b.state === 'charge') {
          b.stateT -= dt;
          desired.copy(b.chargeDir).multiplyScalar(def.speed * 5.5);
          if (Math.random() < 0.7) this.particles.emit(b.pos.x, b.pos.y, b.pos.z, 0, 0, 0, new THREE.Color(2, 0.8, 0.3), 4, 0.5, 0, 1);
          if (b.stateT <= 0) { b.state = 'move'; b.cd2 = 5 + Math.random() * 2; }
        }
      } else if (def.behavior === 'blink') {
        desired.copy(dirP).multiplyScalar(d > 140 ? def.speed : -def.speed * 0.4);
        faceDir = dirP;
        b.cd2 -= dt;
        b.cd -= dt;
        if (b.cd2 <= 0 && playerAlive && d < 700) {
          b.cd2 = 4 + Math.random() * 2;
          this.particles.burst(b.pos, new THREE.Color(def.color).multiplyScalar(2), 30, 60, 2.5, 0.6);
          const off = new THREE.Vector3(Math.random() - 0.5, (Math.random() - 0.5) * 0.5, Math.random() - 0.5).normalize().multiplyScalar(90 + Math.random() * 40);
          b.pos.copy(player.pos).add(off);
          b.vel.set(0, 0, 0);
          this.particles.burst(b.pos, new THREE.Color(def.color).multiplyScalar(2), 30, 60, 2.5, 0.6);
          b.cd = 0.35;
          b.burst = 3;
        }
        if (b.burst > 0 && b.cd <= 0) {
          b.burst--;
          b.cd = 0.18;
          this.combat.enemyShot(b.pos.clone(), this.aimAt(b, player, def.shotSpeed), def.shotSpeed, b.dmg * 0.6, def.color, 1.2);
        }
      } else if (def.behavior === 'boss') {
        this.updateBoss(b, dt, ctx, d, dirP, desired);
        faceDir = b.state === 'charge' ? b.chargeDir : dirP;
      }

      for (const o of this.beasts) {
        if (o === b) continue;
        const sep = tmpB.subVectors(b.pos, o.pos);
        const sd = sep.length();
        const min = b.radius + o.radius + 2;
        if (sd < min && sd > 0.001) desired.addScaledVector(sep.divideScalar(sd), (min - sd) * 6);
      }

      if (ctx.slowAt) desired.multiplyScalar(ctx.slowAt(b));
      const accel = b.state === 'charge' ? 6 : 2.2;
      if (ground && walker) desired.addScaledVector(ground.up, -desired.dot(ground.up));
      b.vel.lerp(desired, 1 - Math.exp(-dt * accel));
      b.pos.addScaledVector(b.vel, dt);
      if (env && env.resolve) env.resolve(b.pos, b.radius);
      if (ground) {
        const D = b.pos.length();
        const g2 = env.ground(b.pos);
        const floor = g2.floorR + b.radius * (walker ? (def.footing ?? 0.75) : 1);
        if (walker) b.pos.multiplyScalar(floor / D);
        else {
          const hover = floor + (b.boss ? 60 : 18 + (b.phase % 1) * 20);
          if (D < hover) b.pos.multiplyScalar((D + (hover - D) * Math.min(1, dt * 3)) / D);
        }
      }
      let fd = faceDir || (b.vel.lengthSq() > 4 ? b.vel.clone().normalize() : dirP);
      if (ground && walker) fd = fd.clone().addScaledVector(bUp, -fd.dot(bUp)).normalize();
      this.face(b, fd, dt, b.boss ? 2.5 : 6, bUp);

      if (playerAlive && b.aggro && !disabled && d < b.radius + player.radius + 1.5) {
        b.cd3 -= dt;
        if (b.cd3 <= 0) {
          b.cd3 = 1.0;
          const mult = b.state === 'charge' ? 2 : 1;
          ctx.hurtPlayer(b.dmg * mult * (b.boss ? 1.2 : 1), b.pos.clone(), dirP.clone().multiplyScalar(b.boss ? 160 : 90));
        }
      } else if (b.cd3 > 0) {
        b.cd3 -= dt;
      }

      b.model.anim(time + b.phase, b.vel.length(), b);
      if (b.flashT > 0) b.flashT -= dt;
      const f = b.flashT > 0 ? 4 : 1;
      for (const m of b.model.flash) {
        const u = m.userData.rim;
        if (u) {
          if (u.base === undefined) u.base = u.rimStrength.value;
          u.rimStrength.value = u.base * f;
        }
      }
    }
  }

  updateBoss(b, dt, ctx, d, dirP, desired) {
    const { player, playerAlive } = ctx;
    if (!b.aggro) {
      desired.copy(b.home).sub(b.pos).multiplyScalar(0.5);
      return;
    }
    const enraged = b.hp < b.maxHp * 0.4;
    b.cd -= dt;
    b.cd2 -= dt;
    if (b.state === 'windup') {
      b.stateT -= dt;
      if (Math.random() < 0.5) this.particles.converge(b.pos, new THREE.Color(b.def.accent).multiplyScalar(2), 3, b.radius * 2.5, b.radius * 4, 4);
      if (b.stateT <= 0) { b.state = 'charge'; b.stateT = 1.4; b.chargeDir = dirP.clone(); }
      return;
    }
    if (b.state === 'charge') {
      b.stateT -= dt;
      desired.copy(b.chargeDir).multiplyScalar(b.def.speed * 5);
      if (b.stateT <= 0) b.state = 'move';
      return;
    }
    b.orbitA += dt * 0.35;
    const away = tmpB.subVectors(b.pos, player.pos).setY(0).normalize();
    const tangent = new THREE.Vector3().crossVectors(UP, away);
    desired.copy(away).multiplyScalar((300 - d) * 0.8).addScaledVector(tangent, b.def.speed);
    desired.y += (player.pos.y + Math.sin(b.orbitA) * 60 - b.pos.y) * 0.8;

    if (b.streamT > 0) {
      b.streamT -= dt;
      b.streamCd = (b.streamCd || 0) - dt;
      if (b.streamCd <= 0 && playerAlive) {
        b.streamCd = enraged ? 0.08 : 0.13;
        this.combat.enemyShot(b.pos.clone().addScaledVector(dirP, b.radius), this.aimAt(b, player, 240), 240, b.dmg * 0.5, b.def.accent, 2.2);
      }
    }
    if (b.cd <= 0 && playerAlive) {
      const patterns = ['fan', 'stream', 'charge', 'fan', 'nova'];
      const p = patterns[b.pattern++ % patterns.length];
      b.cd = enraged ? 2.2 : 3.4;
      if (p === 'fan') {
        const n = 11 + b.bossIndex * 2 + (enraged ? 6 : 0);
        const side = new THREE.Vector3().crossVectors(dirP, UP).normalize();
        for (let k = 0; k < n; k++) {
          const a = (k / (n - 1) - 0.5) * 1.1;
          const dir = dirP.clone().multiplyScalar(Math.cos(a)).addScaledVector(side, Math.sin(a)).normalize();
          dir.y += (Math.random() - 0.5) * 0.08;
          this.combat.enemyShot(b.pos.clone().addScaledVector(dirP, b.radius), dir, 160, b.dmg * 0.7, b.def.color, 2.6);
        }
      } else if (p === 'stream') {
        b.streamT = 1.8;
      } else if (p === 'charge') {
        b.state = 'windup';
        b.stateT = 0.9;
      } else if (p === 'nova') {
        const n = 26 + (enraged ? 12 : 0);
        for (let k = 0; k < n; k++) {
          const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u);
          const dir = new THREE.Vector3(s * Math.cos(th), u * 0.6, s * Math.sin(th)).normalize();
          this.combat.enemyShot(b.pos.clone().addScaledVector(dir, b.radius), dir, 120, b.dmg * 0.6, b.def.accent, 2.4);
        }
      }
    }
    if (b.cd2 <= 0) {
      b.cd2 = enraged ? 10 : 15;
      const minions = this.spawnGroup('mite', b.pos.clone().add(new THREE.Vector3(0, b.radius, 0)), 4, Math.max(0, b.tier - 0.6), true);
      minions.forEach((m) => { m.home.copy(b.home); });
    }
  }

  nearest(pos, maxDist = Infinity) {
    let best = null, bd = maxDist;
    for (const b of this.beasts) {
      const d = b.pos.distanceTo(pos);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }
}
