import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { LolaPlayer } from '../src/robot/LolaPlayer.js';

// Golden values recorded from LolaPlayer at a966390, before it was split into
// smaller parts; the run, sprint and strafe ones re-recorded on 2026-10-21 when
// the owner made her 15% faster (every distance exactly 1.15x the old one). They pin the movement, footsteps and poses that must survive
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
  'W/0': { x: 0, z: 5.685194, current: 'Run', time: 0.9880121, weight: 1, eye: [0.0142741, 1.4574638, 5.9571765], steps: [[3, 'walk', false], [24, 'walk', false], [44, 'walk', false], [63, 'walk', false], [83, 'walk', false], [102, 'walk', false]] },
  'S/0': { x: 0, z: -5.685194, current: 'Run', time: 0.0119879, weight: 1, eye: [0.0166914, 1.4466695, -5.4133636], steps: [[13, 'walk', false], [33, 'walk', false], [52, 'walk', false], [72, 'walk', false], [91, 'walk', false], [111, 'walk', false]] },
  'Wsprint/0': { x: 0, z: 7.6626528, current: 'Run', time: 0.0273206, weight: 1, eye: [0.0180423, 1.4360165, 7.9344028], steps: [[3, 'run', false], [19, 'run', false], [33, 'run', false], [48, 'run', false], [62, 'run', false], [77, 'run', false], [91, 'run', false], [105, 'run', false]] },
  'crouchW/0': { x: 0, z: 2.0328649, current: 'CrouchWalk', time: 1.2476615, weight: 1, eye: [-0.0126526, 1.1373904, 2.3010274], steps: [[17, 'walk', true], [46, 'walk', true], [77, 'walk', true], [106, 'walk', true]] },
  'W/1': { x: 0, z: 5.685194, current: 'Run', time: 0.9880121, weight: 1, eye: [0.0139148, 1.4840055, 5.8974117], steps: [[3, 'walk', false], [24, 'walk', false], [44, 'walk', false], [63, 'walk', false], [83, 'walk', false], [102, 'walk', false]] },
  'S/1': { x: 0, z: -5.685194, current: 'Run', time: 0.0119879, weight: 1, eye: [0.0163219, 1.4731961, -5.4731326], steps: [[13, 'walk', false], [33, 'walk', false], [52, 'walk', false], [72, 'walk', false], [91, 'walk', false], [111, 'walk', false]] },
  'Wsprint/1': { x: 0, z: 7.6626528, current: 'Run', time: 0.0273206, weight: 1, eye: [0.0176709, 1.4625332, 7.874637], steps: [[3, 'run', false], [19, 'run', false], [33, 'run', false], [48, 'run', false], [62, 'run', false], [77, 'run', false], [91, 'run', false], [105, 'run', false]] },
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
    near(player.mesh.position.z, 2.8515465, 1e-6, `release/${weapon} z`);
    assert.equal(outfit.current, 'Idle');
    near(outfit.actions.Idle.getEffectiveWeight(), 0.9998883, 1e-6, `release/${weapon} idle weight`);
  }
});

test('pinned: a steady strafe travels sideways at its measured stride', async () => {
  const recorded = { StrafeRight: { x: -2.1177298, time: 0.6502062 }, StrafeLeft: { x: 2.1177298, time: 0.6502092 } };
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
