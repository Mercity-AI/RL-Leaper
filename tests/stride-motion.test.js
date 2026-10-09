import test from 'node:test';
import assert from 'node:assert/strict';
import profiles from '../assets/characters/lola/stride-profiles.json' with { type: 'json' };
import { evenStrideElapsed, strideDistance } from '../src/robot/strideMotion.js';

test('run timing reduces speed surges without changing cycle distance or duration', () => {
  for (const weapon of ['basic', 'm416']) {
    const profile = profiles[weapon].Run;
    const dt = profile.duration / 240;
    let poseTime = 0;
    let distance = 0;
    const original = [];
    const retimed = [];
    for (let frame = 0; frame < 240; frame += 1) {
      const elapsed = evenStrideElapsed(profile, poseTime, dt);
      original.push(strideDistance(profile, frame * dt, dt) / dt);
      const step = strideDistance(profile, poseTime, elapsed);
      retimed.push(step / dt);
      distance += step;
      poseTime += elapsed;
    }
    assert.ok(Math.abs(poseTime - profile.duration) < 1e-8);
    assert.ok(Math.abs(distance - profile.distance) < 1e-6);
    assert.ok(Math.max(...retimed) < Math.max(...original) * 0.8, 'peak surge reduced by at least 20%');
    assert.ok(retimed.filter(v => v < 0.01).length < original.filter(v => v < 0.01).length,
      'shorter pauses during foot handoffs');
  }
});

test('retimed strides are reversible and independent of time-step size across loops', () => {
  const profile = profiles.m416.Run;
  for (const start of [-1.1, 0, 0.37, 0.99]) {
    for (const elapsed of [-2.7, -0.1, 0.1, 2.7]) {
      const end = start + evenStrideElapsed(profile, start, elapsed);
      assert.ok(Math.abs(end + evenStrideElapsed(profile, end, -elapsed) - start) < 1e-8);
      let split = start;
      for (let i = 0; i < 60; i += 1) split += evenStrideElapsed(profile, split, elapsed / 60);
      assert.ok(Math.abs(end - split) < 1e-8);
    }
  }
});
