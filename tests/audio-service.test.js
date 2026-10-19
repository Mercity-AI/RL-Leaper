import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioService, distanceGain, listenerPose, pickVoiceToReplace } from '../src/audio/AudioService.js';
import { AudioSettings } from '../src/audio/AudioSettings.js';
import { AUDIO_CONFIG } from '../src/audio/audioConfig.js';
import { audioUrl, fileUrl, formatOrder, isAudioResponse, pickAudioFormat, supportedFormats } from '../src/audio/formats.js';
import { checkManifest, findSound, licenceTerms } from '../src/audio/soundManifest.js';
import SOUNDS from '../src/audio/sounds.json' with { type: 'json' };
import { FakeContext, TEST_CONFIG, fakeFetch, route, testManifest } from './audio-fakes.js';

// The audio engine (src/audio/AudioService.js) against a pretend Web Audio API:
// the mixer's wiring, the player's volumes, voice limits, formats and 3D sound.

// A started engine on the test manifest, with its fake context and downloads.
async function started({ quality = 'high', settings = new AudioSettings({ storage: null }), context = new FakeContext(),
  random = () => 0.5, fetchOptions, config = TEST_CONFIG } = {}) {
  const { fetch, asked } = fakeFetch(fetchOptions);
  const warnings = [];
  const service = new AudioService({ manifest: testManifest(), config, settings, fetchFile: fetch, createContext: () => context,
    quality, random, listen: false, warn: (message) => warnings.push(message), dev: true });
  service.unlock();
  await service.ready;
  return { service, context, settings, asked, warnings };
}

test('every voice runs through its bus, the master volume and the limiter to the speakers', async () => {
  const { service, context } = await started();
  // 1. A plain voice: recording -> its volume -> its bus -> master -> limiter -> speakers.
  const voice = service.play('shot');
  assert.deepEqual(route(voice.source), ['source', 'gain', 'gain', 'gain', 'limiter', 'destination']);
  assert.equal(voice.amp.outputs[0], service.nodes.buses.weapons, 'a weapon sound plays on the weapons bus');
  assert.equal(service.nodes.buses.weapons.outputs[0], service.nodes.master);
  assert.equal(voice.amp.gain.value, 0.5, 'the manifest gain (random 0.5 = no spread)');
  // 2. A placed voice gets a 3D panner between its volume and its bus.
  const boom = service.play('boom', { at: { x: 1, y: 0, z: 2 } });
  assert.deepEqual(route(boom.source), ['source', 'gain', 'panner', 'gain', 'gain', 'limiter', 'destination']);
  assert.equal(boom.panner.outputs[0], service.nodes.buses.creature);
  // 3. The limiter holds the configured settings.
  assert.equal(service.nodes.limiter.threshold.value, -3);
  assert.equal(service.nodes.limiter.ratio.value, 20);
  // 4. One AudioContext for the session, however often sound is unlocked.
  service.unlock();
  service.unlock();
  assert.equal(service.context, context);
});

test('the player volumes move the buses they belong to, and mute silences and stops everything', async () => {
  const { service, settings } = await started();
  const buses = service.nodes.buses;
  // 1. Defaults: bus level x slider (1), master 1.
  assert.equal(buses.creature.gain.value, 0.8);
  assert.equal(buses.ui.gain.value, 0.6);
  assert.equal(service.nodes.master.gain.value, 1);
  // 2. Each slider moves only its own buses.
  settings.set('sfx', 0.5);
  assert.equal(buses.weapons.gain.value, 0.5);
  assert.equal(buses.creature.gain.value, 0.4);
  assert.equal(buses.ui.gain.value, 0.6, 'the interface slider is separate');
  settings.set('ambience', 0.2);
  assert.equal(buses.ambience.gain.value, 0.1);
  settings.set('ui', 0);
  assert.equal(buses.ui.gain.value, 0);
  settings.set('master', 0.25);
  assert.equal(service.nodes.master.gain.value, 0.25);
  // 3. Volumes are clamped to 0-1.
  settings.set('master', 7);
  assert.equal(settings.get('master'), 1);
  // 4. Mute: everything stops at once, the master goes to 0, nothing new plays.
  const voice = service.play('shot');
  settings.muted = true;
  assert.equal(service.nodes.master.gain.value, 0);
  assert.ok(voice.stopped && service.voices.size === 0, 'playing sounds stop');
  assert.equal(service.play('shot'), null, 'nothing plays while muted');
  settings.muted = false;
  assert.ok(service.play('shot'), 'sound comes back');
});

