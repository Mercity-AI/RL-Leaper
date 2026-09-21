import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { JunkyardPlaytest } from '../src/simulation/JunkyardPlaytest.js';

function fixture() {
  const button = { textContent: '' };
  const chase = Object.assign(Object.create(JunkyardPlaytest.prototype), {
    world: { scale: 1, navigation: { route: (start, goal) => goal.x < 0 ? [] : [start, goal] } },
    engine: { scene: new THREE.Scene() },
    target: { mesh: { position: new THREE.Vector3(5, 3.5, 0) }, setSelected() {} },
    simulation: {
      state: { position: new THREE.Vector3(), velocity: new THREE.Vector3() },
      input: { getMovement: () => ({ forward: 0, side: 0 }) },
    },
    panel: { querySelector: () => button }, message: {},
    path: [], walking: false, replanDelay: 0, stallTime: 0, previous: new THREE.Vector3(),
  });
  return { chase, button };
}

test('Target changes replan without ending the run, including after arrival', () => {
  const { chase, button } = fixture();
  chase.start();
  chase.target.mesh.position.set(0, 3.5, 5);
  chase.update(0.31);
  assert.equal(button.textContent, 'STOP RUN');
  assert.ok(chase.simulation.navigationMove.z > 0);
  chase.simulation.state.position.set(0, 0, 5);
  chase.update(0.31);
  assert.equal(chase.walking, true);
  assert.equal(chase.simulation.navigationMove, null);
  chase.target.mesh.position.set(5, 3.5, 5);
  chase.update(0.31);
  assert.ok(chase.simulation.navigationMove.x > 0);
  chase.stop('Stopped');
  chase.target.mesh.position.z = 10;
  chase.update(1);
  assert.equal(button.textContent, 'START RUN');
  assert.equal(chase.simulation.navigationMove, null);
});

test('Blocked target waits and resumes when reachable; manual input only suspends chasing', () => {
  const { chase } = fixture();
  chase.start();
  chase.target.mesh.position.x = -5;
  chase.update(0.31);
  assert.equal(chase.walking, true);
  assert.equal(chase.simulation.navigationMove, null);
  chase.target.mesh.position.x = 5;
  chase.update(0.31);
  assert.ok(chase.simulation.navigationMove.x > 0);
  chase.simulation.input.getMovement = () => ({ forward: 1, side: 0 });
  chase.simulation.state.velocity.x = 2;
  chase.update(0.1);
  assert.equal(chase.walking, true);
  assert.equal(chase.simulation.navigationMove, null);
  assert.equal(chase.simulation.state.velocity.x, 2);
  chase.simulation.input.getMovement = () => ({ forward: 0, side: 0 });
  chase.update(0.1);
  assert.ok(chase.simulation.navigationMove.x > 0);
});
