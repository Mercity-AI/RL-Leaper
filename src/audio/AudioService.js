import SOUND_MANIFEST from './sounds.json' with { type: 'json' };
import { AUDIO_CONFIG, AUDIO_GROUPS } from './audioConfig.js';
import { AudioSettings } from './AudioSettings.js';
import { fileUrl, formatOrder, isAudioResponse, isDropIn, supportedFormats } from './formats.js';

// The game's sound engine: one AudioContext for the whole page, every sound
// from the manifest (src/audio/sounds.json), played through a small mixer:
//
//   voice -> [3D panner] -> bus (weapons, creature, footsteps, sfx, ui, ambience)
//         -> master volume -> limiter -> speakers
//
// It downloads the files straight away (so they count on the loading bar),
// starts the AudioContext on the first key, click, touch or gamepad press (a
// browser rule), suspends it while the tab is hidden, and keeps each bus within
// its voice limit by replacing the least important sound. A sound that can't
// play (no file yet, no audio device, a limit full of more important sounds)
// is simply skipped: playing never throws.

const DEV = Boolean(import.meta.env?.DEV);

// ---- Small pure helpers (also used by the tests) ----

// Which playing voice to replace for a new one of `priority`: the lowest
// priority, oldest first, but never one that matters more than the newcomer.
// Returns null when every candidate matters more (the new sound is skipped).
export function pickVoiceToReplace(voices, priority) {
  let victim = null;
  for (const voice of voices) {
    if (voice.priority > priority) continue;
    if (!victim || voice.priority < victim.priority || (voice.priority === victim.priority && voice.serial < victim.serial)) victim = voice;
  }
  return victim;
}

// Volume share of a sound `distance` away, the same "inverse" curve the
// browser's 3D panner uses: full up to ref, half at twice ref (rolloff 1),
// and no further fading past max.
export function distanceGain(distance, { ref, max, rolloff }) {
  const clamped = Math.min(Math.max(distance, ref), max);
  return ref / (ref + rolloff * (clamped - ref));
}

const normalise = ({ x, y, z }) => {
  const length = Math.hypot(x, y, z) || 1;
  return { x: x / length, y: y / length, z: z / length };
};

// Where the ears are and which way they face, from a camera's world matrix
// (three.js column order): at the camera, looking where it looks. With focus
// (Lola's position) the ears stay within maxDistance of her, so a far-away
// camera (the TOP view) still hears the fight around her.
export function listenerPose(elements, focus = null, maxDistance = Infinity) {
  let position = { x: elements[12], y: elements[13], z: elements[14] };
  const forward = normalise({ x: -elements[8], y: -elements[9], z: -elements[10] });
  const up = normalise({ x: elements[4], y: elements[5], z: elements[6] });
  if (focus) {
    const offset = { x: position.x - focus.x, y: position.y - focus.y, z: position.z - focus.z };
    const length = Math.hypot(offset.x, offset.y, offset.z);
    if (length > maxDistance) {
      const share = maxDistance / length;
      position = { x: focus.x + offset.x * share, y: focus.y + offset.y * share, z: focus.z + offset.z * share };
    }
  }
  return { position, forward, up };
}

// The browser's AudioContext (null without Web Audio).
function browserContext() {
  const AudioContext = globalThis.window?.AudioContext || globalThis.window?.webkitAudioContext;
  return AudioContext ? new AudioContext() : null;
}

// decodeAudioData in both the promise form and the old callback form (older Safari).
function decode(context, bytes) {
  return new Promise((resolve, reject) => {
    const result = context.decodeAudioData(bytes, resolve, reject);
    result?.then?.(resolve, reject);
  });
}

// Set an AudioParam now or, with glide seconds, smoothly (no clicks). Works on
// the plain { value } objects older browsers and the tests provide.
function setParam(param, value, context, glide = 0) {
  if (!param) return;
  const now = context?.currentTime;
  if (glide > 0 && typeof now === 'number' && param.setTargetAtTime) {
    param.cancelScheduledValues?.(now);
    param.setValueAtTime?.(param.value, now);
    param.setTargetAtTime(value, now, glide / 3);
  } else {
    param.value = value;
  }
}

