import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { circuitTexture, glowTexture, hullTextures } from '../world/textures.js';

// Hand poses for the right hand (the left hand is mirrored).
// pos: wrist position in view space, rot: euler of the forearm, curl: index..pinky, thumb.
const POSES = {
  idle: { pos: [0.19, -0.19, -0.4], rot: [0.25, 0.35, -0.5], curl: [0.45, 0.55, 0.62, 0.7], thumb: 0.45 },
  cast: { pos: [0.15, -0.12, -0.46], rot: [1.2, 0.2, -0.15], curl: [0.05, 0.04, 0.08, 0.12], thumb: 0.1 },
  sword: { pos: [0.14, -0.14, -0.5], rot: [0.32, 0.28, -1.5], curl: [0, 0, 1.35, 1.45], thumb: 1.05 },
  mudra: { pos: [0.055, -0.15, -0.38], rot: [1.25, 0.05, -1.57], curl: [0.15, 0.12, 0.15, 0.2], thumb: 0.25 },
  fist: { pos: [0.2, -0.2, -0.38], rot: [0.35, 0.3, -0.6], curl: [1.45, 1.5, 1.5, 1.5], thumb: 1.1 },
  throw: { pos: [0.1, -0.1, -0.52], rot: [0.02, 0.15, -1.5], curl: [0.02, 0.02, 0.05, 0.08], thumb: 0.15 },
};

