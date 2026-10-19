// Replays the Python brain recordings (tests/fixtures/brain/*.json, made by
// scripts/make_junkyard_fixtures.py) through the JavaScript port and lists
// every difference. Shared by tests/brain-parity.test.js (Node) and
// tests/brain-onnx.html (browser), so both judge parity the same way.

import { JunkyardBrainSession } from './brainSession.js';

// --- Reading the recordings ------------------------------------------------------

export function decodeArray(packed) {
  const binary = atob(packed.b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}

export function fixtureArrays(fixture) {
  const out = {};
  for (const [name, packed] of Object.entries(fixture.arrays)) out[name] = decodeArray(packed);
  return out;
}

// A policy that answers with the recorded action and remembers what it was shown.
class ReplayPolicy {
  constructor(actions) {
    this.actions = actions;
    this.index = 0;
    this.seen = null;
    this.episodeStart = null;
  }

  async act(obs, memory, episodeStart) {
    this.seen = Float32Array.from(obs);
    this.episodeStart = episodeStart;
    const k = this.index;
    this.index += 1;
    return { action: this.actions.subarray(k * 2, k * 2 + 2), memory };
  }
}

// --- Comparing one frame / state ----------------------------------------------------

function maxAbs(a, b) {
  let worst = 0;
  for (let i = 0; i < a.length; i += 1) worst = Math.max(worst, Math.abs(a[i] - b[i]));
  return worst;
}

// Yes/no facts that must agree exactly ("discrete flips").
function discreteDiffs(js, py) {
  const diffs = [];
  for (const key of ['collision', 'collisionPart', 'target_visible', 'target_ever_seen', 'sight_visible',
    'caught', 'memory_age', 'step', 'sight_mode', 'contact_version', 'sight_version', 'model_step']) {
    if (js[key] !== py[key]) diffs.push(`${key}: js ${js[key]} vs py ${py[key]}`);
  }
  if (Boolean(js.sight) !== Boolean(py.sight)) diffs.push('sight debug presence');
  if (js.sight && py.sight) {
    if (js.sight.in_view !== py.sight.in_view) diffs.push(`sight.in_view: js ${js.sight.in_view} vs py ${py.sight.in_view}`);
    for (let i = 0; i < 3; i += 1) {
      if (js.sight.clear[i] !== py.sight.clear[i]) diffs.push(`sight.clear[${i}]`);
      if ((js.sight.hits[i] === null) !== (py.sight.hits[i] === null)) diffs.push(`sight.hits[${i}] null`);
    }
  }
  return diffs;
}

// Numbers: pose must be bit-identical; others within a small tolerance.
function numericDiffs(js, py) {
  const result = { pose: Math.max(Math.abs(js.x - py.x), Math.abs(js.z - py.z), Math.abs(js.yaw - py.yaw)),
    distance: Math.abs(js.distance - py.distance), vision: maxAbs(js.vision, py.vision),
    action: Math.max(Math.abs(js.throttle - py.throttle), Math.abs(js.turn - py.turn)), sight: 0 };
  if (js.sight && py.sight) {
    result.sight = Math.max(maxAbs(js.sight.origin, py.sight.origin), maxAbs(js.sight.points.flat(), py.sight.points.flat()));
    for (let i = 0; i < 3; i += 1) {
      if (js.sight.hits[i] && py.sight.hits[i]) result.sight = Math.max(result.sight, maxAbs(js.sight.hits[i], py.sight.hits[i]));
    }
  }
  return result;
}

// For callers that only see frames (e.g. through the Web Worker provider):
// { discrete: [list of yes/no disagreements], numbers: { pose, distance, ... } }.
export function frameDifferences(js, py) {
  return { discrete: discreteDiffs(js, py), numbers: numericDiffs(js, py) };
}

// Memory and counters must match exactly; the pose is checked separately (it
// may drift by float32 rounding in a free run driven by the ONNX network).
function stateDiffs(env, state, { pose: poseTolerance, obs: obsTolerance }) {
  const diffs = [];
  const same = (name, a, b, tolerance = 0) => {
    if (!(Math.abs(a - b) <= tolerance) && a !== b) diffs.push(`${name}: js ${a} vs py ${b}`);
  };
  same('position.x', env.position[0], state.position[0], poseTolerance);
  same('position.z', env.position[1], state.position[1], poseTolerance);
  same('yaw', env.yaw, state.yaw, poseTolerance);
  same('steps', env.steps, state.steps);
  same('last_collision', env.lastCollision, state.last_collision);
  same('previous_action.0', env.previousAction[0], state.previous_action[0], obsTolerance);
  same('previous_action.1', env.previousAction[1], state.previous_action[1], obsTolerance);
  same('target_visible', env.targetVisible, state.target_visible);
  same('target_ever_seen', env.targetEverSeen, state.target_ever_seen);
  same('last_seen_target.x', env.lastSeenTarget[0], state.last_seen_target[0], poseTolerance);
  same('last_seen_target.z', env.lastSeenTarget[1], state.last_seen_target[1], poseTolerance);
  same('steps_since_target_seen', env.stepsSinceTargetSeen, state.steps_since_target_seen);
  return diffs;
}

// Teacher forcing and the replayed-action run must be exact: bit-identical pose,
// observations within 1e-5 (in practice they are bit-identical too).
export const EXACT = Object.freeze({ pose: 0, obs: 1e-5 });

function sameList(a, b) {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

function newReport(fixture) {
  return { name: fixture.name, steps: fixture.steps.length, obsIn: 0, obsOut: 0, pose: 0, distance: 0,
    vision: 0, sight: 0, flips: 0, stateDiffs: 0, coverageDiffs: 0, senses: 0, problems: [] };
}

// Paused /sense previews recorded right after step k: same frame, no state change.
function checkSenses(report, k, session, fixture, tolerance = EXACT) {
  let trouble = 0;
  for (const probe of fixture.senses ?? []) {
    if (probe.after !== k) continue;
    const frame = session.sense(probe.input.target, probe.input.sight_pose);
    report.senses += 1;
    const diffs = discreteDiffs(frame, probe.frame);
    const numbers = numericDiffs(frame, probe.frame);
    report.flips += diffs.length;
    diffs.forEach((d) => note(report, `${k} sense`, d));
    for (const key of ['pose', 'distance', 'vision', 'sight']) report[key] = Math.max(report[key], numbers[key]);
    trouble += diffs.length + (numbers.pose > tolerance.pose ? 1 : 0);
  }
  return trouble;
}

function note(report, step, text) {
  if (report.problems.length < 12) report.problems.push(`step ${step}: ${text}`);
}

function startSession(fixture, world, config, policy) {
  const reset = fixture.reset;
  return new JunkyardBrainSession({ policy, world, contact: config.contact,
    sightVersion: config.eyeVision.version, contactVersion: config.contact.version,
    position: reset.position, yaw: reset.yaw, target: reset.target,
    playerCollision: reset.player_collision === true, sightPose: reset.sight_mode === 'eye' ? reset.sight_pose : null });
}

// Check the reset frame and first observation.
function checkInitial(report, session, fixture) {
  const initialObs = decodeArray(fixture.initial.obs);
  report.obsOut = Math.max(report.obsOut, maxAbs(session.obs, initialObs));
  const frame = session.snapshot();
  const diffs = discreteDiffs(frame, fixture.initial.frame);
  report.flips += diffs.length;
  diffs.forEach((d) => note(report, 'reset', d));
  const numbers = numericDiffs(frame, fixture.initial.frame);
  report.pose = Math.max(report.pose, numbers.pose);
  const cleared = [];
  session.env.coverageCleared.forEach((v, i) => { if (v) cleared.push(i); });
  if (!sameList(cleared, fixture.initial.coverage)) {
    report.coverageDiffs += 1;
    note(report, 'reset', 'initial coverage differs');
  }
}

// Compare one step. Returns { any, discrete }: how many things disagreed at all
// (0 = still in lockstep) and how many were yes/no facts (collision, sight,
// memory counters, coverage cells). `numbersOnly` stops noting drift once a
// free run has already left numeric lockstep.
const CONTINUOUS_STATE = /^(position|yaw|previous_action|last_seen_target)/;

function addStep(report, k, session, frame, step, arrays, seen, tolerance = EXACT, quiet = false) {
  const say = (text) => { if (!quiet) note(report, k, text); };
  const a = seen ? maxAbs(seen, arrays.obs_in.subarray(k * 34, k * 34 + 34)) : 0;
  const b = maxAbs(session.obs, arrays.obs_out.subarray(k * 34, k * 34 + 34));
  report.obsIn = Math.max(report.obsIn, a);
  report.obsOut = Math.max(report.obsOut, b);
  if (a >= tolerance.obs) say(`obs fed to the policy differs by ${a}`);
  if (b >= tolerance.obs) say(`obs after the step differs by ${b}`);
  const diffs = discreteDiffs(frame, step.frame);
  report.flips += diffs.length;
  diffs.forEach((d) => note(report, k, d));
  const numbers = numericDiffs(frame, step.frame);
  for (const key of ['pose', 'distance', 'vision', 'sight']) report[key] = Math.max(report[key], numbers[key]);
  const poseBad = numbers.pose > tolerance.pose;
  if (poseBad) say(`pose differs by ${numbers.pose}`);
  const states = stateDiffs(session.env, step.state, tolerance);
  const discreteStates = states.filter((d) => !CONTINUOUS_STATE.test(d));
  report.stateDiffs += states.length;
  states.forEach((d) => (CONTINUOUS_STATE.test(d) ? say(d) : note(report, k, d)));
  const coverageBad = !sameList(session.env.coverageNewCells, step.coverage_new);
  if (coverageBad) {
    report.coverageDiffs += 1;
    note(report, k, `coverage cells js ${session.env.coverageNewCells.length} vs py ${step.coverage_new.length}`);
  }
  const discrete = diffs.length + discreteStates.length + (coverageBad ? 1 : 0);
  return { discrete, any: discrete + (states.length - discreteStates.length) + (poseBad ? 1 : 0)
    + (b >= tolerance.obs || a >= tolerance.obs ? 1 : 0) };
}

// --- Teacher forcing: copy Python's state in before every single step ---------------

export async function teacherForced(fixture, world, config) {
  const arrays = fixtureArrays(fixture);
  const policy = new ReplayPolicy(arrays.action);
  const session = startSession(fixture, world, config, policy);
  const report = newReport(fixture);
  checkInitial(report, session, fixture);
  const cleared = new Uint8Array(session.env.coverageCleared.length);
  for (const c of fixture.initial.coverage) cleared[c] = 1;
  let previousObs = decodeArray(fixture.initial.obs);
  let previousState = fixture.initial.state;
  let previousPose = fixture.reset.sight_pose ?? null;
  const started = performance.now();
  for (let k = 0; k < fixture.steps.length; k += 1) {
    const step = fixture.steps[k];
    session.env.setState(previousState, cleared);
    session.env.sightPose = previousPose;
    session.obs = previousObs;
    policy.index = k;
    const frame = await session.step(step.input.target, step.input.sight_pose);
    addStep(report, k, session, frame, step, arrays, policy.seen);
    if (policy.episodeStart !== step.episode_start) {
      report.flips += 1;
      note(report, k, 'episode_start differs');
    }
    for (const c of step.coverage_new) cleared[c] = 1;
    previousObs = arrays.obs_out.subarray(k * 34, k * 34 + 34);
    previousState = step.state;
    previousPose = step.input.sight_pose;
    checkSenses(report, k, session, fixture);
  }
  report.msPerStep = (performance.now() - started) / Math.max(1, fixture.steps.length);
  return report;
}

// --- Free running: the JS env keeps its own state from the reset onwards ------------

// `policy`: null replays the recorded actions (tests the environment alone,
// which must stay bit-identical); otherwise e.g. an OnnxPolicy, whose ~1e-6
// action differences nudge the pose, so pass a looser `tolerance` then.
// report.lockstep: steps before anything disagreed beyond `tolerance`;
// report.untilFlip: steps before the first yes/no disagreement (collision,
// sighting, memory, coverage), which is where the two runs truly part ways.
export async function freeRun(fixture, world, config, policy = null, tolerance = EXACT) {
  const arrays = fixtureArrays(fixture);
  const actor = policy ?? new ReplayPolicy(arrays.action);
  const seen = { obs: null };
  const watched = { act: async (obs, memory, start) => { seen.obs = Float32Array.from(obs); return actor.act(obs, memory, start); } };
  const session = startSession(fixture, world, config, watched);
  const report = newReport(fixture);
  checkInitial(report, session, fixture);
  report.lockstep = 0;
  report.untilFlip = 0;
  report.maxAction = 0;
  const started = performance.now();
  let ran = 0, inLockstep = true;
  for (let k = 0; k < fixture.steps.length; k += 1) {
    const step = fixture.steps[k];
    const frame = await session.step(step.input.target, step.input.sight_pose);
    ran += 1;
    const result = addStep(report, k, session, frame, step, arrays, seen.obs, tolerance, !inLockstep);
    const senseTrouble = checkSenses(report, k, session, fixture, inLockstep ? tolerance : { pose: Infinity, obs: Infinity });
    if (inLockstep) report.maxAction = Math.max(report.maxAction, Math.abs(frame.throttle - step.frame.throttle), Math.abs(frame.turn - step.frame.turn));
    if (result.discrete || (senseTrouble && inLockstep)) break;
    if (result.any || senseTrouble) inLockstep = false;
    if (inLockstep) report.lockstep = k + 1;
    report.untilFlip = k + 1;
  }
  report.msPerStep = (performance.now() - started) / Math.max(1, ran);
  return report;
}
