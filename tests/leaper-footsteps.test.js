import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { LeaperSimulation } from '../src/simulation/LeaperSimulation.js';

function fixture() {
  const simulation = Object.create(LeaperSimulation.prototype);
  const legs = Array.from({ length: 3 }, () => ({
    gait: 0, homeLocal: new THREE.Vector3(), stepping: true, stepProgress: 0.9,
    stepDuration: 0.2, replantDelay: -1, cooldown: 0, lift: 0.2,
    footPosition: new THREE.Vector3(), stepFrom: new THREE.Vector3(), stepTo: new THREE.Vector3(),
  }));
  Object.assign(simulation, { rig: { legs }, world: { floorHeight: 0 }, bodyHeight: 2,
    state: { grounded: true, yaw: 0, position: new THREE.Vector3(), velocity: new THREE.Vector3() },
    v: Array.from({ length: 10 }, () => new THREE.Vector3()), solveAndPlace() {} });
  const events = [];
  simulation.onFootstep = count => events.push(count);
  return { simulation, legs, events };
}
test('three simultaneous foot plants produce one event at touchdown, not during the swing', () => {
  const { simulation, events } = fixture();
  simulation.updateGait(1, 0.005); assert.deepEqual(events, []);
  simulation.updateGait(1, 0.03); assert.deepEqual(events, [3]);
  simulation.updateGait(0, 0.01); assert.deepEqual(events, [3]);
});
test('missing legs and airborne legs do not produce walking sounds', () => {
  const { simulation, legs, events } = fixture();
  legs[0].disabled = true;
  simulation.updateGait(1, 0.03); assert.deepEqual(events, [2]);
  const airborne = fixture(); airborne.simulation.state.grounded = false;
  airborne.simulation.updateGait(1, 0.03); assert.deepEqual(airborne.events, []);
});
