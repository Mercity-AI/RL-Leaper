import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JunkyardNavigation, triangleDistanceSquared } from '../src/world/JunkyardNavigation.js';
import { buildJunkyardCollision, junkyardScale, leaperGridSize, PLAYER_GRID } from '../src/world/junkyardCollision.js';
import { randomJunkyardStart, RANDOM_START } from '../src/world/randomJunkyardStart.js';
import { ENCOUNTER } from '../src/config/encounter.js';
import { BODY_COLLISION_RADIUS, STANDING_HEIGHT } from '../src/config/robot.js';
import metrics from '../assets/maps/junkyard/metrics.json' with { type: 'json' };
import passages from '../assets/maps/junkyard/passages.json' with { type: 'json' };
import { seededRandom } from './world-helpers.js';

// The junkyard's flat collision grids on the real export, at the sizes the game
// really uses: ENCOUNTER.startWidth (the default Leaper), the largest workable
// width, and the old sizes the map was first tuned at.

const data = JSON.parse(fs.readFileSync(new URL('../assets/maps/junkyard/collision.json', import.meta.url)));
const START = ENCOUNTER.startWidth;

test('Triangle interiors, edges, and degenerate wall projections', () => {
  assert.equal(triangleDistanceSquared(0.2, 0.2, [0, 0, 1, 0, 0, 1]), 0);
  assert.equal(triangleDistanceSquared(2, 0, [0, 0, 1, 0, 0, 1]), 1);
  assert.equal(triangleDistanceSquared(2, 0, [0, -1, 0, 1, 0, 1]), 4);
});

test('grid sizes come from the real robot and encounter constants', () => {
  // The Leaper's map-unit height cut is the body height + clearance over the map scale.
  assert.equal(junkyardScale(START), BODY_COLLISION_RADIUS * 2 / START);
  assert.deepEqual(leaperGridSize(START), { radius: START / 2, height: (STANDING_HEIGHT + 1.5) / junkyardScale(START) });
  assert.ok(Math.abs(leaperGridSize(2.4).height - 3.82 * 2.4 / 7.98) < 1e-12, 'same numbers the old tests typed in by hand');
  assert.equal(PLAYER_GRID.height, 1.9 * ENCOUNTER.lolaHeight);
});

test('Actual junkyard: open spawn, closed walls, and collision-free routes at each size', () => {
  for (const width of [1.2, 2.4, 4, START, metrics.maxWorkableWidth, 8]) {
    const { radius, height } = leaperGridSize(width);
    const nav = new JunkyardNavigation(data, radius, height);
    const start = nav.point(nav.nearest({ x: 0, z: 0 }));
    assert.equal(nav.blocked(start.x, start.z), false);
    assert.equal(nav.blocked(24, 0), true);
    assert.deepEqual(nav.route(start, {x: 30, z: 0}), []);
    let count = 0;
    for (let i = 0; i < nav.free.length; i += width >= 6 ? 1 : 137) {
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

test('north-shifted tire cluster opens the passage beside the bus up to its listed width', () => {
  for (const passage of passages.passages) {
    for (const width of [2.4, passage.openUpTo]) {
      const { radius, height } = leaperGridSize(width);
      const nav = new JunkyardNavigation(data, radius, height);
      assert.ok(nav.clearLine(passage.from, passage.to), `${passage.name} is open at width ${width}`);
    }
  }
});

test('passages at the default Leaper size (a level-design report, not a failure)', async (t) => {
  const { radius, height } = leaperGridSize(START);
  const nav = new JunkyardNavigation(data, radius, height);
  for (const passage of passages.passages) {
    const open = nav.clearLine(passage.from, passage.to);
    console.log(`${passage.name} at width ${START}: ${open ? 'open' : 'blocked'} (open up to ${passage.openUpTo})`);
    // Known gap until the level is reworked: reported as a TODO, not a red test.
    await t.test(`${passage.name} open at the default size`, { todo: open ? false : 'blocked at the default size: owner decision (see passages.json)' },
      () => assert.ok(open));
  }
});

test('connected regions: one label per clear cell, and the same label always has a route', () => {
  const { navigation: nav } = buildJunkyardCollision(data, START);
  const { labels, sizes, count } = nav.regions;
  assert.equal(sizes.length, count);
  for (let i = 0; i < labels.length; i += 1) assert.equal(labels[i] >= 0, Boolean(nav.free[i]), `cell ${i} label vs free`);
  assert.equal(sizes.reduce((sum, n) => sum + n, 0), nav.free.reduce((sum, n) => sum + n, 0));
  // Pairs of cells in the same region always route (sampled across every region).
  const random = seededRandom(5);
  const byRegion = Array.from({ length: count }, () => []);
  labels.forEach((label, i) => { if (label >= 0) byRegion[label].push(i); });
  for (const cells of byRegion) {
    for (let k = 0; k < 4 && cells.length > 1; k += 1) {
      const a = nav.point(cells[Math.floor(random() * cells.length)]);
      const b = nav.point(cells[Math.floor(random() * cells.length)]);
      assert.ok(nav.route(a, b).length, `cells in one region route (${a.x}, ${a.z}) -> (${b.x}, ${b.z})`);
    }
  }
});

test('RESTART RANDOM at the default size: 20 of 20 succeed, each well under 50 ms', () => {
  const { navigation } = buildJunkyardCollision(data, START);
  const world = { navigation, scale: junkyardScale(START) };
  const random = seededRandom(20);
  let previous = { x: 0, z: 0 }, slowest = 0;
  for (let i = 0; i < 20; i += 1) {
    const started = performance.now();
    const pick = randomJunkyardStart(world, previous, random);
    slowest = Math.max(slowest, performance.now() - started);
    assert.ok(pick, `random start ${i} found a pair`);
    // Same connected region, far enough apart, clear of walls with the margin, and a real route.
    const s = world.scale;
    const a = { x: pick.position.x / s, z: pick.position.z / s }, b = { x: pick.target.x / s, z: pick.target.z / s };
    assert.equal(navigation.regionAt(a), navigation.regionAt(b));
    assert.ok(Math.hypot(pick.position.x - pick.target.x, pick.position.z - pick.target.z) >= RANDOM_START.minimumTravel);
    assert.ok(Math.hypot(pick.position.x - previous.x, pick.position.z - previous.z) >= RANDOM_START.minimumMove);
    assert.equal(navigation.blocked(a.x, a.z, navigation.radius + 0.2), false);
    assert.equal(navigation.blocked(b.x, b.z, navigation.radius + 0.2), false);
    assert.ok(navigation.route(a, b).length, 'the pair is connected for the old route search too');
    assert.ok(pick.yaw >= -Math.PI && pick.yaw < Math.PI);
    previous = pick.position;
  }
  console.log(`RESTART RANDOM at ${START}: 20/20, slowest pick ${slowest.toFixed(2)} ms`);
  assert.ok(slowest < 50, `slowest pick ${slowest} ms`);
});

test('RESTART RANDOM works up to the largest workable width and reports no room above it', () => {
  const widest = metrics.maxWorkableWidth;
  const above = Math.round((widest + 0.1) * 10) / 10;
  const random = seededRandom(9);
  const at = (width) => {
    const { navigation } = buildJunkyardCollision(data, width);
    return randomJunkyardStart({ navigation, scale: junkyardScale(width) }, { x: 1e6, z: 1e6 }, random);
  };
  assert.ok(at(widest), `a random pair exists at ${widest}`);
  assert.equal(at(above), null, `no random pair at ${above}`);
});
