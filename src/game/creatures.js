import * as THREE from 'three';
import { bevelBox } from '../world/geometry.js';
import { rimMaterial } from '../world/models.js';

// Procedural planet-bound beasts. Every builder works in a unit frame where
// the creature is about two units long along +Z, then scales to the
// species radius. anim(t, speed) drives a gait from actual movement speed.

const glow = (color, mul = 3) => new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(mul) });

function hide(color, accent, opts = {}) {
  return rimMaterial({
    color: new THREE.Color(color),
    emissive: new THREE.Color(accent),
    emissiveIntensity: opts.emissive ?? 0.05,
    metalness: opts.metal ?? 0.15,
    roughness: opts.rough ?? 0.7,
    flatShading: opts.flat ?? false,
    rim: accent,
    rimPower: 2.6,
    rimStrength: opts.rim ?? 0.45,
  });
}

function limb(len, r0, r1, mat) {
  return new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, len, 6).translate(0, -len / 2, 0), mat);
}

function eyes(group, accent, x, y, z, r = 0.06) {
  const m = glow(accent, 4);
  for (const s of [-1, 1]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), m);
    e.position.set(s * x, y, z);
    group.add(e);
  }
}

// Two-segment leg on a hip pivot; returns { hip, knee }.
function leg(parent, x, y, z, upper, lower, mat, thick = 0.09) {
  const hip = new THREE.Group();
  hip.position.set(x, y, z);
  hip.add(limb(upper, thick, thick * 0.8, mat));
  const knee = new THREE.Group();
  knee.position.y = -upper;
  knee.add(limb(lower, thick * 0.8, thick * 0.55, mat));
  hip.add(knee);
  parent.add(hip);
  return { hip, knee };
}

// ------------------------------------------------------------ quadruped --
const QUAD = {
  wolf: { body: [0.42, 0.42, 1.0], legU: 0.42, legL: 0.42, neck: 0.25, head: 0.28, snout: 0.3, tail: 5, tailLen: 0.9, horns: 0, spikes: 0.4, ear: true },
  rhino: { body: [0.65, 0.6, 1.0], legU: 0.32, legL: 0.3, neck: 0.15, head: 0.36, snout: 0.25, tail: 2, tailLen: 0.3, horns: 1, spikes: 0, plates: true },
  lizard: { body: [0.4, 0.28, 1.0], legU: 0.3, legL: 0.28, neck: 0.25, head: 0.26, snout: 0.35, tail: 8, tailLen: 1.6, horns: 0, spikes: 0.8, sprawl: true },
  bear: { body: [0.6, 0.6, 0.9], legU: 0.4, legL: 0.36, neck: 0.12, head: 0.34, snout: 0.2, tail: 1, tailLen: 0.15, horns: 0, spikes: 0.5, ear: true },
};

