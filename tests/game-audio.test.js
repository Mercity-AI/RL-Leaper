import test from 'node:test';
import assert from 'node:assert/strict';
import { GameAudio } from '../src/audio/GameAudio.js';
import { AudioSettings } from '../src/audio/AudioSettings.js';
import { LaserAudio } from '../src/simulation/LaserAudio.js';
import SOUNDS from '../src/audio/sounds.json' with { type: 'json' };
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

test('every slot the game and the Leaper\'s behaviour call has a take; the Leaper\'s are placed at it', () => {
  const byId = new Map(SOUNDS.sounds.map((sound) => [sound.id, sound]));
  // Called by PlayerWeapon, PlayerVitals, LeaperCombat and the Leaper's behaviour layer (src/actors/leaper/).
  const called = ['kneeBreak', 'gunEmpty', 'lolaHurt', 'lolaHurtBig', 'lolaHitThud', 'leaperCharge', 'leaperLock',
    'leaperStompWindup', 'leaperStomp', 'leaperLeapWindup', 'leaperLand', 'leaperStagger', 'leaperDowned', 'leaperCollapse',
    'leaperJointBurst', 'uiClick', 'yardAmbience'];
  for (const id of called) assert.ok(byId.get(id)?.variations.length > 0, `${id} has a recording`);
  assert.equal(byId.get('lolaHurt').variations.length, 3, 'three hurt takes');
  for (const sound of SOUNDS.sounds.filter((entry) => /^leaper[A-Z]/.test(entry.id) && entry.id !== 'leaperBoltImpact')) {
    assert.ok(sound.spatial && ['leaper', 'leaperEye'].includes(sound.emitter), `${sound.id} plays at the Leaper`);
  }
  for (const id of ['lolaHurt', 'lolaHurtBig', 'lolaHitThud', 'uiClick', 'yardAmbience']) assert.equal(byId.get(id).spatial, false);
  assert.equal(byId.get('yardAmbience').bus, 'ambience');
  assert.equal(byId.get('uiClick').bus, 'ui');
});

test('pressing a menu or toolbar button clicks; touch gameplay buttons and scripted clicks stay quiet', async () => {
  const listeners = {};
  globalThis.document = { hidden: false, hasFocus: () => true, addEventListener: (type, fn) => { listeners[type] = fn; } };
  globalThis.window = { addEventListener() {} };
  const audio = new GameAudio({ settings: new AudioSettings({ storage: null }), fetchFile: fakeFetch().fetch,
    createContext: () => new FakeContext(), random: () => 0.5 });
  audio.unlock();
  await audio.ready;
  // A pretend element: closest() answers for the selectors it "matches".
  const element = ({ button = false, silent = false }) => ({
    closest: (selector) => ((selector.includes('button') && button) || (selector.includes('touch-controls') && silent) ? {} : null),
  });
  const clicks = () => [...audio.voices].filter((voice) => voice.id === 'uiClick');
  listeners.click({ isTrusted: true, target: element({ button: true }) });
  assert.equal(clicks().length, 1, 'a real click on a button');
  assert.equal(clicks()[0].amp.outputs[0], audio.service.nodes.buses.ui, 'on the interface bus');
  listeners.click({ isTrusted: true, target: element({ button: true, silent: true }) });
  listeners.click({ isTrusted: false, target: element({ button: true }) });
  listeners.click({ isTrusted: true, target: element({}) });
  assert.equal(clicks().length, 1, 'touch controls, scripted clicks and the game view make no click');
});

test('the yard ambience starts with sound and keeps going through resets', async () => {
  const { audio } = await gameAudio();
  audio.startAmbience();
  const bed = audio.service.loops.get('yardAmbience');
  assert.ok(bed?.source.loop);
  assert.equal(bed.amp.outputs[0], audio.service.nodes.buses.ambience);
  audio.stop();
  assert.ok(!bed.stopped, 'a reset (stop) leaves it playing');
  audio.stopAmbience();
  assert.ok(bed.stopped);
});
