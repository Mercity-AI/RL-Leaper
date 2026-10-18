const CLIPS = {
  laser: new URL('../../assets/audio/leaper-laser.wav', import.meta.url),
  pistol: new URL('../../assets/audio/pistol-shot.wav', import.meta.url),
  m416: new URL('../../assets/audio/m416-shot.wav', import.meta.url),
  leaper: new URL('../../assets/audio/leaper-hit.wav', import.meta.url),
  run: new URL('../../assets/audio/lola-run.wav', import.meta.url),
  walk: new URL('../../assets/audio/lola-walk.wav', import.meta.url),
  robot: new URL('../../assets/audio/leaper-walk.wav', import.meta.url),
  m416Reload: new URL('../../assets/audio/m416-reload-reserved.wav', import.meta.url),
  pistolReload: new URL('../../assets/audio/pistol-reload-reserved.wav', import.meta.url),
};
const LEVELS = { laser: 0.65, m416: 0.12, pistol: 0.45, leaper: 0.7, m416Reload: 0.35, pistolReload: 0.6 };
// Empty sound slots: drop a .wav with one of these names into public/audio/ and
// it plays on the next page load, no code change needed. Missing files stay silent.
// Several names in one slot are random variations so repeats don't sound copied.
const OPTIONAL = {
  kneeBreak: { files: ['leaper-knee-break-1', 'leaper-knee-break-2'], level: 0.8 },
  gunEmpty: { files: ['gun-empty'], level: 0.7 },
  lolaHurt: { files: ['lola-hurt-1', 'lola-hurt-2', 'lola-hurt-3'], level: 0.7 },
  lolaHurtBig: { files: ['lola-hurt-big'], level: 0.8 },
  lolaHitThud: { files: ['lola-hit-thud'], level: 0.5 },
};
const OPTIONAL_BASE = `${import.meta.env?.BASE_URL ?? '/'}audio/`;
// Isolated impacts measured in the supplied recordings (seconds). The running
// loop is re-sequenced on animation contacts, so it cannot drift from the feet.
const FOOTSTEPS = {
  run: [0.06, 0.4, 0.73, 1.065, 1.37, 1.72, 2.025, 2.37, 2.7, 3.055, 3.36, 3.705],
  walk: [0.285, 0.82, 1.395, 1.955, 2.615, 3.095, 3.66, 4.2, 4.78, 5.31],
  robot: [0.07, 0.62, 1.17, 1.72, 2.27, 2.82],
};

