import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { disposeObject3D } from '../src/core/disposeObject3D.js';
import { captureRunState, restoredPlayerSpot, saveRunState, takeRunState, RUN_STATE_KEY } from '../src/game/runState.js';
import { CameraController } from '../src/camera/CameraController.js';

test('disposeObject3D frees every geometry, material and texture once, shared ones included', () => {
  const freed = [];
  const watch = (thing, name) => { thing.addEventListener('dispose', () => freed.push(name)); return thing; };
  const texture = watch(new THREE.Texture(), 'texture');
  const shared = watch(new THREE.MeshStandardMaterial({ map: texture }), 'shared material');
  const root = new THREE.Group();
  root.add(new THREE.Mesh(watch(new THREE.BoxGeometry(), 'box'), shared));
  const child = new THREE.Mesh(watch(new THREE.SphereGeometry(), 'sphere'),
    [shared, watch(new THREE.MeshBasicMaterial(), 'second material')]);
  root.children[0].add(child);
  const counts = disposeObject3D(root);
  assert.deepEqual(counts, { geometries: 2, materials: 2, textures: 1 });
  assert.deepEqual(freed.sort(), ['box', 'second material', 'shared material', 'sphere', 'texture']);
  assert.deepEqual(disposeObject3D(null), { geometries: 0, materials: 0, textures: 0 });
});

test('APPLY SIZE carries the session over in map units, so Lola keeps her spot at any size', () => {
  const player = { mesh: { position: new THREE.Vector3(3, 0, -6), rotation: { y: 0.4 } }, weaponIndex: 1 };
  const state = captureRunState({ playMode: 'hunt', player, world: { scale: 1.5 },
    cameraController: { yaw: 2, pitch: 0.2, mode: 'TOP' }, soundEnabled: false, optionsOpen: true });
  assert.deepEqual(state, { mode: 'hunt', lola: { x: 2, z: -4, yaw: 0.4 }, camera: { yaw: 2, pitch: 0.2, view: 'TOP' },
    weaponIndex: 1, sound: false, options: true });
  // A bigger Leaper shrinks the map (smaller scale): same map spot, new world position.
  assert.deepEqual(restoredPlayerSpot(state, { scale: 0.5, playerBlocked: () => false }), { x: 1, z: -2, yaw: 0.4 });
  assert.equal(restoredPlayerSpot(state, { scale: 0.5, playerBlocked: () => true }), null, 'never inside a wall');
  assert.equal(restoredPlayerSpot({ lola: { x: NaN, z: 1 } }, { scale: 1 }), null);
});

test('the carried-over state is read once and survives refused storage', () => {
  const store = new Map();
  const storage = { setItem: (k, v) => store.set(k, v), getItem: (k) => store.get(k) ?? null, removeItem: (k) => store.delete(k) };
  assert.equal(saveRunState({ mode: 'explore' }, storage), true);
  assert.ok(store.has(RUN_STATE_KEY));
  assert.deepEqual(takeRunState(storage), { mode: 'explore' });
  assert.equal(takeRunState(storage), null, 'a later reload starts fresh');
  const refusing = { setItem() { throw new Error('private'); }, getItem() { throw new Error('private'); }, removeItem() {} };
  assert.equal(saveRunState({ mode: 'hunt' }, refusing), false);
  assert.equal(takeRunState(refusing), null);
  store.set(RUN_STATE_KEY, '{not json');
  assert.equal(takeRunState(storage), null);
});

test("aborting the session's signal removes the camera's page listeners", () => {
  // Real EventTargets stand in for the page, so `signal` really detaches listeners.
  const page = new EventTarget();
  const doc = new EventTarget();
  Object.assign(doc, { pointerLockElement: null, hasFocus: () => true, body: { classList: { toggle() {}, add() {}, remove() {} } } });
  globalThis.window = Object.assign(page, { focus() {} });
  globalThis.document = doc;
  const canvas = Object.assign(new EventTarget(), { style: {}, clientHeight: 720, requestPointerLock() {} });
  const button = Object.assign(new EventTarget(), { classList: { toggle() {} } });
  const session = new AbortController();
  const controller = new CameraController(new THREE.PerspectiveCamera(), { fog: {} }, canvas, button, { signal: session.signal });
  controller.gameplayStarted = true;
  let pauses = 0;
  controller.onPauseRequested = () => { pauses += 1; };
  const escape = () => page.dispatchEvent(Object.assign(new Event('keydown'), { code: 'Escape' }));
  escape();
  assert.equal(pauses, 1, 'Escape pauses while the session is alive');
  session.abort();
  escape();
  assert.equal(pauses, 1, 'after abort the old controller no longer hears Escape');
  controller.mode = 'CHASE';
  button.dispatchEvent(new Event('click'));
  assert.equal(controller.mode, 'CHASE', 'nor the VIEW button');
});
