import {
  ACTION_NAMES, AXIS_ACTIONS, BUTTON_ACTIONS, NO_DEFAULT_KEYS, PAD_AXES, PAD_TUNING,
} from './actions.js';
import { wantsTouchControls } from './touch.js';

// The one place that listens to the keyboard, the mouse buttons, the gamepad and
// the touch buttons for gameplay. Devices only record what is down; once per
// frame poll() turns that into a snapshot the game reads by action name:
//   held('fire')      the action is down this frame
//   pressed('reload') it went down since the last frame (each press counts once,
//                     even a tap shorter than a frame)
//   released('aim')   it came back up since the last frame
//   axis('move')      { x: right, y: forward } from WASD / the joystick / the left stick
// Nothing fires, jumps or reloads inside a page event callback, so pausing
// (which stops the game reading its input) freezes every action, and the click
// that only grabs the mouse again never shoots (findings
// game-architecture-input-not-action-mapped, aim-weapons-input-scattered).
// Mouse look itself stays with the camera, which needs every pointer movement.

// Seconds a jump press is remembered while Lola can't jump yet (review fix 5.36).
export const JUMP_BUFFER = 0.16;
// A tap on a touch screen is followed by fake "compatibility" mouse events; any
// mouse button press this soon after a touch (ms) is one of those, not a click.
const TOUCH_MOUSE_WINDOW = 800;

// Typing into a form control (the size slider, a select) is not playing.
const editable = (target) => Boolean(target && (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName ?? '') || target.isContentEditable));
// Mouse buttons only count when pressed on the 3D view, never on the toolbar,
// the HUD or the pause overlay (so the click that resumes can't fire).
const onGameView = (target) => target?.tagName === 'CANVAS';
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
// Is a gamepad button down? An analog trigger only counts once pulled past
// PAD_TUNING.triggerPress: browsers already report it "pressed" at a light
// touch, so its own flag can't be trusted. Other buttons count when pressed.
const padButtonDown = (button, analog) => {
  if (typeof button === 'number') return button > PAD_TUNING.triggerPress;
  const value = Number(button?.value);
  if (analog && Number.isFinite(value)) return value > PAD_TUNING.triggerPress;
  return Boolean(button?.pressed || value > PAD_TUNING.triggerPress);
};

export class InputController {
  // onToggleTarget(): the lab's P key (select the pink target). Optional.
  // buttons / axes: the bindings (src/input/actions.js).
  constructor(onToggleTarget = () => {}, { buttons = BUTTON_ACTIONS, axes = AXIS_ACTIONS } = {}) {
    // 1. State the older systems read directly (the lab modes never poll).
    this.keys = {};
    this.jumpBuffer = 0;
    this.sprintHeld = false;
    this.joystick = { active: false, pointerId: null, forward: 0, side: 0 };

    // 2. The bindings, turned into "this key / button -> these actions" lookups.
    this.buttons = buttons;
    this.axes = axes;
    this.actions = Object.keys(buttons);
    this.keyActions = new Map();
    this.mouseActions = new Map();
    for (const [action, binding] of Object.entries(buttons)) {
      for (const code of binding.keys ?? []) this.keyActions.set(code, [...(this.keyActions.get(code) ?? []), action]);
      for (const button of binding.mouse ?? []) this.mouseActions.set(button, [...(this.mouseActions.get(button) ?? []), action]);
    }

    // 3. What the devices report right now, between polls.
    this.mouseDown = new Set();
    // A mouse button whose press only grabbed the mouse: ignored until it comes up.
    this.swallowed = new Set();
    // On-screen (touch) buttons held down, by action.
    this.virtual = new Map();
    // Presses since the last poll: action -> device ('keyboard' | 'mouse' | 'touch' | 'gamepad').
    this.latched = new Map();
    this.lastTouch = -Infinity;
    // Returns true for a click that must not count as a press (the camera's
    // "grab the mouse again" click). Set by whoever owns the mouse capture.
    this.pointerGuard = () => false;
    this.pad = { connected: false, id: '', buttons: [], axes: [0, 0, 0, 0] };

    // 4. The per-frame snapshot poll() fills in.
    this.frame = 0;
    this.heldNow = new Set();
    this.heldBefore = new Set();
    this.pressedNow = new Map();
    this.releasedNow = new Set();

    // 5. Page listeners (all removed together by dispose()).
    this.session = new AbortController();
    const options = { signal: this.session.signal };
    window.addEventListener('keydown', (event) => this.onKeyDown(event, onToggleTarget), options);
    window.addEventListener('keyup', (event) => { this.keys[event.code] = false; }, options);
    window.addEventListener('mousedown', (event) => this.onMouseDown(event), options);
    window.addEventListener('mouseup', (event) => {
      this.mouseDown.delete(event.button);
      this.swallowed.delete(event.button);
    }, options);
    // Remember touches (capture phase: before anything can stop the event).
    window.addEventListener('pointerdown', (event) => {
      if (event.pointerType && event.pointerType !== 'mouse') this.lastTouch = now();
    }, { ...options, capture: true });
    // Leaving the window or hiding the tab lets go of everything.
    window.addEventListener('blur', () => this.releaseAll(), options);
    globalThis.document?.addEventListener?.('visibilitychange', () => {
      if (document.hidden) this.releaseAll();
    }, options);

    // 6. The page's own touch joystick and SPRINT / JUMP buttons (index.html).
    this.setupTouchControls(options);
  }

