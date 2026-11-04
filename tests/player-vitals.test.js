import test from 'node:test';
import assert from 'node:assert/strict';
import { PlayerVitals, TRAIL_HOLD } from '../src/game/PlayerVitals.js';
import { EventBus, GAME_EVENTS } from '../src/core/events.js';
import { COMBAT } from '../src/config/combat.js';

// Lola's full health (src/config/combat.js).
const FULL = COMBAT.lolaHealth;

// Lola's health rules with a recording stand-in for the page panel.
function setup() {
  const drawn = [];
  const hud = {
    shown: null,
    render: (view) => drawn.push(view),
    showResult(text) { this.shown = text; },
    hideResult() { this.shown = null; },
    dispose() {},
  };
  const player = { defeated: true, flinches: [], cleared: 0,
    reactToHit(direction) { this.flinches.push(direction); }, clearHitReaction() { this.cleared += 1; } };
  const sounds = [];
  const audio = { playSlot: (slot, options) => { sounds.push(slot); audio.last = options; } };
  const events = new EventBus();
  const damaged = [];
  events.on(GAME_EVENTS.lolaDamaged, (payload) => damaged.push(payload));
  const vitals = new PlayerVitals({ player, audio, events, hud });
  return { vitals, hud, drawn, player, sounds, damaged, audio };
}

test('a bolt takes 8 health, tells the game, flinches Lola and plays the hurt sounds', () => {
  const { vitals, player, sounds, damaged, drawn } = setup();
  assert.equal(player.defeated, false, 'a fresh fight frees Lola');
  const direction = { x: 0, y: 0, z: 1 };
  assert.equal(vitals.damage(COMBAT.boltDamage, direction), 8);
  assert.equal(vitals.health, FULL - 8);
  assert.deepEqual(damaged, [{ amount: 8, health: FULL - 8, direction }]);
  assert.deepEqual(player.flinches, [direction]);
  assert.deepEqual(sounds, ['lolaHitThud', 'lolaHurt']);
  const view = drawn.at(-1);
  assert.equal(view.hit, true, 'the readout flashes');
  assert.ok(view.edgeTint > 0.5, 'a hit bursts the red screen edges');
  assert.equal(view.hitDirection, direction, 'and says which way it came');
  assert.equal(view.trail, 1, 'the lost chunk is still shown');
});

test('the lost chunk holds, then drains; the flash ends; nothing moves while paused', () => {
  const { vitals, drawn } = setup();
  vitals.damage(FULL / 2);
  vitals.update(0);
  assert.equal(drawn.at(-1).trail, 1, 'paused (dt = 0): the trail holds');
  vitals.update(TRAIL_HOLD);
  assert.equal(drawn.at(-1).hit, false, 'the HIT flash is over after 0.4 s');
  assert.equal(drawn.at(-1).trail, 1);
  vitals.update(0.5);
  assert.ok(Math.abs(drawn.at(-1).trail - 0.7) < 1e-9, 'then it drains at 0.6 bars per second');
  vitals.update(5);
  assert.equal(drawn.at(-1).trail, 0.5, 'down to the real health');
});