function buildQuad(spec) {
  const P = QUAD[spec.variant] || QUAD.wolf;
  const g = new THREE.Group();
  const rig = new THREE.Group();
  g.add(rig);
  const mat = hide(spec.color, spec.accent);
  const dark = hide(new THREE.Color(spec.color).multiplyScalar(0.55), spec.accent, { rim: 0.3 });
  const accent = glow(spec.accent, 2.2);
  const legH = P.legU + P.legL;
  const bodyY = legH * (P.sprawl ? 0.55 : 0.92);
  const body = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 9), mat);
  body.scale.set(P.body[0], P.body[1], P.body[2]);
  body.position.y = bodyY;
  rig.add(body);
  // neck + head
  const head = new THREE.Group();
  head.position.set(0, bodyY + P.body[1] * 0.45, P.body[2] * 0.9 + P.neck);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(P.head, 10, 8), mat);
  head.add(skull);
  const snout = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), dark);
  snout.scale.set(P.head * 0.45, P.head * 0.35, P.snout * 0.8);
  snout.position.set(0, -P.head * 0.2, P.head * 0.6 + P.snout * 0.5);
  head.add(snout);
  const jaw = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), dark);
  jaw.scale.set(P.head * 0.4, P.head * 0.125, P.snout * 0.7);
  jaw.position.set(0, -P.head * 0.6, P.head * 0.5 + P.snout * 0.45);
  head.add(jaw);
  eyes(head, spec.accent, P.head * 0.45, P.head * 0.2, P.head * 0.75, P.head * 0.16);
  if (P.ear) {
    for (const s of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(P.head * 0.28, P.head * 0.7, 4), dark);
      ear.position.set(s * P.head * 0.55, P.head * 0.75, -P.head * 0.1);
      head.add(ear);
    }
  }
  if (P.horns) {
    const horn = new THREE.Mesh(new THREE.ConeGeometry(P.head * 0.32, P.head * 1.8, 6).rotateX(Math.PI * 0.35), glow(spec.accent, 1.6));
    horn.position.set(0, P.head * 0.35, P.head * 0.9 + P.snout);
    head.add(horn);
    const horn2 = new THREE.Mesh(new THREE.ConeGeometry(P.head * 0.2, P.head * 0.9, 6).rotateX(Math.PI * 0.3), glow(spec.accent, 1.2));
    horn2.position.set(0, P.head * 0.6, P.head * 0.6);
    head.add(horn2);
  }
  if (spec.horns) {
    for (const s of [-1, 1]) {
      const h = new THREE.Mesh(new THREE.ConeGeometry(P.head * 0.14, P.head * 1.4, 5), accent);
      h.position.set(s * P.head * 0.5, P.head * 0.8, -P.head * 0.2);
      h.rotation.set(-0.6, 0, s * -0.4);
      head.add(h);
    }
  }
  rig.add(head);
  // back spikes / plates
  const spikes = spec.spikes ?? P.spikes;
  if (spikes > 0) {
    const n = 6;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const sp = new THREE.Mesh(new THREE.ConeGeometry(0.06 + spikes * 0.05, 0.25 + spikes * 0.3 * Math.sin(t * Math.PI), 4), i % 2 ? accent : dark);
      sp.position.set(0, bodyY + P.body[1] * 0.95, P.body[2] * (0.7 - t * 1.4));
      sp.rotation.x = -0.35;
      rig.add(sp);
    }
  }
  if (P.plates) {
    for (let i = 0; i < 4; i++) {
      const pl = new THREE.Mesh(bevelBox(P.body[0] * 1.6, 0.07, 0.3), dark);
      pl.position.set(0, bodyY + P.body[1] * 0.75, P.body[2] * (0.5 - i * 0.35));
      pl.rotation.x = 0.15;
      rig.add(pl);
    }
  }
  // glowing stripe
  const stripe = new THREE.Mesh(new THREE.TorusGeometry(P.body[0] * 1.02, 0.03, 4, 18), accent);
  stripe.position.set(0, bodyY, -P.body[2] * 0.2);
  stripe.scale.set(1, P.body[1] / P.body[0], 1);
  rig.add(stripe);
  // tail
  const tail = [];
  let parent = rig;
  let tz = -P.body[2] * 0.95;
  const segLen = P.tailLen / Math.max(1, P.tail);
  for (let i = 0; i < P.tail; i++) {
    const seg = new THREE.Group();
    if (i === 0) seg.position.set(0, bodyY + P.body[1] * 0.2, tz);
    else seg.position.z = -segLen;
    const r = 0.12 * (1 - i / (P.tail + 1)) * (P.tail > 4 ? 1.4 : 1);
    seg.add(new THREE.Mesh(new THREE.CylinderGeometry(r * 0.8, r, segLen * 1.1, 5).rotateX(Math.PI / 2).translate(0, 0, -segLen / 2), i === P.tail - 1 ? accent : mat));
    parent.add(seg);
    tail.push(seg);
    parent = seg;
    tz = 0;
  }
  // legs
  const legs = [];
  const lx = P.body[0] * (P.sprawl ? 1.1 : 0.62), lz = P.body[2] * 0.62;
  const lt = 0.07 + P.body[0] * 0.12;
  for (const [x, z, ph] of [[-lx, lz, 0], [lx, lz, Math.PI], [-lx, -lz, Math.PI], [lx, -lz, 0]]) {
    const l = leg(rig, x, bodyY - P.body[1] * 0.3, z, P.legU, P.legL, dark, lt);
    if (P.sprawl) l.hip.rotation.z = Math.sign(x) * 0.9;
    legs.push({ ...l, ph, side: Math.sign(x) });
  }
  rig.position.y = -bodyY * 0.02;
  // centre the creature on its body
  g.children.forEach((c) => { c.position.y -= bodyY * 0.85; });
  let phase = 0;
  return {
    group: g,
    flash: [mat, dark],
    anim(t, speed = 0) {
      const gait = Math.min(1, speed / 25);
      phase += Math.min(0.5, 0.06 + speed * 0.006);
      for (const l of legs) {
        const s = Math.sin(phase + l.ph);
        if (P.sprawl) {
          l.hip.rotation.x = s * 0.6 * (0.3 + gait);
          l.knee.rotation.z = -l.side * 1.2;
        } else {
          l.hip.rotation.x = s * 0.7 * (0.25 + gait);
          l.knee.rotation.x = Math.max(0, -Math.cos(phase + l.ph)) * 0.9 * (0.3 + gait);
        }
      }
      rig.position.y = Math.abs(Math.sin(phase)) * 0.05 * gait - bodyY * 0.85;
      head.rotation.x = Math.sin(phase * 2) * 0.06 + Math.sin(t * 0.7) * 0.05;
      tail.forEach((sgm, i) => { sgm.rotation.y = Math.sin(t * 3 + i * 0.6) * 0.25 * (P.tail > 4 ? 1 : 0.6); });
      jaw.rotation.x = Math.max(0, Math.sin(t * 2.3)) * 0.2;
    },
  };
}

