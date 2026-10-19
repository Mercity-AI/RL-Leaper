// The exported brain file (public/brains/leaper_7757824/actor.onnx), run by
// onnxruntime-web's WebAssembly backend in Node, must give the checkpoint's
// actions and LSTM memory for every recorded junkyard step (limit 1e-5).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as ort from 'onnxruntime-web';
import { fixtureArrays } from '../src/brain/junkyard/fixtureReplay.js';
import { OnnxPolicy } from '../src/brain/junkyard/onnxPolicy.js';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root));
const json = (path) => JSON.parse(read(path));
ort.env.wasm.numThreads = 1;

const brain = json('public/brains/leaper_7757824/brain.json');
const index = json('tests/fixtures/brain/index.json');
const model = read('public/brains/leaper_7757824/actor.onnx');

test('brain.json identifies the approved checkpoint and this exact ONNX file', () => {
  assert.equal(brain.num_timesteps, 7757824);
  assert.equal(brain.obs_size, 34);
  assert.equal(brain.policy_sha256, '883dade3c7617d0fd85793c405ba8ccadd66c5e914c9032356ff7318351eb594');
  assert.equal(brain.policy_sha256, index.policy_sha256, 'fixtures were recorded with the same checkpoint');
  assert.equal(createHash('sha256').update(model).digest('hex'), brain.onnx.sha256);
  assert.deepEqual(brain.action.low, [-1, -1]);
  assert.deepEqual(brain.action.high, [1, 1]);
  assert.equal(brain.lstm.hidden_size, 64);
  assert.ok(brain.parity.junkyard_steps >= 1000 && brain.parity.onnx_action < 1e-5, 'export proved its own parity');
});

test('ONNX actions and memory match the checkpoint on every recorded step', async () => {
  const policy = await OnnxPolicy.create(ort, model);
  let steps = 0, worstAction = 0, worstMemory = 0;
  const started = performance.now();
  for (const { file } of Object.values(index.scenarios)) {
    const fixture = json(`tests/fixtures/brain/${file}`);
    if (fixture.scripted_actions) continue;
    const arrays = fixtureArrays(fixture);
    for (let k = 0; k < fixture.steps.length; k += 1) {
      // Feed exactly what Python fed: the inputs and the memory before step k.
      const memory = { h: arrays.h_in.subarray(k * 64, k * 64 + 64), c: arrays.c_in.subarray(k * 64, k * 64 + 64) };
      const { action, memory: next } = await policy.act(arrays.obs_in.subarray(k * 34, k * 34 + 34), memory, fixture.steps[k].episode_start);
      for (let i = 0; i < 2; i += 1) worstAction = Math.max(worstAction, Math.abs(action[i] - arrays.action[k * 2 + i]));
      const expectH = k + 1 < fixture.steps.length ? arrays.h_in.subarray((k + 1) * 64, (k + 2) * 64) : arrays.h_out;
      const expectC = k + 1 < fixture.steps.length ? arrays.c_in.subarray((k + 1) * 64, (k + 2) * 64) : arrays.c_out;
      for (let i = 0; i < 64; i += 1) {
        worstMemory = Math.max(worstMemory, Math.abs(next.h[i] - expectH[i]), Math.abs(next.c[i] - expectC[i]));
      }
      steps += 1;
    }
  }
  const ms = (performance.now() - started) / steps;
  console.log(`ONNX vs checkpoint over ${steps} recorded steps: max |action| ${worstAction.toExponential(2)}, `
    + `max |LSTM memory| ${worstMemory.toExponential(2)}, ${ms.toFixed(3)} ms per inference (wasm, Node)`);
  assert.ok(steps >= 1000);
  assert.ok(worstAction < 1e-5, `action ${worstAction}`);
  assert.ok(worstMemory < 1e-5, `memory ${worstMemory}`);
});

test('a fresh session starts from zero memory, exactly like episode_start=True', async () => {
  const policy = await OnnxPolicy.create(ort, model);
  const fixture = json(`tests/fixtures/brain/${index.scenarios['eye-5.5-hide-seek'].file}`);
  const arrays = fixtureArrays(fixture);
  const obs = arrays.obs_in.subarray(0, 34);
  const fromNull = await policy.act(obs, null, true);
  // Junk memory must be ignored on the first step (SB3 multiplies it by 0).
  const junk = { h: new Float32Array(64).fill(0.7), c: new Float32Array(64).fill(-0.4) };
  const fromJunk = await policy.act(obs, junk, true);
  assert.deepEqual(Array.from(fromJunk.action), Array.from(fromNull.action));
  assert.ok(Math.abs(fromNull.action[0] - arrays.action[0]) < 1e-5 && Math.abs(fromNull.action[1] - arrays.action[1]) < 1e-5);
});