// Shared recorded combat audio.
export class LaserAudio {
  constructor() {
    this._enabled = true;
    this.context = null;
    this.buffers = {};
    this.voices = new Set();
    this.epoch = 0;
    this.stepIndex = { run: 0, walk: 0, robot: 0 };
    this.robotVoices = new Set();
    this.data = Object.fromEntries(Object.entries(CLIPS).map(([key, url]) => [key,
      fetch(url).then(response => {
        if (!response.ok) throw new Error(`Audio ${key}: ${response.status}`);
        return response.arrayBuffer();
      }).catch(error => { console.warn(error); return null; }),
    ]));
    this.optionalBuffers = {};
    this.optionalData = Object.values(OPTIONAL).flatMap(slot => slot.files).map(name => [name,
      Promise.resolve().then(() => fetch(`${OPTIONAL_BASE}${name}.wav`))
        .then(response => (response.ok ? response.arrayBuffer() : null)).catch(() => null)]);
    this.unlock = () => {
      if (!this.enabled) return;
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      if (!this.context) {
        this.context = new AudioContext();
        this.ready = Promise.all(Object.entries(this.data).map(async ([key, data]) => {
          try {
            const bytes = await data;
            if (bytes) this.buffers[key] = await this.context.decodeAudioData(bytes);
          } catch (error) { console.warn(`Could not decode ${key}`, error); }
        }).concat(this.optionalData.map(async ([name, data]) => {
          try {
            const bytes = await data;
            if (bytes) this.optionalBuffers[name] = await this.context.decodeAudioData(bytes);
          } catch { /* An unfilled slot is expected. */ }
        })));
      }
      if (this.context.state === 'suspended') this.context.resume().catch(() => {});
    };
    window.addEventListener('pointerdown', this.unlock, { capture: true });
    window.addEventListener('keydown', this.unlock, { capture: true });
    window.addEventListener('blur', () => this.stop());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.stop(); });
  }
  get enabled() { return this._enabled; }
  set enabled(value) { this._enabled = value; if (!value) this.stop(); }
  fire() { return this.play('laser'); }
  step(kind, crouched = false, volume = 1) {
    // Sprinting reuses the normal footstep recording; the faster foot contacts
    // already speed it up. Only each step is cut shorter so steps don't overlap.
    const sprinting = kind === 'run';
    if (sprinting) kind = 'walk';
    const context = this.context, buffer = this.buffers[kind];
    if (!this.enabled || document.hidden || !document.hasFocus() || context?.state !== 'running' || !buffer) return;
    const peaks = FOOTSTEPS[kind];
    if (!peaks) return;
    const peak = peaks[this.stepIndex[kind]++ % peaks.length];
    // Find the impact onset immediately preceding this peak; retain its texture.
    const samples = buffer.getChannelData(0), rate = buffer.sampleRate;
    let start = Math.max(0, Math.floor((peak - 0.07) * rate));
    const end = Math.floor(peak * rate);
    let maximum = 0;
    for (let i = start; i <= end; i++) maximum = Math.max(maximum, Math.abs(samples[i]));
    while (start < end && Math.abs(samples[start]) < maximum * 0.12) start++;
    const source = context.createBufferSource(), gain = context.createGain();
    source.buffer = buffer;
    const duration = kind === 'robot' ? 0.48 : sprinting ? 0.2 : 0.3;
    const level = (kind === 'robot' ? 0.45 : kind === 'run' ? 0.35 : 1.6)
      * (crouched ? 0.45 : 1) * Math.max(0, Math.min(1, volume));
    if (kind === 'robot' && this.robotVoices.size >= 3) this.robotVoices.values().next().value.stop();
    gain.gain.setValueAtTime(0, context.currentTime);
    gain.gain.linearRampToValueAtTime(level, context.currentTime + 0.003);
    gain.gain.setValueAtTime(level, context.currentTime + duration - 0.04);
    gain.gain.linearRampToValueAtTime(0, context.currentTime + duration);
    source.connect(gain); gain.connect(context.destination);
    this.voices.add(source);
    if (kind === 'robot') this.robotVoices.add(source);
    source.onended = () => {
      this.voices.delete(source); this.robotVoices.delete(source);
      source.disconnect(); gain.disconnect();
    };
    source.start(0, start / rate, duration);
  }
  async play(key) {
    if (!(key in LEVELS)) return;
    return this.playBuffer(() => this.buffers[key], LEVELS[key]);
  }
  // Plays a random filled variation of an optional slot; silent while empty.
  async playSlot(slot) {
    const entry = OPTIONAL[slot];
    if (!entry) return;
    return this.playBuffer(() => {
      const filled = entry.files.map(name => this.optionalBuffers[name]).filter(Boolean);
      return filled[Math.floor(Math.random() * filled.length)];
    }, entry.level);
  }
  async playBuffer(pick, level) {
    const context = this.context, epoch = this.epoch, requested = performance.now();
    if (!this.enabled || !context) return;
    await this.ready;
    const buffer = pick();
    // Never replay old shots after tab switches, reset, mute, or a slow load.
    if (!this.enabled || epoch !== this.epoch || context.state !== 'running'
        || !buffer || performance.now() - requested > 250) return;
    if (this.voices.size >= 16) this.voices.values().next().value.stop();
    const source = context.createBufferSource(), gain = context.createGain();
    source.buffer = buffer;
    gain.gain.value = level;
    source.connect(gain); gain.connect(context.destination);
    this.voices.add(source);
    source.onended = () => { this.voices.delete(source); source.disconnect(); gain.disconnect(); };
    source.start();
    // Returned so a caller can cut it short (e.g. an interrupted reload).
    return source;
  }
  stop() {
    this.epoch++;
    for (const source of this.voices) source.stop();
    this.voices.clear();
    this.robotVoices.clear();
  }

  stopRobotSteps() {
    for (const source of this.robotVoices) {
      source.stop();
      this.voices.delete(source);
    }
    this.robotVoices.clear();
  }
}