test('hurt: panting under 20, blur under 10 that eases in, and a pill eases it out by 20', () => {
  const { vitals, player, sounds, audio } = setup();
  const seconds = (time) => { for (let t = 0; t < time; t += 0.1) vitals.update(0.1); };
  vitals.health = FULL * 0.3;
  sounds.length = 0;
  seconds(5);
  assert.equal(sounds.filter((id) => id === 'lolaPant').length, 0, 'no panting at 30');
  vitals.health = FULL * 0.21;
  seconds(3);
  assert.equal(sounds.filter((id) => id === 'lolaPant').length, 0, 'nor at 21');
  vitals.health = FULL * 0.18;
  sounds.length = 0;
  const times = [];
  for (let t = 0; t < 20; t += 0.1) {
    const before = sounds.length;
    vitals.update(0.1);
    if (sounds.length > before && sounds.at(-1) === 'lolaPant') times.push(t);
  }
  const gaps = times.slice(1).map((time, i) => time - times[i]);
  const { breathRun, breathRest } = COMBAT.lolaHurt;
  assert.ok(times.length >= 4, 'breaths keep coming at 18');
  assert.ok(gaps.some((gap) => gap >= breathRest[0] - 0.15), 'with rests between short runs');
  assert.ok(gaps.every((gap) => gap <= breathRest[1] + 0.15), 'never longer than the longest rest');
  let run = 1, longest = 1;
  for (const gap of gaps) { run = gap < breathRest[0] - 0.15 ? run + 1 : 1; longest = Math.max(longest, run); }
  assert.ok(longest <= breathRun[1], 'a run is never longer than its most breaths');
  assert.equal(audio.last.gain, COMBAT.lolaHurt.standingVolume, 'quieter standing still');
  player.running = true;
  seconds(breathRest[1] + 0.5);
  assert.equal(audio.last.gain, 1, 'full volume running');
  player.running = false;
  assert.equal(vitals.weakness, 0, 'still clear-sighted at 18');
  vitals.health = FULL * 0.05;
  vitals.update(0.1);
  assert.ok(vitals.weakness > 0 && vitals.weakness < 0.2, 'it sets in slowly');
  seconds(3);
  assert.equal(vitals.weakness, 1);
  assert.equal(player.weakness, 1, 'her running hunch follows it');
  vitals.health = FULL * 0.15;
  seconds(4);
  assert.ok(Math.abs(vitals.weakness - 0.5) < 0.01, 'a pill eases it part way');
  vitals.health = FULL * 0.21;
  vitals.update(0.1);
  assert.ok(vitals.weakness > 0.4, 'and it clears slowly');
  seconds(3);
  assert.equal(vitals.weakness, 0, 'clear above 20');
  vitals.health = FULL * 0.12;
  seconds(2);
  assert.equal(vitals.weakness, 0, 'falling to 12 from above stays clear until under 10');
  vitals.health = FULL * 0.09;
  seconds(2);
  assert.equal(vitals.weakness, 1, 'at 9 it is fully blurred');
});

test('the red edges fade after a hit, even nearly down; zero health defeats Lola once', () => {
  const { vitals, player, sounds, damaged, drawn } = setup();
  vitals.damage(FULL - 20);
  assert.equal(drawn.at(-1).level, 'low');
  assert.ok(drawn.at(-1).edgeTint > 0);
  assert.equal(sounds.at(-1), 'lolaHurt', 'her own grunt even when nearly down: no scream');
  vitals.update(1);
  assert.equal(drawn.at(-1).level, 'low');
  assert.ok(Math.abs(drawn.at(-1).edgeTint - COMBAT.lolaHurt.edge) < 0.01, 'slightly red while under 20');
  vitals.health = FULL * 0.25;
  vitals.update(2);
  assert.equal(drawn.at(-1).edgeTint, 0, 'and clear again above it');
  vitals.health = 20;
  assert.equal(player.defeated, false);
  assert.equal(vitals.damage(50), 20, 'never more than the health left');
  assert.equal(vitals.dead, true);
  assert.equal(player.defeated, true, 'only a loss stops Lola');
  assert.equal(vitals.damage(8), 0, 'no damage after death');
  assert.equal(damaged.length, 2);
  vitals.update(0.1, { over: true });
  assert.equal(drawn.at(-1).hit, false, 'no HIT highlight once the fight is over');
});

test('reset restores health, frees Lola, clears her flinch and hides the result banner', () => {
  const { vitals, player, hud } = setup();
  vitals.damage(FULL);
  vitals.showResult('YOU LOSE');
  assert.equal(hud.shown, 'YOU LOSE');
  const cleared = player.cleared;
  vitals.reset();
  assert.equal(vitals.health, FULL);
  assert.equal(player.defeated, false);
  assert.equal(player.cleared, cleared + 1);
  assert.equal(hud.shown, null);
});

test('the player sees her health out of 100, however tough she really is', () => {
  const { vitals, drawn } = setup();
  vitals.update(0);
  assert.equal(drawn.at(-1).shown, COMBAT.lolaHealthShown, 'full health reads 100');
  assert.equal(drawn.at(-1).shownMax, COMBAT.lolaHealthShown);
  vitals.damage(COMBAT.boltDamage);
  vitals.update(0);
  const shown = drawn.at(-1).shown;
  assert.ok(Math.abs(shown - (FULL - 8) * COMBAT.lolaHealthShown / FULL) < 1e-9, `one bolt leaves ${shown}`);
  assert.ok(COMBAT.lolaHealthShown - shown < COMBAT.boltDamage, 'a bolt costs less of the 100 than before');
});
