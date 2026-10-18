import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { PlayerController, PLAYER_SPEED } from '../src/game/PlayerController.js';
import { InputController } from '../src/controls/InputController.js';
import { LolaPlayer } from '../src/robot/LolaPlayer.js';

// The real InputController (so the real 0.16 s jump buffer is tested) on a fake page.
function realInput() {
  const listeners = {};
  const element = () => ({ addEventListener() {}, classList: { add() {}, remove() {} }, style: {} });
  globalThis.window = { URL, addEventListener: (name, fn) => { listeners[name] = fn; }, matchMedia: () => ({ matches: false }) };
  globalThis.self = globalThis.window;
  globalThis.document = { getElementById: element };
  const input = new InputController(() => {});
  const key = (type, code) => listeners[type]({ code, repeat: false, preventDefault() {} });
  return { input, key };
}

// A stand-in for Lola that records what the controller asked her to do.
function fakePlayer() {
  return {
    isPlayer: true, canJump: true, jumps: 0, moves: [],
    jump() { this.jumps += 1; },
    move(forward, side, forwardVector, rightVector, speed, dt) {
      this.moves.push({ forward, side, forwardVector: forwardVector.clone(), rightVector: rightVector.clone(), speed, dt });
    },
  };
}

const camera = (heading) => ({ getMovementHeading: () => heading });

test('WASD plus the old IJKL keys move Lola along the camera heading, Shift sprints', () => {
  const { input, key } = realInput();
  const player = fakePlayer();
  const controller = new PlayerController({ player, input, cameraController: camera(Math.PI / 2) });
  key('keydown', 'KeyW');
  key('keydown', 'KeyL');
  controller.sample(0.1);
  controller.update(0.1);
  const move = player.moves[0];
  assert.deepEqual([move.forward, move.side, move.speed, move.dt], [1, 1, PLAYER_SPEED.run, 0.1]);
  assert.ok(move.forwardVector.distanceTo(new THREE.Vector3(1, 0, 0)) < 1e-12, 'forward follows the camera heading');
  assert.ok(move.rightVector.distanceTo(new THREE.Vector3(0, 0, 1)) < 1e-12);
  key('keydown', 'ShiftLeft');
  controller.sample(0.1);
  controller.update(0.1);
  assert.equal(player.moves[1].speed, PLAYER_SPEED.sprint);
});

test('a jump pressed while Lola cannot jump yet is kept until she can (review fix 5.36)', () => {
  const { input, key } = realInput();
  const player = fakePlayer();
  const controller = new PlayerController({ player, input, cameraController: camera(0) });
  player.canJump = false; // mid-jump: the authored clip keeps her "grounded" but busy
  key('keydown', 'Space');
  controller.sample(0.05);
  controller.update(0.05);
  assert.equal(player.jumps, 0, 'not yet');
  player.canJump = true; // the first jump finished 0.05 s later
  controller.sample(0.05);
  controller.update(0.05);
  assert.equal(player.jumps, 1, 'the buffered press starts the next jump on the first eligible frame');
  controller.sample(0.05);
  controller.update(0.05);
  assert.equal(player.jumps, 1, 'one press, one jump');
  // A press that is older than the 0.16 s buffer is still dropped.
  player.canJump = false;
  key('keydown', 'Space');
  for (let i = 0; i < 4; i += 1) controller.sample(0.05);
  player.canJump = true;
  controller.sample(0.05);
  controller.update(0.05);
  assert.equal(player.jumps, 1);
});

test('while frozen (paused) Lola is not moved and presses are not replayed afterwards', () => {
  const { input, key } = realInput();
  const player = fakePlayer();
  const controller = new PlayerController({ player, input, cameraController: camera(0) });
  key('keydown', 'KeyW');
  key('keydown', 'Space');
  for (let i = 0; i < 4; i += 1) {
    controller.sample(0.05, { frozen: true });
    controller.update(0);
  }
  assert.equal(player.moves.length, 0);
  controller.sample(0.05);
  controller.update(0.05);
  assert.equal(player.jumps, 0, 'the press ran out during the pause');
  assert.equal(player.moves.length, 1, 'movement resumes');
});

// Real Lola: canJump is false from take-off until she can jump again.
test('LolaPlayer.canJump matches when jump() would start a jump', async () => {
  globalThis.window = { URL, addEventListener() {} };
  globalThis.self = globalThis.window;
  const load = async (weapon) => {
    const file = fs.readFileSync(new URL(`../assets/characters/lola/lola-${weapon}.glb`, import.meta.url));
    const loader = new GLTFLoader();
    loader.register(() => ({ name: 'TEST_TEXTURES', loadTexture: () => Promise.resolve(new THREE.Texture()) }));
    return new Promise((resolve, reject) => loader.parse(
      file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength), '', resolve, reject));
  };
  const player = new LolaPlayer(new THREE.Scene(),
    { scale: 1, initialTarget: { x: 0, z: 0 }, playerBlocked: () => false },
    { addEventListener() {}, classList: { add() {} } }, await Promise.all([load('m416'), load('basic')]));
  const still = [0, 0, new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0), PLAYER_SPEED.run];
  assert.equal(player.canJump, true);
  assert.equal(player.jump(), true);
  assert.equal(player.canJump, false, 'airborne');
  assert.equal(player.jump(), false);
  let frames = 0;
  while (!player.canJump && frames < 200) { player.move(...still, 1 / 60); frames += 1; }
  assert.ok(frames < 200, 'she lands and can jump again');
  player.defeated = true;
  assert.equal(player.canJump, false, 'never while defeated');
});
