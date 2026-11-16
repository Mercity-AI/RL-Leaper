// The opt-in round-1 brain path (?brain=leaper_r1_<steps>, 38 inputs) against Python.
//
// Recordings in tests/fixtures/brain-r1 (scripts/make_round1_fixtures.py):
// 1. round1-inputs-5.5.json: I1 / I2 straight from the TRAINING code (rl/round1_env.py
//    Round1YardEnv yard rounds driven by the brain). The browser's pure functions
//    (src/brain/junkyard/round1Inputs.js) must reproduce every number bit for bit.
// 2. r1-*.json: the game's request protocol through rl/round1_session.py (the Python oracle
//    for when I1 updates in a session). Teacher-forced and free-run like the 34-input
//    recordings: all 38 inputs, the pose and every yes/no fact must match exactly; the ONNX
//    free run reports how long it stays in lockstep.
// Today's brain is untouched: its tests (brain-parity, brain-onnx, ...) cover that path.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as ort from 'onnxruntime-web';
import { loadGlbTriangles } from '../src/brain/junkyard/junkyardSight.js';
import { createJunkyardWorld } from '../src/brain/junkyard/junkyardWorld.js';
import { fixtureArrays, frameDifferences, freeRun, teacherForced } from '../src/brain/junkyard/fixtureReplay.js';
import { OnnxPolicy } from '../src/brain/junkyard/onnxPolicy.js';
import { motionNoteUpdate, notThere, round1Constants } from '../src/brain/junkyard/round1Inputs.js';
import { JunkyardBrainSession } from '../src/brain/junkyard/brainSession.js';
import { brainSpec, createBrainHost } from '../src/brain/junkyard/brainHost.js';
import { OnnxBrainProvider, defaultBrainBaseUrl } from '../src/brain/junkyard/OnnxBrainProvider.js';
import { BrainProviderChain, brainChoice, brainProviderOrder, optInBrainFolder } from '../src/brain/BrainProvider.js';
import { JunkyardBrain, createGameBrainProvider } from '../src/simulation/JunkyardBrain.js';
import { FrozenJunkyardEnv } from '../src/brain/junkyard/frozenEnv.js';
import * as THREE from 'three';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root));
const json = (path) => JSON.parse(read(path));
ort.env.wasm.numThreads = 1;

const index = json('tests/fixtures/brain-r1/index.json');
const folder = index.brain_id;
const brain = json(`public/brains/${folder}/brain.json`);
const model = read(`public/brains/${folder}/actor.onnx`);
const eyeVision = json('src/config/eye-vision.json');
const config = { contact: json('src/config/player-contact.json'), eyeVision };
const collision = json('assets/maps/junkyard/collision.json');
const glbTriangles = loadGlbTriangles(read('assets/maps/junkyard/junkyard.glb'));
const world = createJunkyardWorld({ width: 5.5, glbTriangles, collision });
const fixtures = Object.values(index.scenarios).map(({ file }) => json(`tests/fixtures/brain-r1/${file}`));
const brainFixture = fixtures.find((f) => !f.scripted_actions);

test('brain.json: a 38-input round-1 brain, this exact ONNX file, today\'s raster copied unchanged', () => {
  assert.match(folder, /^leaper_r1_\d+$/);
  assert.equal(brain.id, folder);
  assert.equal(brain.obs_size, 38);
  assert.equal(brain.observation.length, 17, '14 lines for inputs 0-33, 3 for 34-37');
  assert.deepEqual(brain.onnx.inputs.obs, [1, 38]);
  assert.equal(createHash('sha256').update(model).digest('hex'), brain.onnx.sha256);
  assert.equal(brain.onnx.sha256, index.onnx_sha256, 'fixtures were recorded for this export');
  assert.equal(brain.num_timesteps, index.model_step);
  assert.notEqual(brain.num_timesteps, 7757824);
  const today = json('public/brains/leaper_7757824/brain.json');
  assert.deepEqual(brain.rasters, today.rasters);
  for (const { file } of Object.values(brain.rasters)) {
    assert.ok(read(`public/brains/${folder}/${file}`).equals(read(`public/brains/leaper_7757824/${file}`)), file);
  }
  assert.ok(brain.parity.yard_steps >= 1200 && brain.parity.onnx_action < 1e-5, 'export proved its own parity');
  assert.ok(brain.parity.not_there > 0 && brain.parity.note_changes > 0, 'its parity run exercised I1 and I2');
  // The browser's constants are the Python ones at width 5.5, and the eye is the game's eye offset.
  const constants = round1Constants(world.scale, brain.round1_inputs.eye_offset);
  assert.equal(constants.sprintStep, brain.round1_inputs.sprint_step_at_5_5);
  assert.deepEqual(constants.heights, brain.round1_inputs.body_heights_at_5_5);
  assert.deepEqual(brain.round1_inputs.eye_offset, eyeVision.eyeOffset);
  assert.equal(world.scale, brain.round1_inputs.map_to_brain_at_5_5);
  assert.deepEqual(brainSpec(brain, eyeVision), { obsSize: 38, modelStep: brain.num_timesteps, searchRange: 28,
    eye: eyeVision.eyeOffset });
  assert.equal(brainSpec(today, eyeVision), null, 'today\'s brain keeps the unchanged 34-input path');
});