  // ---- Device events (they only record; poll() decides what they mean) ----

  onKeyDown(event, onToggleTarget) {
    if (editable(event.target)) return;
    if (NO_DEFAULT_KEYS.includes(event.code)) event.preventDefault?.();
    this.keys[event.code] = true;
    if (event.repeat) return;
    // The lab's P key (select the pink target) is not a gameplay action.
    if (event.code === 'KeyP') onToggleTarget();
    for (const action of this.keyActions.get(event.code) ?? []) this.latch(action, 'keyboard');
  }

  onMouseDown(event) {
    if (!onGameView(event.target)) return;
    // A tap's fake mouse event: touch play fires from the FIRE button only.
    if (event.sourceCapabilities?.firesTouchEvents || now() - this.lastTouch < TOUCH_MOUSE_WINDOW) return;
    // The click that grabs the mouse again only does that.
    if (this.pointerGuard(event)) {
      this.swallowed.add(event.button);
      return;
    }
    this.mouseDown.add(event.button);
    for (const action of this.mouseActions.get(event.button) ?? []) this.latch(action, 'mouse');
  }

  // Record a press for the next poll (a jump press also starts its buffer).
  latch(action, device) {
    if (!this.latched.has(action)) this.latched.set(action, device);
    if (action === 'jump') this.jumpBuffer = JUMP_BUFFER;
  }

  // ---- On-screen buttons (TouchControls) ----

  // A touch button went down / up. Held actions (FIRE, AIM, SPRINT) last until up.
  virtualDown(action, device = 'touch') {
    if (this.virtual.get(action)) return;
    this.virtual.set(action, true);
    this.latch(action, device);
  }

  virtualUp(action) {
    this.virtual.set(action, false);
  }

  // ---- The frame snapshot ----

  // Read every device once and freeze the result for this frame. Call once per
  // frame, in the input phase, before anything asks held / pressed / released.
  poll() {
    this.frame += 1;
    this.readGamepad();
    // What is down now.
    const held = this.heldBefore;
    held.clear();
    for (const action of this.actions) if (this.rawHeld(action)) held.add(action);
    // Presses: everything latched since the last poll, plus actions that became
    // held without an event (gamepad buttons).
    this.pressedNow.clear();
    for (const [action, device] of this.latched) this.pressedNow.set(action, device);
    this.latched.clear();
    for (const action of held) {
      if (!this.heldNow.has(action) && !this.pressedNow.has(action)) this.pressedNow.set(action, 'gamepad');
    }
    this.releasedNow.clear();
    for (const action of this.heldNow) if (!held.has(action)) this.releasedNow.add(action);
    // Swap the two sets, so polling allocates nothing.
    this.heldBefore = this.heldNow;
    this.heldNow = held;
    // A gamepad jump starts the same buffer as Space.
    if (this.pressedNow.get('jump') === 'gamepad') this.jumpBuffer = JUMP_BUFFER;
    return this.frame;
  }

