// The Leaper's eye never shoots beyond what its brain can see (review fix 5.31):
// the bolt range grows with the map (22 map units), the brain's sight does not
// (28 + Lola's 1.4 radius, in its own units), so small Leapers used to fire from
// up to five times its sight range while the HUD said SEARCHING.
import test from 'node:test';
import assert from 'node:assert/strict';
import { COMBAT, attackRange } from '../src/config/combat.js';
import { RAY_MAX_RANGE, TARGET_RADIUS } from '../src/brain/junkyard/frozenEnv.js';

const BODY_DIAMETER = 7.98; // the map scale is 7.98 / width (createJunkyardWorld.js)
// The game's sight (owner, 2026-10-30), at the map scale of a width.
const sightAt = (scale) => ({ sightRange: COMBAT.sightRange * scale, targetRadius: TARGET_RADIUS });

test('at every Leaper size the attack range stays within the Leaper\'s sight', () => {
  assert.equal(RAY_MAX_RANGE + TARGET_RADIUS, 29.4, 'the trained wall rays stay: 28 + 1.4');
  for (let width = 1.2; width <= 8.0001; width += 0.1) {
    const scale = BODY_DIAMETER / width;
    const range = attackRange(scale, sightAt(scale));
    assert.equal(range, COMBAT.sightRange * scale + TARGET_RADIUS, `width ${width.toFixed(1)}: the laser reaches what it sees`);
  }
  assert.ok(COMBAT.weaponRange * 1 >= COMBAT.sightRange + TARGET_RADIUS, 'the bolt range never cuts the sight short');
});

test('LeaperCombat reads the brain\'s own sight constants for its range', async () => {
  const { LeaperCombat, BRAIN_SIGHT } = await import('../src/simulation/LeaperCombat.js');
  assert.equal(BRAIN_SIGHT.targetRadius, TARGET_RADIUS);
  for (const width of [1.2, 2.9, 5.5, 7.98]) {
    const combat = { playtest: { world: { scale: BODY_DIAMETER / width } }, config: COMBAT };
    assert.equal(LeaperCombat.prototype.range.call(combat), attackRange(BODY_DIAMETER / width, sightAt(BODY_DIAMETER / width)));
  }
});
