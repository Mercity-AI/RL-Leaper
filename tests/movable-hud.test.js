import test from 'node:test';
import assert from 'node:assert/strict';
import { clampPanelPosition, enableMovableHud } from '../src/controls/MovableHud.js';

test('HUD panels remain reachable at viewport edges and after shrinking the window', () => {
  assert.deepEqual(clampPanelPosition(-20, -30, 120, 40, 800, 600), { x: 0, y: 0 });
  assert.deepEqual(clampPanelPosition(790, 590, 120, 40, 800, 600), { x: 680, y: 560 });
  assert.deepEqual(clampPanelPosition(600, 500, 400, 100, 320, 200), { x: 0, y: 100 });
});

test('double-tap drag saves placement without activating the button', async () => {
  const handlers = {};
  const storage = new Map();
  let clicks = 0;
  let captured = false;
  const element = {
    style: {}, classList: { add() {}, remove() {} }, title: '',
    addEventListener(name, callback) { handlers[name] = callback; },
    getBoundingClientRect() { return { left: 20, top: 20, width: 120, height: 40 }; },
    getClientRects() { return [1]; },
    setPointerCapture() { captured = true; }, hasPointerCapture() { return captured; },
    releasePointerCapture() { captured = false; },
    closest(selector) { return selector === 'button' ? this : null; },
    click() { clicks += 1; },
  };
  globalThis.document = { querySelector: (selector) => selector === '#cameraToggle' ? element : null };
  globalThis.window = { addEventListener() {} };
  globalThis.localStorage = { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value) };
  globalThis.innerWidth = 800;
  globalThis.innerHeight = 600;
  enableMovableHud();
  const event = (x, y) => ({ button: 0, pointerId: 1, clientX: x, clientY: y, detail: 1,
    target: element, preventDefault() {}, stopImmediatePropagation() {} });
  handlers.pointerdown(event(30, 30));
  handlers.pointerup(event(30, 30));
  handlers.click(event(30, 30));
  handlers.pointerdown(event(30, 30));
  handlers.pointermove(event(500, 350));
  handlers.pointerup(event(500, 350));
  handlers.click(event(500, 350));
  await new Promise(resolve => setTimeout(resolve, 370));
  assert.equal(clicks, 0);
  assert.equal(element.style.left, '490px');
  assert.equal(element.style.top, '340px');
  assert.equal(captured, false);
  const saved = JSON.parse([...storage.values()][0]);
  assert.equal(saved['#cameraToggle'].x, 490 / 800);
  handlers.click(event(500, 350));
  await new Promise(resolve => setTimeout(resolve, 370));
  assert.equal(clicks, 1, 'single clicks still activate buttons');
});
