import * as THREE from 'three';
import { bevelBox, taperedHull } from '../world/geometry.js';

// Ground vehicles: hover machines that ride the terrain (and skim water),
// steer toward where you look, and smash through trees and beasts.

export const VEHICLES = {
  bike: {
    name: 'Hoverbike', cn: '悬浮摩托', price: 600, speed: 55, boost: 1.45, accel: 28, turn: 2.6, hull: 1.2, ram: 1, radius: 1.3, hover: 0.9, seat: 1.9, cam: 2.2, dist: 5.8, color: 0x3ef2ff,
    desc: 'Light and quick. Leans hard into turns and jumps off every hill.',
  },
  rover: {
    name: 'Armored Rover', cn: '装甲越野车', price: 2000, speed: 46, boost: 1.35, accel: 20, turn: 1.8, hull: 3, ram: 2.6, radius: 2.4, hover: 1.1, seat: 2.6, cam: 3.2, dist: 8.5, color: 0xffb347,
    desc: 'A plated hover-truck. Slower, but it shrugs off bites and ploughs straight through packs of beasts.',
  },
  racer: {
    name: 'Lightning Racer', cn: '闪电赛车', price: 6000, speed: 95, boost: 1.4, accel: 40, turn: 2.0, hull: 1.4, ram: 1.4, radius: 1.8, hover: 0.8, seat: 1.6, cam: 2.2, dist: 7, color: 0xff3c7d,
    desc: 'The fastest thing on the ground. Hold on.',
  },
};
export const VEHICLE_IDS = Object.keys(VEHICLES);

const glow = (hex, k = 2.4) => new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(k) });

function buildModel(id, color) {
  const g = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color, metalness: 0.6, roughness: 0.35 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1a1d24, metalness: 0.7, roughness: 0.45 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x9aa3b4, metalness: 0.9, roughness: 0.3 });
  const light = glow(color);
  const pads = [];
  const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); g.add(m); return m; };
  const pad = (x, z, r) => { const m = add(new THREE.CylinderGeometry(r, r * 0.8, 0.16, 16), light, x, -0.55, z); pads.push(m); };
  if (id === 'bike') {
    add(taperedHull(0.62, 0.5, 2.3, 0.55), paint, 0, 0, 0);
    add(bevelBox(0.5, 0.18, 0.9, 0.05, true), dark, 0, 0.32, 0.25);
    add(taperedHull(0.5, 0.4, 0.6, 0.7), paint, 0, 0.3, -0.85).rotation.x = -0.4;
    add(new THREE.CylinderGeometry(0.03, 0.03, 0.9, 6), metal, 0, 0.62, -0.9).rotation.z = Math.PI / 2;
    add(new THREE.BoxGeometry(0.34, 0.06, 0.04), light, 0, 0.18, -1.17);
    add(new THREE.BoxGeometry(0.5, 0.08, 0.04), glow(0xff3030), 0, 0.12, 1.16);
    pad(0, -0.75, 0.42);
    pad(0, 0.75, 0.42);
  } else if (id === 'rover') {
    add(taperedHull(2.1, 1.0, 3.8, 0.88), paint, 0, 0.1, 0);
    add(taperedHull(1.8, 0.8, 1.6, 0.78), dark, 0, 0.9, -0.2);
    add(bevelBox(2.3, 0.35, 0.3, 0.06, true), metal, 0, -0.05, -2.0);
    add(new THREE.BoxGeometry(1.4, 0.1, 0.05), light, 0, 0.35, -1.92);
    add(new THREE.BoxGeometry(1.6, 0.1, 0.05), glow(0xff3030), 0, 0.35, 1.92);
    for (const [x, z] of [[-0.85, -1.3], [0.85, -1.3], [-0.85, 1.3], [0.85, 1.3]]) pad(x, z, 0.5);
  } else {
    const body = taperedHull(1.7, 0.45, 3.6, 0.6);
    add(body, paint, 0, 0, 0);
    add(new THREE.SphereGeometry(0.5, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), dark, 0, 0.2, 0.2).scale.set(1, 0.7, 1.6);
    add(new THREE.BoxGeometry(1.9, 0.06, 0.3), paint, 0, 0.45, 1.65);
    add(new THREE.BoxGeometry(0.1, 0.06, 3.2), light, -0.86, 0, 0);
    add(new THREE.BoxGeometry(0.1, 0.06, 3.2), light, 0.86, 0, 0);
    add(new THREE.BoxGeometry(1.2, 0.08, 0.04), glow(0xff3030), 0, 0.12, 1.81);
    for (const [x, z] of [[-0.6, -1.1], [0.6, -1.1], [-0.6, 1.1], [0.6, 1.1]]) pad(x, z, 0.36);
  }
  return {
    group: g,
    pads,
    dispose() {
      g.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
    },
  };
}

