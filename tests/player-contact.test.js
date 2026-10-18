import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { leaperClearance, leaperReach, createLeaperBlocker } from '../src/world/playerContact.js';
import { JunkyardBrain } from '../src/simulation/JunkyardBrain.js';
import { WorldCollision, attachWorldCollision } from '../src/world/WorldCollision.js';

const facingZ = { x: 0, z: 0, yaw: 0 };

test('contact follows the Leaper body and legs, leaving the gaps between legs open', () => {
  // Straight ahead lies between the two front legs (at +-0.62 rad).
  assert.ok(leaperClearance(0, 3.5, facingZ, 1) > 0, 'Lola fits between the front legs');
  assert.ok(leaperClearance(0, 1.7, facingZ, 1) < 0, 'but not into the body');
  const foot = { x: Math.sin(0.62) * 3.24, z: Math.cos(0.62) * 3.24 };
  assert.ok(leaperClearance(foot.x, foot.z + 1.2, facingZ, 1) < 0, 'a foot blocks her');
  assert.ok(leaperClearance(0, 0, facingZ, 1) < 0, 'the body blocks her');
  // Turning the Leaper turns its legs: ahead of a leg, not between two.
  assert.ok(leaperClearance(0, 3.5, { ...facingZ, yaw: -0.62 }, 1) < 0);
  for (const scale of [1, 1.6, 2.77]) {
    const reach = leaperReach(scale);
    for (let a = 0; a < Math.PI * 2; a += 0.1) {
      assert.ok(leaperClearance(Math.sin(a) * (reach + 0.01), Math.cos(a) * (reach + 0.01), facingZ, scale) > 0, 'nothing beyond the reach');
    }
  }
});

test('Lola cannot walk into the Leaper while paused, running, or awaiting inference, and can always back out', () => {
  const p = new THREE.Vector3(0, 0, 4);
  const playtest = { world: { scale: 1, playerBlocked: x => x > 50 },
    target: { isPlayer: true, mesh: { position: p } },
    simulation: { state: { position: new THREE.Vector3(), yaw: 0 } } };
  const brain = new JunkyardBrain(playtest);
  // The Leaper's discs are an explicit moving blocker on the world's collision service.
  const collision = attachWorldCollision(playtest.world);
  collision.addDynamicBlocker(createLeaperBlocker(brain, playtest.target, playtest.world));
  assert.equal(playtest.world.playerBlocked(0, 2.2), false, 'walks up between the front legs');
  assert.equal(playtest.world.playerBlocked(0, 1.7), true, 'stops at the body');
  brain.running = true;
  assert.equal(playtest.world.playerBlocked(0, 2.2), false, 'a running Leaper between moves keeps no extra margin');
  brain.busy = true;
  assert.equal(playtest.world.playerBlocked(0, 2.2), false, 'sense-only requests do not reserve movement');
  brain.pendingMovement = true;
  assert.equal(playtest.world.playerBlocked(0, 2.2), true, 'a move in flight reserves one step');
  p.z = 2.2;
  assert.equal(playtest.world.playerBlocked(0, 2.4), false, 'can back out of the reservation');
  brain.pendingMovement = false;
  p.z = 4;
  brain.previousFrame = { x: 0, z: 0, yaw: 0 };
  brain.frame = { x: 10, z: 0, yaw: 0 };
  assert.equal(playtest.world.playerBlocked(10, 1.5), true, 'both ends of the Leaper\'s current move count');
  assert.equal(playtest.world.playerBlocked(51, 20), true, 'map collision preserved');
});

test('WorldCollision checks the map, then every moving blocker, and blockers can be removed', () => {
  const asked = [];
  const collision = new WorldCollision({ mapBlocked: (x) => x > 10 });
  assert.equal(collision.playerBlocked(11, 0), true, 'the map alone blocks');
  assert.equal(collision.playerBlocked(0, 0), false);
  const removeA = collision.addDynamicBlocker((x, z) => { asked.push('a'); return z > 5; });
  collision.addDynamicBlocker((x, z) => { asked.push('b'); return z < -5; });
  assert.equal(collision.playerBlocked(0, 6), true);
  assert.equal(collision.playerBlocked(0, -6), true, 'a second Leaper blocks on its own');
  assert.equal(collision.playerBlocked(11, 6), true);
  assert.deepEqual(asked, ['a', 'a', 'b'], 'blockers are skipped once the map already blocks');
  removeA();
  assert.equal(collision.playerBlocked(0, 6), false);
  const world = { playerBlocked: (x) => x > 10 };
  attachWorldCollision(world);
  world.collision.addDynamicBlocker((x) => x < -10);
  assert.equal(world.playerBlocked(11, 0) && world.playerBlocked(-11, 0) && !world.playerBlocked(0, 0), true,
    'world.playerBlocked keeps the map test and adds the moving blockers');
});
