// The Leaper's behaviour layer carried out on the real rig and animator
// (src/actors/leaper/LeaperActor.js), with a stand-in brain and combat:
// when the brain steps or pauses, the turn in place and its pose sync, the
// stomp and the leap (telegraph, area hit, knockback, the brain's pose after
// the leap), stagger, downed and the collapse into a wreck.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createHexapod } from '../src/robot/createHexapod.js';
import { LeaperSimulation } from '../src/simulation/LeaperSimulation.js';
import { LeaperActor } from '../src/actors/leaper/LeaperActor.js';
import { LEAPER_EVENTS } from '../src/actors/leaper/leaperEvents.js';
import { LEAPER_BEHAVIOUR as B } from '../src/config/leaper-behaviour.js';
import { COMBAT } from '../src/config/combat.js';
import { STANDING_HEIGHT } from '../src/config/robot.js';
import { EventBus } from '../src/core/events.js';
import { leaperBlocksMove } from '../src/world/playerContact.js';

const DT = 1 / 60;
const flush = () => new Promise((resolve) => setImmediate(resolve));

// The real hexapod and animator in an open yard, a stand-in brain (it answers
// pose syncs and can be fed moves) and a stand-in combat. feedback: true adds
// the real effects (rings, sparks) in the rig's scene.
function setup({ lola = { x: 0, z: 25 }, aware = false, refuseSync = false, blocked = () => false, feedback = false } = {}) {
  const scene = new THREE.Scene();
  const rig = createHexapod(scene);
  const world = { scale: 1.45, floorHeight: 0, positionBlocked: blocked, playerBlocked: () => false };
  const simulation = new LeaperSimulation({ rig, world, cameraController: { eyePitch: 0, eyeYaw: 0, compensateForBodyTurn() {} },
    sun: { position: new THREE.Vector3(), target: { position: new THREE.Vector3() } }, statusElement: {} });
  simulation.drivesPresentation = false;
  const log = [];
  const player = { mesh: { position: new THREE.Vector3(lola.x, 0, lola.z) } };
  const vitals = { health: 100, get dead() { return this.health <= 0; }, damage(amount) { this.health -= amount; log.push(['lola hit', amount]); } };
  const brain = {
    ready: true, offline: false, running: false, pendingMovement: false, syncs: [], heldBy: null,
    frame: { x: 0, z: 0, yaw: 0, target_visible: aware, target_ever_seen: aware, memory_age: 0, step: 0 },
    start() { this.running = true; }, stop() { this.running = false; },
    syncPose(pose) {
      this.syncs.push({ ...pose });
      if (refuseSync) return Promise.reject(new Error('Leaper pose intersects the junkyard'));
      this.frame = { ...this.frame, ...pose };
      return Promise.resolve(this.frame);
    },
  };
  const combat = { leaperHealth: COMBAT.leaperHealth, lolaVisible: aware, hold: null, damageScale: 1,
    legs: {}, tree: { cancel: () => log.push(['tree cancel']), interrupt: (wait) => log.push(['tree interrupt', wait]) },
    damageLola(direction, amount) { vitals.damage(amount, direction); } };
  const events = new EventBus();
  const heard = [];
  for (const name of Object.values(LEAPER_EVENTS)) events.on(name, (payload) => heard.push([name, payload]));
  const flow = { hunting: true };
  const camera = { shakes: [], shake(amount) { this.shakes.push(amount); } };
  const actor = new LeaperActor({ simulation, brain, combat }, { flow, events, world, player, vitals, cameraController: camera },
    { feedback, scene });
  // Advance the game: the brain's own moves are fed by the test where needed.
  const frames = (seconds, each = () => {}) => {
    for (let t = 0; t < seconds - 1e-9; t += DT) {
      each();
      actor.update(DT);
    }
  };
  // Advance until `done()` (at most `seconds`), then stop exactly there.
  const framesUntil = (done, seconds = 10) => {
    for (let t = 0; t < seconds && !done(); t += DT) actor.update(DT);
    assert.ok(done(), 'reached the expected moment');
  };
  return { rig, simulation, world, player, vitals, brain, combat, events, heard, flow, camera, actor, frames, framesUntil, log };
}

