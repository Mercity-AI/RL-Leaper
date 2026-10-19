// Pose sync: game logic moving the Leaper between brain moves (a leap).
//
// Parity: tests/fixtures/brain/sync-*.json were recorded on the real Python
//    BrainSession.sync (scripts/make_sync_fixture.py). Replayed through the
//    JavaScript port with the recorded actions, every move and every sync must
//    give bit-identical frames, inputs and search coverage, and the refused
//    sync must be refused with the server's wording and change nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JunkyardBrainSession, JunkyardBrainCore } from '../src/brain/junkyard/brainSession.js';
import { loadGlbTriangles } from '../src/brain/junkyard/junkyardSight.js';
import { createJunkyardWorld } from '../src/brain/junkyard/junkyardWorld.js';
import { decodeArray, frameDifferences } from '../src/brain/junkyard/fixtureReplay.js';

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
    [{ position: [24, 3] }, /intersects the junkyard/], [{ token: 'gone' }, /Session expired/]]) {
    await assert.rejects(core.sync({ ...body, ...bad }), message, JSON.stringify(bad));
  }
  assert.deepEqual(core.close({ token }), { closed: true });
  assert.deepEqual(core.close({ token }), { closed: false });
  await assert.rejects(core.sync(body), /Session expired/);
});
