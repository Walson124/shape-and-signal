import * as THREE from 'three';
import { CELL, VOX, density } from './voxel.js';
import { texPool } from './texpool.js';

// Holes, tunnels and caves for one planet. Cells of real volume replace the
// heightfield wherever the ground was blasted, and stream in around you while
// you are underground. digs: [[x, y, z, r, t], ...] in planet-local metres.

const MAX_CUTS = 64;
const key = (x, y, z) => `${x},${y},${z}`;
const tA = new THREE.Vector3();

export class Digs {
  constructor(planet) {
    this.p = planet;
    this.digs = [];
    this.cells = new Map(); // key -> { c: [x,y,z], mesh, busy, dirty, surf, ready }
    this.digCells = new Set(); // keys of cells touched by digs
    this.near = new Set(); // keys streamed around an underground player
    this.cutUniform = { value: Array.from({ length: MAX_CUTS }, () => new THREE.Vector4(0, 0, 0, -1)) };
    this.onVein = null; // (cellKey, veins) when a cell with crystal veins is built
  }

  // Hook the heightfield material so it disappears inside built cells.
  attach(material) {
    const prev = material.onBeforeCompile;
    const cut = this.cutUniform;
    material.onBeforeCompile = (shader, r) => {
      prev(shader, r);
      shader.uniforms.uCut = cut;
      shader.fragmentShader = `uniform vec4 uCut[${MAX_CUTS}];\n${shader.fragmentShader}`.replace(
        'void main() {',
        `void main() {
        for (int ci = 0; ci < ${MAX_CUTS}; ci++) {
          vec4 cc = uCut[ci];
          if (cc.w < 0.0) break;
          vec3 dd = abs(vPP - cc.xyz);
          if (max(dd.x, max(dd.y, dd.z)) < cc.w) discard;
        }`,
      );
    };
    material.customProgramCacheKey = () => 'terrain-dig';
    material.needsUpdate = true;
  }

  setDigs(list) {
    this.digs = list || [];
    this.digCells.clear();
    for (const g of this.digs) for (const k of this.cellsOf(g)) this.digCells.add(k);
    for (const c of this.cells.values()) c.dirty = true;
  }

