import { AudioService } from './AudioService.js';

// The game's sound, in the words the gameplay code uses: fire(), play('m416'),
// playSlot('lolaHurt'), step('walk'), ... on top of AudioService (the mixer,
// voices, 3D placement and the manifest). This is the API the old LaserAudio
// class had, kept so every existing call works; src/simulation/LaserAudio.js
// re-exports it under that name.
//
// What's new for callers: an { at } position on play() / playSlot() places the
// sound in the world (impacts). A sound whose manifest entry names an emitter
// ('leaper', 'leaperEye') plays there when no position is given, so the
// Leaper's slots (stomp, leap, charge, collapse, ...) are placed at the Leaper
// without their callers knowing about 3D sound. step() takes a position for the
// Leaper's feet; updateListener() moves the ears with the camera every frame;
// startAmbience() keeps the yard's background bed playing.

// The recordings older code and tests know by these keys (manifest ids are the same names).
const CLIPS = Object.freeze(['laser', 'pistol', 'm416', 'leaper', 'run', 'walk', 'robot', 'm416Reload', 'pistolReload']);
// The optional slots (now ordinary manifest sounds that may have no takes yet).
const SLOTS = Object.freeze(['kneeBreak', 'gunEmpty', 'lolaHurt', 'lolaHurtBig', 'lolaHitThud']);
// Footstep recordings are played one impact at a time by step(), never whole.
const STEP_KINDS = new Set(['run', 'walk', 'robot']);

// Isolated impacts measured in the supplied recordings (seconds). The running
// loop is re-sequenced on animation contacts, so it cannot drift from the feet.
const FOOTSTEPS = Object.freeze({
  run: [0.06, 0.4, 0.73, 1.065, 1.37, 1.72, 2.025, 2.37, 2.7, 3.055, 3.36, 3.705],
  walk: [0.285, 0.82, 1.395, 1.955, 2.615, 3.095, 3.66, 4.2, 4.78, 5.31],
  robot: [0.07, 0.62, 1.17, 1.72, 2.27, 2.82],
});

// Buttons that click when pressed (touch gameplay buttons and anything marked
// data-silent stay quiet).
const CLICKABLE = 'button, [role=button], summary, select';
const SILENT = '.touch-controls, #touch, [data-silent]';

// A plain { x, y, z } copy of a position (THREE.Vector3 or anything alike), or null.
const point = (at) => (at ? { x: at.x, y: at.y, z: at.z } : null);

export class GameAudio {
  // signal: the game session's AbortSignal; aborting it removes the page listeners.
  // fetchFile: how recordings are downloaded (the game passes its loader, so they
  //   count on the loading bar); plain fetch() by default.
  // quality: the graphics preset name ('high' gets HRTF 3D sound).
  // service: an AudioService to use (else one is made with these options).
  constructor({ signal = null, fetchFile, quality, settings, random, createContext, probe, service = null } = {}) {
    const options = Object.fromEntries(Object.entries({ signal, fetchFile, quality, settings, random, createContext, probe })
      .filter(([, value]) => value !== undefined));
    this.service = service ?? new AudioService(options);
    this.stepIndex = { run: 0, walk: 0, robot: 0 };
    this.emitters = new Map();
    // Leaving the window stops the effects (a hidden tab also suspends the device).
    // Pressing a menu or toolbar button clicks.
    const session = { signal: this.service.events.signal };
    globalThis.window?.addEventListener?.('blur', () => this.stop(), session);
    globalThis.document?.addEventListener?.('click', (event) => this.uiClick(event), session);
  }

  // ---- What older code and tests read ----

  get context() { return this.service.context; }
  get ready() { return this.service.ready; }
  get voices() { return this.service.voices; }
  get settings() { return this.service.settings; }
  // The Leaper's footsteps playing right now.
  get robotVoices() { return new Set([...this.service.voices].filter((voice) => voice.id === 'robot')); }
  // The decoded recordings by their old keys (the first take of each).
  get buffers() { return this.decoded(CLIPS); }
  // Every decoded take of the optional slots, by file name.
  get optionalBuffers() {
    const takes = SLOTS.flatMap((id) => this.service.sound(id)?.variations ?? []);
    return Object.fromEntries(takes.filter(({ name }) => this.service.buffers.has(name))
      .map(({ name }) => [name, this.service.buffers.get(name)]));
  }

  decoded(ids) {
    const entries = ids.map((id) => [id, this.service.sound(id)?.variations[0]?.name])
      .filter(([, name]) => name && this.service.buffers.has(name));
    return Object.fromEntries(entries.map(([id, name]) => [id, this.service.buffers.get(name)]));
  }

  // SOUND: ON / OFF (the player's mute setting, remembered in this browser).
  get enabled() { return !this.service.muted; }
  set enabled(value) { this.service.settings.muted = !value; }

  // Distances in the sound config are map units; the junkyard sets its scale here.
  get distanceScale() { return this.service.distanceScale; }
  set distanceScale(scale) { this.service.distanceScale = scale; }

