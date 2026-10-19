import test from 'node:test';
import assert from 'node:assert/strict';
import { wantsDevTools } from '../src/debug/devTools.js';
import { NO_TIMER, PhaseTimer, perfText, rendererCounts } from '../src/debug/PhaseTimer.js';

// The developer tools' gate (src/debug/devTools.js) and the perf overlay's
// numbers (src/debug/PhaseTimer.js). The panel itself is checked in a real
// browser (tests/game-flow.browser.mjs).

test('the developer tools come with ?dev or on the dev server, and ?dev=0 hides them', () => {
  assert.equal(wantsDevTools({ search: '', dev: false }), false, 'a player on the published game');
  assert.equal(wantsDevTools({ search: '?debug', dev: false }), false, '?debug alone is not the tools');
  assert.equal(wantsDevTools({ search: '?dev', dev: false }), true);
  assert.equal(wantsDevTools({ search: '?map=junkyard&dev=1', dev: false }), true);
  assert.equal(wantsDevTools({ search: '', dev: true }), true, 'pnpm dev');
  for (const off of ['0', 'false', 'off', 'NO']) assert.equal(wantsDevTools({ search: `?dev=${off}`, dev: true }), false, off);
});

test('frame and phase timings: averages, 95th percentile and frames per second', () => {
  let clock = 0;
  const timer = new PhaseTimer({ window: 10, clock: () => clock });
  for (let frame = 0; frame < 12; frame += 1) {
    timer.frame(clock);
    const start = timer.begin();
    clock += frame === 11 ? 4 : 2;
    timer.end('update', start);
    clock += 14;
  }
  const stats = timer.stats();
  assert.equal(stats.frameMs, 16, 'ten frames of 16 ms each (the window keeps the last ten)');
  assert.equal(Math.round(stats.fps), 63);
  assert.equal(stats.p95Ms, 16);
  assert.equal(stats.phases.update, 2.2, 'the last ten update phases: nine of 2 ms and one of 4 ms');
  assert.deepEqual(new PhaseTimer().stats(), { fps: 0, frameMs: 0, p95Ms: 0, phases: {} });
  // Players pay nothing: the stand-in does no work.
  assert.equal(NO_TIMER.begin(), 0);
  assert.equal(NO_TIMER.end('update', 0), undefined);
});

test('the overlay reads the renderer\'s counters and prints three short lines', () => {
  const counts = rendererCounts({ render: { calls: 312, triangles: 410400 }, memory: { geometries: 220, textures: 41 }, programs: new Array(28) });
  assert.deepEqual(counts, { calls: 312, triangles: 410400, geometries: 220, textures: 41, programs: 28 });
  assert.deepEqual(rendererCounts(undefined), { calls: 0, triangles: 0, geometries: 0, textures: 0, programs: 0 });
  const lines = perfText({ fps: 59.6, frameMs: 16.78, p95Ms: 21.04, phases: { input: 0.31, update: 4.1, late: 1.25, render: 9.84 } }, counts).split('\n');
  assert.deepEqual(lines, [
    '60 fps · 16.8 ms (95% under 21.0)',
    'input 0.3 · update 4.1 · late 1.3 · render 9.8 ms',
    'draws 312 · tris 410k · geo 220 · tex 41 · shaders 28',
  ]);
});
