import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { PlayerController, PLAYER_SPEED } from '../src/game/PlayerController.js';
import { LOLA_STAMINA } from '../src/actors/lola/lolaTuning.js';
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
  const key = (type, code, repeat = false) => listeners[type]({ code, repeat, preventDefault() {} });
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

test('Lola sprints for 10 s, is winded for 4 s at her normal run, then sprints again (owner, 2026-10-21)', () => {
  const { input, key } = realInput();
  const player = fakePlayer();
  const controller = new PlayerController({ player, input, cameraController: camera(0) });
  assert.deepEqual({ ...LOLA_STAMINA }, { sprintSeconds: 10, restSeconds: 4 });
  const frame = () => { controller.sample(0.1); controller.update(0.1); return player.moves.at(-1).speed; };
  key('keydown', 'KeyW'); key('keydown', 'ShiftLeft');
  const speeds = Array.from({ length: 150 }, frame); // 15 s holding Shift
  const sprinted = speeds.findIndex((speed) => speed !== PLAYER_SPEED.sprint);
  assert.ok(sprinted >= 99 && sprinted <= 101, `about 10 s of sprint (${sprinted / 10} s)`);
  const winded = speeds.slice(sprinted).findIndex((speed) => speed === PLAYER_SPEED.sprint);
  assert.ok(winded >= 39 && winded <= 41, `then about 4 s at the run (${winded / 10} s)`);
  // Holding Shift while standing still costs nothing.
  controller.reset();
  key('keyup', 'KeyW');
  for (let i = 0; i < 50; i++) frame();
  assert.equal(controller.stamina.energy, 1);
});

test('letting go of Shift early refills the breath (a full refill takes 4 s)', () => {
  const { input, key } = realInput();
  const player = fakePlayer();
  const controller = new PlayerController({ player, input, cameraController: camera(0) });
  const frame = () => { controller.sample(0.1); controller.update(0.1); };
  key('keydown', 'KeyW'); key('keydown', 'ShiftLeft');
  for (let i = 0; i < 50; i++) frame(); // 5 s of sprint: half the breath
  assert.ok(Math.abs(controller.stamina.energy - 0.5) < 1e-9);
  key('keyup', 'ShiftLeft');
  for (let i = 0; i < 20; i++) frame(); // 2 s of running
  assert.ok(Math.abs(controller.stamina.energy - 1) < 1e-9, 'full again');
  assert.equal(controller.stamina.winded, false);
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

// A stand-in Lola that can also crouch and switch guns (weaponIndex 0 = M416, 1 = pistol).
function armedPlayer() {
  return Object.assign(fakePlayer(), {
    weaponIndex: 0, crouches: 0, switches: 0,
    toggleCrouch() { this.crouches += 1; },
    switchWeapon() { this.switches += 1; this.weaponIndex = 1 - this.weaponIndex; },
  });
}
function frame(controller, options) {
  controller.sample(1 / 60, options);
  controller.update(options?.frozen ? 0 : 1 / 60);
}

test('C crouches and 1 / 2 pick guns as input actions, and a pause freezes them too', () => {
  const { input, key } = realInput();
  const player = armedPlayer();
  const controller = new PlayerController({ player, input, cameraController: camera(0) });
  // Pressed during a pause: nothing happens, then or afterwards.
  key('keydown', 'KeyC'); key('keyup', 'KeyC');
  key('keydown', 'Digit1'); key('keyup', 'Digit1');
  frame(controller, { frozen: true });
  frame(controller);
  assert.deepEqual([player.crouches, player.switches], [0, 0], 'a pause froze C and 1');
  // While playing: one press, one change.
  key('keydown', 'KeyC');
  frame(controller);
  key('keydown', 'KeyC', true);
  frame(controller);
  assert.equal(player.crouches, 1, 'held C (key repeat) toggles once');
  key('keydown', 'Digit1');
  frame(controller);
  assert.equal(player.weaponIndex, 1, '1 = the pistol');
  key('keyup', 'Digit1'); key('keydown', 'Digit1');
  frame(controller);
  assert.equal(player.weaponIndex, 1, 'the equipped gun\'s key keeps it');
  key('keydown', 'Digit2');
  frame(controller);
  assert.equal(player.weaponIndex, 0, '2 = the M416');
});

test('the gamepad and touch buttons: move, look, switch guns, pause and resume', () => {
  const { input } = realInput();
  const pad = { connected: true, buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })), axes: [0, -1, 1, 0] };
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { getGamepads: () => [pad] } });
  try {
    const player = armedPlayer();
    let looked = 0, pauses = 0, resumes = 0;
    const cameraController = { getMovementHeading: () => 0, lookBy: (yaw) => { looked += yaw; },
      requestPause: () => { pauses += 1; }, requestResume: () => { resumes += 1; } };
    const controller = new PlayerController({ player, input, cameraController });
    frame(controller);
    assert.ok(player.moves.at(-1).forward > 0.99, 'left stick forward');
    assert.ok(looked > 0, 'right stick turns the camera');
    pad.buttons[3] = { pressed: true, value: 1 };
    frame(controller);
    assert.equal(player.weaponIndex, 1, 'Y switches guns');
    pad.buttons[9] = { pressed: true, value: 1 };
    frame(controller);
    assert.equal(pauses, 1, 'Start pauses');
    pad.buttons[9] = { pressed: false, value: 0 };
    frame(controller, { frozen: true });
    pad.buttons[9] = { pressed: true, value: 1 };
    frame(controller, { frozen: true });
    assert.equal(resumes, 1, 'Start again resumes');
    // The touch SWITCH button is the same action.
    input.virtualDown('switchWeapon');
    frame(controller);
    assert.equal(player.weaponIndex, 0);
  } finally {
    if (saved) Object.defineProperty(globalThis, 'navigator', saved);
    else delete globalThis.navigator;
  }
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
