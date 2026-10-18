import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { LolaPlayer } from '../src/robot/LolaPlayer.js';

// Golden values recorded from LolaPlayer at a966390, before it was split into
// smaller parts. They pin the movement, footsteps and poses that must survive
// that refactor unchanged: straight runs, backpedals, sprints, crouch walks,
// steady strafes, stopping, and where the standing shot's muzzle sits.

// Exercise the real exported skeleton/animations without a browser image decoder.
globalThis.window = { URL, addEventListener() {} };
globalThis.self = globalThis.window;
async function load(weapon) {
  const file = fs.readFileSync(new URL(`../assets/characters/lola/lola-${weapon}.glb`, import.meta.url));
  const loader = new GLTFLoader();
  loader.register(() => ({ name: 'TEST_TEXTURES', loadTexture: () => Promise.resolve(new THREE.Texture()) }));
  return new Promise((resolve, reject) => loader.parse(
    file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength), '', resolve, reject,
  ));
}

const FORWARD = new THREE.Vector3(0, 0, 1);
const RIGHT = new THREE.Vector3(-1, 0, 0);
async function makePlayer(weaponIndex) {
  const player = new LolaPlayer(new THREE.Scene(),
    { scale: 1, initialTarget: { x: 0, z: 0 }, playerBlocked: () => false },
    { addEventListener() {}, classList: { add() {} } }, await Promise.all([load('m416'), load('basic')]));
  player.weaponIndex = weaponIndex;
  player.showWeapon();
  return player;
}
const near = (actual, expected, tolerance, label) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} vs recorded ${expected}`);

// Two seconds from a standstill at 60 fps, per gun: where she ends up, which
// clip plays and where it is, her eye position and every footstep frame.
const RUNS = {
  'W/0': { x: 0, z: 4.943647, current: 'Run', time: 0.5982714, weight: 1, eye: [-0.0219964, 1.4047378, 5.2152837], steps: [[4, 'walk', false], [27, 'walk', false], [50, 'walk', false], [72, 'walk', false], [95, 'walk', false], [117, 'walk', false]] },
  'S/0': { x: 0, z: -4.943647, current: 'Run', time: 0.4017286, weight: 1, eye: [-0.0033269, 1.4837535, -4.6710461], steps: [[15, 'walk', false], [37, 'walk', false], [59, 'walk', false], [82, 'walk', false], [104, 'walk', false]] },
  'Wsprint/0': { x: 0, z: 6.6631764, current: 'Run', time: 0.5020179, weight: 1, eye: [-0.0158129, 1.4503164, 6.9350592], steps: [[3, 'run', false], [21, 'run', false], [38, 'run', false], [54, 'run', false], [71, 'run', false], [88, 'run', false], [104, 'run', false]] },
  'crouchW/0': { x: 0, z: 2.0328649, current: 'CrouchWalk', time: 1.2476615, weight: 1, eye: [-0.0126526, 1.1373904, 2.3010274], steps: [[17, 'walk', true], [46, 'walk', true], [77, 'walk', true], [106, 'walk', true]] },
  'W/1': { x: 0, z: 4.943647, current: 'Run', time: 0.5982714, weight: 1, eye: [-0.0216593, 1.4312196, 5.1555787], steps: [[4, 'walk', false], [27, 'walk', false], [50, 'walk', false], [72, 'walk', false], [95, 'walk', false], [117, 'walk', false]] },
  'S/1': { x: 0, z: -4.943647, current: 'Run', time: 0.4017286, weight: 1, eye: [-0.0030684, 1.5103307, -4.7307242], steps: [[15, 'walk', false], [37, 'walk', false], [59, 'walk', false], [82, 'walk', false], [104, 'walk', false]] },
  'Wsprint/1': { x: 0, z: 6.6631764, current: 'Run', time: 0.5020179, weight: 1, eye: [-0.0154447, 1.4768494, 6.8752885], steps: [[3, 'run', false], [21, 'run', false], [38, 'run', false], [54, 'run', false], [71, 'run', false], [88, 'run', false], [104, 'run', false]] },
  'crouchW/1': { x: 0, z: 2.0328649, current: 'CrouchWalk', time: 1.2476615, weight: 1, eye: [-0.0126526, 1.1373904, 2.3010274], steps: [[17, 'walk', true], [46, 'walk', true], [77, 'walk', true], [106, 'walk', true]] },
};
const INPUTS = { W: [1, 0, 4.5, false], S: [-1, 0, 4.5, false], Wsprint: [1, 0, 8, false], crouchW: [1, 0, 4.5, true] };

test('pinned: straight runs, backpedals, sprints and crouch walks travel, step and pose as recorded', async () => {
  for (const [key, expected] of Object.entries(RUNS)) {
    const [label, weapon] = key.split('/');
    const [f, s, speed, crouching] = INPUTS[label];
    const player = await makePlayer(Number(weapon));
    player.crouching = crouching;
    const steps = [];
    let frame = 0;
    player.onFootstep = (kind, crouched) => steps.push([frame, kind, crouched]);
    for (; frame < 120; frame += 1) player.move(f, s, FORWARD, RIGHT, speed, 1 / 60);
    const outfit = player.outfits[Number(weapon)];
    near(player.mesh.position.x, expected.x, 1e-6, `${key} x`);
    near(player.mesh.position.z, expected.z, 1e-6, `${key} z`);
    assert.equal(outfit.current, expected.current, `${key} clip`);
    near(outfit.actions[outfit.current].time, expected.time, 1e-6, `${key} clip time`);
    near(outfit.actions[outfit.current].getEffectiveWeight(), expected.weight, 1e-6, `${key} clip weight`);
    player.eyePosition().toArray().forEach((value, i) => near(value, expected.eye[i], 1e-5, `${key} eye[${i}]`));
    assert.deepEqual(steps, expected.steps, `${key} footsteps`);
  }
});

test('pinned: letting go after a run settles into Idle where recorded', async () => {
  for (const weapon of [0, 1]) {
    const player = await makePlayer(weapon);
    for (let i = 0; i < 60; i += 1) player.move(1, 0, FORWARD, RIGHT, 4.5, 1 / 60);
    for (let i = 0; i < 60; i += 1) player.move(0, 0, FORWARD, RIGHT, 4.5, 1 / 60);
    const outfit = player.outfits[weapon];
    near(player.mesh.position.z, 2.4796056, 1e-6, `release/${weapon} z`);
    assert.equal(outfit.current, 'Idle');
    near(outfit.actions.Idle.getEffectiveWeight(), 0.9998883, 1e-6, `release/${weapon} idle weight`);
  }
});

test('pinned: a steady strafe travels sideways at its measured stride', async () => {
  const recorded = { StrafeRight: { x: -1.8415042, time: 0.3045271 }, StrafeLeft: { x: 1.8415042, time: 0.3045297 } };
  for (const weapon of [0, 1]) {
    for (const [clip, side] of [['StrafeRight', 1], ['StrafeLeft', -1]]) {
      const player = await makePlayer(weapon);
      // Start mid-strafe: full input and the strafe already blended in.
      for (const outfit of player.outfits) {
        outfit.current = clip;
        for (const [name, action] of Object.entries(outfit.actions)) {
          action.time = 0;
          action.setEffectiveWeight(name === clip ? 1 : 0);
        }
      }
      player.inputSide = side;
      for (let i = 0; i < 60; i += 1) player.move(0, side, FORWARD, RIGHT, 4.5, 1 / 60);
      const outfit = player.outfits[weapon];
      near(player.mesh.position.x, recorded[clip].x, 1e-6, `${clip}/${weapon} x`);
      near(player.mesh.position.z, 0, 1e-6, `${clip}/${weapon} z`);
      near(outfit.actions[clip].time, recorded[clip].time, 1e-6, `${clip}/${weapon} time`);
      assert.equal(outfit.current, clip);
    }
  }
});

test('pinned: the standing shot raises the muzzle to the recorded spot', async () => {
  // Re-attaching the guns to her hands may move the muzzle by under a millimetre.
  const recorded = { 0: [-0.1049994, 1.2158084, 0.9486327], 1: [0, 1.2497496, 0.7443161] };
  for (const weapon of [0, 1]) {
    const player = await makePlayer(weapon);
    for (let i = 0; i < 10; i += 1) player.move(0, 0, FORWARD, RIGHT, 4.5, 1 / 60);
    assert.equal(player.startShot(0.24, 1.2), true);
    player.muzzlePosition().toArray().forEach((value, i) => near(value, recorded[weapon][i], 2e-3, `muzzle/${weapon}[${i}] at the shot`));
    for (let i = 0; i < 18; i += 1) player.move(0, 0, FORWARD, RIGHT, 4.5, 1 / 60);
    player.muzzlePosition().toArray().forEach((value, i) => near(value, recorded[weapon][i], 2e-3, `muzzle/${weapon}[${i}] after recoil`));
  }
});