test('the brain steps only in Search and Chase; holding to shoot pauses it and the badge says why', () => {
  const { actor, brain, frames, player, combat } = setup({ lola: { x: 0, z: 30 } });
  frames(0.1);
  assert.equal(actor.director.state, 'search');
  assert.equal(brain.running, true, 'searching: the trained brain walks');
  assert.equal(brain.drivesAnimator, false, 'and the behaviour layer animates the rig');
  // Lola close (inside the engage range, closer than a pounce), seen by the
  // brain and in the eye's line of fire: Engage.
  player.mesh.position.set(0, 0, 7);
  brain.frame = { ...brain.frame, target_visible: true, target_ever_seen: true };
  combat.lolaVisible = true;
  frames(0.1);
  assert.equal(actor.director.state, 'engage');
  assert.equal(brain.running, false, 'holding: the brain is paused');
  assert.equal(brain.heldBy, 'ENGAGING');
  assert.equal(combat.hold, null, 'and the eye may fire');
});

test('Engage turns the body to face Lola by animation, then tells the brain the new heading before it walks on', () => {
  const { actor, brain, frames, player, combat, simulation } = setup();
  brain.frame = { ...brain.frame, target_visible: true, target_ever_seen: true };
  combat.lolaVisible = true;
  // Lola 7 units away, 60 degrees to the side.
  player.mesh.position.set(Math.sin(Math.PI / 3) * 7, 0, Math.cos(Math.PI / 3) * 7);
  frames(0.2);
  assert.equal(actor.director.state, 'engage');
  frames(1);
  assert.ok(Math.abs(simulation.state.yaw - Math.PI / 3) < 0.15, `turned toward her (${simulation.state.yaw.toFixed(2)})`);
  assert.equal(brain.syncs.length, 0, 'the paused brain is not bothered while holding');
  // She runs off: Chase again, and the brain learns the turned heading first.
  player.mesh.position.set(Math.sin(Math.PI / 3) * 25, 0, Math.cos(Math.PI / 3) * 25);
  frames(0.1);
  assert.equal(actor.director.state, 'chase');
  assert.equal(brain.syncs.length, 1);
  assert.ok(Math.abs(brain.syncs[0].yaw - simulation.state.yaw) < 1e-9, 'synced to the heading it turned to');
  assert.equal(brain.running, true);
});

test('no turn in place where the leg span is not clear at every heading (the brain might refuse it)', () => {
  const { actor, brain, frames, player, combat, simulation } = setup({ blocked: () => true });
  brain.frame = { ...brain.frame, target_visible: true, target_ever_seen: true };
  combat.lolaVisible = true;
  player.mesh.position.set(7, 0, 0);
  frames(1.5);
  assert.equal(actor.director.state, 'engage');
  assert.equal(simulation.state.yaw, 0, 'it holds its heading; the eye swivels instead');
});

test('the brain\'s replies are played back smoothly, a step or so behind', () => {
  const { brain, frames, simulation, player } = setup();
  player.mesh.position.set(0, 0, 40);
  let clock = 0;
  const speeds = [];
  let last = 0;
  frames(4, () => {
    clock += DT;
    if (clock >= 0.1) {
      clock -= 0.1;
      brain.frame = { ...brain.frame, z: brain.frame.z + 0.375 };
    }
    speeds.push((simulation.state.position.z - last) / DT);
    last = simulation.state.position.z;
  });
  const steady = speeds.slice(90);
  assert.ok(Math.max(...steady) < 3.75 * 1.3 && Math.min(...steady) > 3.75 * 0.7, 'an even 3.75 units per second');
  assert.ok(brain.frame.z - simulation.state.position.z < 0.375 * 2.5, 'close behind the brain');
});

