import test from 'node:test';
import assert from 'node:assert/strict';
import { AdaptiveResolution, FRAME_TARGET } from '../src/core/AdaptiveResolution.js';

function run(adaptive, fps, seconds, clock) {
  for (let t = 0; t < seconds; t += 1 / fps) adaptive.frame((clock.now += 1 / fps));
}

test('a slow frame rate lowers the resolution step by step, never below the floor', () => {
  const resolution = { scale: 1, set(scale) { this.scale = scale; } };
  const adaptive = new AdaptiveResolution({ resolution });
  const clock = { now: 0 };
  run(adaptive, 40, 3, clock);
  assert.ok(resolution.scale < 1 && resolution.scale >= FRAME_TARGET.minScale, `scale ${resolution.scale}`);
  run(adaptive, 40, 60, clock);
  assert.equal(resolution.scale, FRAME_TARGET.minScale);
});

test('a steady 60 fps tries the resolution back up after the lockout', () => {
  const resolution = { scale: 0.7, set(scale) { this.scale = scale; } };
  const adaptive = new AdaptiveResolution({ resolution });
  const clock = { now: 0 };
  run(adaptive, 60, 3, clock);
  assert.equal(resolution.scale, 0.7, 'not straight away');
  run(adaptive, 60, 10, clock);
  assert.ok(resolution.scale > 0.7);
});

test('switched off, the full resolution comes back', () => {
  const resolution = { scale: 0.6, set(scale) { this.scale = scale; } };
  const adaptive = new AdaptiveResolution({ resolution, enabled: () => false });
  run(adaptive, 30, 3, { now: 0 });
  assert.equal(resolution.scale, 1);
});

test('the settled resolution is remembered for the next load', () => {
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  const first = { scale: 1, set(scale) { this.scale = scale; } };
  run(new AdaptiveResolution({ resolution: first, storage }), 40, 3, { now: 0 });
  const next = { scale: 1, set(scale) { this.scale = scale; } };
  new AdaptiveResolution({ resolution: next, storage });
  assert.equal(next.scale, first.scale);
  assert.ok(next.scale < 1);
});
