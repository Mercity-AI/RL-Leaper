import { Pane } from 'tweakpane';
import { tuning } from '../config/tuning/index.js';
import { COMBAT as COMBAT_CONFIG } from '../config/combat.js';

// The live designer tuning panel (finding game-architecture-tuning-scattered-no-live-ui),
// in the developer panel's TUNING section. Built with Tweakpane (a developer
// dependency, downloaded only with these tools) on top of the tuning registry
// (src/config/tuning/): one folder per config, a slider or switch per number,
// read-only folders for the frozen brain contract, and
//   COPY JSON   the current values, ready to paste into the config files
//   RESET ALL   every value back to the config files
// Every change applies at once and is remembered in this browser (dev only).

// Configs another part of the game may add later, picked up if their file
// exists: the Leaper's behaviour (read-only here until its modules read it
// through the registry, so the panel never shows a slider that does nothing).
const OPTIONAL_CONFIGS = import.meta.glob('../config/leaper-behaviour.js', { eager: true });

// Register any optional config found (plain objects only), read-only.
export function registerOptionalConfigs(registry = tuning, modules = OPTIONAL_CONFIGS) {
  for (const module of Object.values(modules)) {
    for (const [name, value] of Object.entries(module)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      const id = name === 'LEAPER_BEHAVIOUR' ? 'leaperBehaviour' : name;
      if (registry.has(id)) continue;
      registry.register(id, { label: `Leaper behaviour (${name})`, source: value, readOnly: true,
        note: 'Shown for reference: tunable once its modules read it through the tuning registry.' });
    }
  }
}

// The running Leaper's combat reads the live combat copy from now on (its own
// file holds the frozen config; this hands it the registry's copy instead, so
// laser damage, timings and ranges change mid-fight). Only while tuning is on.
export function bindCombat(playtest, registry = tuning) {
  if (!registry.live) return false;
  const live = registry.values('combat');
  let bound = false;
  for (const { combat } of playtest?.encounter?.enemies ?? []) {
    if (combat?.config === COMBAT_CONFIG) { combat.config = live; bound = true; }
    if (combat?.tree?.config === COMBAT_CONFIG) combat.tree.config = live;
  }
  return bound;
}

export function createTuningPanel({ container, playtest = null, registry = tuning }) {
  registerOptionalConfigs(registry);
  const combatBound = bindCombat(playtest, registry);
  const pane = new Pane({ container, title: registry.live ? 'Live tuning' : 'Tuning (off: open with ?dev)' });
  // 1. The tools: copy, reset, and how many values differ from the files.
  const status = { changed: '' };
  const showStatus = () => {
    const count = Object.values(registry.overrides()).reduce((sum, paths) => sum + Object.keys(paths).length, 0);
    status.changed = count ? `${count} changed (saved here)` : 'as in the files';
  };
  showStatus();
  pane.addBinding(status, 'changed', { label: 'values', readonly: true, interval: 0 });
  pane.addButton({ title: 'COPY JSON' }).on('click', () => copyJson(registry.toJSON(), container));
  pane.addButton({ title: 'RESET ALL' }).on('click', () => registry.reset());

  // 2. One folder per config. Sliders write through registry.set (which applies
  //    the value to the live copy, remembers it and tells everyone).
  const holders = [];
  for (const id of registry.ids()) {
    const entry = registry.entry(id);
    const folder = pane.addFolder({ title: entry.label + (entry.readOnly ? ' (read-only)' : ''), expanded: false });
    if (entry.note || (id === 'combat' && !combatBound)) {
      const note = { note: id === 'combat' && !combatBound && registry.live ? `${entry.note} (not bound yet)` : entry.note };
      folder.addBinding(note, 'note', { label: 'note', readonly: true, interval: 0 });
    }
    for (const field of registry.fields(id)) {
      const holder = { value: field.value, id, path: field.path };
      holders.push(holder);
      const options = { label: field.path, readonly: field.readOnly || !registry.live };
      if (field.type === 'number' && !options.readonly) Object.assign(options, { min: field.min, max: field.max, step: field.step });
      if (options.readonly) options.interval = 0;
      const binding = folder.addBinding(holder, 'value', options);
      if (!options.readonly) {
        binding.on('change', (event) => {
          try {
            registry.set(id, field.path, event.value);
          } catch (error) {
            console.warn(error.message);
          }
        });
      }
    }
    if (!entry.readOnly && registry.live) folder.addButton({ title: 'RESET' }).on('click', () => registry.reset(id));
  }

  // 3. A reset (or any change elsewhere) shows in the sliders.
  const off = registry.onChange(() => {
    for (const holder of holders) holder.value = registry.values(holder.id) && readValue(registry, holder);
    showStatus();
    pane.refresh();
  });
  return {
    pane,
    dispose() {
      off();
      pane.dispose();
    },
  };
}

function readValue(registry, { id, path }) {
  return path.split('.').reduce((node, key) => node?.[key], registry.values(id));
}

// COPY JSON: to the clipboard when the browser allows it, else into a text box
// the designer can select.
async function copyJson(text, container) {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch { /* No clipboard here: show the text instead. */ }
  let box = container.querySelector('textarea.tuning-json');
  if (!box) {
    box = document.createElement('textarea');
    box.className = 'tuning-json';
    box.readOnly = true;
    box.rows = 8;
    container.append(box);
  }
  box.value = text;
  box.select();
}
