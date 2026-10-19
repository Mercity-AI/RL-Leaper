import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { prepareJunkyardMap } from '../src/world/createJunkyardWorld.js';
import { batchStaticMeshes, STATIC_BATCHING } from '../src/world/staticBatching.js';
import { junkyardScale } from '../src/world/junkyardCollision.js';
import { limitShadowCasters, QUALITY_PRESETS } from '../src/core/Quality.js';
import { MAP_URL } from '../src/core/Assets.js';
import { ENCOUNTER } from '../src/config/encounter.js';
import { loadGlb } from './world-helpers.js';

// Static batching: the map's meshes are drawn as a few combined meshes per yard
// patch. The picture must not change: the same triangles in the same places
// with the same materials and shadow flags; the originals stay for rays, and a
// camera fade still works prop by prop.

const scale = junkyardScale(ENCOUNTER.startWidth);
// The compressed copy the game loads (assets/build/maps/junkyard.glb).
const MAP = 'assets/build/maps/junkyard.glb';
assert.ok(MAP_URL.endsWith(MAP), 'this is the file the game loads');

// The map as the game prepares it at the default Leaper size, batched.
async function batchedMap({ quality = QUALITY_PRESETS.high } = {}) {
  const map = (await loadGlb(MAP)).scene;
  const { floor } = prepareJunkyardMap(map, scale, { accelerate: false });
  limitShadowCasters(map, quality.shadowMinSize, { keep: [floor] });
  const scene = new THREE.Scene();
  scene.add(map);
  const batching = batchStaticMeshes(map, scene, { scale });
  scene.add(batching.group);
  return { map, scene, batching };
}

// Compare one batch with the meshes it replaced, triangle by triangle: the
// members are stacked in order, so member k's corner i is the batch's corner
// (k's offset + i), moved into world space. A mirrored member's triangles are
// stored the other way round (three.js draws mirrored meshes inside out, the
// batch has no mirror), so its second and third corners swap. Returns how many
// triangles matched.
function compareTriangles(batch, originals) {
  const merged = batch.geometry.attributes.position, mergedIndex = batch.geometry.index;
  const expected = new THREE.Vector3(), actual = new THREE.Vector3();
  let vertexBase = 0, indexBase = 0, worst = 0;
  for (const original of originals) {
    const position = original.geometry.attributes.position, index = original.geometry.index;
    const mirrored = original.matrixWorld.determinant() < 0;
    for (let i = 0; i < index.count; i += 1) {
      const corner = i % 3 === 0 || !mirrored ? i : i - (i % 3) + (3 - (i % 3));
      assert.equal(mergedIndex.getX(indexBase + i), index.getX(corner) + vertexBase, `${original.name} corner ${i}`);
    }
    for (let i = 0; i < position.count; i += 1) {
      expected.fromBufferAttribute(position, i).applyMatrix4(original.matrixWorld);
      actual.fromBufferAttribute(merged, vertexBase + i);
      worst = Math.max(worst, expected.distanceTo(actual));
    }
    vertexBase += position.count;
    indexBase += index.count;
  }
  assert.equal(vertexBase, merged.count, 'no extra or missing corners');
  assert.equal(indexBase, mergedIndex.count, 'no extra or missing triangles');
  assert.ok(worst < 1e-4, `every corner within 0.1 mm of where its mesh put it (worst ${worst.toExponential(1)})`);
  return indexBase / 3;
}

test('batches draw exactly the triangles of the meshes they replace', async () => {
  const { batching } = await batchedMap();
  assert.ok(batching.batches.length >= 10, `several patches (${batching.batches.length} batches)`);
  assert.ok(batching.stats.meshes >= 60, `many map meshes are batched (${batching.stats.meshes})`);
  let triangles = 0;
  for (const { mesh, originals } of batching.batches) {
    assert.ok(originals.every((original) => original.geometry.index), 'the exported props are indexed');
    triangles += compareTriangles(mesh, originals);
    // Same look: one material, same shadow flags, all originals hidden.
    for (const original of originals) {
      assert.equal(original.material, mesh.material);
      assert.equal(original.castShadow, mesh.castShadow);
      assert.equal(original.receiveShadow, mesh.receiveShadow);
      assert.equal(original.visible, false);
    }
  }
  // junkyard_v2 batches ~30,000 of its triangles: most of its props are made of
  // several parts, which stay unbatched (see staticBatching.js).
  assert.ok(triangles > 20000, `${triangles} triangles compared`);
});

