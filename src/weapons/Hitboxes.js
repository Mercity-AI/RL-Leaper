import * as THREE from 'three';
import { HIT_ZONES, LEAPER_HITBOXES } from '../config/weapons.js';

// Hit volumes: plain spheres and capsules that ride on a character's rig pieces,
// each tagged with a damage zone and multiplier. Bullets test these instead of
// the visible meshes, the standard shooter setup: the art can change without
// breaking the weak point or joint damage, and a hit area can be made more
// forgiving without touching the art (finding aim-weapons-hitboxes-are-render-meshes).

// ---- Ray tests ----
// Each returns the distance along the (normalised) ray to the first touch within
// `far`, 0 when the ray starts inside, or Infinity for a miss.

export function raySphere(origin, direction, center, radius, far = Infinity) {
  const ox = origin.x - center.x, oy = origin.y - center.y, oz = origin.z - center.z;
  const c = ox * ox + oy * oy + oz * oz - radius * radius;
  if (c <= 0) return 0;
  const b = ox * direction.x + oy * direction.y + oz * direction.z;
  const h = b * b - c;
  if (h < 0 || b > 0) return Infinity;
  const t = -b - Math.sqrt(h);
  return t >= 0 && t <= far ? t : Infinity;
}

const scratch = { ba: new THREE.Vector3(), oa: new THREE.Vector3(), closest: new THREE.Vector3() };

export function rayCapsule(origin, direction, a, b, radius, far = Infinity) {
  const ba = scratch.ba.subVectors(b, a), oa = scratch.oa.subVectors(origin, a);
  const baba = ba.lengthSq();
  if (baba < 1e-12) return raySphere(origin, direction, a, radius, far);
  // Starting inside the capsule counts as an immediate hit.
  const along = THREE.MathUtils.clamp(oa.dot(ba) / baba, 0, 1);
  if (origin.distanceToSquared(scratch.closest.copy(a).addScaledVector(ba, along)) <= radius * radius) return 0;
  // The round body of the capsule, then its two end caps.
  let best = Infinity;
  const bard = ba.dot(direction), baoa = ba.dot(oa);
  const k2 = baba - bard * bard;
  const k1 = baba * oa.dot(direction) - baoa * bard;
  const k0 = baba * oa.lengthSq() - baoa * baoa - radius * radius * baba;
  const h = k1 * k1 - k2 * k0;
  if (Math.abs(k2) > 1e-12 && h >= 0) {
    const t = (-k1 - Math.sqrt(h)) / k2;
    const y = baoa + t * bard;
    if (t >= 0 && y > 0 && y < baba) best = t;
  }
  best = Math.min(best, raySphere(origin, direction, a, radius), raySphere(origin, direction, b, radius));
  return best <= far ? best : Infinity;
}

// ---- A set of volumes on one character ----

