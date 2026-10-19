import * as THREE from 'three';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh';

// Fast rays against the map. Bullets, laser bolts, the Leaper's line of fire and
// the camera boom all ask "what does this ray hit first?". Without help, three.js
// tests every one of the map's ~98,000 triangles for each ray. A bounding-volume
// hierarchy (three-mesh-bvh) sorts the triangles into nested boxes once at load,
// so a ray only looks at the few triangles near its path. The answers are the
// same; only the time changes (see tests/world-raycast.test.js).

// The plain three.js ray test, kept for meshes without a hierarchy and for tests.
export const bruteForceRaycast = THREE.Mesh.prototype.raycast;

// 1. The fast test for one mesh. A cheap check comes first: a ray that misses
//    the mesh's bounding ball, or only reaches it beyond the ray's length, can't
//    hit it, so the hierarchy isn't even opened (most map meshes, for most rays).
const ball = new THREE.Sphere();
export function fastRaycast(raycaster, intersects) {
  const geometry = this.geometry;
  if (!geometry.boundsTree) return bruteForceRaycast.call(this, raycaster, intersects);
  if (geometry.boundingSphere === null) geometry.computeBoundingSphere();
  ball.copy(geometry.boundingSphere).applyMatrix4(this.matrixWorld);
  const ray = raycaster.ray;
  if (!ray.intersectsSphere(ball)) return undefined;
  if (ray.origin.distanceTo(ball.center) - ball.radius > raycaster.far) return undefined;
  return acceleratedRaycast.call(this, raycaster, intersects);
}

// 2. Teach every mesh the fast test, once per page. Meshes whose geometry has no
//    hierarchy (characters, effects, the Leaper) quietly keep the plain test.
let installed = false;
export function installAcceleratedRaycast() {
  if (installed) return;
  installed = true;
  THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
  THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
  THREE.Mesh.prototype.raycast = fastRaycast;
}

// 3. Build the hierarchy for every static mesh under `root` (the map). Shared
//    geometries are built once. Returns how many hierarchies were built.
//    Note: building re-orders the geometry's triangle list in place; that changes
//    nothing on screen and keeps every triangle. The exporter lets props with the
//    same shape share one triangle list, so each geometry first gets its own copy
//    (otherwise sorting one prop's list would scramble its twin's hierarchy).
export function accelerateStaticMeshes(root) {
  installAcceleratedRaycast();
  const built = new Set();
  root.traverse((object) => {
    const geometry = object.geometry;
    if (!object.isMesh || object.isSkinnedMesh || !geometry?.attributes.position) return;
    if (geometry.boundsTree || built.has(geometry)) return;
    if (geometry.index) geometry.setIndex(geometry.index.clone());
    geometry.computeBoundsTree({ setBoundingBox: true });
    built.add(geometry);
  });
  return built.size;
}

// 4. Free the hierarchies again when a map is unloaded.
export function releaseStaticMeshes(root) {
  root.traverse((object) => {
    if (object.isMesh && object.geometry.boundsTree) object.geometry.disposeBoundsTree();
  });
}
