import * as THREE from 'three';

// A 1.78 m person built from simple shapes: a shaped torso, jointed arms and
// legs (shoulder, elbow, hip, knee), hands, boots, a face and hair, dressed in
// a jacket and trousers. The figure's origin is the hip joint, 0.92 m above the
// soles, facing -z. Joints are groups so poses only set rotations.
export const HIP_HEIGHT = 0.92;

const lathe = (pts, segs = 14) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), segs);
// a tapered limb segment hanging down from its joint
const segment = (r0, r1, len, segs = 10) => new THREE.CylinderGeometry(r0, r1, len, segs, 1).translate(0, -len / 2, 0);
const ball = (r, segs = 10) => new THREE.SphereGeometry(r, segs, Math.max(6, segs - 2));

export function buildHumanoid(opts = {}) {
  const mat = {
    skin: new THREE.MeshStandardMaterial({ color: opts.skin ?? 0xd9a882, roughness: 0.62 }),
    hair: new THREE.MeshStandardMaterial({ color: opts.hair ?? 0x1c1714, roughness: 0.75 }),
    jacket: new THREE.MeshStandardMaterial({ color: opts.jacket ?? 0x232a3d, roughness: 0.55, metalness: 0.25 }),
    shirt: new THREE.MeshStandardMaterial({ color: opts.shirt ?? 0x3a4256, roughness: 0.7 }),
    pants: new THREE.MeshStandardMaterial({ color: opts.pants ?? 0x2b2d33, roughness: 0.8 }),
    boots: new THREE.MeshStandardMaterial({ color: 0x15151a, roughness: 0.5, metalness: 0.2 }),
    eye: new THREE.MeshStandardMaterial({ color: 0x1a1410, roughness: 0.25 }),
    accent: opts.accent || new THREE.MeshBasicMaterial({ color: 0xffffff }),
  };
  const figure = new THREE.Group();
  const add = (parent, geo, m, x = 0, y = 0, z = 0) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  };

  // ---- torso: hips, waist, chest and shoulders in one turned profile, flattened front to back
  const torso = add(figure, lathe([[0.001, -0.06], [0.15, -0.05], [0.165, 0.04], [0.148, 0.14], [0.142, 0.22], [0.162, 0.32], [0.19, 0.42], [0.18, 0.47], [0.12, 0.52], [0.06, 0.545], [0.001, 0.55]]), mat.jacket);
  torso.scale.z = 0.62;
  // trousers over the hips, a belt, an open collar with the shirt showing
  add(figure, lathe([[0.001, -0.08], [0.158, -0.07], [0.17, 0.03], [0.155, 0.08], [0.001, 0.08]]), mat.pants).scale.z = 0.66;
  add(figure, new THREE.TorusGeometry(0.152, 0.014, 6, 24).rotateX(Math.PI / 2).scale(1, 1, 0.66), mat.accent, 0, 0.085, 0);
  add(figure, new THREE.BoxGeometry(0.07, 0.2, 0.02), mat.shirt, 0, 0.42, -0.108).rotation.x = 0.12;
  // jacket seam and trim
  add(figure, new THREE.BoxGeometry(0.008, 0.36, 0.008), mat.accent, 0.03, 0.2, -0.1);
  add(figure, new THREE.BoxGeometry(0.3, 0.012, 0.012), mat.accent, 0, 0.47, -0.08);

  // ---- neck and head
  add(figure, segment(0.048, 0.055, 0.12).translate(0, 0.12, 0), mat.skin, 0, 0.52, 0);
  const head = new THREE.Group();
  head.position.set(0, 0.7, 0);
  figure.add(head);
  buildHead(head, mat, add);

  // ---- arms: shoulder joint, upper arm, elbow joint, forearm, hand
  const mkArm = (side) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(0.2 * side, 0.46, 0);
    figure.add(shoulder);
    add(shoulder, ball(0.062), mat.jacket);
    add(shoulder, segment(0.056, 0.046, 0.3), mat.jacket);
    const elbow = new THREE.Group();
    elbow.position.y = -0.3;
    shoulder.add(elbow);
    add(elbow, ball(0.046), mat.jacket);
    add(elbow, segment(0.045, 0.036, 0.25), mat.jacket);
    add(elbow, new THREE.TorusGeometry(0.038, 0.009, 6, 14).rotateX(Math.PI / 2), mat.accent, 0, -0.24, 0);
    const hand = new THREE.Group();
    hand.position.y = -0.26;
    elbow.add(hand);
    add(hand, new THREE.CapsuleGeometry(0.03, 0.06, 4, 8).scale(0.85, 1, 0.55), mat.skin, 0, -0.05, 0);
    add(hand, new THREE.CapsuleGeometry(0.012, 0.035, 3, 6), mat.skin, -0.028 * side, -0.035, -0.012).rotation.z = 0.5 * side;
    return { shoulder, elbow, hand };
  };
  // ---- legs: hip joint, thigh, knee joint, shin, ankle with a boot
  const mkLeg = (side) => {
    const hip = new THREE.Group();
    hip.position.set(0.095 * side, 0, 0);
    figure.add(hip);
    add(hip, segment(0.082, 0.058, 0.45), mat.pants);
    const knee = new THREE.Group();
    knee.position.y = -0.45;
    hip.add(knee);
    add(knee, ball(0.058), mat.pants);
    add(knee, segment(0.056, 0.042, 0.3), mat.pants);
    add(knee, segment(0.05, 0.047, 0.12).translate(0, -0.3, 0), mat.boots);
    const ankle = new THREE.Group();
    ankle.position.y = -0.42;
    knee.add(ankle);
    add(ankle, new THREE.BoxGeometry(0.1, 0.07, 0.27), mat.boots, 0, -0.015, -0.06);
    return { hip, knee, ankle };
  };
  const armL = mkArm(-1), armR = mkArm(1), legL = mkLeg(-1), legR = mkLeg(1);
  return { figure, head, mat, armL, armR, legL, legR };
}

