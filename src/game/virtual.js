import * as THREE from 'three';
import { signTexture, glowTexture, softDotTexture } from '../world/textures.js';
import { npcGeometry } from '../world/interiors.js';

// The Virtual Universe (虚拟宇宙): a light neon cyberspace you can enter from
// anywhere through your ring. Its own scene and camera, all unlit materials,
// so it costs very little to draw. Your real body waits, paused and safe.

const KIOSKS = [
  { id: 'shop', name: 'Star Mall', cn: '星际商城', color: '#ffe44d', a: -Math.PI / 2 },
  { id: 'bounties', name: 'Bounty Board', cn: '悬赏榜', color: '#ff3c7d', a: -Math.PI / 2 + 1.26 },
  { id: 'sim', name: 'Simulator', cn: '模拟战场', color: '#3ef2ff', a: -Math.PI / 2 + 2.52 },
  { id: 'fame', name: 'Hall of Fame', cn: '名人堂', color: '#b98cff', a: -Math.PI / 2 - 1.26 },
  { id: 'exit', name: 'Log Out', cn: '退出', color: '#7affd8', a: -Math.PI / 2 - 2.52 },
];

function gridTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = '#05060f';
  x.fillRect(0, 0, 128, 128);
  x.strokeStyle = 'rgba(62,242,255,0.55)';
  x.lineWidth = 2;
  x.strokeRect(0, 0, 128, 128);
  x.strokeStyle = 'rgba(62,242,255,0.15)';
  x.lineWidth = 1;
  for (let i = 32; i < 128; i += 32) {
    x.beginPath(); x.moveTo(i, 0); x.lineTo(i, 128); x.stroke();
    x.beginPath(); x.moveTo(0, i); x.lineTo(128, i); x.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(60, 60);
  t.anisotropy = 8;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class VirtualWorld {
  constructor() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x05040e);
    this.scene.fog = new THREE.Fog(0x05040e, 40, 170);
    this.camera = new THREE.PerspectiveCamera(80, 1, 0.1, 2000);
    this.built = false;
    this.pos = new THREE.Vector3(0, 0, 30);
    this.yaw = 0;
    this.pitch = 0;
    this.sim = null;
    this.time = 0;
  }

  build() {
    if (this.built) return;
    this.built = true;
    const s = this.scene;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: gridTexture() }));
    s.add(floor);
    // sky dome with a vertical gradient
    const sky = new THREE.SphereGeometry(900, 32, 16);
    const col = new Float32Array(sky.attributes.position.count * 3);
    for (let i = 0; i < sky.attributes.position.count; i++) {
      const y = sky.attributes.position.getY(i) / 900;
      const c = new THREE.Color().lerpColors(new THREE.Color(0x140a2a), new THREE.Color(0x02030a), Math.max(0, y));
      if (y < 0.05) c.lerp(new THREE.Color(0x3a0a3a), 1 - Math.max(0, y) / 0.05);
      col.set([c.r, c.g, c.b], i * 3);
    }
    sky.setAttribute('color', new THREE.BufferAttribute(col, 3));
    s.add(new THREE.Mesh(sky, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false })));
    // drifting data motes
    const n = 1500;
    const pp = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) pp.set([(Math.random() - 0.5) * 300, Math.random() * 80, (Math.random() - 0.5) * 300], i * 3);
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(pp, 3));
    this.motes = new THREE.Points(pg, new THREE.PointsMaterial({ map: softDotTexture(), size: 0.6, color: new THREE.Color(0.5, 1.6, 2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    s.add(this.motes);
    // the central emblem
    this.core = new THREE.Group();
    const ringMat = (c) => new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(2.2) });
    for (let i = 0; i < 3; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(6 + i * 2.5, 0.12, 6, 64), ringMat([0x3ef2ff, 0xb98cff, 0xff3c7d][i]));
      ring.rotation.set(Math.random() * 3, Math.random() * 3, 0);
      this.core.add(ring);
    }
    this.core.add(new THREE.Mesh(new THREE.OctahedronGeometry(2.6, 0), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.4, 2.6), wireframe: true })));
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: new THREE.Color(0.8, 0.6, 2.4), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    halo.scale.setScalar(26);
    this.core.add(halo);
    this.core.position.y = 16;
    s.add(this.core);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(10, 12, 1.2, 6), new THREE.MeshBasicMaterial({ color: 0x0c1020 }));
    base.position.y = 0.6;
    s.add(base);
    s.add(new THREE.Mesh(new THREE.TorusGeometry(11, 0.15, 4, 6).rotateX(Math.PI / 2).translate(0, 1.25, 0), ringMat(0x3ef2ff)));
    // title
    const title = new THREE.Mesh(new THREE.PlaneGeometry(40, 6.4), new THREE.MeshBasicMaterial({ map: signTexture('VIRTUAL UNIVERSE · 虚拟宇宙', '#3ef2ff'), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, color: new THREE.Color(1.8, 1.8, 1.8) }));
    title.position.set(0, 30, 0);
    this.title = title;
    s.add(title);
    // kiosks around the plaza
    this.kiosks = KIOSKS.map((k) => {
      const g = new THREE.Group();
      const R = 24;
      g.position.set(Math.cos(k.a) * R, 0, Math.sin(k.a) * R);
      g.lookAt(0, 0, 0);
      const c = new THREE.Color(k.color);
      g.add(new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.6, 0.8, 6), new THREE.MeshBasicMaterial({ color: 0x0c1020 })));
      g.add(new THREE.Mesh(new THREE.TorusGeometry(3.4, 0.1, 4, 6).rotateX(Math.PI / 2).translate(0, 0.85, 0), new THREE.MeshBasicMaterial({ color: c.clone().multiplyScalar(2.4) })));
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(7, 1.12), new THREE.MeshBasicMaterial({ map: signTexture(`${k.name.toUpperCase()} · ${k.cn}`, k.color), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, color: new THREE.Color(1.8, 1.8, 1.8) }));
      panel.position.set(0, 5.2, 0);
      g.add(panel);
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 12, 16, 1, true), new THREE.MeshBasicMaterial({ color: c.clone().multiplyScalar(0.9), transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      beam.position.y = 6;
      g.add(beam);
      const icon = new THREE.Mesh(new THREE.IcosahedronGeometry(0.9, 0), new THREE.MeshBasicMaterial({ color: c.clone().multiplyScalar(2.2), wireframe: true }));
      icon.position.y = 3.2;
      g.add(icon);
      s.add(g);
      return { ...k, group: g, icon, pos: g.position.clone() };
    });
    // avatars of other "users" strolling the plaza
    const an = 26;
    this.avatars = new THREE.InstancedMesh(npcGeometry(), new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true }), an);
    this.walkers = [];
    const pal = [0x3ef2ff, 0xff3c7d, 0xb98cff, 0xffe44d, 0x7affd8];
    for (let i = 0; i < an; i++) {
      this.walkers.push({ a: Math.random() * Math.PI * 2, r: 14 + Math.random() * 40, s: (0.05 + Math.random() * 0.08) * (Math.random() < 0.5 ? 1 : -1), bob: Math.random() * 6 });
      this.avatars.setColorAt(i, new THREE.Color(pal[i % pal.length]).multiplyScalar(1.4));
    }
    this.avatars.frustumCulled = false;
    s.add(this.avatars);
    // simulator targets live here
    this.targets = new THREE.Group();
    s.add(this.targets);
  }

  enter(aspect) {
    this.build();
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    this.pos.set(0, 0, 32);
    this.yaw = 0;
    this.pitch = 0.08;
    this.sim = null;
    this.clearTargets();
  }

  setAspect(a) {
    this.camera.aspect = a;
    this.camera.updateProjectionMatrix();
  }

  clearTargets() {
    while (this.targets.children.length) {
      const t = this.targets.children[0];
      this.targets.remove(t);
      t.material.dispose();
    }
  }

  // Target practice: hit 12 holographic orbs as fast as you can.
  startSim() {
    this.clearTargets();
    this.sim = { left: 12, t: 0, next: 0 };
    this.spawnTarget();
  }

  spawnTarget() {
    const k = this.kiosks.find((x) => x.id === 'sim');
    const center = k.pos.clone().multiplyScalar(0.55);
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.9, 1), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 0.6, 1.2), wireframe: true }));
    m.position.copy(center).add(new THREE.Vector3((Math.random() - 0.5) * 22, 1.5 + Math.random() * 6, (Math.random() - 0.5) * 22));
    m.userData.spin = (Math.random() - 0.5) * 4;
    this.targets.add(m);
  }

  // Returns { interact, simDone } for the game to act on.
  update(dt, input, look, sensitivity) {
    this.time += dt;
    this.yaw -= look.x * sensitivity;
    this.pitch = Math.max(-1.3, Math.min(1.3, this.pitch - look.y * sensitivity));
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const move = new THREE.Vector3();
    if (input.act('forward')) move.add(fwd);
    if (input.act('back')) move.sub(fwd);
    if (input.act('right')) move.add(right);
    if (input.act('left')) move.sub(right);
    if (move.lengthSq()) this.pos.addScaledVector(move.normalize(), (input.act('sprint') ? 16 : 8) * dt);
    // stay inside the plaza and out of the furniture
    const lim = 80;
    if (this.pos.length() > lim) this.pos.setLength(lim);
    const pushOut = (c, r) => {
      const d = Math.hypot(this.pos.x - c.x, this.pos.z - c.z);
      if (d < r && d > 0.001) {
        this.pos.x = c.x + ((this.pos.x - c.x) / d) * r;
        this.pos.z = c.z + ((this.pos.z - c.z) / d) * r;
      }
    };
    pushOut(new THREE.Vector3(), 12.5);
    for (const k of this.kiosks) pushOut(k.pos, 4.2);
    this.camera.position.set(this.pos.x, 1.7 + Math.sin(this.time * 7) * (move.lengthSq() ? 0.03 : 0), this.pos.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    this.camera.updateMatrixWorld();
    // ambience
    this.core.rotation.y += dt * 0.3;
    this.core.children.forEach((c, i) => { if (c.isMesh && c.geometry.type === 'TorusGeometry') c.rotation.x += dt * (0.3 + i * 0.2); });
    this.title.lookAt(this.camera.position.x, 30, this.camera.position.z);
    for (const k of this.kiosks) k.icon.rotation.y += dt * 1.2;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
    this.walkers.forEach((w, i) => {
      w.a += w.s * dt;
      const x = Math.cos(w.a) * w.r, z = Math.sin(w.a) * w.r;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -w.a + (w.s > 0 ? Math.PI : 0));
      m4.compose(new THREE.Vector3(x, Math.abs(Math.sin(this.time * 5 + w.bob)) * 0.05, z), q, new THREE.Vector3(1, 1, 1));
      this.avatars.setMatrixAt(i, m4);
    });
    this.avatars.instanceMatrix.needsUpdate = true;
    this.motes.rotation.y += dt * 0.01;
    // simulator
    let simDone = null;
    if (this.sim) {
      this.sim.t += dt;
      for (const t of this.targets.children) t.rotation.y += t.userData.spin * dt;
      if (input.hit('fire') && this.targets.children.length) {
        const ray = new THREE.Raycaster();
        ray.setFromCamera(new THREE.Vector2(0, 0), this.camera);
        const hits = ray.intersectObjects(this.targets.children, false);
        if (hits.length) {
          const t = hits[0].object;
          this.targets.remove(t);
          t.material.dispose();
          this.sim.left--;
          if (this.sim.left > 0) this.spawnTarget();
          else {
            simDone = this.sim.t;
            this.sim = null;
          }
        }
      }
    }
    // the closest kiosk in reach
    let interact = null, bd = 6;
    for (const k of this.kiosks) {
      const d = Math.hypot(this.pos.x - k.pos.x, this.pos.z - k.pos.z);
      if (d < bd) { bd = d; interact = k; }
    }
    return { interact, simDone, hitSim: !!this.sim };
  }
}
