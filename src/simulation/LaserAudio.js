// Short synthesized laser crack/chirp. No downloads or autoplay before a gesture.
export class LaserAudio {
  constructor() {
    this.enabled = true;
    this.context = null;
    this.unlock = () => {
      if (!this.enabled) return;
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      this.context ||= new AudioContext();
      if (this.context.state === 'suspended') this.context.resume().catch(() => {});
    };
    window.addEventListener('pointerdown', this.unlock, { capture: true });
    window.addEventListener('keydown', this.unlock, { capture: true });
  }
  fire() {
    const context = this.context;
    if (!this.enabled || context?.state !== 'running') return;
    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const filter = context.createBiquadFilter();
    oscillator.type = 'sawtooth';
    oscillator.frequency.setValueAtTime(1500, now);
    oscillator.frequency.exponentialRampToValueAtTime(180, now + 0.14);
    filter.type = 'lowpass'; filter.frequency.value = 3200;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.12, now + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
    oscillator.connect(filter); filter.connect(gain); gain.connect(context.destination);
    oscillator.onended = () => { oscillator.disconnect(); filter.disconnect(); gain.disconnect(); };
    oscillator.start(now); oscillator.stop(now + 0.17);
  }
}
