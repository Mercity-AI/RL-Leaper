import './styles/main.css';
import './styles/junkyard.css';
import { createScene } from './core/createScene.js';
import { createWorld } from './world/createWorld.js';
import { createTrainingWorld, TRAINING_TARGET } from './world/createTrainingWorld.js';
import { TargetMarker } from './world/TargetMarker.js';
import { createHexapod } from './robot/createHexapod.js';
import { InputController } from './controls/InputController.js';
import { CameraController } from './camera/CameraController.js';
import { LeaperSimulation } from './simulation/LeaperSimulation.js';
import { TrainingVisualizer } from './simulation/TrainingVisualizer.js';
import { createJunkyardWorld } from './world/createJunkyardWorld.js';
import { JunkyardPlaytest } from './simulation/JunkyardPlaytest.js';
import { LolaPlayer } from './robot/LolaPlayer.js';
import { enableMovableHud } from './controls/MovableHud.js';

const app = document.getElementById('app');
const engine = createScene(app);
const trainingMode = new URLSearchParams(window.location.search).has('training');
const junkyardMode = !trainingMode && new URLSearchParams(window.location.search).get('map') === 'junkyard';
let world;
try {
  document.getElementById('status').textContent = 'LOADING MAP…';
  world = trainingMode ? createTrainingWorld(engine.scene)
    : junkyardMode ? await createJunkyardWorld(engine.scene) : createWorld(engine.scene);
} catch (error) {
  document.getElementById('status').textContent = `MAP LOAD FAILED: ${error.message} — reload to retry`;
  throw error;
}
document.getElementById('status').textContent = junkyardMode ? 'LOADING LOLA…' : 'LOADING…';
let target;
try {
  target = junkyardMode
    ? await LolaPlayer.create(engine.scene, world, document.getElementById('cuboidToggle'))
    : new TargetMarker(
      engine.scene,
      world.colliders,
      document.getElementById('cuboidToggle'),
      trainingMode ? TRAINING_TARGET : world.initialTarget || null,
    );
} catch (error) {
  document.getElementById('status').textContent = `CHARACTER LOAD FAILED: ${error.message} — reload to retry`;
  throw error;
}
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
if (junkyardMode) cameraController.followSubject = target;
const trainingVisualizer = trainingMode
  ? new TrainingVisualizer({
      simulation,
      target,
      panel: document.getElementById('trainingPanel'),
    })
  : null;
const playtest = junkyardMode ? new JunkyardPlaytest({ engine, world, simulation, target, cameraController }) : null;
if (junkyardMode) enableMovableHud();

if (trainingMode) {
  document.body.classList.add('training-mode');
  trainingVisualizer.refresh();
}

let previousTime = performance.now();

function animate(currentTime) {
  requestAnimationFrame(animate);
  const deltaTime = Math.min(junkyardMode ? 0.1 : 0.033, (currentTime - previousTime) / 1000);
  previousTime = currentTime;
  if (trainingVisualizer) trainingVisualizer.update(deltaTime);
  else {
    if (playtest) playtest.update(deltaTime);
    else simulation.update(deltaTime);
  }
  engine.renderer.render(engine.scene, engine.camera);
}

requestAnimationFrame(animate);