test('I1 and I2 from the training code (Round1YardEnv) are reproduced bit for bit', () => {
  const data = json(`tests/fixtures/brain-r1/${index.round1_inputs.file}`);
  const constants = round1Constants(world.scale, brain.round1_inputs.eye_offset);
  let records = 0, empty = 0, changes = 0;
  const problems = [];
  const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
  for (const { seed, records: list } of data.rounds) {
    const first = list[0];
    let note = [0, 0, 0];
    let previous = first.target_visible ? first.target.slice() : null;
    for (let k = 0; k < list.length; k += 1) {
      const r = list[k];
      if (k > 0) {
        const before = note;
        ({ note, previous } = motionNoteUpdate(note, previous, r.target, r.target_visible, constants.sprintStep));
        if (!same(note, before)) changes += 1;
      }
      if (!same(note, r.motion_note) || !same(note, r.obs_note)) problems.push(`${seed}/${k}: note js ${note} vs py ${r.motion_note}`);
      if ((previous === null) !== (r.previous_seen_target === null) || (previous && !same(previous, r.previous_seen_target))) {
        problems.push(`${seed}/${k}: previous sighting js ${previous} vs py ${r.previous_seen_target}`);
      }
      const value = notThere({ targetEverSeen: r.target_ever_seen, targetVisible: r.target_visible,
        lastSeenTarget: r.last_seen_target, target: r.target, position: r.position, yaw: r.yaw },
      world.sight, data.sight_range, constants);
      if (value !== r.not_there) problems.push(`${seed}/${k}: not there js ${value} vs py ${r.not_there}`);
      records += 1;
      empty += r.not_there;
    }
  }
  console.log(`training-code inputs: ${records} records (${data.rounds.length} yard rounds), I2=1 on ${empty}, `
    + `I1 changed ${changes} times, ${problems.length} differences`);
  assert.deepEqual(problems.slice(0, 10), []);
  assert.ok(empty > 0 && changes > 0, 'the recording exercises both inputs');
});

test('session recordings, teacher-forced: all 38 inputs, the next pose and every yes/no fact match exactly', async () => {
  for (const fixture of fixtures) {
    const summary = index.scenarios[fixture.name].summary;
    const report = await teacherForced(fixture, world, config);
    console.log(`${fixture.name}: ${report.steps} steps (I2=1 on ${summary.not_there}, I1 changed ${summary.note_changes}), `
      + `${report.senses} sense probes, obs max ${report.obsIn}/${report.obsOut}, pose max ${report.pose}, flips ${report.flips}, `
      + `per-input max ${Math.max(...report.inputMax)}`);
    assert.deepEqual(report.problems, [], fixture.name);
    assert.equal(report.obsIn, 0, `${fixture.name}: the 38 inputs handed to the network are bit-identical`);
    assert.equal(report.obsOut, 0, `${fixture.name}: the observation after each step is bit-identical`);
    assert.equal(report.pose, 0);
    assert.equal(report.flips, 0);
    assert.equal(report.stateDiffs, 0, 'env memory and the I1 memory');
    assert.equal(report.coverageDiffs, 0, 'coverage cells (search sweep at 28 units)');
    assert.equal(report.vision, 0);
    assert.ok(report.distance < 1e-12 && report.sight < 1e-9);
  }
  const total = (key) => fixtures.reduce((sum, f) => sum + index.scenarios[f.name].summary[key], 0);
  assert.ok(total('not_there') > 0 && total('note_changes') > 0 && total('hidden_with_memory') > 0);
});

