import test from 'node:test';
import assert from 'node:assert/strict';
import { VOLUME_SLIDERS, audioSettingsSection, registerAudioSettings } from '../src/audio/audioSettingsSection.js';
import { AudioSettings } from '../src/audio/AudioSettings.js';

// The sound section of the SETTINGS screen (src/audio/audioSettingsSection.js),
// built with the screen's row builders (faked here: range, toggle, button, note)
// against a stand-in for the game's audio.

// Row builders that record what was built and hand back input-like objects.
function fakeControls() {
  const rows = [];
  const controls = {
    range(container, options) { const input = { value: options.value, options }; rows.push({ kind: 'range', input }); return input; },
    toggle(container, options) { const input = { checked: options.checked, options }; rows.push({ kind: 'toggle', input }); return input; },
    button(container, options) { rows.push({ kind: 'button', options }); return {}; },
    note(container, text) { rows.push({ kind: 'note', text }); return {}; },
  };
  return { controls, rows };
}

// The bits of GameAudio the section uses.
function fakeAudio() {
  const settings = new AudioSettings({ storage: null });
  return { settings, get enabled() { return !settings.muted; }, set enabled(on) { settings.muted = !on; } };
}

test('the section replaces the screen\'s audio placeholder: a sound switch and four volume sliders', () => {
  const audio = fakeAudio();
  const sections = [];
  const store = { registerSection: (section) => { sections.push(section); return () => {}; } };
  registerAudioSettings(store, audio);
  const [section] = sections;
  assert.equal(section.id, 'audio', 'same id as the placeholder, so it replaces it');
  assert.equal(section.title, 'AUDIO');
  const { controls, rows } = fakeControls();
  section.build({}, { controls });
  assert.deepEqual(rows.map((row) => row.kind), ['toggle', 'range', 'range', 'range', 'range', 'button', 'note']);
  assert.deepEqual(rows.filter((row) => row.kind === 'range').map((row) => row.input.options.label),
    ['Master volume', 'Effects volume', 'Music & ambience volume', 'Interface volume']);
  assert.deepEqual(VOLUME_SLIDERS.map((slider) => slider.name), ['master', 'sfx', 'ambience', 'ui']);
});

test('moving a slider sets that volume; the switch mutes; reset brings full volume back', () => {
  const audio = fakeAudio();
  const { controls, rows } = fakeControls();
  audioSettingsSection(audio).build({}, { controls });
  const ranges = rows.filter((row) => row.kind === 'range').map((row) => row.input);
  ranges[1].options.onInput(0.4);
  assert.equal(audio.settings.get('sfx'), 0.4);
  assert.equal(ranges[1].options.format(0.4), '40%');
  ranges[3].options.onInput(0);
  assert.equal(audio.settings.get('ui'), 0);
  // The switch is the game's mute, and follows a mute made elsewhere (the toolbar).
  const sound = rows.find((row) => row.kind === 'toggle').input;
  sound.options.onChange(false);
  assert.equal(audio.enabled, false);
  audio.enabled = true;
  assert.equal(sound.checked, true);
  // RESET VOLUMES.
  rows.find((row) => row.kind === 'button').options.onClick();
  assert.deepEqual(VOLUME_SLIDERS.map(({ name }) => audio.settings.get(name)), [1, 1, 1, 1]);
  assert.ok(ranges.every((input) => Number(input.value) === 1), 'the sliders show it');
});

test('the switch keeps the settings store\'s own sound setting in step, when the store has one', () => {
  const audio = fakeAudio();
  const values = { sound: true };
  const store = { registerSection() {}, get: (key) => values[key], set: (key, value) => { values[key] = value; } };
  const { controls, rows } = fakeControls();
  audioSettingsSection(audio, store).build({}, { controls });
  rows.find((row) => row.kind === 'toggle').input.options.onChange(false);
  assert.equal(values.sound, false);
  assert.equal(audio.enabled, false);
  // A store without that setting is left alone.
  const bare = { registerSection() {}, get: () => undefined, set: () => assert.fail('no sound setting to set') };
  const other = fakeControls();
  audioSettingsSection(fakeAudio(), bare).build({}, { controls: other.controls });
  other.rows.find((row) => row.kind === 'toggle').input.options.onChange(false);
});

test('a rebuilt screen\'s old switch stops listening', () => {
  const audio = fakeAudio();
  const { controls, rows } = fakeControls();
  audioSettingsSection(audio).build({}, { controls });
  const sound = rows.find((row) => row.kind === 'toggle').input;
  sound.isConnected = false;
  audio.enabled = false;
  assert.equal(audio.settings.listeners.size, 0, 'its listener is gone');
});
