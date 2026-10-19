import { CAMERA } from '../config/camera.js';

// The player's settings as plain data: what each setting is, its limits, how it
// is stored in this browser, and the sections the SETTINGS screen shows. Pure
// enough to test in Node; the screen itself is src/ui/SettingsScreen.js and the
// game applies the values in src/ui/GameUi.js.
//
// Extension point: settings.registerSection({ id, title, order, build }) adds or
// replaces a section of the SETTINGS screen from any module (the audio work
// replaces the placeholder 'audio' section with its volume controls this way).

// Where the settings live in this browser (bump the version if their meaning changes).
export const SETTINGS_KEY = 'leaper.settings.v1';

// Every setting and its default.
//   sensitivity  look speed for mouse, touch and stick (1 = the game's default)
//   invertY      up/down look inverted
//   fov          the chase view's vertical field of view, in degrees
//   textSize     'normal' | 'large' (every HUD and menu text 25% bigger)
//   captions     short captions for sound cues ("[Leaper's eye charges]")
//   sound        the whole game's sound on or off
export const SETTING_DEFAULTS = Object.freeze({
  sensitivity: CAMERA.look.sensitivity,
  invertY: CAMERA.look.invertY,
  fov: CAMERA.chaseFov,
  textSize: 'normal',
  captions: false,
  sound: true,
});

// Slider limits.
export const SETTING_LIMITS = Object.freeze({
  sensitivity: Object.freeze({ min: 0.25, max: 3, step: 0.05 }),
  fov: Object.freeze({ min: 50, max: 85, step: 1 }),
});

const TEXT_SIZES = Object.freeze(['normal', 'large']);

// A clean copy: unknown keys dropped, numbers clamped, wrong types back to default.
export function normalizeSettings(raw = {}) {
  const value = { ...SETTING_DEFAULTS };
  const number = (key) => {
    const n = Number(raw?.[key]);
    if (!Number.isFinite(n)) return;
    const { min, max } = SETTING_LIMITS[key];
    value[key] = Math.min(max, Math.max(min, n));
  };
  number('sensitivity');
  number('fov');
  for (const key of ['invertY', 'captions', 'sound']) if (typeof raw?.[key] === 'boolean') value[key] = raw[key];
  if (TEXT_SIZES.includes(raw?.textSize)) value.textSize = raw.textSize;
  return value;
}

// The browser's storage, if the page may use it (private modes may refuse).
function defaultStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export class Settings {
  // storage: something with getItem / setItem (localStorage by default; null = memory only).
  constructor({ storage = defaultStorage() } = {}) {
    this.storage = storage;
    this.listeners = new Set();
    this.sectionList = [];
    this.version = 0;
    // 1. The saved values, cleaned (a broken or old entry falls back to defaults).
    let saved = {};
    try {
      saved = JSON.parse(this.storage?.getItem(SETTINGS_KEY) ?? '{}') ?? {};
    } catch { /* Unreadable: start from the defaults. */ }
    this.values = normalizeSettings(saved);
  }

  get(key) {
    return this.values[key];
  }

  // Change one setting: cleaned, saved, and every listener told (key, value, values).
  set(key, value) {
    if (!(key in SETTING_DEFAULTS)) throw new Error(`Unknown setting: ${key}`);
    const next = normalizeSettings({ ...this.values, [key]: value });
    if (next[key] === this.values[key]) return false;
    this.values = next;
    this.save();
    for (const listener of [...this.listeners]) listener(key, next[key], next);
    return true;
  }

  // Everything back to the defaults (saved, and every listener told).
  reset() {
    for (const key of Object.keys(SETTING_DEFAULTS)) this.set(key, SETTING_DEFAULTS[key]);
  }

  save() {
    try {
      this.storage?.setItem(SETTINGS_KEY, JSON.stringify(this.values));
    } catch { /* Private storage: the settings last for this page only. */ }
  }

  // listener(key, value, values) after every change. Returns a remover.
  onChange(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // ---- Sections of the SETTINGS screen ----

  // section: { id, title, order (lower = higher up), build(container, api) }.
  // The same id replaces the earlier section. Returns a remover.
  registerSection(section) {
    if (!section?.id || typeof section.build !== 'function') throw new Error('A settings section needs an id and a build()');
    this.sectionList = this.sectionList.filter((item) => item.id !== section.id).concat(section)
      .sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
    this.version += 1;
    return () => {
      this.sectionList = this.sectionList.filter((item) => item !== section);
      this.version += 1;
    };
  }

  // Register a section only if none with that id exists yet (built-in placeholders).
  registerDefaultSection(section) {
    if (this.sectionList.some((item) => item.id === section.id)) return () => {};
    return this.registerSection(section);
  }

  sections() {
    return [...this.sectionList];
  }
}

// The page's one settings store.
export const settings = new Settings();