test('the settings are remembered in the browser and survive bad saved data', () => {
  const store = new Map();
  const storage = { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) };
  const first = new AudioSettings({ storage });
  first.set('sfx', 0.3);
  first.muted = true;
  const second = new AudioSettings({ storage });
  assert.equal(second.get('sfx'), 0.3);
  assert.equal(second.muted, true);
  store.set('leaper.audio', '{not json');
  assert.equal(new AudioSettings({ storage }).get('sfx'), 1, 'broken data falls back to the defaults');
  store.set('leaper.audio', JSON.stringify({ master: 'loud', ui: 4 }));
  const odd = new AudioSettings({ storage });
  assert.equal(odd.get('master'), 1);
  assert.equal(odd.get('ui'), 1, 'out-of-range values are clamped');
  const throwing = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  const blocked = new AudioSettings({ storage: throwing });
  blocked.set('ui', 0.5);
  assert.equal(blocked.get('ui'), 0.5, 'blocked storage still works for this page');
});

test('voice limits replace the lowest-priority, oldest sound and skip a newcomer that matters less', async () => {
  const { service } = await started();
  // 1. A sound's own limit (shot: 2): the third replaces the oldest copy.
  const a = service.play('shot'), b = service.play('shot'), c = service.play('shot');
  assert.ok(a.stopped && !b.stopped && !c.stopped);
  // 2. A bus limit (creature: 2) full of a high-priority sound: a low one is skipped...
  const boom1 = service.play('boom'), boom2 = service.play('boom');
  assert.equal(service.play('hiss'), null, 'a less important sound does not cut a more important one');
  assert.ok(!boom1.stopped && !boom2.stopped);
  // ...and a full bus of low-priority sounds gives way to an important one.
  boom1.stop(); boom2.stop();
  const hiss1 = service.play('hiss'), hiss2 = service.play('hiss');
  const boom3 = service.play('boom');
  assert.ok(boom3 && hiss1.stopped && !hiss2.stopped, 'the oldest low-priority voice is replaced');
  // 3. The global limit (6) counts every bus.
  service.stopAll();
  const many = [service.play('shot'), service.play('shot'), service.play('grunt'), service.play('grunt'), service.play('click'),
    service.play('click')];
  assert.ok(many.every(Boolean) && service.voices.size === 6);
  const grunt = service.play('grunt');
  assert.ok(grunt, 'an important sound still plays when everything is full');
  assert.equal(service.voices.size, 6);
  assert.ok(many[4].stopped, 'by replacing the least important (a click)');
});

test('the replacement rule on its own: lowest priority first, then oldest, never a more important one', () => {
  const voices = [{ priority: 5, serial: 3 }, { priority: 2, serial: 9 }, { priority: 2, serial: 4 }, { priority: 8, serial: 1 }];
  assert.equal(pickVoiceToReplace(voices, 5), voices[2]);
  assert.equal(pickVoiceToReplace(voices, 1), null);
  assert.equal(pickVoiceToReplace([{ priority: 9, serial: 1 }], 9).serial, 1, 'equal priority: the older one goes');
  assert.equal(pickVoiceToReplace([], 3), null);
});

test('each play varies pitch and volume within the sound\'s spread, and picks among its takes', async () => {
  const values = [0, 0, 0, 0.999, 0.999, 0.999];
  let i = 0;
  const { service } = await started({ random: () => values[i++ % values.length] });
  const low = service.play('grunt');
  assert.equal(low.source.playbackRate.value, 0.9, 'pitch -10%');
  assert.ok(Math.abs(low.amp.gain.value - 0.7 * 0.8) < 1e-9, 'volume -20%');
  assert.equal(low.source.buffer, service.buffers.get('grunt-1'));
  const high = service.play('grunt');
  assert.ok(Math.abs(high.source.playbackRate.value - 1.0998) < 1e-3, 'pitch +10%');
  assert.equal(high.source.buffer, service.buffers.get('grunt-2'), 'another take');
  assert.equal(service.play('shot').source.playbackRate.value, 1, 'no spread configured = exact');
});

