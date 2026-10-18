import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CameraController } from '../src/camera/CameraController.js';

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
