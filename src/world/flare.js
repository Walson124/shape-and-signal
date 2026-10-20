import * as THREE from 'three';
import { glowTexture, ringTexture, hexTexture, streakTexture } from './textures.js';

const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();

// Screen-space lens flare drawn in an overlay after post-processing, with an
// analytic occlusion test against planets.
export class LensFlare {
  constructor() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.visible = true;
    this.vis = 0;
    const geo = new THREE.PlaneGeometry(1, 1);
    const mk = (tex, t, size, color, opacity) => {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(color), transparent: true, opacity, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false }));
      m.userData = { t, size, opacity };
      this.scene.add(m);
      return m;
    };
    this.elements = [
      mk(glowTexture(), 0, 0.45, 0xffffff, 0.32),
      mk(streakTexture(), 0, 1, 0x9fc8ff, 0.2),
      mk(hexTexture(), 0.45, 0.09, 0x5affd8, 0.16),
      mk(ringTexture(), 0.7, 0.32, 0xffb86a, 0.12),
      mk(hexTexture(), 1.12, 0.06, 0xb46cff, 0.2),
      mk(hexTexture(), 1.35, 0.14, 0x3ef2ff, 0.12),
      mk(glowTexture(), 1.6, 0.22, 0xff3c7d, 0.12),
      mk(ringTexture(), 1.9, 0.5, 0x6a9cff, 0.08),
    ];
    this.streak = this.elements[1];
  }

  setColor(hex) {
    this.elements[0].material.color.set(hex);
  }

  update(camera, starPos, starRadius, colliders, dt) {
    tmp.copy(starPos).applyMatrix4(camera.matrixWorldInverse);
    let target = 0;
    this.shaftTarget = 0;
    let sx = 0, sy = 0;
    if (tmp.z < 0) {
      tmp2.copy(starPos).project(camera);
      sx = tmp2.x;
      sy = tmp2.y;
      const edge = Math.max(Math.abs(sx), Math.abs(sy));
      target = edge < 1.25 ? 1 - Math.max(0, edge - 0.85) / 0.4 : 0;
      // occlusion by planets (and the star itself is fine)
      const camPos = camera.getWorldPosition(new THREE.Vector3());
      const dir = tmp2.subVectors(starPos, camPos);
      const len = dir.length();
      dir.divideScalar(len);
      for (const c of colliders) {
        if (c.kind && c.kind !== 'planet') continue;
        const oc = tmp.subVectors(camPos, c.pos);
        const b = oc.dot(dir);
        const cc = oc.lengthSq() - c.radius * c.radius;
        const disc = b * b - cc;
        if (disc > 0) {
          const t = -b - Math.sqrt(disc);
          if (t > 0 && t < len) { target = 0; break; }
        }
      }
      this.shaftTarget = target;
      const dist = starPos.distanceTo(camera.getWorldPosition(new THREE.Vector3()));
      target *= Math.min(1, Math.max(0.35, (starRadius * 9) / dist));
    }
    this.vis += (target - this.vis) * (1 - Math.exp(-dt * 10));
    // where the sun is on screen and how clear the view of it is, for the sun shafts pass
    this.shaftVis = (this.shaftVis || 0) + (this.shaftTarget - (this.shaftVis || 0)) * (1 - Math.exp(-dt * 10));
    this.sx = sx;
    this.sy = sy;
    const aspect = camera.aspect;
    for (const m of this.elements) {
      const { t, size, opacity } = m.userData;
      const px = sx * (1 - t), py = sy * (1 - t);
      m.position.set(px, py, 0);
      if (m === this.streak) m.scale.set(size * 1.6, 0.03, 1);
      else m.scale.set(size / aspect, size, 1);
      m.material.opacity = opacity * this.vis;
      m.visible = this.vis > 0.01;
    }
  }
}
