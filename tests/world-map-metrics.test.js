import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { ENCOUNTER } from '../src/config/encounter.js';
import { measureJunkyard, workableWidth } from '../src/world/junkyardMetrics.js';
import metrics from '../assets/maps/junkyard/metrics.json' with { type: 'json' };

// Level metrics: the baked assets/maps/junkyard/metrics.json must still describe
// the shipped collision.json (re-bake with `pnpm assets:metrics` after a map
// export), and the reachable share at the default Leaper size is reported.

const bytes = fs.readFileSync(new URL('../assets/maps/junkyard/collision.json', import.meta.url));
const data = JSON.parse(bytes.toString('utf8'));

// Level-design targets (map share of clear floor the spawn can reach, and of
// the whole yard). Not met today: reported as TODOs until the level is reworked.
const DESIGN_TARGET = Object.freeze({ reachableShareOfFree: 0.5, reachableShareOfArena: 0.1 });

test('the baked metrics belong to the shipped collision export', () => {
  const sha = crypto.createHash('sha256').update(bytes).digest('hex');
  assert.equal(metrics.collisionSha256, sha, 'collision.json changed: run `pnpm assets:metrics`');
  assert.equal(metrics.startWidth, ENCOUNTER.startWidth, 'ENCOUNTER.startWidth changed: run `pnpm assets:metrics`');
});

test('the size slider maximum is the largest workable Leaper width', () => {
  const widest = metrics.maxWorkableWidth;
  assert.ok(workableWidth(data, widest), `RESTART RANDOM works at ${widest}`);
  const above = Math.round((widest + 0.1) * 10) / 10;
  assert.equal(workableWidth(data, above), false, `RESTART RANDOM has no pair at ${above}`);
  assert.ok(widest >= ENCOUNTER.startWidth, 'the default Leaper size is inside the slider range');
});

test('level metrics at the default Leaper size (reported, soft-asserted)', async (t) => {
  const measured = measureJunkyard(data, ENCOUNTER.startWidth);
  assert.deepEqual(measured, metrics.atStartWidth, 'the baked numbers are still true');
  // Hard floor: the spawn must reach somewhere and a random start must exist.
  assert.ok(measured.spawnRegionCells > 1, 'the spawn region is more than its own cell');
  assert.ok(measured.randomStartPossible);
  console.log(`At width ${ENCOUNTER.startWidth}: ${measured.freeCells} of ${measured.cells} cells clear `
    + `(${(measured.freeShareOfArena * 100).toFixed(1)}% of the yard) in ${measured.regions} regions; the spawn reaches `
    + `${(measured.reachableShareOfFree * 100).toFixed(1)}% of clear floor = ${(measured.reachableShareOfArena * 100).toFixed(1)}% of the yard`);
  // Soft targets: a TODO (not a failure) while the yard stays this tight.
  for (const [key, target] of Object.entries(DESIGN_TARGET)) {
    const met = measured[key] >= target;
    await t.test(`${key} >= ${target}`, { todo: met ? false : `${measured[key]} at width ${ENCOUNTER.startWidth}: arena very tight (owner decision)` },
      () => assert.ok(met));
  }
});