// Put a panner or the listener at a point (new AudioParam style, else the old setters).
function placeAt(node, { x, y, z }) {
  if (node.positionX) {
    node.positionX.value = x;
    node.positionY.value = y;
    node.positionZ.value = z;
  } else {
    node.setPosition?.(x, y, z);
  }
}

// ---- One playing sound ----

class Voice {
  constructor(service, fields) {
    this.service = service;
    Object.assign(this, fields);
    this.stopped = false;
  }

  // Stop now, with a tiny fade so it doesn't click (fade 0 = cut). Safe to call twice.
  stop(fade = this.service.config.stopFade) {
    if (this.stopped) return;
    this.stopped = true;
    this.service.voices.delete(this);
    const context = this.service.context;
    const now = context?.currentTime;
    try {
      if (fade > 0 && typeof now === 'number' && this.amp.gain.setTargetAtTime) {
        this.amp.gain.cancelScheduledValues?.(now);
        this.amp.gain.setTargetAtTime(0, now, fade / 3);
        this.source.stop(now + fade);
      } else {
        this.source.stop();
      }
    } catch { /* Already finished. */ }
  }

  // Free the nodes once the browser says it has ended.
  release() {
    this.stopped = true;
    this.service.voices.delete(this);
    for (const node of [this.source, this.amp, this.panner]) {
      try { node?.disconnect(); } catch { /* Not connected. */ }
    }
  }
}

// ---- The engine ----

export class AudioService {
  // manifest: the sound list (src/audio/sounds.json). config: the mix (audioConfig.js).
  // settings: the player's volumes and mute (AudioSettings, remembered in the browser).
  // fetchFile(url): how files are downloaded (the game passes its loader, so they
  //   count on the loading bar; plain fetch() by default).
  // createContext(): makes the AudioContext on the first gesture (tests pass fakes).
  // quality: the graphics preset name; 'high' gets HRTF 3D sound (config.positional.hrtfOn).
  // random(): 0-1, for the per-play pitch and volume spread. signal: page
  //   listeners end with it. probe: what to ask about formats (an <audio>).
  // listen: false skips the page listeners (tests and tools unlock by hand).
  constructor({ manifest = SOUND_MANIFEST, config = AUDIO_CONFIG, settings = new AudioSettings(), fetchFile = (url) => fetch(url),
    createContext = browserContext, quality = 'high', random = Math.random, now = () => performance.now(), signal = null,
    probe = undefined, dev = DEV, warn = (...args) => console.warn(...args), listen = true } = {}) {
    Object.assign(this, { manifest, config, settings, fetchFile, createContext, random, now, dev, warn });
    // 1. The sounds by id, and the formats this browser plays (best first).
    this.sounds = new Map(manifest.sounds.map((sound) => [sound.id, sound]));
    this.supported = supportedFormats(probe);
    this.hrtf = config.positional.hrtfOn.includes(quality);
    // 2. Playback state: the context and mixer (made on the first gesture), the
    //    decoded takes, what is playing, and the looping beds that should be.
    this.context = null;
    this.nodes = null;
    this.buffers = new Map();
    this.voices = new Set();
    this.serial = 0;
    this.epoch = 0;
    this.soundReady = new Map();
    this.ready = Promise.resolve();
    this.loops = new Map();
    this.wantedLoops = new Set();
    // 3. The map's scale (distances in the config are map units) and the ears' position.
    this.distanceScale = 1;
    this.listenerPosition = { x: 0, y: 0, z: 0 };
    // 4. Start every download now (only files the manifest lists; an empty slot fetches nothing).
    this.prefetched = new Map();
    for (const sound of manifest.sounds) {
      for (const variation of sound.variations) {
        const [best] = formatOrder(variation.files, this.supported);
        if (best) this.prefetched.set(variation.name, this.fetchTake(sound, variation, best));
      }
    }
    // 5. Volume changes reach the mixer; mute silences everything at once.
    this.offSettings = settings.onChange((name, value) => this.settingChanged(name, value));
    // 6. Page listeners: any gesture unlocks sound, a hidden tab suspends it.
    this.events = new AbortController();
    signal?.addEventListener?.('abort', () => this.events.abort(), { once: true });
    if (listen) this.listenToPage();
  }

