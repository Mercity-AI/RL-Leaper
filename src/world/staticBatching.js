import * as THREE from 'three';

// Fewer draw calls for the map. The junkyard is ~100 separate meshes, and 91 of
// them share one material; the graphics card draws each mesh separately (twice:
// once for the picture, once for the sun's shadow). Here map meshes with the
// same material and shadow settings that stand in the same patch of the yard
// are copied into one combined mesh ("batch") that draws in a single call, and
// the originals are hidden.
//
// Why patches and not one batch per material: the graphics card skips anything
// outside the camera's view (and outside the sun's shadow box) mesh by mesh. One
// batch for the whole yard would always be "in view", so every one of the map's
// ~98,000 triangles would be drawn twice a frame. A batch per patch keeps that
// skipping working while still cutting the draw calls.
//
// The originals stay in the map, untouched, for everything that isn't drawing:
// bullets, bolts and the camera still ray-test them (with their fast ray
// hierarchy), and nothing about collision changes. Batches themselves never
// take part in ray tests. One drawing feature needs the originals: when cover
// blocks the camera, CameraOcclusion fades that one prop by swapping its
// material for a see-through copy just before the frame. So, for any frame
// where a batched prop wears a different material than it was batched with,
// that prop's batch steps aside and its original meshes draw instead. That
// keeps the fade exactly as it was, prop by prop.

// Designer/performance tunables.
export const STATIC_BATCHING = Object.freeze({
  // Side of one yard patch, in map units before scaling (the map is ~48 x 45
  // map units, so 8 gives about 6 x 6 patches). Smaller patches = more draw
  // calls but fewer out-of-view triangles drawn; larger = the reverse. At the
  // default Leaper size, 8 cuts ~18% of all draw calls for ~28% more triangles
  // (12: -23% calls, +67% triangles; one batch for the whole yard: +118%).
  cellSize: 8,
  // Meshes bigger than this (bounding radius, map units) stay on their own:
  // they would stretch a patch's bounds far beyond the patch.
  maxMemberRadius: 8,
});

// Can these meshes share one combined geometry? Same material, same shadow
// flags, same set of vertex attributes (and kinds), all indexed or none.
function batchKey(mesh) {
  const geometry = mesh.geometry;
  const attributes = Object.entries(geometry.attributes)
    .map(([name, a]) => `${name}:${a.itemSize}:${a.normalized}:${a.array.constructor.name}`).sort().join(',');
  return [mesh.material.uuid, mesh.castShadow, mesh.receiveShadow, Boolean(geometry.index), attributes,
    Object.keys(geometry.morphAttributes).length].join('|');
}

// Read one component of an attribute (interleaved or not), without
// three.js's newer helpers (r128 has getX..getW only).
function component(attribute, i, k) {
  return [attribute.getX, attribute.getY, attribute.getZ, attribute.getW][k].call(attribute, i);
}

// One mesh's geometry in the batch's space (world units): positions moved,
// normals turned; triangles reversed if the mesh was mirrored, so their front
// faces still face out.
function bakedCopy(mesh) {
  const copy = new THREE.BufferGeometry();
  for (const [name, attribute] of Object.entries(mesh.geometry.attributes)) {
    const { itemSize, normalized, count } = attribute;
    const array = new attribute.array.constructor(count * itemSize);
    for (let i = 0; i < count; i += 1) {
      for (let k = 0; k < itemSize; k += 1) array[i * itemSize + k] = component(attribute, i, k);
    }
    copy.setAttribute(name, new THREE.BufferAttribute(array, itemSize, normalized));
  }
  if (mesh.geometry.index) copy.setIndex(Array.from(mesh.geometry.index.array));
  copy.applyMatrix4(mesh.matrixWorld);
  if (mesh.matrixWorld.determinant() < 0 && copy.index) {
    const index = copy.index.array;
    for (let i = 0; i < index.length; i += 3) [index[i + 1], index[i + 2]] = [index[i + 2], index[i + 1]];
  }
  return copy;
}

// Stack several baked copies into one geometry (indices shifted per copy).
function stack(copies) {
  const merged = new THREE.BufferGeometry();
  const vertexCount = copies.reduce((sum, g) => sum + g.attributes.position.count, 0);
  for (const name of Object.keys(copies[0].attributes)) {
    const first = copies[0].attributes[name];
    const array = new first.array.constructor(vertexCount * first.itemSize);
    let offset = 0;
    for (const g of copies) { array.set(g.attributes[name].array, offset); offset += g.attributes[name].array.length; }
    merged.setAttribute(name, new THREE.BufferAttribute(array, first.itemSize, first.normalized));
  }
  if (copies[0].index) {
    const total = copies.reduce((sum, g) => sum + g.index.count, 0);
    const index = new (vertexCount > 65535 ? Uint32Array : Uint16Array)(total);
    let offset = 0, base = 0;
    for (const g of copies) {
      for (let i = 0; i < g.index.count; i += 1) index[offset + i] = g.index.array[i] + base;
      offset += g.index.count;
      base += g.attributes.position.count;
    }
    merged.setIndex(new THREE.BufferAttribute(index, 1));
  }
  merged.computeBoundingSphere();
  merged.computeBoundingBox();
  return merged;
}

