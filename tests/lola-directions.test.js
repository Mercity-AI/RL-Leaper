import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { LolaPlayer } from '../src/robot/LolaPlayer.js';
import { LolaLocomotion } from '../src/actors/lola/LolaLocomotion.js';
import { undoWarp } from '../src/actors/lola/LolaAnimator.js';

// Directional movement (review fix 5.32): run and strafe blend by the stick
// angle on one shared stride phase, travel speed comes from the same weights,
// and diagonals twist her hips toward the way she goes, so W+D is as fast as
// W with planted boots while her chest and gun keep facing forward.

// Exercise the real exported skeleton/animations without a browser image decoder.
globalThis.window = { URL, addEventListener() {} };
globalThis.self = globalThis.window;
async function load(name) {
  const file = fs.readFileSync(new URL(`../assets/characters/lola/lola-${name}.glb`, import.meta.url));
  const loader = new GLTFLoader();
  loader.register(() => ({ name: 'TEST_TEXTURES', loadTexture: () => Promise.resolve(new THREE.Texture()) }));
  return new Promise((resolve, reject) => loader.parse(
    file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength), '', resolve, reject,
  ));
}
const FORWARD = new THREE.Vector3(0, 0, 1);
const RIGHT = new THREE.Vector3(-1, 0, 0);
let models;
async function makePlayer(weapon = 0) {
  models ??= await Promise.all([load('m416'), load('basic')]);
  const player = new LolaPlayer(new THREE.Scene(), { scale: 1, initialTarget: { x: 0, z: 0 }, playerBlocked: () => false },
    { addEventListener() {}, classList: { add() {} } }, models);
  if (weapon) player.switchWeapon();
  return player;
}
const named = (root, name) => root.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(name));

// Two steady seconds at a stick input: travel speed (units/s) and the median
// speed of a toe while it is planted (within 1.5 cm of the floor) — "skating".
async function measure(forward, side, weapon = 0) {
  const player = await makePlayer(weapon);
  const toes = ['DEF-toe.L', 'DEF-toe.R'].map(name => named(player.equipped.model, name));
  for (let i = 0; i < 90; i += 1) player.move(forward, side, FORWARD, RIGHT, 4.5, 1 / 60);
  const start = player.mesh.position.clone(), frames = [];
  for (let i = 0; i < 120; i += 1) {
    player.move(forward, side, FORWARD, RIGHT, 4.5, 1 / 60);
    player.mesh.updateMatrixWorld(true);
    frames.push(toes.map(toe => toe.getWorldPosition(new THREE.Vector3())));
  }
  const floor = Math.min(...frames.flat().map(point => point.y));
  const slips = [];
  for (let i = 1; i < frames.length; i += 1) {
    for (const k of [0, 1]) {
      if (frames[i][k].y < floor + 0.015 && frames[i - 1][k].y < floor + 0.015) {
        slips.push(Math.hypot(frames[i][k].x - frames[i - 1][k].x, frames[i][k].z - frames[i - 1][k].z) * 60);
      }
    }
  }
  slips.sort((a, b) => a - b);
  return { player, speed: player.mesh.position.distanceTo(start) / 2, slip: slips[Math.floor(slips.length / 2)] };
}

test('directional weights follow the stick angle and always add up to one', () => {
  const locomotion = new LolaLocomotion();
  const at = degrees => locomotion.targets(Math.cos(degrees * Math.PI / 180), Math.sin(degrees * Math.PI / 180), 1, false).weights;
  assert.deepEqual(at(0), { Run: 1, StrafeRight: 0 });
  assert.deepEqual(at(45), { Run: 1, StrafeRight: 0 }, 'the diagonal is the run with a hip twist');
  const middle = at(67.5);
  assert.ok(Math.abs(middle.Run - 0.5) < 1e-9 && Math.abs(middle.StrafeRight - 0.5) < 1e-9, 'half way the run hands over to the strafe');
  const right = at(90);
  assert.ok(right.Run < 1e-9 && Math.abs(right.StrafeRight - 1) < 1e-9);
  assert.ok(at(-60).StrafeLeft > 0 && at(150).Run === 1, 'left and backward directions mirror it');
  for (let degrees = -180; degrees <= 180; degrees += 7.5) {
    const sum = Object.values(at(degrees)).reduce((total, weight) => total + weight, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9, `weights add up to 1 at ${degrees} degrees`);
  }
  assert.deepEqual(locomotion.targets(1, 1, 1, true).weights, { CrouchWalk: 1 });
  assert.deepEqual(locomotion.targets(0, 0, 0, false).weights, { Idle: 1 });
});

