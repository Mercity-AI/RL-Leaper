import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createHexapod } from '../src/robot/createHexapod.js';
import { LeaperSimulation } from '../src/simulation/LeaperSimulation.js';
import { LeaperLegDamage } from '../src/simulation/LeaperLegDamage.js';
import { Hitboxes, createLeaperHitboxes, rayCapsule, raySphere } from '../src/weapons/Hitboxes.js';
import { createLeaperTarget } from '../src/weapons/LeaperTarget.js';
import { TargetRegistry } from '../src/weapons/TargetRegistry.js';
import { COMBAT } from '../src/config/combat.js';

// A standing, posed Leaper at (x, z) with its leg-damage tags, as in the game.
function leaper(x = 0, z = 0) {
  const scene = new THREE.Scene(), rig = createHexapod(scene);
  const cameraController = { eyePitch: 0, eyeYaw: 0, update() {} };
  const sim = new LeaperSimulation({ rig, cameraController, sun: { position: new THREE.Vector3(), target: { position: new THREE.Vector3() } }, statusElement: {} });
  sim.state.position.set(x, 0, z);
  for (const leg of rig.legs) leg.footPosition.add(new THREE.Vector3(x, 0, z));
  sim.updateBody(0, 0); sim.updateGait(0, 0);
  scene.updateMatrixWorld(true);
  const legs = new LeaperLegDamage(scene, rig, { hit: () => null }, () => 0);
  return { scene, rig, legs };
}

// A stand-in for LeaperCombat that records the damage it is dealt.
function fakeCombat(legs, health = 600) {
  return {
    legs, leaperHealth: health, dealt: [],
    damageLeaper(amount, debug, major) { this.dealt.push({ amount, major }); this.leaperHealth = Math.max(0, this.leaperHealth - amount); },
  };
}

// Fire at a point from a few sides; the first ray whose hit passes `accept`.
function shootAt(hitboxes, center, accept) {
  for (const offset of [[2, 0, 0], [0, 0, 2], [0, 2, 0], [-2, 0, 0], [0, 0, -2]]) {
    const origin = center.clone().add(new THREE.Vector3(...offset));
    const hit = hitboxes.raycast(origin, center.clone().sub(origin).normalize(), 4);
    if (hit && accept(hit)) return hit;
  }
  return null;
}

test('ray-sphere and ray-capsule distances, inside starts and misses', () => {
  const dir = new THREE.Vector3(0, 0, -1);
  assert.ok(Math.abs(raySphere(new THREE.Vector3(0, 0, 5), dir, new THREE.Vector3(), 1) - 4) < 1e-9);
  assert.equal(raySphere(new THREE.Vector3(0, 0, 0.5), dir, new THREE.Vector3(), 1), 0, 'starting inside');
  assert.equal(raySphere(new THREE.Vector3(0, 2, 5), dir, new THREE.Vector3(), 1), Infinity);
  assert.equal(raySphere(new THREE.Vector3(0, 0, -5), dir, new THREE.Vector3(), 1), Infinity, 'behind the ray');
  assert.equal(raySphere(new THREE.Vector3(0, 0, 5), dir, new THREE.Vector3(), 1, 3), Infinity, 'beyond far');
  const a = new THREE.Vector3(-2, 0, 0), b = new THREE.Vector3(2, 0, 0);
  assert.ok(Math.abs(rayCapsule(new THREE.Vector3(1, 0, 5), dir, a, b, 0.5) - 4.5) < 1e-9, 'the round side');
  assert.ok(Math.abs(rayCapsule(new THREE.Vector3(5, 0, 0), new THREE.Vector3(-1, 0, 0), a, b, 0.5) - 2.5) < 1e-9, 'an end cap');
  assert.equal(rayCapsule(new THREE.Vector3(0, 0, 0.2), dir, a, b, 0.5), 0);
  assert.equal(rayCapsule(new THREE.Vector3(0, 1, 5), dir, a, b, 0.5), Infinity);
});

test('the Leaper gets a body, an eye housing, a weak-point core and six pieces per leg', () => {
  const { rig, legs } = leaper();
  const hitboxes = createLeaperHitboxes(rig);
  assert.equal(hitboxes.volumes.length, 3 + 6 * 6);
  // Each leg volume rides on the piece LeaperLegDamage counts that joint's hits on.
  for (const volume of hitboxes.volumes.filter(item => item.joint)) {
    assert.deepEqual(volume.object.userData.leaperJoint, { index: volume.leg, joint: volume.joint });
  }
  assert.ok(legs);
});

