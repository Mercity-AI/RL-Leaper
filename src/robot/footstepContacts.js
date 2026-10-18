import * as THREE from 'three';

// Measure each authored foot's low contact interval, once at model load.
// This also handles asymmetric clips and reverse playback without a timer.
export function measureFootContacts(model, mixer, actions) {
  const feet = ['DEF-toe.L', 'DEF-toe.R'].map(name =>
    model.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(name)));
  const result = {}, point = new THREE.Vector3(), count = 120;
  for (const action of Object.values(actions)) action.setEffectiveWeight(0);
  for (const [name, action] of Object.entries(actions)) {
    if (name.includes('Idle')) continue;
    action.setEffectiveWeight(1);
    const heights = feet.map(() => []), local = feet.map(() => []), duration = action.getClip().duration;
    for (let i = 0; i < count; i++) {
      action.time = duration * i / count;
      mixer.update(0);
      model.updateMatrixWorld(true);
      feet.forEach((foot, f) => {
        heights[f].push(foot.getWorldPosition(point).y);
        local[f].push(model.worldToLocal(point.clone()));
      });
    }
    // How far the lower of the two feet is above its lowest point, per sample. A
    // run's single fixed floor offset leaves both boots in the air for much of
    // the stride; subtracting this keeps the lower boot on the floor.
    const lowest = heights[0].map((y, i) => Math.min(y, heights[1][i]));
    const floor = Math.min(...lowest);
    const lift = softened(flightHeld(lowest.map(y => y - floor)));
    const forward = [], reverse = [], stanceSpeeds = [];
    heights.forEach((values, f) => {
      const min = Math.min(...values), max = Math.max(...values);
      const contact = values.map(y => y <= min + (max - min) * 0.04);
      let longest = null;
      for (let i = 0; i < count; i++) {
        if (!contact[i] || contact[(i + count - 1) % count]) continue;
        let length = 1;
        while (length < count && contact[(i + length) % count]) length++;
        if (!longest || length > longest.length) longest = { start: i, length };
      }
      // Toe roll can briefly touch the low band twice in a strafe. Use the
      // sustained planted interval, not those tiny secondary dips.
      if (longest) {
        forward.push(longest.start / count * duration);
        reverse.push(((longest.start + longest.length - 1) % count) / count * duration);
        // How fast the planted boot sweeps along the ground (model units per clip
        // second), skipping the touchdown and lift-off samples.
        for (let k = 1; k < longest.length - 2; k++) {
          const a = local[f][(longest.start + k) % count], b = local[f][(longest.start + k + 1) % count];
          stanceSpeeds.push(Math.hypot(b.x - a.x, b.z - a.z) * count / duration);
        }
      }
    });
    stanceSpeeds.sort((a, b) => a - b);
    const stanceSpeed = stanceSpeeds.length ? stanceSpeeds[Math.floor(stanceSpeeds.length / 2)] : 0;
    result[name] = { forward, reverse, duration, lift, stanceSpeed };
    action.time = 0;
    action.setEffectiveWeight(0);
  }
  actions.Idle.setEffectiveWeight(1);
  mixer.update(0);
  return result;
}

// Share of the clip's largest lift below which a boot counts as on the floor.
const FLIGHT_LIFT = 0.15;

// While both boots are off the floor (a run's flight), pulling the body down
// to the floor makes it drop 4 times a second, which reads as screen shake.
// Keep grounding while a boot is down; across a flight, ease between its edges.
function flightHeld(lift) {
  const count = lift.length, limit = Math.max(...lift) * FLIGHT_LIFT;
  const grounded = lift.map(value => value <= limit);
  if (grounded.every(Boolean) || !grounded.some(Boolean)) return lift;
  return lift.map((value, i) => {
    if (grounded[i]) return value;
    let before = 1, after = 1;
    while (!grounded[(i - before + count) % count]) before++;
    while (!grounded[(i + after) % count]) after++;
    const a = lift[(i - before + count) % count], b = lift[(i + after) % count];
    return a + (b - a) * before / (before + after);
  });
}

// A boot touching down drops the lift by a few cm within one rendered frame,
// popping the body down. Spread it over a few frames (looping blur, ~1/30 cycle).
function softened(lift) {
  const count = lift.length, sigma = count / 30, reach = Math.ceil(sigma * 2.5);
  return lift.map((_, i) => {
    let sum = 0, total = 0;
    for (let k = -reach; k <= reach; k++) {
      const weight = Math.exp(-(k * k) / (2 * sigma * sigma));
      sum += lift[(i + k + count) % count] * weight;
      total += weight;
    }
    return sum / total;
  });
}

