import * as THREE from 'three';
import { ENCOUNTER } from '../config/encounter.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { BODY_COLLISION_RADIUS, STANDING_HEIGHT } from '../config/robot.js';
import { JunkyardNavigation } from './JunkyardNavigation.js';

// The Leaper size chosen with APPLY SIZE, remembered in this browser. Change the\n// key's version when startWidth changes, so the new default shows.
export const SAVED_WIDTH_KEY = 'leaper.junkyard.width.v2';

function savedWidth() {
  try { return localStorage.getItem(SAVED_WIDTH_KEY); } catch { return null; /* Private storage. */ }
}

export async function createJunkyardWorld(scene) {
  // Reference size the camera distance is tuned against (see followScale).
  const defaultWidth = 2.4 * ENCOUNTER.leaperSize;
  // Size used: the page address, else the last applied size, else the owner's chosen start size.
  const requestedWidth = Number(new URLSearchParams(location.search).get('width') || savedWidth() || ENCOUNTER.startWidth);
  const width = Number.isFinite(requestedWidth) ? Math.max(1.2, Math.min(8, requestedWidth)) : defaultWidth;
  // Keep the existing rig/gait intact; scale the imported map relative to it.
  const scale = BODY_COLLISION_RADIUS * 2 / width;
  const [gltf, response] = await Promise.all([
    new GLTFLoader().loadAsync(new URL('../../assets/maps/junkyard/junkyard.glb', import.meta.url).href),
    fetch(new URL('../../assets/maps/junkyard/collision.json', import.meta.url)),
  ]);
  if (!response.ok) throw new Error('The junkyard collision export could not be loaded.');
  const data = await response.json();
  const navigation = new JunkyardNavigation(data, width / 2, (STANDING_HEIGHT + 1.5) / scale);
  const playerNavigation = new JunkyardNavigation(data, 0.25, 1.9 * ENCOUNTER.lolaHeight);
  const spawnIndex = navigation.nearest({ x: 0, z: 0 });
  if (spawnIndex < 0) throw new Error('No open starting position at this robot size.');
  const spawn = navigation.point(spawnIndex);
  gltf.scene.scale.setScalar(scale);
  gltf.scene.updateMatrixWorld(true);
  let floorHeight = -Infinity;
  gltf.scene.traverse((object) => {
    if (!object.isMesh) return;
    object.castShadow = true;
    object.receiveShadow = true;
    // The exported Cube contains both the floor and perimeter walls. Give
    // elevated wall faces and the floor contrasting, neutral grey colours.
    if (object.name === 'Cube') {
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
      object.geometry = geometry;
      object.material = object.material.clone();
      object.material.color.setHex(0xffffff);
      object.material.vertexColors = true;
      object.material.roughness = 0.95;
      object.material.metalness = 0;
    }
  });
  scene.add(gltf.scene);
  // Neutral atmosphere and fill lighting keep grey surfaces from turning blue.
  scene.background.setHex(0x555555);
  scene.fog.color.setHex(0x555555);
  scene.traverse((object) => {
    if (!object.isLight) return;
    object.color.setHex(0xffffff);
    if (object.isHemisphereLight) object.groundColor.setHex(0x777777);
  });
  const initialTarget = { x: spawn.x, z: spawn.z + 5 };
  const goalIndex = navigation.nearest(initialTarget);
  const goal = navigation.point(goalIndex);
  return {
    colliders: [], navigation, scale, width, defaultWidth, map: gltf.scene,
    floorHeight: Number.isFinite(floorHeight) ? floorHeight : 0,
    spawn: { x: spawn.x * scale, z: spawn.z * scale },
    initialTarget: { x: goal.x * scale, z: goal.z * scale },
    positionBlocked: (x, z) => navigation.blocked(x / scale, z / scale),
    playerBlocked: (x, z) => playerNavigation.blocked(x / scale, z / scale),
    // Lola's wall contact (outward normal) so she slides along angled walls.
    playerContact: (x, z) => playerNavigation.contact(x / scale, z / scale),
  };
}
