import * as THREE from 'three';
import { ENCOUNTER } from '../config/encounter.js';
import { Assets, MAP_URL } from '../core/Assets.js';
import { junkyardScale, WIDTH_LIMITS } from './junkyardCollision.js';
import { loadJunkyardCollision } from './loadJunkyardCollision.js';
import metrics from '../../assets/maps/junkyard/metrics.json' with { type: 'json' };
import { disposeObject3D } from '../core/disposeObject3D.js';
import { accelerateStaticMeshes, releaseStaticMeshes } from './raycastAcceleration.js';
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
// (engine.quality); which props cast shadows follows it.
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
  // Shadows only from props big enough to show one at this quality (the floor
  // and perimeter walls always cast).
  limitShadowCasters(gltf.scene, quality.shadowMinSize, { keep: [floor] });
  // Neutral atmosphere and fill lighting keep grey surfaces from turning blue.
  // The original colours are kept so dispose() can hand the scene back unchanged.
  const original = { background: scene.background.getHex(), fog: scene.fog.color.getHex(), lights: [] };
  scene.background.setHex(0x555555);
  scene.fog.color.setHex(0x555555);
  scene.traverse((object) => {
    if (!object.isLight) return;
    original.lights.push([object, object.color.getHex(), object.groundColor?.getHex()]);
    object.color.setHex(0xffffff);
    if (object.isHemisphereLight) object.groundColor.setHex(0x777777);
  });
  // Take the map out again: off the scene, its GPU memory freed, colours restored.
  const dispose = () => {
    scene.remove(gltf.scene);
    releaseStaticMeshes(gltf.scene);
    disposeObject3D(gltf.scene);
    scene.background.setHex(original.background);
    scene.fog.color.setHex(original.fog);
    for (const [light, colour, ground] of original.lights) {
      light.color.setHex(colour);
      if (ground !== undefined) light.groundColor.setHex(ground);
    }
  };
  const initialTarget = { x: spawn.x, z: spawn.z + 5 };
  const goalIndex = navigation.nearest(initialTarget);
  const goal = navigation.point(goalIndex);
  return {
    dispose,
    colliders: [], navigation, scale, width, defaultWidth, map: gltf.scene,
    // Where the collision grids were built ('worker' normally, 'page' as a fallback).
    collisionBuiltBy: builtBy,
    // The largest Leaper size at which RESTART RANDOM still works (the size
    // slider's maximum), baked by scripts/assets/bake-junkyard-metrics.mjs.
    maxWidth: metrics.maxWorkableWidth ?? WIDTH_LIMITS.max,
    floorHeight,
    spawn: { x: spawn.x * scale, z: spawn.z * scale },
    initialTarget: { x: goal.x * scale, z: goal.z * scale },
    positionBlocked: (x, z) => navigation.blocked(x / scale, z / scale),
    playerBlocked: (x, z) => playerNavigation.blocked(x / scale, z / scale),
    // Lola's wall contact (outward normal) so she slides along angled walls.
    playerContact: (x, z) => playerNavigation.contact(x / scale, z / scale),
  };
}

// Get the loaded map ready for play (also used by tests on the real export):
// scale it around the rig, colour the floor and walls, measure the floor height,
// and build the fast-ray hierarchy for every map mesh.
export function prepareJunkyardMap(map, scale, { accelerate = true } = {}) {
  // 1. Scale the map around the fixed-size rig.
  map.scale.setScalar(scale);
  map.updateMatrixWorld(true);
  // 2. Shadows, and the floor / wall colouring of the exported Cube.
  let floorHeight = -Infinity, floor = null;
  map.traverse((object) => {
    if (!object.isMesh) return;
    object.castShadow = true;
    object.receiveShadow = true;
    // The exported Cube contains both the floor and perimeter walls. Give
    // elevated wall faces and the floor contrasting, neutral grey colours.
    if (object.name === 'Cube') {
      floor = object;
      const geometry = object.geometry.index ? object.geometry.toNonIndexed() : object.geometry.clone();
      const positions = geometry.attributes.position;
      const colours = new Float32Array(positions.count * 3);
      const wallColour = new THREE.Color(0x303030).convertSRGBToLinear();
      const floorColour = new THREE.Color(0x626262).convertSRGBToLinear();
      const point = new THREE.Vector3();
      for (let i = 0; i < positions.count; i += 3) {
        let highest = -Infinity, lowest = Infinity;
        for (let corner = 0; corner < 3; corner += 1) {
          point.fromBufferAttribute(positions, i + corner).applyMatrix4(object.matrixWorld);
          highest = Math.max(highest, point.y);
          lowest = Math.min(lowest, point.y);
        }
        if (highest < 0.15 * scale && highest - lowest < 1e-4) floorHeight = Math.max(floorHeight, highest);
        const colour = highest > 0.15 * scale ? wallColour : floorColour;
        for (let corner = 0; corner < 3; corner += 1) colour.toArray(colours, (i + corner) * 3);
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
    }
  });
  // 3. Fast rays: one bounding-volume hierarchy per map mesh (same hits, far fewer tests).
  if (accelerate) accelerateStaticMeshes(map);
  return { floorHeight: Number.isFinite(floorHeight) ? floorHeight : 0, floor };
}
