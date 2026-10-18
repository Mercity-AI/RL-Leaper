import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Encounter } from '../src/game/Encounter.js';
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
      lolaHealth: 100, leaperHealth: 600,
      update: (dt) => log.push([`${name}.combat`, dt]),
      reset() { this.lolaHealth = 100; this.leaperHealth = 600; },
      audio: { stopRobotSteps() {} },
    },
  };
}

function setup({ enemies = 1 } = {}) {
  const log = [];
  const events = new EventBus();
  const flow = new GameFlow({ events, initial: { name: 'ready' } });
  const player = { isPlayer: true, height: 2, mesh: { position: new THREE.Vector3(0, 0, 20), rotation: { y: 0 } },
    clearHitReaction() {}, resetJump() {} };
  const weapon = { resets: 0, update: (dt) => log.push(['weapon', dt]), reset() { this.resets += 1; } };
  const world = { spawn: { x: 0, z: 0 }, scale: 1, floorHeight: 0, collision: new WorldCollision(),
    navigation: { free: [1, 1], point: (i) => ({ x: 0, z: i ? 40 : 1 }) } };
  const camera = { yaw: 0.5, pitch: 0.16, target: new THREE.Vector3() };
  const encounter = new Encounter({
    flow, events, world, player, playerWeapon: weapon, input: { jumpBuffer: 0.1 }, cameraController: camera,
    playerController: {
      sample: (dt, { frozen }) => log.push(['sample', dt, frozen]),
      update: (dt) => log.push(['player', dt]),
    },
  });
  const list = Array.from({ length: enemies }, (_, i) => encounter.addEnemy(fakeEnemy(log, `leaper${i}`, i * 10, 0)));
  return { log, events, flow, player, weapon, world, camera, encounter, enemies: list };
}

test('the encounter updates Lola, then every brain, then every combat, then the gun', () => {
  const { log, flow, encounter } = setup({ enemies: 2 });
  flow.hunt();
  encounter.input(0.1);
  encounter.update(0.1);
  assert.deepEqual(log.map(([name]) => name),
    ['sample', 'player', 'leaper0.brain', 'leaper1.brain', 'leaper0.combat', 'leaper1.combat', 'weapon']);
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

test('brains run only while hunting; leaving play drops the gun, ending the fight does not', () => {
  const { flow, encounter, weapon, enemies: [leaper] } = setup();
  flow.hunt();
  assert.equal(leaper.brain.running, true);
  flow.explore();
  assert.equal(leaper.brain.running, false);
  assert.equal(weapon.resets, 1, 'switching from the run to exploring resets the gun, as STOP RUN did');
  flow.pause();
  assert.equal(weapon.resets, 2);
  flow.resume();
  flow.hunt();
  leaper.combat.leaperHealth = 0;
  assert.equal(encounter.end(), true);
  assert.equal(weapon.resets, 2, 'the kill shot keeps its effects');
  assert.equal(leaper.brain.running, false);
});

test('a win during the hunt is real, any other ending is practice, and results are kept', () => {
  const { events, flow, encounter, enemies: [leaper] } = setup();
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
    { winner: 'lola', practice: false, seconds: 2, damageTaken: 8, damageDealt: 6, jointsBroken: 1, assisted: false });
  assert.equal(encounter.end(), false, 'an encounter ends once');

  // Any ending while exploring is practice.
  encounter.restart();
  assert.equal(encounter.result, null, 'restart clears the result');
  flow.explore();
  leaper.combat.lolaHealth = 0;
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
  }
});

test('RESTART returns Lola, the camera and every Leaper to the start snapshot', () => {
  const { events, flow, player, camera, encounter, enemies } = setup({ enemies: 2 });
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
  enemies[0].combat.lolaHealth = 0;
  encounter.end();
  encounter.restart();
  assert.equal(flow.ready, true);
  assert.deepEqual([player.mesh.position.x, player.mesh.position.z, player.mesh.rotation.y], [0, 20, 1.2]);
  assert.deepEqual([camera.yaw, camera.pitch], [0.5, 0.16]);
  const [first, second] = enemies.map(({ simulation: { state } }) => [state.position.x, state.position.z, state.yaw]);
  assert.deepEqual(first, [0, 0, 0]);
  assert.deepEqual(second, [10, 0, -0.4]);
  assert.equal(enemies[0].combat.lolaHealth, 100, 'health restored');
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

test('toolbar labels follow the game state', () => {
  assert.deepEqual(toolbarLabels({ name: 'ready' }), { route: 'START RUN', player: 'START PLAYER' });
  assert.deepEqual(toolbarLabels({ name: 'playing', mode: 'hunt' }), { route: 'STOP RUN', player: 'START PLAYER' });
  assert.deepEqual(toolbarLabels({ name: 'playing', mode: 'explore' }), { route: 'START RUN', player: 'STOP PLAYER' });
  assert.deepEqual(toolbarLabels({ name: 'paused', resumeTo: { name: 'playing', mode: 'hunt' } }),
    { route: 'RESUME RUN', player: 'START PLAYER' });
  assert.deepEqual(toolbarLabels({ name: 'ended', winner: 'lola', practice: false }), { route: 'START RUN', player: 'START PLAYER' });
});
