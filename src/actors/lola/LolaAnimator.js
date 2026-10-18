import * as THREE from 'three';

// Lola's animation layers, from bottom to top:
//   1. base locomotion: the Idle/Run/Strafe/Crouch blend picked by LolaLocomotion,
//      eased toward Idle while she pushes into a wall (the "stall" share);
//   2. full-body replacements: an authored jump (fades in and out), or a shot's
//      standing stance in the legs (eased in while she stands still);
//   3. upper-body overlays: the shot or the reload, which drive the arms,
//      torso and gun over whatever the legs do (one shared weight rule);
//   4. additive hit flinch: a bend of the spine applied after the pose.
// Clocks run in the 120 Hz movement sub-steps (advance), but the expensive
// pose is evaluated once per rendered frame for the equipped outfit (pose).

const UP = new THREE.Vector3(0, 1, 0);
const scratch = {
  axis: new THREE.Vector3(), worldAxis: new THREE.Vector3(), rotation: new THREE.Quaternion(),
  parent: new THREE.Quaternion(), inverse: new THREE.Quaternion(),
};

// Put the flinched spine joints back to their pose from before the flinch.
export function undoFlinch(outfit) {
  for (const joint of outfit.flinchBones ?? []) {
    if (joint.base) joint.bone.quaternion.copy(joint.base);
    joint.base = null;
  }
  if (outfit.hitBase && !outfit.flinchBones?.length) outfit.hitBone.quaternion.copy(outfit.hitBase);
  outfit.hitBase = null;
}

// The mixer averages every layer per bone, so showing an overlay at share w on
// top of a base whose weights add up to `base` needs w·base / (1 − w). A full
// overlay uses 1000 × base: the base still exists but contributes ~0.1%.
export function overlayWeight(share, base) {
  if (share <= 0) return 0;
  return share >= 0.999 ? 1000 * base : share * base / (1 - share);
}

// Move one action's clock forward like THREE.AnimationMixer.update would:
// looping clips wrap, one-shot clips stop on their last frame.
export function advanceAction(action, deltaTime) {
  if (!action.enabled || action.paused || !action.isScheduled()) return;
  const step = deltaTime * action.timeScale;
  if (step === 0) return;
  const duration = action.getClip().duration;
  let time = action.time + step;
  if (action.loop === THREE.LoopOnce) {
    if (time >= duration) time = duration;
    else if (time < 0) time = 0;
    else { action.time = time; return; }
    if (action.clampWhenFinished) action.paused = true;
    else action.enabled = false;
    action.time = time;
    return;
  }
  if (time >= duration || time < 0) time -= duration * Math.floor(time / duration);
  action.time = time;
}

export class LolaAnimator {
  // Advance every playing clip of one outfit by one movement sub-step.
  advance(outfit, deltaTime) {
    for (const action of outfit.timed) advanceAction(action, deltaTime);
  }

  // Evaluate one outfit's final pose from its clips and the active layers:
  // layers = { stall: { share, idle }, jump: { action, weight }, shot: { action, upper, legs },
  //            reload: { action, weight }, flinch: { strength, angle, direction }, mesh }.
  pose(outfit, layers) {
    // The flinch is added after the mixer, so start from the clean pose.
    undoFlinch(outfit);

    // Base layer: locomotion, eased toward standing while pushing into a wall.
    // The clips keep their own (travel) weights; only this pose sees the blend.
    const names = Object.keys(outfit.actions);
    const locomotion = Object.values(outfit.actions);
    const weights = locomotion.map(action => action.getEffectiveWeight());
    let base = weights.slice();
    if (layers.stall?.share > 0) {
      const total = base.reduce((sum, weight) => sum + weight, 0);
      base = base.map(weight => weight * (1 - layers.stall.share));
      base[names.indexOf(layers.stall.idle)] += layers.stall.share * total;
    }
    outfit.baseWeights = Object.fromEntries(names.map((name, i) => [name, base[i]]));
    // A jump fades the base out; a shot's standing stance takes its share of the legs.
    if (layers.jump?.weight > 0) {
      base = base.map(weight => weight * (1 - layers.jump.weight));
      layers.jump.action.setEffectiveWeight(layers.jump.weight);
    }
    let legs = 0;
    if (layers.shot) {
      legs = layers.shot.legs;
      base = base.map(weight => weight * (1 - legs));
      layers.shot.action.setEffectiveWeight(legs);
    }
    locomotion.forEach((action, i) => action.setEffectiveWeight(base[i]));

    // Upper-body overlays over whatever the legs do (the legs have no tracks in
    // them): the shot at full share, the reload at its fading share.
    const total = base.reduce((sum, weight) => sum + weight, 0) + legs || 1;
    if (layers.shot) layers.shot.upper.setEffectiveWeight(overlayWeight(1, total));
    if (layers.reload) layers.reload.action.setEffectiveWeight(overlayWeight(layers.reload.weight, total));

    // One mixer evaluation per frame; the clocks were already advanced.
    outfit.mixer.update(0);
    locomotion.forEach((action, i) => action.setEffectiveWeight(weights[i]));

    // Post-mixer: glue the reload gun into her hand, then add the flinch.
    if (layers.reload) this.placeReloadGun(outfit, layers.reload.action.time);
    if (layers.flinch) this.flinch(outfit, layers.flinch, layers.mesh);
  }

  // Put the reload gun where the reload's own rig holds it, relative to the hand.
  placeReloadGun(outfit, time) {
    const reload = outfit.reload;
    reload.sourceMixer.setTime(time);
    reload.sourceScene.updateMatrixWorld(true);
    reload.gun.matrix.copy(reload.sourceHand.matrixWorld).invert().multiply(reload.sourceGun.matrixWorld);
    reload.gun.matrixWorldNeedsUpdate = true;
  }

  // Flinch away from the impact by bending the spine; no root knockback. The
  // bend is shared along four joints (LOLA_FLINCH_SPREAD) so the shirt does
  // not stretch at the waist; arms and guns hang from the chest and follow.
  // flinch = { strength 0..1, angle (radians at full strength), direction (world) }.
  flinch(outfit, { strength, angle, direction }, mesh) {
    if (!outfit.flinchBones?.length) return;
    const { axis, worldAxis, rotation, parent, inverse } = scratch;
    mesh.updateMatrixWorld(true);
    // World rotation of the lowest joint's parent; each joint hangs from the last.
    outfit.flinchBones[0].bone.parent.getWorldQuaternion(parent);
    worldAxis.copy(UP).cross(direction);
    for (const joint of outfit.flinchBones) {
      joint.base = joint.bone.quaternion.clone();
      axis.copy(worldAxis).applyQuaternion(inverse.copy(parent).invert()).normalize();
      joint.bone.quaternion.premultiply(rotation.setFromAxisAngle(axis, angle * strength * joint.share));
      parent.multiply(joint.bone.quaternion);
    }
    // The lowest joint's clean pose, for the systems that undo the flinch to compare.
    outfit.hitBase = outfit.flinchBones[0].base;
  }
}