test('W+D runs as fast as W with planted boots (and S+D, W+A too)', async () => {
  for (const weapon of [0, 1]) {
    const straight = await measure(1, 0, weapon);
    for (const [forward, side] of [[1, 1], [-1, 1], [1, -1]]) {
      const diagonal = await measure(forward, side, weapon);
      const label = `${weapon ? 'pistol' : 'M416'} ${forward > 0 ? 'W' : 'S'}+${side > 0 ? 'D' : 'A'}`;
      assert.ok(diagonal.slip < 0.3, `${label}: planted boot skates at ${diagonal.slip.toFixed(2)} units/s (was 1.40)`);
      assert.ok(Math.abs(diagonal.speed - straight.speed) <= 0.1 * straight.speed,
        `${label}: ${diagonal.speed.toFixed(2)} units/s vs W ${straight.speed.toFixed(2)} (was 30% slower)`);
    }
  }
});

test('every stick angle keeps a sensible speed, and the run and strafe stay in step', async () => {
  const strafe = (await measure(0, 1)).speed;
  for (const degrees of [60, 67.5, 75, 105, 120]) {
    const { player, speed } = await measure(Math.cos(degrees * Math.PI / 180), Math.sin(degrees * Math.PI / 180));
    assert.ok(speed >= 0.8 * strafe, `${degrees} degrees: ${speed.toFixed(2)} units/s`);
    // Blended clips plant the left boot at the same moment (one shared phase).
    const outfit = player.equipped;
    const phase = (name, sign) => {
      const action = outfit.actions[name], duration = action.getClip().duration;
      const plant = LolaLocomotion.alignment(outfit, name, sign);
      return ((sign * (action.time / duration - plant)) % 1 + 1) % 1;
    };
    const forward = Math.cos(degrees * Math.PI / 180) < 0 ? -1 : 1;
    const difference = Math.abs(phase('Run', forward) - phase('StrafeRight', 1));
    assert.ok(Math.min(difference, 1 - difference) < 1e-6, `${degrees} degrees: run and strafe in step`);
  }
});

test('the hip twist turns the legs toward the travel but keeps chest and gun facing forward', async () => {
  const { player } = await measure(1, 1);
  const outfit = player.equipped;
  assert.ok(Math.abs(player.warp - Math.PI / 4) < 0.01, `W+D twists the hips 45 degrees (${(player.warp * 180 / Math.PI).toFixed(1)})`);
  // Compare the pose with and without the twist, in her own model space.
  const inModel = name => {
    player.mesh.updateMatrixWorld(true);
    const matrix = new THREE.Matrix4().copy(outfit.model.matrixWorld).invert().multiply(named(outfit.model, name).matrixWorld);
    const rotation = new THREE.Quaternion();
    matrix.decompose(new THREE.Vector3(), rotation, new THREE.Vector3());
    return rotation;
  };
  const twisted = { chest: inModel('DEF-spine.004'), pelvis: inModel('DEF-spine') };
  const bases = outfit.warpBases.slice();
  const saved = bases.map(({ bone }) => ({ bone, position: bone.position.clone(), quaternion: bone.quaternion.clone() }));
  undoWarp(outfit);
  const straight = { chest: inModel('DEF-spine.004'), pelvis: inModel('DEF-spine') };
  saved.reverse().forEach(({ bone, position, quaternion }) => { bone.position.copy(position); bone.quaternion.copy(quaternion); });
  outfit.warpBases = bases;
  assert.ok(twisted.chest.angleTo(straight.chest) < 0.5 * Math.PI / 180, 'the chest (and the arms and gun on it) face forward');
  assert.ok(Math.abs(twisted.pelvis.angleTo(straight.pelvis) - Math.PI / 4) < 0.01, 'the pelvis turns with the legs');
  // Letting go straightens her up again.
  for (let i = 0; i < 60; i += 1) player.move(0, 0, FORWARD, RIGHT, 4.5, 1 / 60);
  assert.ok(Math.abs(player.warp) < 0.01, 'standing still she is not twisted');
});
