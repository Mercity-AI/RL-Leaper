// Opt-in: the real Python brain server against the in-browser brain.
//
//   LEAPER_BRAIN_URL=http://127.0.0.1:8767 node --test tests/brain-provider-live.test.js
//
// Skipped unless LEAPER_BRAIN_URL points at a running rl/junkyard_server.py.
// The same requests (a recorded hide-and-seek run, a pose sync, more moves)
// go to the server through HttpBrainProvider and to OnnxBrainProvider (the
// worker code in Node). The two networks differ by ~1e-6 rounding (PyTorch vs
// ONNX Runtime), so poses must agree within 1e-3, every yes/no fact must be
// equal, and the sync frame (no network involved) must be identical.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as ort from 'onnxruntime-web';
import { HttpBrainProvider } from '../src/brain/HttpBrainProvider.js';
import { OnnxBrainProvider } from '../src/brain/junkyard/OnnxBrainProvider.js';
import { createBrainHost } from '../src/brain/junkyard/brainHost.js';
import { frameDifferences } from '../src/brain/junkyard/fixtureReplay.js';

const URL_ = process.env.LEAPER_BRAIN_URL;
const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root));
ort.env.wasm.numThreads = 1;

// The worker code behind a stand-in worker, reading the repository's files.
function fakeWorker() {
  const worker = { onmessage: null, onerror: null, terminated: false,
    postMessage(message) { setTimeout(() => host.handle(structuredClone(message)), 0); },
    terminate() { this.terminated = true; } };
  const served = (url) => {
    const { pathname } = new URL(url);
    return read(pathname.startsWith('/brains/') ? `public${pathname}` : pathname.slice(1));
  };
  const host = createBrainHost({ ort, glbUrl: 'http://brain.test/assets/maps/junkyard/junkyard.glb',
    collisionUrl: 'http://brain.test/assets/maps/junkyard/collision.json',
    fetchBytes: async (url) => new Uint8Array(served(url)),
    post: (message) => { if (!worker.terminated) worker.onmessage?.({ data: structuredClone(message) }); } });
  return worker;
}

test('the Python server and the in-browser brain answer the same requests alike', { skip: !URL_ && 'set LEAPER_BRAIN_URL to run' }, async () => {
  const fixture = JSON.parse(read('tests/fixtures/brain/eye-5.5-hide-seek.json'));
  // The requests: reset, 60 recorded moves, a leap back to the start turned a quarter, 20 more moves.
  const requests = [['reset', fixture.reset],
    ...fixture.steps.slice(0, 60).map((step) => ['step', step.input]),
    ['sync', { position: fixture.reset.position, yaw: Math.PI / 2, ...fixture.steps[59].input }],
    ...fixture.steps.slice(60, 80).map((step) => ['step', step.input])];
  const answers = {};
  for (const [name, provider] of [['http', new HttpBrainProvider({ url: URL_, pageEvents: null })],
    ['onnx', new OnnxBrainProvider({ baseUrl: 'http://brain.test/brains/leaper_7757824/', createWorker: fakeWorker })]]) {
    await provider.load();
    answers[name] = [];
    let token = null;
    for (const [path, payload] of requests) {
      const frame = await provider.request(path, path === 'reset' ? payload : { ...payload, token });
      if (path === 'reset') token = frame.token;
      answers[name].push(frame);
    }
    await provider.close(token);
    provider.dispose();
  }
  requests.forEach(([path], i) => {
    const { discrete, numbers } = frameDifferences(answers.onnx[i], answers.http[i]);
    assert.deepEqual(discrete, [], `${path} ${i}: yes/no facts`);
    assert.ok(numbers.pose < 1e-3, `${path} ${i}: pose ${numbers.pose}`);
    if (path === 'sync') assert.deepEqual([answers.onnx[i].x, answers.onnx[i].z, answers.onnx[i].yaw],
      [answers.http[i].x, answers.http[i].z, answers.http[i].yaw], 'the synced pose is identical');
  });
});
