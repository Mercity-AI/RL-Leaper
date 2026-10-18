import test from 'node:test';
import assert from 'node:assert/strict';
import { EventBus, GAME_EVENTS } from '../src/core/events.js';

test('on / off / emit deliver payloads to current listeners only', () => {
  const bus = new EventBus();
  const seen = [];
  const off = bus.on('lolaDamaged', (payload) => seen.push(payload.amount));
  bus.emit('lolaDamaged', { amount: 8 });
  off();
  bus.emit('lolaDamaged', { amount: 8 });
  bus.emit('nobodyListens');
  assert.deepEqual(seen, [8]);
  bus.once('jointBroken', () => seen.push('joint'));
  bus.emit('jointBroken');
  bus.emit('jointBroken');
  assert.deepEqual(seen, [8, 'joint']);
});

test('listeners may unsubscribe while an event is delivered, and a throwing listener is contained', () => {
  const bus = new EventBus();
  const seen = [];
  const reported = [];
  const original = globalThis.reportError;
  globalThis.reportError = (error) => reported.push(error.message);
  try {
    const offA = bus.on('leaperDamaged', () => { seen.push('a'); offA(); });
    bus.on('leaperDamaged', () => { throw new Error('broken HUD'); });
    bus.on('leaperDamaged', () => seen.push('c'));
    bus.emit('leaperDamaged');
    bus.emit('leaperDamaged');
  } finally {
    if (original) globalThis.reportError = original;
    else delete globalThis.reportError;
  }
  assert.deepEqual(seen, ['a', 'c', 'c']);
  assert.deepEqual(reported, ['broken HUD', 'broken HUD']);
});

test('the event catalogue names every event the skeleton emits', () => {
  for (const name of ['encounterStarted', 'encounterEnded', 'lolaDamaged', 'leaperDamaged',
    'jointBroken', 'pauseChanged', 'flowChanged']) {
    assert.equal(GAME_EVENTS[name], name);
  }
});
