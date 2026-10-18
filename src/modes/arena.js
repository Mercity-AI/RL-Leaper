import { createTrainingWorld, TRAINING_TARGET } from '../world/createTrainingWorld.js';
import { TargetMarker } from '../world/TargetMarker.js';
import { BrainDriver } from '../brain/BrainDriver.js';
import { createLeaperScene, loadStep, removeFromScene, statusElement } from './shared.js';

// ?arena: the RL lab's live-brain arena. Main's in-browser 26-input brain
// (BrainDriver + ONNX) chases a target you steer with WASD.

const MAX_DELTA = 0.033;

export async function start({ engine }) {
  // 1. The training arena and the target you steer.
  const world = await loadStep('LOADING MAP…', 'MAP LOAD FAILED', () => createTrainingWorld(engine.scene));
  const target = await loadStep('LOADING…', 'CHARACTER LOAD FAILED', () => new TargetMarker(
    engine.scene,
    world.colliders,
    document.getElementById('cuboidToggle'),
    TRAINING_TARGET,
  ));
  // 2. The hexapod and the in-browser brain that drives it.
  const { rig, cameraController, simulation } = createLeaperScene({ engine, world, target });
  const brainDriver = new BrainDriver({
    simulation,
    target,
    world,
    scene: engine.scene,
    statusElement: statusElement(),
  });
  // 3. Arena HUD text, the optional player model, then start the brain.
  document.body.classList.add('brain-mode');
  document.getElementById('controlHelp').innerHTML =
    '<b>W A S D</b> MOVE YOUR TARGET AT 6 M/S &nbsp;·&nbsp; <b>DRAG</b> CAMERA<br />' +
    '<b>VIEW</b> CHASE / LEAPER EYES / TOP &nbsp;·&nbsp; ESCAPE THE LEAPER';
  target.loadPlayerModel('/models/player.obj', '/models/player.mtl').then((loaded) => {
    console.log(loaded
      ? 'Player OBJ loaded from /models/player.obj'
      : 'Using pink fallback — add public/models/player.obj to replace it');
  }).catch((error) => console.warn('Player model could not be loaded:', error));
  brainDriver.init().catch((err) => console.error('Live brain failed to start:', err));

  return {
    maxDelta: MAX_DELTA,
    update: (dt) => brainDriver.update(dt),
    // No late phase: the Leaper animator still moves the camera and sun itself here.
    lateUpdate() {},
    beforeRender: () => cameraController.beforeRender(),
    afterRender: () => cameraController.afterRender(),
    // Leave the page as it was: no arena styling, the arena out of the scene.
    dispose() {
      document.body.classList.remove('brain-mode');
      removeFromScene(engine.scene, { world, rig, target });
    },
  };
}
