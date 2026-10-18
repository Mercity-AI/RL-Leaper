// A tiny publish / subscribe bus, so systems can announce what happened ("Lola
// was hit", "the fight ended") without holding references to whoever cares.

// Every event name the game emits, in one place. Payloads:
//   encounterStarted { snapshot }            a fresh fight began (START RUN after a reset)
//   encounterEnded   { winner, practice, stats }   winner: 'lola' | 'leaper'
//   lolaDamaged      { amount, health }       a Leaper bolt hit Lola
//   leaperDamaged    { amount, health, major }  a bullet (or the debug button) hurt the Leaper
//   jointBroken      { health }               a shot snapped one of the Leaper's knees
//   pauseChanged     { paused, state }        the game entered or left Paused
//   flowChanged      { from, to }             any GameFlow state change
export const GAME_EVENTS = Object.freeze({
  encounterStarted: 'encounterStarted',
  encounterEnded: 'encounterEnded',
  lolaDamaged: 'lolaDamaged',
  leaperDamaged: 'leaperDamaged',
  jointBroken: 'jointBroken',
  pauseChanged: 'pauseChanged',
  flowChanged: 'flowChanged',
});

// A listener that throws is reported like any other page error, but it never
// interrupts the code that emitted the event (a broken HUD must not stop damage).
// GameFlow uses the same rule for its state-change listeners.
export function reportListenerError(error) {
  if (typeof globalThis.reportError === 'function') globalThis.reportError(error);
  else console.error(error);
}

export class EventBus {
  constructor() {
    this.listeners = new Map();
  }

  // Listen for an event. Returns a function that stops listening.
  on(name, listener) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name).add(listener);
    return () => this.off(name, listener);
  }

  // Listen for the next occurrence only.
  once(name, listener) {
    const off = this.on(name, (payload) => {
      off();
      listener(payload);
    });
    return off;
  }

  off(name, listener) {
    const set = this.listeners.get(name);
    if (!set) return;
    set.delete(listener);
    if (!set.size) this.listeners.delete(name);
  }

  // Tell every current listener. A copy is walked, so listeners may add or remove
  // listeners (including themselves) while the event is being delivered.
  emit(name, payload) {
    const set = this.listeners.get(name);
    if (!set) return;
    for (const listener of [...set]) {
      try {
        listener(payload);
      } catch (error) {
        reportListenerError(error);
      }
    }
  }

  // Drop every listener (used when a mode is disposed).
  clear() {
    this.listeners.clear();
  }
}

export function createEventBus() {
  return new EventBus();
}
