import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CameraController, isTouchPointer, zoomedFov } from '../src/camera/CameraController.js';
import { CAMERA } from '../src/config/camera.js';

function mouseHarness(request) {
  const events = {};
  globalThis.document = { pointerLockElement: null, hasFocus: () => true,
    addEventListener: (name, fn) => { events[name] = fn; },
    exitPointerLock() { this.pointerLockElement = null; events.pointerlockchange(); } };
  globalThis.window = { addEventListener: (name, fn) => { events[name] = fn; } };
  const canvas = { style: {}, addEventListener() {}, requestPointerLock: request };
  const controller = new CameraController(new THREE.PerspectiveCamera(), {}, canvas, { addEventListener() {} });
  controller.gameplayStarted = true;
  let pauses = 0;
  controller.onPauseRequested = () => pauses++;
  return { controller, events, canvas, pauses: () => pauses };
}

test('embedded mouse focus loss releases cursor without pausing; Escape pauses', () => {
  const h = mouseHarness(() => { throw new Error('Pointer lock unavailable'); });
  h.controller.captureMouse();
  h.events.blur();
  assert.equal(h.pauses(), 0);
  assert.equal(h.canvas.style.cursor, 'default');
  h.controller.captureMouse();
  h.events.keydown({ code: 'Escape' });
  assert.equal(h.pauses(), 1);
  assert.equal(h.controller.fallbackMouseLook, false);
});

test('native mouse focus loss does not pause, but browser Escape unlock does', () => {
  const h = mouseHarness(function () {
    document.pointerLockElement = this; h.events.pointerlockchange();
  });
  h.controller.captureMouse();
  h.events.blur();
  assert.equal(h.pauses(), 0);
  h.controller.captureMouse();
  document.pointerLockElement = null;
  h.events.pointerlockchange();
  assert.equal(h.pauses(), 1);
});

test('repeated clicks cannot duplicate capture or restore a released cursor after a late rejection', async () => {
  let reject, requests = 0;
  const h = mouseHarness(() => { requests++; return new Promise((_, no) => { reject = no; }); });
  h.controller.captureMouse(); h.controller.captureMouse();
  assert.equal(requests, 1);
  h.controller.releaseMouse();
  reject(new Error('Denied'));
  await Promise.resolve();
  assert.ok(!h.controller.fallbackMouseLook);
  assert.equal(h.pauses(), 0);
});

test('a pointer lock that arrives after the game let go of the mouse is undone (review 5.11)', async () => {
  let grant;
  const h = mouseHarness(function () {
    return new Promise((resolve) => { grant = () => { document.pointerLockElement = this; h.events.pointerlockchange(); resolve(); }; });
  });
  h.controller.captureMouse();
  // The run stops before the browser grants the lock (e.g. START RUN, then STOP at once).
  h.controller.releaseMouse();
  grant();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(document.pointerLockElement, null, 'the late lock is released again');
  assert.equal(h.pauses(), 0, 'undoing it is not treated as the player pausing');
});

test('Start capture hides cursor; release restores it and freezes mouse look for menus', () => {
  const listeners = {};
  globalThis.document = { pointerLockElement: null, addEventListener: (name, fn) => { listeners[name] = fn; },
    exitPointerLock() { this.pointerLockElement = null; listeners.pointerlockchange(); } };
  globalThis.window = { addEventListener() {} };
  const canvas = { style: {}, addEventListener() {}, requestPointerLock() {
    document.pointerLockElement = this; listeners.pointerlockchange(); return Promise.resolve();
  } };
  const controller = new CameraController(new THREE.PerspectiveCamera(), {}, canvas, { addEventListener() {} });
  controller.followSubject = {}; controller.gameplayStarted = true;
  controller.captureMouse();
  assert.equal(canvas.style.cursor, 'none');
  const yaw = controller.yaw;
  const event = { target: canvas, pointerType: 'mouse', pointerId: 1, movementX: 20, movementY: 0 };
  controller.onPointerMove(event); assert.notEqual(controller.yaw, yaw);
  controller.releaseMouse(); assert.equal(canvas.style.cursor, 'default');
  const releasedYaw = controller.yaw;
  controller.onPointerMove(event); assert.equal(controller.yaw, releasedYaw);
});

