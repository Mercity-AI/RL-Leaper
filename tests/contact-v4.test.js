// Contact rules v4 (review fix 5.19): a severed Leaper leg stops blocking Lola.
// The same rule lives in three places that must agree: the page's blocker
// (src/world/playerContact.js), the in-browser brain's Lola contact
// (src/brain/junkyard/frozenEnv.js) and the Python server (rl/junkyard_env.py,
// checked bit for bit by the scripted-severed-legs-5.5 recording in
// tests/brain-parity.test.js). Only Lola's contact changes: the brain's own
// map-collision discs and everything it observes stay as trained.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import contact from '../src/config/player-contact.json' with { type: 'json' };
import { createLeaperBlocker, leaperBlocksMove, leaperClearance, leaperDiscs, severedLegs } from '../src/world/playerContact.js';
import { FrozenJunkyardEnv } from '../src/brain/junkyard/frozenEnv.js';
import { checkDisabledLegs } from '../src/brain/junkyard/brainSession.js';
import { JunkyardBrain } from '../src/simulation/JunkyardBrain.js';

const shape = contact.leaperShape;
const facingZ = { x: 0, z: 0, yaw: 0 };
// Where leg `index`'s disc number `point` sits for a Leaper at the origin facing +z.
const legPoint = (index, point, pose = facingZ) => {
  const angle = pose.yaw + shape.legAngles[index];
  const [distance] = shape.legPoints[point];
  return { x: pose.x + Math.sin(angle) * distance, z: pose.z + Math.cos(angle) * distance };
};

test('the contact rules are version 4 and a severed leg keeps only its stump disc', () => {
  assert.equal(contact.version, 4);
  assert.equal(shape.severedLegPoints, 1);
  assert.equal(leaperDiscs(facingZ).length, 1 + 6 * 3, 'body + three discs per intact leg');
  assert.equal(leaperDiscs(facingZ, [0, 3]).length, 1 + 4 * 3 + 2 * 1, 'two severed legs keep one disc each');
});

test('Lola can stand where a severed leg used to be; its stump and the other legs still block her', () => {
  for (const scale of [1, 1.45, 2.75]) {
    for (let index = 0; index < 6; index += 1) {
      const foot = legPoint(index, 2), knee = legPoint(index, 1), stump = legPoint(index, 0);
      assert.ok(leaperClearance(foot.x, foot.z, facingZ, scale) < 0, `intact leg ${index} foot blocks`);
      assert.ok(leaperClearance(foot.x, foot.z, facingZ, scale, [index]) >= 0, `severed leg ${index} foot is open`);
      // (At the largest maps Lola herself is wider, so the stump disc reaches the knee spot.)
      if (scale === 1) assert.ok(leaperClearance(knee.x * 1.02, knee.z * 1.02, facingZ, scale, [index]) >= 0,
        `severed leg ${index}: the middle of the leg is open too`);
      assert.ok(leaperClearance(stump.x, stump.z, facingZ, scale, [index]) < 0, `leg ${index} stump still blocks`);
      const other = legPoint((index + 1) % 6, 2);
      assert.ok(leaperClearance(other.x, other.z, facingZ, scale, [index]) < 0, 'the next leg is unaffected');
    }
  }
});

test('the page blocker follows the severed legs it is given, and a Leaper high in the air blocks nothing', () => {
  const foot = legPoint(0, 2);
  const outside = { x: foot.x * 2, z: foot.z * 2 };
  const poses = { from: facingZ, to: facingZ, margin: 0 };
  assert.equal(leaperBlocksMove(foot.x, foot.z, outside, poses, 1), true, 'an intact foot blocks walking in');
  assert.equal(leaperBlocksMove(foot.x, foot.z, outside, { ...poses, disabledLegs: [0] }, 1), false, 'a severed one does not');
  const player = { mesh: { position: new THREE.Vector3(outside.x, 0, outside.z) } };
  let current = poses;
  const blocker = createLeaperBlocker({ contactPoses: () => current }, player, { scale: 1 });
  assert.equal(blocker(0, 0), true, 'the body blocks');
  current = null;
  assert.equal(blocker(0, 0), false, 'no contact poses (mid-leap, above her head): nothing blocks');
});

