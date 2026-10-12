import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GunshotEffects } from '../src/simulation/GunshotEffects.js';

test('gunshot particles travel, expire individually and leave no scene residue', () => {
  const scene = new THREE.Scene(), fx = new GunshotEffects(scene, 1);
  fx.shot(new THREE.Vector3(), new THREE.Vector3(0, 0, 10), true);
  fx.impact(new THREE.Vector3(0, 0, 10), new THREE.Vector3(0, 0, -1), true);
  const spark = fx.items.find(item => item.velocity);
  const start = spark.mesh.position.clone();
  fx.update(0.03);
  assert.ok(spark.mesh.position.distanceTo(start) > 0);
  fx.update(0.04);
  assert.ok(fx.items.length > 0 && fx.items.every(item => item.velocity), 'sparks outlive flash/tracer');
  fx.update(0.4);
  assert.equal(fx.items.length, 0);
  assert.equal(scene.children.length, 0);
  fx.impact(new THREE.Vector3(), new THREE.Vector3(0, 1, 0), false);
  fx.clear();
  assert.equal(scene.children.length, 0);
  assert.equal(fx.kick, 0);
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