test('default chase framing puts the top of Lola below the central crosshair', () => {
  globalThis.document = { addEventListener() {} };
  globalThis.window = { addEventListener() {} };
  const camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 500);
  const controller = new CameraController(camera, {}, { style: {}, addEventListener() {} }, { addEventListener() {} });
  controller.followSubject = { mesh: { position: new THREE.Vector3() }, height: 3 };
  controller.pitch = 0.16;
  controller.update({}, null, 1 / 60); camera.updateMatrixWorld(true);
  assert.ok(new THREE.Vector3(0, 3, 0).project(camera).y < -0.02);
});

test('leaving the aim keeps the chase crosshair on the aimed-at point', () => {
  globalThis.document = { addEventListener() {} };
  globalThis.window = { addEventListener() {} };
  const camera = new THREE.PerspectiveCamera();
  const controller = new CameraController(camera, {}, { style: {}, addEventListener() {} }, { addEventListener() {} });
  controller.followSubject = { mesh: new THREE.Object3D(), height: 1.7, crouching: false };
  for (const point of [new THREE.Vector3(3, 0.4, 14), new THREE.Vector3(-6, 5, 9), new THREE.Vector3(0.5, 1.2, 30)]) {
    controller.aimChaseAt(point);
    controller.update(null, null, 1 / 60);
    camera.updateMatrixWorld(true);
    const ray = new THREE.Ray(camera.position.clone(), camera.getWorldDirection(new THREE.Vector3()));
    assert.ok(ray.distanceToPoint(point) < 1e-3, `crosshair passes through ${point.toArray()}`);
  }
});

test('entering the aim keeps the crosshair on the point the chase camera was on', () => {
  globalThis.document = { addEventListener() {} };
  globalThis.window = { addEventListener() {} };
  const camera = new THREE.PerspectiveCamera();
  const controller = new CameraController(camera, {}, { style: {}, addEventListener() {} }, { addEventListener() {} });
  const eye = new THREE.Vector3(0.1, 1.6, 0.05);
  controller.followSubject = { mesh: new THREE.Object3D(), height: 1.7, crouching: false,
    eyePosition: out => out.copy(eye) };
  controller.aiming = true;
  for (const point of [new THREE.Vector3(3, 0.4, 14), new THREE.Vector3(-6, 3, 9), new THREE.Vector3(0.5, 1.2, 30)]) {
    controller.aimEyeAt(point);
    controller.update(null, null, 1 / 60);
    camera.updateMatrixWorld(true);
    const ray = new THREE.Ray(camera.position.clone(), camera.getWorldDirection(new THREE.Vector3()));
    assert.ok(ray.distanceToPoint(point) < 1e-3, `aim crosshair passes through ${point.toArray()}`);
  }
});

// ---- Aiming down the sights: limits, wheel, sensitivity, recoil (review 5.22, 5.38) ----

// A chase camera following a stand-in Lola, with the canvas listeners captured.
function aimHarness() {
  const canvasListeners = {};
  globalThis.document = { addEventListener() {}, body: { classList: { add() {}, remove() {}, toggle() {} } } };
  globalThis.window = { addEventListener() {} };
  const camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 500);
  const canvas = { style: {}, addEventListener: (name, fn) => { canvasListeners[name] = fn; } };
  const controller = new CameraController(camera, {}, canvas, { addEventListener() {} });
  const eye = new THREE.Vector3(0, 1.6, 0);
  controller.followSubject = { mesh: new THREE.Object3D(), height: 1.7, crouching: false, eyePosition: out => out.copy(eye) };
  controller.pitch = 0.16;
  return { controller, camera, canvasListeners, eye };
}

test('the mouse wheel never nudges the aim (review 5.38)', () => {
  const { controller, camera, canvasListeners } = aimHarness();
  canvasListeners.wheel({ deltaY: 300, preventDefault() {} });
  const zoomed = controller.distance;
  assert.ok(zoomed > CAMERA.boom.start, 'outside the aim the wheel still zooms the boom');
  controller.setAiming(true);
  controller.update(null, null, 1 / 60);
  camera.updateMatrixWorld(true);
  const before = camera.getWorldDirection(new THREE.Vector3());
  canvasListeners.wheel({ deltaY: -900, preventDefault() {} });
  controller.update(null, null, 1 / 60);
  camera.updateMatrixWorld(true);
  assert.equal(controller.distance, zoomed);
  assert.ok(camera.getWorldDirection(new THREE.Vector3()).angleTo(before) < 1e-9, 'the crosshair stays on its point');
});

