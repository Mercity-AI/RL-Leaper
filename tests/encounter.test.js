import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Encounter, resultText } from '../src/game/Encounter.js';
import { GameFlow } from '../src/core/GameFlow.js';
import { EventBus, GAME_EVENTS } from '../src/core/events.js';
import { WorldCollision } from '../src/world/WorldCollision.js';
import { toolbarLabels } from '../src/game/JunkyardPanel.js';

// A Leaper made of recording stand-ins: animator state, brain client and combat.
function fakeEnemy(log, name, x = 0, z = 0) {
  return {
    simulation: {
      state: { position: new THREE.Vector3(x, 0, z), previousVelocity: new THREE.Vector3(), velocity: new THREE.Vector3(1, 0, 0),
        yaw: 0, jumpHeight: 0, verticalVelocity: 0, grounded: true },
      rig: { legs: [{ homeLocal: new THREE.Vector3(1, 0, 0), footPosition: new THREE.Vector3(), stepping: true }] },
    },
    brain: {
      running: false, resets: 0,
      update: (dt) => log.push([`${name}.brain`, dt]),
      start() { this.running = true; }, stop() { this.running = false; }, reset() { this.resets += 1; },
      contactPoses: () => ({ from: { x, z, yaw: 0 }, to: { x, z, yaw: 0 }, margin: 0 }),
    },
    combat: {
      leaperHealth: 600,
      update: (dt) => log.push([`${name}.combat`, dt]),
      reset() { this.leaperHealth = 600; },
    },
  };
}

function setup({ enemies = 1, behaviour = null } = {}) {
  const log = [];
  const events = new EventBus();
  const flow = new GameFlow({ events, initial: { name: 'ready' } });
  const player = { isPlayer: true, height: 2, mesh: { position: new THREE.Vector3(0, 0, 20), rotation: { y: 0 } },
    clearHitReaction() {}, resetJump() {} };
  const weapon = { cancels: 0, refills: 0, update: (dt) => log.push(['weapon', dt]),
    cancelActions() { this.cancels += 1; }, resetEncounter() { this.refills += 1; } };
  // Lola's health (PlayerVitals stand-in).
  const vitals = { health: 100, get dead() { return this.health <= 0; },
    reset() { this.health = 100; }, update: (dt) => log.push(['vitals', dt]) };
  const world = { spawn: { x: 0, z: 0 }, scale: 1, floorHeight: 0, collision: new WorldCollision(),
    navigation: { free: [1, 1], point: (i) => ({ x: 0, z: i ? 40 : 1 }) } };
  const camera = { yaw: 0.5, pitch: 0.16, target: new THREE.Vector3() };
  const encounter = new Encounter({
    flow, events, world, player, vitals, audio: { stopRobotSteps() {} },
    playerWeapon: weapon, input: { jumpBuffer: 0.1 }, cameraController: camera, leaperBehaviour: behaviour,
    playerController: {
      sample: (dt, { frozen }) => log.push(['sample', dt, frozen]),
      update: (dt) => log.push(['player', dt]),
    },
  });
  const list = Array.from({ length: enemies }, (_, i) => encounter.addEnemy(fakeEnemy(log, `leaper${i}`, i * 10, 0)));
  return { log, events, flow, player, vitals, weapon, world, camera, encounter, enemies: list };
}

test('the encounter updates Lola, then every brain, then every combat, her health panel, then the gun', () => {
  const { log, flow, encounter } = setup({ enemies: 2 });
  flow.hunt();
  encounter.input(0.1);
  encounter.update(0.1);
  assert.deepEqual(log.map(([name]) => name),
    ['sample', 'player', 'leaper0.brain', 'leaper1.brain', 'leaper0.combat', 'leaper1.combat', 'vitals', 'weapon']);
  assert.ok(log.every(([, dt]) => dt === 0.1));
});

