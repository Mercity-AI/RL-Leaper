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

const app = document.getElementById('app');
const engine = createScene(app);
const trainingMode = new URLSearchParams(window.location.search).has('training');
const world = trainingMode ? createTrainingWorld(engine.scene) : createWorld(engine.scene);
const target = new TargetMarker(
  engine.scene,
  world.colliders,
  document.getElementById('cuboidToggle'),
  trainingMode ? TRAINING_TARGET : null,
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
      panel: document.getElementById('trainingPanel'),
    })
  : null;

if (trainingMode) {
  document.body.classList.add('training-mode');
  trainingVisualizer.refresh();
}

let previousTime = performance.now();

function animate(currentTime) {
  requestAnimationFrame(animate);
  const deltaTime = Math.min(0.033, (currentTime - previousTime) / 1000);
  previousTime = currentTime;
  if (trainingVisualizer) trainingVisualizer.update(deltaTime);
  else simulation.update(deltaTime);
  engine.renderer.render(engine.scene, engine.camera);
}

requestAnimationFrame(animate);
