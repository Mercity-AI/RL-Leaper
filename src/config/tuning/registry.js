// The designer tuning registry (finding game-architecture-tuning-scattered-no-live-ui):
// one place that knows every tunable config, owns a mutable copy of each, and
// lets the developer panel change them live, copy them as JSON, reset them and
// remember the changes in this browser.
//
// The config files stay as they are, Object.freeze'd: the registry never
// touches them. When tuning is on (the dev server, ?dev or ?tune) it hands out
// deep copies, changed in place, so a module that read a config once still sees
// every later change. When tuning is off (players) it hands out the frozen
// configs themselves, so the game is exactly as written and pays nothing.
// Configs the frozen brain depends on are registered read-only: shown, never changed.

// Where changes are remembered in this browser (dev only).
export const TUNING_KEY = 'leaper.tuning.v1';

// A deep copy of plain config data (objects, arrays, numbers incl. Infinity, text).
export function deepCopy(value) {
  if (Array.isArray(value)) return value.map(deepCopy);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, deepCopy(item)]));
  return value;
}

// Read / write a value at a dotted path ('look.sensitivity').
export function readPath(object, path) {
  return path.split('.').reduce((node, key) => node?.[key], object);
}
function parentOf(object, path) {
  const keys = path.split('.');
  const last = keys.pop();
  return { parent: keys.reduce((node, key) => node?.[key], object), last };
}

// Slider limits for a value nobody gave limits for: from 0 to four times it
// (the other way for a negative), in steps of about a hundredth of it.
export function rangeFor(value) {
  if (value === 0) return { min: 0, max: 1, step: 0.01 };
  const size = Math.abs(value);
  const step = Number.isInteger(value) && size >= 2 ? 1 : 10 ** (Math.floor(Math.log10(size)) - 2);
  const far = Math.max(size * 4, size + 1);
  return value > 0 ? { min: 0, max: far, step } : { min: -far, max: 0, step };
}

export class TuningRegistry {
  // live: hand out mutable copies (tuning on). storage: where changes are
  // remembered (only used while live).
  constructor({ live = false, storage = null, key = TUNING_KEY } = {}) {
    Object.assign(this, { live, storage, key });
    this.entries = new Map();
    this.listeners = new Set();
  }

  // ---- Registering ----

  // id: a short name ('camera'). source: the config object as written.
  // label: shown in the panel. readOnly: never changed (the brain contract).
  // note: one line of small print. limits: { 'dotted.path': { min, max, step } }.
  register(id, { source, label = id, readOnly = false, note = '', limits = {} }) {
    if (this.entries.has(id)) throw new Error(`Tuning config "${id}" is already registered`);
    const values = this.live && !readOnly ? deepCopy(source) : source;
    this.entries.set(id, { id, source, values, label, readOnly, note, limits });
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

  // The tunable leaves of a config: numbers and on/off switches, with limits.
  // Each: { path, value, default, type: 'number' | 'boolean', min, max, step, readOnly }.
  fields(id) {
    const { values, source, readOnly, limits } = this.entry(id);
    const fields = [];
    const walk = (node, prefix) => {
      for (const [key, value] of Object.entries(node)) {
        const path = prefix ? `${prefix}.${key}` : key;
        if (typeof value === 'number' && Number.isFinite(value)) {
          fields.push({ path, value, default: readPath(source, path), type: 'number', ...rangeFor(readPath(source, path)), ...limits[path], readOnly });
        } else if (typeof value === 'boolean') {
          fields.push({ path, value, default: readPath(source, path), type: 'boolean', readOnly });
        } else if (value && typeof value === 'object' && !Array.isArray(value)) {
          walk(value, path);
        }
      }
    };
    walk(values, '');
    return fields;
  }

  // ---- Changing ----

  // Change one value live. Refused (throws) for read-only configs, while tuning
  // is off, for unknown paths and for a value of the wrong kind.
  set(id, path, value) {
    const entry = this.entry(id);
    if (entry.readOnly) throw new Error(`"${id}" is read-only (the frozen brain depends on it)`);
    if (!this.live) throw new Error('Tuning is off (open the game with ?dev or ?tune)');
    const { parent, last } = parentOf(entry.values, path);
    const current = parent?.[last];
    if (parent === undefined || current === undefined || typeof current === 'object') throw new Error(`Unknown tunable "${id}.${path}"`);
    const next = typeof current === 'number' ? Number(value) : typeof current === 'boolean' ? Boolean(value) : value;
    if (typeof current === 'number' && !Number.isFinite(next)) throw new Error(`"${id}.${path}" needs a number`);
    if (next === current) return false;
    parent[last] = next;
    this.save();
    for (const listener of [...this.listeners]) listener(id, path, next);
    return true;
  }

  // Back to the values as written: one config, or every one.
  reset(id = null) {
    for (const entry of id ? [this.entry(id)] : this.entries.values()) {
      if (entry.readOnly || !this.live) continue;
      for (const { path } of this.fields(entry.id)) {
        const { parent, last } = parentOf(entry.values, path);
        const original = readPath(entry.source, path);
        if (parent[last] !== original) {
          parent[last] = original;
          for (const listener of [...this.listeners]) listener(entry.id, path, original);
        }
      }
    }
    this.save();
  }

  // listener(id, path, value) after every change. Returns a remover.
  onChange(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // ---- Saving and sharing ----

  // Every value that differs from the config as written: { id: { path: value } }.
  overrides() {
    const changed = {};
    for (const entry of this.entries.values()) {
      if (entry.readOnly) continue;
      for (const field of this.fields(entry.id)) {
        if (field.value !== field.default) (changed[entry.id] ??= {})[field.path] = field.value;
      }
    }
    return changed;
  }

  // Apply saved changes (unknown, read-only or invalid ones are skipped).
  applyOverrides(overrides = {}) {
    let applied = 0;
    for (const [id, paths] of Object.entries(overrides ?? {})) {
      if (!this.has(id) || this.entry(id).readOnly) continue;
      for (const [path, value] of Object.entries(paths ?? {})) {
        try {
          if (this.set(id, path, value)) applied += 1;
        } catch { /* An old or broken entry: skipped. */ }
      }
    }
    return applied;
  }

  // Remember / read back the changes in this browser (only while tuning).
  save() {
    if (!this.live) return;
    try {
      this.storage?.setItem(this.key, JSON.stringify(this.overrides()));
    } catch { /* Private storage: the changes last for this page only. */ }
  }

  load() {
    if (!this.live) return 0;
    let saved = {};
    try {
      saved = JSON.parse(this.storage?.getItem(this.key) ?? '{}');
    } catch { /* Unreadable: nothing applied. */ }
    return this.applyOverrides(saved);
  }

  // The current values of the tunable configs as JSON text, ready to paste
  // into the config files (Infinity, which JSON lacks, is written "Infinity").
  toJSON(ids = this.ids().filter((id) => !this.entry(id).readOnly)) {
    const out = Object.fromEntries(ids.map((id) => [id, this.values(id)]));
    return JSON.stringify(out, (key, value) => (value === Infinity ? 'Infinity' : value === -Infinity ? '-Infinity' : value), 2);
  }
}