// ------------------------------------------------------------------ bird --
function buildAvian(spec) {
  const g = new THREE.Group();
  const mat = hide(spec.color, spec.accent);
  const dark = hide(new THREE.Color(spec.color).multiplyScalar(0.6), spec.accent);
  const accent = glow(spec.accent, 2.2);
  const body = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), mat);
  body.scale.set(0.32, 0.3, 0.8);
  g.add(body);
  const head = new THREE.Group();
  head.position.set(0, 0.15, 0.8);
  head.add(new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), mat));
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.4, 5).rotateX(Math.PI / 2), accent);
  beak.position.set(0, -0.03, 0.3);
  head.add(beak);
  eyes(head, spec.accent, 0.11, 0.06, 0.15, 0.04);
  g.add(head);
  const wingShape = new THREE.Shape();
  wingShape.moveTo(0, 0);
  wingShape.lineTo(1.7, 0.35);
  wingShape.lineTo(2.1, -0.15);
  wingShape.lineTo(1.2, -0.45);
  wingShape.lineTo(0.3, -0.5);
  wingShape.lineTo(0, -0.3);
  const wingGeo = new THREE.ShapeGeometry(wingShape).rotateX(-Math.PI / 2);
  const wingMat = hide(spec.color, spec.accent, { rim: 0.6 });
  wingMat.side = THREE.DoubleSide;
  const wings = [];
  for (const s of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(s * 0.22, 0.1, 0.15);
    const w = new THREE.Mesh(wingGeo, wingMat);
    if (s < 0) w.scale.x = -1;
    pivot.add(w);
    const edge = new THREE.Mesh(bevelBox(2.0, 0.03, 0.03), accent);
    edge.position.set(s * 1.0, 0, 0.05);
    edge.rotation.y = s * -0.18;
    pivot.add(edge);
    g.add(pivot);
    wings.push({ pivot, s });
  }
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.7, 4).rotateX(-Math.PI / 2).scale(1, 0.2, 1), dark);
  tail.position.z = -0.95;
  g.add(tail);
  for (const s of [-1, 1]) {
    const talon = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.35, 4), accent);
    talon.position.set(s * 0.12, -0.32, 0.1);
    talon.rotation.x = 2.6;
    g.add(talon);
  }
  g.scale.setScalar(0.9);
  return {
    group: g,
    flash: [mat, dark, wingMat],
    anim(t) {
      const f = Math.sin(t * 7);
      for (const w of wings) w.pivot.rotation.z = w.s * (f * 0.7 + 0.1);
      body.position.y = -f * 0.05;
      head.rotation.y = Math.sin(t * 0.9) * 0.25;
    },
  };
}

