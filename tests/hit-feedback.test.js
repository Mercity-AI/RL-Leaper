import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { HitFeedback } from '../src/weapons/HitFeedback.js';
import { FirstPersonView } from '../src/weapons/FirstPersonView.js';
import { MuzzleTracker } from '../src/weapons/MuzzleTracker.js';
import { HIT_FEEDBACK } from '../src/config/weapons.js';

test('hit markers say what the bullet did: normal, weak point, joint, kill', () => {
  assert.equal(HitFeedback.markerKind({}), 'normal');
  assert.equal(HitFeedback.markerKind({ weakPoint: true }), 'weak');
  assert.equal(HitFeedback.markerKind({ weakPoint: true, brokeJoint: true }), 'joint');
  assert.equal(HitFeedback.markerKind({ brokeJoint: true, killed: true }), 'kill');
  const feedback = new HitFeedback();
  feedback.hit({ weakPoint: true });
  let state = feedback.state;
  assert.ok(state.hit && state.crit && !state.big && state.glow === 0);
  assert.deepEqual(state.marker, { kind: 'weak', strength: 1 });
  feedback.update(HIT_FEEDBACK.markers.weak / 2);
  assert.ok(Math.abs(feedback.state.marker.strength - 0.5) < 1e-9, 'the marker fades');
  feedback.update(1);
  state = feedback.state;
  assert.ok(!state.hit && !state.crit && state.marker === null);
});

test('a snapped joint or the kill is a big hit: held crosshair and the blue edge glow', () => {
  const feedback = new HitFeedback();
  feedback.hit({ brokeJoint: true });
  assert.ok(feedback.state.big && feedback.state.glow === 1);
  feedback.update(HIT_FEEDBACK.edgeGlowTime / 2);
  assert.ok(Math.abs(feedback.state.glow - 0.5) < 1e-9);
  feedback.miss();
  assert.ok(!feedback.state.hit, 'a miss drops the hit kick at once');
  assert.ok(feedback.state.big, 'but the big-hit hold plays out');
  feedback.clear();
  assert.ok(!feedback.state.big && feedback.state.glow === 0);
});

test('aiming down the sights stops drawing only Lola\'s head and neck; her shadow and body stay', () => {
  const player = { mesh: new THREE.Group() };
  const part = (name) => {
    const material = new THREE.MeshStandardMaterial({ name });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), material);
    mesh.castShadow = true;
    player.mesh.add(mesh);
    return { mesh, material };
  };
  const head = part('face'), neck = part('neck'), arms = part('arms'), top = part('Top');
  const view = new FirstPersonView(player);
  view.set(true);
  for (const { material } of [head, neck]) assert.ok(!material.colorWrite && !material.depthWrite);
  for (const { material } of [arms, top]) assert.ok(material.colorWrite && material.depthWrite, 'arms and body still drawn');
  for (const { mesh, material } of [head, neck, arms, top]) {
    assert.ok(mesh.visible && material.visible && mesh.castShadow, 'nothing hidden from the shadow pass');
  }
  view.dispose();
  for (const { material } of [head, neck]) assert.ok(material.colorWrite && material.depthWrite, 'restored afterwards');
});

test('the muzzle estimate follows Lola and remembers each gun and stance', () => {
  const player = { mesh: new THREE.Group(), weaponIndex: 0, crouching: false, height: 2 };
  const tracker = new MuzzleTracker();
  const guess = tracker.estimate(player);
  assert.ok(guess.y > 1 && guess.z > 0, 'a first guess: chest high, in front of her');
  tracker.remember(player, new THREE.Vector3(0.1, 1.5, 0.6));
  player.mesh.position.set(5, 0, 5);
  player.mesh.rotation.y = Math.PI;
  const moved = tracker.estimate(player);
  assert.ok(moved.distanceTo(new THREE.Vector3(4.9, 1.5, 4.4)) < 1e-9, 'it turns and moves with her');
  assert.ok(tracker.known(player));
  player.crouching = true;
  assert.ok(!tracker.known(player), 'the crouched pose is measured separately');
});