test('aiming may look about 57 degrees up or down; the chase view keeps its tight limits (review 5.22)', () => {
  const { controller } = aimHarness();
  controller.lookBy(0, -10);
  assert.equal(controller.pitch, CAMERA.chasePitch.low, 'chase: limited');
  controller.setAiming(true);
  controller.lookBy(0, -10);
  assert.equal(controller.pitch, -1, 'aiming: far further up');
  controller.lookBy(0, 20);
  assert.equal(controller.pitch, 1, 'and down');
});

test('equal mouse movements move the view equally far on screen, zoomed or not (review 5.38)', () => {
  const { controller, camera } = aimHarness();
  // On-screen motion of a small turn is the angle over tan(fov / 2).
  const screenMotion = () => {
    const yaw = controller.yaw;
    controller.lookBy(0.01, 0);
    return (yaw - controller.yaw) / Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
  };
  const chase = screenMotion();
  controller.setAiming(true);
  camera.fov = zoomedFov(1.35);
  const aimed = screenMotion();
  assert.ok(Math.abs(aimed / chase - 1) < 1e-9, `chase ${chase} vs aim ${aimed}`);
});

test('the look sensitivity setting scales every look input', () => {
  const { controller } = aimHarness();
  const yaw = controller.yaw;
  controller.lookBy(0.01, 0);
  const normal = yaw - controller.yaw;
  controller.lookSensitivity = 2;
  const yaw2 = controller.yaw;
  controller.lookBy(0.01, 0);
  assert.ok(Math.abs((yaw2 - controller.yaw) / normal - 2) < 1e-9);
  assert.ok(CAMERA.look.verticalRatio > 0 && CAMERA.look.mouse > 0);
});

test('leaving a steep aim keeps the crosshair on the point, then eases into the chase limits (review 5.22)', () => {
  const { controller, camera } = aimHarness();
  // A knee high above, close by: far steeper than the chase view may look.
  const knee = new THREE.Vector3(0.5, 6, -3);
  controller.setAiming(true);
  controller.setAiming(false);
  controller.aimChaseAt(knee);
  assert.ok(controller.pitch >= CAMERA.chasePitch.low && controller.pitch <= CAMERA.chasePitch.high, 'the boom stays in its limits');
  assert.ok(controller.viewPitchOffset < -0.1, 'the view still looks up at the knee');
  controller.update(null, null, 0);
  camera.updateMatrixWorld(true);
  const ray = new THREE.Ray(camera.position.clone(), camera.getWorldDirection(new THREE.Vector3()));
  assert.ok(ray.distanceToPoint(knee) < 1e-3, 'no snap on the way out');
  for (let i = 0; i < 60; i += 1) controller.update(null, null, 1 / 60);
  assert.equal(controller.viewPitchOffset, 0, 'eased back within a second');
});

// The aim can end without aimChaseAt: a pause, the fight ending or LEAPER POV take
// the gun away while it is up. The chase boom must still come back inside its own
// limits (a boom at the aim's -1 rad sits under the floor, looking up at Lola).
test('an aim that ends on its own never leaves the chase boom outside its limits', () => {
  for (const steep of [-10, 10]) {
    const { controller, camera, eye } = aimHarness();
    controller.setAiming(true);
    controller.lookBy(0, steep);
    const aimPitch = controller.pitch;
    assert.equal(Math.abs(aimPitch), 1, 'the aim looked as far as it may');
    controller.setAiming(false);
    assert.ok(controller.pitch >= CAMERA.chasePitch.low && controller.pitch <= CAMERA.chasePitch.high,
      `the boom is back inside the chase limits (${controller.pitch})`);
    assert.ok(Math.abs(controller.pitch + controller.viewPitchOffset - aimPitch) < 1e-9,
      'the view first keeps looking where the aim did (no snap)');
    controller.update(null, null, 0);
    assert.ok(camera.position.y > eye.y - 1.7, 'the camera is not under the floor');
    for (let i = 0; i < 60; i += 1) controller.update(null, null, 1 / 60);
    assert.equal(controller.viewPitchOffset, 0, 'and eases into the chase limits within a second');
  }
});