test('stomp: Lola hugging it is warned, then hit once and shoved straight away from the Leaper', async () => {
  const { actor, brain, frames, framesUntil, vitals, heard, camera, log } = setup({ aware: true, lola: { x: 1, z: 3 } });
  framesUntil(() => actor.director.state === 'stomp');
  assert.ok(Math.abs(actor.director.reachTime - B.stomp.trigger) < 2 * DT, 'after the trigger time of hugging');
  assert.equal(brain.running, false, 'the brain is paused for the stomp');
  assert.ok(log.some(([what]) => what === 'tree cancel'), 'the eye\'s wind-up is dropped');
  assert.ok(heard.some(([name, p]) => name === LEAPER_EVENTS.attack && p.kind === 'stomp' && p.phase === 'windup'));
  // The crouch is the telegraph.
  frames(B.stomp.windup * 0.8);
  assert.ok(actor.posture.lower > B.stomp.crouch * 0.4, `crouching (${actor.posture.lower.toFixed(2)})`);
  assert.equal(vitals.health, 100, 'no damage during the wind-up');
  frames(B.stomp.windup * 0.3);
  assert.equal(vitals.health, 100 - B.stomp.damage);
  const push = heard.find(([name]) => name === LEAPER_EVENTS.lolaKnockback)[1];
  assert.ok(Math.abs(push.direction.x - 1 / Math.hypot(1, 3)) < 1e-6 && push.distance === B.stomp.knockback.distance, 'shoved away from the centre');
  assert.ok(camera.shakes.includes(B.stomp.cameraShake));
  frames(B.stomp.recovery + 0.1);
  assert.notEqual(actor.director.state, 'stomp');
  assert.equal(vitals.health, 100 - B.stomp.damage, 'one hit per stomp');
});

test('stomp: stepping out of the ring during the wind-up dodges it', () => {
  const { actor, frames, framesUntil, player, vitals, heard } = setup({ aware: true, lola: { x: 0, z: 3 } });
  framesUntil(() => actor.director.state === 'stomp');
  player.mesh.position.set(0, 0, B.stomp.radius + 1);
  frames(B.stomp.windup + 0.1);
  assert.equal(vitals.health, 100);
  assert.equal(heard.find(([name, p]) => name === LEAPER_EVENTS.attack && p.phase === 'impact')[1].hit, false);
});

test('a stomp called off before it lands (the run stops, Lola goes down) takes its warning ring with it', () => {
  for (const callOff of [({ flow }) => { flow.hunting = false; }, ({ vitals }) => { vitals.health = 0; }]) {
    const game = setup({ aware: true, lola: { x: 0, z: 3 }, feedback: true });
    const { actor, frames, framesUntil } = game;
    framesUntil(() => actor.director.state === 'stomp');
    frames(B.stomp.windup * 0.5);
    assert.equal(actor.feedback.rings.stomp.mesh.visible, true, 'the red ring warns of the stomp');
    callOff(game);
    frames(0.1);
    assert.equal(actor.director.state, 'dormant');
    assert.equal(actor.feedback.rings.stomp.mesh.visible, false, 'and is gone once the stomp is called off');
    actor.dispose();
  }
});

test('leap: the brain accepts the landing, the Leaper flies a scripted arc, lands with a shockwave, and walks on from there', async () => {
  const { actor, brain, combat, frames, framesUntil, vitals, simulation, heard } = setup({ aware: true, lola: { x: 0, z: 15 } });
  framesUntil(() => actor.director.state === 'leap');
  const plan = actor.director.plan;
  assert.ok(Math.abs(plan.to.z - (15 - B.leap.landingGap)) < 1e-9, 'lands landingGap short of Lola');
  // The brain checks the landing spot (a pose sync) during the crouch.
  assert.equal(brain.syncs.length, 1);
  assert.deepEqual([brain.syncs[0].x, brain.syncs[0].z], [plan.to.x, plan.to.z]);
  await flush();
  assert.equal(actor.director.acceptance, 'accepted');
  assert.equal(brain.running, false);
  framesUntil(() => actor.director.phase === 'flight');
  assert.ok(Math.abs(actor.director.stateTime - B.leap.windup) < 2 * DT, 'take-off when the crouch ends');
  // Mid-flight: off the ground, part way there, and high enough that Lola can run under it.
  frames(B.leap.flight / 2);
  assert.ok(simulation.state.jumpHeight > B.leap.clearHeight, `airborne (${simulation.state.jumpHeight.toFixed(2)})`);
  assert.ok(simulation.state.position.z > 1 && simulation.state.position.z < plan.to.z - 1);
  assert.equal(actor.contactPoses(), null);
  frames(B.leap.flight / 2 + 0.05);
  // Landed: on the spot, a shockwave hit Lola, and the brain looked again from there.
  assert.equal(actor.director.phase, 'recover');
  assert.ok(Math.abs(simulation.state.position.z - plan.to.z) < 1e-6 && simulation.state.grounded);
  assert.equal(vitals.health, 100 - B.leap.shockwave.damage);
  assert.ok(heard.some(([name, p]) => name === LEAPER_EVENTS.attack && p.phase === 'land' && p.hit));
  assert.equal(brain.syncs.length, 2, 'a second sync at the landing refreshes what the brain sees');
  // (Lola ducks out of the eye's line of fire, so it walks on instead of holding to shoot.)
  combat.lolaVisible = false;
  frames(B.leap.recovery + 0.1);
  assert.equal(actor.director.state, 'chase');
  assert.equal(brain.running, true, 'the brain walks on from the landing spot');
  frames(0.5);
  assert.ok(Math.abs(simulation.state.position.z - plan.to.z) < 1e-6, 'and the Leaper never slides back to where it took off');
});

