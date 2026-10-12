import test from 'node:test';
import assert from 'node:assert/strict';
import { LaserAudio } from '../src/simulation/LaserAudio.js';

test('laser audio requires a gesture, respects mute, and schedules a short falling pitch', () => {
  const gestures = {};
  const calls = [];
  let contexts = 0;
  const parameter = { value: 0, setValueAtTime: (...v) => calls.push(['set', ...v]),
    exponentialRampToValueAtTime: (...v) => calls.push(['ramp', ...v]) };
  class AudioContext {
    constructor() { contexts++; this.state = 'running'; this.currentTime = 5; this.destination = {}; }
    createOscillator() { return { frequency: parameter, connect() {}, disconnect() {},
      start: t => calls.push(['start', t]), stop: t => calls.push(['stop', t]) }; }
    createGain() { return { gain: parameter, connect() {}, disconnect() {} }; }
    createBiquadFilter() { return { frequency: {}, connect() {}, disconnect() {} }; }
  }
  globalThis.window = { AudioContext, addEventListener: (name, fn) => { gestures[name] = fn; } };
  const audio = new LaserAudio(); audio.fire();
  assert.equal(contexts, 0); assert.equal(calls.length, 0);
  gestures.pointerdown(); audio.fire();
  assert.equal(contexts, 1);
  assert.ok(calls.some(c => c[0] === 'ramp' && c[1] === 180));
  assert.ok(calls.some(c => c[0] === 'stop' && c[1] === 5.17));
  const count = calls.length; audio.enabled = false; audio.fire();
  assert.equal(calls.length, count);
  audio.enabled = true; audio.context.state = 'suspended'; audio.fire();
  assert.equal(calls.length, count);
});
