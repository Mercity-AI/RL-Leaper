import { AUDIO_GROUPS } from './audioConfig.js';

// The player's sound settings as a section of the game's SETTINGS screen.
//
// Wiring (one line, wherever the settings store and the game's audio meet):
//   registerAudioSettings(settings, audio)
// settings: the settings store with registerSection({ id, title, order, build })
// (src/ui/settings.js on the UX track); audio: the game's GameAudio. It replaces
// the screen's placeholder 'audio' section with a sound switch and four volume
// sliders. The values live in the audio engine's own AudioSettings (remembered
// in this browser), so they work with or without the SETTINGS screen.
//
// Without a settings screen, mount the stand-alone view instead:
//   new AudioSettingsView(container, { audio })   (src/ui/AudioSettingsView.js)

// The sliders in screen order: setting name and label.
export const VOLUME_SLIDERS = Object.freeze([
  Object.freeze({ name: 'master', label: 'Master volume' }),
  ...Object.entries(AUDIO_GROUPS).map(([name, group]) => Object.freeze({ name, label: `${group.label} volume` })),
]);

const percent = (value) => `${Math.round(value * 100)}%`;

// Turn sound on or off: the engine's mute, and the settings store's own
// 'sound' switch too when it has one (so both screens agree).
function setSound(audio, store, on) {
  audio.enabled = on;
  if (store?.get?.('sound') !== undefined && store.get('sound') !== on) store.set('sound', on);
}

// The section descriptor for settings.registerSection().
export function audioSettingsSection(audio, store = null) {
  return {
    id: 'audio',
    title: 'AUDIO',
    order: 30,
    // container: the section's element; controls: the screen's row builders
    // (range, toggle, button, note), so this section looks like the others.
    build(container, { controls }) {
      const values = audio.settings;
      const sound = controls.toggle(container, { label: 'Sound', checked: audio.enabled, onChange: (on) => setSound(audio, store, on) });
      const sliders = VOLUME_SLIDERS.map(({ name, label }) => [name, controls.range(container, {
        label, min: 0, max: 1, step: 0.05, value: values.get(name), format: percent, onInput: (value) => values.set(name, value),
      })]);
      controls.button(container, { label: 'RESET VOLUMES', onClick: () => {
        for (const { name } of VOLUME_SLIDERS) values.set(name, 1);
        for (const [, input] of sliders) {
          input.value = 1;
          input.dispatchEvent?.(new Event('input'));
        }
      } });
      controls.note(container, 'Effects: guns, the Leaper, impacts and footsteps. Music & ambience: the junkyard background.');
      // Keep the switch in step when sound is turned on or off elsewhere (the
      // toolbar); a rebuilt screen's old switch stops listening.
      const off = values.onChange((name, value) => {
        if (sound.isConnected === false) off();
        else if (name === 'muted') sound.checked = !value;
      });
      return off;
    },
  };
}

// Register the section on a settings store. Returns its remover.
export function registerAudioSettings(store, audio) {
  return store.registerSection(audioSettingsSection(audio, store));
}
