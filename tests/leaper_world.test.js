import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AGENT_RADIUS,
  TARGET,
  TARGET_RADIUS,
  buildObservation,
  stepWorld,
} from '../src/brain/leaperWorld.js';
import {
  PLAYER_SPEED,
  initialPlayerPosition,
  movePlayerTarget,
} from '../src/brain/playerTarget.js';

const BASE_STATE = {
  x: 0,
  z: 0,
  yaw: 0,
  prevThrottle: 0,
  prevTurn: 0,
  lastCollision: 0,
  prevDistance: 1,
  stuckSteps: 0,
  obstacles: [],
};

test('player target starts at the trained target location', () => {
  assert.deepEqual(initialPlayerPosition(), TARGET);
});

test('W moves the player at exactly 6 m/s', () => {
  const next = movePlayerTarget([0, 0], { forward: 1, side: 0 }, 0, 0.5, []);
  assert.equal(next.x, 0);
  assert.equal(next.z, PLAYER_SPEED * 0.5);
});

test('diagonal input is normalized and cannot exceed 6 m/s', () => {
  const next = movePlayerTarget([0, 0], { forward: 1, side: 1 }, 0, 1, []);
  assert.ok(Math.abs(Math.hypot(next.x, next.z) - PLAYER_SPEED) < 1e-10);
});

test('player target cannot move through an obstacle', () => {
  const next = movePlayerTarget([0, 0], { forward: 1, side: 0 }, 0, 1, [[0, 4, 2]]);
  assert.deepEqual([next.x, next.z], [0, 0]);
});

test('observation points toward the live target', () => {
  const obs = buildObservation({ ...BASE_STATE, target: [3, 4] });
  assert.ok(Math.abs(obs[2] - 0.6) < 1e-6);
  assert.ok(Math.abs(obs[3] - 0.8) < 1e-6);
});

test('catch detection uses the live target position', () => {
  const target = [10, 0];
  const state = {
    ...BASE_STATE,
    x: target[0] - TARGET_RADIUS - AGENT_RADIUS + 0.01,
    target,
    prevDistance: TARGET_RADIUS + AGENT_RADIUS,
  };
  const result = stepWorld(state, 0, 0);
  assert.equal(result.reached, true);
});
