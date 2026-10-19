import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BUTTON_ACTIONS, CONTROLS } from '../src/input/actions.js';
import { WEAPONS } from '../src/config/weapons.js';
import { controlsMarkdown, legendRows } from '../src/ui/ControlsLegend.js';
import { END, START, withTable } from '../scripts/print-controls.mjs';

// The controls legend (review fix 5.24): generated from the input bindings, shown
// on the CONTROLS screen and with H in play, and copied into the README.

test('the legend lists every player action from the bindings, never the lab keys', () => {
  const rows = legendRows();
  const actions = rows.map((row) => row.action);
  for (const action of Object.keys(BUTTON_ACTIONS)) assert.ok(actions.includes(action), action);
  assert.ok(actions.includes('move') && actions.includes('look'));
  assert.ok(!actions.includes('nudge'), 'the lab\'s I J K L nudge keys are not a player control');
  assert.equal(rows.length, CONTROLS.length - 1);
});

test('the legend says what the old hand-written help got wrong: the real zoom, R to reload, holds', () => {
  const row = (action) => legendRows().find((item) => item.action === action);
  const zoom = WEAPONS.m416.ads.zoom;
  assert.match(row('aim').label, new RegExp(`×${zoom}`), `aim names the guns' ×${zoom} zoom`);
  assert.equal(row('reload').keyboard, 'R');
  assert.equal(row('fire').keyboard, 'Left click (hold)');
  assert.equal(row('sprint').keyboard, 'Shift / Right Shift (hold)');
  assert.equal(row('legend').keyboard, 'H');
  assert.equal(row('pause').gamepad, 'Start');
  assert.equal(row('fire').touch, 'FIRE');
});

test('the Markdown table has one row per legend row, escaped', () => {
  const table = controlsMarkdown([{ label: 'A | B', keyboard: 'K', gamepad: '', touch: 'T' }]).split('\n');
  assert.equal(table[0], '| Action | Keyboard and mouse | Gamepad | Touch |');
  assert.equal(table[2], '| A \\| B | K | — | T |');
  assert.equal(controlsMarkdown().split('\n').length, legendRows().length + 2);
});

test('the README\'s controls table is the generated one (run scripts/print-controls.mjs --write)', () => {
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  assert.ok(readme.includes(START) && readme.includes(END), 'README.md has the generated controls block');
  assert.equal(withTable(readme), readme, 'README.md controls table is out of date');
  assert.equal(withTable('no markers here'), null);
});
