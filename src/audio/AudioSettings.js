// The player's sound settings: master, effects, music & ambience and interface
// volumes (0-1) and mute. Remembered in this browser (localStorage) and shared
// by everything that shows or uses them: the audio engine listens for changes,
// the settings view and the toolbar's SOUND button change them.

export const AUDIO_SETTINGS_KEY = 'leaper.audio';
export const AUDIO_SETTINGS_DEFAULTS = Object.freeze({ master: 1, sfx: 1, ambience: 1, ui: 1, muted: false });
export const VOLUME_NAMES = Object.freeze(['master', 'sfx', 'ambience', 'ui']);

// The browser's storage, or nothing when it is blocked (private windows, tests).
function browserStorage() {
  try {
    return globalThis.window?.localStorage ?? null;
  } catch {
    return null;
  }
}

export class AudioSettings {
  // storage: where the choice is remembered (localStorage by default; null = this page only).
  constructor({ storage = browserStorage(), key = AUDIO_SETTINGS_KEY } = {}) {
    this.storage = storage;
    this.key = key;
    this.listeners = new Set();
    this.values = { ...AUDIO_SETTINGS_DEFAULTS, ...this.load() };
  }

  // A volume (0-1) or 'muted'.
  get(name) {
    return this.values[name];
  }

  get muted() { return this.values.muted; }
  set muted(value) { this.set('muted', Boolean(value)); }

  // Change one setting: volumes are clamped to 0-1, then remembered and announced.
  set(name, value) {
    if (name === 'muted') value = Boolean(value);
    else if (VOLUME_NAMES.includes(name)) value = Math.max(0, Math.min(1, Number(value) || 0));
    else return;
    if (this.values[name] === value) return;
    this.values[name] = value;
    this.save();
    for (const listener of [...this.listeners]) listener(name, value, this.values);
  }

  // Back to full volume, sound on.
  reset() {
    for (const [name, value] of Object.entries(AUDIO_SETTINGS_DEFAULTS)) this.set(name, value);
  }

  // Listen for changes: listener(name, value, allValues). Returns a function that stops listening.
  onChange(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // ---- Remembering ----

  load() {
    try {
      const saved = JSON.parse(this.storage?.getItem(this.key) ?? 'null');
      if (!saved || typeof saved !== 'object') return {};
      const values = {};
      for (const name of VOLUME_NAMES) if (Number.isFinite(saved[name])) values[name] = Math.max(0, Math.min(1, saved[name]));
      if (typeof saved.muted === 'boolean') values.muted = saved.muted;
      return values;
    } catch {
      return {};
    }
  }

  save() {
    try {
      this.storage?.setItem(this.key, JSON.stringify(this.values));
    } catch { /* Private storage: the choice lasts for this page only. */ }
  }
}
