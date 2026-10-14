import * as THREE from 'three';
import { glowTexture } from '../world/textures.js';

// Beast cores that spill from kills and drift toward the player.
export class Loot {
  constructor(scene, particles, sound) {
    this.scene = scene;
    this.particles = particles;
    this.sound = sound;
    this.items = [];
    this.geo = new THREE.OctahedronGeometry(1, 0);
    this.mats = new Map();
  }

  mat(hex) {
    if (!this.mats.has(hex)) {
      this.mats.set(hex, {
        core: new THREE.MeshStandardMaterial({ color: 0x111111, emissive: new THREE.Color(hex), emissiveIntensity: 2.2, metalness: 0.3, roughness: 0.2 }),
        glow: new THREE.SpriteMaterial({ map: glowTexture(), color: new THREE.Color(hex).multiplyScalar(1.2), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }),
      });
    }
    return this.mats.get(hex);
  }

  spawn(pos, amount, color, count = 1, kind = 'essence', data = null) {
    const m = this.mat(color);
    const per = amount / count;
    for (let i = 0; i < count; i++) {
      const g = new THREE.Group();
      const mesh = new THREE.Mesh(this.geo, m.core);
      mesh.scale.set(0.9, 1.4, 0.9);
      const glow = new THREE.Sprite(m.glow);
      glow.scale.setScalar(6);
      g.add(mesh, glow);
      g.position.copy(pos);
      this.scene.add(g);
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(25 + Math.random() * 35);
      if (kind === 'part') mesh.scale.set(0.7, 0.7, 0.7);
      this.items.push({ g, mesh, vel: v, amount: per, kind, data, life: kind === 'part' ? 180 : 90, color: new THREE.Color(color).multiplyScalar(1.6), t: Math.random() * 10, pulled: false });
    }
  }

  update(dt, player, magnet, onCollect) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.life -= dt;
      it.t += dt;
      if (it.life <= 0) {
        this.remove(i);
        continue;
      }
      const to = player.pos.clone().sub(it.g.position);
      const d = to.length();
      if (it.refused && d > 6) it.refused = false;
      if ((d < magnet || it.pulled) && !it.refused) {
        it.pulled = true;
        const pull = to.divideScalar(Math.max(d, 0.01)).multiplyScalar(Math.min(900, 120 + (magnet / Math.max(d, 1)) * 60));
        it.vel.lerp(pull.add(player.vel), 1 - Math.exp(-dt * 6));
      } else {
        it.vel.multiplyScalar(Math.max(0, 1 - dt * 1.2));
      }
      it.g.position.addScaledVector(it.vel, dt);
      it.mesh.rotation.y += dt * 2.5;
      it.mesh.rotation.x = Math.sin(it.t * 1.5) * 0.4;
      if (d < 3.5 && !it.refused) {
        if (onCollect(it) === false) {
          // nowhere to put it: it stays on the ground until there's room
          it.refused = true;
          it.pulled = false;
          it.vel.set(0, 0, 0);
          continue;
        }
        this.particles.burst(it.g.position, it.color, 10, 25, 0.6, 0.3, 4);
        this.sound.pickup();
        this.remove(i);
      }
    }
  }

  rebase(m, q) {
    for (const it of this.items) {
      it.g.position.applyMatrix4(m);
      it.vel.applyQuaternion(q);
    }
  }

  remove(i) {
    this.scene.remove(this.items[i].g);
    this.items.splice(i, 1);
  }

  clear() {
    for (let i = this.items.length - 1; i >= 0; i--) this.remove(i);
  }
}
