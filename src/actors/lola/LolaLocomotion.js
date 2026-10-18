import * as THREE from 'three';
import { ENCOUNTER } from '../../config/encounter.js';
import { footLift } from '../../robot/footstepContacts.js';
import { LOLA_BLEND_RATE, LOLA_INPUT_STOP, LOLA_PACE } from './lolaTuning.js';

// Pose-speed factor that makes a clip's planted boot move back exactly as fast
// as Lola travels (the stride profile's average speed). Some clips sweep the
// planted boot faster than their average speed (the run's flight phase covers
// no ground in the profile); played unscaled, the boot skates backward.
export function strideMatch(profile, contacts) {
  if (!profile?.distance || !contacts?.stanceSpeed) return 1;
  return THREE.MathUtils.clamp(profile.distance / profile.duration / contacts.stanceSpeed, 0.5, 1.5);
}

const isIdle = name => name.includes('Idle');

// Lola's legs: eased input, which locomotion clip plays, how fast each clip
// plays so the planted boot stays put, how far that carries her, and how high
// her body sits so the lower boot touches the floor.
export class LolaLocomotion {
  constructor() {
    // Smoothed movement input so speed and facing ramp instead of snapping.
    this.inputForward = 0;
    this.inputSide = 0;
    this.runPace = LOLA_PACE.run;
  }

  // Ease the requested input one sub-step toward the keys; a released stick
  // that is nearly centred snaps to a full stop.
  easeInput(forwardAmount, sideAmount, ease) {
    this.inputForward += (forwardAmount - this.inputForward) * ease;
    this.inputSide += (sideAmount - this.inputSide) * ease;
    if (forwardAmount === 0 && sideAmount === 0
        && Math.hypot(this.inputForward, this.inputSide) < LOLA_INPUT_STOP) {
      this.inputForward = 0;
      this.inputSide = 0;
    }
  }

  // The one clip the input asks for: strafe when mostly sideways, Run forward or
  // backward otherwise, Idle when still; crouched variants while crouching.
  chooseClip(forwardAmount, sideAmount, inputStrength, crouching) {
    if (crouching) return inputStrength ? 'CrouchWalk' : 'CrouchIdle';
    if (!inputStrength) return 'Idle';
    const sideways = Math.abs(sideAmount) > 0.1 && Math.abs(sideAmount) >= Math.abs(forwardAmount);
    return sideways ? (sideAmount < 0 ? 'StrafeLeft' : 'StrafeRight') : 'Run';
  }

  // One sub-step of one outfit's base layer: cross-fade toward `next`, set each
  // clip's stride-matched playback rate and the floor height. Returns how far
  // the clips carry her (model units; only counted for the equipped outfit).
  update(outfit, { next, forwardAmount, inputStrength, grounded, countTravel, world }, deltaTime) {
    // A clip switch keeps the stride phase, so the feet do not jump.
    if (grounded && outfit.current !== next) {
      const previous = outfit.actions[outfit.current];
      outfit.actions[next].time = previous.time / previous.getClip().duration * outfit.actions[next].getClip().duration;
      outfit.current = next;
    }
    let distance = 0, floor = 0, lift = 0;
    for (const [name, action] of Object.entries(outfit.actions)) {
      const oldWeight = action.getEffectiveWeight();
      const weight = grounded
        ? THREE.MathUtils.lerp(oldWeight, name === next ? 1 : 0, 1 - Math.exp(-LOLA_BLEND_RATE * deltaTime)) : oldWeight;
      action.setEffectiveWeight(weight);
      const pace = name.startsWith('Crouch') ? LOLA_PACE.crouch : this.runPace;
      const rate = name.startsWith('Strafe') ? pace
        : isIdle(name) ? 1 : pace * (forwardAmount < 0 ? -1 : 1);
      action.timeScale = isIdle(name) ? 1 : rate * inputStrength;
      if (!grounded) action.timeScale = 0;
      const profile = outfit.profiles[name];
      // Travel at the clip's average speed. Following the feet exactly stalls
      // Lola (and the camera locked to her) at every foot handoff.
      const advance = Math.abs(deltaTime * action.timeScale);
      // Play the pose at the rate where the planted boot sweeps back exactly as
      // fast as she travels, so it stays put on the ground.
      if (!isIdle(name)) action.timeScale *= strideMatch(profile, outfit.footContacts[name]);
      if (countTravel && inputStrength && profile.duration && !isIdle(name)) {
        distance += profile.distance / profile.duration * advance * (oldWeight + weight) / 2;
      }
      floor += profile.groundOffset * weight;
      lift += footLift(outfit.footContacts[name], action.time) * weight;
    }
    // Each clip's measured floor offset, minus how far its lower boot is lifted at
    // this moment (already in world units), so the run never hovers between steps.
    // The junkyard floor sits slightly below y = 0; stand on it, not above it.
    outfit.model.position.y = floor * world.scale * ENCOUNTER.lolaHeight - lift + (world.floorHeight ?? 0);
    return distance;
  }

  // In the air (physics hop only) she keeps her run or strafe speed.
  airborneDistance(outfit, sideAmount, forwardAmount, inputStrength, deltaTime) {
    const sideways = Math.abs(sideAmount) > 0.1 && Math.abs(sideAmount) >= Math.abs(forwardAmount);
    const profile = outfit.profiles[sideways ? (sideAmount < 0 ? 'StrafeLeft' : 'StrafeRight') : 'Run'];
    return profile.distance / profile.duration * this.runPace * inputStrength * deltaTime;
  }

  // When a wall stops part of the move, the clips slow down to match, so the
  // feet do not keep striding on the spot.
  scaleRates(outfit, progress) {
    for (const [name, action] of Object.entries(outfit.actions)) {
      if (!isIdle(name)) action.timeScale *= progress;
    }
  }
}
