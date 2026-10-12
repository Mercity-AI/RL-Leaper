// Browser-only integration checks using actual GLB map, animated Lola, and rig.
// Serve with Vite; this page is separate from the production entry point.
import * as THREE from 'three';
import { createScene } from '../src/core/createScene.js';
import { createJunkyardWorld } from '../src/world/createJunkyardWorld.js';
import { createHexapod } from '../src/robot/createHexapod.js';
import { LolaPlayer } from '../src/robot/LolaPlayer.js';
import { EyeVision } from '../src/simulation/EyeVision.js';
import { LeaperCombat } from '../src/simulation/LeaperCombat.js';
import { CameraController } from '../src/camera/CameraController.js';
import { LeaperPov } from '../src/camera/LeaperPov.js';
import { CombatGeometry } from '../src/simulation/CombatGeometry.js';
import { COMBAT } from '../src/config/combat.js';
import eyeConfig from '../src/config/eye-vision.json' with { type: 'json' };

const result = document.querySelector('#results');
let passed = 0;
function check(condition, label) {
  if (!condition) throw new Error(label);
  passed++; result.textContent += `\nPASS ${label}`;
}
try {
  const engine = createScene(document.querySelector('#app'));
  const world = await createJunkyardWorld(engine.scene);
  const target = await LolaPlayer.create(engine.scene, world, document.querySelector('#cuboidToggle'));
  const rig = createHexapod(engine.scene);
  const cameraController = new CameraController(engine.camera, engine.scene, engine.renderer.domElement, document.querySelector('#cameraToggle'));
  cameraController.followSubject = target;
  const bones = target.outfits.map(({ model }) => eyeConfig.targetBones.map(name => model.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(name))));
  const p = { engine, world, target, cameraController, panel: document.querySelector('#junkyardPanel'),
    sight: { bones, lines: new THREE.Group() }, walking: true, brain: { ready: true },
    simulation: { rig, state: { yaw: 0 } }, stop() { this.walking = false; }, reset() { this.combat.reset(); } };
  p.combat = new LeaperCombat(p); p.pov = new LeaperPov(p);
  const combat = p.combat, scale = world.scale;
  rig.robot.position.set(world.spawn.x, 2.32, world.spawn.z);
  function animatePlayer(dt = 0.1) { target.move(0, 0, new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0), 4.5, dt); }
  function tick(dt = 1 / 60) { combat.update(dt); p.pov.update(); }
  function frames(n) { for (let i = 0; i < n; i++) tick(); }
  function reset() { combat.reset(); p.walking = true; target.crouching = false; target.resetJump(); animatePlayer(); }
  result.textContent = 'REAL-ASSET BROWSER COMBAT CHECKS';
  reset(); tick(0);
  // Find a clear front-facing lane at the real spawn, using physical map rays.
  const base = target.mesh.position.clone();
  let lane = null;
  for (const distance of [5, 7, 9, 12]) {
    target.mesh.position.set(world.spawn.x, 0, world.spawn.z + distance * scale);
    animatePlayer(); combat.tree.reset(); tick(0);
    if (combat.tree.state === 'charging') { lane = target.mesh.position.clone(); break; }
  }
  check(Boolean(lane), 'real junkyard has a visible, aligned firing lane');
  frames(25);
  check(combat.tree.locked, 'aim locks after tracking during the warning');
  const locked = combat.direction.clone();
  target.mesh.position.x += 0.5 * scale; animatePlayer(); frames(8);
  check(combat.direction.distanceTo(locked) < 1e-7, 'moving Lola cannot change locked aim');
  check(combat.bolts.length === 0, 'no projectile before the full warning');
  frames(5); check(combat.bolts.length === 1, 'one red bolt fires after the warning');
  const bolt = combat.bolts[0], boltStart = bolt.mesh.position.clone();
  p.walking = false; frames(10);
  check(bolt.mesh.position.distanceTo(boltStart) === 0, 'pause freezes active bolts');
  p.walking = true; tick(); check(bolt.mesh.position.distanceTo(boltStart) > 0, 'resume advances the same bolt');
  combat.reset(); check(combat.bolts.length === 0 && combat.tree.started === null, 'reset clears bolts and pending warning');

  target.mesh.position.copy(lane); reset(); tick(0); frames(15);
  // Insert a thin test panel between eye and visible torso, keeping the real map.
  const points = combat.pose(), midpoint = combat.origin.clone().lerp(points[1], 0.5);
  const wall = new THREE.Mesh(new THREE.BoxGeometry(20, 20, 0.01), new THREE.MeshBasicMaterial({ color: 0x333333 }));
  wall.position.copy(midpoint); engine.scene.add(wall);
  const blockers = new THREE.Group();
  const wallProxy = wall.clone(); blockers.add(wallProxy);
  const extra = new CombatGeometry(blockers); const actual = combat.geometry;
  const originalHit = actual.hit.bind(actual);
  actual.hit = (origin, direction, distance) => {
    const a = originalHit(origin, direction, distance), b = extra.hit(origin, direction, distance);
    return !a ? b : !b ? a : a.distance <= b.distance ? a : b;
  };
  tick(); check(combat.tree.started === null && combat.tree.state === 'target hidden', 'cover interrupts and cancels wind-up');
  actual.hit = originalHit; engine.scene.remove(wall);
  tick(); check(combat.tree.state === 'cooling down', 'cancelled shot has a short recovery');
  reset(); target.mesh.position.copy(lane); tick(0); frames(25);
  actual.hit = (origin, direction, distance) => extra.hit(origin, direction, distance) || originalHit(origin, direction, distance);
  frames(20); check(combat.tree.shots === 0, 'cover also cancels the final locked warning');

  // Force an extremely fast bolt into the same thin panel, behind which is Lola.
  combat.reset(); combat.pose(); combat.track(combat.pose()[1]); combat.fire();
  combat.config = { ...COMBAT, projectileSpeed: 1000 };
  combat.updateProjectiles(0.1, combat.pose());
  check(combat.bolts.length === 0 && combat.lolaHealth === 100, 'full-frame sweep hits thin cover before Lola at extreme speed');
  combat.config = COMBAT; actual.hit = originalHit;
  reset(); target.mesh.position.copy(lane); tick(0); frames(100);
  check(combat.lolaHealth === 92, 'one unobstructed hit deals exactly 8 damage');
  check(combat.hud.querySelector('[data-health]').textContent === '92 / 100', 'damage updates the visible health HUD');

  reset(); target.mesh.position.copy(lane); animatePlayer(); tick(0);
  const standingHead = combat.pose()[0].y;
  target.crouching = true; for (let i = 0; i < 20; i++) animatePlayer(0.05);
  check(combat.pose()[0].y < standingHead - 0.1 * scale, 'hit anchors follow actual crouch animation');
  target.jump(); animatePlayer(0.15);
  check(target.mesh.position.y > 0 && combat.pose()[0].y > standingHead, 'hit anchors follow Lola while jumping');
  target.resetJump(); target.crouching = false;
  reset(); target.mesh.position.set(world.spawn.x + 6 * scale, 0, world.spawn.z);
  animatePlayer(); frames(80);
  check(combat.tree.shots === 0, 'wide side detection never fires outside the eye aiming cone');
  target.mesh.position.set(world.spawn.x, 0, world.spawn.z + 30 * scale); frames(80);
  check(combat.tree.shots === 0, 'weapon range holds fire');

  reset(); target.mesh.position.copy(lane); animatePlayer(); tick(0);
  cameraController.yaw = 0.73; cameraController.update({ position: rig.robot.position }, rig.eyePivot, 0.1);
  const heading = cameraController.getMovementHeading(0), eye = rig.eyePivot.quaternion.clone();
  const previousCamera = engine.camera.position.clone();
  p.pov.toggle(); p.pov.update();
  check(cameraController.getMovementHeading(0) === heading, 'POV preserves Lola movement heading');
  check(rig.eyePivot.quaternion.angleTo(eye) < 1e-7, 'spectator toggle does not rotate the eye');
  check(engine.camera.position.distanceTo(combat.origin) < 1e-7, 'POV camera sits at the physical red eye');
  const cameraDirection = engine.camera.getWorldDirection(new THREE.Vector3());
  check(cameraDirection.distanceTo(combat.direction) < 1e-7, 'reticle looks along the actual weapon direction');
  p.pov.beforeRender();
  check(!rig.robot.visible && !rig.legs[0].coxa.visible, 'own mesh is hidden only for POV rendering');
  engine.renderer.render(engine.scene, engine.camera); p.pov.afterRender();
  check(rig.robot.visible && rig.legs[0].coxa.visible, 'POV restores mesh visibility after rendering');
  p.pov.toggle(); check(engine.camera.position.distanceTo(previousCamera) < 1e-7, 'POV returns to the previous camera');
  p.walking = false; cameraController.toggle(); p.pov.toggle(); p.pov.toggle();
  check(cameraController.mode === 'TOP', 'POV works paused and restores TOP mode');

  reset(); target.mesh.position.copy(lane); animatePlayer(); frames(15);
  combat.damageLeaper(600);
  check(combat.dead && combat.leaperHealth === 0 && !p.walking && combat.tree.started === null && combat.bolts.length === 0, 'Leaper death stops attacks and clears pending shots');
  reset(); for (let i = 0; i < 13; i++) combat.damageLola();
  check(combat.lolaHealth === 0 && target.defeated && !p.walking, 'Lola defeat clamps health and ends encounter');
  const position = target.mesh.position.clone(); target.move(1, 0, new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0), 4.5, 0.1);
  check(target.mesh.position.distanceTo(position) === 0, 'defeated Lola cannot move');
  reset(); check(combat.lolaHealth === 100 && combat.leaperHealth === 600 && !target.defeated && combat.bolts.length === 0, 'restart restores both health pools and control');

  // Detect any accidental weapon-to-trained-sensing coupling.
  const fakeSight = { playtest: p, bones };
  const before = EyeVision.prototype.pose.call(fakeSight);
  rig.eyePivot.rotation.y += 0.3;
  const after = EyeVision.prototype.pose.call(fakeSight);
  check(JSON.stringify(before) === JSON.stringify(after), 'weapon aim does not change the saved-brain sensing pose');
  target.mesh.position.copy(base);
  result.textContent += `\n\nALL ${passed} CHECKS PASSED`;
  document.title = `PASS ${passed} · Leaper combat regression`;
} catch (error) {
  result.textContent += `\nFAIL: ${error.stack}`; document.title = 'FAIL · Leaper combat regression';
  console.error(error);
}
