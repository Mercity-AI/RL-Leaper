import * as THREE from 'three';
import {
  BODY_COLLISION_RADIUS,
  CALF_LENGTH,
  COXA_LENGTH,
  FEMUR_LENGTH,
  FOOT_HEIGHT,
  HOME_RADIUS,
  LOWER_REACH,
  MOVEMENT,
  ROBOT_SCALE,
  SHIN_LENGTH,
  STANDING_HEIGHT,
  STEP_DISTANCE,
} from '../config/robot.js';

const UP = new THREE.Vector3(0, 1, 0);

function turnToward(current, target, maximumStep) {
  const difference = (
    (target - current + Math.PI) % (Math.PI * 2) + Math.PI * 2
  ) % (Math.PI * 2) - Math.PI;
  return current + THREE.MathUtils.clamp(difference, -maximumStep, maximumStep);
}

export class LeaperSimulation {
  constructor({ rig, world, target, input, cameraController, sun, statusElement }) {
    this.rig = rig;
    this.world = world;
    this.target = target;
    this.input = input;
    this.cameraController = cameraController;
    this.sun = sun;
    this.statusElement = statusElement;
    this.elapsed = 0;
    this.state = {
      position: new THREE.Vector3(),
      velocity: new THREE.Vector3(),
      previousVelocity: new THREE.Vector3(),
      yaw: 0,
      pitchTilt: 0,
      rollTilt: 0,
      jumpHeight: 0,
      verticalVelocity: 0,
      grounded: true,
      crouch: 0,
      gaitPhase: 0,
      alert: 0,
    };
    this.v = Array.from({ length: 10 }, () => new THREE.Vector3());
  }

  update(deltaTime) {
    this.elapsed += deltaTime;
    this.input.update(deltaTime);
    const movement = this.input.getMovement();
    const sprinting = this.input.sprinting;
    const state = this.state;
    const heading = this.cameraController.getMovementHeading(state.yaw);
    const forward = this.v[0].set(Math.sin(heading), 0, Math.cos(heading));
    const right = this.v[1].set(-forward.z, 0, forward.x);
    const move = this.v[2]
      .set(0, 0, 0)
      .addScaledVector(forward, movement.forward)
      .addScaledVector(right, movement.side);
    if (move.lengthSq() > 1) move.normalize();
    const hasInput = move.lengthSq() > 1e-4;

    const targetMovement = this.input.getTargetMovement();
    this.target.move(
      targetMovement.forward,
      targetMovement.side,
      forward,
      right,
      sprinting ? 8 : 4.5,
      deltaTime,
    );

    this.updateHorizontalMovement(move, sprinting, deltaTime);
    this.updateJump(sprinting, deltaTime);
    const speed = state.velocity.length();
    this.updateHeading(speed, deltaTime);
    this.updateBody(speed, deltaTime);
    this.updateGait(speed, deltaTime);
    this.updateEffects(sprinting && hasInput, speed, deltaTime);
    this.cameraController.update(state, this.rig.eyePivot, deltaTime);
    this.sun.position.set(state.position.x + 8, 15, state.position.z + 6);
    this.sun.target.position.set(state.position.x, 0, state.position.z);
    this.updateStatus(speed);
  }

  // Drive the rig from an externally supplied pose ({x, z, yaw, distance,
  // collision}) — shared by recorded replays and the live brain.
  applyExternalFrame(frame, deltaTime, chaseFocus = null) {
    this.elapsed += deltaTime;
    const state = this.state;
    state.velocity.set(
      (frame.x - state.position.x) / Math.max(deltaTime, 1e-4),
      0,
      (frame.z - state.position.z) / Math.max(deltaTime, 1e-4),
    );
    if (state.velocity.length() > MOVEMENT.sprintSpeed) {
      state.velocity.setLength(MOVEMENT.sprintSpeed);
    }
    state.position.set(frame.x, 0, frame.z);
    state.yaw = frame.yaw;
    const speed = state.velocity.length();
    this.updateBody(speed, deltaTime);
    this.updateGait(speed, deltaTime);
    this.updateEffects(frame.collision, speed, deltaTime);
    this.cameraController.update(state, this.rig.eyePivot, deltaTime, chaseFocus);
    this.sun.position.set(state.position.x + 8, 15, state.position.z + 6);
    this.sun.target.position.set(state.position.x, 0, state.position.z);
  }

  updateExternal(frame, deltaTime, replay) {
    this.applyExternalFrame(frame, deltaTime);
    const collisionLabel = frame.collision
      ? `${frame.collisionPart?.startsWith('leg') ? 'LEG' : 'BODY'} COLLISION`
      : 'MOVING';
    this.statusElement.textContent = `TRAINING // ${replay.checkpoint.step.toLocaleString()} STEPS // DISTANCE ${frame.distance.toFixed(1)} M // ${collisionLabel}`;
  }

