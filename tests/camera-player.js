import * as THREE from 'three';
import { createScene } from '../src/core/createScene.js';
import { createJunkyardWorld } from '../src/world/createJunkyardWorld.js';
import { LolaPlayer } from '../src/robot/LolaPlayer.js';
import { CameraController } from '../src/camera/CameraController.js';
import { LaserAudio } from '../src/simulation/LaserAudio.js';

const results = document.querySelector('#results');
function check(ok, label) { if (!ok) throw new Error(label); results.textContent += `\nPASS ${label}`; }
try {
  const engine = createScene(document.querySelector('#app'));
  const world = await createJunkyardWorld(engine.scene);
  const player = await LolaPlayer.create(engine.scene, world, document.querySelector('#target'));
  results.textContent = 'REAL-ASSET CAMERA + FOOTSTEP CHECKS';
  for (const outfit of player.outfits) for (const [name, profile] of Object.entries(outfit.footContacts)) {
    check(profile.forward.length === 2 && profile.reverse.length === 2, `${name}: two measured foot plants in both directions`);
  }
  const controller = new CameraController(engine.camera, engine.scene, engine.renderer.domElement, document.querySelector('#camera'));
  controller.followSubject = player; controller.pitch = 0.16;
  controller.setOccluders([world.map]);
  controller.update({}, null, 1 / 60);
  engine.camera.updateMatrixWorld(true);
  const headTop = player.mesh.position.clone(); headTop.y += player.height;
  check(headTop.project(engine.camera).y < -0.02, 'crosshair is above Lola head, not on her neck');
  const yaw = controller.yaw;
  controller.onPointerMove({ pointerType: 'mouse', target: engine.renderer.domElement, pointerId: 99, movementX: 10, movementY: 0 });
  check(controller.yaw !== yaw && controller.pointerId === null, 'mouse look without any button pressed');
  const uiYaw = controller.yaw;
  controller.onPointerMove({ pointerType: 'mouse', target: results, pointerId: 99, movementX: 10, movementY: 0 });
  check(controller.yaw === uiYaw, 'moving over controls does not turn camera');
  const direction = new THREE.Vector3();
  let compressed = false;
  for (let i = 0; i < 72; i++) {
    controller.yaw = i * Math.PI / 36;
    controller.update({}, null, 1 / 60);
    engine.camera.getWorldDirection(direction);
    if (Math.abs(direction.y + Math.sin(controller.pitch)) >= 1e-6) throw new Error('Cover changed camera pitch');
    if (controller.occlusion.distance < 5) compressed = true;
  }
  check(true, '72 orbit angles preserve chosen pitch');
  const spawn = player.mesh.position.clone();
  for (let x = -15; x <= 15 && !compressed; x += 3) for (let z = -15; z <= 15 && !compressed; z += 3) {
    if (world.playerBlocked(spawn.x + x, spawn.z + z)) continue;
    player.mesh.position.set(spawn.x + x, 0, spawn.z + z);
    for (let i = 0; i < 8 && !compressed; i++) {
      controller.yaw = i * Math.PI / 4;
      controller.occlusion.distance = null;
      controller.update({}, null, 1 / 60);
      compressed = controller.occlusion.distance > 0.2 && controller.occlusion.distance < 5;
    }
  }
  check(compressed, 'actual junkyard cover compresses the boom');
  const material = player.outfits[0].model.getObjectByProperty('isMesh', true).material;
  const original = [material.opacity, material.transparent, material.depthWrite];
  engine.camera.position.copy(controller.tempA).add(new THREE.Vector3(0, 0, player.height * 0.3));
  controller.beforeRender();
  check(material.opacity >= original[0] * 0.8 && material.opacity < original[0], 'Lola stays at least 80% opaque');
  controller.afterRender();
  check(JSON.stringify([material.opacity, material.transparent, material.depthWrite]) === JSON.stringify(original), 'render restores original character materials');
  let steps = 0;
  player.onFootstep = () => steps++;
  const blocked = world.playerBlocked;
  world.playerBlocked = () => false;
  const forward = new THREE.Vector3(0, 0, 1), right = new THREE.Vector3(1, 0, 0);
  for (let i = 0; i < 120; i++) player.move(1, 0, forward, right, 4.5, 1 / 60);
  check(steps >= 6 && steps <= 10, 'moving animation generates footfalls at its actual cadence');
  const beforeStop = steps;
  for (let i = 0; i < 60; i++) player.move(0, 0, forward, right, 4.5, 1 / 60);
  check(steps === beforeStop, 'standing still emits no footfalls');
  world.playerBlocked = () => true;
  for (let i = 0; i < 60; i++) player.move(1, 0, forward, right, 8, 1 / 60);
  check(steps === beforeStop, 'pushing against a wall emits no footfalls');
  world.playerBlocked = blocked;
  world.playerBlocked = () => false;
  const kinds = [];
  player.onFootstep = kind => kinds.push(kind);
  for (let i = 0; i < 60; i++) player.move(1, 0, forward, right, 8, 1 / 60);
  check(kinds.length > 0 && kinds.every(kind => kind === 'run'), 'sprint selects the supplied running recording');
  kinds.length = 0; player.jump();
  for (let i = 0; i < 12; i++) player.move(1, 0, forward, right, 8, 1 / 60);
  check(kinds.length === 0, 'airborne movement emits no footfalls');
  player.resetJump(); player.aimHeld = false;
  for (const [f, s] of [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1]]) {
    for (let i = 0; i < 40; i++) {
      const before = player.mesh.position.clone();
      player.move(f, s, forward, right, 8, 1 / 120);
      const travel = player.mesh.position.clone().sub(before);
      const facing = new THREE.Vector3(Math.sin(player.mesh.rotation.y), 0, Math.cos(player.mesh.rotation.y));
      if (travel.lengthSq() > 1e-10 && travel.normalize().dot(facing) < 0.999) throw new Error('Root skids sideways during direction change');
    }
  }
  check(true, 'running direction changes keep root travel aligned with the running pose');
  player.aimHeld = true; player.holdAim();
  player.move(1, 0, forward, right, 8, 1 / 60);
  check(player.shot?.upperOnly, 'moving while aiming keeps the running legs active');
  check(player.outfits[player.weaponIndex].actions.Run.getEffectiveWeight() > 0, 'shooting does not blank locomotion weights');
  player.aimHeld = false; player.cancelShot();
  world.playerBlocked = blocked;
  results.textContent += '\nALL CHECKS PASSED'; document.title = 'PASS · Camera and footsteps';
  const audio = new LaserAudio();
  const button = document.createElement('button'); button.textContent = 'Test recorded footsteps';
  button.style.cssText = 'position:fixed;right:12px;top:12px;padding:12px'; document.body.append(button);
  button.onclick = async () => {
    try {
      audio.unlock(); await audio.ready;
      check(audio.buffers.run.duration > 4 && audio.buffers.walk.duration > 15, 'both supplied WAVs decode in the browser');
      audio.step('run'); audio.step('walk');
      check(audio.voices.size === 2, 'both recorded footfalls start successfully');
      check(audio.buffers.robot.duration > 3, 'Leaper mechanical footfalls decode in the browser');
      audio.step('robot');
      check(audio.robotVoices.size === 1, 'Leaper touchdown starts its mechanical recording');
      audio.stopRobotSteps();
      check(audio.robotVoices.size === 0 && audio.voices.size === 2, 'Leaper pause stops only its own walking sound');
      audio.enabled = false;
      check(audio.voices.size === 0, 'sound mute stops footfalls');
    } catch (error) { results.textContent += `\nFAIL ${error.message}`; }
  };
} catch (error) { results.textContent += `\nFAIL ${error.stack}`; document.title = 'FAIL · Camera and footsteps'; }
