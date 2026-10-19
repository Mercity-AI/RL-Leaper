import test from 'node:test';
import assert from 'node:assert/strict';
import { GameAudio } from '../src/audio/GameAudio.js';
import { AudioSettings } from '../src/audio/AudioSettings.js';
import { LaserAudio } from '../src/simulation/LaserAudio.js';
import { FakeContext, fakeFetch } from './audio-fakes.js';

// The game-facing sound API (src/audio/GameAudio.js, also exported as the old
// LaserAudio): which sounds are placed in the world and where.

async function gameAudio() {
  globalThis.document = { hidden: false, hasFocus: () => true, addEventListener() {} };
  globalThis.window = { addEventListener() {} };
  const context = new FakeContext();
  const audio = new GameAudio({ settings: new AudioSettings({ storage: null }), fetchFile: fakeFetch().fetch,
    createContext: () => context, random: () => 0.5 });
  audio.unlock();
  await audio.ready;
  return { audio, context };
}

// Something with a three.js world matrix at (x, y, z).
const at = (x, y, z) => ({ matrixWorld: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1] } });
const position = (panner) => [panner.positionX.value, panner.positionY.value, panner.positionZ.value];

test('the old LaserAudio name is the same engine', () => {
  assert.equal(LaserAudio, GameAudio);
});

test('Leaper sounds play at the Leaper: the laser at its eye, its slots at its body', async () => {
  const { audio } = await gameAudio();
  audio.setEmitter('leaper', at(10, 0, -4));
  audio.setEmitter('leaperEye', at(10, 2, -4));
  // The laser, with no position given, comes from the eye.
  const laser = await audio.fire();
  assert.deepEqual(position(laser.panner), [10, 2, -4]);
  // A slot that names the Leaper as its emitter plays at its body...
  const knee = await audio.playSlot('kneeBreak');
  assert.deepEqual(position(knee.panner), [10, 0, -4]);
  // ...unless the caller says where (the knee itself, where the bullet hit).
  const placed = await audio.playSlot('kneeBreak', { at: { x: 1, y: 2, z: 3 } });
  assert.deepEqual(position(placed.panner), [1, 2, 3]);
  // An emitter can also be a function.
  audio.setEmitter('leaper', () => ({ x: -5, y: 0, z: 5 }));
  assert.deepEqual(position((await audio.playSlot('kneeBreak')).panner), [-5, 0, 5]);
  // Without an emitter set, they play centred rather than failing.
  audio.setEmitter('leaper', null);
  assert.equal((await audio.playSlot('kneeBreak')).panner, null);
});

test('impacts are placed where the bullet hit; Lola\'s own gun stays centred', async () => {
  const { audio } = await gameAudio();
  const impact = await audio.play('leaper', { at: { x: 4, y: 1, z: 9 } });
  assert.deepEqual(position(impact.panner), [4, 1, 9]);
  assert.equal((await audio.play('m416')).panner, null);
  assert.equal((await audio.play('pistol')).panner, null);
});

test('the Leaper\'s footsteps are placed at its feet, Lola\'s are not', async () => {
  const { audio } = await gameAudio();
  const robot = audio.step('robot', false, 1, { x: 3, y: 0, z: 3 });
  assert.deepEqual(position(robot.panner), [3, 0, 3]);
  assert.equal(robot.source.started[2], 0.48, 'the same 0.48 s cut as before');
  const lola = audio.step('walk');
  assert.equal(lola.panner, null);
  assert.equal(audio.step('run').source.started[2], 0.2, 'sprint: shorter cut of the walk recording');
  // Old callers that pass a volume instead of a position still work.
  assert.ok(Math.abs(audio.step('robot', false, 0.5).amp.gain.peak - 0.45 * 0.5) < 1e-9);
});

test('mute is the remembered setting, and the toolbar switch drives it', async () => {
  const { audio } = await gameAudio();
  assert.equal(audio.enabled, true);
  audio.enabled = false;
  assert.equal(audio.settings.muted, true);
  assert.equal(await audio.play('m416'), null);
  audio.settings.muted = false;
  assert.equal(audio.enabled, true);
  assert.ok(await audio.play('m416'));
});
