// Captions for sound cues (Settings > Accessibility > Captions), so a player who
// can't hear the game still gets its warnings. Each cue is a game event (the
// event bus, src/core/events.js) and the line shown when it happens.
//
// Mount point for the Leaper's new sounds: the boss behaviour work emits the
// events below as its moves happen (stomp, leap, landing, collapse, the eye's
// telegraph); any name not emitted yet simply never shows. Add a cue here (or
// with addCaptionCue) to caption a new sound.
export const CAPTION_CUES = {
  lolaDamaged: '[Laser hits Lola]',
  jointBroken: '[A Leaper knee snaps]',
  leaperTelegraph: '[The Leaper\'s eye charges]',
  leaperStomp: '[Stomp]',
  leaperLeap: '[The Leaper leaps]',
  leaperLanding: '[Heavy landing]',
  leaperCollapse: '[The Leaper collapses]',
};

// Add (or change) the caption for an event.
export function addCaptionCue(event, text) {
  CAPTION_CUES[event] = text;
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
