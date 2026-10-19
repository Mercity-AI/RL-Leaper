import test from 'node:test';
import assert from 'node:assert/strict';
import { TOUCH_BAND, touchButtons, wantsTouchControls } from '../src/input/touch.js';
import { BUTTON_ACTIONS, CONTROLS } from '../src/input/actions.js';

// The touch band's layout (review fix 5.9) and the "is this a touch screen?"
// check. The band itself is driven on an emulated phone by
// tests/touch-controls.browser.mjs.

test('the touch band has every control a phone player needs, as input actions', () => {
  const buttons = touchButtons();
  const byAction = Object.fromEntries(buttons.map(button => [button.action, button]));
  // FIRE (hold), AIM, RELOAD, SWITCH, CROUCH, JUMP and PAUSE, nothing missing.
  for (const action of ['fire', 'aim', 'reload', 'switchWeapon', 'crouch', 'jump', 'pause']) {
    assert.ok(byAction[action], `${action} is on the band`);
    assert.ok(BUTTON_ACTIONS[action], `${action} is a real input action`);
  }
  assert.equal(byAction.fire.mode, 'hold', 'FIRE keeps firing while held');
  assert.equal(byAction.aim.mode, 'toggle', 'AIM is tap on, tap off');
  for (const action of ['reload', 'switchWeapon', 'crouch', 'jump', 'pause']) assert.equal(byAction[action].mode, 'tap');
  // The right thumb sits on AIM and FIRE at the right-hand end.
  assert.deepEqual(buttons.slice(-2).map(button => button.action), ['aim', 'fire']);
  // Only the gun's buttons dim while the gun can't be used.
  assert.deepEqual(buttons.filter(button => button.gun).map(button => button.action).sort(),
    ['aim', 'fire', 'reload', 'switchWeapon']);
});

test('the band\'s labels are the controls list\'s touch names', () => {
  for (const button of touchButtons()) {
    const row = CONTROLS.find(item => item.action === button.action);
    assert.equal(button.label, row.touch, `${button.action} reads the same on the band and in the list`);
  }
  assert.equal(touchButtons().find(button => button.action === 'fire').label, 'FIRE');
  assert.equal(TOUCH_BAND.length, touchButtons().length);
});

test('a band entry without a touch name in the action map is refused', () => {
  assert.throws(() => touchButtons([{ action: 'weapon1', mode: 'tap' }]), /no touch label/);
  assert.throws(() => touchButtons([{ action: 'nonsense', mode: 'tap' }]), /no touch label/);
});

test('touch controls appear on touch screens only (or with ?touch)', () => {
  const fakeWindow = ({ coarse = false, touch = false, search = '' } = {}) => ({
    location: { search },
    matchMedia: (query) => ({ matches: coarse && query === '(pointer: coarse)' }),
    ...(touch ? { ontouchstart: null } : {}),
  });
  assert.equal(wantsTouchControls(fakeWindow()), false, 'a desktop with a mouse');
  assert.equal(wantsTouchControls(fakeWindow({ coarse: true })), true, 'a phone (coarse pointer)');
  assert.equal(wantsTouchControls(fakeWindow({ touch: true })), true, 'a touch-capable screen');
  assert.equal(wantsTouchControls(fakeWindow({ search: '?debug&touch' })), true, '?touch forces them on');
  assert.equal(wantsTouchControls(null), false, 'no page at all (Node)');
});
