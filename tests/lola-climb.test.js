import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { LolaPlayer } from '../src/robot/LolaPlayer.js';
import { Roof, findClimbableRoofs } from '../src/world/climbableRoofs.js';
import { LOLA_CLIMB } from '../src/actors/lola/lolaTuning.js';
import { colourJunkyardProps } from '../src/world/junkyardSurfaces.js';
import { loadGlb } from './world-helpers.js';

// Climbing onto the open yellow container (owner, 2026-10-21): press jump
// beside its roof while facing it, walk about up there, step off to drop down.

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

// A 6 x 2.4 roof 2.6 up, its long side along x; its walls block Lola 0.3 out.
const roof = () => new Roof({ center: { x: 0, z: 3 }, u: { x: 1, z: 0 }, v: { x: 0, z: 1 }, halfU: 3, halfV: 1.2, top: 2.6 });

async function lola(world) {
  const models = await Promise.all([load('assets/characters/lola/lola-m416.glb'), load('assets/characters/lola/lola-basic.glb')]);
  const jumps = await Promise.all([load('assets/characters/lola/lola-jump-m416.glb'), load('assets/characters/lola/lola-jump-basic.glb')]);
  return new LolaPlayer(new THREE.Scene(), world, { addEventListener() {}, classList: { add() {} } }, models, jumps);
}

const FORWARD = new THREE.Vector3(0, 0, 1), RIGHT = new THREE.Vector3(-1, 0, 0);

test('a roof knows what is over it, its nearest point and which edge faces where', () => {
  const r = roof();
  assert.equal(r.contains(2.9, 3.5), true);
  assert.equal(r.contains(0, 1.5), false);
  assert.equal(r.contains(0, 1.75, 0.1), true, 'a margin grows it');
  assert.deepEqual(r.nearest(0, 0), { x: 0, z: 1.8 });
  assert.deepEqual(r.nearest(0, 0, 0.5), { x: 0, z: 2.3 }, 'inset from the edge');
  assert.deepEqual(r.outward(0, 4.5), { x: 0, z: 1 });
  const left = r.outward(-3.5, 3);
  assert.ok(left.x === -1 && left.z === 0);
});

test('the open yellow container in the yard has a roof about 6 x 2.4 map units, 2.6 up', async () => {
  const map = (await loadGlb('assets/build/maps/junkyard.glb')).scene;
  const roofs = findClimbableRoofs(map);
  assert.equal(roofs.length, 1);
  const [r] = roofs;
  assert.ok(Math.abs(Math.max(r.halfU, r.halfV) - 3.05) < 0.05 && Math.abs(Math.min(r.halfU, r.halfV) - 1.29) < 0.05,
    `its outline (${r.halfU.toFixed(2)} x ${r.halfV.toFixed(2)})`);
  assert.ok(r.top > 2.55 && r.top < 2.7, `its top (${r.top.toFixed(2)})`);
  assert.ok(Math.hypot(r.center.x - 0, r.center.z - 14) < 0.2, 'where the container lies');
});

test('jumping beside the roof while facing it climbs up; walking off its edge drops her down', async () => {
  const r = roof();
  const world = { scale: 1, initialTarget: { x: 0, z: 1.3 }, playerBlocked: (x, z) => r.contains(x, z, 0.3), roofs: [r] };
  const player = await lola(world);
  assert.equal(player.jump(), true);
  assert.ok(player.climb, 'beside the edge and facing it: a climb');
  for (let i = 0; i < 90; i += 1) player.move(0, 0, FORWARD, RIGHT, 4.5, 1 / 60);
  assert.equal(player.roof, r, 'up on the roof');
  assert.equal(player.climb, null);
  assert.ok(Math.abs(player.mesh.position.y - 2.6) < 1e-9, 'standing on its top');
  assert.ok(r.contains(player.mesh.position.x, player.mesh.position.z, -LOLA_CLIMB.inset + 1e-6), 'in from the edge');
  assert.equal(player.offGround, true);
  // Walk along it: nothing up there blocks her, and she stays on top.
  for (let i = 0; i < 30; i += 1) player.move(0, 1, FORWARD, RIGHT, 4.5, 1 / 60);
  assert.ok(player.mesh.position.x < -0.2, 'walks along the roof');
  assert.equal(player.mesh.position.y, 2.6);
  // A jump up there lands back on the roof.
  assert.equal(player.jump(), true);
  assert.equal(player.climb, null, 'no climb from the roof');
  for (let i = 0; i < 90; i += 1) player.move(0, 0, FORWARD, RIGHT, 4.5, 1 / 60);
  assert.equal(player.roof, r);
  assert.equal(player.mesh.position.y, 2.6);
  // Off the far side: down to the floor, clear of the container's walls.
  for (let i = 0; i < 240 && (player.roof || !player.grounded); i += 1) player.move(1, 0, FORWARD, RIGHT, 4.5, 1 / 60);
  assert.equal(player.roof, null);
  assert.equal(player.mesh.position.y, 0, 'on the floor again');
  assert.equal(player.grounded, true);
  assert.equal(world.playerBlocked(player.mesh.position.x, player.mesh.position.z), false, 'outside the container');
  assert.ok(player.mesh.position.z > 4.2, 'on the far side');
});

test('no climb facing away, out of reach, or from underneath; a restart takes her off the roof', async () => {
  const r = roof();
  const world = { scale: 1, initialTarget: { x: 0, z: 1.3 }, playerBlocked: () => false, roofs: [r] };
  const player = await lola(world);
  player.mesh.rotation.y = Math.PI;
  assert.equal(player.findClimb(), null, 'facing away');
  player.mesh.rotation.y = 0;
  player.mesh.position.z = 1.8 - LOLA_CLIMB.reach - 0.1;
  assert.equal(player.findClimb(), null, 'too far');
  player.mesh.position.z = 3;
  assert.equal(player.findClimb(), null, 'underneath it');
  player.mesh.position.z = 1.3;
  assert.ok(player.findClimb());
  player.jump();
  for (let i = 0; i < 90; i += 1) player.move(0, 0, FORWARD, RIGHT, 4.5, 1 / 60);
  assert.equal(player.roof, r);
  player.resetJump();
  assert.equal(player.roof, null);
  assert.equal(player.mesh.position.y, 0);
});

test('the open yellow container is recoloured: a duller yellow, its grey inside wall plain yellow', async () => {
  const map = (await loadGlb('assets/build/maps/junkyard.glb')).scene;
  const before = new Map();
  map.traverse((mesh) => { if (mesh.isMesh) before.set(mesh, mesh.material); });
  const changed = colourJunkyardProps(map);
  const parts = [...before.keys()].filter((mesh) => mesh.material !== before.get(mesh));
  assert.equal(changed, parts.length);
  assert.ok(parts.length > 50, `the container's parts and its torn-off side (${parts.length})`);
  assert.ok(parts.every((mesh) => /^(03_-_southern_fallen_freight|Yellow_container)/.test(mesh.name)), 'nothing else');
  const wall = parts.find((mesh) => mesh.name === '03_-_southern_fallen_freight_|_floor');
  assert.equal(wall.material.map, null, 'the inside wall is plain');
  assert.equal(new Set(parts.map((mesh) => mesh.material)).size, 2, 'two shared looks: the tint and the wall');
});
