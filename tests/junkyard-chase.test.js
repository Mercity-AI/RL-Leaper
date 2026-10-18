import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { JunkyardBrain } from '../src/simulation/JunkyardBrain.js';

function fixture() {
  const button = { textContent: 'STOP RUN' };
  const playtest = {
    world: { width: 4 }, walking: true, message: {}, brainLabel: {}, cameraController: { releaseMouse() {} },
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
  driver.update(1 / 10);
  await new Promise(resolve => setImmediate(resolve));
  driver.stop();
  driver.update(1);
  assert.equal(calls.length, 2);
  playtest.target.mesh.position.x = 12;
  driver.start();
  driver.update(1 / 10);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 3);
  assert.equal(calls[2].path, 'step');
  assert.equal(calls[2].data.token, 'test-token');
  assert.deepEqual(calls[2].data.target, [12, 10]);
  assert.equal(driver.running, true);
});

test('A stale reset cannot replace a newer session; failed inference retries, then stops without fallback', async () => {
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
  // The game (not the brain client) decides what an offline brain means for the fight.
  const failures = [];
  driver.onFailed = (error) => failures.push(error.message);
  driver.request = async () => { throw new Error('Service disconnected'); };
  driver.start();
  driver.update(1 / 10);
  await new Promise(resolve => setImmediate(resolve));
  // One slow or failed move (a busy computer) keeps the run going and retries.
  assert.equal(driver.running, true);
  assert.equal(driver.failedSteps, 1);
  for (let i = 0; i < 4; i++) {
    driver.update(1 / 10);
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.equal(driver.ready, false);
  assert.equal(driver.running, false);
  assert.deepEqual(failures, ['Service disconnected'], 'the failure is reported once, after the retries');
  assert.equal(button.textContent, 'STOP RUN', 'the brain client no longer edits the toolbar itself');
  assert.match(driver.label, /OFFLINE/);
});

test('pausing during inference keeps the final authoritative pose for contact', async () => {
  globalThis.document = { hidden: false };
  const { driver } = fixture();
  driver.request = async () => frame;
  await driver.reset();
  let finish;
  driver.request = () => new Promise(resolve => { finish = resolve; });
  driver.start();
  driver.update(1 / 10);
  driver.stop();
  finish({ ...frame, x: 0.375, step: 1 });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(driver.frame.x, 0.375);
  assert.equal(driver.running, false);
  assert.equal(driver.busy, false);
});

test('the brain address comes from VITE_BRAIN_URL, then ?brainUrl=, then the local default', async () => {
  const { brainServiceUrl, DEFAULT_BRAIN_URL } = await import('../src/simulation/JunkyardBrain.js');
  assert.equal(DEFAULT_BRAIN_URL, 'http://127.0.0.1:8767');
  assert.equal(brainServiceUrl({ envUrl: undefined, search: '' }), DEFAULT_BRAIN_URL);
  assert.equal(brainServiceUrl({ envUrl: undefined, search: '?brainUrl=http://10.0.0.5:9000/' }), 'http://10.0.0.5:9000');
  assert.equal(brainServiceUrl({ envUrl: 'https://brain.example/api/', search: '?brainUrl=http://10.0.0.5:9000' }),
    'https://brain.example/api', 'the build setting wins');
  assert.equal(brainServiceUrl({ envUrl: undefined, search: '?brainUrl=javascript:alert(1)' }), DEFAULT_BRAIN_URL,
    'only http(s) addresses are used');
  assert.equal(brainServiceUrl({ envUrl: 'not a url', search: '' }), DEFAULT_BRAIN_URL);
});

test('an offline brain leaves the run going in turret mode, and START RUN retries it (review 5.1)', async () => {
  globalThis.document = { hidden: false };
  const { BRAIN_OFFLINE_LABEL, BRAIN_TURRET_LABEL } = await import('../src/simulation/JunkyardBrain.js');
  const { driver, playtest } = fixture();
  const paths = [];
  driver.request = async (path) => { paths.push(path); throw new Error('Failed to fetch'); };
  playtest.walking = false;
  await driver.reset();
  assert.equal(driver.offline, true);
  assert.equal(driver.describe().label, BRAIN_OFFLINE_LABEL, 'stopped: how to fix it');
  assert.match(playtest.message.textContent, /see README.*START RUN.*turret mode/);
  // START RUN: the game keeps the run on; the brain tries again, then says TURRET MODE.
  playtest.walking = true;
  driver.start();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(paths, ['reset', 'reset'], 'START RUN retries the service');
  assert.equal(driver.describe().label, BRAIN_TURRET_LABEL);
  // The planted Leaper keeps its pose: no moves are asked for while offline.
  driver.update(1);
  assert.deepEqual(paths, ['reset', 'reset']);
  // During the run the service is tried again every 5 s of play, without the
  // badge flickering away from TURRET MODE while it waits.
  driver.update(4.5);
  assert.equal(driver.describe().label, BRAIN_TURRET_LABEL);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(paths, ['reset', 'reset', 'reset'], 'turret mode retries the service');
  assert.equal(driver.describe().label, BRAIN_TURRET_LABEL);
  // The service comes back: the next retry succeeds and the label returns to normal.
  driver.request = async () => frame;
  driver.stop();
  driver.start();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(driver.offline, false);
  assert.equal(driver.ready, true);
  assert.match(driver.describe().label, /^BRAIN 7,757,824 · /);
});

// The badge tells the player why the Leaper isn't moving, and the "brain loaded"
// note never tells a run that is already going to press START RUN.
test('the brain badge says STOPPED, PAUSED or ENCOUNTER OVER, and the loaded note fits the moment', async () => {
  globalThis.document = { hidden: false };
  const { driver, playtest } = fixture();
  driver.request = async () => frame;
  // Loaded while a run is going: no "Start Run" instruction.
  await driver.reset();
  assert.doesNotMatch(playtest.message.textContent, /Start Run/);
  assert.match(playtest.message.textContent, /hunting/);
  // Loaded while paused: the pause instructions stay.
  playtest.paused = true;
  playtest.walking = false;
  playtest.message.textContent = 'Paused with Escape.';
  await driver.reset();
  assert.equal(playtest.message.textContent, 'Paused with Escape.');
  assert.match(driver.describe().label, /· PAUSED$/);
  // Stopped (Ready, or exploring as Lola): the brain is stopped, not paused.
  playtest.paused = false;
  await driver.reset();
  assert.match(playtest.message.textContent, /Start Run/);
  assert.match(driver.describe().label, /· STOPPED$/);
  // After the fight, with or without the service.
  playtest.combat = { dead: true };
  assert.match(driver.describe().label, /· ENCOUNTER OVER$/);
  driver.offline = true;
  assert.equal(driver.describe().label, 'BRAIN OFFLINE · ENCOUNTER OVER', 'no "press START RUN" while it is disabled');
});

// After the session is torn down, a reply still in flight must not redraw the
// (removed) sight lines or overwrite the pose.
test('a disposed brain stops and ignores replies that arrive afterwards', async () => {
  globalThis.document = { hidden: false };
  const { driver } = fixture();
  driver.request = async () => frame;
  await driver.reset();
  let finish;
  driver.request = () => new Promise((resolve) => { finish = resolve; });
  driver.start();
  driver.update(1 / 10);
  driver.dispose();
  finish({ ...frame, x: 0.375, step: 1 });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(driver.running, false);
  assert.equal(driver.frame.x, 0, 'the late reply is ignored');
});

// The kill can land while a move is still being computed. The wreck stays where
// it fell, so the late move must not shift the discs that stop Lola walking into it.
test('a move that arrives after the fight ended does not move the Leaper contact', async () => {
  globalThis.document = { hidden: false };
  const { driver, playtest } = fixture();
  playtest.combat = { dead: false };
  driver.request = async () => frame;
  await driver.reset();
  let finish;
  driver.request = () => new Promise((resolve) => { finish = resolve; });
  driver.start();
  driver.update(1 / 10);
  playtest.combat.dead = true;
  finish({ ...frame, x: 0.375, step: 1 });
  await new Promise((resolve) => setImmediate(resolve));
  const { from, to, margin } = driver.contactPoses();
  assert.equal(from.x, 0);
  assert.equal(to.x, 0, 'the contact stays at the wreck');
  assert.equal(margin, 0, 'and the in-flight margin is released');
  assert.equal(driver.busy, false);
});
