import '../styles/ui/audio-settings.css';
import { VOLUME_SLIDERS } from '../audio/audioSettingsSection.js';

// The sound settings as a self-contained view: a SOUND on/off switch and the
// master, effects, music & ambience and interface volume sliders, plus RESET.
// Changes apply at once and are remembered in this browser (the audio
// engine's AudioSettings); turning sound off elsewhere (the toolbar's SOUND
// button) updates the switch here too.
//
// Mounting: new AudioSettingsView(container, { audio }) with the game's
// GameAudio (or { settings } with an AudioSettings). dispose() removes it.
// On a SETTINGS screen with registerSection, use registerAudioSettings()
// (src/audio/audioSettingsSection.js) instead, so the rows match the screen.

let viewCount = 0;

export class AudioSettingsView {
  constructor(parent = document.body, { audio = null, settings = audio?.settings } = {}) {
    if (!settings) throw new Error('AudioSettingsView needs the game audio or its settings');
    this.settings = settings;
    this.audio = audio;
    const prefix = `audio-settings-${(viewCount += 1)}`;
    // 1. The panel and its heading.
    this.element = document.createElement('section');
    this.element.className = 'audio-settings';
    this.element.setAttribute('aria-labelledby', `${prefix}-title`);
    const title = Object.assign(document.createElement('h3'), { className: 'audio-settings-title', id: `${prefix}-title`, textContent: 'SOUND' });
    this.element.append(title);
    // 2. The on / off switch (the same mute as the toolbar's SOUND button).
    const soundRow = this.row(`${prefix}-sound`, 'Sound');
    this.sound = Object.assign(document.createElement('input'), { type: 'checkbox', id: `${prefix}-sound`, checked: !settings.muted });
    this.sound.addEventListener('change', () => {
      if (this.audio) this.audio.enabled = this.sound.checked;
      else this.settings.muted = !this.sound.checked;
    });
    soundRow.append(this.sound);
    // 3. One slider per volume, its percentage beside it.
    this.sliders = new Map();
    for (const { name, label } of VOLUME_SLIDERS) {
      const id = `${prefix}-${name}`;
      const row = this.row(id, label);
      const input = Object.assign(document.createElement('input'), { type: 'range', id, min: 0, max: 100, step: 5,
        value: Math.round(settings.get(name) * 100) });
      input.dataset.volume = name;
      const output = Object.assign(document.createElement('output'), { htmlFor: id, textContent: `${input.value}%` });
      input.addEventListener('input', () => {
        output.textContent = `${input.value}%`;
        this.settings.set(name, Number(input.value) / 100);
      });
      row.append(input, output);
      this.sliders.set(name, { input, output });
    }
    // 4. Back to full volume.
    const reset = Object.assign(document.createElement('button'), { type: 'button', className: 'audio-settings-reset', textContent: 'RESET VOLUMES' });
    reset.addEventListener('click', () => { for (const { name } of VOLUME_SLIDERS) this.settings.set(name, 1); });
    this.element.append(reset, Object.assign(document.createElement('p'), { className: 'audio-settings-note',
      textContent: 'Effects: guns, the Leaper, impacts and footsteps. Music & ambience: the junkyard background.' }));
    // 5. Stay in step with changes made anywhere else.
    this.offChange = settings.onChange(() => this.render());
    parent.append(this.element);
  }

  // One labelled row.
  row(id, label) {
    const row = Object.assign(document.createElement('div'), { className: 'audio-settings-row' });
    row.append(Object.assign(document.createElement('label'), { htmlFor: id, textContent: label }));
    this.element.append(row);
    return row;
  }

  // Show the current values (after a change from elsewhere).
  render() {
    this.sound.checked = !this.settings.muted;
    for (const [name, { input, output }] of this.sliders) {
      const value = String(Math.round(this.settings.get(name) * 100));
      if (input.value !== value) input.value = value;
      output.textContent = `${value}%`;
    }
  }

  dispose() {
    this.offChange();
    this.element.remove();
  }
}
