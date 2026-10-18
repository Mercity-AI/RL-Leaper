import { GAME_EVENTS, reportListenerError } from './events.js';

// What the game is doing right now, as one explicit state instead of a dozen
// loose true/false flags. The states:
//   loading                      the map and Lola are still downloading
//   ready                        set up; the Leaper stands still and Lola may roam
//   playing { mode }             'hunt'    = START RUN: the Leaper searches, chases, fires
//                                'explore' = START PLAYER: only Lola moves
//   paused  { resumeTo }         everything frozen (Escape); resumeTo = the playing state
//   ended   { winner, practice } winner 'lola' | 'leaper'; practice = not won during a hunt
export const FLOW = Object.freeze({
  loading: 'loading',
  ready: 'ready',
  playing: 'playing',
  paused: 'paused',
  ended: 'ended',
});

export const PLAY_MODES = Object.freeze(['hunt', 'explore']);
export const WINNERS = Object.freeze(['lola', 'leaper']);

// Which states each state may move to. Anything else is refused. Notes:
// - ended -> playing is not allowed: a finished fight must be reset first, so
//   START PLAYER after an ending can't capture the mouse with nothing working.
// - ready / paused -> ended: the Leaper can still be shot down while stopped or
//   by the debug button; that ending counts as practice.
// - playing -> playing switches between hunt and explore directly.
export const TRANSITIONS = Object.freeze({
  loading: Object.freeze(['ready']),
  ready: Object.freeze(['playing', 'ended']),
  playing: Object.freeze(['playing', 'paused', 'ready', 'ended']),
  paused: Object.freeze(['playing', 'ready', 'ended']),
  ended: Object.freeze(['ready']),
});

// Check a state's shape and return a frozen copy. Bad shapes are programming
// errors, so they throw instead of being quietly refused.
function normalize(state) {
  const name = state?.name;
  if (name === FLOW.loading || name === FLOW.ready) return Object.freeze({ name });
  if (name === FLOW.playing) {
    if (!PLAY_MODES.includes(state.mode)) throw new Error(`Unknown play mode: ${state.mode}`);
    return Object.freeze({ name, mode: state.mode });
  }
  if (name === FLOW.paused) {
    const resumeTo = normalize(state.resumeTo);
    if (resumeTo.name !== FLOW.playing) throw new Error('Paused must resume to a playing state');
    return Object.freeze({ name, resumeTo });
  }
  if (name === FLOW.ended) {
    if (!WINNERS.includes(state.winner)) throw new Error(`Unknown winner: ${state.winner}`);
    return Object.freeze({ name, winner: state.winner, practice: Boolean(state.practice) });
  }
  throw new Error(`Unknown game state: ${name}`);
}

// Two states are the same when every field matches (pausing twice is a no-op).
function sameState(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// Staying put is always fine; otherwise the transition table decides.
function allowed(from, to) {
  return sameState(from, to) || TRANSITIONS[from.name].includes(to.name);
}

// The game-state machine: holds the one current state, refuses moves the
// table above doesn't allow, and tells listeners and the event bus about each change.
export class GameFlow {
  constructor({ events = null, initial = { name: FLOW.loading } } = {}) {
    this.events = events;
    this.current = normalize(initial);
    this.listeners = new Set();
    // Changes requested by a listener while another change is being announced
    // wait here, so everyone hears about the states in the order they happened.
    this.queue = [];
    this.notifying = false;
  }

  // The current state (a frozen object, e.g. { name: 'paused', resumeTo }).
  get state() {
    return this.current;
  }

  // True when the state may change to `next` (or already is `next`).
  canTransition(next) {
    return allowed(this.queue.at(-1) ?? this.current, normalize(next));
  }

  // Move to a new state. Returns false (and changes nothing) when the transition
  // table refuses it; returns true without notifying when it is already there.
  setState(next) {
    const target = normalize(next);
    // A change asked for mid-announcement is checked against the state it will follow.
    const base = this.queue.at(-1) ?? this.current;
    if (!allowed(base, target)) return false;
    if (sameState(base, target)) return true;
    this.queue.push(target);
    if (!this.notifying) this.drain();
    return true;
  }

  // Apply queued changes one at a time: listeners first (they keep the game's
  // systems in step), then the event bus. A listener that throws is reported but
  // never stops the others, so one broken system can't leave the brain running,
  // the mouse captured or the toolbar showing the wrong state.
  drain() {
    this.notifying = true;
    try {
      while (this.queue.length) {
        const previous = this.current;
        const target = this.queue.shift();
        this.current = target;
        for (const listener of [...this.listeners]) {
          try {
            listener(target, previous);
          } catch (error) {
            reportListenerError(error);
          }
        }
        this.events?.emit(GAME_EVENTS.flowChanged, { from: previous, to: target });
        if ((previous.name === FLOW.paused) !== (target.name === FLOW.paused)) {
          this.events?.emit(GAME_EVENTS.pauseChanged, { paused: target.name === FLOW.paused, state: target });
        }
      }
    } finally {
      this.notifying = false;
      this.queue.length = 0;
    }
  }

  // Run listener(next, previous) after every change. Returns an unsubscribe function.
  onChange(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // ---- Questions gameplay asks ("are we playing / paused / ended?") ----
  is(name, mode = null) {
    return this.current.name === name && (mode === null || this.current.mode === mode);
  }
  get loading() { return this.is(FLOW.loading); }
  get ready() { return this.is(FLOW.ready); }
  get playing() { return this.is(FLOW.playing); }
  get paused() { return this.is(FLOW.paused); }
  get ended() { return this.is(FLOW.ended); }
  // START RUN is active: the old `walking` flag.
  get hunting() { return this.is(FLOW.playing, 'hunt'); }
  // START PLAYER is active: the old `playerMode` flag.
  get exploring() { return this.is(FLOW.playing, 'explore'); }
  // The play mode in use or waiting to resume ('hunt' / 'explore'), else null.
  get playMode() {
    if (this.playing) return this.current.mode;
    if (this.paused) return this.current.resumeTo.mode;
    return null;
  }

  // ---- Named actions (each returns whether it happened) ----
  finishLoading() { return this.setState({ name: FLOW.ready }); }
  hunt() { return this.setState({ name: FLOW.playing, mode: 'hunt' }); }
  explore() { return this.setState({ name: FLOW.playing, mode: 'explore' }); }
  stop() { return this.setState({ name: FLOW.ready }); }
  pause() {
    if (this.paused) return true;
    if (!this.playing) return false;
    return this.setState({ name: FLOW.paused, resumeTo: this.current });
  }
  resume() {
    if (!this.paused) return false;
    return this.setState(this.current.resumeTo);
  }
  end(winner, practice = false) { return this.setState({ name: FLOW.ended, winner, practice }); }
}
