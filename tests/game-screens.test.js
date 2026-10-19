import test from 'node:test';
import assert from 'node:assert/strict';
import { GameFlow } from '../src/core/GameFlow.js';
import {
  BASE_SCREENS, MENUS, ScreenStack, SUB_SCREENS, baseScreen, brainNotice, endSummary, formatTime, menuItems,
} from '../src/ui/screens.js';
import { DOCUMENTED_SOUNDS, KNOWN_LICENCES, creditSections, freesoundInfo, registerCredits, soundCredits } from '../src/ui/credits.js';

// The menu screens' rules (src/ui/screens.js) and the credits list
// (src/ui/credits.js). The screens themselves are driven in a real browser by
// tests/game-flow.browser.mjs.

test('every game state maps to its screen: title in Ready, pause menu, end screen, none while playing', () => {
  const flow = new GameFlow();
  const seen = [];
  const record = () => seen.push(baseScreen(flow.state));
  record();
  flow.finishLoading(); record();
  flow.hunt(); record();
  flow.pause(); record();
  flow.resume(); record();
  flow.end('lola'); record();
  flow.stop(); record();
  flow.explore(); record();
  assert.deepEqual(seen, [null, 'title', null, 'pause', null, 'end', 'title', null]);
  assert.deepEqual(Object.values(BASE_SCREENS), ['title', 'pause', 'end']);
  assert.equal(baseScreen(null), null);
});

test('the menus offer what a player expects, in order', () => {
  const ids = (screen) => menuItems(screen).map((item) => item.id);
  assert.deepEqual(ids('title'), ['play', 'explore', 'settings', 'controls', 'credits']);
  assert.deepEqual(ids('pause'), ['resume', 'restart', 'settings', 'controls', 'quit']);
  assert.deepEqual(ids('end'), ['restart', 'title']);
  // An item that opens a sub-screen the page does not have is left out.
  assert.deepEqual(menuItems('title', ['controls']).map((item) => item.id), ['play', 'explore', 'controls']);
  assert.deepEqual(menuItems('nothing'), []);
  // Labels are upper case and every item has an id the game can act on.
  for (const items of Object.values(MENUS)) {
    for (const item of items) assert.equal(item.label, item.label.toUpperCase());
  }
  assert.deepEqual(SUB_SCREENS, ['settings', 'controls', 'credits']);
});

test('sub-screens stack on a base screen; BACK closes them; a new state closes them all', () => {
  const stack = new ScreenStack();
  assert.equal(stack.open, false);
  assert.equal(stack.push('settings'), false, 'nothing to open over while playing');
  assert.equal(stack.sync({ name: 'ready' }), true);
  assert.equal(stack.current, 'title');
  assert.equal(stack.push('settings'), true);
  assert.equal(stack.push('nonsense'), false);
  assert.equal(stack.current, 'settings');
  assert.equal(stack.back(), true);
  assert.equal(stack.current, 'title');
  assert.equal(stack.back(), false, 'BACK at a base screen is the caller\'s decision');
  stack.push('controls');
  assert.equal(stack.sync({ name: 'ready' }), false, 'the same state changes nothing');
  assert.equal(stack.current, 'controls');
  assert.equal(stack.sync({ name: 'playing', mode: 'hunt' }), true);
  assert.equal(stack.open, false);
  stack.sync({ name: 'paused', resumeTo: { name: 'playing', mode: 'hunt' } });
  stack.push('settings');
  stack.sync({ name: 'ended', winner: 'leaper', practice: false });
  assert.equal(stack.current, 'end', 'the fight ending closes the settings opened from the pause menu');
});

