// Rearranging the HUD (review fix 5.25, finding
// ui-audio-movablehud-hijacks-touch-and-delays-clicks). The old always-on
// double-tap gesture swallowed Jump and joystick presses and held button clicks
// back by 350 ms. Now moving the HUD is an explicit mode, EDIT HUD LAYOUT in the
// settings: only then do the pieces listen for drags (a single press drags, the
// pieces get outlines), and outside it nothing is attached, so every click and
// tap reaches its control at once. RESET LAYOUT puts everything back. Touch
// screens and desktops keep separate layouts.

// Where layouts are saved: one entry per form factor ('touch' | 'desktop').
// (v3: the HUD moved into corner regions; older saved drags are ignored.)
export const LAYOUT_KEY = 'leaper.hud-layout.v3';
export const layoutKey = (formFactor) => `${LAYOUT_KEY}.${formFactor}`;

// The pieces a player may move, by a stable name: the Leaper's name plate, VIEW,
// Lola's health, the guns, and on touch screens the joystick and SPRINT.
export const MOVABLE_PIECES = Object.freeze({
  leaper: '#leaperHealthHud',
  view: '#cameraToggle',
  vitals: '#combatHud',
  weapons: '#playerGuns',
  joystick: '#joyBase',
  sprint: '#btnSprint',
});

// Keep a piece fully on screen: its top-left corner, given its size and the window's.
export function clampPanelPosition(x, y, width, height, viewportWidth, viewportHeight) {
  return {
    x: Math.max(0, Math.min(x, Math.max(0, viewportWidth - width))),
    y: Math.max(0, Math.min(y, Math.max(0, viewportHeight - height))),
  };
}

// The inline styles a moved piece gets (and loses again on RESET).
const PLACED = ['position', 'left', 'top', 'right', 'bottom', 'transform', 'margin'];

export class HudLayout {
  // pieces: [[name, element]] (missing elements are skipped). formFactor:
  // 'touch' | 'desktop'. storage: localStorage by default. win: the window.
  constructor({ pieces = [], formFactor = 'desktop', storage = globalThis.localStorage ?? null, win = globalThis.window } = {}) {
    Object.assign(this, { formFactor, storage, win });
    this.pieces = pieces.filter(([, element]) => element);
    this.editing = false;
    this.drag = null;
    // 1. The saved layout for this form factor (positions as shares of the window).
    this.saved = this.load();
    // 2. Saved positions are applied now and again whenever the window changes size.
    this.onResize = () => this.restore();
    win?.addEventListener?.('resize', this.onResize);
    this.restore();
    // 3. Drag handlers, attached only while editing, in the capture phase so the
    //    piece's own handlers (VIEW's click, the joystick) never see the drag.
    this.handlers = {
      pointerdown: (event) => this.start(event),
      pointermove: (event) => this.move(event),
      pointerup: (event) => this.end(event),
      pointercancel: (event) => this.end(event),
      click: (event) => { event.preventDefault(); event.stopImmediatePropagation(); },
    };
  }

  load() {
    try {
      const value = JSON.parse(this.storage?.getItem(layoutKey(this.formFactor)) ?? '{}');
      return value && typeof value === 'object' ? value : {};
    } catch {
      return {};
    }
  }

  save() {
    try {
      this.storage?.setItem(layoutKey(this.formFactor), JSON.stringify(this.saved));
    } catch { /* Private storage: the layout lasts for this page only. */ }
  }

  // Put a piece at window pixels (x, y), kept on screen. Returns where it went.
  place(element, x, y) {
    const box = element.getBoundingClientRect();
    const p = clampPanelPosition(Math.round(x), Math.round(y), box.width, box.height, this.win.innerWidth, this.win.innerHeight);
    Object.assign(element.style, { position: 'fixed', left: `${p.x}px`, top: `${p.y}px`, right: 'auto', bottom: 'auto',
      transform: 'none', margin: '0' });
    return p;
  }

  // Every saved piece back where it was saved (shown pieces only).
  restore() {
    for (const [name, element] of this.pieces) {
      const spot = this.saved[name];
      if (!spot || !Number.isFinite(spot.x) || !Number.isFinite(spot.y) || !element.getClientRects?.().length) continue;
      this.place(element, spot.x * this.win.innerWidth, spot.y * this.win.innerHeight);
    }
  }

  // ---- Editing ----

  // EDIT HUD LAYOUT on / off: outlines and drag handlers only while on.
  setEditing(on) {
    on = Boolean(on);
    if (on === this.editing) return;
    this.editing = on;
    globalThis.document?.body?.classList.toggle('hud-editing', on);
    for (const [, element] of this.pieces) {
      element.classList.toggle('movable-hud', on);
      for (const [type, handler] of Object.entries(this.handlers)) {
        if (on) element.addEventListener(type, handler, true);
        else element.removeEventListener(type, handler, true);
      }
    }
    if (!on) this.drag = null;
  }

  // A single press starts a drag (editing only; the handlers exist only then).
  start(event) {
    if (event.button !== undefined && event.button !== 0) return;
    const element = event.currentTarget;
    const name = this.pieces.find(([, item]) => item === element)?.[0];
    if (!name) return;
    const box = element.getBoundingClientRect();
    this.drag = { name, element, pointer: event.pointerId, dx: event.clientX - box.left, dy: event.clientY - box.top };
    element.classList.add('hud-dragging');
    element.setPointerCapture?.(event.pointerId);
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  move(event) {
    const drag = this.drag;
    if (!drag || drag.pointer !== event.pointerId) return;
    const p = this.place(drag.element, event.clientX - drag.dx, event.clientY - drag.dy);
    this.saved[drag.name] = { x: p.x / this.win.innerWidth, y: p.y / this.win.innerHeight };
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  end(event) {
    const drag = this.drag;
    if (!drag || drag.pointer !== event.pointerId) return;
    this.drag = null;
    drag.element.classList.remove('hud-dragging');
    if (drag.element.hasPointerCapture?.(event.pointerId)) drag.element.releasePointerCapture(event.pointerId);
    this.save();
    event.stopImmediatePropagation();
  }

  // RESET LAYOUT: this form factor's saved layout is forgotten and every piece
  // goes back to its corner.
  reset() {
    this.saved = {};
    try {
      this.storage?.removeItem?.(layoutKey(this.formFactor));
    } catch { /* Private storage. */ }
    for (const [, element] of this.pieces) for (const property of PLACED) element.style[property] = '';
  }

  // The session is over: no listeners left behind.
  dispose() {
    this.setEditing(false);
    this.win?.removeEventListener?.('resize', this.onResize);
  }
}