  // ---- The device ----

  unlock() { this.service.unlock(); }

  // The session is over: silence everything and let the browser free the audio device.
  dispose() { this.service.dispose(); }

  // ---- Playing ----

  // A recording by its key ('m416', 'leaper', 'm416Reload', or any manifest id).
  // at: a world position places it in 3D (default: the sound's emitter, if it
  // has one, else centred). Resolves to the voice (stop() cuts it short, e.g. an
  // interrupted reload) or nothing if it didn't play.
  play(key, { at = null } = {}) {
    const sound = this.service.sound(key);
    if (STEP_KINDS.has(key) || !sound) return Promise.resolve(null);
    const position = point(at) ?? (sound.emitter ? this.emitterPosition(sound.emitter) : null);
    return this.service.playSoon(key, { at: position });
  }

  // A random take of an optional slot ('lolaHurt', 'kneeBreak', ...); silent while empty.
  playSlot(slot, options) {
    return this.play(slot, options);
  }

  // Any sound at a world position (the Leaper's stomp, leap, landing, ...).
  playAt(id, position, options = {}) {
    return this.play(id, { ...options, at: position });
  }

  // The Leaper's laser, from its eye (its emitter) or the given position.
  fire(at = null) {
    return this.play('laser', { at });
  }

  // A sound source that moves with something in the scene, by name: an object
  // with a world matrix (the Leaper's body 'leaper', its eye 'leaperEye') or a
  // function returning { x, y, z }. Sounds name their emitter in the manifest.
  setEmitter(name, source) {
    if (source) this.emitters.set(name, source);
    else this.emitters.delete(name);
  }

  emitterPosition(name) {
    const source = this.emitters.get(name);
    if (typeof source === 'function') return point(source());
    const e = source?.matrixWorld?.elements;
    return e ? { x: e[12], y: e[13], z: e[14] } : null;
  }

  // One footstep. kind: 'walk' (also crouching), 'run' (sprinting: the walk
  // recording, shorter steps) or 'robot' (the Leaper). volume: 0-1 extra
  // factor; at: where the foot is (the Leaper's steps are placed in 3D, at its
  // body when no position is given; Lola's own stay close and centred).
  step(kind, crouched = false, volume = 1, at = null) {
    // Sprinting reuses the normal footstep recording; the faster foot contacts
    // already speed it up. Only each step is cut shorter so steps don't overlap.
    const sprinting = kind === 'run';
    if (sprinting) kind = 'walk';
    const service = this.service, context = service.context, sound = service.sound(kind);
    const buffer = service.buffers.get(sound?.variations[0]?.name);
    const page = globalThis.document;
    if (service.muted || page?.hidden || page?.hasFocus?.() === false || context?.state !== 'running' || !buffer) return null;
    const peaks = FOOTSTEPS[kind];
    if (!peaks) return null;
    const peak = peaks[this.stepIndex[kind]++ % peaks.length];
    // Find the impact onset immediately preceding this peak; retain its texture.
    const samples = buffer.getChannelData(0), rate = buffer.sampleRate;
    let start = Math.max(0, Math.floor((peak - 0.07) * rate));
    const end = Math.floor(peak * rate);
    let maximum = 0;
    for (let i = start; i <= end; i++) maximum = Math.max(maximum, Math.abs(samples[i]));
    while (start < end && Math.abs(samples[start]) < maximum * 0.12) start++;
    const duration = kind === 'robot' ? 0.48 : sprinting ? 0.2 : 0.3;
    const gain = (crouched ? 0.45 : 1) * Math.max(0, Math.min(1, volume));
    // Without a position, a step with an emitter (the Leaper's) plays at it.
    const position = point(at) ?? (sound.emitter ? this.emitterPosition(sound.emitter) : null);
    return service.play(kind, { buffer, offset: start / rate, duration, fadeIn: 0.003, fadeOut: 0.04, gain, at: position });
  }

  // ---- Background and interface ----

  // Keep the yard's ambience bed looping (it starts once sound is unlocked).
  startAmbience(id = 'yardAmbience') { this.service.startLoop(id); }
  stopAmbience(id = 'yardAmbience') { this.service.stopLoop(id); }

  // A trusted click on a menu or toolbar button plays the interface click.
  uiClick(event) {
    const target = event?.target;
    if (event?.isTrusted === false || !target?.closest?.(CLICKABLE) || target.closest(SILENT)) return;
    this.service.play('uiClick');
  }

  // Every frame, after the camera moved: the ears follow it (kept near focus, Lola).
  updateListener(camera, focus = null) {
    this.service.followCamera(camera, focus);
  }

  // ---- Stopping ----

  // Silence the effects (reset, tab switch, pause); sounds waiting for their
  // files are dropped, never played late. The ambience bed keeps going.
  stop() {
    this.service.stopAll({ keepLoops: true });
  }

  // Only the Leaper's footsteps (it paused or the fight ended).
  stopRobotSteps() {
    this.service.stopSound('robot');
  }
}