test('pausing freezes gameplay time but not the frame', () => {
  const { log, flow, encounter } = setup();
  flow.hunt();
  flow.pause();
  encounter.input(0.1);
  encounter.update(0.1);
  assert.deepEqual(log[0], ['sample', 0.1, true], 'input is sampled as frozen');
  assert.ok(log.slice(1).every(([, dt]) => dt === 0), 'every gameplay system gets dt = 0');
  assert.equal(encounter.elapsed, 0);
  flow.resume();
  encounter.update(0.1);
  assert.equal(encounter.elapsed, 0.1);
});

test('brains run only while hunting; stopping drops the gun, pausing and ending the fight do not', () => {
  const { flow, encounter, weapon, enemies: [leaper] } = setup();
  flow.hunt();
  assert.equal(leaper.brain.running, true);
  flow.explore();
  assert.equal(leaper.brain.running, false);
  assert.equal(weapon.cancels, 1, 'switching from the run to exploring drops the gun, as STOP RUN did');
  flow.pause();
  assert.equal(weapon.cancels, 1, 'a pause leaves the gun to let go by itself (a reload resumes)');
  flow.resume();
  flow.stop();
  assert.equal(weapon.cancels, 2, 'STOP PLAYER drops the gun');
  flow.hunt();
  leaper.combat.leaperHealth = 0;
  assert.equal(encounter.end(), true);
  assert.equal(weapon.cancels, 2, 'the kill shot keeps its effects');
  assert.equal(leaper.brain.running, false);
  encounter.restart();
  assert.equal(weapon.refills, 1, 'a restart refills both magazines');
});

test('a win during the hunt is real, any other ending is practice, and results are kept', () => {
  const { events, flow, vitals, encounter, enemies: [leaper] } = setup();
  const ended = [];
  events.on(GAME_EVENTS.encounterEnded, (payload) => ended.push(payload));
  flow.hunt();
  encounter.update(2);
  events.emit(GAME_EVENTS.lolaDamaged, { amount: 8, health: 92 });
  events.emit(GAME_EVENTS.leaperDamaged, { amount: 6, health: 594 });
  events.emit(GAME_EVENTS.jointBroken, { health: 594 });
  assert.equal(encounter.end(), false, 'nobody is down yet');
  leaper.combat.leaperHealth = 0;
  encounter.end();
  assert.deepEqual(flow.state, { name: 'ended', winner: 'lola', practice: false });
  assert.deepEqual(ended[0].stats,
    { winner: 'lola', practice: false, seconds: 2, damageTaken: 8, damageDealt: 6, jointsBroken: 1, assisted: false,
      debugUsed: false, turret: false, text: 'LEAPER DEFEATED' });
  assert.equal(encounter.end(), false, 'an encounter ends once');

  // Any ending while exploring is practice.
  encounter.restart();
  assert.equal(encounter.result, null, 'restart clears the result');
  flow.explore();
  vitals.health = 0;
  encounter.end();
  assert.deepEqual(flow.state, { name: 'ended', winner: 'leaper', practice: true });

  // Free shots before START RUN, or the debug button, make the hunted kill practice too.
  for (const [label, prepare] of [
    ['free shots while stopped', () => events.emit(GAME_EVENTS.leaperDamaged, { amount: 500 })],
    ['debug button', () => { flow.hunt(); events.emit(GAME_EVENTS.leaperDamaged, { amount: 60, debug: true }); }],
  ]) {
    encounter.restart();
    prepare();
    flow.hunt();
    leaper.combat.leaperHealth = 0;
    encounter.end();
    assert.deepEqual(flow.state, { name: 'ended', winner: 'lola', practice: true }, label);
    assert.equal(encounter.result.text, label === 'debug button'
      ? 'PRACTICE · LEAPER DEFEATED · DEBUG TEST' : 'PRACTICE · LEAPER DEFEATED', label);
  }
});

