// Pose sync: game logic moving the Leaper between brain moves (a leap).
//
// 1. Parity: tests/fixtures/brain/sync-*.json were recorded on the real Python
//    BrainSession.sync (scripts/make_sync_fixture.py). Replayed through the
//    JavaScript port with the recorded actions, every move and every sync must
//    give bit-identical frames, inputs and search coverage, and the refused
//    sync must be refused with the server's wording and change nothing.
// 2. The game side: JunkyardBrain.syncPose shows the new spot at once, waits
//    for a move in flight, reverts if the brain refuses, and works offline.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { JunkyardBrainSession, JunkyardBrainCore } from '../src/brain/junkyard/brainSession.js';
import { loadGlbTriangles } from '../src/brain/junkyard/junkyardSight.js';
import { createJunkyardWorld } from '../src/brain/junkyard/junkyardWorld.js';
import { decodeArray, frameDifferences } from '../src/brain/junkyard/fixtureReplay.js';
import { JunkyardBrain } from '../src/simulation/JunkyardBrain.js';
import { Encounter } from '../src/game/Encounter.js';
import { GameFlow } from '../src/core/GameFlow.js';
import { EventBus } from '../src/core/events.js';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root));
const json = (path) => JSON.parse(read(path));

const contact = json('src/config/player-contact.json');
const eyeVision = json('src/config/eye-vision.json');
const world = createJunkyardWorld({ width: 5.5, glbTriangles: loadGlbTriangles(read('assets/maps/junkyard/junkyard.glb')),
  collision: json('assets/maps/junkyard/collision.json') });

// A stand-in policy that answers with the recorded actions.
function replayPolicy(actions) {
  let k = 0;
  return {
    seen: null,
    async act(obs, memory) {
      this.seen = Float32Array.from(obs);
      const action = actions.subarray(k * 2, k * 2 + 2);
      k += 1;
      return { action, memory };
    },
  };
}

const sameBits = (a, b) => a.length === b.length && a.every((value, i) => Object.is(value, b[i]));

for (const name of ['sync-eye-5.5', 'sync-legacy-5.5']) {
  test(`${name}: moves and pose syncs match the Python server bit for bit`, async () => {
    const fixture = json(`tests/fixtures/brain/${name}.json`);
    const actions = decodeArray(fixture.arrays.action);
    const obsIn = decodeArray(fixture.arrays.obs_in);
    const obsAfter = decodeArray(fixture.arrays.obs_after);
    const policy = replayPolicy(actions);
    const { reset } = fixture;
    const session = new JunkyardBrainSession({ policy, world, contact, sightVersion: eyeVision.version,
      contactVersion: contact.version, position: reset.position, yaw: reset.yaw, target: reset.target,
      playerCollision: reset.player_collision, sightPose: reset.sight_mode === 'eye' ? reset.sight_pose : null });
    assert.ok(sameBits(session.obs, decodeArray(fixture.initial.obs)), 'reset inputs');
    let steps = 0, syncs = 0, refused = 0, outputs = 0;
    for (const [k, event] of fixture.events.entries()) {
      const { input } = event;
      if (event.type === 'refused') {
        const before = { position: [...session.env.position], yaw: session.env.yaw, obs: Float32Array.from(session.obs) };
        assert.throws(() => session.sync(input.position, input.yaw, input.target, input.sight_pose),
          (error) => error.message === event.error, `event ${k}: the server's wording`);
        assert.deepEqual([session.env.position, session.env.yaw], [before.position, before.yaw], `event ${k}: pose kept`);
        assert.ok(sameBits(session.obs, before.obs), `event ${k}: inputs kept`);
        refused += 1;
        continue;
      }
      const frame = event.type === 'step'
        ? await session.step(input.target, input.sight_pose)
        : session.sync(input.position, input.yaw, input.target, input.sight_pose);
      if (event.type === 'step') {
        assert.ok(sameBits(policy.seen, obsIn.subarray(steps * 34, steps * 34 + 34)), `event ${k}: the 34 inputs the policy saw`);
        steps += 1;
      } else {
        syncs += 1;
      }
      const { discrete, numbers } = frameDifferences(frame, event.frame);
      assert.deepEqual(discrete, [], `event ${k} (${event.type}): yes/no facts`);
      assert.equal(numbers.pose + numbers.distance + numbers.vision + numbers.action, 0, `event ${k} (${event.type}): exact numbers`);
      assert.ok(numbers.sight < 1e-9, `event ${k}: sight lines`);
      assert.ok(sameBits(session.obs, obsAfter.subarray(outputs * 34, outputs * 34 + 34)), `event ${k}: next inputs`);
      outputs += 1;
      assert.deepEqual(session.env.coverageNewCells, event.coverage_new, `event ${k}: coverage cells`);
      assert.equal(session.env.stepsSinceTargetSeen, event.state.steps_since_target_seen, `event ${k}: memory age`);
      assert.deepEqual(session.env.lastSeenTarget, event.state.last_seen_target, `event ${k}: last seen spot`);
    }
    assert.ok(steps >= 40 && syncs >= 1 && refused === 1, `${steps} moves, ${syncs} syncs, ${refused} refused`);
  });
}

