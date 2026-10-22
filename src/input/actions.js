// The game's controls as an action map: what each action is called, and which
// keys, mouse buttons and gamepad buttons trigger it. Gameplay code only ever
// asks "is fire held?" or "was reload pressed this frame?" (InputController), so
// rebinding or adding a device never touches the systems that use the actions
// (finding game-architecture-input-not-action-mapped).
//
// Keys use KeyboardEvent.code names ('KeyW', 'Space', 'ShiftLeft'...). Mouse
// buttons use MouseEvent.button numbers (0 left, 2 right). Gamepad buttons use
// the browser's "standard" layout (Xbox names; PlayStation: A = cross, B = circle,
// X = square, Y = triangle).

// ---- Gamepad layout ----
// Standard-mapping button numbers and stick axes.
export const PAD = Object.freeze({
  A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, L3: 10, R3: 11,
  UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15,
});
export const PAD_AXES = Object.freeze({ leftX: 0, leftY: 1, rightX: 2, rightY: 3 });
// Stick dead zone (share of full tilt ignored, so a resting stick never drifts)
// and how far a trigger must be pulled to count as pressed. triggers: the analog
// triggers that use triggerPress (browsers already call a trigger "pressed" at a
// light touch of about 10%, so a resting finger would fire or aim).
// maxRest: the most a stick may sit off-centre and still count as resting
// (InputController takes each pad's first reading as its centre).
export const PAD_TUNING = Object.freeze({ deadZone: 0.18, maxRest: 0.5, triggerPress: 0.5, triggers: Object.freeze([PAD.LT, PAD.RT]) });

// ---- Buttons ----
// label: the name in the controls list. hold: "hold" in the list (the action
// lasts while held). Every action can be bound to keys, mouse buttons and pad buttons.
export const BUTTON_ACTIONS = Object.freeze({
  fire: Object.freeze({ label: 'Fire', hold: true, mouse: [0], pad: [PAD.RT], touch: 'FIRE' }),
  aim: Object.freeze({ label: 'Aim down sights', hold: true, mouse: [2], pad: [PAD.LT], touch: 'AIM' }),
  reload: Object.freeze({ label: 'Reload', keys: ['KeyR'], pad: [PAD.X], touch: 'RELOAD' }),
  jump: Object.freeze({ label: 'Jump', keys: ['Space'], pad: [PAD.A], touch: 'JUMP' }),
  crouch: Object.freeze({ label: 'Crouch', keys: ['KeyC'], pad: [PAD.B], touch: 'CROUCH' }),
  sprint: Object.freeze({ label: 'Sprint', hold: true, keys: ['ShiftLeft', 'ShiftRight'], pad: [PAD.LB], touch: 'SPRINT' }),
  switchWeapon: Object.freeze({ label: 'Switch gun', pad: [PAD.Y], touch: 'SWITCH' }),
  weapon1: Object.freeze({ label: 'M416', keys: ['Digit1', 'Numpad1'] }),
  weapon2: Object.freeze({ label: 'Basic gun', keys: ['Digit2', 'Numpad2'] }),
  // Escape also lets go of the mouse (the camera handles that part, because
  // browsers use Escape to end pointer lock). Start / the touch PAUSE button
  // also resume a paused game. ui: it still counts while a menu has the controls.
  pause: Object.freeze({ label: 'Pause', keys: ['Escape'], pad: [PAD.START], touch: 'PAUSE', ui: true }),
  // The controls legend over the game (src/ui/ControlsLegend.js).
  legend: Object.freeze({ label: 'Show / hide controls', keys: ['KeyH'], pad: [PAD.BACK] }),
});

// ---- Menus ----
// While a menu (title, pause, end, settings) has the controls, these are the
// only actions that count (plus `pause`, for Start and the touch RESUME); every
// gameplay action is ignored, so nothing fires or jumps behind a menu. The mouse
// and touch press the menu's buttons directly; Enter on a focused button works
// as on any page, Space and the gamepad's A confirm too.
export const MENU_ACTIONS = Object.freeze({
  menuUp: Object.freeze({ label: 'Previous item', keys: ['ArrowUp'], pad: [PAD.UP] }),
  menuDown: Object.freeze({ label: 'Next item', keys: ['ArrowDown'], pad: [PAD.DOWN] }),
  menuLeft: Object.freeze({ label: 'Lower a setting', keys: ['ArrowLeft'], pad: [PAD.LEFT] }),
  menuRight: Object.freeze({ label: 'Raise a setting', keys: ['ArrowRight'], pad: [PAD.RIGHT] }),
  menuConfirm: Object.freeze({ label: 'Select', keys: ['Space'], pad: [PAD.A] }),
  menuBack: Object.freeze({ label: 'Back', keys: ['Escape', 'Backspace'], pad: [PAD.B] }),
});