  held(action) { return this.heldNow.has(action); }
  pressed(action) { return this.pressedNow.has(action); }
  released(action) { return this.releasedNow.has(action); }
  // Which device made this frame's press of an action (null when not pressed).
  pressedBy(action) { return this.pressedNow.get(action) ?? null; }

  // { x: right, y: forward } for 'move' (keys, joystick, left stick) or 'look' (right stick).
  axis(name) {
    if (name === 'look') return { x: this.pad.axes[PAD_AXES.rightX], y: this.pad.axes[PAD_AXES.rightY] };
    if (name === 'nudge') return this.keyAxis(this.axes.nudge);
    const move = this.getMovement();
    return { x: move.side, y: move.forward };
  }

  // Is an action down on any device, right now (not the frame snapshot)?
  rawHeld(action) {
    const binding = this.buttons[action];
    if (!binding) return false;
    if (this.virtual.get(action)) return true;
    if ((binding.keys ?? []).some((code) => this.keys[code])) return true;
    if ((binding.mouse ?? []).some((button) => this.mouseDown.has(button))) return true;
    if ((binding.pad ?? []).some((button) => this.pad.buttons[button])) return true;
    return action === 'sprint' && this.sprintHeld;
  }

  // ---- Gamepad ----

  // The first connected pad in the browser's standard layout: buttons as on/off
  // (triggers count past PAD_TUNING.triggerPress), sticks with a dead zone.
  readGamepad() {
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = [...(pads ?? [])].find((item) => item && item.connected !== false) ?? null;
    this.pad.connected = Boolean(pad);
    this.pad.id = pad?.id ?? '';
    this.pad.buttons.length = 0;
    const buttons = pad?.buttons ?? [];
    for (let index = 0; index < buttons.length; index += 1) {
      this.pad.buttons.push(padButtonDown(buttons[index], PAD_TUNING.triggers.includes(index)));
    }
    const axes = pad?.axes ?? [];
    const stick = (x, y) => {
      const length = Math.hypot(x, y);
      if (length <= PAD_TUNING.deadZone) return [0, 0];
      // Rescale past the dead zone so a stick still reaches full tilt.
      const scale = Math.min(1, (length - PAD_TUNING.deadZone) / (1 - PAD_TUNING.deadZone)) / length;
      return [x * scale, y * scale];
    };
    const [lx, ly] = stick(axes[PAD_AXES.leftX] ?? 0, axes[PAD_AXES.leftY] ?? 0);
    const [rx, ry] = stick(axes[PAD_AXES.rightX] ?? 0, axes[PAD_AXES.rightY] ?? 0);
    // Stored with forward / up positive (a stick pushed up reports negative y).
    this.pad.axes[PAD_AXES.leftX] = lx;
    this.pad.axes[PAD_AXES.leftY] = 0 - ly;
    this.pad.axes[PAD_AXES.rightX] = rx;
    this.pad.axes[PAD_AXES.rightY] = 0 - ry;
  }

  // ---- What the older systems call ----

  // The jump press buffer runs down (call once per frame, after consumeJump()).
  update(deltaTime) {
    if (this.jumpBuffer > 0) this.jumpBuffer -= deltaTime;
  }

  consumeJump() {
    if (this.jumpBuffer <= 0) return false;
    this.jumpBuffer = 0;
    return true;
  }

  // { forward, side } from the touch joystick, else the keys, else the left stick.
  getMovement() {
    if (this.joystick.active) return { forward: this.joystick.forward, side: this.joystick.side };
    const keys = this.keyAxis(this.axes.move);
    if (keys.x || keys.y) return { forward: keys.y, side: keys.x };
    return { forward: this.pad.axes[PAD_AXES.leftY], side: this.pad.axes[PAD_AXES.leftX] };
  }

  // The lab's I J K L keys (they still nudge Lola in the junkyard).
  getTargetMovement() {
    const nudge = this.keyAxis(this.axes.nudge);
    return { forward: nudge.y, side: nudge.x };
  }

