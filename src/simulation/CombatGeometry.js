import * as THREE from 'three';

// Dedicated double-sided ray meshes reuse the rendered world's exact triangles.
// They never enter the scene and do not change the world's visible materials.
export class CombatGeometry {
  constructor(map) {
    this.meshes = [];
    this.material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    map.updateMatrixWorld(true);
    map.traverse(object => {
      if (!object.isMesh) return;
      const mesh = new THREE.Mesh(object.geometry, this.material);
      mesh.matrixAutoUpdate = false;
      mesh.matrixWorld.copy(object.matrixWorld);
      this.meshes.push(mesh);
    });
    this.raycaster = new THREE.Raycaster();
  }
  hit(origin, direction, distance) {
    this.raycaster.set(origin, direction);
    this.raycaster.near = 0;
    this.raycaster.far = distance;
    return this.raycaster.intersectObjects(this.meshes, false)[0] || null;
  }
  clear(origin, point) {
    const direction = point.clone().sub(origin);
    const length = direction.length();
    return length > 1e-7 && !this.hit(origin, direction.normalize(), length);
  }
}

export function aimAngles(robot, direction) {
  const local = direction.clone().applyQuaternion(robot.getWorldQuaternion(new THREE.Quaternion()).invert());
  return { yaw: Math.atan2(local.x, local.z), pitch: Math.atan2(local.y, Math.hypot(local.x, local.z)) };
}

export function withinAim(angles, config) {
  return Math.abs(angles.yaw) <= config.yawLimit + 1e-7
    && angles.pitch >= config.pitchDown && angles.pitch <= config.pitchUp;
}

function sphereHit(origin, direction, center, radius) {
  const oc = origin.clone().sub(center);
  const b = oc.dot(direction), c = oc.lengthSq() - radius * radius;
  if (c <= 0) return 0;
  const h = b * b - c;
  if (h < 0) return Infinity;
  const t = -b - Math.sqrt(h);
  return t >= 0 ? t : Infinity;
}

// Exact ray versus capsule, including start-inside and the two spherical caps.
// Every projectile tests the entire frame segment, then takes the nearest hit.
export function capsuleHit(origin, direction, a, b, radius) {
  const ba = b.clone().sub(a), oa = origin.clone().sub(a);
  const baba = ba.lengthSq();
  if (baba < 1e-9) return sphereHit(origin, direction, a, radius);
  const closest = a.clone().addScaledVector(ba, THREE.MathUtils.clamp(oa.dot(ba) / baba, 0, 1));
  if (origin.distanceToSquared(closest) <= radius * radius) return 0;
  const bard = ba.dot(direction), baoa = ba.dot(oa);
  const aa = baba - bard * bard;
  const bb = baba * oa.dot(direction) - baoa * bard;
  const cc = baba * oa.lengthSq() - baoa * baoa - radius * radius * baba;
  let result = Math.min(sphereHit(origin, direction, a, radius), sphereHit(origin, direction, b, radius));
  const h = bb * bb - aa * cc;
  if (Math.abs(aa) > 1e-9 && h >= 0) {
    const t = (-bb - Math.sqrt(h)) / aa;
    const y = baoa + t * bard;
    if (t >= 0 && y > 0 && y < baba) result = Math.min(result, t);
  }
  return result;
}