test('upper and lower knee joints, the core and the body are hit by their own zones', () => {
  const { rig } = leaper();
  const hitboxes = createLeaperHitboxes(rig);
  hitboxes.update();
  for (const leg of rig.legs) {
    for (const [joint, piece] of [['upper', leg.knee], ['lower', leg.calfJoint]]) {
      const center = piece.getWorldPosition(new THREE.Vector3());
      const hit = shootAt(hitboxes, center, item => item.volume.joint === joint && item.volume.leg === leg.index);
      assert.ok(hit, `leg ${leg.index} ${joint} joint can be shot directly`);
      assert.equal(hit.zone, 'knee');
    }
  }
  // Straight at the eye's red core from in front: the weak point, double damage.
  const core = rig.eyePivot.children.find(object => object.userData.weakPoint).getWorldPosition(new THREE.Vector3());
  const front = hitboxes.raycast(core.clone().add(new THREE.Vector3(0, 0, 6)), new THREE.Vector3(0, 0, -1), 10);
  assert.equal(front.zone, 'core');
  assert.equal(front.multiplier, COMBAT.weakPointMultiplier);
  // The shell from above: the body.
  const top = hitboxes.raycast(rig.robot.position.clone().add(new THREE.Vector3(0, 5, 0)), new THREE.Vector3(0, -1, 0), 10);
  assert.equal(top.zone, 'body');
  assert.ok(top.normal.y > 0.9, 'sparks fly back up off the top');
});

test('hit volumes follow the rig, and a shot-off piece stops being hittable', () => {
  const { rig } = leaper();
  const hitboxes = createLeaperHitboxes(rig);
  hitboxes.update();
  const ray = [new THREE.Vector3(10, 2.4, 0), new THREE.Vector3(-1, 0, 0)];
  assert.ok(hitboxes.raycast(...ray, 20));
  rig.robot.position.z += 10;
  rig.robot.updateMatrixWorld(true);
  hitboxes.update();
  const body = hitboxes.raycast(...ray, 20);
  assert.ok(!body || body.zone !== 'body', 'the body moved away');
  // Detach every piece of leg 0: none of its volumes is hit any more.
  for (const key of ['coxa', 'femur', 'tibia', 'calf', 'knee', 'calfJoint']) rig.legs[0][key].userData.detached = true;
  assert.ok(hitboxes.volumes.filter(volume => volume.leg === 0).every(volume => !Hitboxes.enabled(volume)));
});

test('a Leaper target counts joint hits through its leg damage and scales damage by zone', () => {
  const { rig, legs } = leaper();
  const combat = fakeCombat(legs);
  const target = createLeaperTarget({ rig, combat });
  target.update();
  const leg = rig.legs[2];
  const knee = shootAt(target.hitboxes, leg.knee.getWorldPosition(new THREE.Vector3()),
    item => item.volume.joint === 'upper' && item.volume.leg === leg.index);
  const threshold = leg.damage.upper.threshold;
  let broke = false;
  for (let i = 0; i < threshold; i += 1) broke = target.applyHit(knee, { damage: 2, direction: new THREE.Vector3(0, 0, -1) }).brokeJoint;
  assert.equal(leg.damage.upper.hits, threshold);
  assert.ok(broke && legs.debris.length === 1, 'the knee snaps on its assigned bullet');
  assert.ok(combat.dealt.at(-1).major, 'a snapped joint is a big hit');
  const core = target.hitboxes.raycast(new THREE.Vector3(0, rig.robot.position.y, 8), new THREE.Vector3(0, 0, -1), 10);
  const outcome = target.applyHit(core, { damage: 5, direction: new THREE.Vector3(0, 0, -1) });
  assert.ok(outcome.weakPoint);
  assert.equal(combat.dealt.at(-1).amount, 5 * COMBAT.weakPointMultiplier);
  combat.leaperHealth = 4;
  assert.ok(target.applyHit(core, { damage: 5, direction: new THREE.Vector3() }).killed, 'the finishing bullet');
});

test('several enemies are hit independently through one target registry', () => {
  const first = leaper(0, 0), second = leaper(0, -12);
  const combats = [fakeCombat(first.legs), fakeCombat(second.legs)];
  const registry = new TargetRegistry();
  const targets = [createLeaperTarget({ rig: first.rig, combat: combats[0] }), createLeaperTarget({ rig: second.rig, combat: combats[1] })];
  const removeSecond = registry.add(targets[1]);
  registry.add(targets[0]);
  registry.update();
  // Down the line through both: only the nearer one is hit.
  const along = [new THREE.Vector3(0, 2.4, 10), new THREE.Vector3(0, 0, -1)];
  const hit = registry.raycast(...along, 60);
  assert.equal(hit.target, targets[0]);
  hit.target.applyHit(hit, { damage: 2, direction: along[1] });
  assert.equal(combats[0].dealt.length, 1);
  assert.equal(combats[1].dealt.length, 0, 'the far Leaper is untouched');
  // From the far side, the other one.
  const back = registry.raycast(new THREE.Vector3(0, 2.4, -25), new THREE.Vector3(0, 0, 1), 60);
  assert.equal(back.target, targets[1]);
  // An inactive or removed target is never hit.
  targets[0].active = () => false;
  assert.equal(registry.raycast(...along, 60).target, targets[1]);
  removeSecond();
  assert.equal(registry.raycast(...along, 60), null);
  assert.equal(registry.size, 1);
});
