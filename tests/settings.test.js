import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { SETTINGS_KEY, SETTING_DEFAULTS, Settings, normalizeSettings } from '../src/ui/settings.js';
import { CAPTION_CUES, CaptionQueue, ChargeWatch, addCaptionCue, captionFor } from '../src/ui/captions.js';
import { CAMERA } from '../src/config/camera.js';
import { GAME_EVENTS } from '../src/core/events.js';
import { LEAPER_EVENTS } from '../src/actors/leaper/leaperEvents.js';

// The player's settings store (src/ui/settings.js) and the captions queue
// (src/ui/captions.js). The SETTINGS screen itself is checked in the browser
// (tests/game-flow.browser.mjs).

const memoryStorage = (initial = {}) => {
  const data = new Map(Object.entries(initial));
  return { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), data };
};

test('the defaults are the camera config\'s own values', () => {
  assert.equal(SETTING_DEFAULTS.sensitivity, CAMERA.look.sensitivity);
  assert.equal(SETTING_DEFAULTS.invertY, CAMERA.look.invertY);
  assert.equal(SETTING_DEFAULTS.fov, CAMERA.chaseFov);
  assert.deepEqual(new Settings({ storage: null }).values, { ...SETTING_DEFAULTS });
});

test('bad or out-of-range values are cleaned, never trusted', () => {
  const clean = normalizeSettings({ sensitivity: 99, fov: 10, invertY: 'yes', textSize: 'huge', captions: true, extra: 1 });
  assert.equal(clean.sensitivity, 3);
  assert.equal(clean.fov, 50);
  assert.equal(clean.invertY, false, 'not a boolean: the default');
  assert.equal(clean.textSize, 'normal');
  assert.equal(clean.captions, true);
  assert.ok(!('extra' in clean));
  assert.equal(normalizeSettings({ sensitivity: 'NaN' }).sensitivity, SETTING_DEFAULTS.sensitivity);
});

test('a change is cleaned, saved in this browser and announced; a reload reads it back', () => {
  const storage = memoryStorage();
  const store = new Settings({ storage });
  const heard = [];
  store.onChange((key, value) => heard.push([key, value]));
  assert.equal(store.set('fov', 70), true);
  assert.equal(store.set('fov', 70), false, 'the same value again changes nothing');
  store.set('invertY', true);
  store.set('sensitivity', 0.1);
  assert.deepEqual(heard, [['fov', 70], ['invertY', true], ['sensitivity', 0.25]]);
  assert.deepEqual(JSON.parse(storage.data.get(SETTINGS_KEY)).fov, 70);
  const reloaded = new Settings({ storage });
  assert.equal(reloaded.get('fov'), 70);
  assert.equal(reloaded.get('invertY'), true);
  assert.throws(() => store.set('nonsense', 1), /Unknown setting/);
  store.reset();
  assert.deepEqual(store.values, { ...SETTING_DEFAULTS });
});

test('unreadable or refused storage falls back to the defaults without breaking', () => {
  assert.deepEqual(new Settings({ storage: memoryStorage({ [SETTINGS_KEY]: '{oops' }) }).values, { ...SETTING_DEFAULTS });
  const refusing = { getItem() { throw new Error('private'); }, setItem() { throw new Error('private'); } };
  const store = new Settings({ storage: refusing });
  assert.equal(store.set('captions', true), true, 'the change still applies for this page');
});

test('settings.registerSection: sections in order, the same id replaces, placeholders give way', () => {
  const store = new Settings({ storage: null });
  const build = () => {};
  store.registerSection({ id: 'graphics', title: 'GRAPHICS', order: 10, build });
  store.registerDefaultSection({ id: 'audio', title: 'AUDIO (placeholder)', order: 30, build });
  store.registerSection({ id: 'accessibility', order: 40, build });
  assert.deepEqual(store.sections().map((section) => section.id), ['graphics', 'audio', 'accessibility']);
  const version = store.version;
  // The sound system replaces the placeholder with its own section.
  const remove = store.registerSection({ id: 'audio', title: 'AUDIO', order: 30, build });
  assert.equal(store.sections().find((section) => section.id === 'audio').title, 'AUDIO');
  assert.ok(store.version > version, 'the screen knows to rebuild');
  // A placeholder registered after the real section does not replace it.
  store.registerDefaultSection({ id: 'audio', title: 'AUDIO (placeholder)', order: 30, build });
  assert.equal(store.sections().find((section) => section.id === 'audio').title, 'AUDIO');
  remove();
  assert.deepEqual(store.sections().map((section) => section.id), ['graphics', 'accessibility']);
  assert.throws(() => store.registerSection({ title: 'no id' }), /needs an id/);
});

