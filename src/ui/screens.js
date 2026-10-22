// The game's menu screens as plain data and rules (no page), so they can be
// tested in Node: which screen a game state shows, what each menu offers, how
// "back" works, the end screen's summary and the title's brain notice. The page
// side is src/ui/GameScreens.js.

// ---- Screens ----
// Base screens follow the game state (GameFlow): the title in Ready, the pause
// menu while Paused, the end screen once the fight is decided. Sub-screens open
// on top of a base screen and close with BACK.
export const BASE_SCREENS = Object.freeze({ ready: 'title', paused: 'pause', ended: 'end' });
export const SUB_SCREENS = Object.freeze(['settings', 'controls', 'credits']);

// The base screen for a GameFlow state ({ name, ... }), or null while loading or playing.
export function baseScreen(state) {
  return BASE_SCREENS[state?.name] ?? null;
}

// ---- Menus ----
// Each item: id (what the game does, see GameScreens' actions), label, and an
// optional hint under it. Sub-screens are opened by the items named after them.
// `pausedFrom` (optional): shown only when the game was paused in that play mode.
// `dev`: a testing item, shown only with the developer tools (the dev server or
// ?dev); players never see it. The key list is not on the menus: it opens from
// SETTINGS > CONTROLS (owner, 2026-10-22).
export const MENUS = Object.freeze({
  title: Object.freeze([
    // PLAY has no hint under it (owner, 2026-10-22: short buttons, big words).
    Object.freeze({ id: 'play', label: 'PLAY' }),
    Object.freeze({ id: 'explore', label: 'EXPLORE', dev: true, hint: 'Practice: roam and shoot while the Leaper stands still.' }),
    Object.freeze({ id: 'settings', label: 'SETTINGS' }),
    Object.freeze({ id: 'credits', label: 'CREDITS' }),
  ]),
  pause: Object.freeze([
    Object.freeze({ id: 'resume', label: 'RESUME' }),
    // Explore -> the real fight, keeping everything done while exploring (where
    // everyone stands, broken legs, health), to test the Leaper from that state.
    Object.freeze({ id: 'hunt', label: 'START THE HUNT FROM HERE', pausedFrom: 'explore', dev: true,
      hint: 'The Leaper wakes up as it is now: same spot, same broken legs.' }),
    Object.freeze({ id: 'restart', label: 'RESTART' }),
    Object.freeze({ id: 'settings', label: 'SETTINGS' }),
    Object.freeze({ id: 'quit', label: 'QUIT TO TITLE' }),
  ]),
  end: Object.freeze([
    Object.freeze({ id: 'restart', label: 'RESTART' }),
    Object.freeze({ id: 'title', label: 'TITLE' }),
  ]),
});

// The items a screen shows. `available`: sub-screens that exist on this page
// (an item opening a missing one is left out). `state`: the GameFlow state, for
// items that only make sense after pausing a given play mode. `dev`: show the
// testing items too.
export function menuItems(screen, available = SUB_SCREENS, state = null, { dev = false } = {}) {
  const pausedFrom = state?.name === 'paused' ? state.resumeTo?.mode : null;
  return (MENUS[screen] ?? []).filter((item) => (!SUB_SCREENS.includes(item.id) || available.includes(item.id))
    && (!item.pausedFrom || item.pausedFrom === pausedFrom) && (!item.dev || dev));
}

// ---- The screen stack ----
// One base screen from the game state, plus the sub-screens opened on top.
export class ScreenStack {
  constructor() {
    this.base = null;
    this.stack = [];
  }

  // The screen on top (null: nothing covers the game).
  get current() {
    return this.stack.at(-1) ?? this.base;
  }

  // A menu covers the game.
  get open() {
    return this.current !== null;
  }

  // Follow a new game state. A different base screen closes every sub-screen.
  // Returns true when what is shown changed.
  sync(state) {
    const base = baseScreen(state);
    if (base === this.base) return false;
    const before = this.current;
    this.base = base;
    this.stack = [];
    return this.current !== before;
  }

  // Open a sub-screen over the current one (only over a base screen's menu).
  push(name) {
    if (!SUB_SCREENS.includes(name) || this.base === null) return false;
    this.stack.push(name);
    return true;
  }

  // BACK: close the top sub-screen. Returns false at a base screen (the caller
  // decides what back means there: the pause menu resumes, the others stay).
  back() {
    if (!this.stack.length) return false;
    this.stack.pop();
    return true;
  }
}

// ---- The end screen ----

// 83.4 -> '1:23'; 3725 -> '1:02:05'.
export function formatTime(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

// What the end screen shows for an encounter result (Encounter.end()):
//   { winner, practice, seconds, damageDealt, damageTaken, jointsBroken, turret, debugUsed }
// Returns { victory, heading, line, tags: ['PRACTICE' | 'TURRET' | 'DEBUG'], stats: [{ label, value }] }.
export function endSummary(result) {
  const victory = result?.winner === 'lola';
  const tags = [];
  if (result?.practice) tags.push('PRACTICE');
  if (result?.turret) tags.push('TURRET');
  if (result?.debugUsed) tags.push('DEBUG');
  return {
    victory,
    heading: victory ? 'VICTORY' : 'DEFEAT',
    line: victory ? 'The Leaper is down.' : 'Lola is down.',
    tags,
    stats: [
      // (Only a hunt is timed; a practice fight in EXPLORE shows a dash.)
      { label: 'TIME', value: result?.seconds > 0 ? formatTime(result.seconds) : '—' },
      { label: 'DAMAGE DEALT', value: String(Math.round(result?.damageDealt ?? 0)) },
      { label: 'DAMAGE TAKEN', value: String(Math.round(result?.damageTaken ?? 0)) },
      { label: 'KNEES BROKEN', value: String(result?.jointsBroken ?? 0) },
    ],
  };
}

// What each tag means, for the end screen's small print.
export const TAG_NOTES = Object.freeze({
  PRACTICE: 'Practice: the Leaper could not fight back for part of it.',
  TURRET: 'Turret mode: the Leaper\'s brain was offline, so it stood still.',
  DEBUG: 'Debug: a developer tool did damage.',
});

// ---- The title's brain notice ----
// A short, player-facing line about the Leaper's brain (the developer badge has
// the details): nothing once it is ready, its progress while it loads, and a
// plain explanation when it could not load.
//   brain: { ready, offline, progress: { fraction } | null }
export function brainNotice(brain) {
  if (!brain || brain.ready) return '';
  if (brain.offline) return 'The Leaper\'s brain did not load, so it will stand its ground and shoot (turret mode).';
  const fraction = brain.progress?.fraction;
  return Number.isFinite(fraction) ? `Waking the Leaper… ${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%` : 'Waking the Leaper…';
}
