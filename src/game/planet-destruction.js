import * as THREE from 'three';

// An orbital view of the real encounter planet, followed by a finite crust
// breakup. Nothing is deleted from the world/save: this is the failed timeline
// held on screen until the player explicitly restores the encounter checkpoint.
export function buildPlanetDestruction(game, planet, accent) {
  const group = new THREE.Group(); group.name = 'Planetary defeat';
  const centre = game.localRoot.worldToLocal(planet.spin.getWorldPosition(new THREE.Vector3()));
  group.position.copy(centre); game.localRoot.add(group);
  const R = planet.R, hidden = [], fragments = [];
  const hot = new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0, wireframe: true, fog: false });
  const cracks = new THREE.Mesh(new THREE.IcosahedronGeometry(R * 1.045, 2), hot); group.add(cracks);
  // A tiny, encounter-only map samples the planet's own height function, so
  // the breaking crust retains its continents/ice instead of becoming a blank ball.
  const w = 128, h = 64, pixels = new Uint8Array(w * h * 4), d = new THREE.Vector3();
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    d.setFromSphericalCoords(1, (y + 0.5) / h * Math.PI, (x + 0.5) / w * Math.PI * 2);
    const height = planet.terrain?.height(d.x, d.y, d.z) ?? 0, sea = planet.terrain?.sea ?? -1;
    const rgb = planet.body.id === 'p2' ? height < sea ? [25, 68, 99] : [76, 109, 67] : planet.body.id === 'p5' ? [142, 187, 211] : [155, 112, 68];
    const shade = 0.8 + 0.2 * Math.sin(x * 0.31 + y * 0.7) + Math.max(-0.1, Math.min(0.2, height / 1600));
    const i = (y * w + x) * 4; for (let k = 0; k < 3; k++) pixels[i + k] = rgb[k] * shade; pixels[i + 3] = 255;
  }
  const map = new THREE.DataTexture(pixels, w, h); map.colorSpace = THREE.SRGBColorSpace; map.needsUpdate = true;
  map.magFilter = THREE.LinearFilter; map.minFilter = THREE.LinearFilter;
  const crust = new THREE.MeshBasicMaterial({ map, side: THREE.DoubleSide, fog: false });
  const coreMat = new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0, fog: false });
  const core = new THREE.Mesh(new THREE.SphereGeometry(R * 0.65, 24, 16), coreMat); group.add(core);
  const shockMat = new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, fog: false });
  const shock = new THREE.Mesh(new THREE.RingGeometry(R * 0.97, R, 96), shockMat); group.add(shock);
  for (let row = 0; row < 6; row++) for (let col = 0; col < 12; col++) {
    const phi = col * Math.PI / 6, theta = row * Math.PI / 6;
    const geo = new THREE.SphereGeometry(R, 4, 3, phi, Math.PI / 6, theta, Math.PI / 6), uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (col + uv.getX(i)) / 12, (row + 1 - uv.getY(i)) / 6);
    const mesh = new THREE.Mesh(geo, crust);
    mesh.visible = false; group.add(mesh);
    const direction = new THREE.Vector3().setFromSphericalCoords(1, theta + Math.PI / 12, phi + Math.PI / 12);
    fragments.push({ mesh, direction, speed: 0.13 + (row * 7 + col * 3) % 11 * 0.018 });
  }
  let broken = false, disposed = false;
  const hide = obj => { hidden.push([obj, obj.visible]); obj.visible = false; };
  return { group, centre, R,
    update(t) {
      if (disposed) return;
      hot.opacity = Math.min(0.85, t / 4); cracks.scale.setScalar(1 + Math.sin(t * 8) * 0.003);
      if (t >= 4 && !broken) {
        broken = true;
        // Keep localRoot visible even when it is parented to this planet.
        for (const child of planet.tilt.children) if (child !== planet.spin) hide(child);
        for (const child of planet.spin.children) if (child !== game.localRoot) hide(child);
        for (const { mesh } of fragments) mesh.visible = true;
        game.sound.thunder(); game.sound.explosion(centre, true);
      }
      const k = Math.max(0, t - 4);
      coreMat.opacity = Math.min(1, k); core.scale.setScalar(Math.max(0.05, 1 - k * 0.09));
      for (const f of fragments) { f.mesh.position.copy(f.direction).multiplyScalar(R * k * f.speed); f.mesh.scale.setScalar(1 + k * 0.018); }
      shockMat.opacity = Math.max(0, 0.75 - k * 0.08); shock.scale.setScalar(1 + k * 0.7);
      hot.opacity *= Math.max(0, 1 - k / 3);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const [obj, visible] of hidden) obj.visible = visible;
      group.removeFromParent(); group.traverse(o => o.geometry?.dispose());
      for (const m of [hot, crust, coreMat, shockMat]) m.dispose();
      map.dispose();
    },
  };
}