test('a sound that cannot play is skipped quietly, never thrown', async () => {
  const { service, context, warnings } = await started();
  assert.equal(service.play('nope'), null, 'unknown id');
  assert.equal(service.play('empty'), null, 'a slot with no takes');
  context.createBufferSource = () => { throw new Error('device gone'); };
  assert.equal(service.play('shot'), null, 'the device refuses');
  assert.match(warnings.at(-1), /could not play "shot"/);
  // No Web Audio at all: everything is a no-op.
  const none = new AudioService({ manifest: testManifest(), config: TEST_CONFIG, settings: new AudioSettings({ storage: null }),
    fetchFile: fakeFetch().fetch, createContext: () => null, listen: false, warn: () => {} });
  none.unlock();
  assert.equal(none.play('shot'), null);
  assert.equal(await none.playSoon('shot'), null);
  const throwing = new AudioService({ manifest: testManifest(), config: TEST_CONFIG, settings: new AudioSettings({ storage: null }),
    fetchFile: fakeFetch().fetch, createContext: () => { throw new Error('blocked'); }, listen: false, warn: () => {} });
  assert.doesNotThrow(() => throwing.unlock());
  // A suspended device (the tab was hidden) plays nothing until resumed.
  context.createBufferSource = FakeContext.prototype.createBufferSource.bind(context);
  service.suspend();
  await Promise.resolve();
  assert.equal(service.play('shot'), null);
  service.resume();
  await Promise.resolve();
  assert.ok(service.play('shot'));
});

test('playSoon waits for the files, but drops a sound that would start late or after a stop', async () => {
  let clock = 0;
  const { fetch } = fakeFetch();
  const service = new AudioService({ manifest: testManifest(), config: TEST_CONFIG, settings: new AudioSettings({ storage: null }),
    fetchFile: fetch, createContext: () => new FakeContext(), listen: false, now: () => clock, random: () => 0.5 });
  assert.equal(await service.playSoon('shot'), null, 'before the first gesture nothing plays');
  service.unlock();
  assert.ok(await service.playSoon('shot'), 'the first shot waits for its file');
  const cancelled = service.playSoon('shot');
  service.stopAll();
  assert.equal(await cancelled, null, 'stopAll drops sounds still waiting');
  const late = service.playSoon('shot');
  clock = 1000;
  assert.equal(await late, null, 'a sound more than 250 ms late is dropped');
});

test('formats: Opus where the browser plays it, else AAC; another format is tried if decoding fails', async () => {
  const probe = (types) => ({ canPlayType: (type) => (types.some((t) => type.startsWith(t)) ? 'probably' : '') });
  // 1. What the browser plays, best first.
  assert.deepEqual(supportedFormats(probe(['audio/ogg', 'audio/mp4'])), ['ogg', 'm4a']);
  assert.deepEqual(supportedFormats(probe(['audio/mp4'])), ['m4a']);
  assert.deepEqual(supportedFormats(null), ['ogg', 'm4a', 'wav'], 'unknown: try them all');
  // 2. The order for one take: supported first, then the rest as a last try.
  const files = { ogg: 'a.ogg', m4a: 'a.m4a' };
  assert.deepEqual(formatOrder(files, ['ogg', 'm4a']), ['ogg', 'm4a']);
  assert.deepEqual(formatOrder(files, ['m4a']), ['m4a', 'ogg'], 'Safari without Opus: AAC first');
  assert.deepEqual(formatOrder({ wav: 'a.wav' }, ['ogg', 'm4a']), ['wav'], 'a WAV-only drop-in slot');
  assert.equal(pickAudioFormat(probe(['audio/ogg'])), 'ogg');
  // 3. The URLs: built files are bundled, drop-ins come from the site root, WAV sources never ship.
  assert.match(fileUrl('assets/build/audio/m416-shot.ogg'), /assets\/build\/audio\/m416-shot\.ogg$/);
  assert.equal(fileUrl('public/audio/lola-hurt-4.wav', '/RL-Leaper/'), '/RL-Leaper/audio/lola-hurt-4.wav');
  assert.equal(fileUrl('assets/audio/m416-shot.wav'), null, 'a source WAV is not a game file');
  assert.match(String(audioUrl('m416-shot', 'wav')), /\.m4a$/);
  // 4. The engine downloads only the best format, and falls back when it won't decode.
  const { service, asked } = await started({ fetchOptions: { broken: ['shot.ogg'] } });
  assert.ok(asked.some((url) => url.endsWith('boom.ogg')) && !asked.some((url) => url.endsWith('boom.m4a')), 'one format per take');
  assert.ok(asked.some((url) => url.endsWith('shot.m4a')), 'the undecodable Opus file is replaced by its AAC copy');
  assert.ok(service.has('shot'));
});

