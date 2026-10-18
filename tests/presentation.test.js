import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { SunFollow, shadowBasis, snapToShadowTexels } from '../src/core/sunShadow.js';
import { SUN_OFFSET, SHADOW_BOX } from '../src/core/createScene.js';
import { CameraController } from '../src/camera/CameraController.js';
import { JunkyardPresentation } from '../src/game/JunkyardPresentation.js';

function fakeSun() {
  const sun = new THREE.DirectionalLight();
  sun.shadow.mapSize.set(SHADOW_BOX.mapSize, SHADOW_BOX.mapSize);
  return sun;
}

test('the shadow centre snaps to whole shadow pixels as seen from the sun', () => {
  const offset = new THREE.Vector3(SUN_OFFSET.x, SUN_OFFSET.y, SUN_OFFSET.z);
  const basis = shadowBasis(offset);
  assert.ok(Math.abs(basis.right.y) < 1e-12, 'the shadow map rows stay level');
  const texel = 26 / 2048;
  for (const point of [new THREE.Vector3(0.47, 0, 5.6), new THREE.Vector3(-21.3, 0, 13.77), new THREE.Vector3(1e-4, 0, -3)]) {
    const snapped = snapToShadowTexels(point, basis, texel);
    const u = snapped.dot(basis.right) / texel, v = snapped.dot(basis.up) / texel;
    assert.ok(Math.abs(u - Math.round(u)) < 1e-6 && Math.abs(v - Math.round(v)) < 1e-6, 'on the pixel grid');
    assert.ok(snapped.distanceTo(point) <= texel * Math.SQRT1_2 + 1e-12, 'moves less than half a pixel diagonal');
  }
  // Walking a tiny step moves the shadow box by whole pixels or not at all (as seen
  // from the sun), so shadow edges don't crawl. Sliding along the light ray is free.
  for (let i = 0; i < 50; i += 1) {
    const a = snapToShadowTexels(new THREE.Vector3(3 + i * texel * 0.13, 0, 3 - i * texel * 0.07), basis, texel);
    const b = snapToShadowTexels(new THREE.Vector3(3 + (i + 1) * texel * 0.13, 0, 3 - (i + 1) * texel * 0.07), basis, texel);
    for (const axis of [basis.right, basis.up]) {
      const pixels = (b.dot(axis) - a.dot(axis)) / texel;
      assert.ok(Math.abs(pixels - Math.round(pixels)) < 1e-6, 'whole-pixel moves only');
    }
  }
});

test('SunFollow scales the shadow box to the map and keeps the sun over Lola', () => {
  const sun = fakeSun();
  const follow = new SunFollow(sun, { scale: 1.45 });
  const camera = sun.shadow.camera;
  assert.ok(Math.abs(camera.right - SHADOW_BOX.halfSize * 1.45) < 1e-9);
  assert.ok(Math.abs(camera.left + SHADOW_BOX.halfSize * 1.45) < 1e-9);
  assert.ok(Math.abs(camera.far - SHADOW_BOX.far * 1.45) < 1e-9);
  follow.update({ x: 20, z: -14 });
  const target = sun.target.position;
  assert.ok(Math.hypot(target.x - 20, target.z + 14) < follow.texel, 'centred on Lola, within one shadow pixel');
  const offset = sun.position.clone().sub(target);
  assert.ok(offset.distanceTo(new THREE.Vector3(8, 15, 6).multiplyScalar(1.45)) < 1e-9, 'same sun direction, scaled');
});

test('after CameraController.update the camera matrices already match the new view (review 5.21)', () => {
  globalThis.document = { addEventListener() {} };
  globalThis.window = { addEventListener() {} };
  const camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 500);
  const controller = new CameraController(camera, {}, { style: {}, addEventListener() {} }, { addEventListener() {} });
  controller.followSubject = { mesh: { position: new THREE.Vector3() }, height: 3 };
  const point = new THREE.Vector3(2, 2.5, 8);
  for (const mode of ['CHASE', 'TOP']) {
    controller.mode = mode;
    for (const step of [0.02, 0.05, 0.1]) {
      controller.yaw += step;
      controller.topCenter.x += step;
      controller.update({}, null, 1 / 60);
      const projected = point.clone().project(camera);
      camera.updateMatrixWorld(true);
      const fresh = point.clone().project(camera);
      assert.ok(projected.distanceTo(fresh) < 1e-9, `${mode} at ${step} rad/frame projects with this frame's camera`);
    }
  }
});

test('the junkyard late phase runs camera, sun, POV, matrices, health bars, then readouts — even after the fight', () => {
  const calls = [];
  const engine = {
    camera: { far: 0, updateProjectionMatrix() {}, updateMatrixWorld: () => calls.push('matrices') },
    scene: { fog: {} },
    sun: fakeSun(),
  };
  const enemy = {
    simulation: { state: { position: new THREE.Vector3() }, rig: { eyePivot: {} }, drivesPresentation: true },
    combat: { healthBarLate: false, updateHealthBar: (dt) => calls.push(['bar', dt]) },
    brain: { describe: () => ({ label: 'BRAIN 7,757,824 · PAUSED', status: 'LIVE TRAINED BRAIN // PAUSED // STEP 3' }) },
  };
  let paused = false;
  const encounter = { enemies: [enemy], primary: enemy, gameDelta: (dt) => (paused ? 0 : dt) };
  const brainLabel = { textContent: '' }, statusElement = { textContent: '' };
  const presentation = new JunkyardPresentation({
    engine, world: { scale: 1.45, width: 5.5, defaultWidth: 2.88 },
    cameraController: { update: (state, pivot, dt) => calls.push(['camera', dt]) },
    player: { mesh: { position: new THREE.Vector3(4, 0, 9) } },
    encounter, pov: { update: () => calls.push('pov') }, brainLabel, statusElement,
  });
  assert.equal(enemy.simulation.drivesPresentation, false, 'the Leaper animator no longer moves camera or sun');
  assert.equal(enemy.combat.healthBarLate, true);
  presentation.lateUpdate(0.016);
  assert.deepEqual(calls, [['camera', 0.016], 'pov', 'matrices', ['bar', 0.016]]);
  assert.ok(Math.hypot(engine.sun.target.position.x - 4, engine.sun.target.position.z - 9) < 0.02, 'the sun follows Lola');
  assert.equal(brainLabel.textContent, 'BRAIN 7,757,824 · PAUSED');
  assert.equal(statusElement.textContent, 'LIVE TRAINED BRAIN // PAUSED // STEP 3');
  calls.length = 0;
  paused = true;
  presentation.lateUpdate(0.016);
  assert.deepEqual(calls, [['camera', 0.016], 'pov', 'matrices', ['bar', 0]], 'the camera keeps real time while paused');
});
