import * as THREE from 'three';
import { settings } from '../core/settings.js';

// The plaza remains visible and animated while the destination prepares.
// Arrival changes the render pass at full corridor intensity, then eases out.
export class VirtualTransfer {
  constructor(game) { this.g = game; this.active = false; }

  begin() {
    const g = this.g, camera = g.vu.camera;
    this.active = true;
    this.phase = 'depart';
    this.time = 0;
    this.plazaPos = camera.position.clone();
    this.plazaQuat = camera.quaternion.clone();
    this.plazaFov = camera.fov;
    g.mode = 'transferring';
    g.menus.showPause(false);
    g.hud.show(false);
    g.post.vmEnabled = false;
    g.post.renderPass.scene = g.vu.scene;
    g.post.renderPass.camera = camera;
    g.vu.scene.add(camera);
    camera.add(g.warpLines);
    g.warpLines.visible = true;
    document.getElementById('fade').style.opacity = 0;
    g.sound.warp();
  }

  arrive() {
    const g = this.g;
    this.phase = 'arrive';
    this.time = 0;
    g.positionCamera(0.016);
    g.updateAtmosphereLighting();
    g.post.renderPass.scene = g.scene;
    g.post.renderPass.camera = g.camera;
    g.camera.add(g.warpLines);
    document.getElementById('vu-hud').classList.add('hidden');
    g.flare.visible = true;
    g.sound.arrive();
    return new Promise((resolve) => { this.resolve = resolve; });
  }

  update(dt) {
    if (!this.active) return;
    const g = this.g;
    this.time += dt;
    const intensity = this.phase === 'arrive' ? Math.max(0, 1 - this.time / 0.85) : Math.min(1, this.time / 0.65);
    const camera = g.post.renderPass.camera;
    if (this.phase === 'depart') {
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.plazaQuat);
      camera.position.copy(this.plazaPos).addScaledVector(forward, 24 * (1 - Math.exp(-this.time * 2)));
      g.vu.core.rotation.y += dt * 0.8;
      g.vu.motes.rotation.y += dt * 0.08;
    }
    camera.fov = (this.phase === 'depart' ? this.plazaFov : settings.get('fov')) + intensity * 28;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    g.updateWarpLines(dt, intensity);
    Object.assign(g.post.fx, { speed: settings.get('speedBlur') ? intensity : 0, glitch: intensity * 0.08, flash: intensity * 0.08, damage: 0 });
    g.input.consumeMouse();
    if (this.phase === 'arrive' && this.time >= 0.9) this.end();
  }

  end() {
    if (!this.active) return;
    const g = this.g;
    this.active = false;
    g.camera.add(g.warpLines);
    g.warpLines.visible = false;
    g.warpLines.material.opacity = 0;
    g.vu.camera.position.copy(this.plazaPos);
    g.vu.camera.quaternion.copy(this.plazaQuat);
    g.vu.camera.fov = this.plazaFov;
    g.vu.camera.updateProjectionMatrix();
    g.camera.fov = settings.get('fov');
    g.camera.updateProjectionMatrix();
    Object.assign(g.post.fx, { speed: 0, glitch: 0, flash: 0 });
    document.getElementById('fade').style.opacity = 0;
    const resolve = this.resolve;
    this.resolve = null;
    if (resolve) resolve();
  }
}
