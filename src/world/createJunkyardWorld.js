import * as THREE from 'three';
import { ENCOUNTER } from '../config/encounter.js';
import { Assets, MAP_URL } from '../core/Assets.js';
import { junkyardScale, WIDTH_LIMITS } from './junkyardCollision.js';
import { loadJunkyardCollision } from './loadJunkyardCollision.js';
import metrics from '../../assets/maps/junkyard/metrics.json' with { type: 'json' };
import { disposeObject3D } from '../core/disposeObject3D.js';
import { accelerateStaticMeshes, releaseStaticMeshes } from './raycastAcceleration.js';
import { batchStaticMeshes } from './staticBatching.js';
import { applyAtmosphere } from './junkyardAtmosphere.js';
import { colourJunkyardProps, dressJunkyardSurfaces } from './junkyardSurfaces.js';
import { findClimbableRoofs } from './climbableRoofs.js';
import { WorldEffects } from './WorldEffects.js';
import { limitShadowCasters, QUALITY_PRESETS } from '../core/Quality.js';

// The Leaper size chosen with APPLY SIZE, remembered in this browser. Change the
// key's version when startWidth changes, so the new default shows.
export const SAVED_WIDTH_KEY = 'leaper.junkyard.width.v2';

function savedWidth() {
  try { return localStorage.getItem(SAVED_WIDTH_KEY); } catch { return null; /* Private storage. */ }
}

// collision.json stays the source for the Python brain service too; the page
// hands it to a worker (see loadJunkyardCollision.js).
const COLLISION_URL = new URL('../../assets/maps/junkyard/collision.json', import.meta.url).href;
// The collision job counts like a file of this many bytes on the loading bar
// (its download plus the grid building in the worker).
const COLLISION_LOAD_WEIGHT = 2e6;

// Load and set up the junkyard. assets: the page's loader (progress bar); tests
// and tools get a quiet one of their own. quality: the graphics preset
// (engine.quality); shadows, the sky and the effects follow it.
export async function createJunkyardWorld(scene, { assets = new Assets({ overlay: false }), quality = QUALITY_PRESETS.high } = {}) {
  // Reference size the camera distance is tuned against (see followScale).
  const defaultWidth = 2.4 * ENCOUNTER.leaperSize;
  // Size used: the page address, else the last applied size, else the owner's chosen start size.
  const requestedWidth = Number(new URLSearchParams(location.search).get('width') || savedWidth() || ENCOUNTER.startWidth);
  const width = Number.isFinite(requestedWidth) ? Math.max(WIDTH_LIMITS.min, Math.min(WIDTH_LIMITS.max, requestedWidth)) : defaultWidth;
  // Keep the existing rig/gait intact; scale the imported map relative to it.
  const scale = junkyardScale(width);
  // The compressed map and, in a worker at the same time, the Leaper's grid (with
  // its connected regions and safe spawn cells) and Lola's.
  const [gltf, { navigation, playerNavigation, builtBy }] = await Promise.all([
    assets.model(MAP_URL),
    assets.task('collision', (report) => loadJunkyardCollision(COLLISION_URL, width, report), COLLISION_LOAD_WEIGHT),
  ]);
  const spawnIndex = navigation.nearest({ x: 0, z: 0 });
  if (spawnIndex < 0) throw new Error('No open starting position at this robot size.');
  const spawn = navigation.point(spawnIndex);
  const { floorHeight, floor } = prepareJunkyardMap(gltf.scene, scale);
  scene.add(gltf.scene);
  // Roofs Lola can climb onto (measured before the map is batched).
  const roofs = findClimbableRoofs(gltf.scene);
  // Shadows only from props big enough to show one at this quality (the floor
  // and perimeter walls always cast), then one draw per material and yard patch
  // for the map (see staticBatching.js).
  limitShadowCasters(gltf.scene, quality.shadowMinSize, { keep: [floor] });
  const batching = batchStaticMeshes(gltf.scene, scene, { scale });
  scene.add(batching.group);
  // Sky, fog and neutral fill light (see junkyardAtmosphere.js), and the pooled
  // world effects (dust under the Leaper's feet, impact sparks and scorch marks).
  const restoreAtmosphere = applyAtmosphere(scene, { sky: quality.sky !== false });
  const effects = new WorldEffects(scene, { scale, quality });
  // Take the map out again: off the scene, its GPU memory freed, colours restored.
  const dispose = () => {
    effects.dispose();
    batching.dispose();
    scene.remove(gltf.scene);
    releaseStaticMeshes(gltf.scene);
    disposeObject3D(gltf.scene);
    restoreAtmosphere();
  };
  const initialTarget = { x: spawn.x, z: spawn.z + 5 };
  const goalIndex = navigation.nearest(initialTarget);
  const goal = navigation.point(goalIndex);
  return {
    dispose,
    colliders: [], navigation, scale, width, defaultWidth, map: gltf.scene, effects,
    // The combined map meshes actually drawn (the map's own meshes stay for rays)
    // and how many map meshes they replace.
    batches: batching.group, batchStats: batching.stats,
    // Where the collision grids were built ('worker' normally, 'page' as a fallback).
    collisionBuiltBy: builtBy,
    // The largest Leaper size at which RESTART RANDOM still works (the size
    // slider's maximum), baked by scripts/assets/bake-junkyard-metrics.mjs.
    maxWidth: metrics.maxWorkableWidth ?? WIDTH_LIMITS.max,
    floorHeight,
    roofs,
    spawn: { x: spawn.x * scale, z: spawn.z * scale },
    initialTarget: { x: goal.x * scale, z: goal.z * scale },
    positionBlocked: (x, z) => navigation.blocked(x / scale, z / scale),
    playerBlocked: (x, z) => playerNavigation.blocked(x / scale, z / scale),
    // Lola's wall contact (outward normal) so she slides along angled walls;
    // above: only what reaches higher than this (above the floor) is a wall.
    playerContact: (x, z, above) => playerNavigation.contact(x / scale, z / scale, undefined,
      above === undefined ? undefined : (above + floorHeight) / scale),
    // What Lola would stand on at (x, z): its height above the floor (0 on the
    // floor), or null when something there reaches above maxTop (above the floor).
    playerSurface: (x, z, maxTop) => {
      const top = playerNavigation.surface(x / scale, z / scale, (maxTop + floorHeight) / scale);
      return top === null ? null : Math.max(0, top * scale - floorHeight);
    },
  };
}

