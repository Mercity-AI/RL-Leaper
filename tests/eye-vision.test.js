import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { EyeVision } from '../src/simulation/EyeVision.js';
import config from '../src/config/eye-vision.json' with { type: 'json' };

function fixture() {
  globalThis.location = { search: '' };
  const controls = {};
  const model = new THREE.Group();
  config.targetBones.forEach((name, i) => {
    const bone = new THREE.Bone();
    bone.name = THREE.PropertyBinding.sanitizeNodeName(name);
    bone.position.set(0, 3 - i, 0);
    model.add(bone);
  });
  const robot = new THREE.Group();
  robot.position.set(10, 2.32, 0);
  robot.scale.setScalar(2);
  robot.rotation.y = Math.PI / 2;
  const eyePivot = new THREE.Group();
  eyePivot.position.set(0, .03, .43);
  robot.add(eyePivot);
  const playtest = {
    target: { mesh: model, outfits: [{ model }], weaponIndex: 0 },
    simulation: { rig: { robot, eyePivot } },
    engine: { scene: new THREE.Scene() },
    panel: { querySelector: key => controls[key] ||= { setAttribute() {} } },
    reset() {},
  };
  return { vision: new EyeVision(playtest), playtest };
}

test('Sight anchors use loaded bone names and follow animated height', () => {
  const { vision, playtest } = fixture();
  const pose = vision.pose();
  pose.eye.forEach((value, i) => assert.ok(Math.abs(value - config.eyeOffset[i]) < 1e-8));
  assert.equal(pose.points[0][1], 3);
  playtest.target.mesh.position.y = 2;
  assert.equal(vision.pose().points[0][1], 5);
  playtest.target.mesh.children[0].position.y = 1;
  assert.equal(vision.pose().points[0][1], 3);
});

test('Debug lines stop at cover and vanish outside the field of view', () => {
  const { vision } = fixture();
  const frame = { sight: { origin: [0, 2, 0], points: [[0, 3, 10], [0, 2, 10], [0, 1, 10]],
    hits: [null, null, [0, 1.5, 5]], clear: [true, true, false], in_view: true } };
  vision.show(frame);
  assert.equal(vision.lines.children[2].geometry.attributes.position.getZ(1), 5);
  assert.match(vision.label.textContent, /2\/3 CLEAR/);
  frame.sight.in_view = false;
  vision.show(frame);
  assert.ok(vision.lines.children.every(line => !line.visible));
});
