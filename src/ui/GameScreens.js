import '../styles/ui/screens.css';
import { ScreenStack, SUB_SCREENS, TAG_NOTES, brainNotice, endSummary, menuItems } from './screens.js';
import { PAD_AXES } from '../input/actions.js';

// The game's menu screens on top of the game state (GameFlow): the TITLE in
// Ready, the PAUSE menu while Paused, the END screen once the fight is decided,
// plus SETTINGS, CONTROLS and CREDITS opened from them. The rules (which screen,
// which items, what BACK does) are plain data in src/ui/screens.js; this class
// is the page side.
//
// Every device can drive the menus:
//   mouse / touch  press the buttons
//   keyboard       arrows move, Enter or Space selects, Escape or Backspace goes back
//   gamepad        D-pad or left stick moves, A selects, B goes back, Start resumes
// Keyboard and gamepad arrive as the input actions menuUp / menuDown / menuLeft /
// menuRight / menuConfirm / menuBack (src/input/actions.js), read once per frame
// in handleInput(). While a menu is open the input controller reports no gameplay
// actions, so nothing fires or jumps behind it.

// Left-stick menu steps: how far the stick must tilt, and the repeat delay while held.
const STICK = Object.freeze({ tilt: 0.55, repeat: 0.32 });
// What counts as a focusable control inside a screen.
const FOCUSABLE = 'button:not([disabled]), select:not([disabled]), input:not([disabled]), [tabindex="0"]';

const escape = (text) => String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const editable = (element) => /^(INPUT|SELECT|TEXTAREA)$/.test(element?.tagName ?? '');

export class GameScreens {
  // actions: what the menu items do: { play, explore, resume, hunt, restart, quit, title }.
  // announce(text): a line for screen readers (the HUD's live region).
  // onOpenChange(open): a menu started (true) or stopped (false) covering the game.
  // hint: the title's small print (how to see the controls in the fight).
  constructor({ parent = document.body, actions = {}, announce = () => {}, onOpenChange = () => {}, hint = '' } = {}) {
    Object.assign(this, { actions, announce, onOpenChange, hint });
    // 1. The root: a veil over the game with one screen shown at a time.
    this.root = document.createElement('div');
    this.root.id = 'screens';
    this.root.className = 'screens-root';
    this.root.hidden = true;
    parent.append(this.root);
    this.stack = new ScreenStack();
    // 2. The screens: base screens built now, sub-screens when first opened.
    this.screens = new Map();
    this.definitions = new Map();
    for (const name of ['title', 'pause', 'end']) this.screens.set(name, this.buildBase(name));
    // 3. One click handler for every menu item and BACK button, and a Tab loop
    //    that keeps keyboard focus inside the open screen.
    this.root.addEventListener('click', (event) => this.onClick(event));
    this.root.addEventListener('keydown', (event) => this.onKeyDown(event));
    // 4. Per-frame state: was a menu open at the last input poll (presses made
    //    before it opened don't count), the stick's repeat timer, the last result.
    this.openAtLastPoll = false;
    this.stickTimer = 0;
    this.stickDirection = 0;
    this.result = null;
    this.last = {};
    // Out of sight for a moment (HUD layout editing), though still open.
    this.suspended = false;
  }

  // ---- Building ----

  // A screen's frame: a dialog with a heading, a body and (for sub-screens) BACK.
  frame(name, title, { sub = false } = {}) {
    const section = document.createElement('section');
    section.className = 'screen';
    section.dataset.screen = name;
    section.hidden = true;
    section.setAttribute('role', 'dialog');
    section.setAttribute('aria-modal', 'true');
    section.setAttribute('aria-labelledby', `screen-${name}-heading`);
    section.innerHTML = `<header class="screen-header"><h2 class="screen-heading" id="screen-${name}-heading">${escape(title)}</h2></header>`
      + `<div class="screen-body"></div>${sub ? '<footer class="screen-footer"><button type="button" class="menu-item menu-back" data-menu-back>BACK</button></footer>' : ''}`;
    this.root.append(section);
    return { element: section, body: section.querySelector('.screen-body'), heading: section.querySelector('.screen-heading') };
  }

  // The title, pause and end screens (their menus are filled in when shown).
  buildBase(name) {
    const screen = this.frame(name, { title: 'LEAPER', pause: 'PAUSED', end: '' }[name]);
    if (name === 'title') {
      screen.element.querySelector('.screen-header').insertAdjacentHTML('beforeend',
        '<p class="screen-tagline">Bring down the six-legged machine.</p>');
      screen.body.insertAdjacentHTML('beforeend', '<nav class="menu" aria-label="Main menu"></nav>'
        + '<p class="screen-notice" data-brain-notice hidden></p>'
        + `<p class="screen-hint">${escape(this.hint)}</p>`);
    } else if (name === 'end') {
      screen.body.insertAdjacentHTML('beforeend', '<p class="end-line" data-end-line></p><ul class="end-tags" data-end-tags></ul>'
        + '<dl class="end-stats" data-end-stats></dl><nav class="menu" aria-label="After the fight"></nav><p class="end-notes" data-end-notes></p>');
    } else {
      screen.body.insertAdjacentHTML('beforeend', '<nav class="menu" aria-label="Pause menu"></nav>');
    }
    return screen;
  }

