import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { COMBAT } from '../src/config/combat.js';
import { AttackController } from '../src/simulation/AttackController.js';
import { CombatGeometry, aimAngles, withinAim, capsuleHit } from '../src/simulation/CombatGeometry.js';

function setup() {
  const tree = new AttackController(COMBAT);
  const shots = [], tracked = [];
  const context = { dead: false, paused: false, visible: true, canAim: true,
    track: () => tracked.push(tree.time), pathClear: () => true, fire: () => shots.push(tree.time) };
  return { tree, context, shots, tracked };
}

test('warning lasts 0.6 seconds, tracks 0.4, locks final 0.2; a shot about every 1.73 seconds', () => {
  for (const hz of [10, 30, 60, 144]) {
    const { tree, context, shots, tracked } = setup();
    tree.tick(0, context);
    for (let i = 0; i < hz * 10; i++) tree.tick(1 / hz, context);
    assert.ok(shots.length >= 3);
    assert.ok(shots[0] >= 0.6 - 1e-8 && shots[0] <= 0.6 + 1 / hz);
    // 1.5x as often as the original 2.6 s cycle, never faster.
    for (let i = 1; i < shots.length; i++) {
      const gap = shots[i] - shots[i - 1];
      assert.ok(gap >= COMBAT.shotInterval + COMBAT.warning - 1e-8 && gap <= 2.6 / 1.5 + 2 / hz, `shot gap ${gap}`);
    }
    assert.equal(tracked.filter(t => t > 0.4 + 1e-8 && t < 0.6 - 1e-8).length, 0);
    assert.ok(tracked.some(t => t > 0.6 && t < 2), 'tracks during cooldown');
  }
});

test('cover cancels the warning and imposes recovery; never fires on the obstructed release frame', () => {
  for (const interruption of [0.2, 0.5, 0.6]) {
    const { tree, context, shots } = setup();
    tree.tick(0, context); tree.tick(interruption, { ...context, pathClear: () => false });
    assert.equal(tree.started, null); assert.equal(shots.length, 0);
    tree.tick(0.1, context); assert.equal(tree.state, 'cooling down');
    tree.tick(0.3, context); assert.equal(tree.state, 'charging');
    tree.tick(0.6, context); assert.equal(shots.length, 1);
  }
});

test('visibility, alignment, pause, death and reset gates preempt a pending shot', () => {
  for (const change of [{ visible: false }, { canAim: false }, { paused: true }, { dead: true }]) {
    const { tree, context, shots } = setup();
    tree.tick(0, context); tree.tick(0.4, context); tree.tick(1, { ...context, ...change });
    assert.equal(shots.length, 0); assert.equal(tree.started, null);
    tree.reset(); assert.equal(tree.time, 0); assert.equal(tree.nextShot, 0); assert.equal(tree.locked, false);
  }
});

test('a 270 degree detector cannot enable a sideways or rear-facing eye shot', () => {
  const robot = new THREE.Group(); robot.rotation.y = 0.7; robot.updateMatrixWorld(true);
  for (const degrees of [0, 44, 46, 90, 134, 180]) {
    const angle = 0.7 + degrees * Math.PI / 180;
    const direction = new THREE.Vector3(Math.sin(angle), 0, Math.cos(angle));
    assert.equal(withinAim(aimAngles(robot, direction), COMBAT), degrees < 45);
  }
  assert.equal(withinAim({ yaw: 0, pitch: 81 * Math.PI / 180 }, COMBAT), false);
  assert.equal(withinAim({ yaw: 0, pitch: -71 * Math.PI / 180 }, COMBAT), false);
});

test('double-sided cover catches the whole fast segment and beats a farther body hit', () => {
  const map = new THREE.Group();
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshBasicMaterial());
  wall.position.z = 5; map.add(wall);
  const geometry = new CombatGeometry(map), origin = new THREE.Vector3(), dir = new THREE.Vector3(0, 0, 1);
  assert.equal(geometry.hit(origin, dir, 4), null);
  assert.equal(geometry.hit(origin, dir, 100).distance, 5);
  assert.equal(geometry.hit(new THREE.Vector3(0, 0, 10), dir.clone().negate(), 100).distance, 5);
  const bodyHit = capsuleHit(origin, dir, new THREE.Vector3(0, -1, 10), new THREE.Vector3(0, 1, 10), 0.25);
  assert.equal(bodyHit, 9.75);
  assert.ok(geometry.hit(origin, dir, 100).distance < bodyHit);
});

test('animated-height capsules support crouch, jump, head hits, caps, misses and start-inside', () => {
  const dir = new THREE.Vector3(0, 0, 1), origin = new THREE.Vector3(0, 1.7, 0);
  const hit = (y1, y2) => capsuleHit(origin, dir, new THREE.Vector3(0, y1, 5), new THREE.Vector3(0, y2, 5), 0.2);
  assert.ok(hit(0.9, 1.8) < 5); assert.equal(hit(0.4, 1.1), Infinity); assert.equal(hit(2.1, 2.8), Infinity);
  assert.ok(hit(1.7, 1.7) < 5);
  assert.equal(capsuleHit(new THREE.Vector3(0, 1.5, 5), dir, new THREE.Vector3(0, 1, 5), new THREE.Vector3(0, 2, 5), 0.2), 0);
  assert.ok(capsuleHit(new THREE.Vector3(0, 3, 5), new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 1, 5), new THREE.Vector3(0, 2, 5), 0.2) < 1);
});