function beamTexture() {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 64;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(4, 64);
  for (let y = 0; y < 64; y++) {
    const v = Math.abs(y / 63 - 0.5) * 2;
    const a = Math.pow(1 - v, 2.2);
    for (let x = 0; x < 4; x++) {
      const i = (y * 4 + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = a * 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return new THREE.CanvasTexture(c);
}

class Hand {
  constructor(mats, mirror) {
    this.root = new THREE.Group();
    this.arm = new THREE.Group();
    this.root.add(this.arm);
    this.arm.scale.setScalar(0.74);
    if (mirror) this.root.scale.x = -1;
    const { armor, plate, neon, circuit, joint } = mats;

    const fore = new THREE.Mesh(new THREE.CylinderGeometry(0.043, 0.058, 0.5, 18, 1).rotateX(Math.PI / 2).translate(0, 0, 0.25), circuit);
    this.arm.add(fore);
    const plateTop = new THREE.Mesh(new RoundedBoxGeometry(0.075, 0.022, 0.32, 2, 0.008), plate);
    plateTop.position.set(0, 0.046, 0.2);
    plateTop.rotation.x = -0.04;
    this.arm.add(plateTop);
    const plateSide = new THREE.Mesh(new RoundedBoxGeometry(0.02, 0.05, 0.26, 2, 0.006), plate);
    plateSide.position.set(0.05, 0.005, 0.24);
    this.arm.add(plateSide);
    for (const x of [-0.026, 0.026]) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.005, 0.27), neon);
      strip.position.set(x, 0.059, 0.2);
      this.arm.add(strip);
    }
    const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.046, 0.006, 6, 24), neon);
    cuff.position.z = 0.03;
    this.arm.add(cuff);
    const cuff2 = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.03, 18).rotateX(Math.PI / 2), armor);
    cuff2.position.z = 0.055;
    this.arm.add(cuff2);

    this.hand = new THREE.Group();
    this.arm.add(this.hand);
    const palm = new THREE.Mesh(new RoundedBoxGeometry(0.088, 0.03, 0.095, 3, 0.012), armor);
    palm.position.z = -0.045;
    this.hand.add(palm);
    const knuckle = new THREE.Mesh(new RoundedBoxGeometry(0.08, 0.012, 0.02, 2, 0.005), plate);
    knuckle.position.set(0, 0.018, -0.082);
    this.hand.add(knuckle);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.004, 0.06), neon);
    back.position.set(0, 0.0175, -0.045);
    this.hand.add(back);

    this.fingers = [];
    const fingerDefs = [
      { x: -0.03, lens: [0.038, 0.026, 0.021] },
      { x: -0.01, lens: [0.043, 0.028, 0.023] },
      { x: 0.011, lens: [0.039, 0.026, 0.021] },
      { x: 0.031, lens: [0.03, 0.021, 0.018] },
    ];
    for (const fd of fingerDefs) {
      const joints = [];
      let parent = this.hand;
      let z = -0.093;
      fd.lens.forEach((len, k) => {
        const j = new THREE.Group();
        j.position.set(k === 0 ? fd.x : 0, 0, k === 0 ? z : -fd.lens[k - 1]);
        const seg = new THREE.Mesh(new RoundedBoxGeometry(0.019 - k * 0.002, 0.018 - k * 0.002, len, 2, 0.006), k === 0 ? armor : joint);
        seg.position.z = -len / 2;
        j.add(seg);
        parent.add(j);
        joints.push(j);
        parent = j;
        z = 0;
      });
      const tip = new THREE.Object3D();
      tip.position.z = -fd.lens[2];
      parent.add(tip);
      this.fingers.push({ joints, tip });
    }
    const thumbBase = new THREE.Group();
    thumbBase.position.set(-0.044, -0.004, -0.03);
    thumbBase.rotation.set(0, 0.7, 0.4);
    this.hand.add(thumbBase);
    const t1 = new THREE.Group();
    thumbBase.add(t1);
    const ts1 = new THREE.Mesh(new RoundedBoxGeometry(0.02, 0.019, 0.034, 2, 0.006), armor);
    ts1.position.z = -0.017;
    t1.add(ts1);
    const t2 = new THREE.Group();
    t2.position.z = -0.034;
    t1.add(t2);
    const ts2 = new THREE.Mesh(new RoundedBoxGeometry(0.018, 0.017, 0.026, 2, 0.006), joint);
    ts2.position.z = -0.013;
    t2.add(ts2);
    this.thumb = [t1, t2];

    this.palmGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true }));
    this.palmGlow.position.set(0, -0.03, -0.05);
    this.palmGlow.scale.setScalar(0.08);
    this.hand.add(this.palmGlow);
    this.tipGlows = [0, 1].map((i) => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true, opacity: 0 }));
      s.scale.setScalar(0.04);
      this.fingers[i].tip.add(s);
      return s;
    });

    this.cur = { pos: new THREE.Vector3(...POSES.idle.pos), rot: new THREE.Vector3(...POSES.idle.rot), curl: [...POSES.idle.curl], thumb: POSES.idle.thumb };
    this.pose = 'idle';
    this.kick = 0;
    this.holdT = 0;
  }

  setColor(c) {
    this.palmGlow.material.color.copy(c).multiplyScalar(1.6);
    for (const s of this.tipGlows) s.material.color.copy(c).multiplyScalar(2);
  }

  update(dt, poseName, rate, extra) {
    const p = POSES[poseName];
    const k = 1 - Math.exp(-dt * rate);
    const c = this.cur;
    c.pos.x += (p.pos[0] - c.pos.x) * k;
    c.pos.y += (p.pos[1] - c.pos.y) * k;
    c.pos.z += (p.pos[2] - c.pos.z) * k;
    c.rot.x += (p.rot[0] - c.rot.x) * k;
    c.rot.y += (p.rot[1] - c.rot.y) * k;
    c.rot.z += (p.rot[2] - c.rot.z) * k;
    for (let i = 0; i < 4; i++) c.curl[i] += (p.curl[i] - c.curl[i]) * k;
    c.thumb += (p.thumb - c.thumb) * k;

    this.kick = Math.max(0, this.kick - dt * 6);
    this.arm.position.set(c.pos.x + extra.x, c.pos.y + extra.y, c.pos.z + extra.z + this.kick * 0.05);
    this.arm.rotation.set(c.rot.x + extra.rx - this.kick * 0.25, c.rot.y + extra.ry, c.rot.z);
    this.fingers.forEach((f, i) => {
      const curl = c.curl[i];
      f.joints[0].rotation.x = -curl * 0.9;
      f.joints[1].rotation.x = -curl * 1.1;
      f.joints[2].rotation.x = -curl * 0.8;
      f.joints[0].rotation.y = (i - 1.5) * 0.06 * (1 - Math.min(1, curl));
    });
    this.thumb[0].rotation.y = -c.thumb * 0.9;
    this.thumb[1].rotation.y = -c.thumb * 1.0;
    this.thumb[0].rotation.x = -c.thumb * 0.3;
  }
}

