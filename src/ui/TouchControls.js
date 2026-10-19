import '../styles/ui/touch-controls.css';

// On-screen controls for phones and tablets (review fix 5.9): a band of buttons
// along the bottom edge (FIRE held, AIM toggled, RELOAD, SWITCH, CROUCH, JUMP,
// PAUSE) plus a look area on the right half of the screen that turns the camera
// when dragged. The page's own joystick and SPRINT button stay as they are.
//
// Like every HUD view it builds its own markup and never touches the game. It
// is handed the buttons as data (src/input/touch.js, touchButtons()) and only
// reports what the fingers do through three callbacks, which the game wires to
// its input actions (so nothing fires from inside a touch event):
//   onDown(action) / onUp(action)  an action's button went down / came up
//   onLook(dx, dy)                 the look area was dragged by (dx, dy) pixels

// The markup: the look area, then one button per entry, left to right.
const escape = (text) => String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const template = (buttons) => `
  <div class="touch-look" aria-hidden="true"></div>
  <div class="touch-band">${buttons.map(({ action, label, mode }) => `
    <button type="button" class="touch-button${action === 'fire' ? ' touch-fire' : ''}" data-action="${escape(action)}"
      data-mode="${escape(mode)}"${mode === 'toggle' ? ' aria-pressed="false"' : ''}>${escape(label)}</button>`).join('')}
  </div>`;

export class TouchControls {
  // buttons: [{ action, label, mode: 'hold' | 'toggle' | 'tap', gun }] (touchButtons()).
  constructor(parent = document.body, { buttons = [], onDown = () => {}, onUp = () => {}, onLook = () => {} } = {}) {
    Object.assign(this, { onDown, onUp, onLook });
    this.definitions = new Map(buttons.map(button => [button.action, button]));
    // 1. Build the markup from the template. The body class makes room for the band.
    this.element = document.createElement('div');
    this.element.className = 'touch-controls';
    this.element.setAttribute('role', 'group');
    this.element.setAttribute('aria-label', 'Touch controls');
    this.element.innerHTML = template(buttons);
    parent.append(this.element);
    document.body.classList.add('touch-controls-on');
    this.buttons = new Map([...this.element.querySelectorAll('[data-action]')].map(button => [button.dataset.action, button]));
    this.lookArea = this.element.querySelector('.touch-look');
    // 2. Which finger holds which button, which toggles are on, the look drag.
    this.fingers = new Map();
    this.toggled = new Set();
    this.look = null;
    // 3. Listeners on our own elements only (they leave with the elements).
    for (const [action, button] of this.buttons) this.bindButton(action, button);
    this.bindLookArea();
    // 4. What was last drawn, so update() only touches the page on changes.
    this.last = {};
  }

  // ---- Buttons ----

  bindButton(action, button) {
    const { mode } = this.definitions.get(action);
    button.addEventListener('pointerdown', (event) => {
      // Our button only: no compatibility mouse click, no camera drag, no focus ring.
      event.preventDefault();
      event.stopPropagation();
      button.setPointerCapture?.(event.pointerId);
      button.classList.add('on');
      if (mode === 'toggle') {
        this.setToggle(action, !this.toggled.has(action));
        return;
      }
      this.fingers.set(event.pointerId, action);
      this.onDown(action);
    });
    // The finger lifts (or the browser takes it away): a held button comes up.
    const release = (event) => {
      button.classList.toggle('on', this.toggled.has(action));
      if (this.fingers.get(event.pointerId) !== action) return;
      this.fingers.delete(event.pointerId);
      this.onUp(action);
    };
    button.addEventListener('pointerup', release);
    button.addEventListener('pointercancel', release);
    button.addEventListener('lostpointercapture', release);
    // A long press must not open the browser's menu or select the label.
    button.addEventListener('contextmenu', (event) => event.preventDefault());
  }

  // A toggle button (AIM): one tap turns its action on (held), the next lets go.
  setToggle(action, on) {
    if (on === this.toggled.has(action)) return;
    if (on) this.toggled.add(action);
    else this.toggled.delete(action);
    const button = this.buttons.get(action);
    button.setAttribute('aria-pressed', String(on));
    button.classList.toggle('on', on);
    if (on) this.onDown(action);
    else this.onUp(action);
  }

  // ---- Look area ----

  // One finger dragged on the right side turns the camera by the distance moved.
  bindLookArea() {
    const area = this.lookArea;
    area.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (this.look) return;
      area.setPointerCapture?.(event.pointerId);
      this.look = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    });
    area.addEventListener('pointermove', (event) => {
      if (!this.look || event.pointerId !== this.look.pointerId) return;
      event.preventDefault();
      const dx = event.clientX - this.look.x, dy = event.clientY - this.look.y;
      this.look.x = event.clientX;
      this.look.y = event.clientY;
      if (dx || dy) this.onLook(dx, dy);
    });
    const end = (event) => {
      if (this.look?.pointerId === event.pointerId) this.look = null;
    };
    area.addEventListener('pointerup', end);
    area.addEventListener('pointercancel', end);
    area.addEventListener('lostpointercapture', end);
  }

  // ---- Each frame ----

  // state: { visible, gunReady, aiming, crouching, paused }
  update(state) {
    this.change('visible', Boolean(state.visible), (visible) => { this.element.hidden = !visible; });
    // 1. The gun's buttons dim while the gun can't be used (TOP view, LEAPER POV...).
    this.change('gunReady', Boolean(state.gunReady), (ready) => {
      for (const [action, { gun }] of this.definitions) if (gun) this.buttons.get(action).dataset.disabled = String(!ready);
    });
    // 2. The game is the judge of aiming: if it let go (a pause, the gun went away)
    //    the AIM button pops back up. (A tap is read by the game, which then
    //    redraws this view, before the next update arrives.)
    if (!state.aiming && this.toggled.has('aim')) this.setToggle('aim', false);
    this.change('crouching', Boolean(state.crouching), (crouching) => {
      this.buttons.get('crouch')?.setAttribute('aria-pressed', String(crouching));
    });
    // 3. While paused the PAUSE button offers RESUME, and the look area steps
    //    aside so a tap anywhere on the pause overlay resumes too.
    this.change('paused', Boolean(state.paused), (paused) => {
      const pause = this.buttons.get('pause');
      if (pause) pause.textContent = paused ? 'RESUME' : this.definitions.get('pause').label;
      this.lookArea.hidden = paused;
      if (paused) this.look = null;
    });
  }

  // Run `apply(value)` only when a value differs from the one last drawn.
  change(key, value, apply) {
    if (this.last[key] === value) return;
    this.last[key] = value;
    apply(value);
  }

  // The session is over: the controls leave the page.
  dispose() {
    this.element.remove();
    document.body.classList.remove('touch-controls-on');
  }
}
