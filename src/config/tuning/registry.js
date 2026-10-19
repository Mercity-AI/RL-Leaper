// The designer tuning registry (finding game-architecture-tuning-scattered-no-live-ui):
// one place that knows every tunable config, owns a mutable copy of each, and
// lets the developer panel change them live, copy the changes as JSON, reset
// them and remember them in this browser.
//
// The config files stay as they are, Object.freeze'd: the registry never
// touches them. When tuning is on (the developer tools: the dev server or ?dev)
// it hands out deep copies, changed in place, so a module that read a config
// once still sees every later change. When tuning is off (players) it hands out
// the frozen configs themselves, so the game is exactly as written.
// Configs the frozen brain depends on are registered read-only: shown, never changed.

// Where changes are remembered in this browser (dev only).
export const TUNING_KEY = 'leaper.tuning.v1';

// A deep copy of plain config data (objects, arrays, numbers incl. Infinity, text).
export function deepCopy(value) {
  if (Array.isArray(value)) return value.map(deepCopy);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, deepCopy(item)]));
  return value;
}

// Read a value at a dotted path ('look.mouse'); the parent object and last key
// of a path, for writing.
export function readPath(object, path) {
  return path.split('.').reduce((node, key) => node?.[key], object);
}
function parentOf(object, path) {
  const keys = path.split('.');
  const last = keys.pop();
  return { parent: keys.reduce((node, key) => node?.[key], object), last };
}

// Slider limits for a value nobody gave limits for: from 0 to four times it
// (the other way for a negative). Whole numbers of 2 or more (magazines, health,
// lenses) move in whole steps; others get no step, so the panel never rounds a
// value such as 1/7 that it did not change.
export function rangeFor(value) {
  if (value === 0) return { min: 0, max: 1 };
  const size = Math.abs(value);
  const far = Math.max(size * 4, size + 1);
  const step = Number.isInteger(value) && size >= 2 ? { step: 1 } : {};
  return value > 0 ? { min: 0, max: far, ...step } : { min: -far, max: 0, ...step };
}

export class TuningRegistry {
  // live: hand out mutable copies (tuning on). storage: where changes are
  // remembered (a localStorage-like object; only used while live).
  constructor({ live = false, storage = null, key = TUNING_KEY } = {}) {
    Object.assign(this, { live, storage, key });
    this.entries = new Map();
    this.listeners = new Set();
  }

  // ---- Registering ----

  // id: a short name ('camera'). source: the config object as written.
  // label: shown in the panel. readOnly: the whole config is never changed (the
  // brain contract). fixed: dotted paths shown but not tunable live (read once
  // at load, or owned by the player's SETTINGS). note: one line of small print.
  // limits: { 'dotted.path': { min, max, step } }.
  register(id, { source, label = id, readOnly = false, fixed = [], note = '', limits = {} }) {
    if (this.entries.has(id)) throw new Error(`Tuning config "${id}" is already registered`);
    const values = this.live && !readOnly ? deepCopy(source) : source;
    this.entries.set(id, { id, source, values, label, readOnly, fixed: new Set(fixed), note, limits });
    return values;
  }

  has(id) { return this.entries.has(id); }
  ids() { return [...this.entries.keys()]; }
  entry(id) {
    const entry = this.entries.get(id);
    if (!entry) throw new Error(`Unknown tuning config "${id}"`);
    return entry;
  }

  // What modules read: the live copy while tuning, else the frozen config itself.
  values(id) {
    return this.entry(id).values;
  }

  // The leaves of a config the panel shows: finite numbers and on/off switches,
  // also inside lists ('eyeOffset.1'). Text is never shown.
  // Each: { path, value, default, type: 'number' | 'boolean', min, max, step?, readOnly }.
  fields(id) {
    const { values, source, readOnly, fixed, limits } = this.entry(id);
    const fields = [];
    const walk = (node, prefix) => {
      for (const [key, value] of Object.entries(node)) {
        const path = prefix ? `${prefix}.${key}` : key;
        const base = { path, value, default: readPath(source, path), readOnly: readOnly || fixed.has(path) };
        if (typeof value === 'number' && Number.isFinite(value)) {
          fields.push({ ...base, type: 'number', ...rangeFor(base.default), ...limits[path] });
        } else if (typeof value === 'boolean') {
          fields.push({ ...base, type: 'boolean' });
        } else if (value && typeof value === 'object') {
          walk(value, path);
        }
      }
    };
    walk(values, '');
    return fields;
  }

