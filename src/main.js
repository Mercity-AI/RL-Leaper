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
import { BrainDriver } from './brain/BrainDriver.js';
import { createJunkyardWorld } from './world/createJunkyardWorld.js';
import { JunkyardPlaytest } from './simulation/JunkyardPlaytest.js';
import { LolaPlayer } from './robot/LolaPlayer.js';
import { enableMovableHud } from './controls/MovableHud.js';

const app = document.getElementById('app');
const engine = createScene(app);
const params = new URLSearchParams(window.location.search);
const trainingMode = params.has('training'); // ?training -> recorded RL replays
const arenaMode = !trainingMode && params.has('arena'); // ?arena -> lab live-brain arena demo
const freeRoam = !trainingMode && !arenaMode && (params.has('free') || params.has('sandbox'));
// The junkyard game (Lola vs. the Leaper) is the default; ?map=junkyard still works.
const junkyardMode = !trainingMode && !arenaMode && !freeRoam;
const trainingArena = trainingMode || arenaMode; // both use the training-scale world
let world;
try {
  document.getElementById('status').textContent = 'LOADING MAP…';
  world = trainingArena ? createTrainingWorld(engine.scene)
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
      trainingArena ? TRAINING_TARGET : world.initialTarget || null,
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
cameraController.setOccluders(world.map ? [world.map] : [world.ground, world.obstacleGroup].filter(Boolean));
const simulation = new LeaperSimulation({
  rig,
  world,
  target,
  input,
  cameraController,
  sun: engine.sun,
  statusElement: document.getElementById('status'),
});
if (junkyardMode) {
  cameraController.followSubject = target;
  cameraController.pitch = 0.16;
}
const trainingVisualizer = trainingMode
  ? new TrainingVisualizer({
      simulation,
      target,
      world,
      panel: document.getElementById('trainingPanel'),
    })
  : null;
const playtest = junkyardMode ? new JunkyardPlaytest({ engine, world, simulation, target, cameraController }) : null;
if (junkyardMode) enableMovableHud();
// Testing hook: ?debug exposes the playtest so automated checks can read positions.
if (playtest && params.has('debug')) window.leaperPlaytest = playtest;

if (trainingMode) {
  document.body.classList.add('training-mode');
  trainingVisualizer.refresh();
}

// The lab's live-brain arena (?arena): its own in-browser brain drives the Leaper.
const brainDriver = arenaMode
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
  const deltaTime = Math.min(junkyardMode ? 0.1 : 0.033, (currentTime - previousTime) / 1000);
  previousTime = currentTime;
  if (trainingVisualizer) trainingVisualizer.update(deltaTime);
  else if (brainDriver) brainDriver.update(deltaTime);
  else if (playtest) playtest.update(deltaTime);
  else simulation.update(deltaTime);
  cameraController.beforeRender();
  playtest?.playerWeapon.beforeRender();
  playtest?.pov.beforeRender();
  engine.renderer.render(engine.scene, engine.camera);
  playtest?.pov.afterRender();
  playtest?.playerWeapon.afterRender();
  cameraController.afterRender();
}

requestAnimationFrame(animate);
