import * as THREE from 'three';

// Things you build from your ring and set down in the world: a tent to rest
// and respawn in, a turret that guards it, a totem that speeds cultivation.
// Saved per world in state.placed.

const glow = (hex, k = 2.4) => new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(k) });

export function buildStructure(type) {
  const g = new THREE.Group();
  const mats = [];
  const m = (mat) => { mats.push(mat); return mat; };
  const add = (geo, mat, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(geo, mat); o.position.set(x, y, z); g.add(o); return o; };
  const parts = {};
  if (type === 'tent') {
    const cloth = m(new THREE.MeshStandardMaterial({ color: 0x8a6a48, roughness: 0.9, side: THREE.DoubleSide }));
    const tent = add(new THREE.ConeGeometry(2.6, 2.6, 4, 1, true), cloth, 0, 1.3, 0);
    tent.rotation.y = Math.PI / 4;
    add(new THREE.CylinderGeometry(0.05, 0.05, 2.9, 5), m(new THREE.MeshStandardMaterial({ color: 0x3a2a1a })), 0, 1.45, 0);
    add(new THREE.SphereGeometry(0.18, 8, 6), m(glow(0xffb070, 3)), 0, 0.5, 0);
    const fire = add(new THREE.ConeGeometry(0.25, 0.6, 6), m(glow(0xff7a2a, 3)), 0, 0.3, 3.2);
    parts.fire = fire;
  } else if (type === 'turret') {
    const metal = m(new THREE.MeshStandardMaterial({ color: 0x3a404c, metalness: 0.7, roughness: 0.4 }));
    add(new THREE.CylinderGeometry(0.9, 1.1, 1.2, 10), metal, 0, 0.6, 0);
    const head = new THREE.Group();
    head.position.y = 1.5;
    g.add(head);
    const box = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.7, 1.2), metal);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 1.8, 8).rotateX(Math.PI / 2).translate(0, 0, -1), m(new THREE.MeshStandardMaterial({ color: 0x1a1e26, metalness: 0.8 })));
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), m(glow(0x3ef2ff, 3)));
    eye.position.set(0, 0.1, -0.62);
    head.add(box, barrel, eye);
    parts.head = head;
  } else {
    const stone = m(new THREE.MeshStandardMaterial({ color: 0x5a5448, roughness: 0.85 }));
    add(new THREE.CylinderGeometry(0.5, 0.7, 3.2, 6), stone, 0, 1.6, 0);
    const gem = add(new THREE.OctahedronGeometry(0.45, 0), m(glow(0xb98cff, 3)), 0, 3.7, 0);
    const ring = add(new THREE.TorusGeometry(1.2, 0.05, 6, 32).rotateX(Math.PI / 2), m(glow(0xb98cff, 2)), 0, 0.15, 0);
    parts.gem = gem;
    parts.ring = ring;
  }
  return {
    group: g,
    parts,
    ghost(on) {
      for (const mat of mats) {
        mat.transparent = on;
        mat.opacity = on ? 0.45 : 1;
        mat.depthWrite = !on;
      }
    },
    dispose() {
      g.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
      for (const mat of mats) mat.dispose();
    },
  };
}

export class Structures {
  constructor(game) {
    this.g = game;
    this.list = [];
  }

  // Build the meshes for everything placed on the current world.
  sync() {
    const g = this.g, s = g.state, f = g.frame;
    this.clear();
    if (!f || !f.terrain) return;
    for (const rec of s.placed || []) {
      if (rec.star !== g.star.key || rec.body !== f.body.id) continue;
      this.list.push(this.spawn(rec));
    }
  }

  spawn(rec) {
    const obj = buildStructure(rec.type);
    const pos = new THREE.Vector3().fromArray(rec.pos);
    const up = pos.clone().normalize();
    obj.group.position.copy(pos);
    obj.group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
    obj.group.rotateY(rec.rot || 0);
    this.g.localRoot.add(obj.group);
    return { rec, obj, pos, up, cd: Math.random() };
  }

  add(rec) {
    this.list.push(this.spawn(rec));
  }

  remove(entry) {
    this.g.localRoot.remove(entry.obj.group);
    entry.obj.dispose();
    this.list.splice(this.list.indexOf(entry), 1);
  }

  clear() {
    for (const e of this.list) {
      this.g.localRoot.remove(e.obj.group);
      e.obj.dispose();
    }
    this.list = [];
  }

  rebase(m, q) {
    for (const e of this.list) {
      e.pos.applyMatrix4(m);
      e.up.applyQuaternion(q);
      e.obj.group.position.applyMatrix4(m);
      e.obj.group.quaternion.premultiply(q);
    }
  }

  // Is the player cultivating near a totem?
  totemNear(pos) {
    return this.list.some((e) => e.rec.type === 'totem' && e.pos.distanceTo(pos) < 15);
  }

  update(dt, time) {
    const g = this.g;
    for (const e of this.list) {
      const p = e.obj.parts;
      if (e.rec.type === 'totem') {
        p.gem.rotation.y += dt * 1.2;
        p.gem.position.y = 3.7 + Math.sin(time * 2) * 0.15;
        p.ring.scale.setScalar(1 + 0.1 * Math.sin(time * 3));
      } else if (e.rec.type === 'tent') {
        p.fire.scale.y = 0.8 + 0.3 * Math.sin(time * 13) * Math.sin(time * 7);
      } else if (e.rec.type === 'turret') {
        e.cd -= dt;
        let best = null, bd = 120;
        for (const b of g.beasts.beasts) {
          if (!b.alive || b.static) continue;
          const d = b.pos.distanceTo(e.pos);
          if (d < bd) { bd = d; best = b; }
        }
        if (best) {
          const local = e.obj.group.worldToLocal(g.toWorld(best.pos).clone());
          p.head.rotation.y = Math.atan2(-local.x, -local.z);
          if (e.cd <= 0) {
            e.cd = 0.9;
            const from = e.pos.clone().addScaledVector(e.up, 1.6);
            g.combat.firePlayerBolt(from, best.pos.clone().sub(from).normalize(), g.stats.atk * 0.6, 0x3ef2ff, 600, { size: 0.7, kind: 'turret' });
          }
        }
      }
    }
  }
}
