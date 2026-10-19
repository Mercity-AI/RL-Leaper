// The Leaper's behaviour state machine (src/actors/leaper/LeaperDirector.js),
// driven with plain "sense" objects: every transition, its locomotion source,
// when the eye may fire, and the stomp / leap / stagger / downed timings.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LeaperDirector, LEAPER_STATES, stateLabel } from '../src/actors/leaper/LeaperDirector.js';
import { LEAPER_BEHAVIOUR as B } from '../src/config/leaper-behaviour.js';
import { COMBAT } from '../src/config/combat.js';

const DT = 1 / 60;

// A hunt in progress with Lola far away and unseen; override what a test needs.
function sense(overrides = {}) {
  return { hunting: true, health: 600, lolaDown: false, brainOnline: true, aware: false, remembers: false,
    eyeSees: false, distance: 25, inReach: false, planLeap: () => null, ...overrides };
}

// A director that records every hook call.
function director() {
  const calls = [];
  const record = (name) => (...args) => calls.push([name, ...args]);
  const hooks = Object.fromEntries(['onStateChange', 'onStompWindup', 'onStompImpact', 'onLeapStart', 'onLeapLaunch',
    'onLeapLand', 'onLeapCancel', 'onStagger', 'onDowned', 'onGetUp', 'onDeath'].map((name) => [name, record(name)]));
  const d = new LeaperDirector({ hooks });
  d.calls = calls;
  d.count = (name) => calls.filter(([n]) => n === name).length;
  return d;
}

// Run `seconds` of updates with the same sense.
function run(d, seconds, s) {
  for (let t = 0; t < seconds - 1e-9; t += DT) d.update(DT, s);
}

// Update until the director is in `state` (at most `seconds`).
function until(d, state, s, seconds = 5) {
  for (let t = 0; t < seconds && d.state !== state; t += DT) d.update(DT, s);
  assert.equal(d.state, state);
}

// A director already hunting a Lola it has seen (Chase), far away.
function chasing() {
  const d = director();
  until(d, 'chase', sense({ aware: true }));
  return d;
}

const PLAN = { from: { x: 0, z: 0, yaw: 0 }, to: { x: 0, z: 8, yaw: 0 }, heading: 0, travel: 8, turn: 0 };

test('every state names its locomotion source and whether the eye may fire', () => {
  assert.deepEqual(Object.keys(LEAPER_STATES), ['dormant', 'search', 'chase', 'engage', 'stomp', 'leap', 'stagger', 'downed', 'dying', 'dead']);
  assert.deepEqual(Object.entries(LEAPER_STATES).filter(([, s]) => s.locomotion === 'rl').map(([n]) => n), ['search', 'chase']);
  assert.deepEqual(Object.entries(LEAPER_STATES).filter(([, s]) => s.bolts).map(([n]) => n), ['chase', 'engage', 'downed']);
  assert.equal(stateLabel('downed', 'down', { permanent: true }), 'DOWN FOR GOOD');
  assert.equal(stateLabel('leap', 'windup'), 'POUNCE!');
});

test('Dormant -> Search -> Chase -> Engage and back, following what the brain sees', () => {
  const d = director();
  d.update(DT, sense({ hunting: false }));
  assert.equal(d.state, 'dormant', 'no run, no hunt');
  d.update(DT, sense());
  assert.equal(d.state, 'search');
  assert.equal(d.locomotion, 'rl', 'the brain searches');
  assert.equal(d.boltsAllowed, false, 'and the eye never fires while it has not seen Lola (review 5.31)');
  d.update(DT, sense({ aware: true }));
  assert.equal(d.state, 'chase');
  assert.ok(d.boltsAllowed);
  // Close, visible and in the eye's line of fire: stop, face her, shoot.
  d.update(DT, sense({ aware: true, eyeSees: true, distance: B.engage.enterDistance - 1 }));
  assert.equal(d.state, 'engage');
  assert.equal(d.locomotion, 'hold');
  assert.equal(d.facing, 'lola');
  // She backs off beyond the exit distance: walk again.
  d.update(DT, sense({ aware: true, eyeSees: true, distance: B.engage.exitDistance + 1 }));
  assert.equal(d.state, 'chase');
  assert.equal(d.reason, 'out of range');
  // Unseen and forgotten: search again; seen once and remembered: keep chasing.
  d.update(DT, sense({ remembers: true }));
  assert.equal(d.state, 'chase');
  d.update(DT, sense());
  assert.equal(d.state, 'search');
  assert.ok(d.count('onStateChange') >= 5);
});