  updateHorizontalMovement(move, sprinting, deltaTime) {
    const state = this.state;
    const maximumSpeed = sprinting ? MOVEMENT.sprintSpeed : MOVEMENT.walkSpeed;
    const desired = this.v[3].copy(move).multiplyScalar(maximumSpeed);
    const difference = this.v[4].subVectors(desired, state.velocity);
    const distance = difference.length();
    const acceleration = (
      state.grounded ? MOVEMENT.acceleration : MOVEMENT.airAcceleration
    ) * deltaTime;
    if (distance > 1e-6) {
      state.velocity.addScaledVector(
        difference.multiplyScalar(1 / distance),
        Math.min(distance, acceleration),
      );
    }

    const previousX = state.position.x;
    const previousZ = state.position.z;
    state.position.addScaledVector(state.velocity, deltaTime);
    if (!this.positionBlocked(state.position.x, state.position.z)) return;

    const attemptedX = state.position.x;
    const attemptedZ = state.position.z;
    state.position.set(previousX, state.position.y, previousZ);
    if (!this.positionBlocked(attemptedX, previousZ)) state.position.x = attemptedX;
    else state.velocity.x = 0;
    if (!this.positionBlocked(state.position.x, attemptedZ)) state.position.z = attemptedZ;
    else state.velocity.z = 0;
  }

  positionBlocked(x, z) {
    return this.world.colliders.some((obstacle) => {
      const minimumDistance = obstacle.radius + BODY_COLLISION_RADIUS;
      const dx = x - obstacle.x;
      const dz = z - obstacle.z;
      return dx * dx + dz * dz < minimumDistance * minimumDistance;
    });
  }

  updateJump(sprinting, deltaTime) {
    const state = this.state;
    if (state.grounded && this.input.consumeJump()) {
      state.verticalVelocity = sprinting ? 8.6 : 7.4;
      state.grounded = false;
      state.crouch = Math.min(state.crouch + 0.12, 0.3);
    }
    if (!state.grounded) {
      state.verticalVelocity -= MOVEMENT.gravity * deltaTime;
      state.jumpHeight += state.verticalVelocity * deltaTime;
      if (state.jumpHeight <= 0 && state.verticalVelocity < 0) {
        state.jumpHeight = 0;
        state.verticalVelocity = 0;
        state.grounded = true;
        state.crouch = 0.34;
        this.rig.legs.forEach((leg, index) => {
          leg.replantDelay = 0.02 + index * 0.05;
        });
      }
    }
    state.crouch += (0 - state.crouch) * Math.min(1, 9 * deltaTime);
  }

  updateHeading(speed, deltaTime) {
    if (speed <= 0.5) return;
    const state = this.state;
    const targetYaw = Math.atan2(state.velocity.x, state.velocity.z);
    const turnRate = (state.grounded ? 8 : 3.5)
      * (0.4 + Math.min(speed / MOVEMENT.walkSpeed, 1) * 0.8);
    const previousYaw = state.yaw;
    state.yaw = turnToward(state.yaw, targetYaw, turnRate * deltaTime);
    this.cameraController.compensateForBodyTurn(state.yaw - previousYaw);
  }

  updateBody(speed, deltaTime) {
    const state = this.state;
    const acceleration = this.v[5]
      .copy(state.velocity)
      .sub(state.previousVelocity)
      .multiplyScalar(1 / Math.max(deltaTime, 1e-4));
    state.previousVelocity.copy(state.velocity);
    const forward = this.v[0].set(Math.sin(state.yaw), 0, Math.cos(state.yaw));
    const right = this.v[1].set(-forward.z, 0, forward.x);
    const forwardAcceleration = THREE.MathUtils.clamp(acceleration.dot(forward), -30, 30);
    const sideAcceleration = THREE.MathUtils.clamp(acceleration.dot(right), -30, 30);
    const targetPitch = THREE.MathUtils.clamp(
      forwardAcceleration * 0.0065 + Math.min(speed / MOVEMENT.sprintSpeed, 1) * 0.05,
      -0.16,
      0.2,
    );
    let targetRoll = THREE.MathUtils.clamp(-sideAcceleration * 0.007, -0.16, 0.16);
    if (speed < 0.3 && state.grounded) targetRoll += Math.sin(this.elapsed * 0.8) * 0.012;
    state.pitchTilt += (targetPitch - state.pitchTilt) * Math.min(1, 7 * deltaTime);
    state.rollTilt += (targetRoll - state.rollTilt) * Math.min(1, 7 * deltaTime);

    state.gaitPhase += deltaTime * (2 + speed * 2.1);
    const normalizedSpeed = Math.min(speed / MOVEMENT.walkSpeed, 1);
    const bob = state.grounded
      ? -Math.abs(Math.sin(state.gaitPhase)) * 0.045 * normalizedSpeed
        + (1 - normalizedSpeed) * Math.sin(this.elapsed * 1.7) * 0.014
      : 0;
    const bodyHeight = STANDING_HEIGHT + state.jumpHeight + bob - state.crouch * 0.5;
    this.bodyHeight = bodyHeight;
    this.rig.robot.position.set(state.position.x, bodyHeight, state.position.z);
    this.rig.robot.rotation.set(state.pitchTilt, state.yaw, state.rollTilt);
    this.rig.eyePivot.rotation.set(
      -this.cameraController.eyePitch,
      this.cameraController.eyeYaw,
      0,
    );
    this.rig.robot.updateMatrixWorld(true);
  }