  // ---- Settings ----

  get muted() { return this.settings.muted; }

  // A bus's volume right now: its mix level times its player slider.
  busLevel(bus) {
    const entry = this.config.buses[bus];
    if (!entry) return 0;
    return entry.level * (this.settings.get(entry.group) ?? 1);
  }

  // The whole mix's volume: the master slider, or nothing while muted.
  masterLevel() {
    return this.muted ? 0 : this.settings.get('master');
  }

  settingChanged(name) {
    this.applyVolumes(this.config.volumeGlide);
    if (name !== 'muted') return;
    // Mute: everything stops (nothing replays later). Unmute: sound can start again.
    if (this.muted) this.stopAll();
    else this.unlock();
  }

  // Push the settings into the mixer's gains.
  applyVolumes(glide = 0) {
    if (!this.nodes) return;
    setParam(this.nodes.master.gain, this.masterLevel(), this.context, glide);
    for (const [bus, node] of Object.entries(this.nodes.buses)) setParam(node.gain, this.busLevel(bus), this.context, glide);
  }

  // ---- Starting and stopping the device ----

  // Make (or wake) the AudioContext. Browsers only allow this during a key,
  // click or touch, so every gesture calls it. Does nothing while muted.
  unlock() {
    if (this.muted || this.disposed) return;
    if (!this.context) this.start();
    const context = this.context;
    if (context && context.state !== 'running' && context.state !== 'closed') context.resume?.()?.catch?.(() => {});
  }

  // The context, the mixer, then every take decoded.
  start() {
    let context = null;
    try {
      context = this.createContext();
    } catch (error) {
      this.warn('Audio: no sound device', error);
    }
    if (!context) return;
    this.context = context;
    // 1. The mixer: buses -> master volume -> limiter -> speakers.
    const master = context.createGain();
    const limiter = context.createDynamicsCompressor?.() ?? null;
    if (limiter) {
      for (const [key, value] of Object.entries(this.config.limiter)) if (limiter[key]) limiter[key].value = value;
      master.connect(limiter);
      limiter.connect(context.destination);
    } else {
      master.connect(context.destination);
    }
    const buses = {};
    for (const bus of Object.keys(this.config.buses)) {
      buses[bus] = context.createGain();
      buses[bus].connect(master);
    }
    this.nodes = { master, limiter, buses };
    this.applyVolumes();
    // 2. Decode every take; each sound can play as soon as its own takes are in.
    for (const sound of this.manifest.sounds) {
      this.soundReady.set(sound.id, Promise.all(sound.variations.map((variation) => this.decodeTake(sound, variation, context))));
    }
    this.ready = Promise.all(this.soundReady.values()).then(() => this.startLoops());
  }

  // Suspend the device (hidden tab); effects stop, a looping bed pauses with it.
  suspend() {
    this.stopAll({ keepLoops: true });
    this.context?.suspend?.()?.catch?.(() => {});
  }

  // Wake it again after suspend() (only once it was started and while not muted).
  resume() {
    if (!this.muted && this.context) this.context.resume?.()?.catch?.(() => {});
  }

  // The session is over: silence, no listeners, and the audio device freed.
  dispose() {
    this.disposed = true;
    this.stopAll();
    this.wantedLoops.clear();
    this.offSettings?.();
    this.events.abort();
    this.context?.close?.()?.catch?.(() => {});
    this.context = null;
    this.nodes = null;
  }

  // ---- Files ----

