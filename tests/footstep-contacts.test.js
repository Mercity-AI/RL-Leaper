import test from 'node:test';
import assert from 'node:assert/strict';
import { crossedFootContact } from '../src/robot/footstepContacts.js';

const profile = { duration: 1, forward: [0.1, 0.6], reverse: [0.3, 0.8] };
test('foot contacts follow forward, reverse and wrapped animation time', () => {
  assert.equal(crossedFootContact(profile, 0.09, 0.02), true);
  assert.equal(crossedFootContact(profile, 0.11, 0.02), false);
  assert.equal(crossedFootContact(profile, 0.31, -0.02), true);
  assert.equal(crossedFootContact(profile, 0.9, 0.21), true);
  assert.equal(crossedFootContact(profile, 0.1, -0.31), true);
  assert.equal(crossedFootContact(profile, 0.1, 0), false);
  assert.equal(crossedFootContact(undefined, 0.1, 1), false);
});
