import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioService } from '../src/audio/AudioService.js';
import { AudioSettings } from '../src/audio/AudioSettings.js';
import { formatOrder, supportedFormats } from '../src/audio/formats.js';
import SOUNDS from '../src/audio/sounds.json' with { type: 'json' };
import { FakeContext, TEST_CONFIG, fakeFetch } from './audio-fakes.js';

// Review fix 5.39: optional sound slots. Only files the manifest lists are
// downloaded; a drop-in file must really be sound (a missing file on many hosts
// comes back as the game's page with status 200); a bad file says so in
// development instead of failing silently.

const take = (name, files) => ({ name, files, credits: ['cc0'] });
const SLOT_MANIFEST = {
  sounds: [
    { id: 'filled', bus: 'sfx', gain: 1, priority: 5, variations: [take('filled', { wav: 'public/audio/filled.wav' })] },
    { id: 'misnamed', bus: 'sfx', gain: 1, priority: 5, variations: [take('misnamed', { wav: 'public/audio/misnamed.wav' })] },
    { id: 'textFile', bus: 'sfx', gain: 1, priority: 5, variations: [take('text-file', { wav: 'public/audio/text-file.wav' })] },
    { id: 'empty', bus: 'sfx', gain: 1, priority: 5, variations: [] },
  ],
  sources: { cc0: { title: 'T', author: 'A', sourceUrl: 'https://example.org', licence: 'CC0 1.0', attribution: 'T by A', notes: '-' } },
};

async function load({ dev }) {
  // misnamed: the host answers with its HTML page; text-file: claims audio but won't decode.
  const { fetch, asked } = fakeFetch({ types: { 'filled.wav': 'audio/wav', 'text-file.wav': 'audio/wav' },
    missing: ['misnamed.wav'], broken: ['text-file.wav'] });
  const warnings = [];
  const service = new AudioService({ manifest: SLOT_MANIFEST, config: TEST_CONFIG, settings: new AudioSettings({ storage: null }),
    fetchFile: fetch, createContext: () => new FakeContext(), listen: false, dev, warn: (message) => warnings.push(message) });
  service.unlock();
  await service.ready;
  return { service, asked, warnings };
}

test('only files in the manifest are fetched, and an empty slot fetches nothing', async () => {
  const { asked } = await load({ dev: true });
  assert.deepEqual(asked.map((url) => url.split('/').pop()).sort(), ['filled.wav', 'misnamed.wav', 'text-file.wav']);
  assert.ok(asked.every((url) => url.startsWith('/audio/')), 'drop-in files come from the site root');
});

test('a drop-in slot plays only if the answer is real sound; bad files warn in development', async () => {
  const { service, warnings } = await load({ dev: true });
  assert.ok(service.has('filled') && service.play('filled'), 'a real WAV dropped in plays');
  assert.ok(!service.has('misnamed') && service.play('misnamed') === null, 'an HTML page is never decoded as sound');
  assert.ok(!service.has('textFile'), 'a text file renamed to .wav stays silent');
  assert.equal(service.play('empty'), null);
  assert.ok(warnings.some((text) => /public\/audio\/misnamed\.wav .*not a sound file.*text\/html/.test(text)),
    'development names the file and why');
  assert.ok(warnings.some((text) => /could not decode public\/audio\/text-file\.wav/.test(text)));
  // A published build stays quiet about half-filled slots.
  const quiet = await load({ dev: false });
  assert.deepEqual(quiet.warnings, []);
});

test('the real manifest: every listed file is a built file or a drop-in, and slots fetch only what exists', () => {
  const files = SOUNDS.sounds.flatMap((sound) => sound.variations.flatMap((variation) => Object.values(variation.files)));
  assert.ok(files.length > 0);
  for (const file of files) assert.match(file, /^(assets\/build\/audio\/|public\/audio\/)/, file);
  // One download per take, in the best format (never the WAV sources in assets/audio/).
  const { fetch, asked } = fakeFetch();
  const service = new AudioService({ settings: new AudioSettings({ storage: null }), fetchFile: fetch, listen: false,
    createContext: () => null, probe: { canPlayType: (type) => (type.startsWith('audio/ogg') ? 'probably' : '') } });
  const takes = SOUNDS.sounds.flatMap((sound) => sound.variations);
  assert.equal(asked.length, takes.length);
  assert.ok(asked.every((url) => /\/assets\/build\/audio\/[\w.-]+\.ogg$/.test(url)), 'Opus copies only');
  assert.equal(service.prefetched.size, takes.length);
  // And a browser without Opus gets the AAC copies.
  assert.ok(takes.every((variation) => formatOrder(variation.files, supportedFormats({ canPlayType: (t) => (t.startsWith('audio/mp4') ? 'maybe' : '') }))[0] === 'm4a'));
});
