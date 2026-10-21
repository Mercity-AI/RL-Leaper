import * as THREE from 'three';
import { HangingLeg } from './HangingLeg.js';
import { COMBAT } from '../config/tuning/index.js';

const PARTS = ['coxa', 'femur', 'tibia', 'calf', 'knee', 'calfJoint'];
const BELOW = { upper: ['knee', 'tibia', 'calfJoint', 'calf'], lower: ['calfJoint', 'calf'],
  coxa: PARTS, femur: ['femur', 'knee', 'tibia', 'calfJoint', 'calf'],
  tibia: ['tibia', 'calfJoint', 'calf'], calf: ['calf'] };
const ROOT = { upper: 'knee', lower: 'calfJoint', coxa: 'coxa', femur: 'femur', tibia: 'tibia', calf: 'calf' };
// Bullets (of either gun) a piece takes before it snaps off, as an inclusive
// [min, max] range picked per piece each encounter. Knees are the smart target;
// the long leg pieces (shafts) take about 3x as many. Raised about 30% on
// 2026-10-19 (owner: legs came off too easily), from knee [8, 10], shaft [24, 26].
export const LEG_HITS = Object.freeze({ knee: [11, 13], shaft: [32, 34] });
const DOWN = new THREE.Vector3(0, -1, 0);
const UP = new THREE.Vector3(0, 1, 0);

function contactBounds(object) {
  object.updateMatrixWorld(true);
  const bounds = new THREE.Box3(), point = new THREE.Vector3();
  object.traverse(mesh => {
    const positions = mesh.geometry?.attributes.position;
    if (!positions) return;
    for (let i = 0; i < positions.count; i++) {
      bounds.expandByPoint(point.fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld));
    }
  });
  return bounds;
}

// The side (+1 = right, -1 = left: the sign of the legs' local x) with no
// standing leg left, so nothing holds it up; 0 while both sides stand.
export function unsupportedSide(rig) {
  for (const side of [1, -1]) {
    if (!rig.legs.some((leg) => Math.sign(leg.out.x) === side && !leg.disabled)) return side;
  }
  return 0;
}

// Joint damage is counted per direct bullet, independently of body health.
// rules: COMBAT.legs (how much each lost leg slows the Leaper).
// onBroken({ leg, joint, position, lost }): a joint just snapped (the Leaper's
// behaviour reacts with a stagger or a fall, the presentation with a burst).
export class LeaperLegDamage {
  constructor(scene, rig, geometry, random = Math.random, rules = COMBAT.legs) {
    Object.assign(this, { scene, rig, geometry, random, rules });
    this.debris = [];
    for (const leg of rig.legs) {
      for (const [joint, key] of Object.entries(ROOT)) {
        leg[key].traverse(o => { o.userData.leaperJoint = { index: leg.index, joint }; });
      }
    }
    this.reset();
  }

  reset() {
    for (const item of this.debris) {
      this.scene.remove(item.mesh);
      // Debris owns its materials, but shares the original geometry.
      item.mesh.traverse(o => { if (o.isMesh) o.material.dispose(); });
    }
    this.debris.length = 0;
    for (const leg of this.rig.legs) {
      const hits = ([min, max]) => min + Math.floor(this.random() * (max - min + 1));
      leg.damage = {
        upper: { hits: 0, threshold: hits(LEG_HITS.knee), broken: false },
        lower: { hits: 0, threshold: hits(LEG_HITS.knee), broken: false },
      };
      for (const key of ['coxa', 'femur', 'tibia', 'calf']) {
        leg.damage[key] = { hits: 0, threshold: hits(LEG_HITS.shaft), broken: false };
      }
      leg.disabled = false;
      leg.stump = false;
      leg.hanging = null;
      for (const key of PARTS) { leg[key].visible = true; leg[key].userData.detached = false; }
    }
    this.rig.damagedLegCount = 0;
    this.rig.stumpLegCount = 0;
    this.rig.mobility = 1;
  }

  hit(object, direction = new THREE.Vector3()) {
    // Today's gun reports every bullet here before it does the damage: a bullet
    // on the eye's core is remembered for that damage (a weak-point crit, see
    // takeWeakPointHit). It is not a joint.
    if (object.userData.weakPoint) this.weakPointHit = true;
    const tag = object.userData.leaperJoint;
    if (!tag) return false;
    const leg = this.rig.legs[tag.index];
    const joint = leg.damage[tag.joint];
    if (joint.broken) return false;
    joint.hits++;
    if (joint.hits < joint.threshold) return false;
    this.detach(leg, tag.joint, direction);
    return true;
  }

  // Was the bullet just reported a hit on the eye's weak point? Asked once per
  // damage (LeaperCombat.damageLeaper), then forgotten.
  takeWeakPointHit() {
    const hit = Boolean(this.weakPointHit);
    this.weakPointHit = false;
    return hit;
  }