test('the result banner says who won, and marks practice and debug results', () => {
  assert.equal(resultText({ winner: 'lola', practice: false }), 'LEAPER DEFEATED');
  assert.equal(resultText({ winner: 'lola', practice: true }), 'PRACTICE · LEAPER DEFEATED');
  assert.equal(resultText({ winner: 'lola', practice: true, debugUsed: true }), 'PRACTICE · LEAPER DEFEATED · DEBUG TEST');
  assert.equal(resultText({ winner: 'leaper', practice: false }), 'LOLA DEFEATED');
  assert.equal(resultText({ winner: 'lola', turret: true }), 'LEAPER DEFEATED · TURRET MODE');
});

test('a hunt with the brain offline still counts, but is marked TURRET MODE', () => {
  const { flow, encounter, enemies: [leaper] } = setup();
  flow.hunt();
  leaper.brain.offline = true;
  encounter.update(0.5);
  leaper.combat.leaperHealth = 0;
  encounter.end();
  assert.deepEqual(flow.state, { name: 'ended', winner: 'lola', practice: false });
  assert.equal(encounter.result.text, 'LEAPER DEFEATED · TURRET MODE');
});

test('RESTART returns Lola, the camera and every Leaper to the start snapshot', () => {
  const { events, flow, player, vitals, camera, encounter, enemies } = setup({ enemies: 2 });
  const started = [];
  events.on(GAME_EVENTS.encounterStarted, ({ snapshot }) => started.push(snapshot));
  player.mesh.rotation.y = 1.2;
  enemies[1].simulation.state.yaw = -0.4;
  flow.hunt();
  flow.pause();
  flow.resume();
  assert.equal(started.length, 1, 'resuming is the same fight');
  // The fight moves everyone around, then Lola dies.
  player.mesh.position.set(5, 0, 5);
  player.mesh.rotation.y = 0;
  camera.yaw = 3;
  enemies[0].simulation.state.position.set(7, 0, 7);
  enemies[0].simulation.state.yaw = 2;
  vitals.health = 0;
  encounter.end();
  encounter.restart();
  assert.equal(flow.ready, true);
  assert.deepEqual([player.mesh.position.x, player.mesh.position.z, player.mesh.rotation.y], [0, 20, 1.2]);
  assert.deepEqual([camera.yaw, camera.pitch], [0.5, 0.16]);
  const [first, second] = enemies.map(({ simulation: { state } }) => [state.position.x, state.position.z, state.yaw]);
  assert.deepEqual(first, [0, 0, 0]);
  assert.deepEqual(second, [10, 0, -0.4]);
  assert.equal(vitals.health, 100, 'health restored');
  assert.ok(enemies.every(({ brain }) => brain.resets === 1), 'fresh brain sessions');
  assert.equal(enemies[0].simulation.rig.legs[0].stepping, false, 'feet planted around the restored pose');
  flow.hunt();
  assert.equal(started.length, 2, 'the retry is a new encounter');
});

test('a RESTART RANDOM spawn pair wins over the snapshot, and Lola is kept out of reach', () => {
  const { flow, player, encounter, enemies: [leaper] } = setup();
  flow.hunt();
  encounter.restart({ position: { x: 3, z: 0 }, target: { x: 3, z: 2 }, yaw: 0.7 });
  assert.deepEqual([leaper.simulation.state.position.x, leaper.simulation.state.yaw], [3, 0.7]);
  // (3, 2) is inside the Leaper's reach, so Lola moves to the first clear cell far enough away.
  assert.deepEqual([player.mesh.position.x, player.mesh.position.z], [0, 40]);
});

test('each Leaper blocks Lola through the world collision service', () => {
  const { world, encounter } = setup({ enemies: 2 });
  assert.equal(world.collision.playerBlocked(0, 0.5), true, 'first Leaper body');
  assert.equal(world.collision.playerBlocked(10, 0.5), true, 'second Leaper body');
  assert.equal(world.collision.playerBlocked(5, 30), false);
  encounter.dispose();
  assert.equal(world.collision.playerBlocked(0, 0.5), false, 'dispose removes the blockers');
});

