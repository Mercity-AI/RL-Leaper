// The Leaper's eye never shoots beyond what its brain can see (review fix 5.31):
// the bolt range grows with the map (22 map units), the brain's sight does not
// (28 + Lola's 1.4 radius, in its own units), so small Leapers used to fire from
// up to five times its sight range while the HUD said SEARCHING.
import test from 'node:test';
import assert from 'node:assert/strict';
import { COMBAT, attackRange } from '../src/config/combat.js';
import { RAY_MAX_RANGE, TARGET_RADIUS } from '../src/brain/junkyard/frozenEnv.js';

const BODY_DIAMETER = 7.98; // the map scale is 7.98 / width (createJunkyardWorld.js)
const sight = { sightRange: RAY_MAX_RANGE, targetRadius: TARGET_RADIUS };

test('at every Leaper size the attack range stays within the brain\'s sight', () => {
  assert.equal(RAY_MAX_RANGE + TARGET_RADIUS, 29.4, 'the trained sight: 28 + 1.4');
  for (let width = 1.2; width <= 8.0001; width += 0.1) {
    const scale = BODY_DIAMETER / width;
    const range = attackRange(scale, sight);
    assert.ok(range <= 29.4 + 1e-12, `width ${width.toFixed(1)}: range ${range.toFixed(2)}`);
    // Where the bolt range itself is shorter (big Leapers), it is kept.
    assert.equal(range, Math.min(COMBAT.weaponRange * scale, 29.4));
  }
  // The cases from the review: width 5.5 used to reach 31.9, width 1.2 about 146.
  assert.equal(attackRange(BODY_DIAMETER / 5.5, sight), 29.4);
  assert.equal(attackRange(BODY_DIAMETER / 1.2, sight), 29.4);
  assert.ok(Math.abs(attackRange(1, sight) - 22) < 1e-12, 'width 7.98 (scale 1): the 22-unit bolt range');
});

test('LeaperCombat reads the brain\'s own sight constants for its range', async () => {
  const { LeaperCombat, BRAIN_SIGHT } = await import('../src/simulation/LeaperCombat.js');
  assert.deepEqual(BRAIN_SIGHT, sight);
  for (const width of [1.2, 2.9, 5.5, 7.98]) {
    const combat = { playtest: { world: { scale: BODY_DIAMETER / width } }, config: COMBAT };
    assert.equal(LeaperCombat.prototype.range.call(combat), attackRange(BODY_DIAMETER / width, sight));
  }
});
