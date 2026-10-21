import * as THREE from 'three';
import { ENCOUNTER } from '../../config/encounter.js';
import { footLift } from '../../robot/footstepContacts.js';
import { LOLA_BLEND_RATE, LOLA_INPUT_STOP, LOLA_PACE, LOLA_PHASE_CATCHUP, LOLA_STRAFE_BLEND } from './lolaTuning.js';

// Pose-speed factor that makes a clip's planted boot move back exactly as fast
// as Lola travels (the stride profile's average speed). Some clips sweep the
// planted boot faster than their average speed (the run's flight phase covers
// no ground in the profile); played unscaled, the boot skates backward.
export function strideMatch(profile, contacts) {
  if (!profile?.distance || !contacts?.stanceSpeed) return 1;
  return THREE.MathUtils.clamp(profile.distance / profile.duration / contacts.stanceSpeed, 0.5, 1.5);
}

const isIdle = name => name.includes('Idle');
// Clips that carry her across the ground and share one stride phase. (Walk is
// exported but never chosen.)
const STRIDE_CLIPS = Object.freeze(['Run', 'StrafeLeft', 'StrafeRight', 'CrouchWalk']);
// Which way each clip's legs carry her in her own frame (x = right, y = forward);
// Run and CrouchWalk follow the input's forward/back sign.
const LEG_DIRECTION = Object.freeze({ StrafeRight: { x: 1, y: 0 }, StrafeLeft: { x: -1, y: 0 } });
const legDirection = (name, forwardAmount) => LEG_DIRECTION[name] ?? { x: 0, y: forwardAmount < 0 ? -1 : 1 };
const wrap = value => value - Math.floor(value);

// How far one full cycle of a clip carries her when its planted boot stays put
// (model units): its measured stride, adjusted by the stride-match playback rate.
function cycleTravel(outfit, name) {
  const profile = outfit.profiles[name];
  if (!profile?.distance) return 0;
  return profile.distance / strideMatch(profile, outfit.footContacts[name]);
}

// Cycles per second of the shared stride phase: the moving clips' own
// playback rates, averaged by weight (0 when none is blended in).
function strideFrequency(outfit) {
  let total = 0, rate = 0;
  for (const name of STRIDE_CLIPS) {
    const action = outfit.actions[name], weight = action.getEffectiveWeight();
    total += weight;
    rate += weight * Math.abs(action.timeScale) / action.getClip().duration;
  }
  return total > 1e-9 ? rate / total : 0;
}

