import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { LolaPlayer } from '../src/robot/LolaPlayer.js';
import { JunkyardNavigation, triangleContact } from '../src/world/JunkyardNavigation.js';
import { CharacterMover } from '../src/actors/lola/CharacterMover.js';

// Lola's collide-and-slide (review fix 5.15): she slides along angled walls
// and round obstacles instead of sticking, and pushing straight into a wall
// eases her into Idle instead of freezing mid-stride.

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
const button = () => ({ addEventListener() {}, classList: { add() {} } });
// Height of her lowest boot bone above the world floor (units).
function lowestBoot(player) {
  player.mesh.updateMatrixWorld(true);
  return Math.min(...['DEF-toe.L', 'DEF-toe.R', 'DEF-foot.L', 'DEF-foot.R']
    .map(name => player.equipped.model.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(name)).getWorldPosition(new THREE.Vector3()).y));
}
const radians = degrees => degrees * Math.PI / 180;
// Steady W run speed in open ground (units per second).
const RUN_SPEED = 2.6128;

// A straight wall at `wallDegrees` to the x axis, 1.5 units from Lola's start.
// 'predicate' = a plain yes/no blocked test (like the Leaper wrapper), so the
// mover probes for the normal; 'navigation' = real map triangles with exact
// contact normals from JunkyardNavigation.
function wallWorld(wallDegrees, kind) {
  const t = { x: Math.cos(radians(wallDegrees)), z: Math.sin(radians(wallDegrees)) };
  const n = { x: -t.z, z: t.x };
  if (kind === 'predicate') {
    return { t, n, world: { scale: 1, initialTarget: { x: 0, z: 0 }, playerBlocked: (x, z) => x * n.x + z * n.z < -1.5 } };
  }
  const offset = -1.75;
  const corner = (a, s) => [t.x * a + n.x * s, t.z * a + n.z * s];
  const [a, b, c, d] = [corner(-20, offset), corner(20, offset), corner(20, offset - 2), corner(-20, offset - 2)];
  const navigation = new JunkyardNavigation({ bounds: { minX: -30, maxX: 30, minZ: -30, maxZ: 30 },
    triangles: [[...a, ...b, ...c, 0, 1], [...a, ...c, ...d, 0, 1]] }, 0.25, 1.71, 2);
  return { t, n, world: { scale: 1, initialTarget: { x: 0, z: 0 },
    playerBlocked: (x, z) => navigation.blocked(x, z), playerContact: (x, z) => navigation.contact(x, z) } };
}

test('the map reports the outward wall normal and overlap depth at a contact', () => {
  const triangle = [0, 0, 4, 0, 0, 4];
  // Beside the long edge (x + z = 4): normal points away from the triangle.
  const outside = triangleContact(2.1, 2.1, triangle, 0.25);
  assert.ok(Math.abs(outside.nx - Math.SQRT1_2) < 1e-9 && Math.abs(outside.nz - Math.SQRT1_2) < 1e-9);
  assert.ok(Math.abs(outside.depth - (0.25 - 0.2 * Math.SQRT1_2)) < 1e-9);
  assert.equal(triangleContact(3, 3, triangle, 0.25), null, 'a clear disc has no contact');
  // Centre inside the solid: pushed out through the nearest edge (z = 0).
  const inside = triangleContact(1.5, 0.1, triangle, 0.25);
  assert.deepEqual([inside.nx, inside.nz].map(v => Math.round(v * 1e9) / 1e9), [0, -1]);
  assert.ok(Math.abs(inside.depth - 0.35) < 1e-9);
  // The map's outer edge is a wall too, and contact agrees with blocked().
  const navigation = new JunkyardNavigation({ bounds: { minX: -5, maxX: 5, minZ: -5, maxZ: 5 }, triangles: [[0, 0, 4, 0, 0, 4, 0, 1]] }, 0.25, 1.71, 1);
  const edge = navigation.contact(4.9, -3);
  assert.deepEqual([edge.nx, edge.nz], [-1, 0]);
  for (let x = -4.5; x < 4.5; x += 0.37) for (let z = -4.5; z < 4.5; z += 0.41) {
    assert.equal(!!navigation.contact(x, z), navigation.blocked(x, z), `contact and blocked agree at ${x}, ${z}`);
  }
});

test('Lola slides along walls at 15, 30 and 45 degrees instead of sticking', async () => {
  const models = await Promise.all([load('m416'), load('basic')]);
  for (const kind of ['predicate', 'navigation']) {
    for (const wallDegrees of [15, 30, 45]) {
      for (const hit of [30, 45]) {
        const { t, n, world } = wallWorld(wallDegrees, kind);
        const player = new LolaPlayer(new THREE.Scene(), world, button(), models);
        // Run `hit` degrees off the wall's surface, into it.
        const forward = new THREE.Vector3(Math.cos(radians(hit)) * t.x - Math.sin(radians(hit)) * n.x, 0,
          Math.cos(radians(hit)) * t.z - Math.sin(radians(hit)) * n.z);
        const right = new THREE.Vector3(forward.z, 0, -forward.x);
        player.mesh.rotation.y = Math.atan2(forward.x, forward.z);
        for (let i = 0; i < 120; i += 1) player.move(1, 0, forward, right, 4.5, 1 / 60);
        const start = player.mesh.position.clone();
        for (let i = 0; i < 60; i += 1) player.move(1, 0, forward, right, 4.5, 1 / 60);
        const slide = (player.mesh.position.x - start.x) * t.x + (player.mesh.position.z - start.z) * t.z;
        const ideal = RUN_SPEED * Math.cos(radians(hit));
        assert.ok(slide >= 0.8 * ideal, `${kind} wall ${wallDegrees}°, ${hit}° approach: slid ${slide.toFixed(3)} of ${ideal.toFixed(3)}`);
        const depth = player.mesh.position.x * n.x + player.mesh.position.z * n.z;
        assert.ok(depth >= -1.5 - 1e-9, `${kind}: never enters the wall (${depth})`);
      }
    }
  }
});

