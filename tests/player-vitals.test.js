import test from 'node:test';
import assert from 'node:assert/strict';
import { PlayerVitals, TRAIL_HOLD } from '../src/game/PlayerVitals.js';
import { EventBus, GAME_EVENTS } from '../src/core/events.js';
import { COMBAT } from '../src/config/combat.js';

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
  const audio = { playSlot: (slot) => sounds.push(slot) };
  const events = new EventBus();
  const damaged = [];
  events.on(GAME_EVENTS.lolaDamaged, (payload) => damaged.push(payload));
  const vitals = new PlayerVitals({ player, audio, events, hud });
  return { vitals, hud, drawn, player, sounds, damaged };
}

test('a bolt takes 8 health, tells the game, flinches Lola and plays the hurt sounds', () => {
  const { vitals, player, sounds, damaged, drawn } = setup();
  assert.equal(player.defeated, false, 'a fresh fight frees Lola');
  const direction = { x: 0, y: 0, z: 1 };
  assert.equal(vitals.damage(COMBAT.boltDamage, direction), 8);
  assert.equal(vitals.health, 92);
  assert.deepEqual(damaged, [{ amount: 8, health: 92, direction }]);
  assert.deepEqual(player.flinches, [direction]);
  assert.deepEqual(sounds, ['lolaHitThud', 'lolaHurt']);
  const view = drawn.at(-1);
  assert.equal(view.hit, true, 'the readout flashes');
  assert.equal(view.edgeTint, 0, 'ordinary damage never tints the screen edges');
  assert.equal(view.trail, 1, 'the lost chunk is still shown');
});

test('the lost chunk holds, then drains; the flash ends; nothing moves while paused', () => {
  const { vitals, drawn } = setup();
  vitals.damage(50);
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

test('critical health tints the screen edges; zero health defeats Lola once', () => {
  const { vitals, player, sounds, damaged, drawn } = setup();
  vitals.damage(80);
  assert.equal(drawn.at(-1).level, 'low');
  assert.ok(drawn.at(-1).edgeTint > 0);
  assert.equal(sounds.at(-1), 'lolaHurtBig', 'the heavier voice when nearly down');
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
  vitals.damage(100);
  vitals.showResult('LOLA DEFEATED');
  assert.equal(hud.shown, 'LOLA DEFEATED');
  const cleared = player.cleared;
  vitals.reset();
  assert.equal(vitals.health, 100);
  assert.equal(player.defeated, false);
  assert.equal(player.cleared, cleared + 1);
  assert.equal(hud.shown, null);
});