test('responses must be sound: drop-in files strictly, built files leniently', () => {
  const response = (type, ok = true) => ({ ok, headers: new Map(type ? [['content-type', type]] : []) });
  assert.equal(isAudioResponse(response('audio/ogg')), true);
  assert.equal(isAudioResponse(response('text/html')), false, 'a missing file served as the game page');
  assert.equal(isAudioResponse(response('audio/wav', false)), false);
  assert.equal(isAudioResponse(response(null)), true, 'a built file from a host that sends no type');
  assert.equal(isAudioResponse(response(null), { strict: true }), false);
  assert.equal(isAudioResponse(response('application/octet-stream')), true);
  assert.equal(isAudioResponse(response('application/octet-stream'), { strict: true }), false);
});

test('placed sounds: HRTF on high quality, simple panning otherwise, distances at the map scale', async () => {
  // 1. High quality: HRTF, the configured curve, scaled by the map.
  const { service } = await started({ quality: 'high' });
  service.distanceScale = 0.5;
  const boom = service.play('boom', { at: { x: 3, y: 1, z: -4 } });
  assert.equal(boom.panner.panningModel, 'HRTF');
  assert.equal(boom.panner.distanceModel, 'inverse');
  assert.equal(boom.panner.refDistance, 5, 'the sound\'s own ref (10) x scale');
  assert.equal(boom.panner.maxDistance, 60, 'the default max (120) x scale');
  assert.equal(boom.panner.rolloffFactor, 1);
  assert.deepEqual([boom.panner.positionX.value, boom.panner.positionY.value, boom.panner.positionZ.value], [3, 1, -4]);
  assert.equal(service.play('hiss', { at: { x: 0, y: 0, z: 0 } }).panner.refDistance, 3, 'the default ref (6) x scale');
  // 2. Lower quality: equal-power panning.
  const medium = (await started({ quality: 'medium' })).service;
  assert.equal(medium.play('boom', { at: { x: 0, y: 0, z: 1 } }).panner.panningModel, 'equalpower');
  // 3. Without a position, no panner (Lola's own gun and steps stay centred).
  assert.equal(service.play('shot').panner, null);
});

test('the distance curve, and a browser without 3D panners still fades placed sounds', async () => {
  const curve = { ref: 6, max: 120, rolloff: 1 };
  assert.equal(distanceGain(0, curve), 1);
  assert.equal(distanceGain(6, curve), 1);
  assert.equal(distanceGain(12, curve), 0.5);
  assert.equal(distanceGain(1000, curve), distanceGain(120, curve), 'no fading past max');
  const { service } = await started({ context: new FakeContext({ panner: false }) });
  service.setListener({ position: { x: 0, y: 0, z: 0 }, forward: { x: 0, y: 0, z: -1 }, up: { x: 0, y: 1, z: 0 } });
  const far = service.play('hiss', { at: { x: 12, y: 0, z: 0 } });
  assert.equal(far.panner, null);
  assert.equal(far.amp.gain.value, 0.5, 'half volume at twice ref');
});