// First-person cybernetic arms rendered in their own scene and camera so they
// never clip into the world, plus the spirit thread that links the left hand
// to the flying swords.
export class ViewModel {
  constructor(mainScene) {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.01, 10);
    this.ambient = new THREE.AmbientLight(0x8090b8, 0.55);
    this.sun = new THREE.DirectionalLight(0xffffff, 2.2);
    this.rimLight = new THREE.DirectionalLight(0x3ef2ff, 0.9);
    this.rimLight.position.set(-1, -0.6, 0.4);
    this.scene.add(this.ambient, this.sun, this.rimLight, this.sun.target);

    const { map, rough } = hullTextures();
    const circ = circuitTexture();
    circ.repeat.set(3, 1.5);
    this.mats = {
      armor: new THREE.MeshStandardMaterial({ color: 0x232833, metalness: 0.85, roughness: 0.32 }),
      plate: new THREE.MeshStandardMaterial({ map, roughnessMap: rough, color: 0x9aa3b4, metalness: 0.8, roughness: 0.4 }),
      joint: new THREE.MeshStandardMaterial({ color: 0x15181f, metalness: 0.7, roughness: 0.45 }),
      neon: new THREE.MeshBasicMaterial({ color: 0xffffff }),
      circuit: new THREE.MeshStandardMaterial({ color: 0x1b1f29, metalness: 0.85, roughness: 0.35, emissiveMap: circ, emissive: 0xffffff, emissiveIntensity: 0.75 }),
    };
    this.right = new Hand(this.mats, false);
    this.left = new Hand(this.mats, true);
    this.scene.add(this.right.root, this.left.root);
    this.sway = new THREE.Vector2();
    this.time = 0;
    this.hurt = 0;
    this.color = new THREE.Color();

