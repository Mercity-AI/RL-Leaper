import test from 'node:test';
import assert from 'node:assert/strict';
import { InputController, JUMP_BUFFER } from '../src/input/InputController.js';
import { AXIS_ACTIONS, BUTTON_ACTIONS, CONTROLS, MENU_ACTIONS, PAD, keyName } from '../src/input/actions.js';

// A fake page: window / document listeners (several per event, like a browser)
// and a gamepad the test can move.
function page() {
  const listeners = {};
  const on = (name, fn) => { (listeners[name] ??= []).push(fn); };
  const pad = { connected: true, id: 'Test pad', buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })), axes: [0, 0, 0, 0] };
  let padPlugged = false;
  globalThis.window = { addEventListener: on, matchMedia: () => ({ matches: false }) };
  globalThis.document = { hidden: false, addEventListener: on, getElementById: () => null };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { getGamepads: () => [padPlugged ? pad : null] } });
  const emit = (name, event = {}) => (listeners[name] ?? []).forEach(fn => fn({ preventDefault() {}, ...event }));
  return {
    emit, pad,
    plug: () => { padPlugged = true; },
    key: (type, code, extra = {}) => emit(type, { code, repeat: false, target: { tagName: 'BODY' }, ...extra }),
    mouse: (type, button, tagName = 'CANVAS') => emit(type, { button, target: { tagName } }),
  };
}

test('keys become actions: pressed once, held while down, released once', () => {
  const p = page(), input = new InputController();
  p.key('keydown', 'KeyR');
  input.poll();
  assert.ok(input.pressed('reload') && input.held('reload'));
  assert.equal(input.pressedBy('reload'), 'keyboard');
  p.key('keydown', 'KeyR', { repeat: true });
  input.poll();
  assert.ok(!input.pressed('reload') && input.held('reload'), 'key repeat is not a new press');
  p.key('keyup', 'KeyR');
  input.poll();
  assert.ok(input.released('reload') && !input.held('reload'));
  input.poll();
  assert.ok(!input.released('reload'));
});

test('a tap shorter than a frame still counts as one press', () => {
  const p = page(), input = new InputController();
  p.key('keydown', 'KeyC');
  p.key('keyup', 'KeyC');
  input.poll();
  assert.ok(input.pressed('crouch') && !input.held('crouch'));
  input.poll();
  assert.ok(!input.pressed('crouch'));
});

test('typing in a form control is not playing', () => {
  const p = page(), input = new InputController();
  p.key('keydown', 'KeyR', { target: { tagName: 'INPUT' } });
  p.key('keydown', 'ArrowUp', { target: { tagName: 'SELECT' } });
  input.poll();
  assert.ok(!input.pressed('reload'));
  assert.deepEqual(input.getMovement(), { forward: 0, side: 0 });
});

test('mouse buttons fire and aim only on the 3D view, never on the HUD or the pause overlay', () => {
  const p = page(), input = new InputController();
  p.mouse('mousedown', 0, 'DIV');
  input.poll();
  assert.ok(!input.pressed('fire'), 'a click on the overlay or toolbar');
  p.mouse('mousedown', 0);
  p.mouse('mousedown', 2);
  input.poll();
  assert.ok(input.pressed('fire') && input.held('fire') && input.pressed('aim'));
  p.mouse('mouseup', 0);
  input.poll();
  assert.ok(!input.held('fire') && input.held('aim'), 'left up, right still held');
});

test('the click that only grabs the mouse again never fires, nor does a tap\'s fake mouse click', () => {
  const p = page(), input = new InputController();
  let capturing = true;
  input.setPointerGuard(() => capturing);
  p.mouse('mousedown', 0);
  input.poll();
  assert.ok(!input.pressed('fire') && !input.held('fire'));
  capturing = false;
  input.poll();
  assert.ok(!input.held('fire'), 'still swallowed until the button comes up');
  p.mouse('mouseup', 0);
  // A finger tap: pointerdown(touch), then the browser's compatibility mousedown.
  p.emit('pointerdown', { pointerType: 'touch' });
  p.mouse('mousedown', 0);
  input.poll();
  assert.ok(!input.pressed('fire'), 'touch play fires from the FIRE button only');
});