  // Download one take in one format. Resolves to { format, bytes } or null
  // (a missing, unreachable or non-audio file stays silent, with a warning).
  async fetchTake(sound, variation, format) {
    const file = variation.files[format];
    const url = fileUrl(file);
    const dropIn = isDropIn(file);
    if (!url) {
      this.report(`Audio: "${file}" (sound "${sound.id}") is not a file the game can load`, false);
      return null;
    }
    try {
      const response = await this.fetchFile(url);
      if (!isAudioResponse(response, { strict: dropIn })) {
        const type = response?.headers?.get?.('content-type') ?? 'none';
        this.report(`Audio: ${file} (sound "${sound.id}") is not a sound file (status ${response?.status}, type ${type}); it stays silent`, dropIn);
        return null;
      }
      return { format, bytes: await response.arrayBuffer() };
    } catch (error) {
      this.report(`Audio: could not download ${file} (sound "${sound.id}"): ${error?.message ?? error}`, dropIn);
      return null;
    }
  }

  // Decode a take: the downloaded format first, then any other format it has
  // (a browser can claim Opus support and still fail to decode it).
  async decodeTake(sound, variation, context) {
    const order = formatOrder(variation.files, this.supported);
    for (let i = 0; i < order.length; i += 1) {
      const loaded = await (i === 0 ? this.prefetched.get(variation.name) : this.fetchTake(sound, variation, order[i]));
      if (!loaded) continue;
      try {
        const buffer = await decode(context, loaded.bytes);
        this.buffers.set(variation.name, buffer);
        return buffer;
      } catch (error) {
        this.report(`Audio: could not decode ${variation.files[order[i]]} (sound "${sound.id}"): ${error?.message ?? error}`,
          isDropIn(variation.files[order[i]]));
      }
    }
    return null;
  }

  // A file problem. Drop-in files only warn in development (an empty or
  // half-filled slot is normal); a built file failing is always worth a warning.
  report(message, dropIn) {
    if (!dropIn || this.dev) this.warn(message);
  }

  // ---- Playing ----

  // The sound with this id, or undefined.
  sound(id) {
    return this.sounds.get(id);
  }

  // Whether the sound has a decoded take ready to play.
  has(id) {
    return Boolean(this.sound(id)?.variations.some((variation) => this.buffers.has(variation.name)));
  }

  // Play a sound now. Returns the voice (stop() it to cut it short) or null if
  // it can't play: unknown id, nothing decoded, no running device, muted, or
  // its voice limit is full of more important sounds. Options:
  //   at          { x, y, z } world position: placed in 3D (no position = plain stereo)
  //   gain        extra volume factor; rate: extra pitch factor
  //   variation   a take name (default: a random decoded take); buffer: play this buffer instead
  //   offset / duration   play only part of the recording (seconds)
  //   fadeIn / fadeOut    short volume ramps (seconds) around that part
  //   loop        repeat until stopped
  play(id, { at = null, gain = 1, rate = 1, variation = null, buffer = null, offset = 0, duration, fadeIn = 0, fadeOut = 0,
    loop = false } = {}) {
    const context = this.context;
    const sound = this.sound(id);
    if (!sound || !context || !this.nodes || this.muted || context.state !== 'running') return null;
    // 1. Which recording: the given buffer, the named take, or a random decoded take.
    const recording = buffer ?? this.pickTake(sound, variation);
    if (!recording) return null;
    // 2. Room under the sound's, its bus's and the global voice limits.
    if (!this.makeRoom(sound)) return null;
    try {
      return this.startVoice(sound, recording, { at, gain, rate, offset, duration, fadeIn, fadeOut, loop });
    } catch (error) {
      this.report(`Audio: could not play "${id}": ${error?.message ?? error}`, false);
      return null;
    }
  }

  // Like play(), but waits for the sound's files to finish decoding (the first
  // shots after the unlocking click). A sound that would start more than
  // config.staleAfter late, or after stopAll() / mute, is dropped instead.
  async playSoon(id, options) {
    const context = this.context, epoch = this.epoch, requested = this.now();
    if (!context || this.muted) return null;
    await (this.soundReady.get(id) ?? this.ready);
    if (this.muted || epoch !== this.epoch || this.context !== context || context.state !== 'running'
      || this.now() - requested > this.config.staleAfter * 1000) return null;
    return this.play(id, options);
  }