test('captions: a line per cue, the same cue refreshes, old lines fade out on game time', () => {
  const queue = new CaptionQueue({ time: 2, lines: 2 });
  assert.equal(queue.add('[Stomp]'), true);
  assert.equal(queue.advance(1.5), false);
  assert.equal(queue.add('[Stomp]'), false, 'the same cue only restarts its clock');
  assert.equal(queue.advance(1.5), false, 'still shown: the clock restarted');
  queue.add('[A]');
  queue.add('[B]');
  assert.deepEqual(queue.lines.map((line) => line.text), ['[A]', '[B]'], 'at most two lines');
  assert.equal(queue.advance(0), false, 'paused: nothing fades');
  assert.equal(queue.advance(2), true);
  assert.deepEqual(queue.lines, []);
  addCaptionCue('leaperRoar', '[Roar]');
  assert.equal(CAPTION_CUES.leaperRoar, '[Roar]');
  delete CAPTION_CUES.leaperRoar;
});

test('captions: every cue listens to an event the game really emits, and the Leaper\'s moves get theirs', () => {
  // A cue named after an event nobody emits would never show (the stomp, leap and
  // collapse captions once waited for names the Leaper's behaviour never used).
  // So the game's own code is read: every emit(GAME_EVENTS.x / LEAPER_EVENTS.x ...)
  // in src/ counts, and each cue must be one of those names.
  const lists = { GAME_EVENTS, LEAPER_EVENTS };
  const emitted = new Set();
  for (const file of readdirSync(new URL('../src/', import.meta.url), { recursive: true })) {
    if (!String(file).endsWith('.js')) continue;
    const source = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
    for (const [, list, key] of source.matchAll(/\bemit\(\s*(GAME_EVENTS|LEAPER_EVENTS)\.(\w+)/g)) emitted.add(lists[list][key]);
  }
  assert.ok(emitted.has(LEAPER_EVENTS.attack) && emitted.has(GAME_EVENTS.lolaDamaged), 'the emit scan finds the game\'s events');
  for (const event of Object.keys(CAPTION_CUES)) assert.ok(emitted.has(event), `${event} is emitted somewhere in src/`);
  // Each attack phase that plays a sound has its line; a called-off leap has none.
  for (const [kind, phase] of [['stomp', 'windup'], ['stomp', 'impact'], ['leap', 'windup'], ['leap', 'launch'], ['leap', 'land']]) {
    assert.ok(captionFor(LEAPER_EVENTS.attack, { leaper: 'leaper', kind, phase }), `${kind} ${phase}`);
  }
  assert.equal(captionFor(LEAPER_EVENTS.attack, { kind: 'leap', phase: 'cancel' }), null);
  assert.ok(captionFor(LEAPER_EVENTS.died, { position: { x: 0, z: 0 } }));
  assert.ok(captionFor(LEAPER_EVENTS.staggered, { reason: 'crit' }));
  assert.ok(captionFor(LEAPER_EVENTS.downed, { permanent: false }));
  assert.equal(captionFor(LEAPER_EVENTS.downed, { permanent: false, rising: true }), null, 'getting up is silent');
  assert.equal(captionFor('noSuchEvent', {}), null);
  // A stomp or a landing hurts Lola too: her hit line names no weapon.
  assert.doesNotMatch(captionFor(GAME_EVENTS.lolaDamaged, { amount: 8 }), /laser/i);
  // The eye's charge: one caption per new wind-up, per Leaper.
  const watch = new ChargeWatch();
  assert.deepEqual([false, true, true, false, true].map((on) => watch.started(0, on)), [false, true, false, false, true]);
  assert.equal(watch.started(1, true), true, 'a second Leaper is watched on its own');
});
