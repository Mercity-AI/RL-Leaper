import { createHexapod } from '../robot/createHexapod.js';
import { InputController } from '../controls/InputController.js';
import { CameraController } from '../camera/CameraController.js';
import { LeaperSimulation } from '../simulation/LeaperSimulation.js';

// Pieces every mode shares: the top-right status line, a guarded loading step,
// the Leaper rig with its input / camera / animator, and scene clean-up.

// The top-right status line (boot progress, errors, live readouts).
export function statusElement() {
  return document.getElementById('status');
}

export function setStatus(text) {
  statusElement().textContent = text;
}

// Show `label` while `load()` runs. A failure replaces it with a readable
// "<FAILURE>: reason — reload to retry" instead of leaving a blank screen.
export async function loadStep(label, failure, load) {
  setStatus(label);
  try {
    return await load();
  } catch (error) {
    setStatus(`${failure}: ${error.message} — reload to retry`);
    throw error;
  }
}

// The Leaper rig plus the input, camera and animator built around it. The camera
// looks through the map (or ground and obstacles) for its occlusion checks.
// signal (optional): the mode's AbortSignal; the camera's listeners end with it.
export function createLeaperScene({ engine, world, target, signal = null }) {
  const rig = createHexapod(engine.scene);
  const input = new InputController(() => target.toggle());
  const cameraController = new CameraController(
    engine.camera,
    engine.scene,
    engine.renderer.domElement,
    document.getElementById('cameraToggle'),
    { signal },
  );
  cameraController.setOccluders(world.map ? [world.map] : [world.ground, world.obstacleGroup].filter(Boolean));
  const simulation = new LeaperSimulation({
    rig,
    world,
    target,
    input,
    cameraController,
    sun: engine.sun,
    statusElement: statusElement(),
  });
  return { rig, input, cameraController, simulation };
}

// Take a mode's objects back out of the scene. Event listeners added by the older
// subsystems have no removal API yet, so a disposed mode still leaves those behind.
export function removeFromScene(scene, { world, rig, target }) {
  const roots = [world?.map, world?.ground, world?.grid, world?.obstacleGroup, world?.boundary,
    rig?.robot, ...(rig?.legs ?? []).flatMap((leg) => [leg.coxa, leg.femur, leg.tibia, leg.calf, leg.knee, leg.calfJoint]),
    target?.mesh];
  for (const object of roots) if (object?.isObject3D) scene.remove(object);
}