test('recoil kicks the view up and settles back', () => {
  const { controller, camera } = aimHarness();
  controller.update(null, null, 1 / 60);
  camera.updateMatrixWorld(true);
  const rest = camera.getWorldDirection(new THREE.Vector3());
  const restUp = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
  controller.addRecoil(0.02, 0, 10);
  controller.update(null, null, 0);
  camera.updateMatrixWorld(true);
  const kicked = camera.getWorldDirection(new THREE.Vector3());
  assert.ok(kicked.y > rest.y + 0.015, 'the crosshair climbs');
  for (let i = 0; i < 90; i += 1) controller.update(null, null, 1 / 60);
  camera.updateMatrixWorld(true);
  assert.ok(camera.getWorldDirection(new THREE.Vector3()).angleTo(rest) < 1e-4, 'and returns to the aimed point');
  // The roll and the jolt back shake the view without moving the crosshair.
  controller.addRecoil(0, 0, 10, { roll: 0.02, push: 0.1 });
  controller.update(null, null, 0);
  camera.updateMatrixWorld(true);
  assert.ok(camera.getWorldDirection(new THREE.Vector3()).angleTo(rest) < 1e-6, 'the shake keeps the aim');
  assert.ok(new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1).angleTo(restUp) > 0.015, 'and tilts the screen');
  // A held spray carries the view up with it, and back down after.
  controller.setSprayView(0.03, 0);
  for (let i = 0; i < 30; i += 1) controller.update(null, null, 1 / 60);
  camera.updateMatrixWorld(true);
  assert.ok(camera.getWorldDirection(new THREE.Vector3()).y > rest.y + 0.025, 'the spray lifts the view');
  controller.setSprayView(0, 0);
  for (let i = 0; i < 60; i += 1) controller.update(null, null, 1 / 60);
  camera.updateMatrixWorld(true);
  assert.ok(camera.getWorldDirection(new THREE.Vector3()).angleTo(rest) < 1e-4, 'and settles back');
  controller.addRecoil(1, 1, 10);
  assert.ok(controller.recoil.pitch <= CAMERA.recoilMax);
  controller.resetEffects();
  assert.equal(controller.recoil.pitch, 0);
  assert.equal(controller.spray.pitch, 0);
});

test('a finger or pen never captures the mouse; touch controls stay usable (review 5.9)', () => {
  const classes = new Set();
  let requested = 0;
  const listeners = {};
  globalThis.document = { pointerLockElement: null, addEventListener() {},
    body: { classList: { add: c => classes.add(c), remove: c => classes.delete(c), toggle() {} } } };
  globalThis.window = { addEventListener: (name, fn) => { listeners[name] = fn; } };
  const canvas = { style: {}, addEventListener() {}, requestPointerLock() { requested += 1; } };
  const controller = new CameraController(new THREE.PerspectiveCamera(), {}, canvas, { addEventListener() {} });
  controller.followSubject = {}; controller.gameplayStarted = true;
  listeners.pointerdown({ pointerType: 'touch' });
  controller.captureMouse();
  assert.equal(requested, 0, 'no pointer lock');
  assert.ok(!classes.has('mouse-look') && !controller.fallbackMouseLook, 'no hover-look fallback either');
  assert.ok(classes.has('touch-play'));
  listeners.pointerdown({ pointerType: 'mouse' });
  controller.captureMouse();
  assert.equal(requested, 1, 'a real mouse still captures');
  assert.ok(isTouchPointer('pen') && isTouchPointer('touch') && !isTouchPointer('mouse'));
});

test('pause requests only count while a run is playing', () => {
  const h = mouseHarness(() => {});
  h.controller.gameplayStarted = false;
  assert.equal(h.controller.requestPause(), false);
  assert.equal(h.pauses(), 0);
  h.controller.gameplayStarted = true;
  assert.equal(h.controller.requestPause(), true);
  assert.equal(h.pauses(), 1);
  let resumed = 0;
  h.controller.onResumeRequested = () => { resumed += 1; };
  h.controller.requestResume();
  assert.equal(resumed, 1);
});
