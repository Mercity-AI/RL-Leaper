// RESTART RANDOM: a random Leaper start and destination (spawn selection only;
// the pair is never passed to the brain).
//
// The Leaper's grid knows its connected regions (labelled once at load), so a
// pair is "connected" when both cells carry the same label: no route search is
// needed, a pick takes well under a millisecond, and it only fails when no
// valid pair exists anywhere on the map at this size.

// Distances in world units (the map is scaled around the Leaper).
export const RANDOM_START = Object.freeze({
  // The destination is at least this far from the start, so a run is a real chase.
  minimumTravel: 10,
  // A new start is at least this far from where the Leaper stands now.
  minimumMove: 3,
});

// The cells of each region that are safe to start on (cached on the grid).
function spawnCellsByRegion(nav) {
  if (nav.spawnCells) return nav.spawnCells;
  const regions = nav.regions ?? nav.labelRegions();
  const spawnable = nav.spawnable ?? nav.markSpawnable();
  const lists = Array.from({ length: regions.count }, () => []);
  for (let i = 0; i < spawnable.length; i += 1) if (spawnable[i]) lists[regions.labels[i]].push(i);
  nav.spawnCells = lists;
  return lists;
}

// world: { navigation, scale }; previous: the Leaper's current position (world units).
// Returns { position, target, yaw } in world units, or null if no pair exists.
export function randomJunkyardStart(world, previous, random = Math.random) {
  const nav = world.navigation, scale = world.scale;
  const lists = spawnCellsByRegion(nav);
  const travel2 = (RANDOM_START.minimumTravel / scale) ** 2;
  // 1. Every safe cell far enough from where the Leaper is now may be the start.
  const starts = [];
  for (const list of lists) {
    for (const i of list) {
      const p = nav.point(i);
      if (Math.hypot(p.x * scale - previous.x, p.z * scale - previous.z) >= RANDOM_START.minimumMove) starts.push(i);
    }
  }
  // 2. Draw a start; keep it if its own region has a safe cell far enough away,
  //    otherwise drop it and draw again (so this always ends).
  let left = starts.length;
  while (left > 0) {
    const pick = Math.floor(random() * left);
    const startCell = starts[pick];
    const start = nav.point(startCell);
    const partners = lists[nav.regions.labels[startCell]].filter((i) => {
      const q = nav.point(i);
      return (q.x - start.x) ** 2 + (q.z - start.z) ** 2 >= travel2;
    });
    if (partners.length) {
      const target = nav.point(partners[Math.floor(random() * partners.length)]);
      return {
        position: { x: start.x * scale, z: start.z * scale },
        target: { x: target.x * scale, z: target.z * scale },
        yaw: random() * Math.PI * 2 - Math.PI,
      };
    }
    starts[pick] = starts[--left];
  }
  return null;
}

// Does this grid allow any random start at all (ignoring where the Leaper is
// now)? Used to find the largest workable Leaper size for the size slider.
export function hasRandomStart(nav, scale) {
  const travel2 = (RANDOM_START.minimumTravel / scale) ** 2;
  for (const list of spawnCellsByRegion(nav)) {
    for (let a = 0; a < list.length; a += 1) {
      const p = nav.point(list[a]);
      for (let b = a + 1; b < list.length; b += 1) {
        const q = nav.point(list[b]);
        if ((q.x - p.x) ** 2 + (q.z - p.z) ** 2 >= travel2) return true;
      }
    }
  }
  return false;
}
