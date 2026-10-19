import { Pane } from 'tweakpane';
import { tuning } from '../config/tuning/index.js';
import { readPath } from '../config/tuning/registry.js';

// The live designer tuning panel (finding game-architecture-tuning-scattered-no-live-ui),
// in the developer panel's TUNING section. Built with Tweakpane (a developer
// dependency, downloaded only with these tools: DevPanel imports this file on
// demand) on top of the tuning registry (src/config/tuning/): one folder per
// config, a slider or switch per number, read-only rows for values that are
// not tunable live and read-only folders for the frozen brain contract, and
//   COPY JSON   the values that differ from the config files
//   RESET ALL   every value back to the config files (RESET in a folder: that config)
// Every change applies at once and is remembered in this browser (dev only).

export function createTuningPanel({ container, registry = tuning }) {
  const pane = new Pane({ container, title: registry.live ? 'Live tuning' : 'Tuning (off: open with ?dev)' });
  // While the panel copies the registry's values into its sliders, the sliders'
  // own change events are ignored, so showing a value can never change it.
  let syncing = false;

  // 1. The tools: how many values differ from the files, copy, reset.
  const status = { changed: '' };
  const showStatus = () => {
    const count = Object.values(registry.overrides()).reduce((sum, paths) => sum + Object.keys(paths).length, 0);
    status.changed = count ? `${count} changed (saved here)` : 'as in the files';
  };
  showStatus();
  pane.addBinding(status, 'changed', { label: 'values', readonly: true, interval: 0 });
  pane.addButton({ title: 'COPY JSON' }).on('click', () => copyJson(registry.changesJson(), container));
  pane.addButton({ title: 'RESET ALL' }).on('click', () => registry.reset());

  // 2. One folder per config, its note first. Sliders write through
  //    registry.set, which changes the live copy, remembers it and tells everyone.
  const holders = [];
  for (const id of registry.ids()) {
    const entry = registry.entry(id);
    const folder = pane.addFolder({ title: entry.label + (entry.readOnly ? ' (read-only)' : ''), expanded: false });
    if (entry.note) addNote(folder, entry.note);
    for (const field of registry.fields(id)) {
      const holder = { value: field.value, id, path: field.path };
      holders.push(holder);
      const readonly = field.readOnly || !registry.live;
      const options = { label: field.path, readonly };
      if (readonly) options.interval = 0;
      else if (field.type === 'number') Object.assign(options, { min: field.min, max: field.max }, field.step ? { step: field.step } : {});
      const binding = folder.addBinding(holder, 'value', options);
      if (readonly) continue;
      binding.on('change', (event) => {
        if (syncing) return;
        try {
          registry.set(id, field.path, event.value);
        } catch (error) {
          console.warn(error.message);
        }
      });
    }
    if (!entry.readOnly && registry.live) folder.addButton({ title: 'RESET' }).on('click', () => registry.reset(id));
  }

  // 3. Any change (a slider, a reset) shows in every slider and the count.
  const off = registry.onChange(() => {
    syncing = true;
    try {
      for (const holder of holders) holder.value = readPath(registry.values(holder.id), holder.path);
      showStatus();
      pane.refresh();
    } finally {
      syncing = false;
    }
  });
  return {
    pane,
    dispose() {
      off();
      pane.dispose();
    },
  };
}

// A config's small print, at the top of its folder (Tweakpane has no text row).
function addNote(folder, text) {
  const note = document.createElement('p');
  note.className = 'tuning-note';
  note.textContent = text;
  const content = folder.element.querySelector('.tp-fldv_c') ?? folder.element;
  content.prepend(note);
}

// COPY JSON: to the clipboard when the browser allows it, and always into a
// text box under the panel the designer can select.
async function copyJson(text, container) {
  let box = container.querySelector('textarea.tuning-json');
  if (!box) {
    box = document.createElement('textarea');
    box.className = 'tuning-json';
    box.readOnly = true;
    box.rows = 6;
    box.setAttribute('aria-label', 'Changed tuning values as JSON');
    container.append(box);
  }
  box.value = text;
  box.select();
  try {
    await navigator.clipboard?.writeText(text);
  } catch { /* No clipboard here: the text box has it. */ }
}
