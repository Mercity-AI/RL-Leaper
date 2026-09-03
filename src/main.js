import './styles/main.css';
import { createScene } from './core/createScene.js';
import { createWorld } from './world/createWorld.js';
import { createTrainingWorld, TRAINING_TARGET } from './world/createTrainingWorld.js';
import { TargetMarker } from './world/TargetMarker.js';
import { createHexapod } from './robot/createHexapod.js';
import { InputController } from './controls/InputController.js';
import { CameraController } from './camera/CameraController.js';
import { LeaperSimulation } from './simulation/LeaperSimulation.js';
import { TrainingVisualizer } from './simulation/TrainingVisualizer.js';
import { BrainDriver } from './brain/BrainDriver.js';

const app = document.getElementById('app');
const engine = createScene(app);
const params = new URLSearchParams(window.location.search);
const trainingMode = params.has('training'); // ?training -> recorded replays
const freeRoam = params.has('free'); // ?free -> keyboard free-roam demo
const brainMode = !trainingMode && !freeRoam; // the live-brain game is the default
const arenaMode = trainingMode || brainMode; // both use the training-scale world
const world = arenaMode ? createTrainingWorld(engine.scene) : createWorld(engine.scene);
const target = new TargetMarker(
  engine.scene,
  world.colliders,
  document.getElementById('cuboidToggle'),
  arenaMode ? TRAINING_TARGET : null,
);
const rig = createHexapod(engine.scene);
const input = new InputController(() => target.toggle());
const cameraController = new CameraController(
  engine.camera,
  engine.scene,
  engine.renderer.domElement,
  document.getElementById('cameraToggle'),
);
const simulation = new LeaperSimulation({
  rig,
  world,
  target,
  input,
  cameraController,
  sun: engine.sun,
  statusElement: document.getElementById('status'),
});
const trainingVisualizer = trainingMode
  ? new TrainingVisualizer({
      simulation,
      target,
      world,
      panel: document.getElementById('trainingPanel'),
    })
  : null;

if (trainingMode) {
  document.body.classList.add('training-mode');
  trainingVisualizer.refresh();
}

// --- Move 3: the live trained brain drives the Leaper (?brain). ---
const brainDriver = brainMode
  ? new BrainDriver({
      simulation,
      target,
      world,
      scene: engine.scene,
      statusElement: document.getElementById('status'),
    })
  : null;
if (brainDriver) {
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
}

let previousTime = performance.now();

function animate(currentTime) {
  requestAnimationFrame(animate);
  const deltaTime = Math.min(0.033, (currentTime - previousTime) / 1000);
  previousTime = currentTime;
  if (trainingVisualizer) trainingVisualizer.update(deltaTime);
  else if (brainDriver) brainDriver.update(deltaTime);
  else simulation.update(deltaTime);
  engine.renderer.render(engine.scene, engine.camera);
}

requestAnimationFrame(animate);
