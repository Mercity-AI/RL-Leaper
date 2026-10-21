import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { LolaPlayer } from '../src/robot/LolaPlayer.js';
import { LOLA_FOOTING } from '../src/actors/lola/lolaTuning.js';
import { JunkyardNavigation } from '../src/world/JunkyardNavigation.js';
import { PLAYER_GRID } from '../src/world/junkyardCollision.js';
import { WorldCollision } from '../src/world/WorldCollision.js';

// Standing on low props (owner, 2026-10-21: "jump at least above the tires"):
// she walks up low steps, jumps onto barrels and tire stacks, and drops off.

globalThis.window = { URL, addEventListener() {} };
globalThis.self = globalThis.window;
async function load(path) {
  const file = fs.readFileSync(new URL(`../${path}`, import.meta.url));
  const loader = new GLTFLoader();
  loader.register(() => ({ name: 'TEST_TEXTURES', loadTexture: () => Promise.resolve(new THREE.Texture()) }));
  return new Promise((resolve, reject) => loader.parse(
    file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength), '', resolve, reject,
  ));
}

const assets = Promise.all([
  Promise.all([load('assets/characters/lola/lola-m416.glb'), load('assets/characters/lola/lola-basic.glb')]),
  Promise.all([load('assets/characters/lola/lola-jump-m416.glb'), load('assets/characters/lola/lola-jump-basic.glb')]),
]);

// A yard with one block of height `top` from z = 1.5 to 3 (any x); Lola's body
// (0.25 round) overlaps it from z = 1.25.
function blockWorld(top) {
  const over = (z) => z > 1.25 && z < 3.25;
  return {
    scale: 1, initialTarget: { x: 0, z: 0 },
    playerBlocked: (x, z) => over(z),
    playerSurface: (x, z, maxTop) => (!over(z) ? 0 : top > maxTop ? null : top),
    collision: new WorldCollision(),
  };
}

async function lola(world) {
  const [models, jumps] = await assets;
  return new LolaPlayer(new THREE.Scene(), world, { addEventListener() {}, classList: { add() {} } }, models, jumps);
}

const FORWARD = new THREE.Vector3(0, 0, 1), RIGHT = new THREE.Vector3(-1, 0, 0);
const walk = (player, frames, forward = 1) => {
  for (let i = 0; i < frames; i += 1) player.move(forward, 0, FORWARD, RIGHT, 4.5, 1 / 60);
};

test('she walks up a low step without jumping and back down off it', async () => {
  const player = await lola(blockWorld(0.3));
  walk(player, 40);
  assert.ok(player.mesh.position.z > 1.6, `on the step (${player.mesh.position.z.toFixed(2)})`);
  assert.ok(Math.abs(player.mesh.position.y - 0.3) < 1e-9, 'standing on its top');
  walk(player, 90);
  assert.ok(player.mesh.position.z > 3.3, 'past it');
  assert.equal(player.mesh.position.y, 0, 'back on the floor');
  assert.equal(player.grounded, true);
});

test('a barrel-high block stops a walk, a running jump lands on it, walking off drops her', async () => {
  const player = await lola(blockWorld(0.9));
  walk(player, 60);
  assert.ok(player.mesh.position.z <= 1.25 + 1e-6, 'walking: it is a wall');
  assert.equal(player.mesh.position.y, 0);
  player.mesh.position.z = 0.6;
  walk(player, 5);
  assert.equal(player.jump(), true);
  for (let i = 0; i < 120 && player.jumpState && player.mesh.position.z < 2.4; i += 1) walk(player, 1);
  walk(player, 30, 0);
  assert.ok(player.mesh.position.z > 1.5, `jumped onto it (${player.mesh.position.z.toFixed(2)})`);
  assert.ok(Math.abs(player.mesh.position.y - 0.9) < 1e-9, `standing on its top (${player.mesh.position.y}, grounded ${player.grounded}, stand ${player.standHeight})`);
  assert.equal(player.offGround, false, 'still within the Leaper\'s reach up there');
  let fell = false;
  for (let i = 0; i < 180 && player.mesh.position.z < 3.6; i += 1) {
    walk(player, 1);
    if (!player.grounded) fell = true;
  }
  assert.ok(fell, 'off the far edge she falls');
  walk(player, 30);
  assert.equal(player.mesh.position.y, 0, 'and lands on the floor');
  assert.equal(player.grounded, true);
});

test('a car-high block stays a wall even with a jump', async () => {
  const player = await lola(blockWorld(LOLA_FOOTING.jumpUp + 0.15));
  player.mesh.position.z = 0.6;
  walk(player, 5);
  player.jump();
  walk(player, 90);
  assert.ok(player.mesh.position.z <= 1.25 + 1e-6);
  assert.equal(player.mesh.position.y, 0);
});

test('in the yard: a tire mound and a barrel can be jumped onto, a car cannot', () => {
  const data = JSON.parse(fs.readFileSync(new URL('../assets/maps/junkyard/collision.json', import.meta.url), 'utf8'));
  const nav = new JunkyardNavigation(data, PLAYER_GRID.radius, PLAYER_GRID.height);
  // Map units; the glTF's (x, z) are the browser's.
  assert.equal(nav.surface(0, -2, LOLA_FOOTING.stepUp), 0, 'open floor');
  const mound = nav.surface(-19.8, -31.66, LOLA_FOOTING.jumpUp);
  assert.ok(mound > LOLA_FOOTING.stepUp && mound <= LOLA_FOOTING.jumpUp, `tire mound (${mound})`);
  assert.equal(nav.surface(-19.8, -31.66, LOLA_FOOTING.stepUp), null, 'too high to walk onto');
  const barrel = nav.surface(25.1, 23.9, LOLA_FOOTING.jumpUp);
  assert.ok(barrel > 0.7 && barrel <= LOLA_FOOTING.jumpUp, `barrel (${barrel})`);
  assert.equal(nav.surface(-17.32, 1.8, LOLA_FOOTING.jumpUp), null, 'the blue sedan is too tall');
});