  get sprinting() {
    return Boolean((this.buttons.sprint?.keys ?? []).some((code) => this.keys[code])
      || this.sprintHeld || this.virtual.get('sprint') || (this.buttons.sprint?.pad ?? []).some((button) => this.pad.buttons[button]));
  }

  // Four keys as an axis: { x: right - left, y: up - down }.
  keyAxis(binding) {
    const down = (codes) => ((codes ?? []).some((code) => this.keys[code]) ? 1 : 0);
    return { x: down(binding?.right) - down(binding?.left), y: down(binding?.up) - down(binding?.down) };
  }

  // ---- Control ----

  // Let go of everything (focus lost, tab hidden): keys, buttons, touch, presses.
  releaseAll() {
    Object.keys(this.keys).forEach((code) => { this.keys[code] = false; });
    this.mouseDown.clear();
    this.swallowed.clear();
    this.virtual.clear();
    this.latched.clear();
    this.sprintHeld = false;
  }

  // fn(event) -> true when a mouse press must be ignored (see onMouseDown).
  setPointerGuard(fn) {
    this.pointerGuard = typeof fn === 'function' ? fn : () => false;
  }

  // Remove every page listener this controller added.
  dispose() {
    this.session.abort();
    this.releaseAll();
  }

  // ---- The page's touch joystick and SPRINT / JUMP buttons ----

  setupTouchControls(options) {
    const byId = (id) => globalThis.document?.getElementById?.(id) ?? null;
    const touchUi = byId('touch');
    const joystickBase = byId('joyBase');
    const joystickKnob = byId('joyKnob');
    const jumpButton = byId('btnJump');
    const sprintButton = byId('btnSprint');
    if (!touchUi || !joystickBase || !joystickKnob || !jumpButton || !sprintButton) return;

    // Shown on touch screens only (the same test as the touch control band).
    if (wantsTouchControls(window)) touchUi.classList.add('show');

    // The joystick knob follows the finger inside the ring; its offset is the move input.
    const moveJoystick = (event) => {
      if (!this.joystick.active || event.pointerId !== this.joystick.pointerId) return;
      const bounds = joystickBase.getBoundingClientRect();
      let x = event.clientX - (bounds.left + bounds.width / 2);
      let y = event.clientY - (bounds.top + bounds.height / 2);
      const length = Math.hypot(x, y);
      const maximum = bounds.width / 2 - 8;
      if (length > maximum) {
        x = x / length * maximum;
        y = y / length * maximum;
      }
      joystickKnob.style.transform = `translate(${x}px, ${y}px)`;
      this.joystick.forward = -y / maximum;
      this.joystick.side = x / maximum;
    };
    const endJoystick = (event) => {
      if (event.pointerId !== this.joystick.pointerId) return;
      this.joystick.active = false;
      this.joystick.pointerId = null;
      this.joystick.forward = 0;
      this.joystick.side = 0;
      joystickKnob.style.transform = 'translate(0, 0)';
    };
    joystickBase.addEventListener('pointerdown', (event) => {
      event.stopPropagation();
      this.joystick.active = true;
      this.joystick.pointerId = event.pointerId;
      moveJoystick(event);
    }, options);
    window.addEventListener('pointermove', moveJoystick, options);
    window.addEventListener('pointerup', endJoystick, options);
    window.addEventListener('pointercancel', endJoystick, options);

    // JUMP is a press; SPRINT is held while the finger stays down.
    jumpButton.addEventListener('pointerdown', (event) => {
      event.stopPropagation();
      this.latch('jump', 'touch');
    }, options);
    sprintButton.addEventListener('pointerdown', (event) => {
      event.stopPropagation();
      this.sprintHeld = true;
      sprintButton.classList.add('on');
    }, options);
    const stopSprint = () => {
      this.sprintHeld = false;
      sprintButton.classList.remove('on');
    };
    sprintButton.addEventListener('pointerup', stopSprint, options);
    sprintButton.addEventListener('pointercancel', stopSprint, options);
  }
}

export { ACTION_NAMES };
