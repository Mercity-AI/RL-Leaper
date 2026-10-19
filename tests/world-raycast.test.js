import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { prepareJunkyardMap } from '../src/world/createJunkyardWorld.js';
import { CombatGeometry } from '../src/simulation/CombatGeometry.js';
import { BODY_COLLISION_RADIUS } from '../src/config/robot.js';
import { ENCOUNTER } from '../src/config/encounter.js';
import { loadGlb, seededRandom } from './world-helpers.js';

// The fast ray hierarchy (three-mesh-bvh) must give exactly the same answers as
// three.js's plain triangle-by-triangle test on the real junkyard export: same
// first hit, same distance, same point and the same surface normal, for every
// kind of ray the game casts (bullets, bolts, sight lines, camera probes).

const MAP = 'assets/maps/junkyard/junkyard.glb';
const scale = BODY_COLLISION_RADIUS * 2 / ENCOUNTER.startWidth;

// Both copies of the map, prepared the way the game prepares it; only one of them
// gets the hierarchy. Each gets the same CombatGeometry the combat code uses.
async function maps() {
  const plain = (await loadGlb(MAP)).scene;
  const fast = (await loadGlb(MAP)).scene;
  prepareJunkyardMap(plain, scale, { accelerate: false });
  prepareJunkyardMap(fast, scale);
  return { plain: new CombatGeometry(plain), fast: new CombatGeometry(fast) };
}

// A random ray inside the yard: anywhere over the floor, from ankle to roof
// height, mostly level with some up and down, 1 to 90 units long.
function randomRay(random) {
  const origin = new THREE.Vector3((random() * 50 - 25) * scale, (0.05 + random() * 6) * scale, (random() * 46 - 23) * scale);
  const direction = new THREE.Vector3(random() * 2 - 1, random() * 1.1 - 0.7, random() * 2 - 1).normalize();
  return { origin, direction, distance: 1 + random() * 89 };
}

test('fast map rays hit exactly what the plain test hits (5,000 random rays)', async () => {
  const { plain, fast } = await maps();
  assert.ok(fast.meshes.every(mesh => mesh.geometry.boundsTree), 'every map mesh has a hierarchy');
  assert.ok(plain.meshes.every(mesh => !mesh.geometry.boundsTree), 'the reference copy has none');
  const random = seededRandom(7);
  const rays = Array.from({ length: 5000 }, () => randomRay(random));
  let hits = 0, ties = 0;
  for (const [i, { origin, direction, distance }] of rays.entries()) {
    const a = plain.hit(origin, direction, distance);
    const b = fast.hit(origin, direction, distance);
    assert.equal(Boolean(b), Boolean(a), `ray ${i}: hit / miss differs`);
    if (!a) continue;
    hits += 1;
    assert.equal(fast.meshes.indexOf(b.object), plain.meshes.indexOf(a.object), `ray ${i}: different mesh`);
    assert.ok(Math.abs(a.distance - b.distance) < 1e-6, `ray ${i}: distance ${a.distance} vs ${b.distance}`);
    assert.ok(a.point.distanceTo(b.point) < 1e-6, `ray ${i}: hit point differs`);
    if (a.face.normal.distanceTo(b.face.normal) < 1e-6) continue;
    // The only allowed difference: a wall modelled as two faces in exactly the
    // same place, back to back. Both are "the first hit" at the same distance and
    // either answer is right; the plain test must also have found the other face.
    plain.raycaster.set(origin, direction);
    const twins = plain.raycaster.intersectObjects(plain.meshes, false)
      .filter(hit => hit.object === a.object && Math.abs(hit.distance - a.distance) < 1e-9);
    assert.ok(twins.some(hit => hit.face.normal.distanceTo(b.face.normal) < 1e-6), `ray ${i}: surface normal differs`);
    ties += 1;
  }
  assert.ok(hits > 1500, `enough rays hit something to mean anything (${hits})`);
  assert.ok(ties < hits * 0.01, `back-to-back face ties stay rare (${ties})`);
  console.log(`${hits} of ${rays.length} rays hit the map; ${ties} landed on back-to-back twin faces`);
});

test('the camera blocker pass (every hit, not just the first) finds the same meshes', async () => {
  const { plain, fast } = await maps();
  const random = seededRandom(11);
  for (let i = 0; i < 1000; i += 1) {
    const { origin, direction } = randomRay(random);
    const far = (2 + random() * 10) * scale;
    const all = (geometry) => {
      geometry.raycaster.set(origin, direction);
      geometry.raycaster.near = 0;
      geometry.raycaster.far = far;
      return geometry.raycaster.intersectObjects(geometry.meshes, false);
    };
    const a = all(plain), b = all(fast);
    const meshes = (list, geometry) => [...new Set(list.map(hit => geometry.meshes.indexOf(hit.object)))].sort((x, y) => x - y);
    assert.deepEqual(meshes(b, fast), meshes(a, plain), `ray ${i}: blocker set differs`);
    assert.equal(b.length, a.length, `ray ${i}: hit count differs`);
    a.forEach((hit, k) => assert.ok(Math.abs(hit.distance - b[k].distance) < 1e-6, `ray ${i}: hit ${k} distance`));
  }
});

test('fast map rays are much quicker (timing report)', async () => {
  const { plain, fast } = await maps();
  const random = seededRandom(3);
  const rays = Array.from({ length: 2000 }, () => randomRay(random));
  // One timed round: milliseconds per ray over all 2,000 rays.
  const time = (geometry) => {
    const start = performance.now();
    for (const { origin, direction, distance } of rays) geometry.hit(origin, direction, distance);
    return (performance.now() - start) / rays.length;
  };
  // Warm both up, then keep each one's best of five alternating rounds. The other
  // test files run at the same time, and a busy moment can only make a round
  // slower, never faster; a single round of the quick (~20 ms) loop could
  // otherwise lose the race to one hiccup and fail for no real reason.
  for (const { origin, direction, distance } of rays.slice(0, 100)) {
    plain.hit(origin, direction, distance);
    fast.hit(origin, direction, distance);
  }
  let before = Infinity, after = Infinity;
  for (let round = 0; round < 5; round += 1) {
    before = Math.min(before, time(plain));
    after = Math.min(after, time(fast));
  }
  console.log(`map ray: ${before.toFixed(4)} ms brute force -> ${after.toFixed(4)} ms with the hierarchy (${(before / after).toFixed(1)}x)`);
  assert.ok(after * 3 < before, `the hierarchy should be at least 3x faster (${before} vs ${after} ms)`);
});