export class Hitboxes {
  // volumes: [{ object, shape: 'sphere' | 'capsule', a, b, radius, zone, multiplier, joint }]
  //   object  the rig piece the volume rides on (its position and turn, not its size)
  //   a / b   local offsets (THREE.Vector3): the sphere centre, or the capsule's two ends
  constructor(volumes) {
    this.volumes = volumes.map(volume => ({
      ...volume,
      // World-space copies, refreshed by update().
      worldA: new THREE.Vector3(),
      worldB: new THREE.Vector3(),
    }));
    this.objects = [...new Set(this.volumes.map(volume => volume.object))];
    this.pose = new Map(this.objects.map(object => [object, {
      position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), scale: new THREE.Vector3(),
    }]));
  }

  // A volume is live while its rig piece is still attached (a shot-off leg piece
  // stops being hittable, as its debris is only scenery).
  static enabled(volume) {
    return !volume.object.userData?.detached;
  }

  // Move every volume to where its rig piece is now. Call after the rig's
  // matrices are current (each piece's matrixWorld).
  update() {
    for (const [object, pose] of this.pose) object.matrixWorld.decompose(pose.position, pose.quaternion, pose.scale);
    for (const volume of this.volumes) {
      const pose = this.pose.get(volume.object);
      volume.worldA.copy(volume.a).applyQuaternion(pose.quaternion).add(pose.position);
      if (volume.shape === 'capsule') volume.worldB.copy(volume.b).applyQuaternion(pose.quaternion).add(pose.position);
    }
  }

  // Nearest live volume along a ray within `far`:
  // { distance, point, normal, volume, zone, multiplier } or null.
  raycast(origin, direction, far = Infinity) {
    let best = null, bestDistance = far;
    for (const volume of this.volumes) {
      if (!Hitboxes.enabled(volume)) continue;
      const distance = volume.shape === 'capsule'
        ? rayCapsule(origin, direction, volume.worldA, volume.worldB, volume.radius, bestDistance)
        : raySphere(origin, direction, volume.worldA, volume.radius, bestDistance);
      if (distance <= bestDistance && distance < Infinity && (!best || distance < bestDistance)) {
        best = volume;
        bestDistance = distance;
      }
    }
    if (!best) return null;
    const point = origin.clone().addScaledVector(direction, bestDistance);
    return { distance: bestDistance, point, normal: this.normalAt(best, point, direction),
      volume: best, zone: best.zone, multiplier: best.multiplier };
  }

  // Outward surface direction at a hit point (sparks fly off along it).
  normalAt(volume, point, direction) {
    let center = volume.worldA;
    if (volume.shape === 'capsule') {
      const ba = new THREE.Vector3().subVectors(volume.worldB, volume.worldA);
      const along = THREE.MathUtils.clamp(new THREE.Vector3().subVectors(point, volume.worldA).dot(ba) / Math.max(ba.lengthSq(), 1e-12), 0, 1);
      center = volume.worldA.clone().addScaledVector(ba, along);
    }
    const normal = point.clone().sub(center);
    // A ray that started inside: push the sparks back toward the shooter.
    return normal.lengthSq() > 1e-12 ? normal.normalize() : direction.clone().negate();
  }
}

// ---- The Leaper's volumes ----

const toVector = values => new THREE.Vector3(...values);

// An offset given in a hip's own frame (+Z out along the leg) turned into the
// body's frame for the leg that points along `out` (the rig's unit vector).
const alongLeg = (values, out) => new THREE.Vector3(
  values[0] * out.z + values[2] * out.x, values[1], values[2] * out.z - values[0] * out.x);

// Build the hit volumes of a hexapod rig (createHexapod) from a layout
// (LEAPER_HITBOXES): the body (with a fin over each hip), the eye's housing and
// red core, and every leg's pieces. Each leg volume's `object` is that leg's
// piece, which also carries the leg-damage tag LeaperLegDamage counts hits on.
export function createLeaperHitboxes(rig, layout = LEAPER_HITBOXES, zones = HIT_ZONES) {
  const volumes = [];
  // 1. One volume on a rig piece; `turn` maps the layout's offsets into the piece's frame.
  const add = (object, entry, leg = null, turn = toVector) => {
    const zone = zones[entry.zone];
    if (!zone) throw new Error(`Unknown hit zone: ${entry.zone}`);
    volumes.push({
      object, shape: entry.shape, radius: entry.radius, zone: entry.zone, multiplier: zone.multiplier,
      joint: entry.joint ?? null, leg,
      a: turn(entry.shape === 'capsule' ? entry.from : entry.at),
      b: turn(entry.shape === 'capsule' ? entry.to : entry.at),
    });
  };
  // 2. Leg pieces ride on each leg; hip parts repeat around the body (they stay
  //    on the body, so they belong to no leg); the rest sits on the body or eye.
  for (const entry of layout) {
    if (entry.leg) {
      for (const leg of rig.legs) add(leg[entry.leg], entry, leg.index);
    } else if (entry.atEachHip) {
      for (const leg of rig.legs) add(rig.robot, entry, null, values => alongLeg(values, leg.out));
    } else {
      add(entry.part === 'eye' ? rig.eyePivot : rig.robot, entry);
    }
  }
  return new Hitboxes(volumes);
}
