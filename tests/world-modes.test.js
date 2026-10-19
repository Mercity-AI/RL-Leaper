import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { MODES } from '../src/modes/index.js';

// Each page mode is downloaded only when it is picked, so the game page never
// fetches the RL lab viewers (and the lab pages never fetch the game).

test('every mode is a lazy loader with the same start() as before', () => {
  for (const name of ['junkyard', 'arena', 'training', 'sandbox']) {
    assert.equal(typeof MODES[name].start, 'function', `${name}.start`);
    assert.equal(typeof MODES[name].load, 'function', `${name}.load`);
  }
});

test('the mode table imports no mode up front', () => {
  const source = fs.readFileSync(new URL('../src/modes/index.js', import.meta.url), 'utf8');
  for (const name of ['junkyard', 'arena', 'training', 'sandbox']) {
    assert.match(source, new RegExp(`import\\('\\./${name}\\.js'\\)`), `${name} is imported on demand`);
    assert.doesNotMatch(source, new RegExp(`from '\\./${name}\\.js'`), `${name} is not imported up front`);
  }
});

test('a lazy mode loads its module and starts it', async () => {
  const module = await MODES.sandbox.load();
  assert.equal(typeof module.start, 'function');
});
