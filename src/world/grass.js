import * as THREE from 'three';
import { propWind } from './props.js';

// Grass around the player on green worlds: clumps of tapered blades scattered over
// the ground in a ring of cells that follows you, swaying in the same wind as the
// trees. One instanced draw call. Only new cells are filled as you move.

const CELL = 9;           // metres
const REACH = 5;          // cells in each direction (~45 m)
const PER_CELL = 70;

function bladeGeometry() {
  // three crossed, tapered, slightly bent blades in one clump; colour is a tip-to-root gradient
  const pos = [], col = [], idx = [];
  const blades = 5;
  for (let b = 0; b < blades; b++) {
    const a = (b / blades) * Math.PI + b * 0.37;
    const lean = 0.25 + (b % 3) * 0.12;
    const h = 0.55 + ((b * 7) % 5) * 0.09;
    const w = 0.07;
    const ox = Math.cos(a + 1.3) * 0.12, oz = Math.sin(a + 1.3) * 0.12;
    const base = pos.length / 3;
    const steps = 3;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const half = w * (1 - t * 0.9);
      const bend = lean * t * t;
      const cx = ox + Math.cos(a) * bend, cz = oz + Math.sin(a) * bend;
      const px = -Math.sin(a) * half, pz = Math.cos(a) * half;
      pos.push(cx - px, t * h, cz - pz, cx + px, t * h, cz + pz);
      const g = 0.45 + t * 0.4;
      col.push(g, g, g, g, g, g);
    }
    for (let s = 0; s < steps; s++) {
      const i = base + s * 2;
      idx.push(i, i + 1, i + 3, i, i + 3, i + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  // blades read best lit from above, whichever way they face
  const n = geo.attributes.normal;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, n.getX(i) * 0.3, 1, n.getZ(i) * 0.3);
  return geo;
}

const hash = (x, z, k) => { const s = Math.sin(x * 127.1 + z * 311.7 + k * 74.7) * 43758.5453; return s - Math.floor(s); };

export class Grass {
  constructor(root) {
    this.root = root;
    const count = (REACH * 2 + 1) ** 2 * PER_CELL;
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, side: THREE.DoubleSide });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uWind = propWind;
      shader.vertexShader = `uniform float uWind;\n${shader.vertexShader}`.replace('#include <begin_vertex>', `#include <begin_vertex>
  float gp = instanceMatrix[3].x * 0.19 + instanceMatrix[3].z * 0.13 + instanceMatrix[3].y * 0.07;
  float gs = sin(uWind * 2.1 + gp) * 0.6 + sin(uWind * 4.7 + gp * 1.9) * 0.3;
  transformed.x += position.y * position.y * 0.32 * gs;
  transformed.z += position.y * position.y * 0.2 * cos(uWind * 1.7 + gp);`);
    };
    // both faces lit as if facing the sky (no dark backs)
    const fb = mat.onBeforeCompile;
    mat.onBeforeCompile = (shader) => {
      fb(shader);
      shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
      normal = normalize(vNormal);`);
    };
    mat.customProgramCacheKey = () => 'grass-wind-2';
    this.mat = mat;
    this.mesh = new THREE.InstancedMesh(bladeGeometry(), mat, count);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.visible = false;
    root.add(this.mesh);
    this.cells = new Map(); // key -> slot
    this.free = Array.from({ length: (REACH * 2 + 1) ** 2 }, (_, i) => i);
    this.frame = null;
    this.zero = new THREE.Matrix4().makeScale(0, 0, 0);
  }

  // which worlds have grass, and what colour
  tint(body) {
    if (!body || !body.landable) return null;
    if (body.type === 'terran') return [0.22, 0.37, 0.13];
    if (body.type === 'toxic') return [0.45, 0.55, 0.12];
    return null;
  }

  reset() {
    this.anchor = null;
    this.cells.clear();
    this.free = Array.from({ length: (REACH * 2 + 1) ** 2 }, (_, i) => i);
    for (let i = 0; i < this.mesh.instanceMatrix.count; i++) this.mesh.setMatrixAt(i, this.zero);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  update(frame, playerPos, enabled) {
    const tint = enabled && frame && frame.terrain ? this.tint(frame.body) : null;
    if (frame !== this.frame) { this.frame = frame; this.reset(); this.anchor = null; }
    if (!tint) { this.mesh.visible = false; return; }
    const up = playerPos.clone().normalize();
    const alt = playerPos.length() - frame.floorRadius(up.x, up.y, up.z);
    if (alt > 120) { this.mesh.visible = false; return; }
    this.mesh.visible = true;
    this.mesh.count = this.mesh.instanceMatrix.count;
    // a flat grid on a tangent plane anchored near the player (re-anchored every few hundred
    // metres), so cells stay put while you walk
    const R = frame.R;
    if (!this.anchor || this.anchor.angleTo(up) * R > 260) {
      this.reset();
      this.anchor = up.clone();
      this.e = new THREE.Vector3(0, 1, 0).cross(up);
      if (this.e.lengthSq() < 1e-6) this.e.set(1, 0, 0);
      this.e.normalize();
      this.n = new THREE.Vector3().crossVectors(up, this.e);
    }
    const e = this.e, n = this.n, A = this.anchor;
    const local = playerPos.clone().normalize().multiplyScalar(R);
    const cx = Math.round(local.dot(e) / CELL), cz = Math.round(local.dot(n) / CELL);
    const want = new Set();
    for (let i = -REACH; i <= REACH; i++) for (let j = -REACH; j <= REACH; j++) want.add(`${cx + i},${cz + j}`);
    let changed = false;
    for (const [k, slot] of this.cells) {
      if (want.has(k)) continue;
      this.cells.delete(k); this.free.push(slot);
      for (let b = 0; b < PER_CELL; b++) this.mesh.setMatrixAt(slot * PER_CELL + b, this.zero);
      changed = true;
    }
    // fill at most a few new cells per frame
    let budget = 6;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color();
    const sea = frame.terrain.sea;
    for (const k of want) {
      if (this.cells.has(k) || !this.free.length || budget <= 0) continue;
      budget--;
      const slot = this.free.pop();
      this.cells.set(k, slot);
      const [gx, gz] = k.split(',').map(Number);
      for (let b = 0; b < PER_CELL; b++) {
        const fx = (gx - 0.5 + hash(gx, gz, b)) * CELL, fz = (gz - 0.5 + hash(gz, gx, b + 0.5)) * CELL;
        p.copy(A).multiplyScalar(R).addScaledVector(e, fx).addScaledVector(n, fz).normalize();
        const h = frame.terrain.height(p.x, p.y, p.z);
        const inCity = frame.details?.settlements.some((st) => p.clone().multiplyScalar(R).distanceTo(st.group.position) < st.radius + 20);
        // no grass under water, on beaches or high snowy ground, or in town
        if ((sea !== null && h < sea + frame.body.amp * 0.03) || h > frame.body.amp * 0.55 || inCity || hash(gx, gz, b + 9) < 0.15) {
          this.mesh.setMatrixAt(slot * PER_CELL + b, this.zero);
          continue;
        }
        const r = R + h;
        const pos = p.clone().multiplyScalar(r);
        q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), p).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), hash(b, gx, gz) * 6.28));
        const sc = 0.7 + hash(gx + b, gz, 3) * 0.9;
        s.set(sc, sc * (0.8 + hash(gx, gz + b, 4) * 0.7), sc);
        m.compose(pos, q, s);
        this.mesh.setMatrixAt(slot * PER_CELL + b, m);
        const v = 0.8 + hash(b, gz, gx) * 0.45;
        c.setRGB(tint[0] * v, tint[1] * v * (0.9 + hash(gx, b, 7) * 0.2), tint[2] * v);
        this.mesh.setColorAt(slot * PER_CELL + b, c);
      }
      changed = true;
    }
    if (changed) { this.mesh.instanceMatrix.needsUpdate = true; this.mesh.instanceColor.needsUpdate = true; }
  }

  rebase() { this.reset(); }
}