// Face, ears and hair on a head group centred between the ears.
function buildHead(head, mat, add) {
  const skull = add(head, ball(0.105, 18), mat.skin);
  skull.scale.set(0.95, 1.12, 1.02);
  // jaw and chin
  const jaw = add(head, ball(0.08, 14), mat.skin, 0, -0.06, -0.022);
  jaw.scale.set(0.92, 0.8, 0.95);
  // eyes, brows, nose, mouth, ears
  for (const s of [-1, 1]) {
    add(head, ball(0.012, 8), mat.eye, 0.036 * s, 0.012, -0.098);
    add(head, new THREE.BoxGeometry(0.034, 0.007, 0.01), mat.hair, 0.037 * s, 0.035, -0.1).rotation.z = -0.12 * s;
    add(head, ball(0.022, 8), mat.skin, 0.1 * s, 0.0, 0.006).scale.set(0.4, 1, 0.7);
  }
  add(head, new THREE.ConeGeometry(0.016, 0.04, 6).rotateX(-Math.PI / 2 + 0.25), mat.skin, 0, -0.012, -0.112);
  add(head, new THREE.BoxGeometry(0.03, 0.005, 0.006), mat.eye, 0, -0.058, -0.094);
  // hair: a cap over the crown and back, a short fringe at the front
  const cap = add(head, new THREE.SphereGeometry(0.112, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.52), mat.hair, 0, 0.012, 0.006);
  cap.scale.set(0.98, 1.14, 1.06);
  cap.rotation.x = -0.18;
  const back = add(head, ball(0.1, 14), mat.hair, 0, -0.005, 0.03);
  back.scale.set(0.97, 0.95, 0.85);
  const fringe = add(head, new THREE.BoxGeometry(0.17, 0.03, 0.04), mat.hair, 0, 0.075, -0.088);
  fringe.rotation.x = 0.35;
}