test('Engage ends when the eye loses Lola for a while, and never holds longer than maxHoldTime', () => {
  const d = director();
  const close = { aware: true, eyeSees: true, distance: 10 };
  d.update(DT, sense(close)); d.update(DT, sense(close)); d.update(DT, sense(close));
  assert.equal(d.state, 'engage');
  run(d, B.engage.lostSightTime - 0.1, sense({ ...close, eyeSees: false }));
  assert.equal(d.state, 'engage', 'a short break in the line of fire is fine');
  run(d, 0.2, sense({ ...close, eyeSees: false }));
  assert.equal(d.state, 'chase');
  assert.equal(d.reason, 'lost sight');
  // Back in, then held for the longest allowed: it walks for at least repositionTime.
  d.update(DT, sense(close));
  assert.equal(d.state, 'engage');
  run(d, B.engage.maxHoldTime + 0.05, sense(close));
  assert.equal(d.state, 'chase');
  assert.equal(d.reason, 'reposition');
  run(d, B.engage.repositionTime - 0.1, sense(close));
  assert.equal(d.state, 'chase', 'no new hold while repositioning');
  run(d, 0.2, sense(close));
  assert.equal(d.state, 'engage');
});

test('stomp: Lola hugging it for the trigger time, a telegraphed wind-up, one impact, then a cooldown', () => {
  const d = director();
  const hug = { aware: true, eyeSees: true, distance: 3, inReach: true };
  d.update(DT, sense(hug));
  run(d, B.stomp.trigger - 0.1, sense(hug));
  assert.notEqual(d.state, 'stomp', 'not before the trigger time');
  // Stepping out resets the count.
  d.update(DT, sense({ ...hug, inReach: false }));
  run(d, B.stomp.trigger - 0.1, sense(hug));
  assert.notEqual(d.state, 'stomp');
  until(d, 'stomp', sense(hug), 0.15);
  assert.equal(d.phase, 'windup');
  assert.equal(d.locomotion, 'hold');
  assert.equal(d.boltsAllowed, false);
  assert.equal(d.count('onStompWindup'), 1);
  // The slam lands exactly once, when the wind-up ends.
  run(d, B.stomp.windup - 0.05, sense(hug));
  assert.equal(d.count('onStompImpact'), 0);
  run(d, 0.1, sense(hug));
  assert.equal(d.count('onStompImpact'), 1);
  run(d, B.stomp.recovery + 0.05, sense(hug));
  assert.notEqual(d.state, 'stomp');
  // Still hugging: no new stomp until the cooldown is over.
  run(d, B.stomp.cooldown - 0.2, sense(hug));
  assert.equal(d.count('onStompWindup'), 1);
  run(d, 0.3 + B.stomp.trigger, sense(hug));
  assert.equal(d.count('onStompWindup'), 2);
});

test('leap: only at a seen Lola in the band, after the brain accepts the landing; crouch, flight, landing, cooldown', () => {
  const d = director();
  let asked = 0;
  const target = { aware: true, eyeSees: false, distance: 15, planLeap: () => { asked += 1; return { ...PLAN }; } };
  // Not in the band, not seen, or no brain: no leap.
  d.update(DT, sense({ ...target, distance: B.leap.maxDistance + 1 }));
  d.update(DT, sense({ ...target, distance: B.leap.minDistance - 1 }));
  d.update(DT, sense({ ...target, brainOnline: false }));
  assert.equal(asked, 0);
  assert.notEqual(d.state, 'leap');
  d.update(DT, sense(target));
  assert.equal(d.state, 'leap');
  assert.equal(asked, 1);
  assert.equal(d.phase, 'windup');
  assert.equal(d.facing, 'leap');
  assert.deepEqual(d.calls.find(([n]) => n === 'onLeapStart')[1], PLAN);
  // It waits for the brain's answer (crouch held), then takes off.
  run(d, B.leap.windup + 0.1, sense(target));
  assert.equal(d.phase, 'windup', 'no take-off before the brain accepts the spot');
  d.leapAccepted(true);
  d.update(DT, sense(target));
  assert.equal(d.phase, 'flight');
  assert.equal(d.locomotion, 'scripted');
  assert.equal(d.count('onLeapLaunch'), 1);
  // The flight lasts `flight` seconds, then the landing (shockwave) and a short recovery.
  run(d, B.leap.flight - 0.05, sense(target));
  assert.equal(d.count('onLeapLand'), 0);
  run(d, 0.1, sense(target));
  assert.equal(d.count('onLeapLand'), 1);
  assert.equal(d.locomotion, 'hold');
  run(d, B.leap.recovery + 0.05, sense(target));
  assert.equal(d.state, 'chase');
  assert.ok(d.cooldowns.leap > B.leap.cooldown - 0.2);
  run(d, B.leap.cooldown - 0.5, sense(target));
  assert.equal(d.count('onLeapStart'), 1, 'no second leap during the cooldown');
});

