import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Blocker, PLAYER_BLOCKED_PROPS, convexHull, findPlayerBlockers, withPlayerBlockers } from '../src/world/playerBlockers.js';

// Lola may not walk into the open container in the middle of the yard (owner,
// 2026-10-22): its footprint is solid for her, and only for her.

const square = new Blocker('box', convexHull([[0, 0], [4, 0], [4, 2], [0, 2], [2, 1]]));

test('the outline is the convex hull of the prop, inner points dropped', () => {
  assert.equal(square.corners.length, 4);
});

test('a disc inside or touching the outline is pushed out; one clear of it is not', () => {
  const inside = square.contact(0.5, 1, 0.25);
  assert.ok(inside && inside.depth > 0.25, 'inside: deeper than the radius');
  assert.deepEqual([Math.round(inside.nx) + 0, Math.round(inside.nz) + 0], [-1, 0], 'out through the nearest side');
  const touching = square.contact(-0.1, 1, 0.25);
  assert.ok(touching && Math.abs(touching.depth - 0.15) < 1e-9);
  assert.equal(square.contact(-0.5, 1, 0.25), null);
});

test('Lola\'s checks gain the blocker; the grid underneath is untouched', () => {
  const open = { radius: 0.25, blocked: () => false, contact: () => null, surface: () => 0 };
  const player = withPlayerBlockers(open, [square]);
  assert.equal(player.blocked(2, 1), true);
  assert.equal(player.surface(2, 1, 1.25), null, 'nothing to stand on inside it');
  assert.equal(player.blocked(6, 1), false);
  assert.equal(player.surface(6, 1, 1.25), 0);
  assert.ok(player.contact(2, 1).depth > 0);
  assert.equal(withPlayerBlockers(open, []), open, 'no blockers: the grid itself');
});

test('blockers are found in the map by the prop\'s Blender names, in map units', () => {
  const map = new THREE.Group();
  const part = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 4));
  part.name = `${PLAYER_BLOCKED_PROPS[0].replace(/ /g, '_')}_|_floor`;
  part.position.set(10, 0, 0);
  map.add(part);
  map.scale.setScalar(0.5);
  const [blocker] = findPlayerBlockers(map, 0.5);
  assert.equal(blocker.name, PLAYER_BLOCKED_PROPS[0]);
  assert.ok(blocker.contact(10, 0, 0.1), 'its middle, in map units');
  assert.equal(blocker.contact(12, 0, 0.1), null);
  assert.deepEqual(findPlayerBlockers(new THREE.Group(), 1), [], 'a yard without it has no blocker');
});