test('the gamepad: triggers, buttons and both sticks (standard layout)', () => {
  const p = page(), input = new InputController();
  p.plug();
  p.pad.buttons[PAD.RT] = { pressed: false, value: 0.8 };
  p.pad.buttons[PAD.A] = { pressed: true, value: 1 };
  p.pad.axes = [0.1, -1, 0.6, 0];
  input.poll();
  assert.ok(input.pressed('fire') && input.held('fire'), 'RT pulled past half way');
  assert.equal(input.pressedBy('fire'), 'gamepad');
  assert.equal(input.jumpBuffer, JUMP_BUFFER, 'A jumps through the same buffer as Space');
  const move = input.getMovement();
  assert.ok(move.forward > 0.99 && Math.abs(move.side) < 0.15, 'left stick up = forward');
  p.pad.axes = [0.1, 0.05, 0, 0];
  input.poll();
  assert.deepEqual(input.getMovement(), { forward: 0, side: 0 }, 'a resting stick inside the dead zone never drifts');
  p.pad.axes = [0.1, -1, 0.6, 0];
  input.poll();
  assert.ok(input.axis('look').x > 0.4 && input.axis('look').y === 0, 'right stick turns the camera');
  assert.ok(!input.pressed('fire') && input.held('fire'), 'the trigger stays held without a new press');
  p.pad.buttons[PAD.RT] = { pressed: false, value: 0 };
  p.pad.buttons[PAD.START] = { pressed: true, value: 1 };
  input.poll();
  assert.ok(input.released('fire') && input.pressed('pause'));
  assert.equal(input.pressedBy('pause'), 'gamepad');
});

// Chrome reports an analog trigger as "pressed" from about 10% pull, so a finger
// resting on RT used to fire (found in a headless play-test with a mocked pad).
test('a light trigger touch never fires or aims, though the browser calls it pressed', () => {
  const p = page(), input = new InputController();
  p.plug();
  p.pad.buttons[PAD.RT] = { pressed: true, value: 0.3 };
  p.pad.buttons[PAD.LT] = { pressed: true, value: 0.2 };
  input.poll();
  assert.ok(!input.held('fire') && !input.pressed('fire'), 'RT at 30% is not a trigger pull');
  assert.ok(!input.held('aim'), 'LT at 20% does not aim');
  p.pad.buttons[PAD.RT] = { pressed: true, value: 0.6 };
  p.pad.buttons[PAD.LT] = { pressed: true, value: 0.9 };
  input.poll();
  assert.ok(input.pressed('fire') && input.held('aim'), 'past half way they count');
  // Ordinary buttons still count on their pressed flag.
  p.pad.buttons[PAD.X] = { pressed: true, value: 1 };
  p.pad.buttons[PAD.B] = { pressed: true };
  input.poll();
  assert.ok(input.pressed('reload') && input.pressed('crouch'));
});

test('touch buttons press the same actions', () => {
  page();
  const input = new InputController();
  input.virtualDown('fire');
  input.poll();
  assert.ok(input.pressed('fire') && input.held('fire'));
  assert.equal(input.pressedBy('fire'), 'touch');
  input.virtualDown('fire');
  input.poll();
  assert.ok(!input.pressed('fire'), 'still the same press');
  input.virtualUp('fire');
  input.poll();
  assert.ok(input.released('fire'));
  input.virtualDown('jump');
  assert.equal(input.jumpBuffer, JUMP_BUFFER);
  input.virtualDown('sprint');
  assert.ok(input.sprinting);
});

