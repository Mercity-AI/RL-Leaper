import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { loadGlb } from './world-helpers.js';
import { buildJunkyardCollision } from '../src/world/junkyardCollision.js';
import { JunkyardNavigation } from '../src/world/JunkyardNavigation.js';
import { JunkyardRaster } from '../src/brain/junkyard/collisionRaster.js';
import { STEP_OVER_PROPS, steppedOver } from '../src/world/stepOverProps.js';
import { LeaperSimulation } from '../src/simulation/LeaperSimulation.js';
import { FOOT_HEIGHT } from '../src/config/robot.js';

// Low junk the Leaper walks over (owner, 2026-11-02): gone from its walking map
// only. It stays solid for Lola and for every line of sight.
const data = JSON.parse(fs.readFileSync(new URL('../assets/maps/junkyard/collision.json', import.meta.url)));
const WIDTH = 5.5;

test('the junk leaves the Leaper\'s walking map, and only that', () => {
  const removed = data.triangles.filter((t) => steppedOver(t));
  assert.ok(removed.length > 1000, 'the boxes match the exported yard');
  assert.ok(removed.every((t) => t[7] < 0.6), 'nothing tall was taken');
  const { navigation, playerNavigation } = buildJunkyardCollision(data, WIDTH);
  const whole = new JunkyardNavigation(data, navigation.radius, navigation.height);
  whole.markSpawnable();
  const count = (nav) => nav.spawnable.reduce((sum, cell) => sum + cell, 0);
  assert.ok(count(navigation) > count(whole) * 1.03, 'more floor for the Leaper');
  const lola = new JunkyardNavigation(data, playerNavigation.radius, playerNavigation.height);
  assert.deepEqual(playerNavigation.free, lola.free, 'Lola\'s grid is the whole yard');
});

test('the brain\'s map matches the route finder\'s: both lose the junk', () => {
  const walking = JunkyardRaster.build({ bounds: data.bounds, triangles: data.triangles.filter((t) => !steppedOver(t)) }, WIDTH);
  const whole = JunkyardRaster.build(data, WIDTH);
  const open = (raster) => raster.solid.reduce((sum, cell) => sum + (cell ? 0 : 1), 0);
  assert.ok(open(walking) > open(whole));
  assert.equal(walking.nx, whole.nx, 'same grid, so the brain\'s rays read it the same way');
});

test('the junk still blocks sight: the map\'s meshes are untouched', async () => {
  const map = (await loadGlb('assets/build/maps/junkyard.glb')).scene;
  map.updateMatrixWorld(true);
  const meshes = [];
  map.traverse((object) => { if (object.isMesh && !object.name.startsWith('Cube')) meshes.push(object); });
  const ray = new THREE.Raycaster();
  let blocked = 0;
  for (const box of STEP_OVER_PROPS) {
    // A grid of lines straight down: a tire is a ring, so one line can miss it.
    let hit = false;
    for (let i = 1; i < 8 && !hit; i += 1) {
      for (let k = 1; k < 8 && !hit; k += 1) {
        ray.set(new THREE.Vector3(box[0] + (box[1] - box[0]) * i / 8, box[4] + 2, box[2] + (box[3] - box[2]) * k / 8), new THREE.Vector3(0, -1, 0));
        hit = ray.intersectObjects(meshes, false).length > 0;
      }
    }
    if (hit) blocked += 1;
  }
  assert.equal(blocked, STEP_OVER_PROPS.length, 'every prop is still there to be hit');
});

test('a foot steps up onto junk and clears it on the way', () => {
  const rise = 0.4;
  const sim = Object.create(LeaperSimulation.prototype);
  sim.world = { floorHeight: 0, leaperFootHeight: (x) => (x > 0.3 && x < 1.5 ? rise : 0) };
  sim.state = { velocity: new THREE.Vector3() };
  sim.v = Array.from({ length: 12 }, () => new THREE.Vector3());
  const leg = { stepFrom: new THREE.Vector3(), stepTo: new THREE.Vector3(), footPosition: new THREE.Vector3(0, FOOT_HEIGHT, 0) };
  sim.startStep(leg, new THREE.Vector3(1, 0, 0), 0, 0.2);
  assert.ok(Math.abs(leg.stepTo.y - (FOOT_HEIGHT + rise)) < 1e-9, 'it lands on top');
  sim.startStep(leg, new THREE.Vector3(2, 0, 0), 0, 0.2);
  assert.ok(leg.lift >= rise, 'high enough to pass over');
  assert.equal(leg.stepTo.y, FOOT_HEIGHT, 'and back on the floor beyond it');
});
