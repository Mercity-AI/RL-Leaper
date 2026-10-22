import test from 'node:test';
import assert from 'node:assert/strict';
import { GameFlow } from '../src/core/GameFlow.js';
import {
  BASE_SCREENS, MENUS, ScreenStack, SUB_SCREENS, baseScreen, brainNotice, endSummary, formatTime, menuItems,
} from '../src/ui/screens.js';
import { builtWithSections, creditSections, registerCredits, soundLines } from '../src/ui/credits.js';
import SOUNDS from '../src/audio/sounds.json' with { type: 'json' };

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
  const ids = (screen, options) => menuItems(screen, SUB_SCREENS, null, options).map((item) => item.id);
  // Players: no testing items, and no CONTROLS (the key list lives in SETTINGS).
  assert.deepEqual(ids('title'), ['play', 'settings', 'credits']);
  assert.deepEqual(ids('pause'), ['resume', 'restart', 'settings', 'quit']);
  assert.deepEqual(ids('end'), ['restart', 'title']);
  // With the developer tools, EXPLORE is back on the title.
  assert.deepEqual(ids('title', { dev: true }), ['play', 'explore', 'settings', 'credits']);
  // An item that opens a sub-screen the page does not have is left out.
  assert.deepEqual(menuItems('title', ['credits']).map((item) => item.id), ['play', 'credits']);
  assert.deepEqual(menuItems('nothing'), []);
  // Paused while exploring (developers), the pause menu also offers the hunt from right there.
  const paused = (mode) => ({ name: 'paused', resumeTo: { name: 'playing', mode } });
  assert.deepEqual(menuItems('pause', SUB_SCREENS, paused('explore'), { dev: true }).map((item) => item.id),
    ['resume', 'hunt', 'restart', 'settings', 'quit']);
  assert.deepEqual(menuItems('pause', SUB_SCREENS, paused('explore')).map((item) => item.id), ids('pause'));
  assert.deepEqual(menuItems('pause', SUB_SCREENS, paused('hunt'), { dev: true }).map((item) => item.id), ids('pause'));
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
  assert.equal(endSummary(null).stats[0].value, '—', 'no time (no result yet, or a practice fight in EXPLORE) is a dash');
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

test('sound credits come from the audio manifest: every recording a shipped sound uses, with its attribution', () => {
  // Every source a sound's takes credit is listed once, with the manifest's exact attribution text.
  const used = new Set(SOUNDS.sounds.flatMap((sound) => sound.variations.flatMap((take) => take.credits ?? [])));
  const lines = soundLines();
  assert.equal(lines.length, used.size);
  for (const key of used) assert.ok(lines.some((line) => line.startsWith(SOUNDS.sources[key].attribution)), key);
  // The NonCommercial M416 recording (kept: the game is non-commercial) and the CC BY pistol are credited with their licences.
  assert.ok(lines.some((line) => /766092/.test(line) && /CC BY-NC 4\.0/.test(line)), 'the M416 recording, CC BY-NC');
  assert.ok(lines.some((line) => /718965/.test(line) && /CC BY 4\.0/.test(line)), 'the pistol recording, CC BY');
  assert.ok(lines.every((line) => !/not recorded/.test(line)), 'no licence is missing');
  // Lines also say what the game uses each recording for.
  assert.ok(lines.every((line) => /Used for: .+\.$/.test(line)));
});

test('the credits screen lists the game, the sounds, what it is built with and any added section', () => {
  const remove = registerCredits({ heading: 'NEW SOUNDS', lines: ['stomp by someone'] });
  const sections = creditSections();
  assert.deepEqual(sections.map((section) => section.heading), ['LEAPER', 'SOUNDS', 'BUILT WITH', 'ART', 'NEW SOUNDS']);
  assert.ok(sections[2].lines.some((line) => /^three\.js by .+ \(MIT licence\)$/.test(line)));
  assert.deepEqual(builtWithSections([{ title: 'Lib', author: 'Someone', licence: 'MIT' }, { title: 'Art', author: 'Owner', licence: null }]),
    [{ heading: 'BUILT WITH', lines: ['Lib by Someone (MIT licence)'] }, { heading: 'ART', lines: ['Art: Owner'] }]);
  remove();
  assert.equal(creditSections().length, 4);
  // Everyone the licences name is on the screen, and credits a licence requires
  // come before the public-domain (CC0) ones.
  const text = creditSections().flatMap((section) => section.lines).join('\n');
  for (const name of ['Artninja', 'gpag1', 'Luca2399', 'Astounded', 'qubodup', 'OGsoundFX', 'TB0Y298', 'Kenney', 'three.js']) {
    assert.ok(text.includes(name), `the credits name ${name}`);
  }
  const sounds = creditSections()[1].lines;
  const lastRequired = sounds.findLastIndex((line) => /CC BY/.test(line));
  const firstFree = sounds.findIndex((line) => /CC0/.test(line));
  assert.ok(lastRequired >= 0 && firstFree > lastRequired, 'required credits come first');
});
