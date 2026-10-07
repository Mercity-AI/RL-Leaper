import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { LolaPlayer } from '../src/robot/LolaPlayer.js';

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

test('both exported outfits have distinct walk/run clips and animate their skeletons', async () => {
  for (const weapon of ['basic', 'm416']) {
    const gltf = await load(weapon);
    assert.deepEqual(gltf.animations.map((clip) => clip.name).sort(), ['CrouchIdle', 'CrouchWalk', 'Idle', 'Run', 'Walk']);
    const mixer = new THREE.AnimationMixer(gltf.scene);
    const walk = gltf.animations.find((clip) => clip.name === 'Walk');
    const run = gltf.animations.find((clip) => clip.name === 'Run');
    assert.ok(walk.duration > run.duration * 1.4, 'walk cycle is slower than the sprint cycle');
    mixer.clipAction(walk).play();
    mixer.update(0.1);
    const bones = [];
    gltf.scene.traverse((o) => { if (o.isBone) bones.push(o); });
    assert.ok(bones.length > 15);
    const before = bones.map((b) => b.quaternion.toArray());
    mixer.update(0.3);
    assert.notDeepEqual(bones.map((b) => b.quaternion.toArray()), before);
    gltf.scene.updateMatrixWorld(true);
    for (const bone of bones) assert.ok(bone.matrixWorld.elements.every(Number.isFinite));
  }
});

test('animation clock and blending agree at 30 and 60 rendered frames per second', async () => {
  const samples = [];
  for (const fps of [30, 60]) {
    const models = await Promise.all([load('m416'), load('basic')]);
    const player = new LolaPlayer(new THREE.Scene(),
      { scale: 1, initialTarget: { x: 0, z: 0 }, playerBlocked: () => false },
      { addEventListener() {}, classList: { add() {} } }, models);
    for (let frame = 0; frame < fps * 2; frame += 1) {
      player.move(1, 0, new THREE.Vector3(0, 0, 1), new THREE.Vector3(-1, 0, 0), 4.5, 1 / fps);
    }
    samples.push({ time: player.outfits[0].actions.Walk.time,
      z: player.mesh.position.z, weight: player.outfits[0].actions.Walk.getEffectiveWeight() });
  }
  for (const key of ['time', 'z', 'weight']) assert.ok(Math.abs(samples[0][key] - samples[1][key]) < 1e-6);
});

test('WASD directions, sprint, wall sliding, and weapon switch preserve player position', async () => {
  const models = await Promise.all([load('m416'), load('basic')]);
  const button = { addEventListener() {}, classList: { add() {} } };
  const world = { scale: 1, initialTarget: { x: 0, z: 0 }, playerBlocked: (x) => x > 0.5 };
  const player = new LolaPlayer(new THREE.Scene(), world, button, models);
  const forward = new THREE.Vector3(0, 0, 1);
  const right = new THREE.Vector3(-1, 0, 0);
  player.move(1, 0, forward, right, 4.5, 0.1);
  const walked = player.mesh.position.z;
  player.move(-1, 0, forward, right, 4.5, 0.1);
  assert.ok(Math.abs(player.mesh.position.z) < 1e-6);
  assert.equal(player.mesh.rotation.y, 0, 'backing up does not turn Lola around');
  player.move(1, 0, forward, right, 8, 0.1);
  assert.ok(player.mesh.position.z > walked * 1.5);
  player.move(1, -1, forward, right, 8, 1);
  assert.ok(player.mesh.position.x <= 0.5, 'cannot cross the wall');
  assert.ok(player.mesh.position.z > 1, 'slides alongside it');
  const position = player.mesh.position.clone();
  player.switchWeapon();
  assert.equal(player.outfits[0].model.visible, false);
  assert.equal(player.outfits[1].model.visible, true);
  assert.ok(player.mesh.position.equals(position));
  player.move(0, 0, forward, right, 4.5, 0.1);
  assert.equal(player.outfits[1].current, 'Idle');
  for (let frame = 0; frame < 120; frame += 1) {
    player.move(1, 0, forward, right, 4.5, 1 / 60);
    for (const outfit of player.outfits) assert.equal(outfit.model.position.y, 0,
      'game must not bounce the model root to chase animated feet');
  }
  player.crouching = true;
  player.move(0, 0, forward, right, 8, 0.1);
  assert.equal(player.outfits[0].current, 'CrouchIdle');
  const crouchStart = player.mesh.position.z;
  player.move(1, 0, forward, right, 8, 0.1);
  assert.equal(player.outfits[0].current, 'CrouchWalk');
  assert.ok(player.mesh.position.z - crouchStart < walked, 'crouch overrides sprint speed');
  for (const outfit of player.outfits) {
    const sum = Object.values(outfit.actions).reduce((total, action) => total + action.getEffectiveWeight(), 0);
    assert.ok(Math.abs(sum - 1) < 1e-6, 'transition weights remain normalized');
  }
});