  updateGait(speed, deltaTime) {
    const state = this.state;
    const stepCount = [0, 0];
    this.rig.legs.forEach((leg) => {
      if (leg.stepping) stepCount[leg.gait] += 1;
    });
    const cosine = Math.cos(state.yaw);
    const sine = Math.sin(state.yaw);

    this.rig.legs.forEach((leg) => {
      const offsetX = leg.homeLocal.x * cosine + leg.homeLocal.z * sine;
      const offsetZ = -leg.homeLocal.x * sine + leg.homeLocal.z * cosine;
      const desiredFoot = this.v[6].set(
        state.position.x + offsetX,
        FOOT_HEIGHT,
        state.position.z + offsetZ,
      );
      const lead = this.v[7].copy(state.velocity).multiplyScalar(0.16);
      if (lead.length() > 0.55) lead.setLength(0.55);
      desiredFoot.x += lead.x;
      desiredFoot.z += lead.z;
      if (leg.cooldown > 0) leg.cooldown -= deltaTime;

      if (state.grounded) {
        this.updateGroundedLeg(leg, desiredFoot, speed, stepCount, deltaTime);
      } else {
        const reaching = state.verticalVelocity < -1.5;
        const radius = reaching ? 1.3 : 0.95;
        const verticalOffset = reaching ? -1.05 : -0.5;
        const airTarget = this.v[8].set(
          state.position.x + offsetX / HOME_RADIUS * radius,
          Math.max(FOOT_HEIGHT, this.bodyHeight + verticalOffset),
          state.position.z + offsetZ / HOME_RADIUS * radius,
        );
        leg.footPosition.lerp(airTarget, Math.min(1, 9 * deltaTime));
        leg.stepping = false;
      }
      this.solveAndPlace(leg);
    });
  }

  updateGroundedLeg(leg, desiredFoot, speed, stepCount, deltaTime) {
    if (leg.replantDelay >= 0) {
      leg.replantDelay -= deltaTime;
      if (leg.replantDelay < 0 && !leg.stepping) {
        this.startStep(leg, desiredFoot, speed, 0.13);
      }
    }
    if (leg.stepping) {
      leg.stepProgress += deltaTime / leg.stepDuration;
      leg.stepTo.lerp(desiredFoot, Math.min(1, 10 * deltaTime));
      if (leg.stepProgress >= 1) {
        leg.stepping = false;
        leg.footPosition.copy(leg.stepTo);
        leg.footPosition.y = FOOT_HEIGHT;
        leg.cooldown = 0.06;
      } else {
        const eased = leg.stepProgress ** 2 * (3 - 2 * leg.stepProgress);
        leg.footPosition.lerpVectors(leg.stepFrom, leg.stepTo, eased);
        leg.footPosition.y = FOOT_HEIGHT + Math.sin(leg.stepProgress * Math.PI) * leg.lift;
      }
      return;
    }

    const x = desiredFoot.x - leg.footPosition.x;
    const z = desiredFoot.z - leg.footPosition.z;
    const drift = Math.hypot(x, z);
    const otherGait = leg.gait === 0 ? 1 : 0;
    if (
      drift > 1.05
      || (drift > STEP_DISTANCE && stepCount[otherGait] === 0 && leg.cooldown <= 0)
    ) {
      this.startStep(leg, desiredFoot, speed, 0);
      stepCount[leg.gait] += 1;
    }
  }

  startStep(leg, target, speed, forcedDuration) {
    leg.stepping = true;
    leg.stepProgress = 0;
    leg.stepFrom.copy(leg.footPosition);
    leg.stepTo.copy(target);
    if (speed > 0.2) {
      const velocityLead = this.v[9].copy(this.state.velocity)
        .setLength(Math.min(0.22, speed * 0.04));
      leg.stepTo.add(velocityLead);
    }
    leg.stepTo.y = FOOT_HEIGHT;
    leg.stepDuration = forcedDuration
      || THREE.MathUtils.clamp(0.245 - speed * 0.012, 0.125, 0.24);
    leg.lift = (0.28 + Math.min(speed / MOVEMENT.sprintSpeed, 1) * 0.18) * ROBOT_SCALE;
    leg.replantDelay = -1;
  }

