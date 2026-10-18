// Visual demo, not a test: a before/after view of the chase camera clearing the
// junkyard scenery. Open /demos/camera-preview.html while `pnpm dev` runs.
import * as THREE from 'three';
import { createScene } from '../src/core/createScene.js';
import { createJunkyardWorld } from '../src/world/createJunkyardWorld.js';
import { LolaPlayer } from '../src/robot/LolaPlayer.js';
import { CameraOcclusion } from '../src/camera/CameraOcclusion.js';

const engine = createScene(document.querySelector('#app'));
const world = await createJunkyardWorld(engine.scene);
const lola = await LolaPlayer.create(engine.scene, world, document.querySelector('#target'));
const anchor = lola.mesh.position.clone();
anchor.y += lola.height * 1.05;
const solver = new CameraOcclusion([world.map]);
const before = engine.camera, after = before.clone();
let yaw = Math.PI, orbit = false;
const desired = new THREE.Vector3();
function pose(angle) {
  return desired.set(Math.sin(angle) * Math.cos(0.16), Math.sin(0.16), Math.cos(angle) * Math.cos(0.16))
    .multiplyScalar(11.5).add(anchor).add(new THREE.Vector3(0, -0.55, 0));
}
// Find a real obstruction at the spawn; never add fake cover to the map.
for (let i = 0; i < 72; i++) {
  const angle = i * Math.PI / 36;
  const point = pose(angle).clone();
  solver.distance = null;
  solver.resolve(anchor, point, after, 1);
  if (solver.distance > 2 && solver.distance < 7) { yaw = angle; break; }
}
solver.distance = null;
document.querySelector('#orbit').onclick = event => {
  orbit = !orbit; event.target.textContent = orbit ? 'Pause orbit' : 'Orbit camera';
};
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.05); last = now;
  if (orbit) yaw += dt * 0.35;
  const w = innerWidth, h = innerHeight;
  before.aspect = after.aspect = w / 2 / h;
  before.updateProjectionMatrix(); after.updateProjectionMatrix();
  before.position.copy(pose(yaw)); after.position.copy(before.position);
  solver.resolve(anchor, after.position, after, dt);
  const focus = anchor.clone().add(new THREE.Vector3(0, 0.5, 0));
  before.lookAt(focus); after.lookAt(focus);
  engine.renderer.setScissorTest(true);
  engine.renderer.setViewport(0, 0, w / 2, h); engine.renderer.setScissor(0, 0, w / 2, h);
  engine.renderer.render(engine.scene, before);
  engine.renderer.setViewport(w / 2, 0, w / 2, h); engine.renderer.setScissor(w / 2, 0, w / 2, h);
  engine.renderer.render(engine.scene, after);
  document.querySelector('#status').textContent = `Same character, same wall. Camera distance: 11.5 → ${solver.distance.toFixed(1)}`;
}
requestAnimationFrame(frame);