test('surface normals are turned with their mesh', async () => {
  const { batching } = await batchedMap();
  const normal = new THREE.Vector3(), matrix = new THREE.Matrix3();
  for (const { mesh, originals } of batching.batches.slice(0, 4)) {
    let offset = 0;
    for (const original of originals) {
      matrix.getNormalMatrix(original.matrixWorld);
      const source = original.geometry.attributes.normal;
      for (let i = 0; i < source.count; i += 37) {
        normal.fromBufferAttribute(source, i).applyMatrix3(matrix).normalize();
        const merged = new THREE.Vector3().fromBufferAttribute(mesh.geometry.attributes.normal, offset + i).normalize();
        assert.ok(merged.distanceTo(normal) < 1e-4, `${original.name} normal ${i}`);
      }
      offset += original.geometry.attributes.position.count;
    }
  }
});

test('patches stay local, big meshes and multi-part props stay on their own', async () => {
  const { map, batching } = await batchedMap();
  const limit = (STATIC_BATCHING.cellSize * Math.SQRT2 / 2 + STATIC_BATCHING.maxMemberRadius) * scale;
  for (const { mesh } of batching.batches) {
    assert.ok(mesh.geometry.boundingSphere.radius <= limit + 1e-6,
      `${mesh.name} reaches ${mesh.geometry.boundingSphere.radius.toFixed(1)} units (limit ${limit.toFixed(1)})`);
  }
  const batched = new Set(batching.batches.flatMap(({ originals }) => originals));
  map.traverse((object) => {
    if (!object.isMesh || batched.has(object)) return;
    assert.equal(object.visible, true, `${object.name} is not batched, so it still draws itself`);
  });
  const floor = map.getObjectByName('Cube');
  assert.ok(!batched.has(floor), 'the floor and walls stay one mesh');
  const car = map.getObjectByName('blue_sedan');
  car.traverse((part) => { if (part.isMesh) assert.ok(!batched.has(part), `${part.name} (car part) is not batched`); });
});

test('rays pass through batches; the hidden originals still answer them', async () => {
  const { map, scene, batching } = await batchedMap();
  const raycaster = new THREE.Raycaster(new THREE.Vector3(0, 30 * scale, 0), new THREE.Vector3(0, -1, 0));
  const hits = raycaster.intersectObjects([scene], true);
  assert.ok(hits.length > 0, 'the floor is hit');
  assert.ok(hits.every(({ object }) => !batching.group.children.includes(object)), 'no batch is ever hit');
  // Every batched original is still in the map (rays and the camera test them).
  for (const { originals } of batching.batches) {
    for (const original of originals) assert.ok(map.getObjectById(original.id), original.name);
  }
});

test('a camera fade on one prop makes its batch step aside for that frame only', async () => {
  const { scene, batching } = await batchedMap();
  const batch = batching.batches[0];
  const faded = batch.originals[0];
  const original = faded.material;
  faded.material = original.clone();
  scene.onBeforeRender(null, scene, null, null);
  assert.equal(batch.mesh.visible, false, 'the batch steps aside');
  assert.ok(batch.originals.every((mesh) => mesh.visible), 'its originals draw (one of them faded)');
  assert.ok(batching.batches.slice(1).every(({ mesh }) => mesh.visible), 'other batches are untouched');
  scene.onAfterRender(null, scene, null, null);
  assert.equal(batch.mesh.visible, true);
  assert.ok(batch.originals.every((mesh) => !mesh.visible), 'and everything is put back after the frame');
  faded.material = original;
  scene.onBeforeRender(null, scene, null, null);
  assert.equal(batch.mesh.visible, true, 'no fade, no step aside');
  scene.onAfterRender(null, scene, null, null);
});

test('dispose() shows the originals again and unhooks the scene', async () => {
  const { scene, batching } = await batchedMap();
  const hooked = scene.onBeforeRender;
  batching.dispose();
  assert.notEqual(scene.onBeforeRender, hooked);
  assert.equal(batching.group.parent, null);
  assert.ok(batching.batches.every(({ originals }) => originals.every((mesh) => mesh.visible)));
});