test('session recordings, free run with the recorded actions: bit-identical for every step', async () => {
  for (const fixture of fixtures) {
    const report = await freeRun(fixture, world, config);
    console.log(`${fixture.name}: recorded-action free run in lockstep ${report.lockstep}/${report.steps}, `
      + `max input diff ${report.obsIn}, per input ${report.inputMax.map((v) => (v ? v.toExponential(1) : '0')).join(' ')}`);
    assert.deepEqual(report.problems, [], fixture.name);
    assert.equal(report.lockstep, fixture.steps.length);
    assert.equal(report.obsIn, 0);
    assert.equal(report.obsOut, 0);
  }
});

test('ONNX (wasm) gives the checkpoint\'s actions and memory on every recorded session step', async () => {
  const policy = await OnnxPolicy.create(ort, model);
  const a = fixtureArrays(brainFixture);
  let worstAction = 0, worstMemory = 0;
  for (let k = 0; k < brainFixture.steps.length; k += 1) {
    const memory = { h: a.h_in.subarray(k * 64, k * 64 + 64), c: a.c_in.subarray(k * 64, k * 64 + 64) };
    const { action, memory: next } = await policy.act(a.obs_in.subarray(k * 38, k * 38 + 38), memory, brainFixture.steps[k].episode_start);
    for (let i = 0; i < 2; i += 1) worstAction = Math.max(worstAction, Math.abs(action[i] - a.action[k * 2 + i]));
    for (let i = 0; i < 64; i += 1) {
      worstMemory = Math.max(worstMemory, Math.abs(next.h[i] - a.h_out[k * 64 + i]), Math.abs(next.c[i] - a.c_out[k * 64 + i]));
    }
  }
  console.log(`r1 ONNX vs checkpoint over ${brainFixture.steps.length} session steps: max |action| ${worstAction.toExponential(2)}, `
    + `max |h, c| ${worstMemory.toExponential(2)}`);
  assert.ok(worstAction < 1e-5 && worstMemory < 1e-5);
});

test('free run with the r1 ONNX brain: reports how long it stays in lockstep', async () => {
  const policy = await OnnxPolicy.create(ort, model);
  const report = await freeRun(brainFixture, world, config, policy, { pose: 1e-3, obs: 1e-2 });
  const worst = report.inputMax.map((v, i) => [i, v]).filter(([, v]) => v > 0).map(([i, v]) => `${i}:${v.toExponential(1)}`);
  console.log(`${brainFixture.name}: ONNX free run in lockstep (pose < 1e-3) for ${report.lockstep}/${report.steps} steps; `
    + `identical collisions/sightings/memory for ${report.untilFlip} steps; largest action gap while in lockstep `
    + `${report.maxAction.toExponential(1)}; input diffs while in lockstep ${worst.join(' ') || 'none'}; first problems: ${report.problems.slice(0, 3).join(' | ')}`);
  // Same floors as today's brain (tests/brain-parity.test.js): rounding-only drift takes long to matter.
  assert.ok(report.lockstep >= Math.min(100, report.steps), `lockstep ${report.lockstep}`);
  assert.ok(report.untilFlip >= Math.min(150, report.steps), `first flip at ${report.untilFlip}`);
});

