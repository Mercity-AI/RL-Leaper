import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { nearestHit, resolveShot, sightDepth, spreadDirection, traceSight } from '../src/weapons/resolveShot.js';
import { CombatGeometry } from '../src/simulation/CombatGeometry.js';
import { TargetRegistry } from '../src/weapons/TargetRegistry.js';
import { Hitboxes } from '../src/weapons/Hitboxes.js';

// A map made of boxes, as the game's CombatGeometry sees it.
function world(...boxes) {
  const map = new THREE.Group();
  for (const { size, at } of boxes) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size));
    mesh.position.set(...at);
    map.add(mesh);
  }
  return new CombatGeometry(map);
}

// One enemy: a sphere of hit volume at `at`.
function targets(at, radius = 0.5) {
  const object = new THREE.Object3D();
  object.position.set(...at);
  object.updateMatrixWorld(true);
  const hitboxes = new Hitboxes([{ object, shape: 'sphere', a: new THREE.Vector3(), b: new THREE.Vector3(), radius, zone: 'body', multiplier: 1 }]);
  hitboxes.update();
  const registry = new TargetRegistry();
  const target = { raycast: (o, d, far) => hitboxes.raycast(o, d, far), applyHit: () => ({}) };
  registry.add(target);
  return { registry, target };
}

// The chase camera behind and above Lola, looking forward (-Z) over her.
const lola = new THREE.Vector3(0, 0, 0);
const anchor = new THREE.Vector3(0, 2.4, 0);
const camera = { origin: new THREE.Vector3(0, 3, 4), direction: new THREE.Vector3(0, 2.4 - 3, -4).normalize() };
const muzzle = new THREE.Vector3(0.15, 1.5, -0.3);

test('back to a wall: the sight starts at Lola, so she never fires backwards (review fix 5.5)', () => {
  // A wall right behind Lola, between her and the camera.
  const wall = world({ size: [10, 10, 0.1], at: [0, 2, 1.2] });
  // An enemy on the crosshair's line, ahead of her.
  const ahead = targets([0, 0.9, -10], 0.6);
  // From the lens, the wall behind her becomes the aim point and the bullet flies backwards...
  const fromLens = traceSight({ cameraRay: camera, near: 0, world: wall, targets: ahead.registry, range: 60 });
  assert.ok(fromLens.point.z > lola.z, 'the old lens trace aimed at the wall behind her');
  // ...but from Lola's depth the wall is skipped and the shot goes forward into the enemy.
  const near = sightDepth(camera, anchor);
  const shot = resolveShot({ cameraRay: camera, muzzle, near, world: wall, targets: ahead.registry, range: 60 });
  assert.ok(shot.direction.dot(camera.direction) > 0, 'forward');
  assert.equal(shot.hit?.kind, 'target', 'hits the enemy in front, not the wall');
  assert.equal(shot.backwards, false);
});

test('a Leaper leg between the camera and Lola can never become the aim point', () => {
  const behind = targets([0, 2.6, 2], 0.4);
  const near = sightDepth(camera, anchor);
  const shot = resolveShot({ cameraRay: camera, muzzle, near, world: world(), targets: behind.registry, range: 60 });
  assert.ok(shot.direction.dot(camera.direction) > 0);
  assert.equal(shot.hit, null, 'nothing in front: a clean miss to full range');
});

test('never backwards, whatever is around: 500 random scenes', () => {
  let seed = 7;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 500; i += 1) {
    const origin = new THREE.Vector3(random() * 10 - 5, 1 + random() * 3, random() * 10 - 5);
    const direction = new THREE.Vector3(random() - 0.5, (random() - 0.5) * 0.6, random() - 0.5).normalize();
    const gun = origin.clone().addScaledVector(direction, 1 + random() * 3).add(new THREE.Vector3(random() - 0.5, -random(), random() - 0.5));
    const cover = world({ size: [0.2 + random() * 4, 4, 0.2 + random() * 4], at: [origin.x + random() * 4 - 2, 2, origin.z + random() * 4 - 2] });
    const enemy = targets([origin.x + random() * 10 - 5, 2, origin.z + random() * 10 - 5], 0.3 + random());
    for (const near of [0, random() * 3]) {
      const shot = resolveShot({ cameraRay: { origin, direction }, muzzle: gun, near, world: cover, targets: enemy.registry, range: 60, spread: 0.01, random });
      assert.ok(shot.direction.dot(direction) > 0, `scene ${i}: the bullet flies along the view`);
    }
  }
});