test('pushing straight into a wall eases Lola into Idle and keeps her boots planted', async () => {
  const { world } = wallWorld(0, 'predicate');
  const player = new LolaPlayer(new THREE.Scene(), world, button(), await Promise.all([load('m416'), load('basic')]));
  const forward = new THREE.Vector3(0, 0, -1), right = new THREE.Vector3(-1, 0, 0);
  player.mesh.rotation.y = Math.PI;
  for (let i = 0; i < 180 && player.mesh.position.z > -1.499; i += 1) player.move(1, 0, forward, right, 4.5, 1 / 60);
  const runTime = player.equipped.actions.Run.time;
  for (let i = 0; i < 18; i += 1) player.move(1, 0, forward, right, 4.5, 1 / 60);
  assert.ok(player.equipped.baseWeights.Idle > 0.5, `Idle shows after 0.3 s (${player.equipped.baseWeights.Idle.toFixed(2)})`);
  assert.ok(Math.abs(player.equipped.actions.Run.time - runTime) < 1e-3, 'the run does not keep striding on the spot');
  // Standing at the wall her boots rest on the floor like a normal Idle (her
  // height used to follow the run's stride and left her hovering ~9 cm up).
  for (const crouching of [false, true]) {
    player.crouching = crouching;
    for (let i = 0; i < 60; i += 1) player.move(1, 0, forward, right, 4.5, 1 / 60);
    const pushing = lowestBoot(player);
    const idle = new LolaPlayer(new THREE.Scene(), world, button(), await Promise.all([load('m416'), load('basic')]));
    idle.crouching = crouching;
    for (let i = 0; i < 60; i += 1) idle.move(0, 0, forward, right, 4.5, 1 / 60);
    assert.ok(Math.abs(pushing - lowestBoot(idle)) < 0.02,
      `${crouching ? 'crouched' : 'standing'}: lowest boot ${(pushing * 100).toFixed(1)} cm vs ${(lowestBoot(idle) * 100).toFixed(1)} cm standing still`);
  }
  player.crouching = false;
  // Turning away along the wall picks the run straight back up.
  const along = new THREE.Vector3(-1, 0, 0);
  for (let i = 0; i < 30; i += 1) player.move(1, 0, along, new THREE.Vector3(0, 0, 1), 4.5, 1 / 60);
  assert.ok(player.equipped.baseWeights.Idle < 0.1, 'running freely again shows the run');
});

test('Lola slides around a round obstacle that only lets her back away (like the Leaper\'s legs)', async () => {
  const players = [];
  // A disc of radius 1.2 at (0, 3), blocking like JunkyardBrain's Leaper wrapper:
  // overlapping it is refused unless the move increases the clearance.
  const clearance = (x, z) => Math.hypot(x, z - 3) - 1.2;
  const world = { scale: 1, initialTarget: { x: 0.3, z: 0 }, playerBlocked: (x, z) => {
    const next = clearance(x, z);
    if (next >= 0) return false;
    const p = players[0].mesh.position;
    return next <= clearance(p.x, p.z);
  } };
  const player = new LolaPlayer(new THREE.Scene(), world, button(), await Promise.all([load('m416'), load('basic')]));
  players.push(player);
  const forward = new THREE.Vector3(0, 0, 1), right = new THREE.Vector3(-1, 0, 0);
  for (let i = 0; i < 240; i += 1) {
    player.move(1, 0, forward, right, 4.5, 1 / 60);
    assert.ok(clearance(player.mesh.position.x, player.mesh.position.z) > -1e-6, 'never overlaps the obstacle');
  }
  assert.ok(player.mesh.position.z > 4.5, `slid around the obstacle and kept going (z = ${player.mesh.position.z.toFixed(2)})`);
});

test('a free step is taken exactly, and the mover reports when a wall changed it', () => {
  const mover = new CharacterMover();
  const position = { x: 0, z: 0 };
  const free = { scale: 1, playerBlocked: () => false };
  const step = mover.move(free, position, { x: 0.6, z: 0.8 }, 0.5);
  assert.equal(step.blocked, false);
  assert.ok(Math.abs(step.moved - 0.5) < 1e-12);
  assert.ok(Math.abs(position.x - 0.3) < 1e-12 && Math.abs(position.z - 0.4) < 1e-12);
  const walled = { scale: 1, playerBlocked: (x) => x > 0.35 };
  const result = mover.move(walled, position, { x: 0.6, z: 0.8 }, 0.5);
  assert.equal(result.blocked, true);
  assert.ok(position.x <= 0.35 && position.z > 0.75, 'slides along the wall');
});
