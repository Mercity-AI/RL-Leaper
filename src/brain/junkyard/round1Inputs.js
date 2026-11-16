// Inputs 34-37 of a round-1 retrained brain (38 inputs; opt-in, see README "Round-1 brains"):
// a port of the training code, line by line, with NumPy's float32 / float64 rounding.
//
//   I1 "motion note" (34-36): which way Lola moved between two brain steps on which she was
//      seen, and how fast as a share of her sprint step; kept while she is unseen; zeros at
//      reset. rl/moving_target_env.py MovingTargetMixin.step / _mt_reset.
//   I2 "not there" (37): 1 when she has been seen, is not visible now, the spot where it last
//      saw her is in its sight and she is more than 4 units from it. rl/round1_env.py
//      Round1Mixin._not_there / _spot_check and Round1YardEnv._spot_in_sight.
//
// When they are computed in the session (brainSession.js) is fixed by rl/round1_session.py:
// I1 updates once per /step, at the live sight refresh before inference (never after the
// move, at /sync or /sense); I2 is recomputed from that same refreshed state.
// Today's 34-input brain never loads this file's logic.

import { f32, norm32, norm64, pyMod } from './pyMath.js';
import { TARGET_RADIUS, VISION_FOV } from './frozenEnv.js';

export const ROUND1_OBS_SIZE = 38;
export const NOT_THERE_RADIUS = 4.0;              // rl/round1_env.py NOT_THERE_RADIUS
// Lola's head, chest and hips as shares of her 1.7 map-unit height (GameExamEnv.BODY_HEIGHTS).
export const BODY_HEIGHT_SHARES = [0.9, 0.7, 0.53];
const LOLA_HEIGHT = 1.7;
const SPRINT_SPEED = 6.4;   // map units a second (rl/moving_target.py SPRINT_STEP)
const STEP_SECONDS = 0.1;

// Brain-unit constants for a world scale (7.98 / width). At width 5.5 they equal the Python
// constants bit for bit (same operations in the same order: 6.4 * MAP_TO_BRAIN * 0.1, h * 1.7 * M).
export function round1Constants(scale, eye) {
  return {
    sprintStep: SPRINT_SPEED * scale * STEP_SECONDS,
    heights: BODY_HEIGHT_SHARES.map((h) => h * LOLA_HEIGHT * scale),
    eye: [Number(eye[0]), Number(eye[1]), Number(eye[2])],
  };
}

// MovingTargetMixin.step's motion-note block. `target`, `previous`: float32 values; returns
// { note, previous }. NumPy: float32 velocity, float32 norm, float32 division by the (weak)
// Python float speed, Python float speed / SPRINT_STEP, then float32.
export function motionNoteUpdate(note, previous, target, visible, sprintStep) {
  if (!visible) return { note, previous: null };
  let next = note;
  if (previous) {
    const vx = f32(target[0] - previous[0]), vz = f32(target[1] - previous[1]);
    const speed = norm32(vx, vz);
    let dx = 0, dz = 0;
    if (speed > 1e-6) {
      dx = f32(vx / speed);
      dz = f32(vz / speed);
    }
    next = [dx, dz, f32(Math.min(1.0, speed / sprintStep))];
  }
  return { note: next, previous: [target[0], target[1]] };
}

// Round1YardEnv._spot_in_sight(spot) for a float64 spot: in the 270° view, within the sight
// range, and at least one of three eye lines to Lola's body points standing there is clear.
// `pose`: { position: [x, z] float32, yaw }; `sight`: JunkyardSight.
export function spotInSight(pose, spot, sight, sightRange, constants) {
  const [px, pz] = pose.position;
  const dx = spot[0] - px, dz = spot[1] - pz;          // float64 spot - float32 position
  const bearing = Math.atan2(dx, dz);
  const relative = pyMod(bearing - pose.yaw + Math.PI, 2 * Math.PI) - Math.PI;
  if (Math.abs(relative) > VISION_FOV / 2 || norm64(dx, dz) - TARGET_RADIUS > sightRange) return false;
  // math.cos / math.sin (Python floats) meet the float32 position: NEP 50 keeps float32.
  const c = Math.cos(pose.yaw), s = Math.sin(pose.yaw);
  const { eye, heights } = constants;
  const origin = [f32(f32(px + f32(eye[0] * c)) + f32(eye[2] * s)), eye[1],
    f32(f32(pz - f32(eye[0] * s)) + f32(eye[2] * c))];
  return heights.some((h) => sight.hit(origin, [spot[0], h, spot[1]]) === null);
}

// Round1Mixin._not_there (with _spot_check's test, without its per-step cache).
// `state`: { targetEverSeen, targetVisible, lastSeenTarget, target, position, yaw }.
export function notThere(state, sight, sightRange, constants) {
  if (!state.targetEverSeen || state.targetVisible) return 0;
  const spot = [state.lastSeenTarget[0], state.lastSeenTarget[1]];
  const far = norm64(state.target[0] - spot[0], state.target[1] - spot[1]) > NOT_THERE_RADIUS;
  return far && spotInSight(state, spot, sight, sightRange, constants) ? 1 : 0;
}

// The session's I1 memory and both inputs for one FrozenJunkyardEnv (eye sight only).
export class Round1Inputs {
  constructor(env, { scale, eye }) {
    if (!env.sight || !env.sightPose) throw new Error('This brain needs eye-level sight (sight_mode "eye")');
    this.env = env;
    this.constants = round1Constants(scale, eye);
    // MovingTargetMixin._mt_reset: zeros; Lola at reset is the first sighting if it sees her.
    this.note = [0, 0, 0];
    this.previous = env.targetVisible ? [env.target[0], env.target[1]] : null;
  }

  // The one look per /step that updates I1 (the live refresh before inference).
  see() {
    const env = this.env;
    ({ note: this.note, previous: this.previous } = motionNoteUpdate(this.note, this.previous, env.target,
      env.targetVisible, this.constants.sprintStep));
  }

  notThere() {
    return notThere(this.env, this.env.sight, this.env.sightRange, this.constants);
  }

  // Inputs 34-37 as float32.
  values() {
    return Float32Array.of(this.note[0], this.note[1], this.note[2], this.notThere());
  }

  // Teacher forcing: copy Python's I1 memory in.
  setState(state) {
    this.note = state.motion_note.map(f32);
    this.previous = state.previous_seen_target ? state.previous_seen_target.map(f32) : null;
  }
}