  cellsOf(g) {
    const out = [];
    const r = g[3] + VOX * 2;
    const x0 = Math.floor((g[0] - r) / CELL), x1 = Math.floor((g[0] + r) / CELL);
    const y0 = Math.floor((g[1] - r) / CELL), y1 = Math.floor((g[1] + r) / CELL);
    const z0 = Math.floor((g[2] - r) / CELL), z1 = Math.floor((g[2] + r) / CELL);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) out.push(key(x, y, z));
    return out;
  }

  // Carve a sphere of air. Returns the dig record (also pushed into the list).
  add(x, y, z, r, t) {
    // merge into a bigger hole that already covers most of this one
    for (const g of this.digs) {
      const d = Math.hypot(g[0] - x, g[1] - y, g[2] - z);
      if (d + r <= g[3] + 0.25) return null;
    }
    const g = [x, y, z, r, t];
    this.digs.push(g);
    for (const k of this.cellsOf(g)) {
      this.digCells.add(k);
      const c = this.cells.get(k);
      if (c) c.dirty = true;
    }
    return g;
  }

  remove(pred) {
    const before = this.digs.length;
    for (let i = this.digs.length - 1; i >= 0; i--) if (pred(this.digs[i])) this.digs.splice(i, 1);
    if (this.digs.length !== before) this.setDigs(this.digs);
    return before - this.digs.length;
  }

  // ------------------------------------------------------------ queries --
  sdf(x, y, z) {
    const T = this.p.terrain;
    return density(T, this.p.R, x, y, z, this.digsNear(x, y, z));
  }

  digsNear(x, y, z) {
    const out = [];
    for (const g of this.digs) if (Math.abs(g[0] - x) < g[3] + 2 && Math.abs(g[1] - y) < g[3] + 2 && Math.abs(g[2] - z) < g[3] + 2) out.push(g);
    return out;
  }

  // Is this point somewhere the heightfield doesn't tell the whole truth?
  inZone(pos) {
    if (!this.digs.length && !this.near.size) return false;
    const k = key(Math.floor(pos.x / CELL), Math.floor(pos.y / CELL), Math.floor(pos.z / CELL));
    return this.digCells.has(k) || this.near.has(k);
  }

  // Radius of the first solid ground at or below pos (along the planet's up).
  groundBelow(pos) {
    const up = tA.copy(pos).normalize();
    const ux = up.x, uy = up.y, uz = up.z;
    let x = pos.x, y = pos.y, z = pos.z;
    if (this.sdf(x, y, z) > 0) {
      // buried: climb to the surface above
      for (let t = 0.25; t < 12; t += 0.25) {
        if (this.sdf(pos.x + ux * t, pos.y + uy * t, pos.z + uz * t) <= 0) return pos.length() + t;
      }
      return pos.length() + 12;
    }
    let prev = 0;
    for (let t = 0.3; t < 30; t += 0.3) {
      x = pos.x - ux * t; y = pos.y - uy * t; z = pos.z - uz * t;
      if (this.sdf(x, y, z) > 0) {
        // refine between prev and t
        let a = prev, b = t;
        for (let i = 0; i < 5; i++) {
          const m = (a + b) / 2;
          if (this.sdf(pos.x - ux * m, pos.y - uy * m, pos.z - uz * m) > 0) b = m; else a = m;
        }
        return pos.length() - (a + b) / 2;
      }
      prev = t;
    }
    return pos.length() - 30;
  }

  // Push a sphere out of rock (walls and ceilings of holes and caves).
  push(pos, r) {
    const s = this.sdf(pos.x, pos.y, pos.z);
    if (s <= -r) return false;
    const e = 0.3;
    let gx = this.sdf(pos.x + e, pos.y, pos.z) - this.sdf(pos.x - e, pos.y, pos.z);
    let gy = this.sdf(pos.x, pos.y + e, pos.z) - this.sdf(pos.x, pos.y - e, pos.z);
    let gz = this.sdf(pos.x, pos.y, pos.z + e) - this.sdf(pos.x, pos.y, pos.z - e);
    const gl = Math.hypot(gx, gy, gz);
    if (gl < 1e-6) return false;
    const k = (s + r) / gl * 0.9;
    pos.x -= gx * k; pos.y -= gy * k; pos.z -= gz * k;
    return true;
  }

  // ------------------------------------------------------------ meshes --
  // Keep cells built around digs within reach, and around you underground.
  update(playerLocal) {
    const p = this.p;
    if (!p.terrain) return;
    // underground? stream the cells around you
    this.near.clear();
    if (playerLocal) {
      const D = playerLocal.length();
      const n = tA.copy(playerLocal).divideScalar(D);
      const surface = p.R + p.terrain.height(n.x, n.y, n.z);
      const pk = [Math.floor(playerLocal.x / CELL), Math.floor(playerLocal.y / CELL), Math.floor(playerLocal.z / CELL)];
      if (D < surface - 2.5 || this.digCells.has(key(...pk))) {
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) this.near.add(key(pk[0] + dx, pk[1] + dy, pk[2] + dz));
      }
    }
    const want = new Set(this.near);
    for (const k of this.digCells) {
      const [x, y, z] = k.split(',').map(Number);
      if (!playerLocal || tA.set((x + 0.5) * CELL, (y + 0.5) * CELL, (z + 0.5) * CELL).distanceTo(playerLocal) < 2500) want.add(k);
    }
    // drop cells no longer wanted
    let changed = false;
    for (const [k, c] of this.cells) {
      if (want.has(k)) continue;
      this.disposeCell(c);
      this.cells.delete(k);
      changed = true;
    }
    for (const k of want) {
      let c = this.cells.get(k);
      if (!c) {
        c = { k, c: k.split(',').map(Number), mesh: null, busy: false, dirty: true, surf: false, ready: false };
        this.cells.set(k, c);
      }
      if (c.dirty && !c.busy) this.build(c);
    }
    if (changed) this.updateCuts(playerLocal);
  }

  build(c) {
    const p = this.p;
    c.busy = true;
    c.dirty = false;
    const r = CELL;
    const cx = (c.c[0] + 0.5) * CELL, cy = (c.c[1] + 0.5) * CELL, cz = (c.c[2] + 0.5) * CELL;
    const digs = this.digs.filter((g) => Math.abs(g[0] - cx) < r * 0.5 + g[3] + 2 && Math.abs(g[1] - cy) < r * 0.5 + g[3] + 2 && Math.abs(g[2] - cz) < r * 0.5 + g[3] + 2).map((g) => [g[0], g[1], g[2], g[3]]);
    texPool.run('voxel', { params: p.params, cell: c.c, digs }, { priority: () => -2, cancelled: () => !this.cells.has(c.k) }).then((out) => {
      c.busy = false;
      if (!out || !this.cells.has(c.k)) return;
      this.disposeCell(c, true);
      // does the surface pass through this cell? then the heightfield must give way here
      const n = tA.set(cx, cy, cz).normalize();
      const surfR = p.R + p.terrain.height(n.x, n.y, n.z);
      c.surf = Math.abs(surfR - Math.hypot(cx, cy, cz)) < CELL;
      if (out.index.length) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(out.positions, 3));
        geo.setAttribute('normal', new THREE.BufferAttribute(out.normals, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(out.colors, 3));
        geo.setAttribute('glow', new THREE.BufferAttribute(out.glow, 1));
        geo.setAttribute('ppos', new THREE.BufferAttribute(out.ppos, 3));
        geo.setIndex(new THREE.BufferAttribute(out.index, 1));
        geo.computeBoundingSphere();
        const mesh = new THREE.Mesh(geo, p.voxMaterial);
        mesh.position.set(out.center[0], out.center[1], out.center[2]);
        p.terrainGroup.add(mesh);
        c.mesh = mesh;
      }
      c.ready = true;
      if (out.veins.length && this.onVein) this.onVein(c.k, out.veins);
      this.updateCuts();
      if (c.dirty) this.build(c);
    }).catch((e) => {
      c.busy = false;
      console.error(e);
    });
  }

  disposeCell(c, keepEntry = false) {
    if (c.mesh) {
      this.p.terrainGroup.remove(c.mesh);
      c.mesh.geometry.dispose();
      c.mesh = null;
    }
    if (!keepEntry) c.ready = false;
  }

  // The heightfield is cut away inside built cells that the surface crosses.
  updateCuts(playerLocal) {
    const list = [...this.cells.values()].filter((c) => c.ready && c.surf);
    if (playerLocal) list.sort((a, b) => tA.set((a.c[0] + 0.5) * CELL, (a.c[1] + 0.5) * CELL, (a.c[2] + 0.5) * CELL).distanceToSquared(playerLocal) - tA.set((b.c[0] + 0.5) * CELL, (b.c[1] + 0.5) * CELL, (b.c[2] + 0.5) * CELL).distanceToSquared(playerLocal));
    const arr = this.cutUniform.value;
    for (let i = 0; i < MAX_CUTS; i++) {
      const c = list[i];
      if (c) arr[i].set((c.c[0] + 0.5) * CELL, (c.c[1] + 0.5) * CELL, (c.c[2] + 0.5) * CELL, CELL / 2);
      else arr[i].set(0, 0, 0, -1);
    }
  }

  dispose() {
    for (const c of this.cells.values()) this.disposeCell(c);
    this.cells.clear();
    this.updateCuts();
  }
}
