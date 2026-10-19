// Parity of the browser brain (src/brain/junkyard/) with the Python server.
//
// The recordings in tests/fixtures/brain were made by driving the real
// rl/junkyard_server.py BrainSession (scripts/make_junkyard_fixtures.py).
// 1. Teacher forcing: before every step the JS environment is set to Python's
//    exact state; the 34 inputs, the next pose, every yes/no fact (collision,
//    sight lines, memory) and the search-coverage cells must all match.
// 2. Free running with the recorded actions: the JS environment runs on its
//    own from the reset; it must stay bit-identical for the whole recording.
// 3. Free running with the ONNX brain: the network's ~1e-6 rounding
//    differences slowly nudge the pose, so this reports how long the two runs
//    stay in lockstep (a big drop would mean a port bug, not rounding).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as ort from 'onnxruntime-web';
import { loadGlbTriangles } from '../src/brain/junkyard/junkyardSight.js';
import { createJunkyardWorld } from '../src/brain/junkyard/junkyardWorld.js';
import { freeRun, teacherForced } from '../src/brain/junkyard/fixtureReplay.js';
import { OnnxPolicy } from '../src/brain/junkyard/onnxPolicy.js';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root));
const json = (path) => JSON.parse(read(path));
ort.env.wasm.numThreads = 1;

// --- Shared setup: the recordings and one world per Leaper size ----------------
const index = json('tests/fixtures/brain/index.json');
const config = { contact: json('src/config/player-contact.json'), eyeVision: json('src/config/eye-vision.json') };
const collision = json('assets/maps/junkyard/collision.json');
const glbTriangles = loadGlbTriangles(read('assets/maps/junkyard/junkyard.glb'));
const fixtures = Object.values(index.scenarios).map(({ file }) => json(`tests/fixtures/brain/${file}`));
const worlds = new Map();
const worldFor = (width) => {
  if (!worlds.has(width)) worlds.set(width, createJunkyardWorld({ width, glbTriangles, collision }));
  return worlds.get(width);
};

test('recordings cover every size, sight mode and situation the task needs', () => {
  const summaries = Object.values(index.scenarios);
  assert.deepEqual([...new Set(summaries.map((s) => s.width))].sort(), [2.9, 5.5, 7.98]);
  assert.ok(summaries.some((s) => s.sight_mode === 'legacy') && summaries.some((s) => s.sight_mode === 'eye'));
  const total = (key) => summaries.reduce((sum, s) => sum + (typeof s.summary[key] === 'number' ? s.summary[key] : 0), 0);
  const parts = summaries.flatMap((s) => Object.keys(s.summary.collisions));
  assert.ok(total('hidden_before_seen') > 0 && total('visible') > 0 && total('hidden_with_memory') > 0, 'hidden, seen, memory');
  assert.ok(total('reverse') > 0, 'signed reverse');
  assert.ok(total('partial_eye') > 0, 'eye checks that disagree across Lola\'s three bones');
  for (const part of ['player', 'leg-1', 'leg-2', 'leg-3']) assert.ok(parts.includes(part), `collision ${part}`);
  assert.ok(fixtures.some((f) => f.senses?.length), 'paused /sense previews');
});

test('teacher-forced: every recorded step matches the Python server exactly', async () => {
  for (const fixture of fixtures) {
    const report = await teacherForced(fixture, worldFor(fixture.world.width), config);
    console.log(`${fixture.name}: ${report.steps} steps, ${report.senses} sense probes, obs max ${report.obsIn}/${report.obsOut}, `
      + `pose max ${report.pose}, flips ${report.flips}, sight hit max ${report.sight.toExponential(1)}, ${report.msPerStep.toFixed(2)} ms/step`);
    assert.deepEqual(report.problems, [], fixture.name);
    assert.equal(report.obsIn, 0, `${fixture.name}: the 34 inputs handed to the network are bit-identical`);
    assert.equal(report.obsOut, 0, `${fixture.name}: the observation after each step is bit-identical`);
    assert.equal(report.pose, 0, `${fixture.name}: next pose is bit-identical`);
    assert.equal(report.flips, 0, `${fixture.name}: no collision/sight/memory flips`);
    assert.equal(report.stateDiffs, 0, `${fixture.name}: env memory`);
    assert.equal(report.coverageDiffs, 0, `${fixture.name}: coverage cells`);
    assert.equal(report.distance, 0, `${fixture.name}: distance`);
    assert.equal(report.vision, 0, `${fixture.name}: 16 rays`);
    assert.ok(report.sight < 1e-9, `${fixture.name}: sight hit points`);
  }
});

test('free run with the recorded actions stays bit-identical for every step', async () => {
  for (const fixture of fixtures) {
    const report = await freeRun(fixture, worldFor(fixture.world.width), config);
    assert.deepEqual(report.problems, [], fixture.name);
    assert.equal(report.lockstep, fixture.steps.length, `${fixture.name}: lockstep ${report.lockstep}/${fixture.steps.length}`);
    assert.equal(report.obsIn, 0, `${fixture.name}: inputs stay bit-identical`);
    assert.equal(report.obsOut, 0, `${fixture.name}: observations stay bit-identical`);
    assert.equal(report.pose + report.distance + report.vision, 0, `${fixture.name}: pose, distance and rays stay bit-identical`);
  }
});

test('free run with the ONNX brain: reports how long it stays in lockstep', async () => {
  const model = read('public/brains/leaper_7757824/actor.onnx');
  const tolerance = { pose: 1e-3, obs: 1e-2 };
  for (const fixture of fixtures.filter((f) => !f.scripted_actions)) {
    const policy = await OnnxPolicy.create(ort, model);
    const report = await freeRun(fixture, worldFor(fixture.world.width), config, policy, tolerance);
    console.log(`${fixture.name}: ONNX free run in lockstep (pose < 1e-3) for ${report.lockstep}/${report.steps} steps; `
      + `identical collisions/sightings/memory for ${report.untilFlip} steps; largest action gap while in lockstep ${report.maxAction.toExponential(1)}; `
      + `${report.msPerStep.toFixed(2)} ms/step with inference`);
    // Rounding-only drift takes well over 100 steps to matter; a port bug shows at once.
    assert.ok(report.lockstep >= Math.min(100, report.steps), `${fixture.name}: lockstep ${report.lockstep}`);
    assert.ok(report.untilFlip >= Math.min(150, report.steps), `${fixture.name}: first flip at ${report.untilFlip}`);
  }
});
