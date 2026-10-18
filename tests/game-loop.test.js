import test from 'node:test';
import assert from 'node:assert/strict';
import { GameLoop, FixedStep, clampDelta } from '../src/core/GameLoop.js';

// A fake animation-frame clock: frames run only when the test calls next(time).
function fakeFrames() {
  let pending = null;
  return {
    requestFrame: (callback) => { pending = callback; return 1; },
    cancelFrame: () => { pending = null; },
    next(time) { const callback = pending; pending = null; callback?.(time); },
  };
}

test('clampDelta keeps frame time inside [0, cap]', () => {
  assert.equal(clampDelta(-0.004, 0.1), 0, 'negative first frame becomes 0');
  assert.equal(clampDelta(Number.NaN, 0.1), 0);
  assert.equal(clampDelta(0.016, 0.1), 0.016);
  assert.equal(clampDelta(2.5, 0.1), 0.1, 'a tab switch is capped');
});

test('GameLoop runs the named phases in order every frame', () => {
  const calls = [];
  const mode = {
    input: (dt) => calls.push(['input', dt]),
    update: (dt) => calls.push(['update', dt]),
    lateUpdate: (dt) => calls.push(['lateUpdate', dt]),
    beforeRender: () => calls.push(['beforeRender']),
    afterRender: () => calls.push(['afterRender']),
  };
  const frames = fakeFrames();
  const loop = new GameLoop({ mode, render: () => calls.push(['render']), maxDelta: 0.1, ...frames });
  loop.start();
  frames.next(1000);
  assert.deepEqual(calls.map(([name]) => name),
    ['input', 'update', 'lateUpdate', 'beforeRender', 'render', 'afterRender']);
  assert.equal(calls[0][1], 0, 'the first frame always has dt = 0');
  calls.length = 0;
  frames.next(1016);
  assert.ok(Math.abs(calls[1][1] - 0.016) < 1e-12);
  calls.length = 0;
  // A timestamp earlier than the last one (seen right after loading) never runs backwards.
  frames.next(1010);
  assert.equal(calls[1][1], 0);
  calls.length = 0;
  frames.next(5000);
  assert.equal(calls[1][1], 0.1, 'long gaps are capped by the mode cap');
  loop.stop();
  frames.next(6000);
  assert.equal(calls.length, 6, 'no frames after stop');
});

test('GameLoop always runs afterRender, and keeps going after a phase throws', () => {
  const calls = [];
  const frames = fakeFrames();
  let fail = true;
  const loop = new GameLoop({
    mode: { afterRender: () => calls.push('afterRender') },
    render: () => { if (fail) throw new Error('render failed'); calls.push('render'); },
    ...frames,
  });
  loop.start();
  assert.throws(() => frames.next(0), /render failed/);
  assert.deepEqual(calls, ['afterRender'], 'visibility tricks are still undone');
  fail = false;
  frames.next(16);
  assert.deepEqual(calls, ['afterRender', 'render', 'afterRender'], 'the next frame was already requested');
});

test('FixedStep carries leftover time and keeps a steady rate at any frame rate', () => {
  for (const fps of [30, 60, 120, 144]) {
    const clock = new FixedStep(1 / 10);
    let ticks = 0;
    for (let frame = 0; frame < fps * 10; frame += 1) ticks += clock.advance(1 / fps);
    assert.ok(Math.abs(ticks - 100) <= 1, `${fps} fps gave ${ticks} ticks in 10 s`);
  }
  const clock = new FixedStep(0.1);
  const seen = [];
  assert.equal(clock.advance(0.25, (step, index) => seen.push([step, index])), 2);
  assert.deepEqual(seen, [[0.1, 0], [0.1, 1]]);
  assert.ok(Math.abs(clock.alpha - 0.5) < 1e-9, 'half-way into the next step');
  assert.equal(clock.advance(0.05), 1, 'the carried remainder completes the next tick');
});

test('FixedStep caps catch-up after a hitch and ignores negative time', () => {
  const clock = new FixedStep(0.1, { maxSteps: 3 });
  assert.equal(clock.advance(1.05), 3, 'at most maxSteps ticks in one frame');
  assert.ok(clock.remainder < 0.1, 'the dropped debt is not replayed later');
  assert.equal(clock.advance(0), 0);
  assert.equal(clock.advance(-5), 0);
  clock.reset();
  assert.equal(clock.alpha, 0);
  assert.throws(() => new FixedStep(0), /positive/);
});