// Which yard patch a mesh belongs to (by the centre of its bounding ball), and
// whether it is small enough to join one at all.
const centre = new THREE.Vector3();
function patchOf(mesh, cellSize, maxRadius) {
  const geometry = mesh.geometry;
  if (!geometry.boundingSphere) geometry.computeBoundingSphere();
  const radius = geometry.boundingSphere.radius * mesh.matrixWorld.getMaxScaleOnAxis();
  if (radius > maxRadius) return null;
  centre.copy(geometry.boundingSphere.center).applyMatrix4(mesh.matrixWorld);
  return `${Math.floor(centre.x / cellSize)},${Math.floor(centre.z / cellSize)}`;
}

// Batch the map's static meshes. scale: the map's scale (patch sizes grow with
// it). Returns { group, batches, dispose(), stats }: add `group` to the scene
// (its meshes are in world units, no transform).
export function batchStaticMeshes(map, scene, { scale = 1, cellSize = STATIC_BATCHING.cellSize,
  maxMemberRadius = STATIC_BATCHING.maxMemberRadius } = {}) {
  // 1. Group the map's meshes by material and yard patch (only plain, visible
  //    meshes with one material).
  map.updateMatrixWorld(true);
  const groups = new Map();
  map.traverse((object) => {
    if (!object.isMesh || object.isSkinnedMesh || object.isInstancedMesh || Array.isArray(object.material) || !object.visible) return;
    // Props made of several parts (the cars: body, windows, lights...) stay as
    // they are: their parts sit within millimetres of each other, and moving
    // some parts into a batch could make windows flicker through the body.
    if (object.parent !== map && object.parent.children.filter((child) => child.isMesh).length > 1) return;
    const patch = patchOf(object, cellSize * scale, maxMemberRadius * scale);
    if (patch === null) return;
    const key = `${batchKey(object)}|${patch}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(object);
  });
  // 2. One combined mesh per group of two or more; the originals are hidden.
  //    A batch is drawn (and skipped when out of view) like any mesh, but rays
  //    pass straight through it: they test the originals instead.
  const group = new THREE.Group();
  group.name = 'map-batches';
  const batches = [];
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const copies = members.map(bakedCopy);
    const mesh = new THREE.Mesh(stack(copies), members[0].material);
    copies.forEach((copy) => copy.dispose());
    mesh.name = `batch:${members[0].material.name || members[0].material.type}`;
    mesh.castShadow = members[0].castShadow;
    mesh.receiveShadow = members[0].receiveShadow;
    mesh.matrixAutoUpdate = false;
    mesh.raycast = () => {};
    group.add(mesh);
    for (const member of members) member.visible = false;
    batches.push({ mesh, originals: members, swapped: false });
  }
  // 3. Around every draw of the scene: a batch with a member that wears another
  //    material than the batch itself (a camera fade) steps aside for its
  //    originals, then everything is put back.
  const before = scene.onBeforeRender, after = scene.onAfterRender;
  scene.onBeforeRender = function (...args) {
    before.apply(this, args);
    for (const batch of batches) {
      batch.swapped = batch.originals.some((mesh) => mesh.material !== batch.mesh.material);
      if (!batch.swapped) continue;
      batch.mesh.visible = false;
      for (const mesh of batch.originals) mesh.visible = true;
    }
  };
  scene.onAfterRender = function (...args) {
    for (const batch of batches) {
      if (!batch.swapped) continue;
      batch.mesh.visible = true;
      for (const mesh of batch.originals) mesh.visible = false;
      batch.swapped = false;
    }
    after.apply(this, args);
  };
  // 4. Undo: originals shown again, hooks removed, combined geometry freed.
  const dispose = () => {
    scene.onBeforeRender = before;
    scene.onAfterRender = after;
    for (const batch of batches) {
      for (const mesh of batch.originals) mesh.visible = true;
      batch.mesh.geometry.dispose();
    }
    group.parent?.remove(group);
  };
  const stats = { meshes: batches.reduce((sum, b) => sum + b.originals.length, 0), batches: batches.length };
  return { group, batches, dispose, stats };
}