test('leap: a landing the brain refuses is called off before take-off; the Leaper never moves', async () => {
  const { actor, frames, framesUntil, simulation, heard } = setup({ aware: true, lola: { x: 0, z: 15 }, refuseSync: true });
  framesUntil(() => actor.director.state === 'leap');
  await flush();
  frames(0.1);
  assert.equal(actor.director.state, 'chase');
  assert.equal(heard.find(([name, p]) => name === LEAPER_EVENTS.attack && p.phase === 'cancel')[1].reason, 'landing refused');
  assert.ok(Math.hypot(simulation.state.position.x, simulation.state.position.z) < 1e-6);
});

test('stagger: a joint break interrupts the eye, pauses the brain and rocks the body back', () => {
  const { actor, brain, frames, log } = setup({ aware: true });
  frames(0.2);
  actor.legBroken({ position: new THREE.Vector3(), lost: 1, leg: {}, joint: 'upper' });
  frames(0.05);
  assert.equal(actor.director.state, 'stagger');
  assert.ok(log.some(([what, wait]) => what === 'tree interrupt' && wait === B.stagger.attackRecovery));
  assert.equal(brain.running, false);
  frames(0.15);
  assert.ok(actor.posture.pitch < -0.05, `recoil (${actor.posture.pitch.toFixed(3)})`);
  frames(B.stagger.time);
  assert.equal(actor.director.state, 'chase');
});

test('downed: four legs lost sink the body to the floor; it still fires and takes extra damage, then gets up', () => {
  const { actor, brain, frames, combat, simulation, rig } = setup({ aware: true });
  frames(0.2);
  for (let i = 0; i < 4; i += 1) rig.legs[i].disabled = true;
  rig.damagedLegCount = 4;
  actor.legBroken({ position: new THREE.Vector3(), lost: 4 });
  frames(B.downed.sinkTime + 0.5);
  assert.equal(actor.director.state, 'downed');
  const resting = (simulation.world.floorHeight ?? 0) + STANDING_HEIGHT - actor.posture.lower;
  assert.ok(Math.abs(resting - B.downed.restHeight) < 0.1, `body near the floor (${resting.toFixed(2)})`);
  assert.equal(brain.running, false, 'mobility 0');
  assert.equal(combat.hold, null, 'the eye keeps firing');
  assert.equal(combat.damageScale, B.downed.damageTakenScale);
  assert.ok(simulation.state.posture.planted, 'the feet stay planted');
  frames(B.downed.recoverTime + B.downed.getUpTime);
  assert.equal(actor.director.state, 'chase');
  assert.equal(combat.damageScale, 1);
  frames(0.5);
  assert.ok(actor.posture.lower < 0.1, 'standing again');
});

test('a fall or the collapse starts where the body already is: it never springs back up first', () => {
  const { actor, frames, combat, rig } = setup({ aware: true });
  const height = () => STANDING_HEIGHT - actor.posture.lower;
  // Track the highest the body gets from now on.
  const peakDuring = (seconds) => {
    let peak = height();
    frames(seconds, () => { peak = Math.max(peak, height()); });
    return Math.max(peak, height());
  };
  frames(0.2);
  for (let i = 0; i < 4; i += 1) rig.legs[i].disabled = true;
  rig.damagedLegCount = 4;
  actor.legBroken({ position: new THREE.Vector3(), lost: 4 });
  frames(B.downed.sinkTime + B.downed.recoverTime + B.downed.getUpTime * 0.5);
  assert.equal(actor.director.phase, 'rising');
  // 1. A leg lost half way up: it falls back from there.
  const halfUp = height();
  rig.legs[4].disabled = true;
  rig.damagedLegCount = 5;
  actor.legBroken({ position: new THREE.Vector3(), lost: 5 });
  const fallPeak = peakDuring(B.downed.sinkTime + 0.3);
  assert.equal(actor.director.phase, 'down');
  assert.ok(fallPeak <= halfUp + 0.02, `falls back from half way up (${halfUp.toFixed(2)}, peak ${fallPeak.toFixed(2)})`);
  // 2. Destroyed while down: the collapse goes on from the floor.
  const down = height();
  combat.leaperHealth = 0;
  const collapsePeak = peakDuring(B.dying.time + 0.5);
  assert.equal(actor.director.state, 'dead');
  assert.ok(collapsePeak <= down + 0.02, `stays on the floor while it collapses (${down.toFixed(2)}, peak ${collapsePeak.toFixed(2)})`);
  assert.ok(Math.abs(height() - B.dying.restHeight) < 0.1, `the wreck rests at ${height().toFixed(2)}`);
});

