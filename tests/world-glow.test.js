import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { glows, markGlow, GLOW_LAYER } from '../src/core/postprocessing.js';
import { createHexapod } from '../src/robot/createHexapod.js';
import { MODES } from '../src/modes/index.js';

// The glow (bloom) pass: which materials glow, the Leaper's red lights, and
// which pages ask the renderer for glow at all. The pass itself is checked on
// the GPU in tests/world-render.html.

test('what glows: unlit see-through effects and marked lights; never solid or on-top things', () => {
  const effect = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false });
  const line = new THREE.LineBasicMaterial({ transparent: true, depthWrite: false });
  const shader = new THREE.ShaderMaterial({ transparent: true, depthWrite: false });
  assert.ok(glows(effect) && glows(line) && glows(shader), 'muzzle flashes, tracers, laser bolts');
  assert.equal(glows(new THREE.MeshBasicMaterial()), false, 'a solid colour');
  assert.equal(glows(new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.45 })), false, 'see-through but solid');
  assert.equal(glows(new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, depthTest: false })), false,
    'on-top overlays (clearance map, sight lines)');
  assert.equal(glows(new THREE.MeshStandardMaterial({ emissive: 0xff0000 })), false, 'lit materials only when marked');
  const group = new THREE.Group();
  group.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()));
  markGlow(group);
  assert.ok(glows(group.children[0].material), 'markGlow marks a whole object');
  assert.equal(glows(markGlow(effect, false)), false, 'and can switch an effect off');
  assert.ok(GLOW_LAYER > 0 && GLOW_LAYER < 32);
});

test('the Leaper\'s red lights are marked to glow, its armour is not', () => {
  const scene = new THREE.Scene();
  const rig = createHexapod(scene);
  assert.ok(rig.materials.glow.userData.glow && rig.materials.glowSoft.userData.glow, 'eye and leg lights');
  const core = rig.eyePivot.children.find((object) => object.userData.weakPoint);
  assert.ok(glows(core.material), 'the weak-point core');
  assert.ok(glows(core.material.clone()), 'combat\'s pulsing copies keep the mark');
  for (const name of ['core', 'leg', 'plate', 'joint', 'dark', 'lens']) assert.equal(glows(rig.materials[name]), false, name);
});
test('only the game asks the renderer for glow; the lab views stay plain', () => {
  assert.equal(MODES.junkyard.engine.glow, true);
  for (const name of ['arena', 'training', 'sandbox']) assert.equal(MODES[name].engine.glow, false, name);
});