// Lower foot's height above the floor (model units) at a clip time, looping.
export function footLift(profile, time) {
  const lift = profile?.lift;
  if (!lift) return 0;
  const phase = ((time / profile.duration) % 1 + 1) % 1 * lift.length;
  const index = Math.floor(phase) % lift.length;
  const next = lift[(index + 1) % lift.length];
  return lift[index] + (next - lift[index]) * (phase - Math.floor(phase));
}

// A running jump's take-off and touchdown (clip seconds), and the Run clip time
// at which the landing boot is planted at the same spot under the body. Handing
// over to the run there means the planted boot never slides. null if the clip
// never leaves the ground. Measured once at load, in model space.
export function measureJumpLanding(model, mixer, actions, jumpAction, count = 120) {
  const feet = ['DEF-toe.L', 'DEF-toe.R'].map(name =>
    model.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(name)));
  const ground = 0.02; // model units a boot may sit above its lowest point and still count as down
  const weights = Object.values(actions).map(action => action.getEffectiveWeight());
  Object.values(actions).forEach(action => action.setEffectiveWeight(0));
  const sample = (action, duration) => Array.from({ length: count }, (_, i) => {
    action.time = duration * i / count;
    mixer.update(0);
    model.updateMatrixWorld(true);
    return feet.map(foot => model.worldToLocal(foot.getWorldPosition(new THREE.Vector3())));
  });
  const jumpDuration = jumpAction.getClip().duration;
  jumpAction.reset().setEffectiveWeight(1).play();
  const jump = sample(jumpAction, jumpDuration);
  jumpAction.stop();
  const run = actions.Run, runDuration = run.getClip().duration;
  run.setEffectiveWeight(1);
  const stride = sample(run, runDuration);
  run.setEffectiveWeight(0);
  Object.values(actions).forEach((action, i) => action.setEffectiveWeight(weights[i]));
  mixer.update(0);

  const lowest = jump.map(pair => Math.min(pair[0].y, pair[1].y));
  const floor = Math.min(...lowest);
  const liftoff = lowest.findIndex(y => y > floor + ground);
  const touchdown = liftoff < 0 ? -1 : lowest.findIndex((y, i) => i > liftoff && y <= floor + ground);
  if (touchdown < 0) return null;
  const foot = jump[touchdown][0].y <= jump[touchdown][1].y ? 0 : 1;
  const landingZ = jump[touchdown][foot].z;
  const runFloor = Math.min(...stride.map(pair => pair[foot].y));
  let best = 0;
  stride.forEach((pair, i) => {
    const planted = pair[foot].y <= runFloor + ground;
    const bestPlanted = stride[best][foot].y <= runFloor + ground;
    if (planted && (!bestPlanted || Math.abs(pair[foot].z - landingZ) < Math.abs(stride[best][foot].z - landingZ))) best = i;
  });
  // How fast the clip sweeps its planted boot back before take-off (model units
  // per clip second), to play the push-off at a speed that keeps the boot still.
  const sweeps = [];
  for (let i = 1; i < liftoff - 1; i++) {
    const f = jump[i][0].y <= jump[i][1].y ? 0 : 1, a = jump[i][f], b = jump[i + 1][f];
    sweeps.push(Math.hypot(b.x - a.x, b.z - a.z) * count / jumpDuration);
  }
  sweeps.sort((a, b) => a - b);
  return { liftoff: Math.max(liftoff, 0.5) / count * jumpDuration, touchdown: touchdown / count * jumpDuration,
    runTime: best / count * runDuration, takeoffSpeed: sweeps.length ? sweeps[Math.floor(sweeps.length / 2)] : 0 };
}

export function crossedFootContact(profile, time, elapsed) {
  if (!profile || !elapsed) return false;
  return (elapsed > 0 ? profile.forward : profile.reverse).some(phase => {
    const a = (time - phase) / profile.duration;
    const b = (time + elapsed - phase) / profile.duration;
    return elapsed > 0 ? Math.floor(b) > Math.floor(a) : Math.ceil(b) < Math.ceil(a);
  });
}