// Lola's legs: eased input, which locomotion clips play and how much, how fast
// each plays so the planted boot stays put, one shared stride phase, how far
// that carries her, and how high her body sits so the lower boot touches the floor.
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

  // Directional blend: how much of each clip the input direction asks for.
  // From straight ahead (or straight back) up to 45 degrees she runs (her hips
  // twist toward the diagonal, see LolaPlayer.updateWarp); from 45 to 90
  // degrees the run hands over to the strafe; pure sideways is the strafe.
  // Crouched, the crouch walk covers every direction. Returns { weights, current }.
  targets(forwardAmount, sideAmount, inputStrength, crouching) {
    if (!inputStrength) return { weights: { [crouching ? 'CrouchIdle' : 'Idle']: 1 }, current: crouching ? 'CrouchIdle' : 'Idle' };
    if (crouching) return { weights: { CrouchWalk: 1 }, current: 'CrouchWalk' };
    // Angle of the input away from the forward/back line: 0 = straight, 90 = sideways.
    const angle = Math.atan2(Math.abs(sideAmount), Math.abs(forwardAmount)) * 180 / Math.PI;
    const t = THREE.MathUtils.clamp((angle - LOLA_STRAFE_BLEND.start) / (LOLA_STRAFE_BLEND.end - LOLA_STRAFE_BLEND.start), 0, 1);
    const strafe = t * t * (3 - 2 * t);
    const side = sideAmount < 0 ? 'StrafeLeft' : 'StrafeRight';
    const weights = { Run: 1 - strafe, [side]: strafe };
    return { weights, current: strafe > 0.5 ? side : 'Run' };
  }

  // One sub-step of one outfit's base layer: cross-fade toward the target
  // weights, set each clip's stride-matched playback rate and the floor height.
  // Returns how far the clips carry her (model units; only counted for the
  // equipped outfit). The blended clips play on one shared stride phase, so
  // each covers its own cycle's ground at that shared pace; their travel adds
  // up in each clip's own direction (a 50/50 run-strafe blend goes diagonally).
  // stall (optional) = { share, idle }: the share of the pose LolaAnimator
  // eases toward standing while a wall stops her; her height follows it too.
  update(outfit, { targets, forwardAmount, inputStrength, grounded, countTravel, world, stall = null }, deltaTime) {
    // Starting or stopping keeps the stride phase, so the feet do not jump.
    // (Moving clips always share one phase, see advance.)
    if (grounded && outfit.current !== targets.current) {
      const previous = outfit.actions[outfit.current], next = outfit.actions[targets.current];
      if (isIdle(outfit.current) || isIdle(targets.current)) {
        next.time = previous.time / previous.getClip().duration * next.getClip().duration;
      }
      outfit.current = targets.current;
    }
    const averageWeight = {}, weights = {};
    for (const [name, action] of Object.entries(outfit.actions)) {
      const oldWeight = action.getEffectiveWeight();
      const weight = grounded
        ? THREE.MathUtils.lerp(oldWeight, targets.weights[name] ?? 0, 1 - Math.exp(-LOLA_BLEND_RATE * deltaTime)) : oldWeight;
      action.setEffectiveWeight(weight);
      weights[name] = weight;
      averageWeight[name] = (oldWeight + weight) / 2;
      const pace = name.startsWith('Crouch') ? LOLA_PACE.crouch : this.runPace;
      const rate = name.startsWith('Strafe') ? pace
        : isIdle(name) ? 1 : pace * (forwardAmount < 0 ? -1 : 1);
      action.timeScale = isIdle(name) ? 1 : rate * inputStrength;
      if (!grounded) action.timeScale = 0;
      const profile = outfit.profiles[name];
      // Play the pose at the rate where the planted boot sweeps back exactly as
      // fast as she travels, so it stays put on the ground.
      if (!isIdle(name)) action.timeScale *= strideMatch(profile, outfit.footContacts[name]);
    }
    // Each clip's measured floor offset, minus how far its lower boot is lifted at
    // this moment (already in world units), so the run never hovers between steps.
    // Weighted like the pose she shows, so standing at a wall she stands on the
    // floor instead of hovering at the run's height (the run lifts her ~9 cm).
    // The junkyard floor sits slightly below y = 0; stand on it, not above it.
    // Only the equipped gun's view places the shared body.
    if (countTravel) {
      const total = Object.values(weights).reduce((sum, weight) => sum + weight, 0);
      let floor = 0, lift = 0;
      for (const [name, action] of Object.entries(outfit.actions)) {
        const shown = stall ? weights[name] * (1 - stall.share) + (name === stall.idle ? stall.share * total : 0) : weights[name];
        floor += outfit.profiles[name].groundOffset * shown;
        lift += footLift(outfit.footContacts[name], action.time) * shown;
      }
      outfit.model.position.y = floor * world.scale * ENCOUNTER.lolaHeight - lift + (world.floorHeight ?? 0);
    }
    if (!countTravel || !inputStrength) return 0;
    // Travel at the clips' average speed (one cycle's ground per stride cycle).
    // Following the feet exactly stalls Lola (and the camera locked to her) at
    // every foot handoff.
    const legs = this.legVector(outfit, forwardAmount, averageWeight);
    return strideFrequency(outfit) * deltaTime * Math.hypot(legs.x, legs.y);
  }

  // Ground one stride cycle covers, added up over the blended clips in each
  // clip's own direction (x = her right, y = her forward), for the given weights.
  legVector(outfit, forwardAmount, weights) {
    let x = 0, y = 0;
    for (const name of STRIDE_CLIPS) {
      const ground = (weights[name] ?? 0) * cycleTravel(outfit, name);
      const direction = legDirection(name, forwardAmount);
      x += direction.x * ground;
      y += direction.y * ground;
    }
    return { x, y };
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

  // Phase in [0, 1) where this clip plants its left boot, in its playback direction.
  static alignment(outfit, name, sign) {
    const contacts = outfit.footContacts[name];
    if (!contacts?.forward?.length) return 0;
    return (sign < 0 ? contacts.reverse[0] : contacts.forward[0]) / contacts.duration;
  }

  // Advance the moving clips by one sub-step on one shared stride phase, so a
  // blend of run and strafe always plants the same boot at the same moment.
  // The heaviest clip leads; the phase moves at the weight-averaged speed of
  // the blended clips. Returns each clip's clock change (clip seconds) for the
  // footstep check, or null when no moving clip is playing.
  advance(outfit, forwardAmount, deltaTime) {
    const clips = STRIDE_CLIPS.map(name => {
      const action = outfit.actions[name];
      const sign = name.startsWith('Strafe') ? 1 : forwardAmount < 0 ? -1 : 1;
      return { name, action, sign, duration: action.getClip().duration, weight: action.getEffectiveWeight() };
    });
    let leader = clips.reduce((best, clip) => (clip.weight > best.weight ? clip : best));
    if (leader.weight <= 1e-9) leader = clips.find(clip => clip.name === outfit.current);
    if (!leader) return null;
    const frequency = leader.weight > 1e-9 ? strideFrequency(outfit) : Math.abs(leader.action.timeScale) / leader.duration;
    // Phase since the leader's left-boot plant, in its playback direction.
    const phase = wrap(leader.sign * (leader.action.time / leader.duration - LolaLocomotion.alignment(outfit, leader.name, leader.sign)))
      + frequency * deltaTime;
    const deltas = {};
    for (const clip of clips) {
      const start = LolaLocomotion.alignment(outfit, clip.name, clip.sign);
      const target = wrap(start + clip.sign * phase);
      deltas[clip.name] = clip.sign * frequency * clip.duration * deltaTime;
      // The leader, and clips not showing, sit exactly on the shared phase.
      if (clip === leader || clip.weight <= 0.02) {
        clip.action.time = clip.duration * target;
        continue;
      }
      // A visible follower plays on and closes any gap to the shared phase at
      // a limited rate, so a phase jump eases in instead of snapping its pose.
      const natural = clip.action.time / clip.duration + clip.sign * frequency * deltaTime;
      const gap = wrap(target - natural + 0.5) - 0.5;
      const most = LOLA_PHASE_CATCHUP * deltaTime;
      clip.action.time = clip.duration * wrap(natural + THREE.MathUtils.clamp(gap, -most, most));
    }
    return deltas;
  }

  // Which way her legs carry her right now, in her own frame (x = right,
  // y = forward), from the blended clips' current weights.
  legsDirection(outfit, forwardAmount) {
    const weights = Object.fromEntries(STRIDE_CLIPS.map(name => [name, outfit.actions[name].getEffectiveWeight()]));
    return this.legVector(outfit, forwardAmount, weights);
  }
}

export { STRIDE_CLIPS };
