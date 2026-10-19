import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GunshotEffects } from '../src/simulation/GunshotEffects.js';

// What the pooled effects actually draw this frame: tracer segments, flashes and sparks.
function drawn(fx) {
  return {
    tracers: fx.tracerGeometry.drawRange.count / 2,
    flashes: fx.flashes.rifle.count + fx.flashes.pistol.count,
    sparks: fx.sparks.count,
  };
}

test('gunshot particles travel, expire individually and leave no scene residue', () => {
  const scene = new THREE.Scene(), fx = new GunshotEffects(scene, 1);
  const poolObjects = scene.children.length;
  fx.shot(new THREE.Vector3(), new THREE.Vector3(0, 0, 10), true);
  fx.impact(new THREE.Vector3(0, 0, 10), new THREE.Vector3(0, 0, -1), true);
  assert.deepEqual(drawn(fx), { tracers: 1, flashes: 1, sparks: 9 });
  const spark = fx.items.find(item => item.velocity);
  const start = spark.position.clone();
  fx.update(0.03);
  assert.ok(spark.position.distanceTo(start) > 0, 'sparks fly');
  fx.update(0.12);
  assert.ok(fx.items.length > 0 && fx.items.every(item => item.velocity), 'sparks outlive flash/tracer');
  fx.update(0.4);
  assert.equal(fx.items.length, 0);
  assert.deepEqual(drawn(fx), { tracers: 0, flashes: 0, sparks: 0 }, 'nothing left drawing');
  assert.equal(scene.children.length, poolObjects, 'shots never add scene objects');
  fx.impact(new THREE.Vector3(), new THREE.Vector3(0, 1, 0), false);
  fx.clear();
  assert.equal(fx.items.length, 0);
  assert.equal(fx.kick, 0);
  fx.dispose();
  assert.equal(scene.children.length, 0, 'dispose takes the pool out of the scene');
});

test('shots reuse the pool: no new geometry, material or GPU buffer per shot or per frame (review 5.40)', () => {
  const scene = new THREE.Scene(), fx = new GunshotEffects(scene, 1);
  const objects = new Set(), geometries = new Set(), materials = new Set();
  const collect = () => scene.traverse(object => {
    objects.add(object);
    if (object.geometry) geometries.add(object.geometry);
    if (object.material) materials.add(object.material);
  });
  collect();
  const before = [objects.size, geometries.size, materials.size];
  const positions = fx.tracerGeometry.attributes.position, colors = fx.tracerGeometry.attributes.color;
  const arrays = [positions.array, colors.array, fx.sparks.instanceMatrix.array, fx.sparks.instanceColor.array];
  const version = positions.version;
  for (let i = 0; i < 50; i += 1) {
    fx.shot(new THREE.Vector3(i * 0.1, 0, 0), new THREE.Vector3(i * 0.1, 0, 10), i % 2 === 0);
    fx.impact(new THREE.Vector3(0, 0, 10), new THREE.Vector3(0, 0, -1), i % 2 === 0);
    fx.update(1 / 60);
  }
  collect();
  assert.deepEqual([objects.size, geometries.size, materials.size], before, 'the same draw objects, geometries and materials');
  assert.deepEqual([positions.array, colors.array, fx.sparks.instanceMatrix.array, fx.sparks.instanceColor.array], arrays,
    'buffers are updated in place, never replaced');
  assert.ok(positions.version > version, 'tracer endpoints are uploaded as they change');
  // A full pool reuses its oldest effect instead of growing.
  assert.ok(fx.items.filter(item => item.kind === 'spark').length <= fx.sparks.instanceMatrix.count);
  fx.dispose();
});

test('Leaper impact shudder is render-only and restores the exact body orientation', () => {
  const robot = new THREE.Group(), fx = new GunshotEffects(new THREE.Scene(), 1);
  robot.rotation.set(0.1, 0.7, -0.2);
  const original = robot.quaternion.clone();
  fx.impact(new THREE.Vector3(), new THREE.Vector3(0, 1, 0), true);
  fx.beforeRender(robot);
  assert.ok(robot.quaternion.angleTo(original) > 0.01);
  fx.afterRender(robot);
  assert.ok(robot.quaternion.angleTo(original) < 1e-7);
  fx.clear();
});

test('flash and a nonzero bullet streak survive a slow 100ms frame', () => {
  const fx = new GunshotEffects(new THREE.Scene(), 1);
  fx.shot(new THREE.Vector3(), new THREE.Vector3(0, 0, 10), false);
  assert.equal(fx.tracerGeometry.attributes.position.getZ(1), 10, 'the streak ends at the hit');
  fx.update(0.1);
  assert.equal(fx.items.length, 2);
  // The tracer still has opacity, and the flash still has size.
  assert.ok(fx.tracerGeometry.attributes.color.getW(0) > 0);
  const matrix = new THREE.Matrix4();
  fx.flashes.pistol.getMatrixAt(0, matrix);
  assert.ok(new THREE.Vector3().setFromMatrixScale(matrix).length() > 0);
  assert.deepEqual(drawn(fx), { tracers: 1, flashes: 1, sparks: 0 });
  fx.update(0.1);
  assert.equal(fx.items.length, 0);
});
