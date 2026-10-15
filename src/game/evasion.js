import * as THREE from 'three';

export const DODGE = { cost: 18, cooldown: 1.2, duration: 0.22, protection: 0.18 };

// A short burst along the ground. Position still goes through normal collision.
export function beginDodge(rt, player, move, up, walk) {
  if (rt.dodgeCd > 0 || rt.energy < DODGE.cost || !up || !player.grounded || player.mode !== 'ground') return false;
  const forward = player.forward().projectOnPlane(up).normalize();
  if (forward.lengthSq() < 0.001) forward.copy(player.localUp()).projectOnPlane(up).normalize();
  const right = new THREE.Vector3().crossVectors(forward, up).normalize();
  const direction = forward.multiplyScalar(move.z).addScaledVector(right, move.x);
  if (direction.lengthSq() < 0.001) direction.copy(player.forward()).projectOnPlane(up).negate();
  if (direction.lengthSq() < 0.001) direction.copy(right).negate();
  rt.dodgeDir = direction.normalize();
  rt.dodgeSpeed = Math.max(24, walk * 3);
  rt.dodgeT = DODGE.duration;
  rt.dodgeCd = DODGE.cooldown;
  rt.invuln = Math.max(rt.invuln, DODGE.protection);
  rt.energy -= DODGE.cost;
  rt.medToggle = rt.meditating = false;
  rt.medBlock = Math.max(rt.medBlock, DODGE.duration);
  return true;
}