test('losing focus lets go of everything', () => {
  const p = page(), input = new InputController();
  p.key('keydown', 'KeyW');
  p.mouse('mousedown', 0);
  input.virtualDown('aim');
  input.poll();
  p.emit('blur');
  input.poll();
  assert.ok(!input.held('fire') && !input.held('aim'));
  assert.deepEqual(input.getMovement(), { forward: 0, side: 0 });
});

test('dispose removes the controller from the page', () => {
  const p = page(), input = new InputController();
  input.dispose();
  // The listeners are tied to an AbortSignal that is now aborted.
  assert.ok(input.session.signal.aborted);
  assert.ok(p);
});

test('the older key API still works: WASD, IJKL nudge, Shift, Space', () => {
  const p = page(), input = new InputController();
  p.key('keydown', 'KeyW');
  p.key('keydown', 'KeyD');
  p.key('keydown', 'KeyJ');
  p.key('keydown', 'ShiftLeft');
  p.key('keydown', 'Space');
  assert.deepEqual(input.getMovement(), { forward: 1, side: 1 });
  assert.deepEqual(input.getTargetMovement(), { forward: 0, side: -1 });
  assert.ok(input.sprinting);
  assert.ok(input.consumeJump() && !input.consumeJump());
  assert.deepEqual(input.axis('move'), { x: 1, y: 1 });
});

test('the controls list covers every action on every device, from the bindings themselves', () => {
  const actions = CONTROLS.map(row => row.action);
  assert.deepEqual(actions.sort(), [...Object.keys(BUTTON_ACTIONS), ...Object.keys(AXIS_ACTIONS)].sort());
  const row = (action) => CONTROLS.find(item => item.action === action);
  assert.deepEqual([row('fire').keyboard, row('fire').gamepad, row('fire').touch], ['Left click', 'RT', 'FIRE']);
  assert.deepEqual([row('aim').keyboard, row('aim').gamepad], ['Right click', 'LT']);
  assert.deepEqual([row('reload').keyboard, row('reload').gamepad], ['R', 'X']);
  assert.deepEqual([row('jump').keyboard, row('jump').gamepad], ['Space', 'A']);
  assert.deepEqual([row('crouch').keyboard, row('crouch').gamepad], ['C', 'B']);
  assert.equal(row('switchWeapon').gamepad, 'Y');
  assert.deepEqual([row('pause').keyboard, row('pause').gamepad], ['Esc', 'Start']);
  assert.equal(row('move').keyboard, 'W A S D / ↑ ← ↓ →');
  assert.equal(row('move').gamepad, 'Left stick');
  assert.equal(row('look').gamepad, 'Right stick');
  assert.ok(row('fire').hold && !row('reload').hold);
  assert.equal(keyName('Digit1'), '1');
  assert.equal(keyName('Numpad2'), 'Num 2');
  // No key or button triggers two different actions.
  const seen = new Map();
  for (const [action, binding] of Object.entries(BUTTON_ACTIONS)) {
    for (const code of [...(binding.keys ?? []), ...(binding.mouse ?? []).map(b => `mouse${b}`), ...(binding.pad ?? []).map(b => `pad${b}`)]) {
      assert.ok(!seen.has(code), `${code} is bound to both ${seen.get(code)} and ${action}`);
      seen.set(code, action);
    }
  }
});