  // One tunable leaf by path, or undefined.
  field(id, path) {
    return this.fields(id).find((field) => field.path === path);
  }

  // ---- Changing ----

  // Change one value live. Refused (throws) while tuning is off, for read-only
  // configs or fixed paths, for paths the panel does not show and for a value
  // of the wrong kind. Returns whether anything changed.
  set(id, path, value) {
    const entry = this.entry(id);
    if (entry.readOnly) throw new Error(`"${id}" is read-only (the frozen brain depends on it, or it is read at load)`);
    if (!this.live) throw new Error('Tuning is off (open the game with ?dev)');
    const field = this.field(id, path);
    if (!field) throw new Error(`Unknown tunable "${id}.${path}"`);
    if (field.readOnly) throw new Error(`"${id}.${path}" is not tunable live`);
    const next = field.type === 'number' ? Number(value) : value;
    if (field.type === 'number' && !Number.isFinite(next)) throw new Error(`"${id}.${path}" needs a number`);
    if (field.type === 'boolean' && typeof next !== 'boolean') throw new Error(`"${id}.${path}" needs true or false`);
    if (next === field.value) return false;
    const { parent, last } = parentOf(entry.values, path);
    parent[last] = next;
    this.save();
    this.emit(id, path, next);
    return true;
  }

  // Back to the values as written: one config, or every one.
  reset(id = null) {
    if (!this.live) return;
    for (const entry of id ? [this.entry(id)] : this.entries.values()) {
      if (entry.readOnly) continue;
      for (const field of this.fields(entry.id)) {
        if (field.readOnly || field.value === field.default) continue;
        const { parent, last } = parentOf(entry.values, field.path);
        parent[last] = field.default;
        this.emit(entry.id, field.path, field.default);
      }
    }
    this.save();
  }

  // listener(id, path, value) after every change. Returns a remover.
  onChange(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(id, path, value) {
    for (const listener of [...this.listeners]) listener(id, path, value);
  }

  // ---- Saving and sharing ----

  // Every value that differs from the config as written: { id: { path: value } }.
  overrides() {
    const changed = {};
    for (const entry of this.entries.values()) {
      if (entry.readOnly) continue;
      for (const field of this.fields(entry.id)) {
        if (!field.readOnly && field.value !== field.default) (changed[entry.id] ??= {})[field.path] = field.value;
      }
    }
    return changed;
  }

  // Apply saved changes; unknown, read-only or invalid ones are skipped.
  // Returns how many values changed.
  applyOverrides(overrides = {}) {
    let applied = 0;
    if (!overrides || typeof overrides !== 'object') return applied;
    for (const [id, paths] of Object.entries(overrides)) {
      if (!this.has(id) || this.entry(id).readOnly || !paths || typeof paths !== 'object') continue;
      for (const [path, value] of Object.entries(paths)) {
        try {
          if (this.set(id, path, value)) applied += 1;
        } catch { /* An old or broken entry: skipped. */ }
      }
    }
    return applied;
  }

  // Remember the changes in this browser (only while tuning). Nothing changed:
  // nothing saved. Private or full storage: the changes last for this page only.
  save() {
    if (!this.live || !this.storage) return;
    try {
      const changed = this.overrides();
      if (Object.keys(changed).length) this.storage.setItem(this.key, JSON.stringify(changed));
      else this.storage.removeItem(this.key);
    } catch { /* Storage refused: kept for this page only. */ }
  }

  // Read the saved changes back (only while tuning). Returns how many applied.
  load() {
    if (!this.live || !this.storage) return 0;
    let saved = null;
    try {
      saved = JSON.parse(this.storage.getItem(this.key) ?? 'null');
    } catch { /* Unreadable: nothing applied. */ }
    return this.applyOverrides(saved);
  }

  // COPY JSON: the values that differ from the config files, by config and
  // dotted path, ready to carry over into src/config/ by hand.
  changesJson() {
    return JSON.stringify(this.overrides(), null, 2);
  }
}