test('a sync keeps the episode: step count, LSTM memory and last action survive; headings wrap', async () => {
  const fixture = json('tests/fixtures/brain/sync-eye-5.5.json');
  const sync = fixture.events.find((event) => event.type === 'sync' && event.input.yaw > Math.PI);
  assert.ok(sync, 'the recording has a heading beyond pi');
  assert.ok(sync.frame.yaw > -Math.PI && sync.frame.yaw < Math.PI);
  assert.ok(Math.abs(sync.frame.yaw - (sync.input.yaw - 2 * Math.PI)) < 1e-12);
  // In the JS core: the session survives the sync (same memory object, same step count).
  const memory = { h: new Float32Array(64), c: new Float32Array(64) };
  const policy = { async act() { return { action: new Float32Array([1, 0]), memory }; } };
  const session = new JunkyardBrainSession({ policy, world, contact, sightVersion: eyeVision.version,
    contactVersion: contact.version, ...fixture.reset, playerCollision: true, sightPose: fixture.reset.sight_pose });
  await session.step(fixture.reset.target, fixture.reset.sight_pose);
  const frame = session.sync(sync.input.position, sync.input.yaw, sync.input.target, sync.input.sight_pose);
  assert.equal(frame.step, 1);
  assert.equal(session.memory, memory);
  assert.deepEqual(session.env.previousAction, [1, 0]);
  assert.equal(frame.x, Math.fround(sync.input.position[0]));
});

test('the core checks sync requests like the server does', async () => {
  const fixture = json('tests/fixtures/brain/sync-eye-5.5.json');
  const core = new JunkyardBrainCore({ policy: replayPolicy(new Float32Array(200)), loadWorld: async () => world,
    contact, eyeVision, policySha256: 'test' });
  const { token } = await core.reset(fixture.reset);
  const body = { token, position: [2, -5], yaw: 0.5, target: fixture.reset.target, sight_pose: fixture.reset.sight_pose };
  assert.equal((await core.sync(body)).x, 2);
  for (const [bad, message] of [[{ yaw: null }, /Invalid robot heading/], [{ yaw: '0.3' }, /Invalid robot heading/],
    [{ yaw: true }, /Invalid robot heading/], [{ position: [0, 1e6] }, /finite map position/],
    [{ target: [0] }, /finite map position/], [{ sight_pose: { eye: [0, 1] } }, /eye vision pose/],
    [{ position: [29, 3] }, /intersects the junkyard/], [{ token: 'gone' }, /Session expired/]]) {
    await assert.rejects(core.sync({ ...body, ...bad }), message, JSON.stringify(bad));
  }
  assert.deepEqual(core.close({ token }), { closed: true });
  assert.deepEqual(core.close({ token }), { closed: false });
  await assert.rejects(core.sync(body), /Session expired/);
});

// --- The game side: JunkyardBrain.syncPose ------------------------------------------------

function playtest() {
  return {
    world: { width: 4 }, walking: true, message: {}, brainLabel: {},
    target: { mesh: { position: new THREE.Vector3(0, 0, 10) } },
    simulation: { state: { position: new THREE.Vector3(), yaw: 0 }, updateExternal() {} },
  };
}
const frame = { x: 0, z: 0, yaw: 0, step: 0, model_step: 7757824, policy_sha256: 'h', token: 't' };
const tick = () => new Promise((resolve) => setImmediate(resolve));

test('syncPose shows the new spot at once and tells the brain before its next move', async () => {
  globalThis.document = { hidden: false };
  const brain = new JunkyardBrain(playtest());
  const calls = [];
  brain.request = async (path, data) => {
    calls.push({ path, data });
    return path === 'sync' ? { ...frame, x: data.position[0], z: data.position[1], yaw: data.yaw, step: 3 } : frame;
  };
  await brain.reset();
  const synced = brain.syncPose({ x: 5, z: -2, yaw: 1 });
  // Lola's contact and the follow target move with the leap right away.
  assert.deepEqual([brain.contactPoses().to.x, brain.contactPoses().from.x], [5, 5]);
  const reply = await synced;
  assert.deepEqual(calls.map((c) => c.path), ['reset', 'sync']);
  assert.deepEqual(calls[1].data.position, [5, -2]);
  assert.equal(calls[1].data.token, 't');
  assert.deepEqual(calls[1].data.target, [0, 10], 'Lola is sent so the brain looks from the new spot');
  assert.equal(reply.step, 3);
  assert.equal(brain.frame, reply);
});