test('while a menu has the controls only menu actions count: nothing fires or jumps behind it', () => {
  const p = page(), input = new InputController();
  let menu = true;
  input.setUiCapture(() => menu);
  p.plug();
  p.pad.buttons[PAD.RT] = { pressed: true, value: 1 };
  p.pad.buttons[PAD.A] = { pressed: true, value: 1 };
  p.key('keydown', 'ArrowDown');
  p.key('keydown', 'Space');
  input.poll();
  assert.ok(!input.held('fire') && !input.pressed('fire'), 'RT behind a menu fires nothing');
  assert.ok(!input.pressed('jump'));
  assert.equal(input.jumpBuffer, 0, 'a Space or A that confirms a menu item never buffers a jump');
  assert.ok(input.pressed('menuDown') && input.pressed('menuConfirm'));
  // Start (pause) still counts in a menu: it resumes a paused game.
  p.pad.buttons[PAD.START] = { pressed: true, value: 1 };
  input.poll();
  assert.ok(input.pressed('pause'));
  // The menu closes: gameplay actions count again and menu actions stop. A
  // button held through the change only counts once let go and pressed again
  // (the A that pressed PLAY never also jumps; the trigger held over the menu
  // doesn't fire the moment it closes).
  menu = false;
  p.key('keydown', 'KeyR');
  input.poll();
  assert.ok(input.pressed('reload'), 'R, pressed after the menu closed, reloads');
  assert.ok(!input.held('fire') && !input.pressed('fire') && !input.pressed('jump'), 'RT and A held through the menu do nothing');
  assert.ok(!input.held('menuConfirm') && !input.pressed('menuDown'));
  p.pad.buttons[PAD.RT] = { pressed: false, value: 0 };
  input.poll();
  p.pad.buttons[PAD.RT] = { pressed: true, value: 1 };
  input.poll();
  assert.ok(input.pressed('fire') && input.held('fire'), 'let go and pulled again, the trigger fires');
  // Same the other way: B held when a menu opens is not a BACK press.
  p.pad.buttons[PAD.B] = { pressed: true, value: 1 };
  input.poll();
  menu = true;
  input.poll();
  assert.ok(!input.pressed('menuBack'), 'B held as the menu opened does not go back');
  p.pad.buttons[PAD.B] = { pressed: false, value: 0 };
  input.poll();
  menu = false;
  input.poll();
  // Escape pauses in play and goes back in a menu (the same key, two action maps).
  p.key('keydown', 'Escape');
  input.poll();
  assert.ok(input.pressed('pause') && !input.pressed('menuBack'));
  menu = true;
  p.key('keydown', 'Escape');
  input.poll();
  assert.ok(input.pressed('menuBack'));
});

test('menu bindings cover keyboard and gamepad, each key or button meaning one menu action', () => {
  const seen = new Map();
  for (const [action, binding] of Object.entries(MENU_ACTIONS)) {
    assert.ok((binding.keys ?? []).length && (binding.pad ?? []).length, `${action} works on the keyboard and the gamepad`);
    for (const code of [...binding.keys, ...binding.pad.map((b) => `pad${b}`)]) {
      assert.ok(!seen.has(code), `${code} is bound to both ${seen.get(code)} and ${action}`);
      seen.set(code, action);
    }
  }
  assert.deepEqual(MENU_ACTIONS.menuConfirm.pad, [PAD.A]);
  assert.deepEqual(MENU_ACTIONS.menuBack.pad, [PAD.B]);
  assert.ok(BUTTON_ACTIONS.pause.ui, 'pause is the one gameplay action that also works in menus');
  assert.equal(Object.values(BUTTON_ACTIONS).filter((binding) => binding.ui).length, 1);
});

test('a pad whose stick rests off-centre (stick drift, a virtual pad) never walks Lola', () => {
  const p = page(), input = new InputController();
  p.plug();
  // Resting well past the dead zone, to the right.
  p.pad.axes = [0.35, 0.02, -0.25, 0];
  input.poll();
  assert.deepEqual(input.getMovement(), { forward: 0, side: 0 }, 'its resting position is its centre');
  assert.equal(input.axis('look').x, 0, 'the right stick rests too');
  for (let i = 0; i < 30; i += 1) input.poll();
  assert.deepEqual(input.getMovement(), { forward: 0, side: 0 }, 'still standing still later');
  // Pushed right for real: it still moves her.
  p.pad.axes = [1, 0.02, -0.25, 0];
  input.poll();
  assert.ok(input.getMovement().side > 0.5, 'a real push still counts');
});
