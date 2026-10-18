import test from 'node:test';
import assert from 'node:assert/strict';
import { LaserAudio } from '../src/simulation/LaserAudio.js';

test('recorded effects require a gesture, overlap, mute immediately and do not replay after reset', async () => {
  const gestures = {}, played = [], stopped = [], gains = [];
  let contexts = 0;
  globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) });
  globalThis.document = { hidden: false, addEventListener() {} };
  class AudioContext {
    constructor() { contexts++; this.state = 'running'; this.destination = {}; }
    async decodeAudioData(bytes) { return { bytes }; }
    createBufferSource() {
      return { connect() {}, disconnect() {},
        start() { played.push(this); }, stop() { stopped.push(this); this.onended?.(); } };
    }
    createGain() { const node = { gain: {}, connect() {}, disconnect() {} }; gains.push(node); return node; }
  }
  globalThis.window = { AudioContext, addEventListener: (name, fn) => { gestures[name] = fn; } };
  const audio = new LaserAudio();
  await audio.fire(); assert.equal(contexts, 0);
  gestures.pointerdown(); await audio.ready;
  assert.equal(Object.keys(audio.buffers).length, 9);
  await audio.fire(); await audio.play('m416'); await audio.play('pistol'); await audio.play('leaper');
  assert.equal(played.length, 4);
  assert.equal(gains[1].gain.value, 0.12, 'M416 playback uses the quieter gain');
  assert.deepEqual(played.map(s => s.buffer), ['laser','m416','pistol','leaper'].map(k => audio.buffers[k]));
  audio.enabled = false;
  assert.equal(stopped.length, 4); assert.equal(audio.voices.size, 0);
  await audio.fire(); assert.equal(played.length, 4);
  audio.enabled = true;
  const pending = audio.play('m416'); audio.stop(); await pending;
  assert.equal(played.length, 4, 'reset cancels a pending shot');
  await audio.play('reload'); assert.equal(played.length, 4, 'reload remains reserved');
  audio.context.state = 'suspended'; await audio.fire(); assert.equal(played.length, 4);
});

test('footfalls (normal and sprint) share the walk recording, stop on mute and never queue while unfocused', async () => {
  const played = [], stopped = [];
  globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) });
  globalThis.document = { hidden: false, hasFocus: () => true, addEventListener() {} };
  const buffer = { sampleRate: 100, getChannelData: () => new Float32Array(1600).fill(0.1) };
  class AudioContext {
    constructor() { this.state = 'running'; this.currentTime = 1; this.destination = {}; }
    async decodeAudioData() { return { ...buffer }; }
    createBufferSource() {
      return { connect() {}, disconnect() {}, start(...args) { played.push({ buffer: this.buffer, args }); },
        stop() { stopped.push(this); this.onended?.(); } };
    }
    createGain() { return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {} }, connect() {}, disconnect() {} }; }
  }
  globalThis.window = { AudioContext, addEventListener() {} };
  const audio = new LaserAudio();
  audio.step('run'); assert.equal(played.length, 0);
  audio.unlock(); await audio.ready;
  audio.step('run'); audio.step('walk', true);
  // Sprinting is the same footstep recording as normal running, just shorter, faster steps.
  assert.deepEqual(played.map(p => p.buffer), [audio.buffers.walk, audio.buffers.walk]);
  assert.equal(played[0].args[2], 0.2);
  assert.equal(played[1].args[2], 0.3);
  audio.enabled = false;
  assert.equal(stopped.length, 2);
  audio.step('walk'); assert.equal(played.length, 2);
  audio.enabled = true; document.hasFocus = () => false;
  audio.step('run'); assert.equal(played.length, 2);
  document.hasFocus = () => true;
  audio.step('robot'); audio.step('walk');
  assert.equal(played[2].buffer, audio.buffers.robot);
  assert.equal(played[2].args[2], 0.48);
  assert.equal(audio.robotVoices.size, 1);
  audio.stopRobotSteps();
  assert.equal(audio.robotVoices.size, 0);
  assert.equal(audio.voices.size, 1, 'pausing the Leaper leaves Lola footsteps alone');
});
