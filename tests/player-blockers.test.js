import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Blocker, PLAYER_BLOCKED_PROPS, PLAYER_SOLID_PROPS, convexHull, findPlayerBlockers, findSolidProps, withPlayerBlockers } from '../src/world/playerBlockers.js';
import { JunkyardNavigation } from '../src/world/JunkyardNavigation.js';
import { PLAYER_GRID } from '../src/world/junkyardCollision.js';
import { loadGlb } from './world-helpers.js';
import fs from 'node:fs';

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

test('in the real yard: no container can be stood on, and her body stays out of the cars', async () => {
  const data = JSON.parse(fs.readFileSync(new URL('../assets/maps/junkyard/collision.json', import.meta.url)));
  const map = (await loadGlb('assets/build/maps/junkyard.glb')).scene;
  map.updateMatrixWorld(true);
  const solid = findSolidProps(map, 1);
  assert.equal(solid.length, PLAYER_SOLID_PROPS.length, 'cars and containers were found');
  const grid = new JunkyardNavigation(data, PLAYER_GRID.radius, PLAYER_GRID.height);
  const nav = withPlayerBlockers(grid, [...findPlayerBlockers(map, 1), ...solid]);
  // Every spot of every part of every container taller than a step: never standable.
  for (const prop of PLAYER_SOLID_PROPS[1].names) {
    let parts = 0;
    map.traverse((object) => {
      if (!object.isMesh || !object.name.replace(/_/g, ' ').replace(/\./g, '').startsWith(prop)) return;
      parts += 1;
      const box = new THREE.Box3().setFromObject(object);
      if (box.max.y <= 0.35) return;
      const middle = box.getCenter(new THREE.Vector3());
      const top = nav.surface(middle.x, middle.z, 1.25);
      assert.ok(top === null || top <= 0.35 || box.max.x - box.min.x > 1, `${object.name}: stands at ${top}`);
    });
    assert.ok(parts > 10, `${prop} is in the yard`);
  }
  // The middle of a car is solid at any jump, and the open floor beside it is free.
  assert.equal(nav.surface(-17.3, 1.8, 1.25), null, 'the blue sedan');
  assert.equal(nav.surface(-22, 1.8, 1.25), 0, 'beside it');
});

test('the Leaper\'s walking route goes around what is in the way, as near the goal as it fits', () => {
  // A wall across the middle with a way round at one end.
  const wall = [-1, 8, 1, 8, 1, 0, 0, 3], wall2 = [-1, 8, 1, 0, -1, 0, 0, 3];
  const nav = new JunkyardNavigation({ bounds: { minX: -20, maxX: 20, minZ: -20, maxZ: 20 }, triangles: [wall, wall2] }, 1, 4);
  const route = nav.walkRoute({ x: -10, z: 2 }, { x: 10, z: 2 });
  assert.ok(route.length > 2);
  assert.ok(route.every((p) => !nav.blocked(p.x, p.z)), 'every point fits');
  assert.ok(route.some((p) => p.z < 0 || p.z > 8), 'it goes round the wall');
  const end = route[route.length - 1];
  assert.ok(Math.hypot(end.x - 10, end.z - 2) < 1);
  const stuck = nav.walkRoute({ x: -10, z: 2 }, { x: 0, z: 4 });
  assert.ok(stuck.length > 0 && !nav.blocked(stuck[stuck.length - 1].x, stuck[stuck.length - 1].z), 'a goal inside the wall: as near as it fits');
});