  // Fill a base screen's menu with its items (sub-screens only if defined).
  renderMenu(name) {
    const nav = this.screens.get(name).body.querySelector('.menu');
    const items = menuItems(name, [...this.definitions.keys()], this.state);
    nav.innerHTML = items.map((item, index) => `<button type="button" class="menu-item${index === 0 ? ' menu-primary' : ''}" data-menu-item="${escape(item.id)}">`
      + `<span>${escape(item.label)}</span>${item.hint ? `<small>${escape(item.hint)}</small>` : ''}</button>`).join('');
  }

  // The end screen's text for the fight just finished.
  renderEnd() {
    const screen = this.screens.get('end');
    const summary = endSummary(this.result);
    screen.element.dataset.victory = String(summary.victory);
    screen.heading.textContent = summary.heading;
    screen.body.querySelector('[data-end-line]').textContent = summary.line;
    screen.body.querySelector('[data-end-tags]').innerHTML = summary.tags.map((tag) => `<li>${escape(tag)}</li>`).join('');
    screen.body.querySelector('[data-end-stats]').innerHTML = summary.stats
      .map(({ label, value }) => `<div><dt>${escape(label)}</dt><dd>${escape(value)}</dd></div>`).join('');
    screen.body.querySelector('[data-end-notes]').textContent = summary.tags.map((tag) => TAG_NOTES[tag]).join(' ');
    return summary;
  }

  // Add a sub-screen (settings, controls, credits): its title and a build(body)
  // that fills it once, plus an optional onShow() each time it opens.
  defineScreen(name, { title, build, onShow = null }) {
    if (!SUB_SCREENS.includes(name)) throw new Error(`Unknown sub-screen: ${name}`);
    this.definitions.set(name, { title, build, onShow, built: null });
    // Base menus gain the item that opens it.
    if (this.stack.base) this.show();
  }

  // The built sub-screen (built the first time it opens).
  subScreen(name) {
    const definition = this.definitions.get(name);
    if (!definition.built) {
      definition.built = this.frame(name, definition.title, { sub: true });
      definition.build(definition.built.body, this);
    }
    return definition.built;
  }

  // ---- What is shown ----

  // A menu covers the game.
  get open() {
    return this.stack.open;
  }

  // Step aside while the HUD layout is edited (the menus stay open underneath).
  setSuspended(on) {
    this.suspended = Boolean(on);
    this.root.hidden = this.current === null || this.suspended;
  }

  // The name of the screen on top (null: none).
  get current() {
    return this.stack.current;
  }

  // Follow the game state. result: the encounter's result (for the end screen).
  sync(state, { result = null } = {}) {
    if (state?.name === 'ended') this.result = result;
    // (The pause menu's items depend on the mode that was paused.)
    this.state = state;
    const wasOpen = this.open;
    if (!this.stack.sync(state)) return;
    this.show();
    if (wasOpen !== this.open) this.onOpenChange(this.open);
    // A line for screen readers on the moments that matter.
    if (this.current === 'pause') this.announce('Paused.');
    else if (this.current === 'end') this.announce(`${endSummary(this.result).heading}. ${endSummary(this.result).line}`);
    else if (!this.open) this.announce('');
  }

  // Draw the screen on top and move keyboard focus into it.
  show() {
    const current = this.current;
    this.root.hidden = current === null || this.suspended;
    this.root.dataset.base = this.stack.base ?? '';
    this.root.dataset.screen = current ?? '';
    for (const [name, { element }] of this.screens) element.hidden = name !== current;
    for (const [name, definition] of this.definitions) if (definition.built) definition.built.element.hidden = name !== current;
    if (current === null) {
      // Closing: nothing in the menu keeps focus (Enter must never re-trigger it).
      if (this.root.contains(document.activeElement)) document.activeElement.blur();
      return;
    }
    if (this.screens.has(current)) this.renderMenu(current);
    if (current === 'end') this.renderEnd();
    if (this.definitions.has(current)) {
      this.subScreen(current).element.hidden = false;
      this.definitions.get(current).onShow?.();
    }
    this.focusFirst();
  }

  // The open screen's element.
  currentElement() {
    const current = this.current;
    if (!current) return null;
    return this.screens.get(current)?.element ?? this.definitions.get(current)?.built?.element ?? null;
  }

  // Keyboard focus on the screen's first control (the main menu item).
  focusFirst() {
    this.focusables()[0]?.focus({ preventScroll: true });
  }

  focusables() {
    const element = this.currentElement();
    return element ? [...element.querySelectorAll(FOCUSABLE)].filter((item) => item.offsetParent !== null || item === document.activeElement) : [];
  }

  // ---- Choosing ----

  onClick(event) {
    const back = event.target.closest('[data-menu-back]');
    if (back) {
      this.back('pointer');
      return;
    }
    const item = event.target.closest('[data-menu-item]');
    if (item) this.activate(item.dataset.menuItem);
  }

