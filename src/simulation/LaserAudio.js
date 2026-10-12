// Low, rising-and-falling warning-siren shot voice. No downloads or autoplay before a gesture.
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
    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(220, now);
    oscillator.frequency.exponentialRampToValueAtTime(390, now + 0.22);
    oscillator.frequency.exponentialRampToValueAtTime(220, now + 0.48);
    oscillator.frequency.exponentialRampToValueAtTime(165, now + 0.78);
    filter.type = 'lowpass'; filter.frequency.value = 1100;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.16, now + 0.035);
    gain.gain.exponentialRampToValueAtTime(0.10, now + 0.4);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.8);
    oscillator.connect(filter); filter.connect(gain); gain.connect(context.destination);
    oscillator.onended = () => { oscillator.disconnect(); filter.disconnect(); gain.disconnect(); };
    oscillator.start(now); oscillator.stop(now + 0.82);
  }
}
