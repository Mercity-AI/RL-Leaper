import test from 'node:test';
import assert from 'node:assert/strict';
import { HudLayout, LAYOUT_KEY, MOVABLE_PIECES, clampPanelPosition, layoutKey } from '../src/controls/MovableHud.js';

// Rearranging the HUD (review fix 5.25): an explicit EDIT HUD LAYOUT mode
// instead of the old double-tap gesture that swallowed Jump and delayed clicks.

test('HUD panels remain reachable at viewport edges and after shrinking the window', () => {
  assert.deepEqual(clampPanelPosition(-20, -30, 120, 40, 800, 600), { x: 0, y: 0 });
  assert.deepEqual(clampPanelPosition(790, 590, 120, 40, 800, 600), { x: 680, y: 560 });
  assert.deepEqual(clampPanelPosition(600, 500, 400, 100, 320, 200), { x: 0, y: 100 });
});

// A page piece that records its listeners, styles and pointer capture.
function piece(box = { left: 20, top: 20, width: 120, height: 40 }) {
  const listeners = new Map();
  const classes = new Set();
  return {
    style: {}, listeners, classes, captured: null, clicks: 0,
    classList: { toggle: (name, on) => (on ? classes.add(name) : classes.delete(name)), add: (name) => classes.add(name), remove: (name) => classes.delete(name) },
    addEventListener(type, fn) { listeners.set(type, fn); },
    removeEventListener(type, fn) { if (listeners.get(type) === fn) listeners.delete(type); },
    getBoundingClientRect() { return { ...box, right: box.left + box.width, bottom: box.top + box.height }; },
    getClientRects() { return [1]; },
    setPointerCapture(id) { this.captured = id; },
    hasPointerCapture(id) { return this.captured === id; },
    releasePointerCapture() { this.captured = null; },
  };
}

function page() {
  const data = new Map();
  const storage = { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: (key) => data.delete(key) };
  const win = { innerWidth: 800, innerHeight: 600, addEventListener() {}, removeEventListener() {} };
  globalThis.document = { body: { classList: { toggle() {} } } };
  return { data, storage, win };
}

const pointer = (element, x, y, extra = {}) => ({ currentTarget: element, pointerId: 1, button: 0, clientX: x, clientY: y,
  preventDefault() {}, stopImmediatePropagation() {}, ...extra });

test('outside EDIT HUD LAYOUT nothing listens on the HUD: taps and clicks reach their controls at once', () => {
  const { storage, win } = page();
  const jump = piece();
  const layout = new HudLayout({ pieces: [['sprint', jump]], storage, win });
  assert.equal(jump.listeners.size, 0, 'no drag handler, no click delay, nothing swallowed');
  layout.setEditing(true);
  assert.ok(jump.listeners.has('pointerdown') && jump.classes.has('movable-hud'), 'editing: drag handlers and an outline');
  layout.setEditing(false);
  assert.equal(jump.listeners.size, 0, 'editing off again: all gone');
  assert.ok(!jump.classes.has('movable-hud'));
});

test('while editing, a single press drags a piece; the spot is saved per form factor and comes back', () => {
  const { data, storage, win } = page();
  const vitals = piece();
  const layout = new HudLayout({ pieces: [['vitals', vitals]], formFactor: 'touch', storage, win });
  layout.setEditing(true);
  vitals.listeners.get('pointerdown')(pointer(vitals, 30, 30));
  assert.equal(vitals.captured, 1, 'one press is enough');
  vitals.listeners.get('pointermove')(pointer(vitals, 500, 350));
  vitals.listeners.get('pointerup')(pointer(vitals, 500, 350));
  assert.equal(vitals.style.left, '490px');
  assert.equal(vitals.style.top, '340px');
  assert.equal(vitals.captured, null);
  const saved = JSON.parse(data.get(layoutKey('touch')));
  assert.deepEqual(saved.vitals, { x: 490 / 800, y: 340 / 600 });
  assert.equal(data.get(layoutKey('desktop')), undefined, 'the desktop layout is separate');
  // A click at the end of a drag never reaches the piece's own handler.
  let stopped = false;
  vitals.listeners.get('click')({ preventDefault() {}, stopImmediatePropagation() { stopped = true; } });
  assert.ok(stopped);
  // The next session at another window size puts it back at the same share of the screen.
  const again = piece();
  new HudLayout({ pieces: [['vitals', again]], formFactor: 'touch', storage, win: { ...win, innerWidth: 400, innerHeight: 300 } });
  assert.equal(again.style.left, '245px');
  assert.equal(again.style.top, '170px');
});

test('RESET LAYOUT forgets this form factor\'s layout and puts every piece back in its corner', () => {
  const { data, storage, win } = page();
  data.set(layoutKey('desktop'), JSON.stringify({ view: { x: 0.5, y: 0.5 } }));
  data.set(layoutKey('touch'), JSON.stringify({ view: { x: 0.1, y: 0.1 } }));
  const view = piece();
  const layout = new HudLayout({ pieces: [['view', view]], formFactor: 'desktop', storage, win });
  assert.equal(view.style.position, 'fixed');
  layout.reset();
  assert.equal(view.style.position, '');
  assert.equal(view.style.left, '');
  assert.equal(data.get(layoutKey('desktop')), undefined);
  assert.ok(data.get(layoutKey('touch')), 'the touch layout is untouched');
});

test('the movable pieces are the HUD corners\' panels and the touch joystick and SPRINT', () => {
  assert.deepEqual(Object.keys(MOVABLE_PIECES), ['leaper', 'view', 'vitals', 'weapons', 'joystick', 'sprint']);
  assert.equal(layoutKey('touch'), `${LAYOUT_KEY}.touch`);
  // An unreadable saved layout is ignored.
  const { data, storage, win } = page();
  data.set(layoutKey('desktop'), '{broken');
  const view = piece();
  new HudLayout({ pieces: [['view', view], ['missing', null]], storage, win });
  assert.equal(view.style.position, undefined);
});
