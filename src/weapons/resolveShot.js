import * as THREE from 'three';

// Where a hitscan bullet goes, as pure maths (no page, no game objects), so it
// can be tested in Node. Two rays, as in most third-person shooters:
//   1. the sight ray, through the screen-centre crosshair, finds the point the
//      player is aiming at;
//   2. the muzzle ray, from the gun's barrel to that point, decides what the
//      bullet really hits (so nearby cover wins over the crosshair's target).
// The sight ray starts at Lola's depth along the camera ray, not at the lens:
// anything between the chase camera and Lola (a wall at her back, a Leaper leg
// behind her) can never become the aim point, so she never fires backwards
// (review fix 5.5).
//
// The "world" and "targets" passed in only need a raycast:
//   world.hit(origin, direction, far)        -> { distance, point?, face?, object? } | null
//   targets.raycast(origin, direction, far)  -> { distance, point, normal, ... } | null

const UP = new THREE.Vector3(0, 1, 0);
const SIDE = new THREE.Vector3(1, 0, 0);

// How far along the camera ray Lola sits: the sight trace starts there.
// anchor: the point on Lola the chase camera looks over (null = start at the lens).
export function sightDepth(cameraRay, anchor) {
  if (!anchor) return 0;
  const toAnchor = new THREE.Vector3().subVectors(anchor, cameraRay.origin);
  return Math.max(0, toAnchor.dot(cameraRay.direction));
}

// The nearest of a world (cover) hit and a target hit along one ray, or null.
// The result says which it was: { distance, point, kind: 'world' | 'target', hit }.
export function nearestHit(world, targets, origin, direction, far) {
  const cover = world?.hit(origin, direction, far) ?? null;
  const target = targets?.raycast(origin, direction, far) ?? null;
  const coverDistance = cover?.distance ?? Infinity;
  const targetDistance = target?.distance ?? Infinity;
  if (coverDistance === Infinity && targetDistance === Infinity) return null;
  // Cover wins ties: a bullet never reaches a target through a blocking triangle.
  const kind = targetDistance < coverDistance ? 'target' : 'world';
  const hit = kind === 'target' ? target : cover;
  const distance = kind === 'target' ? targetDistance : coverDistance;
  const point = hit.point?.clone?.() ?? origin.clone().addScaledVector(direction, distance);
  return { distance, point, kind, hit };
}

// The point under the crosshair: trace from `near` along the camera ray.
// Returns { start, point, distance, hit } (distance measured from start).
export function traceSight({ cameraRay, near = 0, world, targets, range }) {
  const start = cameraRay.origin.clone().addScaledVector(cameraRay.direction, near);
  const hit = nearestHit(world, targets, start, cameraRay.direction, range);
  const distance = hit?.distance ?? range;
  return { start, point: start.clone().addScaledVector(cameraRay.direction, distance), distance, hit };
}

// A direction inside a cone of half-angle `angle` around `axis` (uniform over the
// cone's disc). random() returns [0, 1); random = () => 0 gives the axis itself.
export function spreadDirection(axis, angle, random = Math.random) {
  if (!(angle > 0)) return axis.clone();
  const helper = Math.abs(axis.dot(UP)) > 0.9 ? SIDE : UP;
  const right = new THREE.Vector3().crossVectors(axis, helper).normalize();
  const up = new THREE.Vector3().crossVectors(right, axis).normalize();
  const radius = Math.tan(angle) * Math.sqrt(random());
  const turn = 2 * Math.PI * random();
  return axis.clone()
    .addScaledVector(right, Math.cos(turn) * radius)
    .addScaledVector(up, Math.sin(turn) * radius)
    .normalize();
}

// Resolve one shot (or, with spread 0, just ask "would a shot now be blocked?").
//   cameraRay   { origin, direction }: the screen-centre ray (direction normalised)
//   muzzle      the barrel's tip in world space
//   near        how far along the camera ray the sight trace starts (sightDepth)
//   world       the cover to test (CombatGeometry)
//   targets     the enemies to test (TargetRegistry), or null
//   range       furthest a bullet reaches
//   spread      cone half-angle for this bullet; random: the random source
//   tolerance   cover must stop the muzzle ray at least this far short of the aim
//               point before the shot counts as obstructed
// Returns:
//   aimPoint    the point under the crosshair
//   origin      where the bullet starts (the muzzle)
//   direction   where it flies (spread applied)
//   hit         nearestHit() result for the bullet, or null (a miss to full range)
//   end         where the bullet stops (the hit point, or the end of its range)
//   backwards   the aim point was not in front of the muzzle, so the bullet flew
//               straight along the camera's forward direction instead
//   obstructed  cover would stop the bullet clearly short of the aim point
//   blockPoint  where that cover is (null when not obstructed)
export function resolveShot({
  cameraRay, muzzle, near = 0, world, targets = null, range,
  spread = 0, random = Math.random, tolerance = 0,
}) {
  // 1. The aim point, from Lola's depth along the camera ray.
  const sight = traceSight({ cameraRay, near, world, targets, range });
  // 2. Toward it from the muzzle, but never backwards: if the point is not in front
  //    of the barrel along the camera's view, fly along the view instead.
  const toAim = sight.point.clone().sub(muzzle);
  const ahead = toAim.dot(cameraRay.direction);
  const backwards = !(ahead > 1e-6) || toAim.lengthSq() < 1e-12;
  const intended = backwards ? cameraRay.direction.clone() : toAim.normalize();
  const direction = spreadDirection(intended, spread, random);
  // 3. What the bullet hits.
  const hit = nearestHit(world, targets, muzzle, direction, range);
  const end = hit ? hit.point.clone() : muzzle.clone().addScaledVector(direction, range);
  // 4. Obstruction: does cover stop the straight (unspread) muzzle ray before the
  //    aim point? (Another part of a target in the way is not "cover".)
  const straight = spread > 0 ? nearestHit(world, targets, muzzle, intended, range) : hit;
  const reach = backwards ? 0 : muzzle.distanceTo(sight.point);
  const obstructed = !backwards && straight?.kind === 'world' && straight.distance < reach - tolerance;
  return {
    aimPoint: sight.point, origin: muzzle.clone(), direction, hit, end, backwards,
    obstructed, blockPoint: obstructed ? straight.point.clone() : null,
  };
}