    // spirit thread (main scene)
    const segs = 24;
    this.threadSegs = segs;
    const geo = new THREE.BufferGeometry();
    this.threadPos = new Float32Array((segs + 1) * 2 * 3);
    const uv = new Float32Array((segs + 1) * 2 * 2);
    const idx = [];
    for (let i = 0; i <= segs; i++) {
      uv.set([i / segs, 0, i / segs, 1], i * 4);
      if (i < segs) {
        const a = i * 2;
        idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    geo.setAttribute('position', new THREE.BufferAttribute(this.threadPos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    this.threadMat = new THREE.MeshBasicMaterial({ map: beamTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, opacity: 0 });
    this.thread = new THREE.Mesh(geo, this.threadMat);
    this.thread.frustumCulled = false;
    mainScene.add(this.thread);
  }

  setEnv(env) {
    this.scene.environment = env;
  }

  setColor(hex) {
    this.color.set(hex);
    this.mats.neon.color.copy(this.color).multiplyScalar(2.4);
    this.mats.circuit.emissive.copy(this.color);
    this.right.setColor(this.color);
    this.left.setColor(this.color);
    this.threadMat.color.copy(this.color).multiplyScalar(1.6);
  }

  setAspect(a) {
    this.camera.aspect = a;
    this.camera.updateProjectionMatrix();
  }

  setVisible(v) {
    this.right.root.visible = v;
    this.left.root.visible = v;
    if (!v) this.threadMat.opacity = 0;
  }

  castRight() { this.right.holdT = 0.16; this.right.kick = 1; }
  castLeft() { this.left.holdT = 0.16; this.left.kick = 1; }
  throwLeft() { this.left.throwT = 0.35; this.left.kick = 0.6; }
  hit() { this.hurt = 1; }

  update(dt, s) {
    this.time += dt;
    // sway lags behind mouse motion
    this.sway.x += (-s.mouseX * 0.00035 - this.sway.x) * Math.min(1, dt * 10);
    this.sway.y += (s.mouseY * 0.00035 - this.sway.y) * Math.min(1, dt * 10);
    this.sway.clampScalar(-0.04, 0.04);
    this.hurt = Math.max(0, this.hurt - dt * 4);
    const speed = Math.min(1, s.speed / 300);
    const bob = Math.sin(this.time * (2 + speed * 4)) * (0.004 + speed * 0.006);
    const breathe = Math.sin(this.time * 1.4) * 0.003;
    const shake = this.hurt * 0.015;
    const extra = (side) => ({
      x: this.sway.x + (Math.random() - 0.5) * shake,
      y: this.sway.y + bob * side + breathe + (Math.random() - 0.5) * shake - (s.boost ? 0.02 : 0),
      z: s.boost ? 0.04 : 0,
      rx: this.sway.y * 2,
      ry: this.sway.x * 2,
    });

    const r = this.right, l = this.left;
    r.holdT = Math.max(0, r.holdT - dt);
    l.holdT = Math.max(0, l.holdT - dt);
    l.throwT = Math.max(0, (l.throwT || 0) - dt);
    let rp = 'idle', lp = 'idle';
    if (s.meditating) { rp = 'mudra'; lp = 'mudra'; }
    else if (s.boost) { rp = 'fist'; lp = 'fist'; }
    if (r.holdT > 0) rp = 'cast';
    if (l.holdT > 0) lp = 'cast';
    if (s.controlling) lp = 'sword';
    if (l.throwT > 0) lp = 'throw';
    r.update(dt, rp, rp === 'cast' ? 26 : 9, extra(1));
    l.update(dt, lp, lp === 'cast' || lp === 'throw' ? 26 : 9, extra(-1));

    const glowBase = 0.5 + 0.5 * Math.min(1, s.energyFrac * 1.2);
    r.palmGlow.material.opacity = (rp === 'cast' ? 1 : rp === 'mudra' ? 0.9 : 0.25) * glowBase;
    l.palmGlow.material.opacity = (lp === 'cast' ? 1 : lp === 'mudra' ? 0.9 : 0.25) * glowBase;
    r.palmGlow.scale.setScalar(rp === 'cast' ? 0.13 : 0.07);
    l.palmGlow.scale.setScalar(lp === 'cast' ? 0.13 : 0.07);
    const tipOn = lp === 'sword' ? 1 : 0;
    for (const t of l.tipGlows) t.material.opacity += (tipOn - t.material.opacity) * Math.min(1, dt * 10);

    // light the arms like the world
    this.sun.position.copy(s.sunDirView).multiplyScalar(5);
    this.sun.color.copy(s.sunColor);
  }

  // Where the left index fingertip appears on screen (NDC).
  leftTipNDC(out) {
    this.left.fingers[1].tip.getWorldPosition(out);
    return out.project(this.camera);
  }

  updateThread(dt, camera, target, active, time) {
    const goal = active ? 0.95 : 0;
    this.threadMat.opacity += (goal - this.threadMat.opacity) * Math.min(1, dt * 12);
    if (this.threadMat.opacity < 0.01) {
      this.thread.visible = false;
      return;
    }
    this.thread.visible = true;
    const ndc = this.leftTipNDC(new THREE.Vector3());
    const dir = new THREE.Vector3(ndc.x, ndc.y, 0.5).unproject(camera).sub(camera.position).normalize();
    const a = camera.position.clone().addScaledVector(dir, 1.2);
    const b = target;
    const ab = b.clone().sub(a);
    const len = ab.length();
    const toCam = camera.position.clone().sub(a).normalize();
    const side = new THREE.Vector3().crossVectors(ab, toCam).normalize();
    const up = new THREE.Vector3().crossVectors(side, ab).normalize();
    const p = this.threadPos;
    for (let i = 0; i <= this.threadSegs; i++) {
      const t = i / this.threadSegs;
      const env = Math.sin(t * Math.PI);
      const wob = Math.sin(t * 9 - time * 14) * env * Math.min(3, len * 0.02);
      const pt = a.clone().addScaledVector(ab, t).addScaledVector(up, wob).addScaledVector(side, Math.cos(t * 7 - time * 11) * env * Math.min(2, len * 0.012));
      const w = 0.02 + t * Math.min(1.6, len * 0.012);
      p.set([pt.x + side.x * w, pt.y + side.y * w, pt.z + side.z * w, pt.x - side.x * w, pt.y - side.y * w, pt.z - side.z * w], i * 6);
    }
    this.thread.geometry.attributes.position.needsUpdate = true;
  }
}