test('a sync asked for during a move goes right after it, and wins over that move', async () => {
  globalThis.document = { hidden: false };
  const brain = new JunkyardBrain(playtest());
  const calls = [];
  let finishStep;
  brain.request = (path, data) => {
    calls.push(path);
    if (path === 'step') return new Promise((resolve) => { finishStep = resolve; });
    if (path === 'sync') return Promise.resolve({ ...frame, x: data.position[0], z: data.position[1], step: 1 });
    return Promise.resolve(frame);
  };
  await brain.reset();
  brain.start();
  brain.update(0.1);
  assert.deepEqual(calls, ['reset', 'step']);
  const synced = brain.syncPose({ x: 8, z: 1, yaw: 0 });
  assert.deepEqual(calls, ['reset', 'step'], 'one request at a time');
  finishStep({ ...frame, x: 0.375, step: 1 });
  const reply = await synced;
  assert.deepEqual(calls, ['reset', 'step', 'sync']);
  assert.equal(reply.x, 8);
  assert.equal(brain.frame.x, 8, 'the old-spot move is never shown');
});

test('a refused sync puts the Leaper back at the brain\'s pose; offline it just moves', async () => {
  globalThis.document = { hidden: false };
  const brain = new JunkyardBrain(playtest());
  brain.request = async (path) => {
    if (path === 'sync') throw new Error('Leaper pose intersects the junkyard; choose a clear spot');
    return { ...frame, x: 1 };
  };
  await brain.reset();
  await assert.rejects(brain.syncPose({ x: 29, z: 3, yaw: 0 }), /intersects the junkyard/);
  assert.equal(brain.frame.x, 1);
  assert.equal(brain.contactPoses().to.x, 1);
  // Turret mode: no brain session to tell; the planted Leaper moves.
  brain.request = async () => { throw new Error('Failed to fetch'); };
  await brain.reset();
  assert.equal(brain.offline, true);
  const moved = await brain.syncPose({ x: 6, z: 6, yaw: 2 });
  assert.deepEqual([moved.x, moved.z, moved.yaw], [6, 6, 2]);
  assert.equal(brain.contactPoses().to.z, 6);
});

test('a sync queued while the brain loads is sent once it is ready; dispose rejects a waiting sync', async () => {
  globalThis.document = { hidden: false };
  const brain = new JunkyardBrain(playtest());
  const calls = [];
  let finishReset;
  brain.request = (path, data) => {
    calls.push(path);
    if (path === 'reset') return new Promise((resolve) => { finishReset = resolve; });
    return Promise.resolve({ ...frame, x: data.position[0] });
  };
  const resetting = brain.reset();
  const synced = brain.syncPose({ x: 3, z: 0, yaw: 0 });
  finishReset(frame);
  await resetting;
  assert.equal((await synced).x, 3);
  assert.deepEqual(calls, ['reset', 'sync']);
  // A sync still waiting when the game shuts the brain down is rejected, not left hanging.
  let finishStep;
  brain.request = (path) => (path === 'step' ? new Promise((resolve) => { finishStep = resolve; }) : Promise.resolve(frame));
  brain.start();
  brain.update(0.1);
  const waiting = brain.syncPose({ x: 9, z: 0, yaw: 0 });
  brain.dispose();
  await assert.rejects(waiting, /shut down/);
  finishStep(frame);
  await tick();
});

