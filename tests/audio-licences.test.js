import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import SOUNDS from '../src/audio/sounds.json' with { type: 'json' };
import { checkManifest, creditsOf, licenceTerms } from '../src/audio/soundManifest.js';
import { creditsMarkdown, soundCredits } from '../src/audio/credits.js';

// Licences (review fix 5.18): every sound the game ships is listed in the
// manifest with its author, source and licence, credit text exists wherever a
// licence requires it, and CREDITS.md matches the records. NonCommercial
// sounds are kept on purpose (a non-commercial game) and only reported.

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const exists = (file) => fs.existsSync(path.join(ROOT, file));
const takes = SOUNDS.sounds.flatMap((sound) => sound.variations.map((variation) => ({ sound, variation })));

// Every audio file that ends up in the published game: the built copies, and
// anything dropped into public/audio/ (copied as it is).
function shippedAudio() {
  const list = (dir, pattern) => (exists(dir) ? fs.readdirSync(path.join(ROOT, dir)).filter((name) => pattern.test(name))
    .map((name) => `${dir}/${name}`) : []);
  return [...list('assets/build/audio', /\.(ogg|m4a)$/), ...list('public/audio', /\.(ogg|m4a|wav|mp3|flac|aac|opus|webm)$/i)];
}

test('every shipped audio file has a manifest entry with a licence, and credit text where the licence requires it', (t) => {
  const listed = new Map(takes.flatMap(({ sound, variation }) => Object.values(variation.files).map((file) => [file, { sound, variation }])));
  const shipped = shippedAudio();
  assert.ok(shipped.length >= 2 * takes.length, 'both formats of every take are shipped');
  for (const file of shipped) {
    const entry = listed.get(file);
    assert.ok(entry, `${file} is shipped but not in src/audio/sounds.json: add it with its author and licence`);
    const credits = creditsOf(SOUNDS, entry.variation);
    assert.ok(credits.length, `${file} credits a source`);
    for (const source of credits) {
      assert.ok(source.licence, `${file}: ${source.key} names its licence`);
      assert.ok(!licenceTerms(source).unknown, `${file}: ${source.key} has a known licence (${source.licence})`);
      assert.ok(source.author && source.sourceUrl, `${file}: ${source.key} names its author and where it came from`);
      if (licenceTerms(source).attribution) {
        assert.ok(source.attribution?.includes(source.author.split(' (')[0]), `${file}: ${source.key} has attribution text naming ${source.author}`);
      }
      // NonCommercial is allowed in this non-commercial game: reported, not failed.
      if (licenceTerms(source).nonCommercial) t.diagnostic(`NOTE: ${file} uses "${source.title}" by ${source.author} (${source.licence}, NonCommercial)`);
    }
  }
});

test('every file the manifest lists exists, and each built take has its source WAV', () => {
  for (const { sound, variation } of takes) {
    for (const file of Object.values(variation.files)) assert.ok(exists(file), `${sound.id}: ${file} exists`);
    if (variation.source?.wav) assert.ok(exists(variation.source.wav), `${sound.id}: source ${variation.source.wav} exists`);
  }
});

test('the manifest checks out, and every source record is used', (t) => {
  const { errors, notes } = checkManifest(SOUNDS);
  assert.deepEqual(errors, []);
  for (const note of notes) t.diagnostic(note);
  const used = new Set([...takes.flatMap(({ variation }) => variation.credits), ...(SOUNDS.unused ?? []).flatMap((entry) => entry.credits)]);
  for (const key of Object.keys(SOUNDS.sources)) assert.ok(used.has(key), `source "${key}" is credited by a take`);
});

test('CREDITS.md is up to date with the manifest and credits everyone the licences name', () => {
  const written = fs.readFileSync(path.join(ROOT, 'CREDITS.md'), 'utf8');
  assert.equal(written, creditsMarkdown(), 'CREDITS.md is stale: run node scripts/assets/build-credits.mjs');
  // The authors the review asked to see credited (fix 5.18 / ui-audio-no-attribution-or-provenance).
  for (const name of ['Artninja', 'gpag1', 'Luca2399', 'Astounded', 'qubodup', 'OGsoundFX', 'TB0Y298', 'Kenney']) {
    assert.ok(written.includes(name), `CREDITS.md credits ${name}`);
  }
  // Required credits come first, and each carries its licence link.
  const credits = soundCredits();
  const firstCourtesy = credits.findIndex((credit) => !credit.required);
  assert.ok(credits.slice(firstCourtesy).every((credit) => !credit.required), 'required credits are listed first');
  for (const credit of credits.filter((entry) => entry.required)) assert.ok(credit.licenceUrl, `${credit.key} links its licence`);
});

test('the shipped game no longer contains the disabled NonCommercial impact or any source WAV', () => {
  const shipped = shippedAudio();
  assert.ok(!shipped.some((file) => file.includes('scenery-hit')), 'the disabled scenery hit (CC BY-NC 3.0) is not shipped');
  assert.ok(!shipped.some((file) => file.endsWith('.wav')), 'WAVs are sources only');
  assert.ok(!exists('public/audio/SOUND-SLOTS.md'), 'the internal slot notes are not published');
});
