import test from 'node:test';
import assert from 'node:assert/strict';
import { FpsCounter, median } from '../src/ui/FpsCounter.js';
import { normalizeSettings, SETTING_DEFAULTS } from '../src/ui/settings.js';

function counter() {
  const element = { dataset: {}, setAttribute() {}, remove() {}, hidden: false, textContent: '' };
  const doc = {
    getElementById: () => ({}),
    createElement: () => element,
  };
  return new FpsCounter({ doc, parent: { append() {} } });
}

// Half a second of even frames, each with the same work time.
function run(fps, frame, workMs) {
  for (let i = 0; i <= fps / 2 + 1; i += 1) {
    frame.work(workMs);
    frame.frame(i / fps);
  }
}

test('median takes the middle value, whatever the order', () => {
  assert.equal(median([]), 0);
  assert.equal(median([9, 1, 5]), 5);
  assert.equal(median([4, 1, 2, 8]), 3);
});

test('the counter shows only the rate unless the details are on', () => {
  const fps = counter();
  fps.show({ fps: true, details: false });
  run(60, fps, 4);
  assert.equal(fps.element.textContent, '60 FPS');
});

test('the details add the median frame time and CPU time', () => {
  const fps = counter();
  fps.show({ fps: true, details: true });
  run(60, fps, 4);
  assert.equal(fps.element.textContent, '60 FPS\nFRAME 16.7 ms\nCPU 4.0 ms');
});

test('the counter hides only when both switches are off', () => {
  const fps = counter();
  fps.show({ fps: false, details: true });
  assert.equal(fps.element.hidden, false);
  fps.show({ fps: false, details: false });
  assert.equal(fps.element.hidden, true);
});

test('performance stats start on and a saved "off" is kept', () => {
  assert.equal(SETTING_DEFAULTS.showPerf, true);
  assert.equal(normalizeSettings({ showPerf: false }).showPerf, false);
});