test('the listener follows the camera every frame, but stays near Lola', async () => {
  // A camera at (0, 40, 0) looking straight down (three.js world matrix, column order).
  const lookingDown = [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 40, 0, 1];
  const tidy = (v) => ({ x: v.x + 0, y: v.y + 0, z: v.z + 0 }); // -0 reads as 0
  const pose = listenerPose(lookingDown);
  assert.deepEqual(pose.position, { x: 0, y: 40, z: 0 });
  assert.deepEqual(tidy(pose.forward), { x: 0, y: -1, z: 0 });
  assert.deepEqual(tidy(pose.up), { x: 0, y: 0, z: -1 });
  const near = listenerPose(lookingDown, { x: 0, y: 0, z: 0 }, 10);
  assert.deepEqual(near.position, { x: 0, y: 10, z: 0 }, 'pulled to 10 units from Lola');
  assert.deepEqual(listenerPose(lookingDown, { x: 0, y: 35, z: 0 }, 10).position, { x: 0, y: 40, z: 0 }, 'close cameras stay put');
  // The engine writes the pose into the context's listener (scaled limit).
  const { service, context } = await started();
  service.distanceScale = 2;
  service.followCamera({ matrixWorld: { elements: lookingDown } }, { x: 0, y: 0, z: 0 });
  assert.equal(context.listener.positionY.value, 20, 'limit is 10 map units x scale 2');
  assert.equal(context.listener.forwardY.value, -1);
  assert.equal(context.listener.upZ.value, -1);
  // Older browsers: the setter functions.
  const calls = [];
  context.listener = { setPosition: (...a) => calls.push(['position', ...a]), setOrientation: (...a) => calls.push(['orientation', ...a]) };
  service.followCamera({ matrixWorld: { elements: lookingDown } });
  assert.deepEqual(calls.map((call) => call.map((v) => (typeof v === 'number' ? v + 0 : v))),
    [['position', 0, 40, 0], ['orientation', 0, -1, 0, 0, 0, -1]]);
});

test('sound unlocks on any gesture, a gamepad press too, and sleeps while the tab is hidden', async () => {
  const listeners = {};
  const page = { hidden: false, addEventListener: (type, fn) => { listeners[type] = fn; } };
  globalThis.window = { addEventListener: (type, fn) => { listeners[type] = fn; } };
  globalThis.document = page;
  const contexts = [];
  const make = () => new AudioService({ manifest: testManifest(), config: TEST_CONFIG, settings: new AudioSettings({ storage: null }),
    fetchFile: fakeFetch().fetch, createContext: () => { const context = new FakeContext({ state: 'suspended' }); contexts.push(context); return context; },
    random: () => 0.5 });
  try {
    // 1. Keyboard, mouse and touch gestures all unlock.
    for (const type of ['keydown', 'pointerdown', 'mousedown', 'pointerup', 'touchend']) {
      const service = make();
      listeners[type]();
      assert.ok(service.context, `${type} creates the context`);
      await Promise.resolve();
      assert.equal(service.context.state, 'running', `${type} resumes it`);
      service.dispose();
    }
    // 2. A gamepad button press (polled each frame) unlocks too.
    const service = make();
    globalThis.navigator ??= {};
    const gamepads = Object.getOwnPropertyDescriptor(globalThis.navigator, 'getGamepads');
    Object.defineProperty(globalThis.navigator, 'getGamepads', { configurable: true, value: () => [null, { buttons: [{ pressed: true }] }] });
    try {
      service.followCamera(null);
      assert.ok(service.context, 'a gamepad press creates the context');
    } finally {
      if (gamepads) Object.defineProperty(globalThis.navigator, 'getGamepads', gamepads);
      else delete globalThis.navigator.getGamepads;
    }
    await service.ready;
    await Promise.resolve();
    // 3. Hidden tab: effects stop and the device sleeps; visible again: it wakes.
    const voice = service.play('shot');
    page.hidden = true;
    listeners.visibilitychange();
    await Promise.resolve();
    assert.ok(voice.stopped);
    assert.equal(service.context.state, 'suspended');
    page.hidden = false;
    listeners.visibilitychange();
    await Promise.resolve();
    assert.equal(service.context.state, 'running');
    // 4. While muted, gestures don't start the device at all.
    const muted = new AudioService({ manifest: testManifest(), config: TEST_CONFIG, listen: false,
      settings: Object.assign(new AudioSettings({ storage: null }), {}), fetchFile: fakeFetch().fetch, createContext: () => new FakeContext() });
    muted.settings.muted = true;
    muted.unlock();
    assert.equal(muted.context, null);
  } finally {
    delete globalThis.window;
    delete globalThis.document;
  }
});

