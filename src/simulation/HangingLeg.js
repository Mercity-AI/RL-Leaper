import * as THREE from 'three';
import { FEMUR_LENGTH, SHIN_LENGTH } from '../config/robot.js';

const UP = new THREE.Vector3(0, 1, 0);
const DROOP = THREE.MathUtils.degToRad(15);
const MAX_DROOP = THREE.MathUtils.degToRad(22);
// The stump curls up like an injured spider's leg instead of sticking out stiffly:
// the thigh lifts this far above horizontal and the shin folds back down toward
// the body. (The leg is too long to hang straight down without hitting the floor.)
const CURL_THIGH = THREE.MathUtils.degToRad(35);
const CURL_SHIN_IN = 0.5; // how far the folded shin points back toward the body
const CURL_TIME = 0.35; // seconds to curl up after the break

// A restrained hip hinge with a small gravity sag, around the curled pose.
export class HangingLeg {
  constructor(rig, leg) {
    this.rig = rig;
    this.leg = leg;
    rig.robot.updateMatrixWorld(true);
    const previous = leg.hanging;
    this.anchorLocal = rig.robot.worldToLocal(leg.coxa.position.clone());
    this.hipLocal = rig.robot.worldToLocal(leg.femur.position.clone());
    const remaining = [[leg.femur, FEMUR_LENGTH], [leg.tibia, SHIN_LENGTH]].filter(([mesh]) => !mesh.userData.detached);
    this.meshes = remaining.map(([mesh]) => mesh);
    this.lengths = remaining.map(([, length]) => length);
    const inverse = rig.robot.getWorldQuaternion(new THREE.Quaternion()).invert();
    // Start from the pose at the moment of the break (or the earlier stump's)...
    this.startDirections = this.meshes.map((mesh, i) => previous?.restDirections[i]?.clone()
      ?? UP.clone().applyQuaternion(mesh.quaternion).applyQuaternion(inverse));
    // ...and curl toward the injured pose, in the body's own frame.
    const out = new THREE.Vector3(leg.out.x, 0, leg.out.z).normalize();
    const curled = [
      out.clone().multiplyScalar(Math.cos(CURL_THIGH)).addScaledVector(UP, Math.sin(CURL_THIGH)),
      out.clone().multiplyScalar(-CURL_SHIN_IN).addScaledVector(UP, -1).normalize(),
    ];
    this.curledDirections = this.meshes.map(mesh => curled[mesh === leg.femur ? 0 : 1]);
    this.curl = previous ? Math.min(previous.curl, 0.5) : 0;
    this.restDirections = this.startDirections.map(direction => direction.clone());
    this.axis = this.curledDirections[0]?.clone().cross(new THREE.Vector3(0, -1, 0)).normalize() ?? new THREE.Vector3(1, 0, 0);
    if (this.axis.lengthSq() < 1e-8) this.axis.set(1, 0, 0);
    this.angle = previous?.angle ?? 0;
    this.angularVelocity = previous?.angularVelocity ?? 0;
    this.previousHip = leg.femur.position.clone();
    this.previousVelocity = new THREE.Vector3();
    this.acceleration = new THREE.Vector3();
    this.points = [leg.femur.position.clone(), ...this.meshes.map(() => new THREE.Vector3())];
    this.update(0);
  }

  update(dt) {
    const hip = this.rig.robot.localToWorld(this.hipLocal.clone());
    const anchor = this.rig.robot.localToWorld(this.anchorLocal.clone());
    const rotation = this.rig.robot.getWorldQuaternion(new THREE.Quaternion());
    const elapsed = Math.min(Math.max(dt, 0), 0.1);
    this.curl = Math.min(1, this.curl + elapsed / CURL_TIME);
    const curl = THREE.MathUtils.smootherstep(this.curl, 0, 1);
    this.restDirections.forEach((direction, i) =>
      direction.copy(this.startDirections[i]).lerp(this.curledDirections[i], curl).normalize());
    if (elapsed > 0 && this.meshes.length) {
      const velocity = hip.clone().sub(this.previousHip).divideScalar(elapsed);
      const acceleration = velocity.clone().sub(this.previousVelocity).divideScalar(elapsed).clampLength(0, 25);
      this.acceleration.lerp(acceleration, 1 - Math.exp(-8 * elapsed));
      const tangent = this.axis.clone().cross(this.restDirections[0]).applyQuaternion(rotation);
      const drive = THREE.MathUtils.clamp(-this.acceleration.dot(tangent) * 0.06, -1.5, 1.5);
      const count = Math.max(1, Math.ceil(elapsed * 120)), step = elapsed / count;
      for (let i = 0; i < count; i++) {
        this.angularVelocity += (50 * (DROOP - this.angle) - 12 * this.angularVelocity + drive) * step;
        this.angle += this.angularVelocity * step;
        const bounded = THREE.MathUtils.clamp(this.angle, 0, MAX_DROOP);
        if (bounded !== this.angle) this.angularVelocity = 0;
        this.angle = bounded;
      }
      this.previousVelocity.copy(velocity);
    }
    this.previousHip.copy(hip);
    this.points[0].copy(hip);
    const sag = new THREE.Quaternion().setFromAxisAngle(this.axis, this.angle);
    this.meshes.forEach((mesh, i) => {
      const direction = this.restDirections[i].clone().applyQuaternion(sag).applyQuaternion(rotation);
      this.points[i + 1].copy(this.points[i]).addScaledVector(direction, this.lengths[i]);
      this.place(mesh, this.points[i], this.points[i + 1]);
    });
    this.place(this.leg.coxa, anchor, hip);
    if (this.points[1]) this.leg.knee.position.copy(this.points[1]);
    if (this.points[2]) this.leg.calfJoint.position.copy(this.points[2]);
  }

  place(mesh, from, to) {
    mesh.position.copy(from);
    mesh.quaternion.setFromUnitVectors(UP, to.clone().sub(from).normalize());
  }
}
