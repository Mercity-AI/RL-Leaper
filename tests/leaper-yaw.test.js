import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { wrapAngle, shortestAngle, turnToward, lerpAngle } from '../src/core/angles.js';
import { JunkyardBrain, followPose } from '../src/simulation/JunkyardBrain.js';
import { LeaperSimulation } from '../src/simulation/LeaperSimulation.js';
import { createHexapod } from '../src/robot/createHexapod.js';

const DEGREE = Math.PI / 180;

test('angle helpers always take the short way and stay within one turn', () => {
  assert.ok(Math.abs(wrapAngle(5 * Math.PI) - Math.PI) < 1e-9 || Math.abs(wrapAngle(5 * Math.PI) + Math.PI) < 1e-9);
  assert.ok(Math.abs(wrapAngle(-7.5 * Math.PI) - 0.5 * Math.PI) < 1e-9);
  // Just across the +-PI seam: a tiny turn, not most of a circle.
  assert.ok(Math.abs(shortestAngle(Math.PI - 0.05, -Math.PI + 0.05) - 0.1) < 1e-9);
  // The case the old `%` formula got wrong: the rendered heading had wound up to
  // 1.5+ turns while the server heading is wrapped.
  const wound = 3.2 * Math.PI, server = wrapAngle(wound + 0.02);
  assert.ok(Math.abs(shortestAngle(wound, server) - 0.02) < 1e-9);
  const old = ((server - wound + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  assert.ok(Math.abs(old) > 1, 'the old formula really did whip here');
  assert.equal(turnToward(0, 3, 0.5), 0.5);
  assert.ok(Math.abs(turnToward(Math.PI - 0.1, -Math.PI + 0.1, 1) - (Math.PI + 0.1)) < 1e-9, 'clamped, short way');
  assert.ok(Math.abs(lerpAngle(Math.PI - 0.1, -Math.PI + 0.1, 0.5) - Math.PI) < 1e-9);
});

test('followPose eases toward the reply and keeps the heading wrapped', () => {
  const pose = followPose({ x: 0, z: 0, yaw: 3.2 * Math.PI }, { x: 1, z: -1, yaw: wrapAngle(3.2 * Math.PI + 0.2) }, 1 / 60);
  assert.ok(pose.x > 0 && pose.x < 1 && pose.z < 0 && pose.z > -1);
  assert.ok(Math.abs(pose.yaw) <= Math.PI);
  assert.ok(Math.abs(shortestAngle(3.2 * Math.PI, pose.yaw)) < 0.05, 'a small step the short way');
});

// The real brain client and the real Leaper animator, with a fake server that
// turns the Leaper 9 degrees per brain step (its maximum), wrapped to +-PI as the
// Python server does, and answers instantly.
function circlingLeaper() {
  globalThis.document = { hidden: false };
  const rig = createHexapod(new THREE.Scene());
  const cameraController = { eyePitch: 0, eyeYaw: 0, compensateForBodyTurn() {} };
  const simulation = new LeaperSimulation({ rig, world: { floorHeight: 0 }, cameraController, target: {}, input: {} });
  simulation.drivesPresentation = false;
  const playtest = {
    world: { width: 5.5 }, walking: true, message: {}, brainLabel: {},
    target: { mesh: { position: new THREE.Vector3(0, 0, 10) } }, simulation,
  };
  const brain = new JunkyardBrain(playtest);
  let serverYaw = 0, steps = 0;
  const reply = (extra = {}) => ({ x: 0, z: 0, yaw: serverYaw, distance: 10, step: steps, collision: false,
    model_step: 7757824, policy_sha256: 'test', token: 'test', target_visible: false, target_ever_seen: false, ...extra });
  brain.request = async (path) => {
    if (path === 'step') {
      steps += 1;
      serverYaw = wrapAngle(serverYaw + 9 * DEGREE);
    }
    return reply();
  };
  return { brain, simulation, steps: () => steps, serverYaw: () => serverYaw };
}

test('a Leaper circling for a minute at 60 fps never whips round (review 5.3)', async () => {
  const { brain, simulation, steps, serverYaw } = circlingLeaper();
  await brain.reset();
  brain.start();
  let previous = simulation.state.yaw, largest = 0;
  for (let frame = 0; frame < 60 * 60; frame += 1) {
    brain.update(1 / 60);
    await new Promise((resolve) => setImmediate(resolve));
    const yaw = simulation.state.yaw;
    largest = Math.max(largest, Math.abs(shortestAngle(previous, yaw)));
    assert.ok(Math.abs(yaw) <= Math.PI + 1e-9, 'the rendered heading stays within one turn');
    previous = yaw;
  }
  assert.ok(steps() > 400, `the Leaper really circled (${steps()} steps = ${(steps() * 9 / 360).toFixed(1)} turns)`);
  assert.ok(largest < 0.05, `largest per-frame turn ${largest.toFixed(4)} rad`);
  assert.ok(Math.abs(shortestAngle(simulation.state.yaw, serverYaw())) < 0.3, 'the rendered heading keeps up with the server');
});
