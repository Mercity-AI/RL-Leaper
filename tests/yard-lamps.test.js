import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { YardLamps } from '../src/world/yardLamps.js';
import { JUNKYARD_ATMOSPHERE } from '../src/world/junkyardAtmosphere.js';

const pole = (x, z) => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.5, 6, 0.3));
  mesh.name = 'Perimeter_utility_mast';
  mesh.position.set(x, 3, z);
  return mesh;
};

test('every pole has a bulb, but only the nearest lamps shine, fading across', () => {
  const map = new THREE.Group();
  map.add(pole(-30, 0), pole(30, 0), pole(0, 30));
  const lamps = new YardLamps(map, new THREE.Scene(), { scale: 1, lamps: JUNKYARD_ATMOSPHERE.lamps });
  assert.equal(lamps.spots.length, 3);
  assert.equal(lamps.lights.length, JUNKYARD_ATMOSPHERE.lamps.slots);
  const lit = () => lamps.lights.map((light) => Math.sign(Math.round(light.position.x))).sort((a, b) => a - b);
  assert.deepEqual(lit(), [-1, 1]);
  // Lola walks to the third lamp: the far light leaves for it, none pops on at once.
  for (let t = 0; t < 3; t += 0.1) {
    lamps.update(new THREE.Vector3(25, 0, 28), 0.1);
    for (const light of lamps.lights) assert.ok(light.intensity >= 0 && light.intensity <= JUNKYARD_ATMOSPHERE.lamps.intensity);
  }
  assert.deepEqual(lit(), [0, 1]);
  assert.ok(lamps.lights.every((light) => light.intensity === JUNKYARD_ATMOSPHERE.lamps.intensity));
});
