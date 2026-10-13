import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../core/rng.js';
import { glowTexture } from './textures.js';
import { buildShip } from './models.js';
import { withLogDepth } from '../core/logdepth.js';
import { buildNPC } from './interiors.js';

const glowMat = (hex, mul = 2.5) => new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(mul) });

// Points of interest on a planet surface. Each is built in a local frame
// where +Y is the planet's up at that spot.
export function buildPoi(poi, accent = 0x3ef2ff) {
  const r = mulberry32(poi.seed || 1);
  const g = new THREE.Group();
  const out = { group: g, kind: poi.kind, update: () => {}, range: 30, shards: null };
  const stone = new THREE.MeshStandardMaterial({ color: 0x7a7468, roughness: 0.95, metalness: 0, flatShading: true });

  if (poi.kind === 'ruin') {
    const parts = [];
    const n = 10;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const h = r() < 0.3 ? 3 + r() * 4 : 10 + r() * 6;
      const p = new THREE.CylinderGeometry(1.1, 1.3, h, 8);
      if (r() < 0.2) {
        p.rotateZ(Math.PI / 2 - 0.1);
        p.translate(Math.cos(a) * 16, 1.2, Math.sin(a) * 16);
      } else {
        p.translate(Math.cos(a) * 16, h / 2, Math.sin(a) * 16);
      }
      parts.push(p);
      if (h > 9 && i % 2 === 0) {
        const lintel = new THREE.BoxGeometry(2.6, 1.2, 8).rotateY(-a).translate(Math.cos(a + 0.3) * 16, h + 0.6, Math.sin(a + 0.3) * 16);
        parts.push(lintel);
      }
    }
    parts.push(new THREE.CylinderGeometry(6, 7, 1.6, 12).translate(0, 0.8, 0));
    parts.push(new THREE.BoxGeometry(3, 3, 3).translate(0, 3, 0));
    g.add(new THREE.Mesh(mergeGeometries(parts), stone));
    const rune = new THREE.Mesh(new THREE.TorusGeometry(5, 0.18, 6, 48).rotateX(Math.PI / 2), glowMat(0xffc857, 3));
    rune.position.y = 1.7;
    g.add(rune);
    const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(1.4), glowMat(0xffe08a, 3));
    crystal.position.y = 7;
    g.add(crystal);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: new THREE.Color(0xffc857).multiplyScalar(0.8), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    halo.scale.setScalar(14);
    halo.position.y = 7;
    g.add(halo);
    let t = r() * 10;
    out.update = (dt) => {
      t += dt;
      crystal.rotation.y += dt;
      crystal.position.y = 7 + Math.sin(t * 1.4) * 0.6;
      halo.position.y = crystal.position.y;
      rune.rotation.z += dt * 0.3;
    };
    out.range = 24;
  } else if (poi.kind === 'spring') {
    const pool = new THREE.Mesh(new THREE.CircleGeometry(9, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(accent).multiplyScalar(1.4), transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false }));
    pool.position.y = 0.4;
    g.add(pool);
    const beamMat = withLogDepth(new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(accent).multiplyScalar(1.6) }, uTime: { value: 0 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform vec3 uColor; uniform float uTime; varying vec2 vUv;
        void main(){ float a = pow(1.0 - vUv.y, 1.6) * (0.55 + 0.45 * sin(vUv.y * 40.0 - uTime * 4.0)); gl_FragColor = vec4(uColor * a, 1.0); }`,
    }));
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(3.5, 6, 220, 24, 1, true).translate(0, 110, 0), beamMat);
    g.add(beam);
    const rocks = [];
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + r() * 0.3;
      rocks.push(new THREE.DodecahedronGeometry(1.2 + r() * 1.2, 0).translate(Math.cos(a) * 10.5, 0.5, Math.sin(a) * 10.5));
    }
    g.add(new THREE.Mesh(mergeGeometries(rocks), stone));
    out.update = (dt) => { beamMat.uniforms.uTime.value += dt; };
    out.beamMat = beamMat;
    out.range = 45;
  } else if (poi.kind === 'ore') {
    const shardMat = new THREE.MeshStandardMaterial({ color: 0x1a2a3a, emissive: new THREE.Color(0x3ef2ff), emissiveIntensity: 1.6, roughness: 0.25, metalness: 0.4, flatShading: true });
    out.shards = [];
    const n = 6 + Math.floor(r() * 5);
    for (let i = 0; i < n; i++) {
      const h = 2 + r() * 4;
      const m = new THREE.Mesh(new THREE.OctahedronGeometry(1, 0).scale(0.6 + r() * 0.5, h, 0.6 + r() * 0.5), shardMat);
      const a = r() * Math.PI * 2, d = r() * 5;
      m.position.set(Math.cos(a) * d, h * 0.6, Math.sin(a) * d);
      m.rotation.set((r() - 0.5) * 0.6, r() * 3, (r() - 0.5) * 0.6);
      g.add(m);
      out.shards.push(m);
    }
    g.add(new THREE.Mesh(new THREE.DodecahedronGeometry(4, 0).scale(1.4, 0.4, 1.4), stone));
    out.hpMax = 1;
    out.range = 16;
    out.radius = 7;
    out.mat = shardMat;
  } else if (poi.kind === 'nest' || poi.kind === 'lair') {
    const lair = poi.kind === 'lair';
    const mound = new THREE.DodecahedronGeometry(lair ? 26 : 10, 1);
    const p = mound.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const s = 0.8 + Math.sin(p.getX(i) * 0.7 + p.getZ(i)) * 0.15;
      p.setXYZ(i, p.getX(i) * s, Math.max(-2, p.getY(i) * 0.45 * s), p.getZ(i) * s);
    }
    mound.computeVertexNormals();
    g.add(new THREE.Mesh(mound, new THREE.MeshStandardMaterial({ color: lair ? 0x2a1018 : 0x2a2420, roughness: 1, flatShading: true })));
    const eggMat = glowMat(lair ? 0xff2a6a : 0xff6a3a, 2.2);
    for (let i = 0; i < (lair ? 9 : 6); i++) {
      const a = r() * Math.PI * 2, d = (lair ? 14 : 5) + r() * 3;
      const e = new THREE.Mesh(new THREE.SphereGeometry(lair ? 2.4 : 0.9, 10, 8).scale(1, 1.35, 1), eggMat);
      e.position.set(Math.cos(a) * d, lair ? 6 : 3, Math.sin(a) * d);
      g.add(e);
    }
    if (lair) {
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const pillar = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 2, 400, 8, 1, true).translate(0, 200, 0), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 0.2, 0.5), transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false }));
        pillar.position.set(Math.cos(a) * 40, 0, Math.sin(a) * 40);
        g.add(pillar);
      }
    }
    out.range = lair ? 600 : 120;
  } else if (poi.kind === 'wreck') {
    const ship = buildShip(0xff6a3a);
    ship.scale.setScalar(4);
    ship.rotation.set(0.35, r() * 6, 0.5);
    ship.position.y = 2;
    g.add(ship);
    const debris = [];
    for (let i = 0; i < 12; i++) debris.push(new THREE.BoxGeometry(1 + r() * 3, 0.3, 1 + r() * 2).rotateY(r() * 3).translate((r() - 0.5) * 40, 0.2, (r() - 0.5) * 40));
    g.add(new THREE.Mesh(mergeGeometries(debris), new THREE.MeshStandardMaterial({ color: 0x5a5f6a, metalness: 0.8, roughness: 0.4 })));
    out.range = 26;
  } else if (poi.kind === 'obelisk') {
    // an ancient trial stone ringed by glyph pillars
    const parts = [new THREE.CylinderGeometry(9, 10, 1, 8).translate(0, 0.5, 0)];
    const ob = new THREE.CylinderGeometry(0.8, 2.4, 22, 4).rotateY(Math.PI / 4).translate(0, 12, 0);
    parts.push(ob);
    for (let i = 0; i < 4; i++) {
      const a2 = (i / 4) * Math.PI * 2 + Math.PI / 4;
      parts.push(new THREE.BoxGeometry(1.4, 5, 1.4).translate(Math.cos(a2) * 12, 2.5, Math.sin(a2) * 12));
    }
    g.add(new THREE.Mesh(mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p))), new THREE.MeshStandardMaterial({ color: 0x2a2630, roughness: 0.7, metalness: 0.3, flatShading: true })));
    const glyphs = [];
    for (let k = 0; k < 6; k++) {
      const gl = new THREE.Mesh(new THREE.TorusGeometry(2.4 - k * 0.25, 0.08, 4, 4).rotateX(Math.PI / 2), glowMat(0xb98cff, 3));
      gl.position.y = 3 + k * 3;
      g.add(gl);
      glyphs.push(gl);
    }
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: new THREE.Color(1.2, 0.7, 2.4), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.6 }));
    halo.position.y = 24;
    halo.scale.setScalar(16);
    g.add(halo);
    let t = 0;
    out.update = (dt) => {
      t += dt;
      glyphs.forEach((gl, i) => { gl.rotation.y = t * (0.4 + i * 0.15) * (i % 2 ? 1 : -1); });
      halo.material.opacity = 0.45 + 0.25 * Math.sin(t * 1.7);
    };
    out.range = 14;
  } else if (poi.kind === 'camp') {
    // a hunters' camp: tents, a fire and a trader
    const cloth = new THREE.MeshStandardMaterial({ color: 0x6a5a3a, roughness: 0.95, flatShading: true });
    for (let i = 0; i < 4; i++) {
      const a2 = (i / 4) * Math.PI * 2 + r();
      const tent = new THREE.Mesh(new THREE.ConeGeometry(3.2, 3.6, 4), cloth);
      tent.position.set(Math.cos(a2) * 9, 1.8, Math.sin(a2) * 9);
      tent.rotation.y = r() * 3;
      g.add(tent);
    }
    const crate = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.2, 1.4), new THREE.MeshStandardMaterial({ color: 0x4a3a2a, roughness: 0.8 }));
    crate.position.set(0, 0.6, 3.2);
    g.add(crate);
    const fire = new THREE.Mesh(new THREE.ConeGeometry(0.7, 1.6, 6), glowMat(0xff7a2a, 3));
    fire.position.y = 0.8;
    g.add(fire);
    const flame = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: new THREE.Color(2.4, 1.0, 0.3), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    flame.position.y = 1.4;
    flame.scale.setScalar(6);
    g.add(flame);
    const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 6, 5), new THREE.MeshStandardMaterial({ color: 0x222222 }));
    lamp.position.set(2, 3, 3.2);
    g.add(lamp);
    const beaconTop = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 6), glowMat(0x7affd8, 3));
    beaconTop.position.set(2, 6.2, 3.2);
    g.add(beaconTop);
    let t = 0;
    out.update = (dt) => {
      t += dt;
      flame.scale.setScalar(5.5 + Math.sin(t * 9) * 0.6 + Math.sin(t * 13) * 0.4);
      fire.scale.y = 1 + Math.sin(t * 11) * 0.15;
    };
    const trader = buildNPC(0x5a4a3a, 0x7affd8);
    trader.group.position.set(0, 0, 4.4);
    trader.group.rotation.y = Math.PI;
    g.add(trader.group);
    const upd = out.update;
    out.update = (dt) => { upd(dt); t += 0; trader.anim(t); };
    out.trader = new THREE.Vector3(0, 0, 2.4);
    out.range = 6;
  }
  return out;
}
