// Browser-only integration checks using actual GLB map, animated Lola, and rig.
// Serve with Vite; this page is separate from the production entry point.
import * as THREE from 'three';
import '../src/styles/junkyard.css';
import { createScene } from '../src/core/createScene.js';
import { createJunkyardWorld } from '../src/world/createJunkyardWorld.js';
import { createHexapod } from '../src/robot/createHexapod.js';
import { LolaPlayer } from '../src/robot/LolaPlayer.js';
import { EyeVision } from '../src/simulation/EyeVision.js';
import { LeaperCombat } from '../src/simulation/LeaperCombat.js';
import { CameraController } from '../src/camera/CameraController.js';
import { LeaperPov } from '../src/camera/LeaperPov.js';
import { CombatGeometry } from '../src/simulation/CombatGeometry.js';
import { LeaperSimulation } from '../src/simulation/LeaperSimulation.js';
import { PlayerWeapon } from '../src/simulation/PlayerWeapon.js';
import { InputController } from '../src/input/InputController.js';
import { PlayerController } from '../src/game/PlayerController.js';
import { PauseOverlay } from '../src/game/PauseOverlay.js';
import { Hitboxes } from '../src/weapons/Hitboxes.js';
import { traceSight } from '../src/weapons/resolveShot.js';
import { WEAPONS } from '../src/config/weapons.js';
import { CAMERA } from '../src/config/camera.js';
import { LaserAudio } from '../src/simulation/LaserAudio.js';
import { PlayerVitals } from '../src/game/PlayerVitals.js';
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
    simulation: { rig, state: { yaw: 0 } }, stop() { this.walking = false; }, reset() { this.vitals.reset(); this.combat.reset(); },
    // One Leaper here, so a finished combat always ends the run (the game asks its Encounter).
    combatFinished() { this.stop(); } };
  // The game creates one sound engine and Lola's health (PlayerVitals) and hands them to combat.
  p.audio = new LaserAudio(); p.vitals = new PlayerVitals({ player: target, audio: p.audio });
  p.combat = new LeaperCombat(p); p.pov = new LeaperPov(p);
  const combat = p.combat, scale = world.scale;
  combat.audio.unlock();
  await combat.audio.ready;
  check(['laser', 'm416', 'pistol', 'leaper'].every(key => combat.audio.buffers[key]?.duration > 0), 'all four recorded effects load and decode in the browser');
  rig.robot.position.set(world.spawn.x, 2.32, world.spawn.z);
  function animatePlayer(dt = 0.1) { target.move(0, 0, new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0), 4.5, dt); }
  function tick(dt = 1 / 60) { combat.update(dt); p.pov.update(); }
  function frames(n) { for (let i = 0; i < n; i++) tick(); }
  function reset() { p.vitals.reset(); combat.reset(); p.walking = true; target.crouching = false; target.resetJump(); animatePlayer(); }
  result.textContent = 'REAL-ASSET BROWSER COMBAT CHECKS';
  reset(); tick(0);
  // Find a clear front-facing lane at the real spawn, using physical map rays.
  const base = target.mesh.position.clone();
  let lane = null;
  // Straight ahead first, then a little to either side (within the eye's turn):
  // junkyard_v2 has scenery straight in front of the spawn at some distances.
  search: for (const angle of [0, 0.35, -0.35, 0.7, -0.7]) {
    for (const distance of [5, 7, 9, 12]) {
      target.mesh.position.set(world.spawn.x + Math.sin(angle) * distance * scale, 0, world.spawn.z + Math.cos(angle) * distance * scale);
      animatePlayer(); combat.tree.reset(); tick(0);
      if (combat.tree.state === 'charging') { lane = target.mesh.position.clone(); break search; }
    }
  }
  // Lola facing the Leaper from the lane.
  const laneFacing = lane ? Math.atan2(world.spawn.x - lane.x, world.spawn.z - lane.z) : Math.PI;
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
  // Turret mode (review 5.1): with the brain offline a run still tracks and fires.
  p.brain.ready = false; p.brain.offline = true;
  target.mesh.position.copy(lane); reset(); tick(0); frames(40);
  check(combat.tree.shots > 0, 'with the brain offline the run still tracks and fires (turret mode)');
  p.brain.ready = true; p.brain.offline = false; combat.reset();

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
  check(p.vitals.element.querySelector('[data-health-bar]').value === 92 && !p.vitals.element.textContent.includes('100'), 'damage updates the visible health HUD');

  reset(); target.mesh.position.copy(lane); animatePlayer(); tick(0);
  const standingHead = combat.pose()[0].y;
  target.crouching = true; for (let i = 0; i < 20; i++) animatePlayer(0.05);
  check(combat.pose()[0].y < standingHead - 0.1 * scale, 'hit anchors follow actual crouch animation');
  // The authored jump peaks around frame 29 of 30 fps, played 50% faster (~0.63 s after the key press).
  target.jump(); for (let i = 0; i < 13; i++) animatePlayer(0.05);
  check(combat.pose()[0].y > standingHead, 'hit anchors follow Lola while jumping');
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
  combat.reset(); p.vitals.reset();
  check(document.documentElement.style.getPropertyValue('--damage-flash') === '0', 'restart clears critical-health screen tint');
  // Floating Leaper health bar: hidden until a burst of real damage, then drains and fades.
  const worldBar = document.querySelector('#leaperWorldBar');
  combat.update(0.1);
  check(Number(worldBar.style.opacity) === 0, 'Leaper health bar stays hidden without damage');
  combat.damageLeaper(2); combat.update(0.1);
  check(Number(worldBar.style.opacity) === 0, 'a single small rifle hit does not pop up the Leaper bar');
  for (let i = 0; i < 6; i++) combat.damageLeaper(2);
  for (let i = 0; i < 5; i++) combat.update(0.1);
  check(Number(worldBar.style.opacity) === 1 && Math.abs(Number(worldBar.style.getPropertyValue('--hp')) - 586 / 600) < 1e-3,
    'a burst of damage shows the floating bar at the Leaper\'s current health');
  const rgb = () => worldBar.style.getPropertyValue('--hp-colour').match(/\d+/g).map(Number);
  check(rgb()[0] >= 245 && rgb()[1] > 100 && rgb()[1] < 130, `near-full Leaper bar is hot orange (${rgb()})`);
  combat.damageLeaper(2); combat.update(1 / 60);
  check(worldBar.dataset.flash === 'true' && /scale\(1\.1/.test(worldBar.style.transform), 'each hit flashes the bar white and punches its scale');
  combat.update(1 / 60); combat.update(1 / 60);
  check(worldBar.dataset.flash === 'false', 'the white flash lasts only a couple of frames');
  combat.update(0.3);
  check(/scale\(1(\.000)?\)/.test(worldBar.style.transform), `the scale punch eases back to normal size (${worldBar.style.transform})`);
  const chaseFov = engine.camera.fov;
  engine.camera.fov = 2 * THREE.MathUtils.radToDeg(Math.atan(Math.tan(THREE.MathUtils.degToRad(55) / 2) / 1.5));
  combat.update(1 / 60);
  check(/scale\(1\.5/.test(worldBar.style.transform), `aiming's 1.5x zoom also enlarges the bar 1.5x (${worldBar.style.transform})`);
  engine.camera.fov = chaseFov;
  check(worldBar.querySelector('.bar-eye-core'), 'the bar starts with the Leaper eye badge');
  // Big hits (a leg snapping off) and a severed leg piece landing shake the camera.
  cameraController.shakeStrength = 0;
  combat.damageLeaper(1, false, true);
  check(cameraController.shakeStrength > 0, 'a big hit shakes the camera');
  cameraController.shakeStrength = 0;
  combat.legs.onLanded({});
  check(cameraController.shakeStrength > 0, 'a severed leg piece hitting the ground shakes the camera');
  const shakeFrom = cameraController.shakeStrength;
  cameraController.update({ position: new THREE.Vector3(), jumpHeight: 0 }, rig.eyePivot, 0.5);
  check(cameraController.shakeStrength < shakeFrom && cameraController.shakeStrength >= 0, 'camera shake fades out');
  cameraController.update({ position: new THREE.Vector3(), jumpHeight: 0 }, rig.eyePivot, 1);
  check(cameraController.shakeStrength === 0, 'camera shake is over within about a second');
  combat.leaperHealth = 90; combat.damageLeaper(1); combat.update(0.1);
  check(worldBar.dataset.level === 'low' && rgb()[0] < 200 && rgb()[1] < 40, `nearly dead Leaper bar turns deep red and throbs (${rgb()})`);
  for (let i = 0; i < 50; i++) combat.update(0.1);
  check(Number(worldBar.style.opacity) === 0, 'the floating bar fades after a few quiet seconds');
  reset();
  check(combat.core?.userData.weakPoint && combat.core.material.emissiveIntensity >= 0, 'Leaper eye has a glowing red weak-point core');
  cameraController.mode = 'CHASE';
  // The game's input actions: the weapon reads them once per frame (frame()), and
  // PlayerController applies the gun keys (keyFrame()). Nothing fires from a page event.
  const input = new InputController();
  p.simulation.input = input;
  p.playerWeapon = new PlayerWeapon(p);
  // Bullets go dead centre here (no random spread), so each check hits what it aims at.
  p.playerWeapon.random = () => 0;
  const frame = (dt = 1 / 60) => { input.poll(); p.playerWeapon.update(dt); };
  const keyController = new PlayerController({ player: target, input,
    cameraController: { getMovementHeading: () => target.mesh.rotation.y, requestPause() {}, requestResume() {}, lookBy() {} } });
  const keyFrame = (options) => { keyController.sample(1 / 60, options); keyController.update(options?.frozen ? 0 : 1 / 60); };
  const pressKey = (code, options) => {
    window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
    keyFrame(options);
    window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }));
  };
  const leaperTarget = [...p.playerWeapon.targets.targets][0];
  check(leaperTarget?.hitboxes.volumes.length === 45, 'the Leaper is shot through 45 hit volumes (body, 6 hip fins, eye, core, 6 per leg), not its meshes');
  target.mesh.position.copy(lane);
  target.mesh.rotation.y = laneFacing;
  const center = rig.robot.getWorldPosition(new THREE.Vector3());
  // The camera just behind Lola, on the far side of her from the Leaper.
  engine.camera.position.copy(target.mesh.position)
    .add(new THREE.Vector3(-Math.sin(laneFacing) * 2 * scale, 1.5 * scale, -Math.cos(laneFacing) * 2 * scale));
  // Aim at the upper shell: dead centre from the front is the eye's weak-point core.
  rig.robot.updateMatrixWorld(true);
  const bodyPoint = rig.robot.localToWorld(new THREE.Vector3(0, 0.3, 0.1));
  engine.camera.lookAt(bodyPoint); engine.camera.updateMatrixWorld(true);
  const audioEvents = [];
  const recordedPlay = combat.audio.play.bind(combat.audio);
  combat.audio.play = key => { audioEvents.push(key); return recordedPlay(key); };
  check(p.playerWeapon.fire(), 'left-click weapon path accepts a live standing shot');
  check(audioEvents.includes('m416') && audioEvents.includes('leaper') && !audioEvents.includes('scenery'), 'rifle hit plays rifle shot and Leaper metal sound only');
  check(combat.leaperHealth === 598, 'real player bullet damages the Leaper through its body hit volume');
  check(p.playerWeapon.lastShot.hit.hit.zone === 'body' && p.playerWeapon.reticle.dataset.marker === 'normal',
    'a body hit shows the normal hit marker');
  check(!p.playerWeapon.fire(), 'weapon firing interval prevents duplicate bullets');
  p.playerWeapon.reset();
  engine.camera.lookAt(combat.core.getWorldPosition(new THREE.Vector3())); engine.camera.updateMatrixWorld(true);
  const beforeCore = combat.leaperHealth;
  check(p.playerWeapon.fire() && combat.leaperHealth === beforeCore - 4 && p.playerWeapon.reticle.dataset.crit === 'true',
    `eye-core weak point takes double damage (${beforeCore - combat.leaperHealth})`);
  check(p.playerWeapon.reticle.dataset.marker === 'weak', 'a weak-point hit shows the weak-point marker');
  engine.camera.lookAt(bodyPoint); engine.camera.updateMatrixWorld(true);
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
  audioEvents.length = 0;
  p.playerWeapon.fire();
  check(audioEvents.includes('leaper') && !audioEvents.includes('scenery'), 'scenery uses the same impact recording as the Leaper');
  check(combat.leaperHealth === beforeCover, 'thin cover blocks instant player bullets');
  combat.geometry = normalGeometry;
  p.playerWeapon.reset(); p.walking = false;
  check(p.playerWeapon.fire(), 'Lola can fire while the Leaper run is stopped (stopped, not paused)');
  p.playerWeapon.reset(); p.paused = true;
  check(!p.playerWeapon.fire(), 'nobody can fire while the game is paused (Escape)');
  p.paused = false; p.playerWeapon.reset();
  p.walking = true; p.pov.toggle();
  check(!p.playerWeapon.fire(), 'spectator POV cannot redirect or fire player weapon');
  p.pov.toggle(); target.switchWeapon(); target.crouching = false;
  audioEvents.length = 0;
  check(p.playerWeapon.fire(), 'second gun fires after switching');
  check(audioEvents.includes('pistol') && audioEvents.includes('leaper') && !audioEvents.includes('m416'), 'basic gun plays the supplied pistol shot and shared impact sound');
  combat.audio.play = recordedPlay;
  p.playerWeapon.reset();
  // Exercise the real mouse buttons through the input actions rather than only calling fire().
  const canvas = engine.renderer.domElement;
  const clickShot = () => { canvas.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true, shiftKey: true })); frame(0); };
  const release = (button = 0) => window.dispatchEvent(new MouseEvent('mouseup', { button }));
  for (const weaponIndex of [0, 1]) {
    target.weaponIndex = weaponIndex; target.showWeapon(); p.playerWeapon.reset();
    p.walking = false; p.brain.ready = false;
    const health = combat.leaperHealth, weapon = p.playerWeapon.weapon, damage = weapon.damage;
    p.paused = true; frame(0); clickShot();
    check(combat.leaperHealth === health, `${weaponIndex ? 'pistol' : 'M416'} left click does nothing while paused`);
    release(); p.paused = false; frame(0);
    check(combat.leaperHealth === health, `${weaponIndex ? 'pistol' : 'M416'} a click made during the pause is not replayed afterwards`);
    clickShot();
    check(combat.leaperHealth === health - damage, `${weaponIndex ? 'pistol' : 'M416'} left click fires without starting the brain`);
    // Holding the button for one more shot's time: the M416 is automatic, the pistol one shot per click.
    const held = weaponIndex ? 1 : 2;
    frame(weapon.interval + 0.001);
    check(combat.leaperHealth === health - damage * held, weaponIndex
      ? 'pistol never auto-repeats while mouse remains down' : 'M416 keeps firing while mouse remains down');
    release();
    frame(1);
    check(combat.leaperHealth === health - damage * held, `${weaponIndex ? 'pistol' : 'M416'} stops when the mouse is released`);
    clickShot();
    check(combat.leaperHealth === health - damage * (held + 1), `${weaponIndex ? 'pistol' : 'M416'} fires again on the next left click`);
    release();
    frame(1);
    check(p.playerWeapon.effects.length === 0, 'click-shot effects leave no residue');
  }
  // The click that recaptures the mouse (after Alt-Tab, during a run) only does that (review 5.16).
  cameraController.gameplayStarted = true; p.playerWeapon.reset();
  const magazineBeforeCapture = p.playerWeapon.ammoState.mag, healthBeforeCapture = combat.leaperHealth;
  canvas.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'mouse', pointerId: 7, button: 0, bubbles: true }));
  canvas.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }));
  frame(1 / 60);
  check(p.playerWeapon.ammoState.mag === magazineBeforeCapture && combat.leaperHealth === healthBeforeCapture && !p.playerWeapon.triggerHeld,
    'the click that recaptures the mouse does not fire');
  window.dispatchEvent(new PointerEvent('pointerup', { pointerType: 'mouse', pointerId: 7, button: 0 }));
  release();
  cameraController.releaseMouse(); cameraController.gameplayStarted = false;
  // The click on the pause overlay that resumes the game never fires either.
  const overlay = new PauseOverlay({ onResume: () => { p.paused = false; } });
  p.paused = true; overlay.render({ name: 'paused' }); frame(0);
  overlay.element.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'mouse', button: 0, bubbles: true }));
  overlay.element.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }));
  overlay.element.dispatchEvent(new MouseEvent('click', { button: 0, bubbles: true }));
  frame(1 / 60);
  check(!p.paused && p.playerWeapon.ammoState.mag === magazineBeforeCapture && !p.playerWeapon.triggerHeld,
    'the click that resumes from the pause overlay does not fire');
  release(); overlay.dispose();
  p.walking = true; p.brain.ready = true;
  // 1 / 2 are input actions now: applied by the player's controls each frame, frozen by a pause.
  pressKey('Digit2', { frozen: true });
  keyFrame();
  check(target.weaponIndex === 1, '2 does nothing while paused');
  pressKey('Digit2');
  check(target.weaponIndex === 0, '2 switches from pistol to M416');
  pressKey('Digit1');
  check(target.weaponIndex === 1, '1 switches back to pistol');
  const slots = [...document.querySelectorAll('#playerGuns .gun')];
  check(slots[0].dataset.gun === 'pistol' && slots[0].textContent.trim() === '1' && slots[1].dataset.gun === 'm416',
    'gun icons read pistol (1) then M416 (2), left to right');
  for (const weaponIndex of [0, 1]) {
    pressKey(weaponIndex ? 'Digit1' : 'Digit2');
    const weapon = p.playerWeapon, name = weaponIndex ? 'pistol' : 'M416';
    const sounds = [], play = combat.audio.play;
    combat.audio.play = key => { sounds.push(key); return play.call(combat.audio, key); };
    weapon.reset();
    weapon.ammo[weaponIndex].mag = 0;
    weapon.update(1 / 60);
    check(target.reloading && weapon.reloadRemaining > 0, `${name}: empty magazine starts the reload animation automatically`);
    check(target.outfits[weaponIndex].reload.gun.visible && !target.outfits[weaponIndex].carriedGun.visible,
      `${name}: the reload gun is shown in her hands`);
    check(document.querySelector(`#playerGuns [data-gun=${weaponIndex ? 'pistol' : 'm416'}]`).dataset.level === 'reloading',
      `${name}: the gun icon refills while reloading`);
    for (let i = 0; i < 100; i++) { animatePlayer(1 / 60); weapon.update(1 / 60); }
    combat.audio.play = play;
    check(sounds.includes(weaponIndex ? 'pistolReload' : 'm416Reload'), `${name}: reload sound plays during the animation`);
    check(!target.reloading && weapon.ammo[weaponIndex].mag === WEAPONS[weaponIndex ? 'pistol' : 'm416'].magazine,
      `${name}: magazine refills as the reload animation ends`);
  }
  p.playerWeapon.reset();
  // The HUD views are handed their data several times a frame; with nothing
  // changing they must not touch the page at all (no restyling every frame).
  {
    const watched = [p.playerWeapon.weaponHud.element, p.playerWeapon.reticleView.root];
    const observer = new MutationObserver(() => {});
    for (const element of watched) observer.observe(element, { attributes: true, childList: true, subtree: true, characterData: true });
    p.playerWeapon.renderHud();
    observer.takeRecords();
    for (let i = 0; i < 5; i++) p.playerWeapon.renderHud();
    const writes = observer.takeRecords().length;
    observer.disconnect();
    check(writes === 0, `the gun icons and crosshair are not rewritten when nothing changed (${writes} writes)`);
  }
  const savedCameraPosition = engine.camera.position.clone(), savedCameraRotation = engine.camera.quaternion.clone();
  // Look angles that point the eye-level aim view at a point.
  function pointAimAt(point) {
    const direction = point.clone().sub(target.eyePosition()).normalize();
    cameraController.yaw = Math.atan2(-direction.x, -direction.z);
    cameraController.pitch = -Math.asin(direction.y);
  }
  pointAimAt(center);
  const aimHeading = cameraController.getMovementHeading(0);
  canvas.dispatchEvent(new MouseEvent('mousedown', { button: 2, buttons: 2, bubbles: true }));
  frame(0);
  check(target.aimHeld && cameraController.aiming && target.shot, 'right mouse raises the gun without firing');
  check(engine.camera.position.distanceTo(target.eyePosition()) < 1e-7, 'right mouse immediately enters Lola eye position before firing');
  // First-person aim: only the parts the camera sits inside stop drawing.
  const lolaMaterial = (name) => { let found = null; target.mesh.traverse(o => { if (o.material?.name === name) found = o.material; }); return found; };
  const face = lolaMaterial('face'), top = lolaMaterial('Top'), arms = lolaMaterial('arms');
  check(face && !face.colorWrite && !face.depthWrite && top.colorWrite && arms.colorWrite && target.mesh.visible,
    'first-person aim hides only Lola\'s head and neck; her body, arms and gun stay drawn');
  p.playerWeapon.beforeRender();
  check(target.mesh.visible && face.visible, 'no render hook hides Lola: her shadow stays on the ground while aiming');
  p.playerWeapon.afterRender();
  for (const gun of [0, 1]) {
    target.cancelShot(); target.weaponIndex = gun; target.showWeapon(); target.holdAim();
    pointAimAt(center); p.playerWeapon.setAiming(true); p.playerWeapon.update(1);
    const healthBeforeAimedClick = combat.leaperHealth;
    canvas.dispatchEvent(new MouseEvent('mousedown', { button: 0, buttons: 3, bubbles: true }));
    frame(0);
    check(target.aimHeld && combat.leaperHealth < healthBeforeAimedClick,
      (gun === 0 ? 'M416' : 'pistol') + ' fires and deals damage with both mouse buttons held');
    window.dispatchEvent(new MouseEvent('mouseup', { button: 0, buttons: 2, bubbles: true }));
    frame(0);
    check(target.aimHeld && cameraController.aiming, 'releasing left mouse keeps right-mouse zoom active');
  }
  const aimHealth = combat.leaperHealth;
  animatePlayer(2); p.playerWeapon.update(2);
  check(target.shot && combat.leaperHealth === aimHealth, 'held aim maintains pose without spending damage');
  cameraController.update(p.simulation.state, rig.eyePivot, 1);
  const magnification = Math.tan(THREE.MathUtils.degToRad(55) / 2) / Math.tan(THREE.MathUtils.degToRad(engine.camera.fov) / 2);
  check(Math.abs(magnification - 1.35) < 0.001, 'held aim produces 1.35x optical zoom');
  check(getComputedStyle(p.playerWeapon.reticle, '::before').content === 'none', 'no ring around the aiming crosshair');
  // Entering the aim may turn slightly so the crosshair stays on the same point
  // (the eye sits off the chase camera's axis), but never swings the heading.
  const headingDrift = Math.abs(Math.atan2(Math.sin(cameraController.getMovementHeading(0) - aimHeading),
    Math.cos(cameraController.getMovementHeading(0) - aimHeading)));
  check(headingDrift < THREE.MathUtils.degToRad(5), `zoom preserves movement direction (drift ${THREE.MathUtils.radToDeg(headingDrift).toFixed(2)}°)`);
  check(engine.camera.position.distanceTo(target.eyePosition()) < 1e-7, 'aim camera follows the animated eye position');
  const standingEye = engine.camera.position.y;
  target.crouching = true; target.cancelShot(); animatePlayer(0.5); target.holdAim();
  cameraController.update(p.simulation.state, rig.eyePivot, 1);
  check(engine.camera.position.y < standingEye && engine.camera.position.distanceTo(target.eyePosition()) < 1e-7, 'crouching lowers the first-person eye camera');
  target.crouching = false; target.cancelShot(); animatePlayer(0.5); target.holdAim();
  window.dispatchEvent(new MouseEvent('mouseup', { button: 2, bubbles: true }));
  frame(0);
  cameraController.update(p.simulation.state, rig.eyePivot, 1); animatePlayer(0.2);
  check(!target.aimHeld && !cameraController.aiming && !target.shot && Math.abs(engine.camera.fov - 55) < 0.001, 'right release restores normal view and pose');
  check(engine.camera.position.distanceTo(target.eyePosition()) > target.height, 'release returns to the third-person chase camera');
  check(face.colorWrite && face.depthWrite, 'leaving the aim draws Lola\'s head again');
  canvas.dispatchEvent(new MouseEvent('mousedown', { button: 2, bubbles: true }));
  frame(0);
  window.dispatchEvent(new Event('blur'));
  check(!target.aimHeld && !target.shot && !cameraController.aiming, 'focus loss clears held aim');
  canvas.dispatchEvent(new MouseEvent('mousedown', { button: 2, bubbles: true }));
  frame(0);
  p.pov.toggle(); p.playerWeapon.update(0);
  check(!target.aimHeld && !cameraController.aiming, 'spectator entry clears player aiming');
  p.pov.toggle(); release(2); frame(0);
  // A pause while aiming steeply up: the gun lets go of the aim, and the chase
  // camera must come back inside its own limits instead of staying at the aim's
  // pitch (which puts the boom under the floor, looking up at Lola).
  const savedLook = { yaw: cameraController.yaw, pitch: cameraController.pitch };
  canvas.dispatchEvent(new MouseEvent('mousedown', { button: 2, bubbles: true }));
  frame(0);
  cameraController.lookBy(0, -10);
  const steepAim = cameraController.pitch;
  p.paused = true; frame(0);
  check(steepAim < CAMERA.chasePitch.low && !cameraController.aiming
    && cameraController.pitch >= CAMERA.chasePitch.low && cameraController.pitch <= CAMERA.chasePitch.high,
  `a pause during a steep aim brings the chase camera back inside its limits (${steepAim.toFixed(2)} -> ${cameraController.pitch.toFixed(2)})`);
  p.paused = false; release(2); frame(0); Object.assign(cameraController, savedLook, { viewPitchOffset: 0 });
  engine.camera.position.copy(savedCameraPosition); engine.camera.quaternion.copy(savedCameraRotation); engine.camera.updateMatrixWorld(true);
  p.playerWeapon.reset(); combat.leaperHealth = p.playerWeapon.weapon.damage;
  p.playerWeapon.fire();
  // The banner text itself is the encounter's (resultText, tested in node); combat reports the kill.
  check(combat.leaperHealth === 0 && combat.outcome.winner === 'lola' && !combat.outcome.debug, 'player gunshot earns a real defeat, not a debug result');
  check(p.playerWeapon.reticle.dataset.marker === 'kill' && p.playerWeapon.reticle.dataset.big === 'true', 'the kill shot shows the kill marker');
  // The end of the fight (review 5.2): a kill shot landed while aiming keeps its
  // tracer, sparks and shake; the aim lets go; Lola is free to walk afterwards.
  p.vitals.reset(); combat.reset(); p.playerWeapon.reset(); p.walking = true; target.cancelShot();
  target.weaponIndex = 0; target.showWeapon();
  // (The first kill's shake and recoil are dropped before the aim view is placed,
  // so this shot's aim doesn't depend on where that wobble happened to be.)
  cameraController.resetEffects();
  pointAimAt(center); p.playerWeapon.setAiming(true); p.playerWeapon.update(1 / 60);
  combat.leaperHealth = 2; cameraController.shakeStrength = 0;
  check(p.playerWeapon.fire() && combat.dead, 'an aimed shot can be the kill shot');
  check(p.playerWeapon.visuals.items.length > 0 && cameraController.shakeStrength > 0, 'the kill shot keeps its tracer, sparks and shake');
  const killShake = cameraController.shakeStrength;
  p.playerWeapon.update(1 / 60);
  check(p.playerWeapon.visuals.items.length > 0, 'a frame later the kill shot effects are still drawn (not wiped)');
  for (let i = 0; i < 19; i++) { p.playerWeapon.update(1 / 60); cameraController.update(p.simulation.state, rig.eyePivot, 1 / 60); }
  check(!cameraController.aiming && !target.aimHeld && engine.camera.fov > 50
    && engine.camera.position.distanceTo(target.eyePosition()) > 1, 'after the kill the aim lets go and the view returns to the chase camera');
  check(cameraController.shakeStrength < killShake, 'the kill shake plays out after the ending');
  for (let i = 0; i < 30; i++) p.playerWeapon.update(1 / 60);
  check(p.playerWeapon.visuals.items.length === 0, 'the kill shot effects fade out by themselves');
  const winSpot = target.mesh.position.clone();
  for (let i = 0; i < 10; i++) target.move(1, 0, new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0), 4.5, 1 / 30);
  check(!target.defeated && target.mesh.position.distanceTo(winSpot) > 0, 'after a win Lola can still walk up to the wreck');
  p.playerWeapon.ammo[0].mag = 3; p.playerWeapon.ammo[1].mag = 0; p.playerWeapon.resetEncounter(); cameraController.resetEffects();
  check(p.playerWeapon.ammo[0].mag === WEAPONS.m416.magazine && p.playerWeapon.ammo[1].mag === WEAPONS.pistol.magazine && !cameraController.shakeStrength,
    'a restart refills both magazines and drops any leftover shake');
  target.mesh.position.copy(winSpot);
  p.playerWeapon.reset(); combat.reset();
  check(!target.shot && !p.playerWeapon.effects.length, 'reset clears shooting pose and transient effects');
  // Pooled effects (review 5.40): twenty shots and their impacts add no GPU geometry.
  engine.camera.position.copy(savedCameraPosition); engine.camera.quaternion.copy(savedCameraRotation); engine.camera.updateMatrixWorld(true);
  // One warm-up shot first, so Lola's raised gun has been drawn once already.
  p.playerWeapon.remaining = 0; target.cancelShot(); p.playerWeapon.fire();
  engine.renderer.render(engine.scene, engine.camera);
  const geometriesBefore = engine.renderer.info.memory.geometries;
  for (let i = 0; i < 20; i++) {
    // (A full magazine each time: an empty one would start a reload, whose gun is a different model.)
    p.playerWeapon.ammoState.mag = WEAPONS.m416.magazine;
    p.playerWeapon.remaining = 0; target.cancelShot(); p.playerWeapon.fire(); p.playerWeapon.visuals.update(1 / 60);
    engine.renderer.render(engine.scene, engine.camera);
  }
  check(engine.renderer.info.memory.geometries === geometriesBefore,
    `twenty shots allocate no new GPU geometry (${geometriesBefore} -> ${engine.renderer.info.memory.geometries})`);
  p.playerWeapon.reset(); combat.reset();
  target.mesh.position.copy(base);
  check(Math.abs(world.defaultWidth - 2.88) < 1e-8, 'camera reference Leaper clearance is 20 percent larger');
  check(Math.abs(world.width - 5.5) < 1e-8, 'the junkyard starts at the owner\'s big Leaper size (5.5)');
  check(Math.abs(target.height / scale - 1.71) < 1e-8, 'Lola is 10 percent shorter');
  target.crouching = false; target.cancelShot(); animatePlayer(0.2);
  combat.damageLola(); animatePlayer(0.08);
  // Only the outfit on screen is animated; check each one while it is equipped.
  const recoilShown = () => target.hitRecoilTime > 0 && !!target.outfits[target.weaponIndex].hitBase;
  const recoilOnFirst = recoilShown(); target.switchWeapon(); const recoilOnSecond = recoilShown(); target.switchWeapon();
  check(recoilOnFirst && recoilOnSecond, 'bolt damage produces torso recoil on both outfits');
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
  combat.damageLola(); animatePlayer(0.08); combat.reset(); p.vitals.reset();
  check(target.hitRecoilTime === 0 && target.outfits.every(o => !o.hitBase), 'encounter reset clears hit recoil');
  // Exercise direct knee shots through the complete player firing path, against the hit volumes.
  const damageSim = new LeaperSimulation({ rig, cameraController, world });
  damageSim.state.position.set(world.spawn.x, 0, world.spawn.z);
  for (const leg of rig.legs) leg.footPosition.y = world.floorHeight + 0.075;
  damageSim.updateBody(0, 0); damageSim.updateGait(0, 0);
  const savedMuzzle = target.muzzlePosition, savedGeometry = combat.geometry;
  // The camera is placed by hand next to each knee (not behind Lola), so the sight
  // starts at the lens here: the chase camera's "start at Lola" rule needs Lola behind it.
  cameraController.followSubject = null;
  for (const [gun, joint, required] of [[0, 'lower', 8], [1, 'upper', 10]]) {
    combat.reset(); target.cancelShot(); target.weaponIndex = gun; target.showWeapon();
    cameraController.mode = 'CHASE';
    const leg = rig.legs[1], ball = joint === 'upper' ? leg.knee : leg.calfJoint;
    leg.damage[joint].threshold = required;
    engine.scene.updateMatrixWorld(true);
    leaperTarget.update();
    const center = ball.getWorldPosition(new THREE.Vector3());
    let shotOrigin;
    for (const offset of [new THREE.Vector3(2,0,0), new THREE.Vector3(0,0,2), new THREE.Vector3(0,2,0), new THREE.Vector3(-2,0,0)]) {
      const origin = center.clone().add(offset), direction = offset.clone().negate().normalize();
      const hit = p.playerWeapon.targets.raycast(origin, direction, 4);
      if (hit?.volume.joint === joint && hit.volume.leg === leg.index) { shotOrigin = origin; break; }
    }
    check(Boolean(shotOrigin), `${joint} knee joint's hit volume can be directly targeted`);
    combat.geometry = { hit: () => null, clear: () => true };
    target.muzzlePosition = () => shotOrigin.clone();
    engine.camera.position.copy(shotOrigin); engine.camera.lookAt(center); engine.camera.updateMatrixWorld(true);
    for (let i = 1; i <= required; i++) {
      target.cancelShot(); p.playerWeapon.remaining = 0;
      check(p.playerWeapon.fire(), `${joint} knee accepts shot ${i}`);
      check(combat.legs.debris.length === (i === required ? 1 : 0), `${joint} knee breaks only at its assigned threshold (${i}/${required})`);
    }
    check(p.playerWeapon.reticle.dataset.marker === 'joint', `${joint} knee: the snapping shot shows the joint-break marker`);
    leaperTarget.update();
    const after = p.playerWeapon.targets.raycast(shotOrigin, center.clone().sub(shotOrigin).normalize(), 4);
    check(leaperTarget.hitboxes.volumes.filter(volume => volume.object === ball).every(volume => !Hitboxes.enabled(volume))
      && !(after?.volume.object === ball), 'detached knee is excluded from player bullet targets');
    for (let i = 0; i < 300; i++) combat.legs.update(1/60);
    check(combat.legs.debris[0].settled, 'shot-off section settles on the real map');
  }
  target.muzzlePosition = savedMuzzle; combat.geometry = savedGeometry;
  cameraController.followSubject = target;
  combat.reset(); p.playerWeapon.reset();
  check(combat.legs.debris.length === 0 && rig.legs.every(l => !l.disabled), 'restart restores every knee and removes debris');

  // ---- Aiming down the sights reaches the upper knees up close (review 5.22) ----
  // Lola 5 units in front of the standing Leaper: a front upper knee is steeper
  // than the old aim limit (16.6 degrees up) but inside the new one, and an aimed
  // shot lands on its hit volume.
  combat.reset(); p.playerWeapon.reset(); p.walking = true;
  damageSim.updateBody(0, 0); damageSim.updateGait(0, 0); engine.scene.updateMatrixWorld(true);
  target.weaponIndex = 0; target.showWeapon(); target.crouching = false;
  target.mesh.position.set(world.spawn.x, 0, world.spawn.z + 5);
  target.mesh.rotation.y = Math.PI; animatePlayer(0.2);
  cameraController.yaw = 0; cameraController.pitch = 0.16; cameraController.mode = 'CHASE';
  cameraController.update(p.simulation.state, rig.eyePivot, 1);
  p.playerWeapon.setAiming(true);
  const OLD_AIM_UP = THREE.MathUtils.degToRad(16.6);
  leaperTarget.update();
  let kneeShot = null;
  for (const leg of rig.legs.filter(item => item.index <= 1)) {
    const knee = leg.knee.getWorldPosition(new THREE.Vector3());
    // Around the knee ball, the first spot the eye's centre ray hits that knee's volume.
    for (const [dx, dy] of [[0, 0], [0, 0.1], [0.1, 0], [-0.1, 0], [0, -0.1], [0, 0.15]]) {
      const spot = knee.clone().add(new THREE.Vector3(dx, dy, 0));
      cameraController.aimEyeAt(spot);
      cameraController.update(p.simulation.state, rig.eyePivot, 0);
      const ray = p.playerWeapon.cameraRay();
      const hit = p.playerWeapon.targets.raycast(ray.origin, ray.direction, 20);
      const elevation = Math.asin(ray.direction.y);
      if (hit?.volume.joint === 'upper' && hit.volume.leg === leg.index) { kneeShot = { leg, elevation, pitch: cameraController.pitch }; break; }
    }
    if (kneeShot) break;
  }
  check(Boolean(kneeShot), 'aiming at 5 units puts a front upper knee under the crosshair');
  check(kneeShot.elevation > OLD_AIM_UP && kneeShot.pitch < CAMERA.chasePitch.low && kneeShot.pitch > CAMERA.aimPitch.up,
    `that knee is ${THREE.MathUtils.radToDeg(kneeShot.elevation).toFixed(1)}° up: beyond the old 16.6° aim limit, inside the new one`);
  const kneeHits = kneeShot.leg.damage.upper.hits;
  target.cancelShot(); target.holdAim(); p.playerWeapon.remaining = 0;
  check(p.playerWeapon.fire() && kneeShot.leg.damage.upper.hits === kneeHits + 1, 'the aimed shot lands on that upper knee');
  p.playerWeapon.setAiming(false); p.playerWeapon.reset(); combat.reset();

  // ---- OBSTRUCTED: cover between the barrel and the crosshair's point ----
  // A low fence under the chase camera's sight line but in front of the gun: the
  // crosshair is on the Leaper, the bullet would hit the fence, and the reticle says so.
  target.mesh.position.copy(lane); target.mesh.rotation.y = laneFacing; animatePlayer(0.2);
  cameraController.yaw = 0; cameraController.pitch = 0.16;
  cameraController.update(p.simulation.state, rig.eyePivot, 1);
  frame(1 / 60);
  check(p.playerWeapon.reticle.dataset.blocked === 'false', 'a clear line from the barrel: no OBSTRUCTED reticle');
  const clearShot = p.playerWeapon.checkObstruction();
  const barrel = p.playerWeapon.muzzle.estimate(target, new THREE.Vector3());
  const along = 0.3;
  const fenceSpot = barrel.clone().lerp(clearShot.aimPoint, along);
  const sightRay = p.playerWeapon.cameraRay();
  const sightAtFence = new THREE.Ray(sightRay.origin.clone(), sightRay.direction.clone()).closestPointToPoint(fenceSpot, new THREE.Vector3());
  check(sightAtFence.y > fenceSpot.y + 0.2, 'the sight line passes clearly above the barrel line there');
  const fenceTop = (sightAtFence.y + fenceSpot.y) / 2;
  const fence = new THREE.Mesh(new THREE.BoxGeometry(4, fenceTop, 0.05));
  fence.position.set(fenceSpot.x, fenceTop / 2, fenceSpot.z);
  fence.lookAt(fenceSpot.x + clearShot.direction.x, fenceTop / 2, fenceSpot.z + clearShot.direction.z);
  const fenceGroup = new THREE.Group(); fenceGroup.add(fence);
  const fenceGeometry = new CombatGeometry(fenceGroup), mapGeometry = combat.geometry;
  combat.geometry = {
    hit(origin, direction, distance) {
      const a = mapGeometry.hit(origin, direction, distance), b = fenceGeometry.hit(origin, direction, distance);
      return !a ? b : !b ? a : a.distance <= b.distance ? a : b;
    },
    clear: (origin, point) => mapGeometry.clear(origin, point),
  };
  frame(1 / 60);
  const blockMarker = document.querySelector('.reticle-block');
  check(p.playerWeapon.reticle.dataset.blocked === 'true', 'low cover in front of the gun is noticed (OBSTRUCTED state)');
  // The owner's plain crosshair (2026-10-19): no cover marker and no grey-out are drawn.
  check(getComputedStyle(blockMarker).display === 'none' && getComputedStyle(p.playerWeapon.reticle).color !== 'rgb(154, 160, 166)',
    'the plain crosshair never greys out and shows no cover marker');
  const healthBeforeFence = combat.leaperHealth;
  target.cancelShot(); p.playerWeapon.fire();
  check(combat.leaperHealth === healthBeforeFence && p.playerWeapon.lastShot.hit?.kind === 'world', 'and the shot really does hit the cover');
  combat.geometry = mapGeometry;
  p.playerWeapon.reset(); frame(1 / 60);
  check(p.playerWeapon.reticle.dataset.blocked === 'false', 'the OBSTRUCTED reticle clears once the line is open again');

  // ---- A Leaper leg between the chase camera and Lola is never the aim point (review 5.5) ----
  // Lola stands just outside the standing Leaper's feet, facing away from it, so
  // the chase camera looks over her past its legs. The old lens trace aimed at
  // the leg behind her; the sight now starts at her depth and the shot flies on.
  combat.reset(); p.playerWeapon.reset();
  damageSim.updateBody(0, 0); damageSim.updateGait(0, 0); engine.scene.updateMatrixWorld(true);
  let legBehind = null;
  for (const leg of rig.legs) {
    const away = leg.footPosition.clone().sub(rig.robot.position).setY(0).normalize();
    const spot = leg.footPosition.clone().addScaledVector(away, 3.2);
    if (world.playerBlocked(spot.x, spot.z)) continue;
    target.mesh.position.set(spot.x, 0, spot.z); target.mesh.rotation.y = Math.atan2(away.x, away.z); animatePlayer(0.05);
    Object.assign(cameraController, { yaw: Math.atan2(away.x, away.z) + Math.PI, pitch: 0.16, viewPitchOffset: 0 });
    cameraController.update(p.simulation.state, rig.eyePivot, 1);
    leaperTarget.update();
    const ray = p.playerWeapon.cameraRay();
    const lensHit = p.playerWeapon.targets.raycast(ray.origin, ray.direction, p.playerWeapon.range);
    // Only spots where the lens ray really meets the Leaper before it reaches Lola.
    const lolaDepth = cameraController.chaseAnchor(new THREE.Vector3()).sub(ray.origin).dot(ray.direction);
    if (!lensHit || lensHit.distance >= lolaDepth) continue;
    const origin = ray.origin.clone(), forward = ray.direction.clone(), health = combat.leaperHealth;
    p.playerWeapon.reset(); target.cancelShot();
    if (!p.playerWeapon.fire()) continue;
    const shot = p.playerWeapon.lastShot;
    legBehind = { leg: leg.index, dot: +shot.direction.dot(forward).toFixed(3), hitLeaper: combat.leaperHealth !== health,
      // The crosshair's point lies beyond Lola (not on the leg behind her), so the
      // bullet goes where she aims rather than only being saved by the backwards guard.
      aimAhead: shot.aimPoint.clone().sub(origin).dot(forward) > lolaDepth, backwards: shot.backwards };
    break;
  }
  check(legBehind && legBehind.dot > 0 && !legBehind.hitLeaper && legBehind.aimAhead && !legBehind.backwards,
    `with a Leaper leg between the camera and Lola, the aim point is in front of her and the shot leaves the Leaper alone (${JSON.stringify(legBehind)})`);
  p.playerWeapon.reset(); combat.reset();

  // ---- Back to a real junkyard wall, Lola never fires backwards (review 5.5) ----
  // Search the real map for spots where the chase camera has a wall between it
  // and Lola (the camera fades such walls instead of moving through them).
  cameraController.setOccluders([world.map]);
  const forwardHits = [];
  const { bounds } = world.navigation;
  let tries = 0, lensWouldGoBackwards = 0;
  search: for (let x = bounds.minX * scale; x < bounds.maxX * scale; x += 1.7) {
    for (let z = bounds.minZ * scale; z < bounds.maxZ * scale; z += 1.7) {
      // Only spots Lola can stand on.
      if (world.playerBlocked(x, z)) continue;
      for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
        if (lensWouldGoBackwards >= 2 || tries >= 1500) break search;
        tries += 1;
        target.mesh.position.set(x, 0, z); target.mesh.rotation.y = yaw + Math.PI;
        cameraController.yaw = yaw; cameraController.pitch = 0.16; cameraController.occlusion.distance = null;
        cameraController.update(p.simulation.state, rig.eyePivot, 1 / 60);
        if (!cameraController.occlusion.blockers.size) continue;
        animatePlayer(0.05);
        cameraController.update(p.simulation.state, rig.eyePivot, 1 / 60);
        const cameraForward = engine.camera.getWorldDirection(new THREE.Vector3());
        p.playerWeapon.reset();
        if (!p.playerWeapon.fire()) continue;
        const shot = p.playerWeapon.lastShot;
        forwardHits.push(shot.direction.dot(cameraForward));
        // The old rule (the sight starting at the lens) would have aimed behind the barrel here.
        const lensSight = traceSight({ cameraRay: { origin: engine.camera.position.clone(), direction: cameraForward },
          world: combat.geometry, targets: p.playerWeapon.targets, range: p.playerWeapon.range });
        if (lensSight.point.clone().sub(shot.origin).dot(cameraForward) <= 0) lensWouldGoBackwards += 1;
        break;
      }
    }
  }
  check(lensWouldGoBackwards >= 1, `the search found real spots where the old lens trace fired backwards (${lensWouldGoBackwards} in ${tries} tries)`);
  check(forwardHits.every(dot => dot > 0),
    `with a wall behind her, every shot flies forward (${forwardHits.map(dot => dot.toFixed(2)).join(', ')})`);
  cameraController.occlusion = null;
  p.playerWeapon.reset(); combat.reset();
  target.mesh.position.copy(base);
  result.textContent += `\n\nALL ${passed} CHECKS PASSED`;
  document.title = `PASS ${passed} · Leaper combat regression`;
  if (new URLSearchParams(location.search).has('legPreview')) {
    damageSim.updateBody(0, 0); damageSim.updateGait(0, 0);
    for (let i = 0; i < 10; i++) {
      combat.legs.hit(rig.legs[0].knee, new THREE.Vector3(-1, 0, 1));
      combat.legs.hit(rig.legs[1].calfJoint, new THREE.Vector3(1, 0, 1));
    }
    for (let i = 0; i < 300; i++) combat.legs.update(1 / 60);
    const focus = rig.robot.position.clone();
    engine.camera.position.copy(focus).add(new THREE.Vector3(8, 5, 10));
    engine.camera.lookAt(focus); result.hidden = true;
    p.playerWeapon.reticle.hidden = true;
    engine.renderer.render(engine.scene, engine.camera);
  }
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
  if (new URLSearchParams(location.search).has('aimPreview')) {
    combat.reset(); p.playerWeapon.reset(); target.mesh.position.copy(lane);
    target.weaponIndex = 0; target.showWeapon(); target.crouching = false;
    target.move(0, 0, new THREE.Vector3(0, 0, -1), new THREE.Vector3(-1, 0, 0), 4.5, 0.1);
    cameraController.mode = 'CHASE';
    pointAimAt(center);
    p.playerWeapon.setAiming(true);
    cameraController.update(p.simulation.state, rig.eyePivot, 1);
    const healthBeforePreview = combat.leaperHealth;
    engine.renderer.domElement.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }));
    frame(0);
    check(combat.leaperHealth < healthBeforePreview, 'first-person left click damages Leaper');
    p.playerWeapon.visuals.update(0.035);
    result.hidden = true;
    // Preview uses the same aiming overlay as the game.
    p.playerWeapon.reticle.hidden = false;
    engine.renderer.setAnimationLoop(() => {
      engine.camera.aspect = innerWidth / innerHeight; engine.camera.updateProjectionMatrix();
      engine.renderer.setSize(innerWidth, innerHeight);
      p.playerWeapon.beforeRender(); engine.renderer.render(engine.scene, engine.camera); p.playerWeapon.afterRender();
    });
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