test('when the aim point is behind the barrel the bullet flies along the camera view', () => {
  // Aiming straight at a wall that is behind the muzzle (the muzzle pokes through it).
  const wall = world({ size: [10, 10, 0.1], at: [0, 2, 0] });
  const ray = { origin: new THREE.Vector3(0, 1.5, 2), direction: new THREE.Vector3(0, 0, -1) };
  const shot = resolveShot({ cameraRay: ray, muzzle: new THREE.Vector3(0, 1.5, -0.5), world: wall, range: 60 });
  assert.equal(shot.backwards, true);
  assert.ok(shot.direction.distanceTo(ray.direction) < 1e-9);
});

test('cover in front of the enemy wins; the enemy is hit through clear air', () => {
  const enemy = targets([0, 1.6, -10]);
  const ray = { origin: new THREE.Vector3(0, 1.6, 2), direction: new THREE.Vector3(0, 0, -1) };
  const gun = new THREE.Vector3(0, 1.6, 0);
  const blocked = resolveShot({ cameraRay: ray, muzzle: gun, world: world({ size: [4, 4, 0.05], at: [0, 1.6, -5] }), targets: enemy.registry, range: 60 });
  assert.equal(blocked.hit.kind, 'world');
  assert.ok(Math.abs(blocked.end.z + 5) < 0.05, 'stops at the cover');
  const clear = resolveShot({ cameraRay: ray, muzzle: gun, world: world(), targets: enemy.registry, range: 60 });
  assert.equal(clear.hit.kind, 'target');
  assert.equal(clear.hit.hit.target, enemy.target, 'the registry says which enemy was hit');
  // Cover and a target exactly level: cover wins the tie.
  const tie = nearestHit({ hit: () => ({ distance: 3, point: new THREE.Vector3() }) },
    { raycast: () => ({ distance: 3, point: new THREE.Vector3() }) }, gun, ray.direction, 60);
  assert.equal(tie.kind, 'world');
});

test('OBSTRUCTED: low cover blocks the barrel though the crosshair sees over it', () => {
  const enemy = targets([0, 0.9, -10], 0.6);
  // A low wall: under the camera's sight line, in front of the gun.
  const lowWall = world({ size: [6, 1.6, 0.1], at: [0, 0.8, -2] });
  const near = sightDepth(camera, anchor);
  const shot = resolveShot({ cameraRay: camera, muzzle: new THREE.Vector3(0.15, 1.2, -0.3), near, world: lowWall,
    targets: enemy.registry, range: 60, tolerance: 0.3 });
  assert.equal(shot.obstructed, true);
  assert.ok(Math.abs(shot.blockPoint.z + 2) < 0.1, 'the marker sits on the cover');
  const open = resolveShot({ cameraRay: camera, muzzle: new THREE.Vector3(0.15, 1.2, -0.3), near, world: world(),
    targets: enemy.registry, range: 60, tolerance: 0.3 });
  assert.equal(open.obstructed, false);
  assert.equal(open.blockPoint, null);
  // Cover right at the aim point (within the tolerance) is the target itself, not an obstruction.
  const ray = { origin: new THREE.Vector3(0, 1.6, 2), direction: new THREE.Vector3(0, 0, -1) };
  const atTarget = resolveShot({ cameraRay: ray, muzzle: new THREE.Vector3(0, 1.4, 0), world: world({ size: [4, 4, 0.05], at: [0, 1.6, -5] }),
    range: 60, tolerance: 0.3 });
  assert.equal(atTarget.obstructed, false);
});

test('the crosshair decides: low cover in front of the barrel does not eat a shot the crosshair sees through', () => {
  const enemy = targets([0, 0.9, -10], 0.6);
  // A low wall under the camera's sight line but in front of the gun (the owner's container case).
  const lowWall = world({ size: [6, 1.6, 0.1], at: [0, 0.8, -2] });
  const near = sightDepth(camera, anchor);
  const shot = resolveShot({ cameraRay: camera, muzzle: new THREE.Vector3(0.15, 1.2, -0.3), near, world: lowWall,
    targets: enemy.registry, range: 60 });
  assert.equal(shot.hit?.kind, 'target', 'the enemy under the crosshair is hit');
  assert.ok(shot.origin.distanceTo(new THREE.Vector3(0.15, 1.2, -0.3)) < 1e-9, 'the tracer still leaves the barrel');
});

test('spread keeps each bullet inside its cone, and random = 0 goes dead centre', () => {
  const axis = new THREE.Vector3(0.3, 0.2, -1).normalize();
  assert.ok(spreadDirection(axis, 0.05, () => 0).distanceTo(axis) < 1e-12);
  let widest = 0;
  for (let i = 0; i < 2000; i += 1) widest = Math.max(widest, spreadDirection(axis, 0.05).angleTo(axis));
  assert.ok(widest <= 0.05 + 1e-9 && widest > 0.04, `widest ${widest}`);
  assert.ok(spreadDirection(axis, 0).equals(axis));
});