test('the ambience bed loops on its bus, survives effect stops, and stops when asked or muted', async () => {
  const { service, settings } = await started();
  service.startLoop('bed');
  const bed = service.loops.get('bed');
  assert.ok(bed?.source.loop, 'it loops');
  // Only the named part of the file repeats (the codec's edges are outside it), starting there.
  assert.deepEqual([bed.source.loopStart, bed.source.loopEnd, bed.source.started[1]], [0.25, 0.75, 0.25]);
  assert.equal(bed.amp.outputs[0], service.nodes.buses.ambience);
  service.stopAll({ keepLoops: true });
  assert.ok(!bed.stopped, 'a reset or a tab switch leaves the bed alone');
  settings.muted = true;
  assert.ok(bed.stopped, 'mute stops it');
  settings.muted = false;
  service.followCamera(null);
  const again = service.loops.get('bed');
  assert.ok(again && !again.stopped && again !== bed, 'unmuting brings it back (next frame)');
  service.stopLoop('bed');
  service.followCamera(null);
  assert.ok(!service.loops.get('bed'), 'stopLoop ends it for good');
});

test('the real mix config is complete', () => {
  for (const [bus, entry] of Object.entries(AUDIO_CONFIG.buses)) {
    assert.ok(entry.level >= 0 && entry.level <= 1, `${bus} level`);
    assert.ok(['sfx', 'ambience', 'ui'].includes(entry.group), `${bus} has a slider`);
    assert.ok(entry.maxVoices >= 1, `${bus} voice limit`);
  }
  assert.deepEqual(Object.keys(AUDIO_CONFIG.buses).sort(), ['ambience', 'creature', 'footsteps', 'sfx', 'ui', 'weapons']);
  assert.ok(AUDIO_CONFIG.buses.ambience.level <= 0.5, 'the ambience bed is low by default');
});

test('the sound manifest is complete, and the checker catches what a designer might get wrong', () => {
  // 1. The real manifest: no errors (NonCommercial licences are notes, not errors).
  const { errors, notes } = checkManifest(SOUNDS);
  assert.deepEqual(errors, []);
  for (const note of notes) assert.match(note, /^NOTE: .*NonCommercial/);
  assert.equal(findSound(SOUNDS, 'm416').bus, 'weapons');
  assert.equal(licenceTerms({ licence: 'CC BY 4.0' }).attribution, true);
  assert.equal(licenceTerms({ licence: 'CC0 1.0' }).attribution, false);
  assert.equal(licenceTerms({ licence: 'whatever' }).unknown, true);
  // 2. A broken manifest: every mistake is named.
  const broken = {
    sounds: [
      { id: 'a', bus: 'drums', gain: 9, priority: 11, variations: [{ name: 'x', files: { ogg: 'assets/audio/x.wav' }, credits: ['nope'] }] },
      { id: 'a', bus: 'sfx', gain: 1, priority: 1, emitter: 'moon', loop: { start: 2, end: 1 }, variations: [{ name: 'x', files: {}, credits: [] }] },
    ],
    sources: { cc: { title: 'T', author: 'Someone', sourceUrl: 'u', licence: 'CC BY 4.0', attribution: 'T by nobody', notes: '-' },
      odd: { title: 'T', author: 'A', licence: 'Mine' } },
  };
  const found = checkManifest(broken).errors.join('\n');
  for (const problem of ['unknown bus "drums"', 'gain between 0 and 4', 'priority from 0 to 10', 'is not a .ogg file',
    'unknown source "nope"', 'is listed twice', 'unknown emitter "moon"', 'has no files', 'credits no source',
    'needs attribution text naming Someone', 'has no sourceUrl', 'unknown licence "Mine"', 'needs a loop { start, end }']) {
    assert.ok(found.includes(problem), `the checker reports: ${problem}`);
  }
});

test('the ambience source repeats its loop around both ends, so any loop-length window is seamless', async () => {
  const { readFile } = await import('node:fs/promises');
  const bytes = await readFile(new URL('../assets/audio/yard-ambience.wav', import.meta.url));
  const rate = bytes.readUInt32LE(24);
  const samples = new Int16Array(bytes.buffer, bytes.byteOffset + 44, (bytes.length - 44) / 2);
  const { start, end } = findSound(SOUNDS, 'yardAmbience').loop;
  const period = Math.round((end - start) * rate);
  // Every sample one loop-length apart is the same: the file is the loop, repeated.
  let differences = 0;
  for (let i = 0; i + period < samples.length; i += 1) if (samples[i] !== samples[i + period]) differences += 1;
  assert.equal(differences, 0);
  assert.ok(Math.round(start * rate) > 0 && Math.round(end * rate) < samples.length, 'the loop region sits inside the file');
});
