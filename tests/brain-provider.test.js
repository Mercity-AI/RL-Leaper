// OnnxBrainProvider end to end in Node: the page-side provider talks to the
// very code the Web Worker runs (brainHost.js) through a stand-in worker, with
// the real brain.json, actor.onnx, baked raster and junkyard GLB. Frames must
// look and behave like the Python server's (tests/fixtures/brain).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as ort from 'onnxruntime-web';
import { OnnxBrainProvider } from '../src/brain/junkyard/OnnxBrainProvider.js';
import { createBrainHost } from '../src/brain/junkyard/brainHost.js';
import { frameDifferences } from '../src/brain/junkyard/fixtureReplay.js';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root));
ort.env.wasm.numThreads = 1;

// Pretend web server: brain files under /brains/..., the map under /assets/...
const BASE = 'http://brain.test/brains/leaper_7757824/';
const served = (url) => {
  const { pathname } = new URL(url);
  if (pathname.startsWith('/brains/')) return read(`public${pathname}`);
  if (pathname.startsWith('/assets/')) return read(pathname.slice(1));
  throw new Error(`404 ${url}`);
};

// A stand-in Worker: messages are structured-cloned and handled asynchronously,
// exactly as they would cross a real worker boundary. `serve` can swap files.
function fakeWorker(serve = served) {
  const worker = {
    onmessage: null, onerror: null, terminated: false,
    postMessage(message) { setTimeout(() => host.handle(structuredClone(message)), 0); },
    terminate() { this.terminated = true; },
  };
  const host = createBrainHost({
    ort, glbUrl: 'http://brain.test/assets/maps/junkyard/junkyard.glb',
    collisionUrl: 'http://brain.test/assets/maps/junkyard/collision.json',
    post: (message) => { if (!worker.terminated) worker.onmessage?.({ data: structuredClone(message) }); },
    fetchBytes: async (url) => new Uint8Array(serve(url)),
  });
  return worker;
}

const fixture = JSON.parse(read('tests/fixtures/brain/eye-5.5-hide-seek.json'));
const legacy = JSON.parse(read('tests/fixtures/brain/legacy-5.5-hide-seek.json'));

test('provider frames match the Python server for reset, steps and a paused preview', async () => {
  const provider = new OnnxBrainProvider({ baseUrl: BASE, createWorker: fakeWorker });
  const manifest = await provider.load();
  assert.equal(manifest.num_timesteps, 7757824);
  assert.equal(provider.loadInfo.modelVerified, true, 'actor.onnx checked against brain.json');

  const frame = await provider.request('reset', fixture.reset);
  assert.equal(provider.lastWorld.source, 'baked');
  assert.deepEqual(Object.keys(frame).sort(), [...Object.keys(fixture.initial.frame), 'token', 'policy_sha256'].sort());
  assert.equal(frame.policy_sha256, manifest.policy_sha256);
  const reset = frameDifferences(frame, fixture.initial.frame);
  assert.deepEqual(reset.discrete, []);
  assert.equal(reset.numbers.pose, 0);

  // 60 free-running steps through the provider stay in lockstep with Python.
  for (let k = 0; k < 60; k += 1) {
    const next = await provider.step({ token: frame.token, ...fixture.steps[k].input });
    const { discrete, numbers } = frameDifferences(next, fixture.steps[k].frame);
    assert.deepEqual(discrete, [], `step ${k}`);
    assert.ok(numbers.pose < 1e-3, `step ${k} pose ${numbers.pose}`);
    for (const probe of fixture.senses.filter((p) => p.after === k)) {
      const preview = await provider.sense({ token: frame.token, ...probe.input });
      assert.deepEqual(frameDifferences(preview, probe.frame).discrete, [], `sense after ${k}`);
    }
  }
  const { requests, totalMs, maxMs } = provider.stats;
  console.log(`provider in Node: load ${provider.loadInfo.loadMs.toFixed(0)} ms, ${requests} requests, `
    + `mean ${(totalMs / requests).toFixed(2)} ms, max ${maxMs.toFixed(1)} ms per request (env + ONNX + messaging)`);
  provider.dispose();
});

test('legacy flat sight runs through the provider too', async () => {
  const provider = new OnnxBrainProvider({ baseUrl: BASE, createWorker: fakeWorker });
  const frame = await provider.reset(legacy.reset);
  assert.equal(frame.sight, null);
  assert.equal(frame.sight_mode, 'legacy');
  for (let k = 0; k < 30; k += 1) {
    const next = await provider.step({ token: frame.token, target: legacy.steps[k].input.target });
    assert.deepEqual(frameDifferences(next, legacy.steps[k].frame).discrete, [], `step ${k}`);
  }
  provider.dispose();
});

test('a baked raster listed for another width is ignored and the raster is built instead', async () => {
  // brain.json wrongly lists raster-5.5.bin as the file for width 5.6.
  const manifest = JSON.parse(read('public/brains/leaper_7757824/brain.json'));
  manifest.rasters['5.6'] = manifest.rasters['5.5'];
  const serve = (url) => (url.endsWith('/brain.json') ? Buffer.from(JSON.stringify(manifest)) : served(url));
  const provider = new OnnxBrainProvider({ baseUrl: BASE, createWorker: () => fakeWorker(serve) });
  const frame = await provider.reset({ ...fixture.reset, width: 5.6 });
  assert.equal(provider.lastWorld.source, 'built', 'the 5.5 file is not used for 5.6');
  assert.equal(typeof frame.token, 'string');
  provider.dispose();
});

test('provider refuses bad requests with the server\'s messages', async () => {
  const provider = new OnnxBrainProvider({ baseUrl: BASE, createWorker: fakeWorker });
  await assert.rejects(provider.step({ token: 'nope', target: [0, 0] }), /Session expired\. Reset Leaper to reconnect/);
  await assert.rejects(provider.reset({ ...fixture.reset, width: 0.5 }), /Invalid robot size or heading/);
  await assert.rejects(provider.reset({ ...fixture.reset, sight_mode: 'xray' }), /Unknown sight mode/);
  await assert.rejects(provider.reset({ ...fixture.reset, position: [0, Infinity] }), /Expected a finite map position/);
  await assert.rejects(provider.reset({ ...fixture.reset, sight_pose: { eye: [0, 99, 0], points: fixture.reset.sight_pose.points } }), /Invalid eye vision pose/);
  // A pose inside a wall: the server's own wording.
  await assert.rejects(provider.reset({ ...fixture.reset, position: [24, 3] }), /Leaper start intersects the junkyard/);
  await assert.rejects(provider.request('train', {}), /Unknown brain request/);
  // After errors the session machinery still works.
  const frame = await provider.reset(fixture.reset);
  assert.equal(typeof frame.token, 'string');
  provider.dispose();
  await assert.rejects(provider.step({ token: frame.token, ...fixture.steps[0].input }), /Session expired/,
    'a disposed provider starts a fresh worker, so old tokens are gone');
});