test('death: the body collapses to the floor, the lights fade, and the wreck only blocks Lola at its hull', () => {
  const { actor, brain, frames, combat, simulation, heard, player } = setup({ aware: true });
  frames(0.2);
  combat.leaperHealth = 0;
  frames(0.05);
  assert.equal(actor.director.state, 'dying');
  assert.equal(brain.running, false);
  assert.ok(heard.some(([name]) => name === LEAPER_EVENTS.died));
  frames(B.dying.time + 0.5);
  assert.equal(actor.director.state, 'dead');
  const resting = STANDING_HEIGHT - actor.posture.lower;
  assert.ok(Math.abs(resting - B.dying.restHeight) < 0.1, `on the floor (${resting.toFixed(2)})`);
  assert.equal(combat.dyingGlow, 0, 'eye light out');
  // Lola can walk right up to the wreck, between its splayed legs.
  const poses = actor.contactPoses();
  assert.deepEqual(poses.disabledLegs, [0, 1, 2, 3, 4, 5]);
  const foot = { x: Math.sin(0.62) * 3.24, z: Math.cos(0.62) * 3.24 };
  player.mesh.position.set(foot.x * 2, 0, foot.z * 2);
  assert.equal(leaperBlocksMove(foot.x, foot.z, player.mesh.position, poses, 1.45), false, 'where a foot stood');
  assert.equal(leaperBlocksMove(0, 1, player.mesh.position, poses, 1.45), true, 'but not through the hull');
  simulation.state.position.set(0, 0, 0);
});

test('reset(): dormant, standing, normal damage and lights', () => {
  const { actor, frames, combat, rig } = setup({ aware: true });
  frames(0.2);
  combat.leaperHealth = 0;
  frames(B.dying.time + 0.2);
  combat.leaperHealth = COMBAT.leaperHealth;
  actor.reset();
  assert.equal(actor.director.state, 'dormant');
  assert.equal(actor.posture.lower, 0);
  assert.equal(combat.dyingGlow, undefined);
  assert.equal(rig.materials.glowSoft.emissiveIntensity, 1);
});

test('legs lost on one side make the body lean that way (the side that lost them goes down)', () => {
  for (const [legs, sign] of [[[0, 2], 1], [[1, 3], -1], [[0, 1], 0]]) {
    const { actor, frames, rig, simulation } = setup();
    for (const i of legs) rig.legs[i].disabled = true;
    frames(1);
    const roll = actor.posture.roll;
    if (sign === 0) assert.ok(Math.abs(roll) < 1e-9, 'a front pair lost: no sideways lean');
    else assert.ok(Math.sign(roll) === sign && Math.abs(roll) <= B.crippled.maxLean + 1e-9, `legs ${legs}: roll ${roll.toFixed(3)}`);
    // Which side is lower: the hips of the lost legs.
    if (sign !== 0) {
      rig.robot.updateMatrixWorld(true);
      const hip = (i) => rig.robot.localToWorld(rig.legs[i].anchorLocal.clone()).y;
      const lost = legs.map(hip), kept = rig.legs.filter((l) => !l.disabled && Math.sign(l.out.x) !== Math.sign(rig.legs[legs[0]].out.x)).map((l) => hip(l.index));
      assert.ok(Math.max(...lost) < Math.min(...kept), 'the missing legs\' side sags');
    }
    assert.ok(simulation.state.posture.roll === actor.posture.roll);
  }
});
