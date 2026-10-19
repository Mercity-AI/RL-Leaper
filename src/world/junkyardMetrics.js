import { buildJunkyardCollision, junkyardScale, WIDTH_LIMITS } from './junkyardCollision.js';
import { hasRandomStart } from './randomJunkyardStart.js';

// Level metrics for the junkyard: how much of the yard a Leaper of a given
// clearance width can use, and the largest width that still allows a random
// start. scripts/assets/bake-junkyard-metrics.mjs writes them to
// assets/maps/junkyard/metrics.json (the size slider reads its maximum from
// there) and tests/world-map-metrics.test.js checks they are still true.
// All of this uses the conservative single-circle Leaper shape of the overlay,
// not the brain's 19-disc body, so it understates the brain's real room.

// The cell the game spawns the Leaper on: the clear cell nearest the yard centre.
const SPAWN_POINT = Object.freeze({ x: 0, z: 0 });

// Numbers for one width (round to keep the baked file readable).
export function measureJunkyard(data, width) {
  const { navigation: nav } = buildJunkyardCollision(data, width);
  const cells = nav.free.length;
  const free = nav.free.reduce((sum, value) => sum + value, 0);
  const spawnCell = nav.nearest(SPAWN_POINT);
  const spawnRegion = spawnCell < 0 ? 0 : nav.regions.sizes[nav.regions.labels[spawnCell]];
  const share = (value, total) => Math.round(value / Math.max(1, total) * 10000) / 10000;
  return {
    width,
    cells,
    freeCells: free,
    freeShareOfArena: share(free, cells),
    regions: nav.regions.count,
    largestRegionCells: Math.max(0, ...nav.regions.sizes),
    spawnRegionCells: spawnRegion,
    // What SHOW CLEARANCE reports as "Reachable from spawn".
    reachableShareOfFree: share(spawnRegion, free),
    reachableShareOfArena: share(spawnRegion, cells),
    spawnableCells: nav.spawnable.reduce((sum, value) => sum + value, 0),
    randomStartPossible: hasRandomStart(nav, junkyardScale(width)),
  };
}

// Can RESTART RANDOM find any pair at this width?
export function workableWidth(data, width) {
  const { navigation } = buildJunkyardCollision(data, width);
  return hasRandomStart(navigation, junkyardScale(width));
}

// The largest slider width (0.1 steps) at which RESTART RANDOM still works.
// Bigger Leapers only ever have less room, so a binary search over the steps is
// enough; the metrics test re-checks the answer and the step just above it.
export function largestWorkableWidth(data, { min = WIDTH_LIMITS.min, max = WIDTH_LIMITS.max, step = WIDTH_LIMITS.step } = {}) {
  const width = (k) => Math.round((min + k * step) * 1000) / 1000;
  let low = 0, high = Math.round((max - min) / step);
  if (!workableWidth(data, width(low))) return null;
  if (workableWidth(data, width(high))) return width(high);
  // Invariant: width(low) works, width(high) does not.
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (workableWidth(data, width(middle))) low = middle;
    else high = middle;
  }
  return width(low);
}
