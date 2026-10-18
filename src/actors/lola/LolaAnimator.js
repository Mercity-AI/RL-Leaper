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
  matrix: new THREE.Matrix4(), toParent: new THREE.Matrix4(), chain: new THREE.Matrix4(), grip: new THREE.Matrix4(),
  local: new THREE.Matrix4(), position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), scale: new THREE.Vector3(),
  held: new THREE.Vector3(), heldRotation: new THREE.Quaternion(), heldScale: new THREE.Vector3(),
  sampled: { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), scale: new THREE.Vector3() },
};

// One node's local matrix in a clip at full weight at `time`, from samplers
// made by LolaAssets (tracks it has, else its rest values), written to `out`.
function sampleLocal(samplers, time, out) {
  const { position, quaternion, scale } = scratch.sampled;
  const read = (property, target) => (samplers[property]
    ? target.fromArray(samplers[property].evaluate(time)) : target.copy(samplers.rest[property]));
  read('position', position);
  read('quaternion', quaternion).normalize();
  read('scale', scale);
  return out.compose(position, quaternion, scale);
}

// Undo the hip twist (see LolaAnimator.warp): put the twisted bones back.
export function undoWarp(outfit) {
  for (const saved of outfit.warpBases ?? []) {
    saved.bone.position.copy(saved.position);
    saved.bone.quaternion.copy(saved.quaternion);
  }
  outfit.warpBases = [];
}

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
  // Advance every playing clip of one outfit by one movement sub-step, except
  // those in `skip` (the moving clips, which LolaLocomotion keeps in step).
  advance(outfit, deltaTime, skip = null) {
    for (const action of outfit.timed) if (!skip?.has(action)) advanceAction(action, deltaTime);
  }

  // Evaluate one outfit's final pose from its clips and the active layers:
  // layers = { stall: { share, idle }, jump: { action, weight, clip, carried }, shot: { action, upper, legs },
  //            reload: { action, weight }, warp: { angle, hips },
  //            flinch: { strength, angle, direction }, silence: [actions], mesh }.
  pose(outfit, layers) {
    // The twist and flinch are added after the mixer, so start from the clean pose.
    undoFlinch(outfit);
    undoWarp(outfit);

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

    // One mixer evaluation per frame; the clocks were already advanced. The
    // other gun's clips share the body's mixer, so they are silent for it.
    const silent = layers.silence ?? [];
    const silentWeights = silent.map(action => action.getEffectiveWeight());
    silent.forEach(action => action.setEffectiveWeight(0));
    outfit.mixer.update(0);
    silent.forEach((action, i) => action.setEffectiveWeight(silentWeights[i]));
    locomotion.forEach((action, i) => action.setEffectiveWeight(weights[i]));

    // Post-mixer: glue the reload gun into her hand, hand the jump gun over
    // while the jump fades, twist the hips, then add the flinch.
    if (layers.reload) this.placeReloadGun(outfit, layers.reload.action.time);
    if (layers.jump?.clip?.grip && layers.jump.carried && layers.jump.weight < 1) this.blendJumpGun(outfit, layers.jump);
    if (layers.warp) this.warp(outfit, layers.warp.angle, layers.warp.hips);
    if (layers.flinch) this.flinch(outfit, layers.flinch, layers.mesh);
  }

  // Twist her legs by `angle` (radians, positive = toward her right) about the
  // upright axis, so they run the way she is really going: the pelvis and both
  // legs turn together about her centre, then each leg turns a little more at
  // its own hip joint (LOLA_WARP_HIPS). The spine above then untwists joint by
  // joint (LOLA_WARP_SPINE) so her chest, arms and gun keep facing forward.
  // Worked out in the rig's own space, where up is +Y and no scale applies.
  warp(outfit, angle, hips) {
    if (Math.abs(angle) < 1e-5) return;
    const { axis, rotation, parent, inverse } = scratch;
    const save = bone => outfit.warpBases.push({ bone, position: bone.position.clone(), quaternion: bone.quaternion.clone() });
    // Bones hanging straight from the rig (pelvis, hips, thighs, spine root).
    const pelvisTurn = -angle * (1 - hips);
    rotation.setFromAxisAngle(UP, pelvisTurn);
    for (const bone of outfit.warpRoots) {
      save(bone);
      bone.position.applyQuaternion(rotation);
      bone.quaternion.premultiply(rotation);
    }
    // The rest of the legs' turn happens at the hip joints.
    rotation.setFromAxisAngle(UP, -angle * hips);
    for (const bone of outfit.warpLegs) bone.quaternion.premultiply(rotation);
    // Untwist the spine: each joint turns about up as seen in its parent's frame.
    parent.copy(outfit.warpSpine[0].bone.parent.quaternion);
    for (const { bone, share } of outfit.warpSpine) {
      save(bone);
      axis.copy(UP).applyQuaternion(inverse.copy(parent).invert()).normalize();
      bone.quaternion.premultiply(rotation.setFromAxisAngle(axis, -pelvisTurn * share / outfit.warpSpineTotal));
      parent.multiply(bone.quaternion);
    }
  }

  // A jump's gun is animated by the jump clip alone, so while the jump fades
  // in or out the mixer mixes it with the gun's resting place and it drifted
  // up to 40 cm out of her hand. Instead the gun goes between two places:
  //   held    in her right hand as the hand is now, gripped the way the clip
  //           grips it (exactly the authored gun at full weight), and
  //   carried where the carried gun sits right now (exactly what shows once
  //           the jump ends and the carried gun takes over),
  // blended by the jump's weight, so neither end of the jump pops the gun.
  // jump = { action, weight, clip: { gun, grip }, carried }.
  blendJumpGun(outfit, { action, weight, clip, carried }) {
    const { gun, grip } = clip;
    const { position, quaternion, scale, held, heldRotation, heldScale } = scratch;
    outfit.model.updateMatrixWorld(true);
    const toParent = scratch.toParent.copy(gun.parent.matrixWorld).invert();
    // Held: the clip's grip (gun relative to hand at full weight) on her hand now.
    const handFull = scratch.chain.identity();
    for (const joint of grip.chain) handFull.multiply(sampleLocal(joint, action.time, scratch.local));
    const gripMatrix = scratch.grip.copy(handFull).invert().multiply(sampleLocal(grip.gun, action.time, scratch.local));
    scratch.matrix.copy(toParent).multiply(grip.hand.matrixWorld).multiply(gripMatrix).decompose(held, heldRotation, heldScale);
    // Carried: the carried gun, seen from the same parent (her chest).
    scratch.matrix.copy(toParent).multiply(carried.matrixWorld).decompose(position, quaternion, scale);
    gun.position.copy(position).lerp(held, weight);
    gun.quaternion.copy(quaternion).slerp(heldRotation, weight);
    gun.scale.copy(scale).lerp(heldScale, weight);
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