  detach(leg, joint, direction) {
    this.scene.updateMatrixWorld(true);
    const group = new THREE.Group();
    const pivot = leg[ROOT[joint]].getWorldPosition(new THREE.Vector3());
    group.position.copy(pivot);
    for (const key of BELOW[joint]) {
      const original = leg[key];
      if (original.userData.detached) continue;
      const copy = original.clone(true);
      original.matrixWorld.decompose(copy.position, copy.quaternion, copy.scale);
      copy.position.sub(pivot);
      copy.traverse(o => {
        o.userData = {};
        if (o.isMesh) {
          // A piece cut off during a hit flash keeps the hull's resting glow, not the
          // flash. The resting glow is read from the shared hull material before it
          // is cloned: a clone's userData is a JSON copy (the colour becomes a plain
          // number, 0 for the black hull), so it cannot be read back from the copy.
          const resting = o.material.userData?.hitFlashBase;
          o.material = o.material.clone();
          delete o.material.userData.hitFlashBase;
          if (resting?.isColor) o.material.emissive.copy(resting);
        }
      });
      group.add(copy);
      original.visible = false;
      original.userData.detached = true;
    }
    this.scene.add(group);
    group.updateMatrixWorld(true);
    // The surviving segment axes define the flat side of this fragment.
    const axes = group.children.filter(copy => copy.isGroup)
      .map(copy => UP.clone().applyQuaternion(copy.quaternion));
    const axis = axes[0] || UP.clone();
    const restNormal = axes.length > 1 ? axes[0].clone().cross(axes[1]) : new THREE.Vector3();
    if (restNormal.lengthSq() < 1e-6) {
      restNormal.copy(UP).addScaledVector(axis, -UP.dot(axis));
      if (restNormal.lengthSq() < 1e-6) restNormal.set(1, 0, 0).cross(axis);
    }
    restNormal.normalize();
    this.debris.push({ mesh: group, restNormal, grounded: false, velocity: direction.clone().multiplyScalar(1.2).add(new THREE.Vector3(leg.out.x * 0.6, 2.8, leg.out.z * 0.6)),
      spin: new THREE.Vector3(3, 1, -3), age: 0, settled: false });
    leg.damage[joint].broken = true;
    for (const [name, key] of Object.entries(ROOT)) {
      if (leg[key].userData.detached) leg.damage[name].broken = true;
    }
    // Cut below the lower knee, the thigh and shin still reach the floor: with
    // rules.walkOnStump the leg walks on as a stump. Otherwise (and cut any
    // higher) it curls up and hangs.
    const stands = Boolean(this.rules.walkOnStump)
      && !['femur', 'knee', 'tibia'].some((key) => leg[key].userData.detached);
    if (stands) {
      leg.stump = true;
    } else {
      leg.stump = false;
      leg.disabled = true;
      leg.hanging = new HangingLeg(this.rig, leg);
      // The other legs carry on: a foot in mid-step finishes its step instead of
      // snapping to the floor (review fix 5.19). Only the broken leg stops stepping.
      leg.stepping = false;
    }
    // Fewer legs, slower brain steps (the limp), down to the configured floor.
    const lost = this.rig.legs.filter(l => l.disabled).length;
    const stumps = this.rig.legs.filter(l => l.stump).length;
    this.rig.damagedLegCount = lost;
    this.rig.stumpLegCount = stumps;
    this.rig.mobility = Math.max(this.rules.minMobility,
      1 - (lost + stumps * this.rules.stumpCost) * this.rules.mobilityPerLeg);
    this.onBroken?.({ leg, joint, position: pivot.clone(), lost, stump: stands, unsupportedSide: unsupportedSide(this.rig) });
  }

  update(dt) {
    for (const leg of this.rig.legs) leg.hanging?.update(dt);
    // Substeps keep falling fragments stable at low frame rates. Settled pieces persist until reset.
    let remaining = Math.min(dt, 0.15);
    while (remaining > 0) {
      const step = Math.min(remaining, 1 / 60); remaining -= step;
      for (const item of this.debris) {
        if (item.settled) continue;
        item.age += step;
        const before = contactBounds(item.mesh);
        item.velocity.y -= 20 * step;
        item.mesh.position.addScaledVector(item.velocity, step);
        if (item.grounded) {
          // Contact must topple the long section onto its side, not freeze it on a tip.
          const normal = item.restNormal.clone().applyQuaternion(item.mesh.quaternion);
          if (normal.y < 0) normal.negate();
          const correction = new THREE.Quaternion().setFromUnitVectors(normal, UP);
          const resting = correction.multiply(item.mesh.quaternion.clone());
          item.mesh.quaternion.slerp(resting, 1 - Math.exp(-7 * step));
        } else {
          item.mesh.rotation.x += item.spin.x * step;
          item.mesh.rotation.y += item.spin.y * step;
          item.mesh.rotation.z += item.spin.z * step;
        }
        const box = contactBounds(item.mesh);
        const center = box.getCenter(new THREE.Vector3());
        // Sweep the fragment's bottom onto the map or the base floor.
        const origin = new THREE.Vector3(center.x, Math.max(before.min.y, box.min.y) + 0.1, center.z);
        const surface = this.geometry?.hit(origin, DOWN, Math.max(2, origin.y - box.min.y + 1));
        const floor = surface?.point.y ?? 0;
        if (box.min.y <= floor + 0.002 || item.grounded) {
          if (!item.grounded) this.onLanded?.(item);
          item.grounded = true;
          item.mesh.position.y += floor + 0.002 - box.min.y;
          if (item.velocity.y < 0) {
            item.velocity.y *= -0.22;
            item.velocity.x *= 0.7; item.velocity.z *= 0.7;
            item.spin.multiplyScalar(0.72);
            const flatness = Math.abs(item.restNormal.clone().applyQuaternion(item.mesh.quaternion).dot(UP));
            if (flatness > 0.9999 && item.spin.length() < 0.15 && item.velocity.length() < 0.3) {
              item.velocity.set(0, 0, 0); item.spin.set(0, 0, 0);
              item.settled = true;
            }
          }
        }
      }
    }
  }
}
