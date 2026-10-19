// The leap's landing spot and arc (src/actors/leaper/leapPlanner.js), the shove
// that stomps and landings give Lola (PlayerKnockback), and the weak-point
// report that lets an eye crit stagger the Leaper.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { leapArc, planLeap } from '../src/actors/leaper/leapPlanner.js';
import { PlayerKnockback } from '../src/actors/leaper/PlayerKnockback.js';
import { LEAPER_EVENTS } from '../src/actors/leaper/leaperEvents.js';
import { LEAPER_BEHAVIOUR as B } from '../src/config/leaper-behaviour.js';
import { EventBus } from '../src/core/events.js';
import { createHexapod } from '../src/robot/createHexapod.js';
import { LeaperLegDamage } from '../src/simulation/LeaperLegDamage.js';

const from = { x: 0, z: 0, yaw: 0 };
const open = () => true;

test('a pounce lands landingGap short of Lola, facing her, only within the distance band', () => {
  const plan = planLeap({ from, lola: { x: 0, z: 15 }, clear: open });
  assert.ok(Math.abs(plan.to.z - (15 - B.leap.landingGap)) < 1e-9 && Math.abs(plan.to.x) < 1e-9);
  assert.ok(Math.abs(plan.to.yaw) < 1e-9, 'facing her');
  assert.equal(plan.turn, 0, 'straight at her when the way is clear');
  assert.equal(planLeap({ from, lola: { x: 0, z: B.leap.minDistance - 0.1 }, clear: open }), null, 'too close');
  assert.equal(planLeap({ from, lola: { x: 0, z: B.leap.maxDistance + 0.1 }, clear: open }), null, 'too far');
});

test('a blocked landing spot is tried a few degrees off the line; all blocked means no leap', () => {
  const tried = [];
  const plan = planLeap({ from, lola: { x: 0, z: 15 }, clear: (x, z) => { tried.push([x, z]); return x > 0.5; } });
  assert.ok(plan.turn > 0 && plan.to.x > 0.5, 'took the first clear spot to the side');
  assert.ok(tried.length >= 2);
  assert.equal(planLeap({ from, lola: { x: 0, z: 15 }, clear: () => false }), null);
  // Never onto Lola herself.
  assert.equal(planLeap({ from, lola: { x: 0, z: 15 }, clear: open, apart: () => false }), null);
});

test('the flight is a ballistic arc from take-off to the landing spot', () => {
  const plan = { ...planLeap({ from, lola: { x: 6, z: 12 }, clear: open }), launchYaw: 0.2 };
  const start = leapArc(plan, 0), middle = leapArc(plan, B.leap.flight / 2), end = leapArc(plan, B.leap.flight);
  assert.deepEqual([start.x, start.z, start.height], [0, 0, 0]);
  assert.ok(Math.abs(start.yaw - 0.2) < 1e-12, 'starts at the take-off heading');
  assert.ok(Math.abs(middle.height - B.leap.apexHeight) < 1e-9, 'apex half way');
  assert.ok(start.verticalVelocity > 0 && end.verticalVelocity < 0, 'up, then down');
  assert.ok(Math.abs(end.x - plan.to.x) < 1e-9 && Math.abs(end.z - plan.to.z) < 1e-9 && end.height === 0);
  assert.ok(Math.abs(end.yaw - plan.to.yaw) < 1e-9, 'lands facing Lola');
  // Even ground speed: equal time, equal distance.
  const a = leapArc(plan, 0.2), b = leapArc(plan, 0.4), c = leapArc(plan, 0.6);
  assert.ok(Math.abs(Math.hypot(b.x - a.x, b.z - a.z) - Math.hypot(c.x - b.x, c.z - b.z)) < 1e-9);
});

test('a knockback shoves Lola over its time through her own mover, and stops at walls', () => {
  const events = new EventBus();
  const moves = [];
  const mesh = { position: new THREE.Vector3(0, 0, 0) };
  const wallAt = 2;
  const mover = { move(world, position, direction, distance) {
    moves.push(distance);
    position.x = Math.min(wallAt, position.x + direction.x * distance);
    position.z += direction.z * distance;
  } };
  const knockback = new PlayerKnockback({ player: { mesh, mover, world: { scale: 1 } }, events });
  events.emit(LEAPER_EVENTS.lolaKnockback, { direction: { x: 2, z: 0 }, distance: 3, time: 0.3 });
  knockback.update(0.1);
  assert.ok(Math.abs(mesh.position.x - 1) < 1e-9, 'a third of the shove in a third of its time');
  for (let i = 0; i < 10; i += 1) knockback.update(0.1);
  assert.equal(mesh.position.x, wallAt, 'the mover keeps her out of the wall');
  assert.ok(Math.abs(moves.reduce((a, b) => a + b, 0) - 3) < 1e-9, 'exactly the shove distance, then it stops');
  knockback.update(0.1);
  assert.equal(moves.length, 3);
  knockback.dispose();
  events.emit(LEAPER_EVENTS.lolaKnockback, { direction: { x: 1, z: 0 }, distance: 3, time: 0.3 });
  knockback.update(0.1);
  assert.equal(moves.length, 3, 'after dispose it no longer listens');
});

test('a bullet on the eye core is remembered for its damage (a weak-point crit), once', () => {
  const scene = new THREE.Scene();
  const rig = createHexapod(scene);
  const legs = new LeaperLegDamage(scene, rig, { hit: () => null }, () => 0);
  const core = rig.eyePivot.children.find((o) => o.userData.weakPoint);
  assert.equal(legs.hit(core), false, 'the core is not a joint');
  assert.equal(legs.takeWeakPointHit(), true);
  assert.equal(legs.takeWeakPointHit(), false, 'forgotten after one damage');
  legs.hit(rig.legs[0].knee);
  assert.equal(legs.takeWeakPointHit(), false, 'a knee is not the weak point');
});
