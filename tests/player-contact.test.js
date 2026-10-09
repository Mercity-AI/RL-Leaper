import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { contactRadius, touchesLeaper } from '../src/world/playerContact.js';
import { JunkyardBrain } from '../src/simulation/JunkyardBrain.js';

test('contact includes legs, outfits, and the entire interpolated path', () => {
  for (const scale of [1, 3.325, 6.65]) {
    const radius = contactRadius(scale);
    assert.equal(touchesLeaper(radius - 0.01, 0, { x: 0, z: 0 }, { x: 0, z: 0 }, radius), true);
    assert.equal(touchesLeaper(radius + 0.01, 0, { x: 0, z: 0 }, { x: 0, z: 0 }, radius), false);
    assert.equal(touchesLeaper(0, 0, { x: -20, z: 0 }, { x: 20, z: 0 }, radius), true);
  }
});

test('Lola cannot enter the Leaper envelope while paused, running, or awaiting inference', () => {
  const p = new THREE.Vector3(0, 0, 6.3);
  const playtest = { world: { scale: 1, playerBlocked: x => x > 50 },
    target: { isPlayer: true, mesh: { position: p } },
    simulation: { state: { position: new THREE.Vector3() } } };
  const brain = new JunkyardBrain(playtest);
  assert.equal(playtest.world.playerBlocked(0, 5.79), true);
  assert.equal(playtest.world.playerBlocked(0, 5.9), false);
  brain.busy = true;
  assert.equal(playtest.world.playerBlocked(0, 5.9), true);
  p.z = 6.0;
  assert.equal(playtest.world.playerBlocked(0, 6.1), false, 'can retreat from reservation');
  brain.frame = { x: 2, z: 0 };
  brain.previousFrame = { x: 0, z: 0 };
  assert.equal(playtest.world.playerBlocked(1, 5.4), true);
  assert.equal(playtest.world.playerBlocked(51, 20), true, 'map collision preserved');
});
