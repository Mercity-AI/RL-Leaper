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
import { PlayerWeapon } from '../src/simulation/PlayerWeapon.js';
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
  frames(3); check(combat.bolts.length === 1, 'one red bolt fires after the warning');
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
  check(target.hitDirection.dot(combat.direction) > 0.8, 'actual bolt collision passes its travel direction into hit recoil');
  check(combat.hud.querySelector('[data-health-bar]').value === 92 && !combat.hud.textContent.includes('100'), 'damage updates the visible health HUD');

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
  combat.reset(); combat.damageLola();
  check(document.documentElement.style.getPropertyValue('--damage-flash') === '0', 'ordinary damage does not tint screen edges');
  for (let i = 0; i < 9; i++) combat.damageLola();
  check(combat.lolaHealth === 20 && Number(document.documentElement.style.getPropertyValue('--damage-flash')) > 0, 'screen-edge warning begins at 20 HP');
  combat.reset();
  check(document.documentElement.style.getPropertyValue('--damage-flash') === '0', 'restart clears critical-health screen tint');
  check(document.querySelector('#leaperHealthHud progress').value === 600 && !combat.healthBar, 'Leaper health is in screen HUD, not a world-space bar');
  reset();
  cameraController.mode = 'CHASE';
  p.playerWeapon = new PlayerWeapon(p);
  target.mesh.position.copy(lane);
  target.mesh.rotation.y = Math.PI;
  const center = rig.robot.getWorldPosition(new THREE.Vector3());
  engine.camera.position.copy(target.mesh.position).add(new THREE.Vector3(0, 1.5 * scale, 2 * scale));
  engine.camera.lookAt(center); engine.camera.updateMatrixWorld(true);
  check(p.playerWeapon.fire(), 'left-click weapon path accepts a live standing shot');
  check(combat.leaperHealth === 598, 'real player bullet damages the actual Leaper mesh');
  check(!p.playerWeapon.fire(), 'weapon firing interval prevents duplicate bullets');
  p.playerWeapon.reset(); target.crouching = true;
  check(p.playerWeapon.fire() && target.shot.action.getClip().name === 'CrouchShoot', 'crouched firing selects authored crouch shot');
  p.playerWeapon.reset();
  const gunOrigin = target.muzzlePosition();
  const shield = new THREE.Mesh(new THREE.BoxGeometry(30, 30, 0.01), new THREE.MeshBasicMaterial());
  shield.position.copy(gunOrigin).lerp(center, 0.5);
  const shieldGroup = new THREE.Group(); shieldGroup.add(shield);
  const normalGeometry = combat.geometry;
  combat.geometry = new CombatGeometry(shieldGroup);
  const beforeCover = combat.leaperHealth;
  p.playerWeapon.fire();
  check(combat.leaperHealth === beforeCover, 'thin cover blocks instant player bullets');
  combat.geometry = normalGeometry;
  p.playerWeapon.reset(); p.walking = false;
  check(!p.playerWeapon.fire(), 'paused playtest cannot shoot');
  p.walking = true; p.pov.toggle();
  check(!p.playerWeapon.fire(), 'spectator POV cannot redirect or fire player weapon');
  p.pov.toggle(); target.switchWeapon(); target.crouching = false;
  check(p.playerWeapon.fire(), 'second gun fires after switching');
  p.playerWeapon.reset();
  target.weaponIndex = 0; target.showWeapon(); p.playerWeapon.lastWeapon = 0;
  const healthBeforeBurst = combat.leaperHealth;
  p.playerWeapon.held = true; p.playerWeapon.fire(); p.playerWeapon.update(0.12);
  check(combat.leaperHealth === healthBeforeBurst - 4, 'held M416 fires a second bullet at rifle cadence');
  p.playerWeapon.held = false; p.playerWeapon.update(0.4);
  check(combat.leaperHealth === healthBeforeBurst - 4 && p.playerWeapon.effects.length === 0, 'release stops rifle and all particles disappear');
  p.playerWeapon.reset(); target.switchWeapon(); p.playerWeapon.lastWeapon = 1;
  const healthBeforePistol = combat.leaperHealth;
  p.playerWeapon.held = true; p.playerWeapon.fire(); p.playerWeapon.update(0.6);
  check(combat.leaperHealth === healthBeforePistol - 6, 'pistol fires only once per press even while held');
  p.playerWeapon.reset();
  target.switchWeapon(); p.playerWeapon.lastWeapon = 0; p.playerWeapon.held = true;
  target.switchWeapon(); p.playerWeapon.update(0);
  check(!p.playerWeapon.held, 'switching guns cancels held automatic fire');
  p.playerWeapon.reset(); combat.leaperHealth = 6;
  p.playerWeapon.fire();
  check(combat.leaperHealth === 0 && combat.hud.querySelector('[data-result] strong').textContent === 'LEAPER DEFEATED', 'player gunshot earns a real defeat, not a debug result');
  p.playerWeapon.reset(); combat.reset();
  check(!target.shot && !p.playerWeapon.effects.length, 'reset clears shooting pose and transient effects');
  target.mesh.position.copy(base);
  check(Math.abs(world.width - 2.88) < 1e-8, 'default Leaper clearance is 20 percent larger');
  check(Math.abs(target.height / scale - 1.71) < 1e-8, 'Lola is 10 percent shorter');
  target.crouching = false; target.cancelShot(); animatePlayer(0.2);
  combat.damageLola(); animatePlayer(0.08);
  check(target.hitRecoilTime > 0 && target.outfits.every(o => o.hitBase), 'bolt damage produces torso recoil on both outfits');
  const active = target.outfits[target.weaponIndex];
  target.mesh.updateMatrixWorld(true);
  const hitHead = bones[target.weaponIndex][0].getWorldPosition(new THREE.Vector3());
  const hitRotation = active.hitBone.quaternion.clone();
  active.hitBone.quaternion.copy(active.hitBase); target.mesh.updateMatrixWorld(true);
  const neutralHead = bones[target.weaponIndex][0].getWorldPosition(new THREE.Vector3());
  active.hitBone.quaternion.copy(hitRotation);
  check(hitHead.z < neutralHead.z, 'torso flinch moves the head backward rather than forward');
  animatePlayer(0.7);
  check(target.hitRecoilTime === 0 && target.outfits.every(o => !o.hitBase), 'hit recoil recovers without accumulating bone offsets');
  combat.damageLola(); animatePlayer(0.08); combat.reset();
  check(target.hitRecoilTime === 0 && target.outfits.every(o => !o.hitBase), 'encounter reset clears hit recoil');
  result.textContent += `\n\nALL ${passed} CHECKS PASSED`;
  document.title = `PASS ${passed} · Leaper combat regression`;
  if (new URLSearchParams(location.search).has('playerPreview')) {
    const query = new URLSearchParams(location.search);
    target.weaponIndex = query.get('gun') === 'basic' ? 1 : 0;
    target.crouching = query.has('crouch'); target.showWeapon(); target.startShot();
    target.move(0, 0, new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0), 4.5, 0.15);
    if (query.has('hit')) { combat.damageLola(new THREE.Vector3(0, 0, query.has('rear') ? 1 : -1)); animatePlayer(0.12); }
    const focus = target.mesh.position.clone().add(new THREE.Vector3(0, scale, 0));
    engine.camera.position.copy(focus).add(new THREE.Vector3(2.5, 0.3, 2.5).multiplyScalar(scale));
    engine.camera.up.set(0, 1, 0); engine.camera.lookAt(focus); result.hidden = true;
    engine.renderer.render(engine.scene, engine.camera);
  }
  if (new URLSearchParams(location.search).has('impactPreview')) {
    combat.reset(); p.playerWeapon.reset(); target.mesh.position.copy(lane);
    target.mesh.rotation.y = Math.PI; cameraController.mode = 'CHASE'; p.walking = true;
    engine.camera.position.copy(target.mesh.position).add(new THREE.Vector3(0, 1.5 * scale, 2 * scale));
    engine.camera.lookAt(center); engine.camera.updateMatrixWorld(true);
    p.playerWeapon.fire(); p.playerWeapon.visuals.update(0.055);
    engine.camera.position.copy(center).add(new THREE.Vector3(5, 3, 7));
    engine.camera.lookAt(center); result.hidden = true;
    p.playerWeapon.beforeRender(); engine.renderer.render(engine.scene, engine.camera); p.playerWeapon.afterRender();
  }
  if (new URLSearchParams(location.search).has('laserPreview')) {
    combat.reset(); target.mesh.position.copy(lane); animatePlayer();
    combat.pose(); combat.track(combat.pose()[1]); combat.fire();
    combat.updateProjectiles(2.4 / COMBAT.projectileSpeed, combat.pose());
    const bolt = combat.bolts[0];
    const focus = bolt.mesh.position.clone().addScaledVector(bolt.direction, -COMBAT.laserLength * scale / 2);
    engine.camera.position.copy(focus).add(new THREE.Vector3(5, 2, 2));
    engine.camera.up.set(0, 1, 0); engine.camera.lookAt(focus);
    result.hidden = true;
    engine.renderer.render(engine.scene, engine.camera);
  }
} catch (error) {
  result.textContent += `\nFAIL: ${error.stack}`; document.title = 'FAIL · Leaper combat regression';
  console.error(error);
}
