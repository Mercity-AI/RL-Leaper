import './styles/main.css';
import { createScene } from './core/createScene.js';
import { createWorld } from './world/createWorld.js';
import { TargetMarker } from './world/TargetMarker.js';
import { createHexapod } from './robot/createHexapod.js';
import { InputController } from './controls/InputController.js';
import { CameraController } from './camera/CameraController.js';
import { LeaperSimulation } from './simulation/LeaperSimulation.js';

const app = document.getElementById('app');
const engine = createScene(app);
const world = createWorld(engine.scene);
const target = new TargetMarker(
  engine.scene,
  world.colliders,
  document.getElementById('cuboidToggle'),
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

let previousTime = performance.now();

function animate(currentTime) {
  requestAnimationFrame(animate);
  const deltaTime = Math.min(0.033, (currentTime - previousTime) / 1000);
  previousTime = currentTime;
  simulation.update(deltaTime);
  engine.renderer.render(engine.scene, engine.camera);
}

requestAnimationFrame(animate);