// --------------------------------------------------------------- serpent --
function buildSerpent(spec) {
  const g = new THREE.Group();
  const mat = hide(spec.color, spec.accent);
  const dark = hide(new THREE.Color(spec.color).multiplyScalar(0.55), spec.accent);
  const accent = glow(spec.accent, 2);
  const n = 11;
  const segs = [];
  const segGeo = new THREE.SphereGeometry(1, 9, 7);
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const r = 0.36 * (1 - t * 0.7) * (i === 0 ? 1.15 : 1);
    const m = new THREE.Mesh(segGeo, i % 3 === 1 ? dark : mat);
    m.scale.set(r, r * 0.85, r * 1.25);
    g.add(m);
    if (i % 2 === 0 && i > 0) {
      const sp = new THREE.Mesh(new THREE.ConeGeometry(r * 0.3, r * 0.9, 4), accent);
      sp.position.y = r * 0.9;
      m.add(sp);
      sp.scale.set(1 / r, 1 / (r * 0.85), 1 / (r * 1.25));
      sp.scale.multiplyScalar(r);
    }
    segs.push({ m, r, z: 1.1 - t * 2.6 });
  }
  const head = segs[0].m;
  const jaw = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), dark);
  jaw.scale.set(0.25, 0.06, 0.3);
  jaw.position.set(0, -0.5, 0.6);
  head.add(jaw);
  for (const s of [-1, 1]) {
    const fang = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.4, 4), accent);
    fang.position.set(s * 0.3, -0.5, 0.9);
    fang.rotation.x = Math.PI;
    head.add(fang);
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), glow(spec.accent, 4));
    e.position.set(s * 0.5, 0.3, 0.7);
    head.add(e);
  }
  return {
    group: g,
    flash: [mat, dark],
    anim(t, speed = 0) {
      const k = 0.5 + Math.min(1, speed / 20);
      segs.forEach((s, i) => {
        s.m.position.set(Math.sin(t * 3 * k - i * 0.7) * 0.22 * (i / n + 0.2), Math.sin(t * 1.5 - i * 0.5) * 0.04, s.z);
      });
      jaw.rotation.x = Math.max(0, Math.sin(t * 2)) * 0.4;
    },
  };
}

// ---------------------------------------------------------------- insect --
function buildInsect(spec) {
  const g = new THREE.Group();
  const mat = hide(spec.color, spec.accent, { metal: 0.4, rough: 0.4 });
  const dark = hide(new THREE.Color(spec.color).multiplyScalar(0.5), spec.accent);
  const accent = glow(spec.accent, 2.2);
  const thorax = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), mat);
  thorax.scale.set(0.25, 0.25, 0.45);
  thorax.position.set(0, 0.55, 0.25);
  g.add(thorax);
  const abdomen = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), dark);
  abdomen.scale.set(0.32, 0.28, 0.6);
  abdomen.position.set(0, 0.6, -0.6);
  g.add(abdomen);
  const head = new THREE.Group();
  head.position.set(0, 0.85, 0.75);
  head.add(new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.32, 3).rotateX(Math.PI), mat));
  eyes(head, spec.accent, 0.13, 0.05, 0.05, 0.07);
  for (const s of [-1, 1]) {
    const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.015, 0.6, 3).translate(0, 0.3, 0), accent);
    ant.position.set(s * 0.07, 0.1, 0.05);
    ant.rotation.set(0.7, 0, s * 0.4);
    head.add(ant);
  }
  g.add(head);
  // scythes
  const scythes = [];
  for (const s of [-1, 1]) {
    const arm = new THREE.Group();
    arm.position.set(s * 0.16, 0.7, 0.5);
    arm.add(limb(0.45, 0.05, 0.04, dark));
    const blade = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.6, 3).translate(0, 0.3, 0), accent);
    blade.position.y = -0.45;
    blade.rotation.x = 2.4;
    arm.add(blade);
    arm.rotation.x = -1.3;
    g.add(arm);
    scythes.push(arm);
  }
  const legs = [];
  for (const s of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const l = leg(g, s * 0.2, 0.55, 0.35 - i * 0.28, 0.4, 0.55, dark, 0.035);
      l.hip.rotation.z = s * 1.0;
      l.knee.rotation.z = -s * 1.6;
      legs.push({ ...l, s, ph: i * 2.1 + (s > 0 ? Math.PI : 0) });
    }
  }
  g.children.forEach((c) => { c.position.y -= 0.45; });
  return {
    group: g,
    flash: [mat, dark],
    anim(t, speed = 0) {
      const k = 2 + Math.min(16, speed * 0.25);
      for (const l of legs) l.hip.rotation.x = Math.sin(t * k + l.ph) * 0.5;
      scythes.forEach((a, i) => { a.rotation.x = -1.3 + Math.max(0, Math.sin(t * 5 + i * 1.7)) * 0.8; });
      head.rotation.y = Math.sin(t * 1.3) * 0.3;
    },
  };
}