test('the in-browser brain\'s Lola contact is the same rule as the page\'s', () => {
  // frozenEnv.playerClearance is the brain port's copy (its own float64 maths);
  // with the same legs severed it must give the page's clearance.
  const clearance = (target, pose, disabled, scale) => FrozenJunkyardEnv.prototype.playerClearance.call(
    { contact, raster: { scale }, target: [target.x, target.z], disabledLegs: new Set(disabled) }, pose.x, pose.z, pose.yaw);
  let random = 7;
  const next = () => ((random = (random * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 400; i += 1) {
    const pose = { x: next() * 10 - 5, z: next() * 10 - 5, yaw: next() * 8 - 4 };
    const target = { x: pose.x + next() * 12 - 6, z: pose.z + next() * 12 - 6 };
    const disabled = [0, 1, 2, 3, 4, 5].filter(() => next() < 0.4);
    const scale = 1 + next() * 2;
    assert.ok(Math.abs(clearance(target, pose, disabled, scale) - leaperClearance(target.x, target.z, pose, scale, disabled)) < 1e-9);
  }
});

test('the severed-legs recording shows the rule at work in the Python server', () => {
  // scripts/make_junkyard_fixtures.py: the Leaper sweeps its legs past Lola on
  // its left; legs 0, 2 and 4 (the left side) are shot off at step 80; Lola
  // moves to its right side at step 160.
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/brain/scripted-severed-legs-5.5.json', import.meta.url)));
  const blockedByLola = (from, to) => fixture.steps.slice(from, to).filter((s) => s.frame.collisionPart === 'player').length;
  assert.equal(fixture.contact_version, 4);
  assert.deepEqual(fixture.steps[100].input.disabled_legs, [0, 2, 4]);
  assert.ok(blockedByLola(0, 80) > 20, 'intact legs bump into Lola');
  // Once severed, the left legs sweep past her. (The few bumps left come from the
  // intact right legs swinging round to her side as it turns in the open.)
  assert.ok(blockedByLola(80, 160) * 4 < blockedByLola(0, 80), 'severed legs sweep past her');
  assert.ok(blockedByLola(160, 240) > 10, 'the intact right legs still bump into her');
});

test('severed legs travel with every brain request and are checked like the server checks them', async () => {
  // The brain core refuses what the Python server refuses.
  assert.deepEqual(checkDisabledLegs({}, 6), []);
  assert.deepEqual(checkDisabledLegs({ disabled_legs: [1, 4] }, 6), [1, 4]);
  for (const bad of [[6], [-1], [true], ['0'], 1, [0.5], [0, 1, 2, 3, 4, 5, 0]]) {
    assert.throws(() => checkDisabledLegs({ disabled_legs: bad }, 6), /Invalid disabled legs/, JSON.stringify(bad));
  }
  // The game sends the rig's severed legs on /reset, /step and /sync.
  globalThis.document = { hidden: false };
  const legs = Array.from({ length: 6 }, (_, index) => ({ index, disabled: index === 2 || index === 5 }));
  assert.deepEqual(severedLegs({ legs }), [2, 5]);
  const playtest = { world: { width: 5.5 }, walking: true, message: {}, brainLabel: {},
    target: { mesh: { position: new THREE.Vector3(0, 0, 10) } },
    simulation: { rig: { legs }, state: { position: new THREE.Vector3(), yaw: 0 }, updateExternal() {} } };
  const brain = new JunkyardBrain(playtest);
  const sent = [];
  const frame = { x: 0, z: 0, yaw: 0, step: 0, model_step: 7757824, policy_sha256: 'h', token: 't' };
  brain.request = async (path, data) => { sent.push([path, data.disabled_legs]); return frame; };
  await brain.reset();
  await brain.syncPose({ x: 1, z: 0, yaw: 0 });
  brain.start();
  brain.update(0.2);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(sent, [['reset', [2, 5]], ['sync', [2, 5]], ['step', [2, 5]]]);
  assert.deepEqual(brain.contactPoses().disabledLegs, [2, 5], 'and the page blocker gets them too');
});
