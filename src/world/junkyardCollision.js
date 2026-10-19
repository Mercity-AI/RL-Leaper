import { ENCOUNTER } from '../config/encounter.js';
import { BODY_COLLISION_RADIUS, STANDING_HEIGHT } from '../config/robot.js';
import { JunkyardNavigation, packTriangles, triangleViews } from './JunkyardNavigation.js';

// The junkyard's flat collision grids, built from collision.json: one for the
// Leaper at the chosen size, one for Lola. Building them means parsing 5.9 MB
// of JSON and testing ~14,000 cells against ~85,000 triangles, so the page hands
// the job to a worker thread and keeps animating its loading screen meanwhile.
// collision.json itself stays exactly as it is: the Python brain service reads it.

// ---- Sizes (the real constants, shared by the game, the tools and the tests) ----

// The map is scaled around the fixed-size Leaper rig: a bigger Leaper means a
// smaller map (map units x scale = world units).
export function junkyardScale(width) {
  return BODY_COLLISION_RADIUS * 2 / width;
}

// The Leaper's grid at a clearance width: a disc of the full width, and every
// triangle lower than the robot's body (in map units) counts as a wall.
export function leaperGridSize(width) {
  return { radius: width / 2, height: (STANDING_HEIGHT + 1.5) / junkyardScale(width) };
}

// Lola's grid: her 0.25 m body circle; anything below her height blocks her.
export const PLAYER_GRID = Object.freeze({ radius: 0.25, height: 1.9 * ENCOUNTER.lolaHeight });

// Extra room (map units) a RESTART RANDOM start keeps from walls, covering the
// brain raster's conservative cell edges.
export const SPAWN_MARGIN = 0.2;

// Sizes the OPTIONS slider can ever offer (its step is 0.1).
export const WIDTH_LIMITS = Object.freeze({ min: 1.2, max: 8, step: 0.1 });

// ---- Building ----

// Both grids, the Leaper's connected regions and its safe spawn cells. Pure:
// the worker and the page fallback run exactly this, so both give one answer.
// report(share): optional progress after each step (for the loading bar).
export function buildJunkyardCollision(data, width, report = () => {}) {
  const leaper = leaperGridSize(width);
  const navigation = new JunkyardNavigation(data, leaper.radius, leaper.height);
  report(0.65);
  navigation.labelRegions();
  navigation.markSpawnable(SPAWN_MARGIN);
  report(0.8);
  const playerNavigation = new JunkyardNavigation(data, PLAYER_GRID.radius, PLAYER_GRID.height);
  return { navigation, playerNavigation };
}

// Typed-array form for the trip from the worker (moved, not copied).
export function packJunkyardCollision(data, { navigation, playerNavigation }) {
  const packed = { triangles: packTriangles(data.triangles), leaper: navigation.pack(), player: playerNavigation.pack() };
  const transfer = [packed.triangles.buffer,
    ...JunkyardNavigation.transferables(packed.leaper), ...JunkyardNavigation.transferables(packed.player)];
  return { packed, transfer };
}

// Back from the typed-array form: the same grids, sharing one triangle list.
export function unpackJunkyardCollision(packed) {
  const triangles = triangleViews(packed.triangles);
  return {
    navigation: JunkyardNavigation.fromPacked(packed.leaper, triangles),
    playerNavigation: JunkyardNavigation.fromPacked(packed.player, triangles),
  };
}
