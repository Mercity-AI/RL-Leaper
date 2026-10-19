// Smooth Leaper motion between brain replies (review fix 5.14): the drawn body
// walks along the brain's poses at the brain's own pace instead of chasing
// each reply, so there is no 10 Hz surge and no stop-go lurch when crippled.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SnapshotPlayout } from '../src/actors/leaper/SnapshotPlayout.js';
import { followPose, LEAPER_STEPS_PER_SECOND } from '../src/simulation/JunkyardBrain.js';
import { FixedStep } from '../src/core/GameLoop.js';
import { shortestAngle, wrapAngle } from '../src/core/angles.js';

const STEP = 0.375; // brain units moved per full-throttle brain step
const DEGREE = Math.PI / 180;

// A small seeded random source, so every run sees the same reply delays.
function seeded(seed) {
  return () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
}

// The game's real cadence: the brain clock runs at dt x mobility, one request at
// a time, and each reply lands `delay` seconds later (seen on the next frame).
// turnPerStep: the brain's heading change per step. Returns the drawn poses.
function drive({ fps, mobility = 1, seconds = 8, maxDelay = 0.045, turnPerStep = 2 * DEGREE, render }) {
  const dt = 1 / fps;
  const random = seeded(17);
  const cadence = new FixedStep(1 / LEAPER_STEPS_PER_SECOND, { maxSteps: 2 });
  const brain = { x: 0, z: 0, yaw: 0 };
  let inFlight = null;
  const drawn = [];
  for (let frame = 0, time = 0; frame < seconds * fps; frame += 1, time += dt) {
    // A reply that has arrived by this frame is seen now.
    let reply = null;
    if (inFlight && inFlight.due <= time) {
      reply = inFlight.pose;
      inFlight = null;
    }
    // The brain clock (slowed by lost legs) asks for the next move when free.
    cadence.add(dt * mobility);
    if (!inFlight && cadence.take()) {
      brain.yaw = wrapAngle(brain.yaw + turnPerStep);
      brain.x += Math.sin(brain.yaw) * STEP;
      brain.z += Math.cos(brain.yaw) * STEP;
      inFlight = { pose: { ...brain }, due: time + 0.002 + random() * maxDelay };
    }
    drawn.push({ time, ...render(reply, dt, mobility) });
  }
  return drawn;
}

// The new playback.
function playout() {
  const playback = new SnapshotPlayout();
  return (reply, dt, mobility) => {
    if (reply) playback.push(reply);
    playback.advance(dt, 1 / (LEAPER_STEPS_PER_SECOND * mobility));
    return playback.sample();
  };
}

// The old one: ease toward the latest reply (kept for comparison).
function oldFollow() {
  let pose = { x: 0, z: 0, yaw: 0 }, target = { ...pose };
  return (reply, dt) => {
    if (reply) target = reply;
    pose = followPose(pose, target, dt);
    return pose;
  };
}

// Drawn speed per frame after the first second (warm-up).
function speeds(drawn) {
  const out = [];
  for (let i = 1; i < drawn.length; i += 1) {
    if (drawn[i].time < 1) continue;
    const a = drawn[i - 1], b = drawn[i];
    out.push(Math.hypot(b.x - a.x, b.z - a.z) / (b.time - a.time));
  }
  return out;
}

function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  return { median, max: sorted.at(-1), min: sorted[0], stalled: values.filter((v) => v < 0.2 * median).length / values.length };
}

test('the drawn Leaper keeps an even walking speed at any frame rate and with late replies', () => {
  for (const fps of [30, 60, 144]) {
    for (const mobility of [1, 0.46, 0.28]) {
      const s = stats(speeds(drive({ fps, mobility, render: playout() })));
      const expected = STEP * LEAPER_STEPS_PER_SECOND * mobility;
      const label = `${fps} fps, mobility ${mobility}: speed ${s.min.toFixed(2)}..${s.max.toFixed(2)} (median ${s.median.toFixed(2)}, brain ${expected.toFixed(2)})`;
      assert.ok(Math.abs(s.median - expected) / expected < 0.06, `${label}: the brain's own pace`);
      assert.ok(s.max / s.median < 1.3, `${label}: no surge`);
      assert.ok(s.min / s.median > 0.7, `${label}: never stops between replies`);
      assert.equal(s.stalled, 0, `${label}: no stalled frames`);
    }
  }
});

