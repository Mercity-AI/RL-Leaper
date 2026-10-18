import * as THREE from 'three';

// Lola's animation layers, from bottom to top:
//   1. base locomotion: the Idle/Run/Strafe/Crouch blend picked by LolaLocomotion,
//      eased toward Idle while she pushes into a wall (the "stall" share);
//   2. full-body replacements: an authored jump (fades in and out) or a
//      standing shot (replaces the whole pose);
//   3. upper-body overlays: the shot fired on the move, or the reload, which
//      drive the arms and torso while the legs keep the base layer;
//   4. additive hit flinch: a bend of the lower spine applied after the pose.
// Clocks run in the 120 Hz movement sub-steps (advance), but the expensive
// pose is evaluated once per rendered frame for the equipped outfit (pose).

const UP = new THREE.Vector3(0, 1, 0);
const scratch = {
  axis: new THREE.Vector3(), rotation: new THREE.Quaternion(), parent: new THREE.Quaternion(),
  p: new THREE.Vector3(), q: new THREE.Quaternion(), s: new THREE.Vector3(),
  toModel: new THREE.Matrix4(), chest: new THREE.Matrix4(), relative: new THREE.Matrix4(),
  local: new THREE.Matrix4(), parentMatrix: new THREE.Matrix4(),
};

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
  // layers = { stall: { share, idle }, jump: { action, weight }, shot: { upperOnly },
  //            reload: { action, weight }, flinch: { strength, angle, direction }, mesh }.
  pose(outfit, layers) {
    // The flinch is added after the mixer, so start from the clean pose.
    if (outfit.hitBase) outfit.hitBone.quaternion.copy(outfit.hitBase);
    outfit.hitBase = null;

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
    // A jump fades the base out; a standing (full-body) shot replaces it.
    if (layers.jump?.weight > 0) {
      base = base.map(weight => weight * (1 - layers.jump.weight));
      layers.jump.action.setEffectiveWeight(layers.jump.weight);
    }
    if (layers.shot && !layers.shot.upperOnly) base = base.map(() => 0);
    locomotion.forEach((action, i) => action.setEffectiveWeight(base[i]));

    // Upper-body overlay: the reload shows at its share over whatever the legs do.
    // Legs have no reload track and keep running at full weight.
    if (layers.reload) {
      const total = base.reduce((sum, weight) => sum + weight, 0) || 1;
      layers.reload.action.setEffectiveWeight(overlayWeight(layers.reload.weight, total));
    }

    // One mixer evaluation per frame; the clocks were already advanced.
    outfit.mixer.update(0);
    locomotion.forEach((action, i) => action.setEffectiveWeight(weights[i]));

    // Post-mixer: glue the reload gun and arms, then add the flinch.
    if (layers.reload) {
      this.placeReloadGun(outfit, layers.reload.action.time);
      this.attachReloadArms(outfit, layers.reload.weight);
    }
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

  // Pose the root-level shoulder/arm bones as the reload has them relative to its
  // chest, but relative to her current (running) chest, blended in by weight.
  // Call after placeReloadGun has posed the reload's own rig.
  attachReloadArms(outfit, weight) {
    const reload = outfit.reload;
    if (!reload.torso || !reload.sourceTorso || weight <= 0) return;
    const { toModel, chest, relative, local, parentMatrix, p, q, s } = scratch;
    outfit.model.updateMatrixWorld(true);
    toModel.copy(outfit.model.matrixWorld).invert();
    chest.multiplyMatrices(toModel, reload.torso.matrixWorld);
    // Source rig: torso-relative transform of each bone.
    const sourceChestInverse = relative.copy(reload.sourceTorso.matrixWorld).invert();
    for (const { bone, source } of reload.attached) {
      if (!source) continue;
      local.multiplyMatrices(sourceChestInverse, source.matrixWorld); // bone relative to the reload's chest
      local.premultiply(chest); // ...placed on her chest, in model space
      parentMatrix.multiplyMatrices(toModel, bone.parent.matrixWorld).invert();
      local.premultiply(parentMatrix); // ...as the bone's own local transform
      local.decompose(p, q, s);
      bone.position.lerp(p, weight);
      bone.quaternion.slerp(q, weight);
      bone.scale.lerp(s, weight);
    }
  }

  // Flinch away from the impact by bending the lower spine; no root knockback.
  // flinch = { strength 0..1, angle (radians at full strength), direction (world) }.
  flinch(outfit, { strength, angle, direction }, mesh) {
    if (!outfit.hitBone) return;
    const { axis, rotation, parent } = scratch;
    outfit.hitBase = outfit.hitBone.quaternion.clone();
    mesh.updateMatrixWorld(true);
    outfit.hitBone.parent.getWorldQuaternion(parent);
    axis.copy(UP).cross(direction).applyQuaternion(parent.invert()).normalize();
    outfit.hitBone.quaternion.premultiply(rotation.setFromAxisAngle(axis, angle * strength));
  }
}
