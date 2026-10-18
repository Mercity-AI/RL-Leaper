import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { LolaPlayer } from '../src/robot/LolaPlayer.js';

// Shooting on the move (review fix 5.8) and hits during shooting (5.37):
// hands stay on the gun while running, automatic fire never makes the legs
// flicker, starting or stopping mid-shot never snaps the legs, and a hit's
// flinch and a raised gun play together instead of cancelling each other.

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
const named = (root, name) => root.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(name));
let models;
async function makePlayer(weapon, jumps = []) {
  models ??= await Promise.all([load('m416'), load('basic')]);
  const player = new LolaPlayer(new THREE.Scene(), { scale: 1, initialTarget: { x: 0, z: 0 }, playerBlocked: () => false },
    { addEventListener() {}, classList: { add() {} } }, models, jumps);
  if (weapon) player.switchWeapon();
  return player;
}
// Both feet in Lola's own space, so running forward itself is not counted.
function feet(player) {
  player.mesh.updateMatrixWorld(true);
  return ['DEF-toe.L', 'DEF-toe.R', 'DEF-foot.L', 'DEF-foot.R']
    .map(name => player.mesh.worldToLocal(named(player.equipped.model, name).getWorldPosition(new THREE.Vector3())));
}
// The biggest one-frame foot jump over `frames` frames of `step()`.
function worstFootJump(player, frames, step) {
  let last = feet(player), worst = 0;
  for (let i = 0; i < frames; i += 1) {
    step(i);
    const now = feet(player);
    worst = Math.max(worst, ...now.map((point, k) => point.distanceTo(last[k])));
    last = now;
  }
  return worst;
}

test('running while aiming keeps both hands within 10 cm of the gun', async () => {
  for (const weapon of [0, 1]) for (const forward of [0, 1]) {
    const player = await makePlayer(weapon);
    const outfit = player.equipped;
    for (let i = 0; i < 60; i += 1) player.move(forward, 0, FORWARD, RIGHT, 4.5, 1 / 60);
    player.aimHeld = true;
    let worst = [0, 0];
    for (let i = 0; i < 60; i += 1) {
      // The weapon raises the aim every frame, as PlayerWeapon.update does.
      player.holdAim();
      player.move(forward, 0, FORWARD, RIGHT, 4.5, 1 / 60);
      player.mesh.updateMatrixWorld(true);
      const positions = outfit.shotGun.geometry.attributes.position, vertex = new THREE.Vector3();
      ['DEF-hand.R', 'DEF-hand.L'].forEach((name, k) => {
        const hand = named(outfit.model, name).getWorldPosition(new THREE.Vector3());
        let nearest = Infinity;
        for (let v = 0; v < positions.count; v += 1) nearest = Math.min(nearest, vertex.fromBufferAttribute(positions, v).applyMatrix4(outfit.shotGun.matrixWorld).distanceTo(hand));
        worst[k] = Math.max(worst[k], nearest);
      });
    }
    const label = `${weapon ? 'pistol' : 'M416'} ${forward ? 'running' : 'standing'}`;
    assert.ok(player.shot && outfit.shotGun.visible, `${label}: the gun is raised`);
    assert.ok(worst[0] < 0.1 && worst[1] < 0.1, `${label}: hands ${worst.map(cm => (cm * 100).toFixed(1)).join(' / ')} cm from the gun`);
  }
});

test('automatic fire while running causes no one-frame foot jump over 10 cm', async () => {
  for (const weapon of [0, 1]) {
    const player = await makePlayer(weapon);
    for (let i = 0; i < 60; i += 1) player.move(1, 0, FORWARD, RIGHT, 4.5, 1 / 60);
    // Two seconds of fire like the game: move() first, then a shot every 1/7 s.
    let clock = 0, shots = 0;
    const worst = worstFootJump(player, 120, () => {
      player.move(1, 0, FORWARD, RIGHT, 4.5, 1 / 60);
      clock -= 1 / 60;
      if (clock <= 0) { if (player.startShot(0.24, 1.2)) shots += 1; clock += 1 / 7; }
    });
    assert.ok(shots >= 14, `fired ${shots} shots`);
    assert.ok(worst < 0.1, `${weapon ? 'pistol' : 'M416'}: feet jumped ${(worst * 100).toFixed(1)} cm in one frame`);
  }
});

test('starting or stopping during a held shot eases the legs instead of snapping them', async () => {
  for (const weapon of [0, 1]) for (const [before, after] of [[0, 1], [1, 0]]) {
    const player = await makePlayer(weapon);
    for (let i = 0; i < 60; i += 1) player.move(before, 0, FORWARD, RIGHT, 4.5, 1 / 60);
    assert.equal(player.startShot(0.24, 1.2), true);
    const worst = worstFootJump(player, 40, () => player.move(after, 0, FORWARD, RIGHT, 4.5, 1 / 60));
    assert.ok(player.shot, 'the shot is still up');
    assert.ok(worst < 0.1, `${weapon ? 'pistol' : 'M416'} ${after ? 'starting' : 'stopping'}: feet jumped ${(worst * 100).toFixed(1)} cm`);
    // Standing still the legs settle into the authored shooting stance.
    if (!after) assert.ok(player.shotLegs > 0.95 && !player.shot.upperOnly);
  }
});

test('a hit during fire keeps the flinch and the raised gun together', async () => {
  for (const weapon of [0, 1]) {
    const player = await makePlayer(weapon);
    const outfit = player.equipped;
    player.move(0, 0, FORWARD, RIGHT, 4.5, 0.1);
    // Hit while aiming: the gun stays up and the flinch plays on top.
    player.aimHeld = true;
    player.holdAim();
    const aimed = player.shot;
    player.reactToHit(new THREE.Vector3(1, 0, 0));
    assert.equal(player.shot, aimed, 'the hit does not lower the raised gun');
    player.move(0, 0, FORWARD, RIGHT, 4.5, 0.08);
    assert.ok(player.hitRecoilTime > 0 && outfit.hitBase, 'the flinch plays');
    assert.ok(player.shot && outfit.shotGun.visible, 'aim stays raised during the flinch');
    // Firing during the flinch neither clears it nor is refused.
    player.cancelShot();
    assert.equal(player.startShot(0.24, 1.2), true);
    assert.ok(player.hitRecoilTime > 0, 'firing does not cancel the flinch');
    player.move(0, 0, FORWARD, RIGHT, 4.5, 1 / 60);
    assert.ok(outfit.hitBase && player.shot, 'flinch and shot play together');
    // Re-raising the aim mid-flinch works (it used to wait 0.6 s).
    player.cancelShot();
    player.holdAim();
    assert.ok(player.shot?.action.paused, 'aim raised again mid-flinch');
    player.aimHeld = false;
  }
});

test('canJump says when a jump can start, so a buffered press waits for it', async () => {
  const jumps = await Promise.all([load('jump-m416'), load('jump-basic')]);
  const player = await makePlayer(0, jumps);
  assert.equal(player.canJump, true);
  assert.equal(player.jump(), true);
  assert.equal(player.canJump, false, 'not during the authored jump');
  let frames = 0;
  while (!player.canJump && frames < 200) { player.move(0, 0, FORWARD, RIGHT, 4.5, 1 / 60); frames += 1; }
  assert.ok(frames > 60 && frames < 100, `ready again right after the 1.4 s jump (${frames} frames)`);
  assert.equal(player.jump(), true, 'and the jump really starts');
  player.resetJump();
  player.defeated = true;
  assert.equal(player.canJump, false, 'never once defeated');
});
