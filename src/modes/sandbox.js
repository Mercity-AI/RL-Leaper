import { createWorld } from '../world/createWorld.js';
import { TargetMarker } from '../world/TargetMarker.js';
import { createLeaperScene, loadStep, removeFromScene } from './shared.js';

// ?free / ?sandbox: the original keyboard sandbox. You drive the hexapod yourself
// (WASD, Shift, Space) around a procedural field, and IJKL moves the pink cuboid.
// The Leaper animator still moves the camera and sun itself here, as it always has.

// Short frame-time cap: the sandbox physics was tuned at 30+ fps.
const MAX_DELTA = 0.033;

export async function start({ engine }) {
  // 1. World and the pink target cuboid.
  const world = await loadStep('LOADING MAP…', 'MAP LOAD FAILED', () => createWorld(engine.scene));
  const target = await loadStep('LOADING…', 'CHARACTER LOAD FAILED', () => new TargetMarker(
    engine.scene,
    world.colliders,
    document.getElementById('cuboidToggle'),
    world.initialTarget || null,
  ));
  // 2. The hexapod, its keyboard input, the camera and the animator.
  const { rig, cameraController, simulation } = createLeaperScene({ engine, world, target });

  // 3. Frame phases: the animator updates the body, camera and sun together.
  return {
    maxDelta: MAX_DELTA,
    update: (dt) => simulation.update(dt),
    lateUpdate() {},
    beforeRender: () => cameraController.beforeRender(),
    afterRender: () => cameraController.afterRender(),
    dispose: () => removeFromScene(engine.scene, { world, rig, target }),
  };
}
