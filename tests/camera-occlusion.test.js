import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CameraOcclusion } from '../src/camera/CameraOcclusion.js';

const camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 220);
const anchor = new THREE.Vector3(0, 2, 0);
function panel(x = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(x ? 0.1 : 10, 10, 0.02));
  mesh.position.set(x, 2, 5);
  return mesh;
}
test('thin wall pulls in before cover and clearance returns gradually', () => {
  const solver = new CameraOcclusion([panel()]);
  const desired = new THREE.Vector3(0, 2, 10);
  solver.resolve(anchor, desired, camera, 1 / 60);
  assert.ok(desired.z < 4.75 && desired.z > 4);
  solver.geometry.meshes.length = 0;
  desired.set(0, 2, 10);
  solver.resolve(anchor, desired, camera, 1 / 60);
  assert.ok(desired.z < 4.75, 'brief clearance does not bounce the camera outward');
  for (let i = 0; i < 10; i++) {
    desired.set(0, 2, 10); solver.resolve(anchor, desired, camera, 1 / 60);
  }
  assert.ok(desired.z > 4.75 && desired.z < 7);
  for (let i = 0; i < 180; i++) {
    desired.set(0, 2, 10); solver.resolve(anchor, desired, camera, 1 / 60);
  }
  assert.ok(desired.z > 9.99);
});
test('edge probes catch a corner missed by the centre ray', () => {
  const solver = new CameraOcclusion([panel(0.25)]);
  const desired = new THREE.Vector3(0, 2, 10);
  solver.resolve(anchor, desired, camera, 1 / 60);
  assert.ok(desired.z < 5);
});
test('clear scenery preserves zoom and double-sided faces block from either side', () => {
  const solver = new CameraOcclusion([]);
  const desired = new THREE.Vector3(0, 2, 10);
  solver.resolve(anchor, desired, camera, 0);
  assert.equal(desired.z, 10);
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(10, 10));
  wall.position.set(0, 2, 5);
  for (const [start, end] of [[anchor, desired], [desired, anchor]]) {
    const result = end.clone();
    new CameraOcclusion([wall]).resolve(start, result, camera, 1 / 60);
    assert.ok(result.distanceTo(start) < 5);
  }
});

test('tight cover preserves body clearance and restores faded scenery after rendering', () => {
  const wall = panel(); wall.position.z = 0.5;
  const solver = new CameraOcclusion([wall]);
  const desired = new THREE.Vector3(0, 2, 10);
  solver.resolve(anchor, desired, camera, 1 / 60, 2);
  assert.equal(desired.distanceTo(anchor), 2);
  const original = wall.material;
  solver.beforeRender();
  assert.notEqual(wall.material, original);
  solver.afterRender();
  assert.equal(wall.material, original);
});