test('the old chase-the-reply filter surged and lurched (what this replaces)', () => {
  const healthy = stats(speeds(drive({ fps: 60, render: oldFollow() })));
  const crippled = stats(speeds(drive({ fps: 60, mobility: 0.28, render: oldFollow() })));
  const smooth = stats(speeds(drive({ fps: 60, mobility: 0.28, render: playout() })));
  assert.ok(healthy.max / healthy.median > 1.6, `old filter at full health surges (${(healthy.max / healthy.median).toFixed(2)}x)`);
  assert.ok(crippled.stalled > 0.2, `old filter with legs lost stalls ${(crippled.stalled * 100).toFixed(0)}% of frames`);
  assert.equal(smooth.stalled, 0, 'the playback never does');
});

test('headings take the short way round through many full turns (no whip)', () => {
  // The brain turns 9 degrees every step (its maximum) for 12 s: about 3 turns.
  const drawn = drive({ fps: 60, seconds: 12, turnPerStep: 9 * DEGREE, render: playout() });
  let worst = 0;
  for (let i = 1; i < drawn.length; i += 1) worst = Math.max(worst, Math.abs(shortestAngle(drawn[i - 1].yaw, drawn[i].yaw)));
  // 90 degrees per second at most, times the fastest catch-up pace, per 1/60 s frame.
  assert.ok(worst < 90 * DEGREE * 2 / 60 + 1e-9, `largest turn in one frame ${(worst / DEGREE).toFixed(2)} degrees`);
  assert.ok(drawn.every(({ yaw }) => Math.abs(yaw) <= Math.PI), 'kept within one turn');
});

test('losing a leg mid-walk slows the body to the limp without stopping dead or surging', () => {
  // The brain's own pace halves the moment a leg goes (its step clock slows);
  // the drawn body eases from one walking speed to the other.
  const playback = new SnapshotPlayout();
  const brain = { x: 0, z: 0, yaw: 0 };
  let mobility = 1, clock = 0, previous = playback.sample();
  const perFrame = [];
  for (let frame = 0; frame < 600; frame += 1) {
    if (frame === 300) mobility = 0.46;
    clock += (1 / 60) * mobility;
    if (clock >= 0.1) {
      clock -= 0.1;
      brain.z += STEP;
      playback.push(brain);
    }
    playback.advance(1 / 60, 0.1 / mobility);
    const now = playback.sample();
    perFrame.push((now.z - previous.z) * 60);
    previous = now;
  }
  const full = STEP * 10, limp = full * 0.46;
  const change = perFrame.slice(300, 360);
  assert.ok(Math.min(...change) > 0.2 * limp, `never stops dead (slowest ${Math.min(...change).toFixed(2)} units/s)`);
  assert.ok(Math.max(...change) < 1.1 * full, `never surges (fastest ${Math.max(...change).toFixed(2)} units/s)`);
  const settled = stats(perFrame.slice(420));
  assert.ok(Math.abs(settled.median - limp) / limp < 0.05 && settled.max / settled.median < 1.2,
    `one second later it limps evenly at the new pace (${settled.min.toFixed(2)}..${settled.max.toFixed(2)})`);
});

test('a jump the brain could never make in one step is snapped to; a standstill adds nothing', () => {
  const playback = new SnapshotPlayout();
  playback.reset({ x: 1, z: 2, yaw: 0.5 });
  assert.equal(playback.push({ x: 1, z: 2, yaw: 0.5 }), false, 'same pose: nothing to play');
  playback.push({ x: 1.3, z: 2, yaw: 0.5 });
  assert.equal(playback.pending, 1);
  playback.push({ x: 20, z: -4, yaw: 2 });
  assert.equal(playback.pending, 0, 'a reset or refused sync far away: snapped');
  assert.deepEqual(playback.sample(), { x: 20, z: -4, yaw: 2 });
  // Replies piling up after a long stall are skipped down to maxLag.
  for (let i = 1; i <= 10; i += 1) playback.push({ x: 20 + i * 0.3, z: -4, yaw: 2 });
  assert.ok(playback.pending <= playback.config.maxLag + 1e-9);
});