test('leap: a refused landing or no answer calls it off; the search for a spot is throttled', () => {
  const d = chasing();
  let asked = 0;
  const target = { aware: true, distance: 15, planLeap: () => { asked += 1; return asked >= 3 ? { ...PLAN } : null; } };
  run(d, B.leap.planInterval * 2.5, sense(target));
  assert.equal(asked, 3, 'one look per planInterval');
  assert.equal(d.state, 'leap');
  d.leapAccepted(false);
  d.update(DT, sense(target));
  assert.equal(d.state, 'chase');
  assert.equal(d.calls.find(([n]) => n === 'onLeapCancel')[2], 'landing refused');
  assert.equal(d.count('onLeapCancel'), 1, 'told once');
  const e = chasing();
  e.update(DT, sense({ aware: true, distance: 15, planLeap: () => ({ ...PLAN }) }));
  assert.equal(e.state, 'leap');
  run(e, B.leap.windup + B.leap.acceptTimeout + 0.05, sense({ aware: true, distance: 15 }));
  assert.equal(e.state, 'chase');
  assert.equal(e.calls.find(([n]) => n === 'onLeapCancel')[2], 'no answer');
});

test('stagger: a joint break cancels a wind-up, freezes it for staggerTime, then a cooldown', () => {
  const d = director();
  const hug = { aware: true, distance: 3, inReach: true };
  run(d, B.stomp.trigger + 0.1, sense(hug));
  assert.equal(d.state, 'stomp');
  d.legBroken({ lost: 1 });
  d.update(DT, sense(hug));
  assert.equal(d.state, 'stagger');
  assert.equal(d.locomotion, 'hold');
  assert.equal(d.boltsAllowed, false);
  run(d, B.stomp.windup, sense({ ...hug, inReach: false }));
  assert.equal(d.count('onStompImpact'), 0, 'the stomp never lands');
  assert.equal(d.state, 'chase', `back up after ${B.stagger.time} s`);
  // A second break straight away: no stun-lock.
  d.legBroken({ lost: 2 });
  d.update(DT, sense({ aware: true }));
  assert.equal(d.state, 'chase');
  run(d, B.stagger.cooldown, sense({ aware: true }));
  d.bigHit('weakPoint');
  d.update(DT, sense({ aware: true }));
  assert.equal(d.state, 'stagger');
  assert.equal(d.reason, 'weak point');
});

test('a stagger never interrupts a leap in mid-air', () => {
  const d = chasing();
  d.update(DT, sense({ aware: true, distance: 15, planLeap: () => ({ ...PLAN }) }));
  d.leapAccepted(true);
  run(d, B.leap.windup + 0.05, sense({ aware: true, distance: 15 }));
  assert.equal(d.phase, 'flight');
  d.legBroken({ lost: 1 });
  d.update(DT, sense({ aware: true, distance: 15 }));
  assert.equal(d.phase, 'flight');
});