test('sense and sync never update I1; sync keeps inputs 31-37; legacy sight is refused', async () => {
  const actions = fixtureArrays(brainFixture).action;
  let index = 0;
  const policy = { act: async (obs, memory) => ({ action: actions.subarray(index * 2, index++ * 2 + 2), memory }) };
  const reset = brainFixture.reset;
  const make = (sightPose = reset.sight_pose) => new JunkyardBrainSession({ policy, world, contact: config.contact,
    sightVersion: eyeVision.version, contactVersion: config.contact.version, position: reset.position, yaw: reset.yaw,
    target: reset.target, playerCollision: true, sightPose, sightRange: reset.sight_range, brain: brainFixture.brain });
  const session = make();
  for (let k = 0; k < 120; k += 1) await session.step(brainFixture.steps[k].input.target, brainFixture.steps[k].input.sight_pose);
  const note = [...session.round1.note], obs = Float32Array.from(session.obs);
  const probe = brainFixture.steps[200].input;
  session.sense(probe.target, probe.sight_pose);
  assert.deepEqual(session.round1.note, note);
  assert.deepEqual(session.obs, obs);
  const frame = session.sync([session.env.position[0], session.env.position[1]], session.env.yaw + 0.5,
    probe.target, probe.sight_pose);
  assert.equal(frame.model_step, brain.num_timesteps);
  assert.deepEqual(session.round1.note, note, 'a sync is no sighting');
  assert.deepEqual(session.obs.subarray(31), obs.subarray(31), 'inputs 31-37 kept by a sync');
  assert.equal(session.obs.length, 38);
  assert.throws(() => make(null), /needs eye-level sight/);
});

test('?brain=leaper_r1_<steps> opts in (in-browser only); today\'s brain stays the default', () => {
  assert.equal(optInBrainFolder(`?brain=${folder}`), folder);
  assert.deepEqual(brainProviderOrder(`?brain=${folder}`), ['onnx'], 'never the Python server, which only has today\'s brain');
  assert.equal(brainChoice(`?brain=${folder}`), 'onnx');
  for (const search of ['', '?brain=auto', '?brain=onnx', '?brain=leaper_7757824', '?brain=leaper_r1_../x',
    '?brain=leaper_r1_', '?brain=LEAPER_R1_1']) assert.equal(optInBrainFolder(search), null, search);
  assert.deepEqual(brainProviderOrder(''), ['onnx', 'http']);
  assert.ok(defaultBrainBaseUrl().endsWith('/brains/leaper_7757824/'));
  assert.ok(defaultBrainBaseUrl(folder).endsWith(`/brains/${folder}/`));
});

// A stand-in Worker running the real worker code (brainHost.js) on the repository's files.
const served = (url) => {
  const { pathname } = new URL(url);
  if (pathname.startsWith('/brains/')) return read(`public${pathname}`);
  if (pathname.startsWith('/assets/')) return read(pathname.slice(1));
  throw new Error(`404 ${url}`);
};
const createWorker = () => {
  const worker = { onmessage: null, onerror: null, terminated: false,
    postMessage(message) { setTimeout(() => host.handle(structuredClone(message)), 0); },
    terminate() { this.terminated = true; } };
  const host = createBrainHost({ ort, glbUrl: 'http://brain.test/assets/maps/junkyard/junkyard.glb',
    collisionUrl: 'http://brain.test/assets/maps/junkyard/collision.json', fetchBytes: async (url) => new Uint8Array(served(url)),
    post: (message) => { if (!worker.terminated) worker.onmessage?.({ data: structuredClone(message) }); } });
  return worker;
};

test('the worker code loads the r1 folder and answers like the recording', async () => {
  const provider = new OnnxBrainProvider({ baseUrl: `http://brain.test/brains/${folder}/`, createWorker });
  const manifest = await provider.load();
  assert.equal(manifest.obs_size, 38);
  const frame = await provider.reset(brainFixture.reset);
  assert.equal(frame.model_step, brain.num_timesteps);
  assert.equal(frame.policy_sha256, brain.policy_sha256);
  assert.deepEqual(Object.keys(frame).sort(), [...Object.keys(brainFixture.initial.frame), 'token', 'policy_sha256'].sort());
  assert.deepEqual(frameDifferences(frame, brainFixture.initial.frame).discrete, []);
  for (let k = 0; k < 60; k += 1) {
    const next = await provider.step({ token: frame.token, ...brainFixture.steps[k].input });
    const { discrete, numbers } = frameDifferences(next, brainFixture.steps[k].frame);
    assert.deepEqual(discrete, [], `step ${k}`);
    assert.ok(numbers.pose < 1e-3, `step ${k} pose ${numbers.pose}`);
  }
  const legacy = { ...brainFixture.reset, sight_mode: 'legacy' };
  delete legacy.sight_pose;
  await assert.rejects(provider.reset(legacy), /needs eye-level sight/);
  provider.dispose();
});

