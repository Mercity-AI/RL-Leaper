import { QUALITY_NAMES, pickQuality, setQualityPreference } from '../core/Quality.js';
import { SETTING_LIMITS } from './settings.js';

// The SETTINGS screen (page side). It shows every section registered on the
// settings store (src/ui/settings.js), in order, and rebuilds when sections are
// added or replaced. The game's own sections are registered here by
// registerGameSections(); other modules add theirs with settings.registerSection.
//
// Each section's build(container, api) gets `api.controls`, small builders for
// labelled rows (range, toggle, select, button, note), so every section looks
// and behaves the same (keyboard, gamepad left / right, screen readers).

let rowCount = 0;
const nextId = (prefix) => `setting-${prefix}-${(rowCount += 1)}`;

// ---- Row builders ----
export const controls = {
  // A slider with its value shown beside it. onInput(value) as it moves.
  range(container, { label, min, max, step, value, format = (v) => String(v), onInput }) {
    const id = nextId('range');
    const row = row_(container, label, id);
    const input = Object.assign(document.createElement('input'), { type: 'range', id, min, max, step, value });
    const output = Object.assign(document.createElement('output'), { htmlFor: id, textContent: format(Number(value)) });
    input.addEventListener('input', () => {
      output.textContent = format(Number(input.value));
      onInput?.(Number(input.value));
    });
    row.append(input, output);
    return input;
  },
  // An on / off tick box.
  toggle(container, { label, checked, onChange }) {
    const id = nextId('toggle');
    const row = row_(container, label, id);
    const input = Object.assign(document.createElement('input'), { type: 'checkbox', id, checked: Boolean(checked) });
    input.addEventListener('change', () => onChange?.(input.checked));
    row.append(input);
    return input;
  },
  // A list of choices: options [{ value, label }].
  select(container, { label, options, value, onChange }) {
    const id = nextId('select');
    const row = row_(container, label, id);
    const select = Object.assign(document.createElement('select'), { id });
    for (const option of options) select.append(new Option(option.label, option.value, false, option.value === value));
    select.addEventListener('change', () => onChange?.(select.value));
    row.append(select);
    return select;
  },
  // A button with an optional hint under it.
  button(container, { label, hint = '', onClick }) {
    const button = Object.assign(document.createElement('button'), { type: 'button', className: 'setting-button', textContent: label });
    button.addEventListener('click', () => onClick?.(button));
    container.append(button);
    if (hint) controls.note(container, hint);
    return button;
  },
  // A line of small print.
  note(container, text) {
    const note = Object.assign(document.createElement('p'), { className: 'setting-note', textContent: text });
    container.append(note);
    return note;
  },
};

// One labelled row.
function row_(container, label, id) {
  const row = document.createElement('div');
  row.className = 'setting';
  row.append(Object.assign(document.createElement('label'), { htmlFor: id, textContent: label }));
  container.append(row);
  return row;
}

// ---- The screen ----

// Fill the SETTINGS screen and keep it in step with the registered sections.
// Returns { onShow } for GameScreens.defineScreen.
export function settingsScreen(store, api = {}) {
  let body = null;
  let builtVersion = -1;
  const render = () => {
    builtVersion = store.version;
    body.textContent = '';
    for (const section of store.sections()) {
      const element = document.createElement('section');
      element.className = 'settings-section';
      element.dataset.section = section.id;
      const heading = Object.assign(document.createElement('h3'), { textContent: section.title ?? section.id.toUpperCase() });
      element.append(heading);
      body.append(element);
      section.build(element, { ...api, settings: store, controls });
    }
    controls.button(body, { label: 'RESET TO DEFAULTS', onClick: () => {
      store.reset();
      render();
    } });
  };
  return {
    build(container) {
      body = document.createElement('div');
      body.className = 'settings';
      container.append(body);
      render();
    },
    // Sections added since the last time are shown when the screen opens again.
    onShow() {
      if (body && builtVersion !== store.version) render();
    },
  };
}

// ---- The game's own sections ----

// quality: the preset in use now ('low' | 'medium' | 'high'). reload(): reloads
// the page (the quality only changes at load). playing(): a fight is under way
// (so the reload warns that it ends it).
export function registerGameSections(store, { quality, reload = () => location.reload(), playing = () => false } = {}) {
  const pct = (value) => `${Math.round(value * 100)}%`;
  // 1. Graphics: the quality preset (world track's presets), applied at the next load.
  store.registerSection({ id: 'graphics', title: 'GRAPHICS', order: 10, build(container, { controls: c }) {
    const picked = pickQuality();
    c.select(container, {
      label: 'Graphics quality',
      options: [{ value: 'auto', label: 'Automatic' }, ...QUALITY_NAMES.map((name) => ({ value: name, label: name[0].toUpperCase() + name.slice(1) }))],
      value: picked.source === 'saved' ? picked.name : 'auto',
      onChange: (value) => {
        setQualityPreference(value === 'auto' ? null : value);
        note.textContent = `Now ${String(quality).toUpperCase()}. The new choice applies when the game next loads.`;
      },
    });
    const note = c.note(container, `Now ${String(quality).toUpperCase()}. Lower quality runs faster on older machines and phones.`);
    c.button(container, {
      label: 'RELOAD NOW',
      hint: 'Reloads the game with the chosen quality.',
      onClick: () => { if (!playing() || globalThis.confirm?.('Reload now? This ends the current fight.') !== false) reload(); },
    });
  } });
  // 2. Controls: look speed, invert up/down, field of view.
  store.registerSection({ id: 'controls', title: 'CONTROLS', order: 20, build(container, { controls: c, settings: s }) {
    c.range(container, { label: 'Look sensitivity', ...SETTING_LIMITS.sensitivity, value: s.get('sensitivity'), format: pct,
      onInput: (value) => s.set('sensitivity', value) });
    c.toggle(container, { label: 'Invert look up / down', checked: s.get('invertY'), onChange: (on) => s.set('invertY', on) });
    c.range(container, { label: 'Field of view', ...SETTING_LIMITS.fov, value: s.get('fov'), format: (v) => `${v}°`,
      onInput: (value) => s.set('fov', value) });
  } });
  // 3. Audio: a placeholder until the sound system registers its own section
  //    (settings.registerSection({ id: 'audio', ... }) replaces it).
  store.registerDefaultSection({ id: 'audio', title: 'AUDIO', order: 30, build(container, { controls: c, settings: s }) {
    c.toggle(container, { label: 'Sound', checked: s.get('sound'), onChange: (on) => s.set('sound', on) });
    c.note(container, 'Volume controls arrive with the new sound system.');
  } });
  // 4. Accessibility: bigger text, captions for sound cues.
  store.registerSection({ id: 'accessibility', title: 'ACCESSIBILITY', order: 40, build(container, { controls: c, settings: s }) {
    c.toggle(container, { label: 'Large text', checked: s.get('textSize') === 'large', onChange: (on) => s.set('textSize', on ? 'large' : 'normal') });
    c.toggle(container, { label: 'Captions for sounds (subtitles)', checked: s.get('captions'), onChange: (on) => s.set('captions', on) });
  } });
}
