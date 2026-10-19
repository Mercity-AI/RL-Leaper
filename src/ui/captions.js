// Captions for sound cues (Settings > Accessibility > Captions), so a player who
// can't hear the game still gets its warnings. Each cue is a game event (the
// event bus: GAME_EVENTS in src/core/events.js, LEAPER_EVENTS in
// src/actors/leaper/leaperEvents.js) and the line shown when it happens: a
// fixed line, or a function of the event's payload that returns the line (or
// null for no caption). Add a cue here (or with addCaptionCue) to caption a new sound.

// The Leaper's attacks share one event, { kind, phase }; one line per phase
// that plays a sound (a called-off leap is silent).
export const ATTACK_CAPTIONS = Object.freeze({
  stomp: Object.freeze({ windup: '[The Leaper rears up to stomp]', impact: '[Stomp]' }),
  leap: Object.freeze({ windup: '[The Leaper crouches to leap]', launch: '[The Leaper leaps]', land: '[Heavy landing]' }),
});

export const CAPTION_CUES = {
  // (A stomp or a landing hurts Lola too, so the hit itself names no weapon.)
  lolaDamaged: '[Lola is hit]',
  jointBroken: '[A Leaper knee snaps]',
  leaperAttack: ({ kind, phase } = {}) => ATTACK_CAPTIONS[kind]?.[phase] ?? null,
  leaperStaggered: '[The Leaper staggers]',
  // (Getting up again is silent.)
  leaperDowned: ({ rising = false } = {}) => (rising ? null : '[The Leaper crashes down]'),
  leaperDied: '[The Leaper collapses]',
};

// The eye winding up a bolt has no event of its own (the attack code only plays
// its sound): the game's front end watches each Leaper's charge with
// ChargeWatch and shows this line when a new one starts.
export const EYE_CHARGE_CAPTION = '[The Leaper\'s eye charges]';

// Add (or change) the caption for an event: a line, or payload => line | null.
export function addCaptionCue(event, text) {
  CAPTION_CUES[event] = text;
}

// The line for one event and its payload, or null when it shows none.
export function captionFor(event, payload) {
  const cue = CAPTION_CUES[event];
  const line = typeof cue === 'function' ? cue(payload ?? {}) : cue;
  return line || null;
}

// Rising edges of each Leaper's eye charge: started(index, charging) is true on
// the frame a new wind-up begins (not while it lasts, not when it stops).
export class ChargeWatch {
  constructor() {
    this.charging = [];
  }

  started(index, charging) {
    const began = Boolean(charging) && !this.charging[index];
    this.charging[index] = Boolean(charging);
    return began;
  }
}

// How long a caption stays (seconds) and how many show at once.
export const CAPTION_TIME = 2.5;
export const CAPTION_LINES = 2;

// The captions' lines as plain data: add(text) and advance(dt); `lines` is
// what to show. Returns true from either when the shown lines changed.
export class CaptionQueue {
  constructor({ time = CAPTION_TIME, lines = CAPTION_LINES } = {}) {
    Object.assign(this, { time, max: lines });
    this.lines = [];
  }

  // A cue happened: show its line (the same line again only restarts its clock).
  add(text) {
    const same = this.lines.find((line) => line.text === text);
    if (same) {
      same.left = this.time;
      return false;
    }
    this.lines.push({ text, left: this.time });
    if (this.lines.length > this.max) this.lines.shift();
    return true;
  }

  // Time passes (game time: captions hold while paused).
  advance(dt) {
    const before = this.lines.length;
    for (const line of this.lines) line.left -= dt;
    this.lines = this.lines.filter((line) => line.left > 0);
    return this.lines.length !== before;
  }

  clear() {
    const had = this.lines.length > 0;
    this.lines = [];
    return had;
  }
}

// The page side: the lines under the top of the screen (in the HUD's top-centre region).
export class CaptionsView {
  constructor(parent = null) {
    this.queue = new CaptionQueue();
    this.element = document.createElement('div');
    this.element.className = 'hud-captions';
    this.element.hidden = true;
    parent?.append(this.element);
  }

  add(text) {
    if (this.queue.add(text)) this.draw();
  }

  update(dt) {
    if (this.queue.advance(dt)) this.draw();
  }

  clear() {
    if (this.queue.clear()) this.draw();
  }

  // Redraw the lines (only when they changed).
  draw() {
    this.element.replaceChildren(...this.queue.lines.map((line) => Object.assign(document.createElement('p'), { textContent: line.text })));
    this.element.hidden = !this.queue.lines.length;
  }

  dispose() {
    this.element.remove();
  }
}
