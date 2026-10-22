// Props Lola may not walk into (owner, 2026-10-22: from inside the open
// container in the middle of the yard she could shoot the Leaper endlessly while
// it never saw or reached her). Only true hiding places are blocked: the owner
// keeps every container the Leaper can see into open as a shelter. Measured
// 2026-10-22 (Lola at every enclosed spot inside, the Leaper's eye at every
// place it can stand within sight range): these two have spots it sees from
// under 5% of those places; 03, 04, the bus and the van are seen from at least
// 15% (03: 15%, 04: 18%, van: 30%, bus: 40%) and stay open. Each prop's whole footprint becomes solid for
// Lola only: collision.json is untouched, so the Leaper's grid and the Python
// brain see exactly the yard they were trained on. Props are found by their
// Blender names (every part whose name starts with `prop`, like
// CLIMBABLE_PROPS); a new yard without one simply has no blocker for it.
export const PLAYER_BLOCKED_PROPS = Object.freeze([
  // The open container lying on its side by the central spill (rust inside):
  // its deep end is seen from 3-4% of the Leaper's places.
  '01 - central side-fallen freight',
  // The fallen container in the north-east corner (olive inside): its deep end,
  // against the yard's east wall, is seen from 1-5%.
  '06 - northeast fallen freight',
]);

// The loader writes spaces as underscores and drops dots.
const plain = (name) => name.replace(/_/g, ' ').replace(/\./g, '');

// Convex hull (counter-clockwise) of [x, z] points (Andrew's monotone chain).
export function convexHull(points) {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (sorted.length < 3) return sorted;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list) => {
    const out = [];
    for (const p of list) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };
  return [...half(sorted), ...half([...sorted].reverse())];
}

// A solid convex outline on the ground (counter-clockwise [x, z] corners).
export class Blocker {
  constructor(name, corners) {
    this.name = name;
    this.corners = corners;
  }

  // Where a disc of `radius` at (x, z) overlaps the outline: the unit normal
  // pointing out of it and the overlap depth, or null when clear (the same
  // answer JunkyardNavigation.contact gives for a wall).
  contact(x, z, radius) {
    const c = this.corners;
    let inside = true, best = null;
    for (let i = 0; i < c.length; i += 1) {
      const [ax, az] = c[i], [bx, bz] = c[(i + 1) % c.length];
      const ex = bx - ax, ez = bz - az, length = Math.hypot(ex, ez) || 1;
      // Outward normal of a counter-clockwise edge, and how far out (x, z) is.
      const nx = ez / length, nz = -ex / length;
      if ((x - ax) * nx + (z - az) * nz > 0) inside = false;
      const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / (length * length)));
      const px = ax + t * ex, pz = az + t * ez, distance = Math.hypot(x - px, z - pz);
      if (!best || distance < best.distance) best = { distance, px, pz, nx, nz };
    }
    if (inside) return { nx: best.nx, nz: best.nz, depth: radius + best.distance };
    if (best.distance >= radius) return null;
    const length = best.distance || 1;
    return { nx: (x - best.px) / length, nz: (z - best.pz) / length, depth: radius - best.distance };
  }
}

// The blockers of PLAYER_BLOCKED_PROPS in a loaded map, in map units (world
// units / scale, like the collision grids).
export function findPlayerBlockers(map, scale, props = PLAYER_BLOCKED_PROPS) {
  map.updateMatrixWorld(true);
  const blockers = [];
  for (const prop of props) {
    const points = [];
    map.traverse((object) => {
      if (!object.isMesh || !plain(object.name).startsWith(plain(prop))) return;
      const position = object.geometry.attributes.position, e = object.matrixWorld.elements;
      for (let i = 0; i < position.count; i += 1) {
        const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
        points.push([(e[0] * x + e[4] * y + e[8] * z + e[12]) / scale, (e[2] * x + e[6] * y + e[10] * z + e[14]) / scale]);
      }
    });
    if (points.length >= 3) blockers.push(new Blocker(prop, convexHull(points)));
  }
  return blockers;
}

// Lola's wall checks (map units) with the blockers added: blocked, contact
// (the deepest overlap wins) and surface (nothing to stand on inside one).
export function withPlayerBlockers(navigation, blockers) {
  if (!blockers.length) return navigation;
  const radius = navigation.radius;
  const hit = (x, z, r = radius) => blockers.some((blocker) => blocker.contact(x, z, r));
  return {
    radius,
    blocked: (x, z, r = radius) => hit(x, z, r) || navigation.blocked(x, z, r),
    contact(x, z, r = radius, above) {
      let deepest = navigation.contact(x, z, r, above);
      for (const blocker of blockers) {
        const touch = blocker.contact(x, z, r);
        if (touch && (!deepest || touch.depth > deepest.depth)) deepest = touch;
      }
      return deepest;
    },
    surface: (x, z, maxTop, r = radius) => (hit(x, z, r) ? null : navigation.surface(x, z, maxTop, r)),
  };
}
