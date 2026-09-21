import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { JunkyardBrain } from '../src/simulation/JunkyardBrain.js';

function fixture() {
  const button = { textContent: 'STOP RUN' };
  const playtest = {
    world: { width: 4 }, walking: true, message: {}, brainLabel: {},
    panel: { querySelector: () => button },
    target: { mesh: { position: new THREE.Vector3(0, 3.5, 10) }, move() {} },
    simulation: {
      state: { position: new THREE.Vector3(), yaw: 0 },
      input: { update() {}, getMovement: () => ({forward: 0, side: 0}),
        getTargetMovement: () => ({forward: 0, side: 0}) },
      cameraController: { getMovementHeading: () => 0 },
      v: [new THREE.Vector3(), new THREE.Vector3()],
      updateExternal() {}, statusElement: {},
    },
  };
  const driver = new JunkyardBrain(playtest);
  return { driver, playtest, button };
}
const frame = { x: 0, z: 0, yaw: 0, distance: 10, step: 0, model_step: 7757824,
  target_visible: false, target_ever_seen: false, policy_sha256: 'test-hash', token: 'test-token' };

test('Pause/resume preserves the server session; moving pink does not reset memory', async () => {
  globalThis.document = { hidden: false };
  const { driver, playtest } = fixture();
  const calls = [];
  driver.request = async (path, data) => { calls.push({path, data}); return {...frame, step: calls.length}; };
  await driver.reset();
  driver.start();
  driver.update(1 / 30);
  await new Promise(resolve => setImmediate(resolve));
  driver.stop();
  driver.update(1);
  assert.equal(calls.length, 2);
  playtest.target.mesh.position.x = 12;
  driver.start();
  driver.update(1 / 30);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 3);
  assert.equal(calls[2].path, 'step');
  assert.equal(calls[2].data.token, 'test-token');
  assert.deepEqual(calls[2].data.target, [12, 10]);
  assert.equal(driver.running, true);
});

test('A stale reset cannot replace a newer session; failed inference never falls back', async () => {
  globalThis.document = { hidden: false };
  const { driver, button } = fixture();
  const pending = [];
  driver.request = () => new Promise(resolve => pending.push(resolve));
  const old = driver.reset();
  const fresh = driver.reset();
  pending[1]({...frame, token: 'new'});
  await fresh;
  pending[0]({...frame, token: 'old'});
  await old;
  assert.equal(driver.token, 'new');
  driver.request = async () => { throw new Error('Service disconnected'); };
  driver.start();
  driver.update(1 / 30);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(driver.ready, false);
  assert.equal(driver.running, false);
  assert.equal(button.textContent, 'START RUN');
  assert.match(driver.label, /OFFLINE/);
});