export class Vehicle {
  constructor(root, id) {
    this.root = root;
    this.pos = new THREE.Vector3();
    this.fwd = new THREE.Vector3(0, 0, -1);
    this.speed = 0;
    this.vUp = 0;
    this.lean = 0;
    this.time = 0;
    this.setKind(id);
  }

  setKind(id) {
    if (this.model) {
      this.root.remove(this.model.group);
      this.model.dispose();
    }
    this.id = id;
    this.def = VEHICLES[id];
    this.model = buildModel(id, this.def.color);
    this.root.add(this.model.group);
  }

  place(pos, fwd) {
    this.pos.copy(pos);
    const up = pos.clone().normalize();
    this.fwd.copy(fwd).projectOnPlane(up).normalize();
    this.speed = 0;
    this.vUp = 0;
    this.sync();
  }

  rebase(m, q) {
    this.pos.applyMatrix4(m);
    this.fwd.applyQuaternion(q);
    this.sync();
  }

  // ctx: { planet, look (camera forward), move {x, z}, boost, jump, collide(pos, r) }
  update(dt, ctx) {
    const d = this.def;
    this.time += dt;
    const up = this.pos.clone().normalize();
    this.fwd.projectOnPlane(up).normalize();
    // steer toward where you look; A/D steer too
    const want = ctx.look.clone().projectOnPlane(up);
    let turn = 0;
    if (want.lengthSq() > 1e-4) {
      want.normalize();
      const ang = Math.atan2(new THREE.Vector3().crossVectors(this.fwd, want).dot(up), this.fwd.dot(want));
      turn = THREE.MathUtils.clamp(ang, -d.turn * dt, d.turn * dt);
    }
    turn -= ctx.move.x * d.turn * dt * 0.6;
    this.fwd.applyAxisAngle(up, turn);
    this.lean += ((-turn / Math.max(dt, 1e-3)) * 0.18 * Math.min(1, Math.abs(this.speed) / 20) - this.lean) * Math.min(1, dt * 6);
    // throttle, brake, drag
    const max = d.speed * (ctx.boost ? d.boost : 1);
    if (ctx.move.z > 0) this.speed += d.accel * (ctx.boost ? 1.4 : 1) * dt;
    else if (ctx.move.z < 0) this.speed -= d.accel * 1.6 * dt;
    else this.speed *= 1 - Math.min(1, dt * 0.7);
    this.speed = THREE.MathUtils.clamp(this.speed, -d.speed * 0.3, max);
    if (this.speed > max) this.speed += (max - this.speed) * Math.min(1, dt * 2);
    const before = this.pos.clone();
    this.pos.addScaledVector(this.fwd, this.speed * dt);
    // hover over the ground (or water); fly off crests, hop on demand
    const n = this.pos.clone().normalize();
    const floor = (ctx.planet.groundBelow ? ctx.planet.groundBelow(this.pos.clone().addScaledVector(n, 1.5)) : ctx.planet.floorRadius(n.x, n.y, n.z)) + d.hover;
    let D = this.pos.length();
    const grounded = D <= floor + 0.15;
    if (grounded && ctx.jump) this.vUp = 9;
    if (grounded && this.vUp <= 0) {
      D = floor;
      this.vUp = 0;
    } else {
      this.vUp -= 22 * dt;
      D += this.vUp * dt;
      if (D < floor) {
        D = floor;
        if (this.vUp < -12) this.landed = -this.vUp;
        this.vUp = 0;
      }
    }
    this.pos.setLength(D);
    this.airborne = D > floor + 0.5;
    // buildings and walls stop you
    if (ctx.collide) {
      const pre = this.pos.clone();
      ctx.collide(this.pos, d.radius);
      const push = pre.distanceTo(this.pos);
      if (push > 0.05) {
        this.crash = Math.abs(this.speed);
        this.speed *= push > 0.4 ? 0.3 : 0.75;
      }
    }
    this.moved = before.distanceTo(this.pos);
    this.sync();
  }

  sync() {
    const up = this.pos.clone().normalize();
    const f = this.fwd.clone().projectOnPlane(up).normalize();
    const right = new THREE.Vector3().crossVectors(f, up).normalize();
    const m = new THREE.Matrix4().makeBasis(right, up, f.clone().negate());
    const g = this.model.group;
    g.position.copy(this.pos);
    g.quaternion.setFromRotationMatrix(m);
    g.rotateZ(this.lean);
    g.rotateX(THREE.MathUtils.clamp(this.vUp * 0.02, -0.3, 0.3));
    const pulse = 0.85 + 0.15 * Math.sin(this.time * 18);
    for (const p of this.model.pads) p.scale.set(pulse, 1, pulse);
  }

  seat() {
    return this.pos.clone().addScaledVector(this.pos.clone().normalize(), this.def.seat - this.def.hover);
  }

  dispose() {
    this.root.remove(this.model.group);
    this.model.dispose();
  }
}
