import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JunkyardNavigation, triangleDistanceSquared } from '../src/world/JunkyardNavigation.js';

test('Triangle interiors, edges, and degenerate wall projections', () => {
  assert.equal(triangleDistanceSquared(0.2, 0.2, [0, 0, 1, 0, 0, 1]), 0);
  assert.equal(triangleDistanceSquared(2, 0, [0, 0, 1, 0, 0, 1]), 1);
  assert.equal(triangleDistanceSquared(2, 0, [0, -1, 0, 1, 0, 1]), 4);
});
test('Actual junkyard: open spawn, closed walls, and collision-free routes at each size', () => {
  const data = JSON.parse(fs.readFileSync(new URL('../assets/maps/junkyard/collision.json', import.meta.url)));
  for (const width of [1.2, 2.4, 4, 8]) {
    const nav = new JunkyardNavigation(data, width / 2, 3.82 * width / 7.98);
    const start = nav.point(nav.nearest({ x: 0, z: 0 }));
    assert.equal(nav.blocked(start.x, start.z), false);
    assert.equal(nav.blocked(24, 0), true);
    assert.deepEqual(nav.route(start, {x: 30, z: 0}), []);
    let count = 0;
    for (let i = 0; i < nav.free.length; i += width === 8 ? 1 : 137) {
      if (!nav.free[i]) continue;
      const path = nav.route(start, nav.point(i));
      for (let j = 1; j < path.length; j += 1) {
        assert.ok(nav.clearLine(path[j - 1], path[j]));
      }
      if (path.length) count++;
    }
    assert.ok(count > 0, `At least one reachable destination at width ${width}`);
    console.log(`Width ${width}: ${nav.free.reduce((sum, n) => sum + n, 0)} clear cells, ${count} sampled reachable goals`);
  }
});

test('north-shifted tire cluster opens the default Leaper passage beside the bus', () => {
  const data = JSON.parse(fs.readFileSync(new URL('../assets/maps/junkyard/collision.json', import.meta.url)));
  const nav = new JunkyardNavigation(data, 1.2, 3.82 * 2.4 / 7.98);
  assert.ok(nav.clearLine({ x: 4, z: -2.5 }, { x: 10, z: -2.5 }));
});