  // A random decoded take (or the named one).
  pickTake(sound, name) {
    if (name) return this.buffers.get(name) ?? null;
    const decoded = sound.variations.map((variation) => this.buffers.get(variation.name)).filter(Boolean);
    return decoded.length ? decoded[Math.floor(this.random() * decoded.length) % decoded.length] : null;
  }

  // Replace lower-priority voices until the sound fits its own, its bus's and the
  // global limits. Returns false (skip the new sound) if a limit is full of more
  // important ones.
  makeRoom(sound) {
    const limits = [
      [sound.maxVoices ?? Infinity, (voice) => voice.id === sound.id],
      [this.config.buses[sound.bus]?.maxVoices ?? Infinity, (voice) => voice.bus === sound.bus],
      [this.config.maxVoices, () => true],
    ];
    for (const [limit, belongs] of limits) {
      let group = [...this.voices].filter(belongs);
      while (group.length >= limit) {
        const victim = pickVoiceToReplace(group, sound.priority);
        if (!victim) return false;
        victim.stop();
        group = group.filter((voice) => voice !== victim);
      }
    }
    return true;
  }

  // Build the voice's nodes and start it.
  startVoice(sound, recording, { at, gain, rate, offset, duration, fadeIn, fadeOut, loop }) {
    const context = this.context;
    const spread = (amount) => 1 + (this.random() * 2 - 1) * (amount ?? 0);
    // 1. The recording, at this play's pitch.
    const source = context.createBufferSource();
    source.buffer = recording;
    const playbackRate = rate * spread(sound.variation?.pitch);
    if (source.playbackRate) source.playbackRate.value = playbackRate;
    source.loop = loop || Boolean(sound.loop);
    // 2. Its volume (with this play's spread), as an envelope when only part plays.
    const level = sound.gain * gain * spread(sound.variation?.volume);
    const amp = context.createGain();
    // 3. Placed in the world, or straight to its bus.
    let output = amp, panner = null, distanceShare = 1;
    if (at) {
      panner = context.createPanner?.() ?? null;
      if (panner) {
        this.configurePanner(panner, sound, at);
        amp.connect(panner);
        output = panner;
      } else {
        // No 3D panner here: at least fade with distance, on the same curve.
        distanceShare = distanceGain(Math.hypot(at.x - this.listenerPosition.x, at.y - this.listenerPosition.y,
          at.z - this.listenerPosition.z), this.distanceParams(sound));
      }
    }
    this.envelope(amp.gain, level * distanceShare, { duration: duration === undefined ? undefined : duration / playbackRate, fadeIn, fadeOut });
    output.connect(this.nodes.buses[sound.bus]);
    source.connect(amp);
    // 4. Remember it until it ends, then free its nodes.
    const voice = new Voice(this, { id: sound.id, bus: sound.bus, priority: sound.priority, serial: (this.serial += 1),
      source, amp, panner, loop: source.loop, at: at ? { x: at.x, y: at.y, z: at.z } : null });
    this.voices.add(voice);
    source.onended = () => voice.release();
    if (duration !== undefined) source.start(0, offset, duration);
    else if (offset) source.start(0, offset);
    else source.start();
    return voice;
  }

  // Full volume at once, or ramps around a part of the recording.
  envelope(param, level, { duration, fadeIn, fadeOut }) {
    const now = this.context.currentTime;
    if (!(fadeIn || fadeOut) || typeof now !== 'number' || !param.linearRampToValueAtTime) {
      param.value = level;
      return;
    }
    param.setValueAtTime(0, now);
    param.linearRampToValueAtTime(level, now + Math.max(fadeIn, 0.001));
    if (duration !== undefined && fadeOut) {
      param.setValueAtTime(level, now + Math.max(duration - fadeOut, fadeIn));
      param.linearRampToValueAtTime(0, now + duration);
    }
  }

  // ---- Sounds in the world ----

  // A sound's distance fading, in scene units (map units times the map's scale).
  distanceParams(sound) {
    const base = this.config.positional, own = sound.distance ?? {};
    return {
      ref: (own.ref ?? base.ref) * this.distanceScale,
      max: (own.max ?? base.max) * this.distanceScale,
      rolloff: own.rolloff ?? base.rolloff,
    };
  }

