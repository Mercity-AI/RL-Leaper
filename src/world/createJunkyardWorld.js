import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { BODY_COLLISION_RADIUS, STANDING_HEIGHT } from '../config/robot.js';
import { JunkyardNavigation } from './JunkyardNavigation.js';

export async function createJunkyardWorld(scene) {
  const requestedWidth = Number(new URLSearchParams(location.search).get('width') || 2.4);
  const width = Number.isFinite(requestedWidth) ? Math.max(1.2, Math.min(8, requestedWidth)) : 2.4;
  // Keep the existing rig/gait intact; scale the imported map relative to it.
  const scale = BODY_COLLISION_RADIUS * 2 / width;
  const [gltf, response] = await Promise.all([
    new GLTFLoader().loadAsync(new URL('../../assets/maps/junkyard/junkyard.glb', import.meta.url).href),
    fetch(new URL('../../assets/maps/junkyard/collision.json', import.meta.url)),
  ]);
  if (!response.ok) throw new Error('The junkyard collision export could not be loaded.');
  const data = await response.json();
  const navigation = new JunkyardNavigation(data, width / 2, (STANDING_HEIGHT + 1.5) / scale);
  const playerNavigation = new JunkyardNavigation(data, 0.25, 1.9);
  const spawnIndex = navigation.nearest({ x: 0, z: 0 });
  if (spawnIndex < 0) throw new Error('No open starting position at this robot size.');
  const spawn = navigation.point(spawnIndex);
  gltf.scene.scale.setScalar(scale);
  gltf.scene.traverse((object) => {
    if (!object.isMesh) return;
    object.castShadow = true;
    object.receiveShadow = true;
  });
  scene.add(gltf.scene);
  const initialTarget = { x: spawn.x, z: spawn.z + 5 };
  const goalIndex = navigation.nearest(initialTarget);
  const goal = navigation.point(goalIndex);
  return {
    colliders: [], navigation, scale, width, map: gltf.scene,
    spawn: { x: spawn.x * scale, z: spawn.z * scale },
    initialTarget: { x: goal.x * scale, z: goal.z * scale },
    positionBlocked: (x, z) => navigation.blocked(x / scale, z / scale),
    playerBlocked: (x, z) => playerNavigation.blocked(x / scale, z / scale),
  };
}