test('RESET drops a sync still waiting: the new episode is never moved back to the old leap spot', async () => {
  globalThis.document = { hidden: false };
  const p = playtest();
  const brain = new JunkyardBrain(p);
  const calls = [];
  let finishStep;
  let sessions = 0;
  brain.request = (path, data) => {
    calls.push(path);
    if (path === 'step') return new Promise((resolve) => { finishStep = resolve; });
    if (path === 'sync') return Promise.resolve({ ...frame, x: data.position[0], z: data.position[1] });
    return Promise.resolve({ ...frame, x: data.position[0], z: data.position[1], token: `s${++sessions}` });
  };
  await brain.reset();
  brain.start();
  brain.update(0.1);
  // A leap while a move is computing: the sync waits for that move...
  p.simulation.state.position.set(8, 0, 1);
  const synced = brain.syncPose({ x: 8, z: 1, yaw: 0 });
  // ...but RESET comes first: the encounter puts the Leaper at its spawn and starts a new episode.
  p.simulation.state.position.set(0, 0, 0);
  await brain.reset();
  await assert.rejects(synced, /restarted before the pose sync/);
  finishStep({ ...frame, x: 0.375, step: 1 });
  await tick();
  assert.deepEqual(calls, ['reset', 'step', 'reset'], 'the stale sync is never sent to the new session');
  assert.equal(brain.token, 's2');
  assert.deepEqual([brain.frame.x, brain.frame.z], [0, 0], 'the Leaper stays at the spawn');
  assert.equal(brain.contactPoses().to.x, 0);
  // A sync asked for after the RESET began is still sent once it is ready.
  let finishReset;
  brain.request = (path, data) => {
    calls.push(path);
    if (path === 'reset') return new Promise((resolve) => { finishReset = resolve; });
    return Promise.resolve({ ...frame, x: data.position[0], token: 's3' });
  };
  const resetting = brain.reset();
  const later = brain.syncPose({ x: 3, z: 0, yaw: 0 });
  finishReset({ ...frame, token: 's3' });
  await resetting;
  assert.equal((await later).x, 3);
  assert.deepEqual(calls.slice(-2), ['reset', 'sync']);
});

test('a sync waiting when the brain goes offline just moves the planted Leaper', async () => {
  globalThis.document = { hidden: false };
  const brain = new JunkyardBrain(playtest());
  let failReset;
  brain.request = () => new Promise((resolve, reject) => { failReset = reject; });
  const resetting = brain.reset();
  const synced = brain.syncPose({ x: 7, z: 1, yaw: 0.5 });
  failReset(new Error('Failed to fetch'));
  await resetting;
  assert.equal(brain.offline, true);
  const moved = await synced;
  assert.deepEqual([moved.x, moved.z, moved.yaw], [7, 1, 0.5], 'turret mode: the Leaper stands at the new spot');
  assert.equal(brain.contactPoses().to.x, 7);
});

// --- The fight's API for game logic: Encounter.teleportLeaper ------------------------------

function encounterWith(brain) {
  const events = new EventBus();
  const encounter = new Encounter({
    flow: new GameFlow({ events, initial: { name: 'ready' } }), events,
    world: { spawn: { x: 0, z: 0 }, scale: 1, floorHeight: 0 },
    player: { isPlayer: false, mesh: { position: new THREE.Vector3(0, 0, 10), rotation: { y: 0 } } },
    vitals: { dead: false, reset() {}, update() {} }, playerWeapon: { update() {} },
    playerController: { sample() {}, update() {} }, input: {}, cameraController: {},
  });
  const simulation = {
    state: { position: new THREE.Vector3(), previousVelocity: new THREE.Vector3(), velocity: new THREE.Vector3(),
      yaw: 0, jumpHeight: 0, verticalVelocity: 0, grounded: true },
    rig: { legs: [{ homeLocal: new THREE.Vector3(1, 0, 0), footPosition: new THREE.Vector3(), stepping: true }] },
  };
  return { encounter, enemy: encounter.addEnemy({ simulation, brain, combat: { leaperHealth: 600, reset() {} } }) };
}

test('Encounter.teleportLeaper stands the Leaper at the new pose and syncs its brain', async () => {
  globalThis.document = { hidden: false };
  const brain = new JunkyardBrain({ ...playtest(), simulation: { state: { position: new THREE.Vector3(), yaw: 0 } } });
  brain.request = async (path, data) => (path === 'sync'
    ? { ...frame, x: data.position[0], z: data.position[1], yaw: data.yaw, step: 4 } : frame);
  await brain.reset();
  const { encounter, enemy } = encounterWith(brain);
  const reply = await encounter.teleportLeaper(enemy, { x: 4, z: -3, yaw: 1.2 });
  assert.equal(reply.step, 4);
  assert.deepEqual([enemy.simulation.state.position.x, enemy.simulation.state.position.z, enemy.simulation.state.yaw], [4, -3, 1.2]);
  assert.deepEqual(enemy.simulation.rig.legs[0].stepping, false, 'standing, feet planted');
  // A refused spot: back to where the brain still has the Leaper.
  brain.request = async () => { throw new Error('Leaper pose intersects the junkyard; choose a clear spot'); };
  await assert.rejects(encounter.teleportLeaper(enemy, { x: 29, z: 3, yaw: 0 }), /intersects/);
  assert.deepEqual([enemy.simulation.state.position.x, enemy.simulation.state.position.z], [4, -3]);
});