// ---- Sticks and key pairs ----
// move: walk / run (x = right, y = forward). look: turn the camera (gamepad only;
// the mouse and touch drags turn it through the camera directly). nudge: the old
// lab keys that still nudge Lola (I J K L), kept from the sandbox.
export const AXIS_ACTIONS = Object.freeze({
  move: Object.freeze({ label: 'Move', up: ['KeyW', 'ArrowUp'], down: ['KeyS', 'ArrowDown'],
    left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'], stick: 'left', touch: 'JOYSTICK' }),
  look: Object.freeze({ label: 'Look', mouse: 'move', stick: 'right', touch: 'DRAG RIGHT SIDE' }),
  nudge: Object.freeze({ label: 'Nudge (lab keys)', up: ['KeyI'], down: ['KeyK'], left: ['KeyJ'], right: ['KeyL'] }),
});

// Every button action name, in a fixed order.
export const ACTION_NAMES = Object.freeze(Object.keys(BUTTON_ACTIONS));

// Keys whose browser default (page scrolling) is blocked while playing.
export const NO_DEFAULT_KEYS = Object.freeze(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

// ---- Human-readable names (for the controls list and the legend) ----

const KEY_NAMES = Object.freeze({
  Space: 'Space', ShiftLeft: 'Shift', ShiftRight: 'Right Shift', Escape: 'Esc',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
});
const MOUSE_NAMES = Object.freeze({ 0: 'Left click', 1: 'Middle click', 2: 'Right click' });
const PAD_NAMES = Object.freeze(Object.fromEntries(Object.entries(PAD).map(([name, index]) => [index,
  { L3: 'Left stick press', R3: 'Right stick press', UP: 'D-pad up', DOWN: 'D-pad down', LEFT: 'D-pad left',
    RIGHT: 'D-pad right', BACK: 'Back', START: 'Start' }[name] ?? name])));

// 'KeyR' -> 'R', 'Digit1' -> '1', 'Numpad1' -> 'Num 1', 'Space' -> 'Space'.
export function keyName(code) {
  if (KEY_NAMES[code]) return KEY_NAMES[code];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad\d$/.test(code)) return `Num ${code.slice(6)}`;
  return code;
}

// What to press for one action, per device: { keyboard, gamepad, touch } strings.
function describe(binding, isAxis) {
  const keyboard = [];
  // Four-key axes read "W A S D" (one group per set of keys, e.g. the arrows too).
  for (let i = 0; isAxis && i < (binding.up?.length ?? 0); i += 1) {
    keyboard.push([binding.up[i], binding.left[i], binding.down[i], binding.right[i]].map(keyName).join(' '));
  }
  if (isAxis && binding.mouse === 'move') keyboard.push('Mouse');
  for (const code of binding.keys ?? []) keyboard.push(keyName(code));
  for (const button of isAxis ? [] : binding.mouse ?? []) keyboard.push(MOUSE_NAMES[button] ?? `Mouse ${button}`);
  const gamepad = isAxis
    ? (binding.stick ? `${binding.stick === 'left' ? 'Left' : 'Right'} stick` : '')
    : (binding.pad ?? []).map(index => PAD_NAMES[index] ?? `Button ${index}`).join(' / ');
  return { keyboard: [...new Set(keyboard)].join(' / '), gamepad, touch: binding.touch ?? '' };
}

// The controls list other code reads (the on-screen legend, the README table):
// one row per action, with how to do it on each device. Built from the bindings
// above, so it can never disagree with what the game actually listens to.
export function controlsList(buttons = BUTTON_ACTIONS, axes = AXIS_ACTIONS) {
  return [
    ...Object.entries(axes).map(([action, binding]) => ({ action, label: binding.label, hold: false, ...describe(binding, true) })),
    ...Object.entries(buttons).map(([action, binding]) => ({ action, label: binding.label, hold: Boolean(binding.hold), ...describe(binding, false) })),
  ];
}

export const CONTROLS = Object.freeze(controlsList().map(row => Object.freeze(row)));