  // A menu item: open its sub-screen, or ask the game to do it.
  activate(id) {
    if (SUB_SCREENS.includes(id)) {
      if (this.stack.push(id)) this.show();
      return;
    }
    this.actions[id]?.();
  }

  // BACK: close the sub-screen on top (focus returns to the item that opened
  // it). At the pause menu the gamepad's B resumes the game; the keyboard's
  // Escape does not: browsers spend Escape on letting go of the mouse, and a
  // game resumed by it could not capture the mouse again. (RESUME, focused when
  // the menu opens, takes Enter.)
  back(device = 'keyboard') {
    const closing = this.current;
    if (this.stack.back()) {
      this.show();
      this.currentElement()?.querySelector(`[data-menu-item="${closing}"]`)?.focus({ preventScroll: true });
      return;
    }
    if (this.current === 'pause' && device === 'gamepad') this.actions.resume?.();
    else this.focusFirst();
  }

  // Keyboard: Tab stays inside the open screen. On a slider, list or tick box
  // (which the game's input leaves alone) the keys work as everywhere else in the
  // menus: up / down move between rows, left / right change the value, Escape
  // goes back. (A slider keeps the browser's own left / right.)
  onKeyDown(event) {
    if (editable(event.target)) {
      const step = { ArrowUp: -1, ArrowDown: 1 }[event.key];
      const change = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
      if (event.key === 'Escape') this.back();
      else if (step) this.move(step);
      else if (change && event.target.type !== 'range') this.adjust(change);
      else return;
      event.preventDefault();
      return;
    }
    if (event.key !== 'Tab') return;
    const items = this.focusables();
    if (!items.length) return;
    const index = items.indexOf(document.activeElement);
    const next = event.shiftKey ? (index <= 0 ? items.length - 1 : index - 1) : (index + 1) % items.length;
    event.preventDefault();
    items[next].focus();
  }

  // ---- Keyboard and gamepad, once per frame ----

  // input: the game's InputController (already polled this frame). Presses made
  // before a menu opened (the Escape that paused) are ignored: only frames that
  // started with a menu already open are read.
  handleInput(input, dt = 0) {
    const ready = this.openAtLastPoll && this.open;
    this.openAtLastPoll = this.open;
    if (!ready) return;
    if (input.pressed('menuUp')) this.move(-1);
    if (input.pressed('menuDown')) this.move(1);
    if (input.pressed('menuLeft')) this.adjust(-1);
    if (input.pressed('menuRight')) this.adjust(1);
    if (input.pressed('menuConfirm')) this.confirm();
    if (input.pressed('menuBack')) this.back(input.pressedBy?.('menuBack') ?? 'keyboard');
    // The gamepad's left stick (forward = up; the arrow keys are menuUp / menuDown).
    this.stick(input.pad?.axes?.[PAD_AXES.leftY] ?? 0, dt);
  }

  // The left stick steps through the items, repeating while held.
  stick(y, dt) {
    const direction = y > STICK.tilt ? -1 : y < -STICK.tilt ? 1 : 0;
    if (direction !== this.stickDirection) {
      this.stickDirection = direction;
      this.stickTimer = STICK.repeat;
      if (direction) this.move(direction);
      return;
    }
    if (!direction) return;
    this.stickTimer -= dt;
    if (this.stickTimer <= 0) {
      this.stickTimer = STICK.repeat;
      this.move(direction);
    }
  }

  // Focus the previous / next control in the open screen (wrapping around).
  move(step) {
    const items = this.focusables();
    if (!items.length) return;
    const index = items.indexOf(document.activeElement);
    const next = index < 0 ? 0 : (index + step + items.length) % items.length;
    items[next].focus({ preventScroll: false });
    items[next].scrollIntoView?.({ block: 'nearest' });
  }

  // Left / right change the focused setting: a slider steps, a list picks the
  // neighbouring option, a tick box flips.
  adjust(step) {
    const control = document.activeElement;
    if (!this.root.contains(control)) return;
    if (control.type === 'range') {
      if (step > 0) control.stepUp(); else control.stepDown();
    } else if (control.tagName === 'SELECT') {
      control.selectedIndex = Math.max(0, Math.min(control.options.length - 1, control.selectedIndex + step));
    } else if (control.type === 'checkbox') {
      control.checked = step > 0;
    } else {
      return;
    }
    control.dispatchEvent(new Event('input', { bubbles: true }));
    control.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // A / Space: press the focused control.
  confirm() {
    const control = document.activeElement;
    if (this.root.contains(control) && control.tagName !== 'SELECT') control.click();
    else if (!this.root.contains(control)) this.focusFirst();
  }

  // ---- Each frame ----

  // brain: { ready, offline, progress } for the title's notice (written on changes only).
  update({ brain = null } = {}) {
    if (this.current !== 'title') return;
    const text = brainNotice(brain);
    if (this.last.notice === text) return;
    this.last.notice = text;
    const notice = this.screens.get('title').body.querySelector('[data-brain-notice]');
    notice.textContent = text;
    notice.hidden = !text;
  }

  // The session is over: the screens leave the page.
  dispose() {
    this.root.remove();
  }
}