// A disposed fight must not keep reacting: a later session that reuses the same
// game state or event bus would otherwise start its brains or count its damage.
test('dispose unhooks the encounter from the game state and the event bus, and disposes its brains', () => {
  const { flow, events, encounter, enemies: [leaper] } = setup();
  let disposed = 0;
  leaper.brain.dispose = () => { disposed += 1; };
  encounter.dispose();
  assert.equal(disposed, 1, 'late brain replies are dropped');
  flow.hunt();
  assert.equal(leaper.brain.running, false, 'a later START RUN no longer starts this brain');
  assert.equal(encounter.started, false, 'nor takes a start snapshot');
  events.emit(GAME_EVENTS.lolaDamaged, { amount: 8 });
  events.emit(GAME_EVENTS.jointBroken, {});
  assert.equal(encounter.stats.damageTaken, 0);
  assert.equal(encounter.stats.jointsBroken, 0);
  encounter.dispose();
});

// With a behaviour layer (the game's LeaperActor), each Leaper's actor runs
// between its brain and its attacks, decides when its brain walks, gives Lola's
// collision its shape, and is reset, placed and disposed with the fight.
test('each Leaper\'s behaviour layer is built, updated, reset, placed and disposed with the encounter', () => {
  const made = [];
  const behaviour = (enemy, encounter) => {
    const actor = { enemy, encounter, calls: [],
      update(dt) { this.calls.push('update'); made.log.push([`${enemy.brain.name}.actor`, dt]); },
      reset() { this.calls.push('reset'); }, placed(pose) { this.calls.push(['placed', pose.x, pose.z]); },
      dispose() { this.calls.push('dispose'); },
      contactPoses: () => ({ from: { x: 0, z: 0, yaw: 0 }, to: { x: 0, z: 0, yaw: 0 }, margin: 0, disabledLegs: [0, 1, 2, 3, 4, 5] }) };
    made.push(actor);
    return actor;
  };
  const { log, flow, encounter, enemies: [leaper], world, player } = setup({ behaviour });
  made.log = log;
  leaper.brain.name = 'leaper0';
  assert.equal(made.length, 1);
  assert.equal(leaper.actor, made[0]);
  assert.equal(made[0].encounter, encounter, 'it gets the fight\'s flow, events, world, Lola and vitals');
  // START RUN: the actor decides when the brain walks, not the encounter.
  flow.hunt();
  assert.equal(leaper.brain.running, false);
  log.length = 0;
  encounter.update(0.1);
  assert.deepEqual(log.map(([name]) => name), ['player', 'leaper0.brain', 'leaper0.actor', 'leaper0.combat', 'vitals', 'weapon']);
  // Lola's collision uses the actor's shape (here only the hull and stumps).
  player.mesh.position.set(3, 0, 3);
  assert.equal(world.collision.playerBlocked(Math.sin(0.62) * 3.24, Math.cos(0.62) * 3.24), false, 'the actor\'s shape, not the brain\'s');
  // A restart resets the behaviour and places it at the start pose.
  encounter.restart();
  assert.ok(made[0].calls.includes('reset'));
  assert.ok(made[0].calls.some((call) => Array.isArray(call) && call[0] === 'placed'));
  encounter.dispose();
  assert.equal(made[0].calls.at(-1), 'dispose');
});

test('toolbar labels follow the game state', () => {
  assert.deepEqual(toolbarLabels({ name: 'ready' }), { route: 'START RUN', player: 'START PLAYER', disabled: false });
  assert.deepEqual(toolbarLabels({ name: 'playing', mode: 'hunt' }), { route: 'STOP RUN', player: 'START PLAYER', disabled: false });
  assert.deepEqual(toolbarLabels({ name: 'playing', mode: 'explore' }), { route: 'START RUN', player: 'STOP PLAYER', disabled: false });
  assert.deepEqual(toolbarLabels({ name: 'paused', resumeTo: { name: 'playing', mode: 'hunt' } }),
    { route: 'RESUME RUN', player: 'START PLAYER', disabled: false });
  // After an ending both start buttons are disabled until a restart (review 5.6).
  assert.deepEqual(toolbarLabels({ name: 'ended', winner: 'lola', practice: false }),
    { route: 'START RUN', player: 'START PLAYER', disabled: true });
});
