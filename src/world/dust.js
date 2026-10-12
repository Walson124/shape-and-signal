import * as THREE from 'three';

// Space dust that wraps around the camera and streaks with velocity. This is
// what makes first-person flight feel fast.
export class SpaceDust {
  constructor(scene, count) {
    this.count = count;
    this.box = 220;
    this.points = new Float32Array(count * 3);
    for (let i = 0; i < count * 3; i++) this.points[i] = (Math.random() - 0.5) * this.box;
    this.pos = new Float32Array(count * 6);
    this.col = new Float32Array(count * 6);
    const geo = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.aPos);
    geo.setAttribute('color', this.aCol);
    this.mesh = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    scene.add(this.mesh);
    this.tint = new THREE.Color(0.75, 0.85, 1);
  }

  setTint(hex) {
    this.tint.set(hex).lerp(new THREE.Color(1, 1, 1), 0.6);
  }

  update(camPos, vel, warp = 0) {
    const b = this.box, hb = b / 2;
    const speed = vel.length();
    const stretch = Math.min(0.09, 0.0006 * speed + warp * 0.06);
    const sx = vel.x * stretch, sy = vel.y * stretch, sz = vel.z * stretch;
    const alphaBase = Math.min(1, 0.25 + speed / 260 + warp);
    const { points, pos, col, tint } = this;
    for (let i = 0; i < this.count; i++) {
      const i3 = i * 3;
      // wrap into a box centered on the camera
      let x = points[i3] - camPos.x, y = points[i3 + 1] - camPos.y, z = points[i3 + 2] - camPos.z;
      x = ((x + hb) % b + b) % b - hb;
      y = ((y + hb) % b + b) % b - hb;
      z = ((z + hb) % b + b) % b - hb;
      points[i3] = x + camPos.x; points[i3 + 1] = y + camPos.y; points[i3 + 2] = z + camPos.z;
      const d = Math.sqrt(x * x + y * y + z * z) / hb;
      const fade = Math.max(0, 1 - d) * alphaBase * (0.4 + (i % 7) / 10);
      const i6 = i * 6;
      pos[i6] = points[i3]; pos[i6 + 1] = points[i3 + 1]; pos[i6 + 2] = points[i3 + 2];
      pos[i6 + 3] = points[i3] - sx - 0.04; pos[i6 + 4] = points[i3 + 1] - sy; pos[i6 + 5] = points[i3 + 2] - sz;
      col[i6] = tint.r * fade; col[i6 + 1] = tint.g * fade; col[i6 + 2] = tint.b * fade;
      col[i6 + 3] = 0; col[i6 + 4] = 0; col[i6 + 5] = 0;
    }
    this.aPos.needsUpdate = true;
    this.aCol.needsUpdate = true;
  }

  dispose() {
    this.mesh.parent?.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