  // A 3D panner at `at`: HRTF on high quality, simple panning otherwise.
  configurePanner(panner, sound, at) {
    const { ref, max, rolloff } = this.distanceParams(sound);
    panner.panningModel = this.hrtf ? 'HRTF' : 'equalpower';
    panner.distanceModel = this.config.positional.model;
    panner.refDistance = ref;
    panner.maxDistance = max;
    panner.rolloffFactor = rolloff;
    placeAt(panner, at);
  }

  // Put the ears somewhere: position, and the forward and up directions.
  setListener({ position, forward, up }) {
    this.listenerPosition = { ...position };
    const listener = this.context?.listener;
    if (!listener) return;
    placeAt(listener, position);
    if (listener.forwardX) {
      listener.forwardX.value = forward.x; listener.forwardY.value = forward.y; listener.forwardZ.value = forward.z;
      listener.upX.value = up.x; listener.upY.value = up.y; listener.upZ.value = up.z;
    } else {
      listener.setOrientation?.(forward.x, forward.y, forward.z, up.x, up.y, up.z);
    }
  }

  // Every frame (late phase, after the camera moved): the ears follow the camera,
  // kept near focus (Lola). Also starts the ambience when it can, and lets a
  // gamepad press unlock sound.
  followCamera(camera, focus = null) {
    const elements = camera?.matrixWorld?.elements;
    if (elements) {
      this.setListener(listenerPose(elements, focus, this.config.listener.maxDistanceFromPlayer * this.distanceScale));
    }
    this.pollGamepads();
    if (this.wantedLoops.size) this.startLoops();
  }

  // ---- Looping beds (ambience) ----

  // Keep a looping sound playing (from when sound can start, until stopLoop()).
  startLoop(id) {
    this.wantedLoops.add(id);
    this.startLoops();
  }

  stopLoop(id) {
    this.wantedLoops.delete(id);
    this.loops.get(id)?.stop(0.5);
    this.loops.delete(id);
  }

  // Start every wanted loop that isn't playing (each waits for its file and the device).
  startLoops() {
    for (const id of this.wantedLoops) {
      const voice = this.loops.get(id);
      if (voice && !voice.stopped) continue;
      const started = this.has(id) ? this.play(id, { loop: true }) : null;
      if (started) this.loops.set(id, started);
      else this.loops.delete(id);
    }
  }

  // ---- Stopping ----

  // Stop every sound. keepLoops: leave the ambience bed running. Sounds still
  // waiting for their files (playSoon) are dropped too.
  stopAll({ keepLoops = false } = {}) {
    this.epoch += 1;
    for (const voice of [...this.voices]) {
      if (keepLoops && voice.loop) continue;
      voice.stop();
    }
  }

  // Stop every voice of one sound (e.g. the Leaper's footsteps when it pauses).
  stopSound(id) {
    for (const voice of [...this.voices]) if (voice.id === id) voice.stop();
  }

  // ---- Page listeners ----

  listenToPage() {
    const options = { capture: true, signal: this.events.signal };
    const unlock = () => this.unlock();
    // Touch browsers only allow sound on a finger lift (pointerup / touchend).
    for (const type of ['pointerdown', 'pointerup', 'mousedown', 'keydown', 'touchend', 'gamepadconnected']) {
      globalThis.window?.addEventListener?.(type, unlock, options);
    }
    globalThis.document?.addEventListener?.('visibilitychange', () => {
      if (globalThis.document.hidden) this.suspend();
      else this.resume();
    }, { signal: this.events.signal });
  }

  // A gamepad button counts as a gesture where the browser allows it (checked
  // each frame only until sound is running).
  pollGamepads() {
    if (this.muted || this.context?.state === 'running') return;
    const pads = globalThis.navigator?.getGamepads?.() ?? [];
    if ([...pads].some((pad) => pad?.buttons?.some((button) => button.pressed))) this.unlock();
  }
}

// The groups the player's sliders move (re-exported for settings views).
export { AUDIO_GROUPS };
