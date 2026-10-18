import test from 'node:test';
import assert from 'node:assert/strict';
import { pickMode } from '../src/modes/pickMode.js';

const pick = (query) => pickMode(new URLSearchParams(query));

test('the junkyard game is the default page, and every lab address still works', () => {
  assert.equal(pick(''), 'junkyard');
  assert.equal(pick('?map=junkyard'), 'junkyard');
  assert.equal(pick('?debug'), 'junkyard');
  assert.equal(pick('?arena'), 'arena');
  assert.equal(pick('?training=1'), 'training');
  assert.equal(pick('?free'), 'sandbox');
  assert.equal(pick('?sandbox'), 'sandbox');
});

test('mode precedence matches the old main.js', () => {
  assert.equal(pick('?training&arena&free'), 'training');
  assert.equal(pick('?arena&free'), 'arena');
  assert.equal(pick('?map=junkyard&training'), 'training');
  assert.equal(pick('?map=junkyard&sandbox'), 'sandbox');
});