  solveAndPlace(leg) {
    const anchor = new THREE.Vector3().copy(leg.anchorLocal);
    this.rig.robot.localToWorld(anchor);
    const direction = new THREE.Vector3().subVectors(leg.footPosition, anchor);
    direction.y *= 0.2;
    if (direction.lengthSq() < 1e-6) direction.set(leg.out.x, 0, leg.out.z);
    direction.normalize();
    const hip = new THREE.Vector3().copy(anchor).addScaledVector(direction, COXA_LENGTH);
    this.placeSegment(leg.coxa, anchor, hip);

    const segment = new THREE.Vector3().subVectors(leg.footPosition, hip);
    const distance = segment.length();
    const clampedDistance = THREE.MathUtils.clamp(
      distance,
      Math.abs(FEMUR_LENGTH - LOWER_REACH) + 0.05,
      FEMUR_LENGTH + LOWER_REACH - 0.02,
    );
    const axis = segment.multiplyScalar(1 / Math.max(distance, 1e-6));
    const footTarget = new THREE.Vector3().copy(hip).addScaledVector(axis, clampedDistance);
    const along = (
      FEMUR_LENGTH ** 2 - LOWER_REACH ** 2 + clampedDistance ** 2
    ) / (2 * clampedDistance);
    const height = Math.sqrt(Math.max(1e-4, FEMUR_LENGTH ** 2 - along ** 2));
    const outward = new THREE.Vector3(
      leg.footPosition.x - this.state.position.x,
      0,
      leg.footPosition.z - this.state.position.z,
    );
    if (outward.lengthSq() < 1e-6) outward.set(1, 0, 0);
    outward.normalize();
    const pole = new THREE.Vector3().copy(UP).addScaledVector(outward, 0.42).normalize();
    const bend = pole.addScaledVector(axis, -pole.dot(axis));
    if (bend.lengthSq() < 1e-6) bend.copy(UP);
    bend.normalize();
    const knee = new THREE.Vector3().copy(hip)
      .addScaledVector(axis, along)
      .addScaledVector(bend, height);

    const lowerAxis = new THREE.Vector3().subVectors(footTarget, knee).normalize();
    const lowerDistance = footTarget.distanceTo(knee);
    const calfAlong = (
      SHIN_LENGTH ** 2 - CALF_LENGTH ** 2 + lowerDistance ** 2
    ) / (2 * lowerDistance);
    const calfOffset = Math.sqrt(Math.max(1e-4, SHIN_LENGTH ** 2 - calfAlong ** 2));
    const calfBend = outward.addScaledVector(lowerAxis, -outward.dot(lowerAxis));
    if (calfBend.lengthSq() < 1e-6) calfBend.copy(UP);
    calfBend.normalize();
    const calf = new THREE.Vector3().copy(knee)
      .addScaledVector(lowerAxis, calfAlong)
      .addScaledVector(calfBend, calfOffset);

    this.placeSegment(leg.femur, hip, knee);
    this.placeSegment(leg.tibia, knee, calf);
    this.placeSegment(leg.calf, calf, footTarget);
    leg.knee.position.copy(knee);
    leg.calfJoint.position.copy(calf);
  }

  placeSegment(object, start, end) {
    object.position.copy(start);
    const direction = new THREE.Vector3().subVectors(end, start).normalize();
    object.quaternion.setFromUnitVectors(UP, direction);
  }

  updateEffects(alerted, speed, deltaTime) {
    const state = this.state;
    state.alert += ((alerted ? 1 : 0) - state.alert) * Math.min(1, 5 * deltaTime);
    this.rig.eyeLight.intensity = 1 + state.alert * 0.9 + Math.sin(this.elapsed * 4.2) * 0.15;
    this.rig.materials.glow.emissiveIntensity = 1.9
      + state.alert * 1.4
      + Math.sin(this.elapsed * 4.2) * 0.25;
  }

  updateStatus(speed) {
    const mode = !this.state.grounded
      ? 'AIRBORNE'
      : speed > MOVEMENT.walkSpeed + 0.6
        ? 'SPRINT'
        : speed > 0.4
          ? 'WALK'
          : 'IDLE';
    this.statusElement.textContent = `UNIT-04 // ${mode} // ${speed.toFixed(1)} M/S // ${this.cameraController.mode}${
      this.target.selected ? ' // PINK SELECTED' : ''
    }`;
  }
}
