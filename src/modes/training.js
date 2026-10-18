import { createTrainingWorld, TRAINING_TARGET } from '../world/createTrainingWorld.js';
import { TargetMarker } from '../world/TargetMarker.js';
import { TrainingVisualizer } from '../simulation/TrainingVisualizer.js';
import { createLeaperScene, loadStep, removeFromScene } from './shared.js';

// ?training: the RL lab's replay viewer. Recorded (deterministic) checkpoint
// rollouts play back in the training-scale arena with the replay panel.

const MAX_DELTA = 0.033;

export async function start({ engine }) {
  // 1. The training arena and its fixed target.
  const world = await loadStep('LOADING MAP…', 'MAP LOAD FAILED', () => createTrainingWorld(engine.scene));
  const target = await loadStep('LOADING…', 'CHARACTER LOAD FAILED', () => new TargetMarker(
    engine.scene,
    world.colliders,
    document.getElementById('cuboidToggle'),
    TRAINING_TARGET,
  ));
  // 2. The hexapod and the replay player that drives it.
  const { rig, cameraController, simulation } = createLeaperScene({ engine, world, target });
  const trainingVisualizer = new TrainingVisualizer({
    simulation,
    target,
    world,
    panel: document.getElementById('trainingPanel'),
  });
  // 3. Show the replay panel and fetch the first replays.
  document.body.classList.add('training-mode');
  trainingVisualizer.refresh();

  return {
    maxDelta: MAX_DELTA,
    update: (dt) => trainingVisualizer.update(dt),
    // No late phase: the Leaper animator still moves the camera and sun itself here.
    lateUpdate() {},
    beforeRender: () => cameraController.beforeRender(),
    afterRender: () => cameraController.afterRender(),
    // Leave the page as it was: no replay panel, the arena out of the scene.
    dispose() {
      document.body.classList.remove('training-mode');
      removeFromScene(engine.scene, { world, rig, target });
    },
  };
}