// Get the loaded map ready for play (also used by tests on the real export):
// scale it around the rig, colour the floor and walls, measure the floor height,
// and build the fast-ray hierarchy for every map mesh.
export function prepareJunkyardMap(map, scale, { accelerate = true } = {}) {
  // 1. Scale the map around the fixed-size rig.
  map.scale.setScalar(scale);
  map.updateMatrixWorld(true);
  // 2. Shadows, the floor height, and the floor / wall colouring of the exported
  //    Cube (the floor with its perimeter walls). A Cube with one material (the
  //    first junkyard) is coloured here: contrasting neutral greys for walls and
  //    floor. A Cube with its own wall and ground materials (junkyard_v2, a
  //    multi-material node: a group of meshes) keeps the colours it was made with.
  let floorHeight = -Infinity;
  const floor = map.getObjectByName('Cube') ?? null;
  const floorParts = new Set();
  floor?.traverse((object) => { if (object.isMesh) floorParts.add(object); });
  const point = new THREE.Vector3();
  map.traverse((object) => {
    if (!object.isMesh) return;
    object.castShadow = true;
    object.receiveShadow = true;
    if (!floorParts.has(object)) return;
    const recolour = object === floor;
    const geometry = object.geometry.index ? object.geometry.toNonIndexed() : object.geometry.clone();
    const positions = geometry.attributes.position;
    const colours = recolour ? new Float32Array(positions.count * 3) : null;
    const wallColour = new THREE.Color(0x303030).convertSRGBToLinear();
    const floorColour = new THREE.Color(0x626262).convertSRGBToLinear();
    for (let i = 0; i < positions.count; i += 3) {
      let highest = -Infinity, lowest = Infinity;
      for (let corner = 0; corner < 3; corner += 1) {
        point.fromBufferAttribute(positions, i + corner).applyMatrix4(object.matrixWorld);
        highest = Math.max(highest, point.y);
        lowest = Math.min(lowest, point.y);
      }
      if (highest < 0.15 * scale && highest - lowest < 1e-4) floorHeight = Math.max(floorHeight, highest);
      if (!recolour) continue;
      const colour = highest > 0.15 * scale ? wallColour : floorColour;
      for (let corner = 0; corner < 3; corner += 1) colour.toArray(colours, (i + corner) * 3);
    }
    if (!recolour) {
      geometry.dispose();
      return;
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
    // The recoloured copies replace the originals, which are freed right away.
    object.geometry.dispose();
    object.geometry = geometry;
    const sourceMaterial = object.material;
    object.material = sourceMaterial.clone();
    sourceMaterial.dispose();
    object.material.color.setHex(0xffffff);
    object.material.vertexColors = true;
    object.material.roughness = 0.95;
    object.material.metalness = 0;
  });
  // junkyard_v2's own floor and wall materials get their colours and dirt
  // (see junkyardSurfaces.js).
  if (floor && !floor.isMesh) dressJunkyardSurfaces(floorParts, scale);
  // Props the owner recoloured over the baked texture (see junkyardSurfaces.js).
  colourJunkyardProps(map);
  // 3. Fast rays: one bounding-volume hierarchy per map mesh (same hits, far fewer tests).
  if (accelerate) accelerateStaticMeshes(map);
  return { floorHeight: Number.isFinite(floorHeight) ? floorHeight : 0, floor };
}