// ----------------------------------------------------------------- golem --
function rockGeo(seed) {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const p = g.attributes.position;
  const glowA = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = Math.sin(x * 3.1 + seed) * Math.cos(y * 2.7 + seed * 0.3) + Math.sin(z * 3.7 + x);
    const s = 1 + n * 0.16;
    p.setXYZ(i, x * s, y * s, z * s);
    glowA[i] = Math.abs(n) < 0.18 ? 1 : 0;
  }
  g.setAttribute('glow', new THREE.BufferAttribute(glowA, 1));
  g.computeVertexNormals();
  return g;
}

function crack(base, glowColor) {
  const m = new THREE.MeshStandardMaterial({ color: base, roughness: 0.95, metalness: 0.05, flatShading: true, emissive: new THREE.Color(glowColor), emissiveIntensity: 1 });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = `attribute float glow;\nvarying float vGlow;\n${shader.vertexShader}`.replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = glow;');
    shader.fragmentShader = `varying float vGlow;\n${shader.fragmentShader}`.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= vGlow * 3.0;');
  };
  m.customProgramCacheKey = () => 'crack-v1';
  return m;
}

function buildGolem(spec) {
  const g = new THREE.Group();
  const mat = crack(spec.color, spec.accent);
  const parts = {};
  const add = (name, scale, pos, seed) => {
    const m = new THREE.Mesh(rockGeo(seed), mat);
    m.scale.set(...scale);
    m.position.set(...pos);
    g.add(m);
    parts[name] = m;
    return m;
  };
  add('body', [0.6, 0.65, 0.5], [0, 0.3, 0], 1);
  add('head', [0.25, 0.22, 0.25], [0, 1.0, 0.15], 2);
  const arms = [-1, 1].map((s) => {
    const pivot = new THREE.Group();
    pivot.position.set(s * 0.75, 0.6, 0);
    const a = new THREE.Mesh(rockGeo(3 + s), mat);
    a.scale.set(0.24, 0.55, 0.24);
    a.position.y = -0.45;
    pivot.add(a);
    const fist = new THREE.Mesh(rockGeo(5 + s), mat);
    fist.scale.setScalar(0.3);
    fist.position.y = -1.0;
    pivot.add(fist);
    g.add(pivot);
    return pivot;
  });
  const legs = [-1, 1].map((s) => {
    const pivot = new THREE.Group();
    pivot.position.set(s * 0.32, -0.2, 0);
    const l = new THREE.Mesh(rockGeo(7 + s), mat);
    l.scale.set(0.24, 0.45, 0.26);
    l.position.y = -0.45;
    pivot.add(l);
    g.add(pivot);
    return pivot;
  });
  eyes(parts.head, spec.accent, 0.4, 0.1, 0.85, 0.2);
  g.children.forEach((c) => { c.position.y -= 0.05; });
  return {
    group: g,
    flash: [],
    anim(t, speed = 0) {
      const k = Math.min(1, speed / 15);
      arms.forEach((a, i) => { a.rotation.x = Math.sin(t * 2.4 + i * Math.PI) * 0.5 * (0.2 + k); });
      legs.forEach((l, i) => { l.rotation.x = Math.sin(t * 2.4 + i * Math.PI + Math.PI) * 0.5 * k; });
      parts.body.rotation.y = Math.sin(t * 0.8) * 0.08;
    },
  };
}

const ARCH = { quad: buildQuad, avian: buildAvian, serpent: buildSerpent, insect: buildInsect, golem: buildGolem };

export function buildCreature(spec, colorOverride) {
  const s = colorOverride ? { ...spec, accent: colorOverride } : spec;
  const model = (ARCH[spec.arch] || buildQuad)(s);
  model.group.scale.multiplyScalar(spec.radius);
  return model;
}
