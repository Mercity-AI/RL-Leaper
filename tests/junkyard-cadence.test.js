import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { JunkyardBrain, LEAPER_STEPS_PER_SECOND } from '../src/simulation/JunkyardBrain.js';
import { FixedStep } from '../src/core/GameLoop.js';

// The real brain client with a fake server. replyFrames = how many rendered
// frames each reply takes to arrive (0 = instant).
function brainWithFakeServer() {
  globalThis.document = { hidden: false };
  const playtest = {
    world: { width: 5.5 }, walking: true, message: {}, brainLabel: {},
    target: { mesh: { position: new THREE.Vector3(0, 0, 10) } },
    simulation: { state: { position: new THREE.Vector3(), yaw: 0 }, updateExternal() {} },
  };
  const brain = new JunkyardBrain(playtest);
  const server = { steps: 0, waiting: [] };
  const frame = () => ({ x: 0, z: 0, yaw: 0, distance: 10, step: server.steps, collision: false,
    model_step: 7757824, policy_sha256: 'test', token: 'test' });
  brain.request = (path) => {
    if (path === 'reset') return Promise.resolve(frame());
    server.steps += 1;
    return new Promise((resolve) => server.waiting.push(resolve));
  };
  return { brain, playtest, server, frame };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

// Run `seconds` of game time at a fixed frame time; replies arrive after
// `replyFrames` frames. Returns brain moves per second.
async function stepsPerSecond(dt, { seconds = 10, replyFrames = 0 } = {}) {
  const { brain, server, frame } = brainWithFakeServer();
  await brain.reset();
  brain.start();
  const pending = [];
  const frames = Math.round(seconds / dt);
  for (let i = 0; i < frames; i += 1) {
    brain.update(dt);
    // Replies that were asked for this frame arrive replyFrames frames later.
    for (const resolve of server.waiting.splice(0)) pending.push({ resolve, due: i + replyFrames });
    for (const reply of pending.filter(({ due }) => due <= i)) {
      pending.splice(pending.indexOf(reply), 1);
      reply.resolve(frame());
    }
    await flush();
  }
  return server.steps / seconds;
}

test('the Leaper takes 10 brain steps per second at any frame rate (review 5.13)', async () => {
  assert.equal(LEAPER_STEPS_PER_SECOND, 10);
  for (const fps of [20, 30, 60, 144]) {
    const rate = await stepsPerSecond(1 / fps);
    assert.ok(Math.abs(rate - 10) <= 0.1, `${fps} fps, instant replies: ${rate.toFixed(2)} steps/s`);
  }
});

test('a late reply delays a move but the lost time is made up (one move of debt at most)', async () => {
  // About 40-50 ms replies at 60 and 144 fps.
  for (const [fps, replyFrames] of [[60, 3], [144, 6]]) {
    const rate = await stepsPerSecond(1 / fps, { replyFrames });
    assert.ok(Math.abs(rate - 10) <= 0.1, `${fps} fps, ${replyFrames}-frame replies: ${rate.toFixed(2)} steps/s`);
  }
  // A server slower than the step rate can't be outrun, but it never bursts either.
  const slow = await stepsPerSecond(1 / 60, { replyFrames: 9 });
  assert.ok(slow <= 10 && slow >= 5.9, `150 ms replies: ${slow.toFixed(2)} steps/s`);
});

test('the brain clock stops with the run and does not bank time while stopped', async () => {
  const { brain, server } = brainWithFakeServer();
  await brain.reset();
  brain.update(5);
  assert.equal(server.steps, 0, 'no moves while the run is stopped');
  brain.start();
  brain.update(1 / 60);
  assert.equal(server.steps, 0, 'starting the run does not cash in the stopped time');
});

test('FixedStep add/take keeps the remainder and caps waiting time', () => {
  const clock = new FixedStep(0.1, { maxSteps: 2 });
  for (let i = 0; i < 5; i += 1) clock.add(1 / 60);
  assert.equal(clock.take(), false);
  clock.add(1 / 60);
  assert.equal(clock.take(), true, 'six 1/60 s frames make one 0.1 s step despite rounding');
  clock.add(1);
  assert.ok(Math.abs(clock.remainder - 0.2) < 1e-12, 'at most two steps of time wait');
  assert.equal(clock.take(), true);
  assert.equal(clock.take(), true);
  assert.equal(clock.take(), false);
});