test('the end screen summarises the fight: verdict, time, damage, knees and labels', () => {
  const win = endSummary({ winner: 'lola', practice: false, seconds: 83.6, damageDealt: 600, damageTaken: 47.5, jointsBroken: 3,
    turret: false, debugUsed: false });
  assert.equal(win.heading, 'VICTORY');
  assert.equal(win.victory, true);
  assert.deepEqual(win.tags, []);
  assert.deepEqual(win.stats, [
    { label: 'TIME', value: '1:23' }, { label: 'DAMAGE DEALT', value: '600' },
    { label: 'DAMAGE TAKEN', value: '48' }, { label: 'KNEES BROKEN', value: '3' },
  ]);
  const loss = endSummary({ winner: 'leaper', practice: true, turret: true, debugUsed: true, seconds: 5 });
  assert.equal(loss.heading, 'DEFEAT');
  assert.deepEqual(loss.tags, ['PRACTICE', 'TURRET', 'DEBUG']);
  assert.equal(endSummary(null).stats[0].value, '0:00', 'no result yet is shown as zeros');
  assert.equal(formatTime(3725), '1:02:05');
  assert.equal(formatTime(-3), '0:00');
});

test('the title tells the player about the brain in plain words', () => {
  assert.equal(brainNotice({ ready: true }), '');
  assert.equal(brainNotice(null), '');
  assert.match(brainNotice({ ready: false, offline: false, progress: { fraction: 0.641 } }), /Waking the Leaper… 64%/);
  assert.equal(brainNotice({ ready: false, offline: false, progress: null }), 'Waking the Leaper…');
  assert.match(brainNotice({ ready: false, offline: true }), /turret mode/);
});

test('sound credits come from the audio manifest, with Freesound names and known licences filling the gaps', () => {
  assert.deepEqual(freesoundInfo('766092__luca2399__m4_rifle_fire.wav'),
    { id: '766092', author: 'luca2399', title: 'm4 rifle fire', url: 'https://freesound.org/s/766092/' });
  assert.equal(freesoundInfo('not-a-freesound-file.wav'), null);
  // Today's manifest: two game sounds cut from one recording -> one credit.
  const manifest = {
    'm416-shot': { source: '766092__luca2399__m4_rifle_fire.wav' },
    'm416-reload-reserved': { source: '766092__luca2399__m4_rifle_fire.wav' },
    'pistol-shot': { source: '718965__tb0y298__pistol-shot-2.wav' },
  };
  const credits = soundCredits(manifest);
  const m4 = credits.find((credit) => credit.author === 'luca2399');
  assert.deepEqual(m4.uses, ['m416-shot', 'm416-reload-reserved']);
  assert.equal(m4.licence, KNOWN_LICENCES[766092]);
  assert.equal(m4.licence, 'CC BY-NC 4.0', 'the NonCommercial M416 recording is credited with its licence');
  assert.equal(credits.find((credit) => credit.author === 'tb0y298').licence, 'licence not recorded yet');
  // Recordings documented only in the Markdown notes are credited too.
  for (const source of Object.values(DOCUMENTED_SOUNDS)) {
    assert.ok(credits.some((credit) => credit.author === freesoundInfo(source).author), source);
  }
  // A manifest that records its own author, link and licence wins.
  const own = soundCredits({ hit: { source: '873903__cb9382__hit-metal-object.m4a', author: 'cb9382', license: 'CC0 1.0',
    url: 'https://example.org/hit', attribution: 'Thanks!' } }, {});
  assert.deepEqual(own, [{ title: 'hit metal object', author: 'cb9382', url: 'https://example.org/hit', licence: 'CC0 1.0',
    attribution: 'Thanks!', uses: ['hit'] }]);
  // An array-shaped manifest works as well.
  assert.equal(soundCredits([{ name: 'laser', source: '479353__astounded__laser-effect-contact-mic.wav' }], {})[0].licence, 'CC0');
});

test('the credits screen lists the project, the libraries, the sounds and any added section', () => {
  const remove = registerCredits({ heading: 'NEW SOUNDS', lines: ['stomp by someone'] });
  const sections = creditSections({ 'm416-shot': { source: '766092__luca2399__m4_rifle_fire.wav' } });
  const headings = sections.map((section) => section.heading);
  assert.deepEqual(headings, ['LEAPER', 'BUILT WITH', 'SOUNDS (FREESOUND)', 'NEW SOUNDS']);
  assert.ok(sections[2].lines.some((line) => /luca2399, CC BY-NC 4\.0 \(https:\/\/freesound\.org\/s\/766092\/\)/.test(line)));
  remove();
  assert.equal(creditSections({}).length, 3);
});