test('the game (JunkyardBrain) plays ?brain=leaper_r1_<steps>; without it, today\'s brain as before', async () => {
  globalThis.document ??= { hidden: false };
  // createGameBrainProvider points the in-browser provider at the folder (no worker starts until load).
  const picked = createGameBrainProvider({ search: `?brain=${folder}` });
  assert.deepEqual(picked.candidates.map((c) => c.kind), ['onnx']);
  assert.ok(picked.candidates[0].create().baseUrl.endsWith(`/brains/${folder}/`));
  assert.ok(createGameBrainProvider({ search: '' }).candidates[0].create().baseUrl.endsWith('/brains/leaper_7757824/'));
  const { reset } = brainFixture;
  const play = async (brainFolder) => {
    const chain = new BrainProviderChain([{ kind: 'onnx',
      create: () => new OnnxBrainProvider({ baseUrl: `http://brain.test/brains/${brainFolder}/`, createWorker }) }]);
    const playtest = {
      world: { width: reset.width, scale: world.scale }, walking: true, message: {}, brainLabel: {},
      target: { mesh: { position: new THREE.Vector3(reset.target[0], 0, reset.target[1]) } },
      sight: { mode: 'eye', version: eyeVision.version, pose: () => reset.sight_pose, show() {} },
      simulation: { state: { position: new THREE.Vector3(reset.position[0], 0, reset.position[1]), yaw: reset.yaw }, updateExternal() {} },
    };
    const brain = new JunkyardBrain(playtest, { provider: chain });
    await brain.reset();
    const ready = { ready: brain.ready, offline: brain.offline, label: brain.describe().label, step: brain.frame.model_step };
    brain.start();
    for (let i = 0; i < 3; i += 1) {
      brain.update(0.1);
      while (brain.busy) await new Promise((resolve) => setTimeout(resolve, 2));
    }
    ready.moves = brain.frame.step;
    brain.dispose();
    return ready;
  };
  const r1 = await play(folder);
  assert.equal(r1.ready, true);
  assert.equal(r1.offline, false);
  assert.equal(r1.step, brain.num_timesteps);
  assert.match(r1.label, new RegExp(`^${brain.label} · ONNX · IN BROWSER · `));
  assert.equal(r1.moves, 3);
  const today = await play('leaper_7757824');
  assert.equal(today.ready, true);
  assert.equal(today.step, 7757824);
  assert.match(today.label, /^BRAIN 7,757,824 · ONNX · IN BROWSER · /);
  assert.equal(today.moves, 3);
});

test('search sweep: search_range 28 reproduces training\'s coverage cells; the game\'s 50 map units would not', () => {
  const data = json(`tests/fixtures/brain-r1/${index.round1_inputs.file}`);
  const replay = (searchRange) => {
    let steps = 0, differing = 0;
    for (const { records } of data.rounds) {
      const [first, ...rest] = records;
      const env = new FrozenJunkyardEnv({ raster: world.raster, contact: config.contact, position: first.position,
        yaw: first.yaw, target: first.target, sightRange: data.sight_range, searchRange });
      const cleared = [];
      env.coverageCleared.forEach((v, i) => { if (v) cleared.push(i); });
      if (cleared.join() !== first.coverage.join()) differing += 1;
      for (const r of rest) {
        env.position = [r.position[0], r.position[1]];
        env.yaw = r.yaw;
        env.updateCoverage();
        if (env.coverageNewCells.join() !== r.coverage.join()) differing += 1;
        steps += 1;
      }
    }
    return { steps, differing };
  };
  const trained = replay(brain.search_range);
  const game = replay(data.sight_range);
  console.log(`search sweep over ${trained.steps} training steps: ${trained.differing} steps differ at search_range `
    + `${brain.search_range}; ${game.differing} would differ at the game's ${data.sight_range.toFixed(2)}`);
  assert.equal(brain.search_range, 28);
  assert.equal(trained.differing, 0);
  assert.ok(game.differing > 0, 'the choice matters');
});
