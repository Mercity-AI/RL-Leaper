import * as THREE from 'three';
import { JunkyardNavigation } from './JunkyardNavigation.js';
import { PLAYER_GRID } from './junkyardCollision.js';

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
// JUNKYARD_PROP_COLOURS); a new yard without one simply has no blocker for it.
export const PLAYER_BLOCKED_PROPS = Object.freeze([
  // The open container lying on its side by the central spill (rust inside):
  // its deep end is seen from 3-4% of the Leaper's places.
  '01 - central side-fallen freight',
  // The fallen container in the north-east corner (olive inside): its deep end,
  // against the yard's east wall, is seen from 1-5%.
  '06 - northeast fallen freight',
]);

// Props Lola's body stays out of, from their own triangles: each part reaching
// above minTop is solid for her at every height up to her head, however low it
// is (nothing to step or jump onto), and she keeps bodyRadius (map units) from it.
//   Cars and racks (owner, 2026-10-30: she could stand half inside a car). Her
//   0.25 circle fits between their parts, and their sills, wheels and bonnets
//   were things she could step or jump onto, so her arms and legs went through
//   them. bodyRadius is about her shoulders; gaps wide enough for her stay open,
//   and so do the racks' low decks. The bus and the van stay open shelters.
//   Containers (owner, 2026-10-30: she never gets onto one). Their low edges are
//   no way up; she still walks in through their open ends on the flat floors.
export const PLAYER_SOLID_PROPS = Object.freeze([
  Object.freeze({ bodyRadius: 0.42, minTop: 0.35, names: Object.freeze(['blue_sedan', 'burgundy_hatchback',
    'car_rack_empty', 'car_rack_loaded_6', 'car_wreck_missing_hood', 'car_wreck_stripped_roof', 'car_station_wagon',
    'Rack - middle six cars']) }),
  Object.freeze({ bodyRadius: PLAYER_GRID.radius, minTop: 0.35, names: Object.freeze(['01 - central side-fallen freight',
    '02 - central angled collapse', '03 - southern fallen freight', '04 - southern overturned freight',
    '05 - west processing spill', '06 - northeast fallen freight']) }),
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

// A blocker made of props' own triangles (their outline may have gaps she can
// use). They live in one small grid; bodyRadius replaces the radius asked about,
// so the check is her body's and not her thin collision circle.
export class SolidProps {
  constructor(triangles, bodyRadius) {
    this.name = 'solid props';
    this.bodyRadius = bodyRadius;
    const far = 1e4;
    this.grid = new JunkyardNavigation({ bounds: { minX: -far, maxX: far, minZ: -far, maxZ: far }, triangles },
      bodyRadius, PLAYER_GRID.height, 0.4, { free: new Uint8Array(0) });
  }

  contact(x, z) {
    return this.grid.contact(x, z, this.bodyRadius, 0);
  }
}

// One entry's triangles in a loaded map, in map units, as collision.json has
// them: [ax, az, bx, bz, cx, cz, lowest, highest].
function propTriangles(map, scale, { names, minTop }) {
  const wanted = names.map(plain), triangles = [];
  const corner = new THREE.Vector3();
  map.traverse((object) => {
    if (!object.isMesh) return;
    const name = plain(object.name);
    if (!wanted.some((prop) => name === prop || name.startsWith(`${prop} `))) return;
    const position = object.geometry.attributes.position, index = object.geometry.index;
    const count = index ? index.count : position.count;
    for (let i = 0; i + 2 < count; i += 3) {
      const t = [0, 0, 0, 0, 0, 0, Infinity, -Infinity];
      for (let k = 0; k < 3; k += 1) {
        corner.fromBufferAttribute(position, index ? index.getX(i + k) : i + k).applyMatrix4(object.matrixWorld).divideScalar(scale);
        t[k * 2] = corner.x;
        t[k * 2 + 1] = corner.z;
        t[6] = Math.min(t[6], corner.y);
        t[7] = Math.max(t[7], corner.y);
      }
      if (t[7] > minTop) triangles.push(t);
    }
  });
  return triangles;
}

// The solid props of a loaded map as blockers (a new yard without them has none).
export function findSolidProps(map, scale, props = PLAYER_SOLID_PROPS) {
  map.updateMatrixWorld(true);
  return props.flatMap((entry) => {
    const triangles = propTriangles(map, scale, entry);
    return triangles.length ? [new SolidProps(triangles, entry.bodyRadius)] : [];
  });
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
