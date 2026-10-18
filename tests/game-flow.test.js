import test from 'node:test';
import assert from 'node:assert/strict';
import { GameFlow, TRANSITIONS, FLOW } from '../src/core/GameFlow.js';
import { EventBus, GAME_EVENTS } from '../src/core/events.js';

const STATES = {
  loading: { name: 'loading' },
  ready: { name: 'ready' },
  hunt: { name: 'playing', mode: 'hunt' },
  explore: { name: 'playing', mode: 'explore' },
  paused: { name: 'paused', resumeTo: { name: 'playing', mode: 'hunt' } },
  ended: { name: 'ended', winner: 'lola', practice: false },
};

test('the transition table allows exactly the designed moves', () => {
  const expected = {
    loading: ['ready'],
    ready: ['hunt', 'explore', 'ended'],
    hunt: ['explore', 'paused', 'ready', 'ended'],
    explore: ['hunt', 'paused', 'ready', 'ended'],
    paused: ['hunt', 'explore', 'ready', 'ended'],
    ended: ['ready'],
  };
  for (const [from, allowed] of Object.entries(expected)) {
    for (const [to, state] of Object.entries(STATES)) {
      if (to === from) continue;
      const flow = new GameFlow({ initial: STATES[from] });
      assert.equal(flow.setState(state), allowed.includes(to), `${from} -> ${to}`);
      assert.equal(flow.state.name, allowed.includes(to) ? state.name : STATES[from].name);
    }
  }
  assert.deepEqual(Object.keys(TRANSITIONS), Object.values(FLOW), 'every state has a row');
});

test('a finished fight cannot be explored or resumed until it is reset (review 5.6)', () => {
  const flow = new GameFlow({ initial: STATES.ended });
  assert.equal(flow.explore(), false);
  assert.equal(flow.hunt(), false);
  assert.equal(flow.ended, true);
  assert.equal(flow.stop(), true);
  assert.equal(flow.hunt(), true);
});

test('pause remembers what to resume, and the old flags are derived from the state', () => {
  const flow = new GameFlow({ initial: STATES.ready });
  assert.equal(flow.pause(), false, 'nothing to pause while stopped');
  flow.explore();
  assert.equal(flow.exploring, true);
  assert.equal(flow.hunting, false);
  flow.pause();
  assert.deepEqual(flow.state, { name: 'paused', resumeTo: { name: 'playing', mode: 'explore' } });
  assert.equal(flow.playMode, 'explore');
  assert.equal(flow.exploring, false, 'paused is not playing');
  assert.equal(flow.resume(), true);
  assert.equal(flow.exploring, true);
  flow.hunt();
  assert.equal(flow.hunting, true);
  assert.equal(flow.resume(), false, 'resume only works while paused');
});

test('setState notifies listeners and emits flowChanged / pauseChanged', () => {
  const events = new EventBus();
  const seen = [];
  events.on(GAME_EVENTS.flowChanged, ({ from, to }) => seen.push(`flow ${from.name}->${to.name}`));
  events.on(GAME_EVENTS.pauseChanged, ({ paused }) => seen.push(`pause ${paused}`));
  const flow = new GameFlow({ events });
  flow.onChange((next, previous) => seen.push(`listener ${previous.name}->${next.name}`));
  flow.finishLoading();
  flow.hunt();
  flow.pause();
  assert.equal(flow.pause(), true, 'pausing twice is a quiet no-op');
  flow.resume();
  assert.deepEqual(seen, [
    'listener loading->ready', 'flow loading->ready',
    'listener ready->playing', 'flow ready->playing',
    'listener playing->paused', 'flow playing->paused', 'pause true',
    'listener paused->playing', 'flow paused->playing', 'pause false',
  ]);
});

test('a change requested by a listener is announced after the current one', () => {
  const flow = new GameFlow({ initial: STATES.ready });
  const order = [];
  flow.onChange((next) => {
    order.push(`a:${next.name}`);
    if (next.name === 'playing') assert.equal(flow.stop(), true, 'e.g. the brain failed to start');
  });
  flow.onChange((next) => order.push(`b:${next.name}`));
  flow.hunt();
  assert.deepEqual(order, ['a:playing', 'b:playing', 'a:ready', 'b:ready']);
  assert.equal(flow.ready, true);
});

// A broken system (say the HUD) must not stop the brain, the mouse capture or
// the toolbar from hearing about the change, and queued changes still happen.
test('a listener that throws is reported, and every other listener and event still runs', () => {
  const events = new EventBus();
  const seen = [];
  const reported = [];
  const original = globalThis.reportError;
  globalThis.reportError = (error) => reported.push(error.message);
  try {
    events.on(GAME_EVENTS.flowChanged, ({ to }) => seen.push(`event ${to.name}`));
    const flow = new GameFlow({ events, initial: STATES.ready });
    flow.onChange((next) => {
      seen.push(`a ${next.name}`);
      if (next.name === 'playing') flow.pause();
    });
    flow.onChange(() => { throw new Error('broken HUD'); });
    flow.onChange((next) => seen.push(`c ${next.name}`));
    assert.equal(flow.hunt(), true);
    assert.equal(flow.paused, true, 'the change queued by a listener still happened');
  } finally {
    if (original) globalThis.reportError = original;
    else delete globalThis.reportError;
  }
  assert.deepEqual(seen, ['a playing', 'c playing', 'event playing', 'a paused', 'c paused', 'event paused']);
  assert.deepEqual(reported, ['broken HUD', 'broken HUD']);
});

test('malformed states are programming errors', () => {
  const flow = new GameFlow();
  assert.throws(() => flow.setState({ name: 'playing', mode: 'fly' }), /play mode/);
  assert.throws(() => flow.setState({ name: 'paused', resumeTo: { name: 'ready' } }), /resume/);
  assert.throws(() => flow.setState({ name: 'ended', winner: 'nobody' }), /winner/);
  assert.throws(() => flow.setState({ name: 'menu' }), /Unknown game state/);
  const ended = new GameFlow({ initial: { name: 'ended', winner: 'leaper', practice: 1 } });
  assert.equal(ended.state.practice, true, 'practice is stored as a boolean');
  assert.ok(Object.isFrozen(ended.state));
});