test(`downed: losing ${COMBAT.legs.maxLost} legs knocks it down; it gets up after recoverTime unless more legs go`, () => {
  const d = director();
  d.update(DT, sense({ aware: true }));
  d.legBroken({ lost: COMBAT.legs.maxLost });
  d.update(DT, sense({ aware: true }));
  assert.equal(d.state, 'downed');
  assert.equal(d.phase, 'falling');
  assert.equal(d.locomotion, 'hold', 'mobility 0: the brain is paused');
  assert.equal(d.boltsAllowed, true, 'the eye keeps firing (a vulnerable phase)');
  assert.deepEqual(d.calls.find(([n]) => n === 'onDowned')[1], { permanent: false });
  run(d, B.downed.sinkTime + 0.05, sense({ aware: true }));
  assert.equal(d.phase, 'down');
  run(d, B.downed.recoverTime, sense({ aware: true }));
  assert.equal(d.phase, 'rising');
  run(d, B.downed.getUpTime + 0.05, sense({ aware: true }));
  assert.equal(d.state, 'chase', 'up again, limping');
  // One more leg after getting up: down for good.
  d.legBroken({ lost: COMBAT.legs.maxLost + 1 });
  d.update(DT, sense({ aware: true }));
  assert.equal(d.state, 'downed');
  assert.equal(d.permanent, true);
  run(d, B.downed.sinkTime + B.downed.recoverTime + B.downed.getUpTime + 1, sense({ aware: true }));
  assert.equal(d.state, 'downed');
  assert.equal(d.label, 'DOWN FOR GOOD');
});

test('downed: a leg lost while down, or while getting up, keeps it down', () => {
  const d = director();
  d.update(DT, sense());
  d.legBroken({ lost: COMBAT.legs.maxLost });
  run(d, B.downed.sinkTime + 1, sense());
  d.legBroken({ lost: COMBAT.legs.maxLost + 1 });
  run(d, B.downed.recoverTime + 1, sense());
  assert.equal(d.phase, 'down');
  const e = director();
  e.update(DT, sense());
  e.legBroken({ lost: COMBAT.legs.maxLost });
  run(e, B.downed.sinkTime + B.downed.recoverTime + 0.2, sense());
  assert.equal(e.phase, 'rising');
  e.legBroken({ lost: COMBAT.legs.maxLost + 1 });
  e.update(DT, sense());
  assert.equal(e.state, 'downed');
  assert.equal(e.phase, 'falling', 'falls back down');
  assert.equal(e.permanent, true);
});

test('death: from any state to Dying (once), then Dead after the collapse; nothing changes after', () => {
  for (const setup of [(d) => d.update(DT, sense({ aware: true })),
    (d) => { d.update(DT, sense()); d.legBroken({ lost: COMBAT.legs.maxLost }); d.update(DT, sense()); },
    (d) => { until(d, 'leap', sense({ aware: true, distance: 15, planLeap: () => ({ ...PLAN }) })); d.leapAccepted(true); run(d, B.leap.windup + 0.1, sense()); }]) {
    const d = director();
    setup(d);
    d.update(DT, sense({ health: 0 }));
    assert.equal(d.state, 'dying');
    assert.equal(d.locomotion, 'scripted');
    assert.equal(d.boltsAllowed, false);
    run(d, B.dying.time + 0.05, sense({ health: 0 }));
    assert.equal(d.state, 'dead');
    d.legBroken({ lost: 6 });
    d.bigHit('weakPoint');
    run(d, 2, sense({ health: 0, hunting: false }));
    assert.equal(d.state, 'dead');
    assert.equal(d.count('onDeath'), 1);
  }
});

test('stopping the run sends it dormant, but a leap in the air lands first; Lola down ends the hunt', () => {
  const d = chasing();
  d.update(DT, sense({ aware: true, distance: 15, planLeap: () => ({ ...PLAN }) }));
  d.leapAccepted(true);
  run(d, B.leap.windup + 0.05, sense({ aware: true, distance: 15 }));
  assert.equal(d.phase, 'flight');
  d.update(DT, sense({ hunting: false }));
  assert.equal(d.phase, 'flight', 'still in the air');
  run(d, B.leap.flight, sense({ hunting: false }));
  assert.equal(d.state, 'dormant');
  assert.equal(d.count('onLeapLand'), 1, 'it landed');
  d.update(DT, sense({ aware: true }));
  d.update(DT, sense({ aware: true, lolaDown: true }));
  assert.equal(d.state, 'dormant');
  assert.equal(d.reason, 'Lola is down');
  // A crouch already under way when the run stops is called off.
  const e = chasing();
  e.update(DT, sense({ aware: true, distance: 15, planLeap: () => ({ ...PLAN }) }));
  e.update(DT, sense({ hunting: false }));
  assert.equal(e.state, 'dormant');
  assert.equal(e.count('onLeapCancel'), 1);
  // reset(): back to the very start.
  e.reset();
  assert.equal(e.state, 'dormant');
  assert.deepEqual(e.cooldowns, { stomp: 0, leap: 0, stagger: 0, reposition: 0 });
});
