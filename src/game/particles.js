import * as THREE from 'three';

// One big pooled additive point cloud for every spark, trail and explosion.
export class Particles {
  constructor(scene, capacity = 9000) {
    this.cap = capacity;
    this.pos = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 3);
    this.size = new Float32Array(capacity);
    this.alpha = new Float32Array(capacity);
    this.vel = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.size0 = new Float32Array(capacity);
    this.drag = new Float32Array(capacity);
    this.grow = new Float32Array(capacity);
    this.cursor = 0;

    const geo = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    this.aAlpha = new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.aPos);
    geo.setAttribute('color', this.aCol);
    geo.setAttribute('size', this.aSize);
    geo.setAttribute('alpha', this.aAlpha);

    this.material = new THREE.ShaderMaterial({
      uniforms: { scale: { value: 600 } },
      vertexShader: /* glsl */ `
        attribute float size;
        attribute float alpha;
        attribute vec3 color;
        uniform float scale;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = min(72.0, size * scale / max(0.1, -mv.z));
          gl_Position = projectionMatrix * mv;
          vColor = color;
          vAlpha = alpha;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.0, d);
          a *= a;
          gl_FragColor = vec4(vColor * a * vAlpha, 1.0);
        }`,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
    this._c = new THREE.Color();
  }

  setScale(viewportHeight, fov) {
    this.material.uniforms.scale.value = viewportHeight / (2 * Math.tan((fov * Math.PI) / 360));
  }

  emit(x, y, z, vx, vy, vz, color, size, life, drag = 0, grow = 0) {
    const i = this.cursor;
    this.cursor = (i + 1) % this.cap;
    const i3 = i * 3;
    this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
    this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz;
    this.col[i3] = color.r; this.col[i3 + 1] = color.g; this.col[i3 + 2] = color.b;
    this.size0[i] = size; this.size[i] = size;
    this.life[i] = life; this.maxLife[i] = life;
    this.drag[i] = drag; this.grow[i] = grow;
    this.alpha[i] = 1;
  }

  burst(pos, color, count, speed, size, life, drag = 1.5) {
    for (let k = 0; k < count; k++) {
      const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      const sp = speed * (0.25 + Math.random() * 0.75);
      this.emit(pos.x, pos.y, pos.z, s * Math.cos(th) * sp, u * sp, s * Math.sin(th) * sp, color,
        size * (0.5 + Math.random()), life * (0.5 + Math.random() * 0.7), drag);
    }
  }

  // Particles that converge on a point, used for cultivation and devouring.
  converge(target, color, count, radius, speed, size) {
    for (let k = 0; k < count; k++) {
      const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      const r = radius * (0.6 + Math.random() * 0.4);
      const dx = s * Math.cos(th), dy = u, dz = s * Math.sin(th);
      const sp = speed * (0.8 + Math.random() * 0.4);
      this.emit(target.x + dx * r, target.y + dy * r, target.z + dz * r, -dx * sp, -dy * sp, -dz * sp, color, size, r / sp, 0);
    }
  }

  update(dt) {
    const { pos, vel, life, maxLife, alpha, size, size0, drag, grow } = this;
    for (let i = 0; i < this.cap; i++) {
      if (life[i] <= 0) continue;
      life[i] -= dt;
      if (life[i] <= 0) {
        alpha[i] = 0;
        size[i] = 0;
        continue;
      }
      const i3 = i * 3;
      if (drag[i] > 0) {
        const k = Math.max(0, 1 - drag[i] * dt);
        vel[i3] *= k; vel[i3 + 1] *= k; vel[i3 + 2] *= k;
      }
      pos[i3] += vel[i3] * dt; pos[i3 + 1] += vel[i3 + 1] * dt; pos[i3 + 2] += vel[i3 + 2] * dt;
      const f = life[i] / maxLife[i];
      alpha[i] = f < 0.7 ? f / 0.7 : 1;
      size[i] = size0[i] * (1 + grow[i] * (1 - f));
    }
    this.aPos.needsUpdate = true;
    this.aCol.needsUpdate = true;
    this.aSize.needsUpdate = true;
    this.aAlpha.needsUpdate = true;
  }

  clear() {
    this.life.fill(0);
    this.alpha.fill(0);
    this.size.fill(0);
  }
}
