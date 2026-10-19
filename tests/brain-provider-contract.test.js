// The BrainProvider contract (src/brain/BrainProvider.js), checked the same way
// for both real providers against the Python recordings in tests/fixtures/brain:
//   - OnnxBrainProvider: the worker code (brainHost.js) behind a stand-in worker;
//   - HttpBrainProvider: the HTTP client, against a stand-in server (the same JS
//     brain core answering on the server's routes, with its status codes).
// Both must give the server's frames for reset / step / sense, sync the pose,
// close sessions, refuse bad requests with the server's wording, and clean up.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as ort from 'onnxruntime-web';
import { OnnxBrainProvider } from '../src/brain/junkyard/OnnxBrainProvider.js';
import { createBrainHost } from '../src/brain/junkyard/brainHost.js';
import { createJunkyardWorld } from '../src/brain/junkyard/junkyardWorld.js';
import { loadGlbTriangles } from '../src/brain/junkyard/junkyardSight.js';
import { frameDifferences } from '../src/brain/junkyard/fixtureReplay.js';
import * as THREE from 'three';
import { HttpBrainProvider } from '../src/brain/HttpBrainProvider.js';
import { BrainProviderChain, BrainUnavailableError, describeProgress } from '../src/brain/BrainProvider.js';
import { BRAIN_TURRET_LABEL, JunkyardBrain } from '../src/simulation/JunkyardBrain.js';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root));
ort.env.wasm.numThreads = 1;

// --- Stand-ins: the files, a worker and an HTTP server ------------------------------------

// Pretend web server: brain files under /brains/..., the map under /assets/...
const BASE = 'http://brain.test/brains/leaper_7757824/';
const MAP = { glbUrl: 'http://brain.test/assets/maps/junkyard/junkyard.glb',
  collisionUrl: 'http://brain.test/assets/maps/junkyard/collision.json' };
const served = (url) => {
  const { pathname } = new URL(url);
  if (pathname.startsWith('/brains/')) return read(`public${pathname}`);
  if (pathname.startsWith('/assets/')) return read(pathname.slice(1));
  throw new Error(`404 ${url}`);
};
const fetchBytes = async (url) => new Uint8Array(served(url));

// A stand-in Worker: messages are structured-cloned and handled asynchronously.
// `files` is how it downloads (the repository's files by default).
function fakeWorker(files = fetchBytes) {
  const worker = {
    onmessage: null, onerror: null, terminated: false,
    postMessage(message) { setTimeout(() => host.handle(structuredClone(message)), 0); },
    terminate() { this.terminated = true; },
  };
  const host = createBrainHost({ ort, ...MAP, fetchBytes: files,
    post: (message) => { if (!worker.terminated) worker.onmessage?.({ data: structuredClone(message) }); } });
  return worker;
}

// A stand-in brain server: the JS core on rl/junkyard_server.py's routes. Like
// the server, refused requests are HTTP 400 with { error }, unknown paths 404.
function fakeServer() {
  const replies = new Map();
  let nextId = 1;
  const host = createBrainHost({ ort, ...MAP, fetchBytes, post: (message) => {
    if (!message.progress) replies.get(message.id)?.(message);
  } });
  const call = (method, payload) => new Promise((resolve) => {
    const id = nextId++;
    replies.set(id, resolve);
    host.handle({ id, method, payload });
  });
  const ready = call('init', { baseUrl: BASE });
  const reply = (status, body) => ({ ok: status < 400, status, json: async () => JSON.parse(JSON.stringify(body)) });
  const requests = [];
  const server = {
    requests,
    down: false,
    async fetch(url, options = {}) {
      requests.push({ url, ...options });
      if (server.down) throw new TypeError('Failed to fetch');
      const { result: { manifest } } = await ready;
      const path = new URL(url).pathname;
      if (options.method === 'GET') return reply(200, { status: 'ok', model_step: manifest.num_timesteps, policy_sha256: manifest.policy_sha256 });
      if (!['/reset', '/step', '/sense', '/sync', '/close'].includes(path)) return reply(404, { error: `Unknown brain endpoint ${path}` });
      const answer = await call(path.slice(1), JSON.parse(options.body));
      return answer.ok ? reply(200, answer.result) : reply(400, { error: answer.error });
    },
  };
  return server;
}

const fixture = JSON.parse(read('tests/fixtures/brain/eye-5.5-hide-seek.json'));

// --- The shared contract ----------------------------------------------------------------------

const providers = {
  'OnnxBrainProvider (worker)': () => ({ provider: new OnnxBrainProvider({ baseUrl: BASE, createWorker: fakeWorker }) }),
  'HttpBrainProvider (server)': () => {
    const server = fakeServer();
    return { server, provider: new HttpBrainProvider({ url: 'http://brain.test:8767', fetch: server.fetch, pageEvents: null }) };
  },
};

for (const [name, make] of Object.entries(providers)) {
  test(`${name}: reset, 60 moves and paused previews match the Python server`, async () => {
    const { provider } = make();
    await provider.load();
    const frame = await provider.reset(fixture.reset);
    assert.deepEqual(Object.keys(frame).sort(), [...Object.keys(fixture.initial.frame), 'token', 'policy_sha256'].sort(),
      'exactly the server\'s frame fields');
    const first = frameDifferences(frame, fixture.initial.frame);
    assert.deepEqual(first.discrete, []);
    assert.equal(first.numbers.pose, 0);
    for (let k = 0; k < 60; k += 1) {
      const next = await provider.request('step', { token: frame.token, ...fixture.steps[k].input });
      const { discrete, numbers } = frameDifferences(next, fixture.steps[k].frame);
      assert.deepEqual(discrete, [], `step ${k}`);
      assert.ok(numbers.pose < 1e-3, `step ${k} pose ${numbers.pose}`);
      for (const probe of fixture.senses.filter((p) => p.after === k)) {
        const preview = await provider.sense({ token: frame.token, ...probe.input });
        assert.deepEqual(frameDifferences(preview, probe.frame).discrete, [], `sense after ${k}`);
        assert.equal(preview.step, next.step, 'a preview never moves');
      }
    }
    provider.dispose();
  });

  test(`${name}: pose sync, close and refused requests`, async () => {
    const { provider } = make();
    const frame = await provider.reset(fixture.reset);
    const input = fixture.steps[0].input;
    // 1. A leap: the pose changes, the step count does not; the next move starts there.
    const synced = await provider.sync({ token: frame.token, position: [2, -5], yaw: 1, ...input });
    assert.deepEqual([synced.x, synced.z, synced.yaw, synced.step], [2, -5, 1, 0]);
    const moved = await provider.step({ token: frame.token, ...input });
    assert.equal(moved.step, 1);
    assert.ok(Math.hypot(moved.x - 2, moved.z + 5) <= 0.375 + 1e-6, 'one move from the synced spot');
    // 2. A spot inside a wreck is refused and changes nothing.
    await assert.rejects(provider.sync({ token: frame.token, position: [29, 3], yaw: 0, ...input }), /intersects the junkyard/);
    await assert.rejects(provider.sync({ token: frame.token, position: [2, -5], yaw: 'north', ...input }), /Invalid robot heading/);
    const after = await provider.sense({ token: frame.token, ...input });
    assert.deepEqual([after.x, after.z, after.step], [moved.x, moved.z, 1]);
    // 3. Other refusals keep the server's wording.
    await assert.rejects(provider.reset({ ...fixture.reset, width: 0.5 }), /Invalid robot size or heading/);
    await assert.rejects(provider.reset({ ...fixture.reset, position: [29, 3] }), /Leaper start intersects the junkyard/);
    await assert.rejects(provider.request('train', {}), /Unknown brain request/);
    // 4. A closed session is gone; closing it again is harmless.
    assert.deepEqual(await provider.close(frame.token), { closed: true });
    await assert.rejects(provider.step({ token: frame.token, ...input }), /Session expired\. Reset Leaper to reconnect/);
    assert.deepEqual(await provider.close(frame.token), { closed: false });
    provider.dispose();
  });
}

// --- ONNX only: the worker's loading progress and its lifecycle ---------------------------------

test('ONNX: loading and other Leaper sizes report progress; the default size uses the baked raster', async () => {
  const provider = new OnnxBrainProvider({ baseUrl: BASE, createWorker: fakeWorker });
  const events = [];
  provider.onProgress((event) => events.push(event));
  await provider.load();
  const loading = events.filter((e) => e.task === 'load');
  assert.ok(loading.length >= 4 && loading.every((e) => e.kind === 'onnx'), 'brain.json, map, network, compile');
  assert.equal(loading.at(-1).fraction, 1);
  assert.ok(loading.every((e, i) => i === 0 || e.fraction >= loading[i - 1].fraction), 'progress only goes up');
  assert.match(describeProgress(loading[1]), /^LOADING BRAIN · ONNX · IN BROWSER · \d+% · /);
  // The default size: the baked raster, no collision.json download.
  await provider.prepare(5.5);
  assert.equal(provider.lastWorld.source, 'baked');
  // Another size is built in the worker, with progress through download, raster and sight grid.
  events.length = 0;
  await provider.prepare(6);
  assert.equal(provider.lastWorld.source, 'built');
  assert.deepEqual([...new Set(events.map((e) => e.stage))], ['download', 'raster', 'sight']);
  assert.ok(events.every((e) => e.task === 'world' && e.width === 6));
  assert.equal(events.at(-1).fraction, 1);
  assert.match(describeProgress(events[1]), /^PREPARING LEAPER SIZE 6\.0 · ONNX · IN BROWSER · \d+% · /);
  // The first reset at a prepared size reuses that world.
  await provider.reset({ ...fixture.reset, width: 6 });
  assert.equal(provider.lastWorld.cached, true);
  provider.dispose();
});

test('ONNX: the worker\'s progress-reporting raster build is the Python raster, bit for bit, at every recorded size', () => {
  // In the game every size but the baked one is built through this path
  // (brainHost.loadWorld -> createJunkyardWorld with onProgress), which feeds
  // the triangles one by one to report progress. It must change nothing.
  const collision = JSON.parse(read('assets/maps/junkyard/collision.json'));
  const glbTriangles = loadGlbTriangles(read('assets/maps/junkyard/junkyard.glb'));
  const { worlds } = JSON.parse(read('tests/fixtures/brain/index.json'));
  for (const [width, recorded] of Object.entries(worlds)) {
    const updates = [];
    const world = createJunkyardWorld({ width: Number(width), glbTriangles, collision,
      onProgress: (stage, fraction) => updates.push([stage, fraction]) });
    assert.deepEqual([world.raster.nx, world.raster.nz], recorded.raster_shape, `shape at width ${width}`);
    assert.equal(createHash('sha256').update(world.raster.solid).digest('hex'), recorded.raster_sha256, `raster bits at width ${width}`);
    const raster = updates.filter(([stage]) => stage === 'raster').map(([, fraction]) => fraction);
    assert.ok(raster.length >= 50 && raster.at(-1) === 1, `raster progress reported (${raster.length} updates)`);
    assert.ok(raster.every((fraction, i) => i === 0 || fraction >= raster[i - 1]), 'raster progress only goes up');
    assert.deepEqual(updates.slice(-2), [['sight', 0], ['sight', 1]]);
  }
});

test('ONNX: dispose stops the worker; a crashed worker is replaced on the next request', async () => {
  const workers = [];
  const provider = new OnnxBrainProvider({ baseUrl: BASE, createWorker: () => { workers.push(fakeWorker()); return workers.at(-1); } });
  const frame = await provider.reset(fixture.reset);
  // The worker dies while a move is on its way: the move fails as "unavailable",
  // so the game can fall back. (This worker swallows the move, then crashes.)
  const post = workers[0].postMessage;
  workers[0].postMessage = (message) => { if (message.method !== 'step') post.call(workers[0], message); };
  const step = provider.step({ token: frame.token, ...fixture.steps[0].input });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(provider.pending.size, 1, 'the move is waiting for the worker');
  workers[0].onerror({ message: 'out of memory' });
  await assert.rejects(step, (error) => error.unavailable && /Brain worker failed: out of memory/.test(error.message));
  assert.equal(workers[0].terminated, true);
  // The next request starts a fresh worker (its sessions are gone).
  await assert.rejects(provider.step({ token: frame.token, ...fixture.steps[0].input }), /Session expired/);
  assert.equal(workers.length, 2);
  provider.dispose();
  assert.equal(workers[1].terminated, true, 'dispose terminates the worker');
  // A page without Web Workers cannot load the in-browser brain.
  const broken = new OnnxBrainProvider({ baseUrl: BASE, createWorker: () => { throw new ReferenceError('Worker is not defined'); } });
  await assert.rejects(broken.load(), (error) => error instanceof BrainUnavailableError && /no Web Worker/.test(error.message));
});

// --- HTTP only: the wire format, health check and page lifecycle --------------------------------

test('HTTP: plain-text JSON POSTs, a health check first, and unreachable means unavailable', async () => {
  const server = fakeServer();
  const provider = new HttpBrainProvider({ url: 'http://brain.test:8767', fetch: server.fetch, pageEvents: null });
  const health = await provider.load();
  assert.equal(health.model_step, 7757824);
  const frame = await provider.reset(fixture.reset);
  await provider.step({ token: frame.token, ...fixture.steps[0].input });
  const [get, reset, step] = server.requests;
  assert.deepEqual([get.method, get.url], ['GET', 'http://brain.test:8767/']);
  assert.deepEqual([reset.method, reset.url, reset.headers['Content-Type']], ['POST', 'http://brain.test:8767/reset', 'text/plain'],
    'a "simple" request: no CORS preflight before every move');
  assert.deepEqual(JSON.parse(step.body).target, fixture.steps[0].input.target);
  // The service goes away: requests fail as "unavailable" (the game may fall back).
  server.down = true;
  await assert.rejects(provider.step({ token: frame.token, ...fixture.steps[1].input }), (error) => error.unavailable === true);
  await assert.rejects(provider.load(), /no brain service/, 'after a drop the health is checked again');
  // A service that is not reachable, or not the approved brain, never loads.
  const missing = new HttpBrainProvider({ url: 'http://brain.test:1', fetch: async () => { throw new TypeError('Failed to fetch'); }, pageEvents: null });
  await assert.rejects(missing.load(), (error) => error instanceof BrainUnavailableError && /no brain service at http:\/\/brain\.test:1/.test(error.message));
  const other = new HttpBrainProvider({ url: 'http://brain.test:2', pageEvents: null,
    fetch: async () => ({ ok: true, json: async () => ({ model_step: 123 }) }) });
  await assert.rejects(other.load(), /not the 7,757,824-step brain/);
});

test('HTTP: leaving the page closes this page\'s sessions with a beacon; dispose stops listening', async () => {
  const server = fakeServer();
  const page = new EventTarget();
  const beacons = [];
  const provider = new HttpBrainProvider({ url: 'http://brain.test:8767', fetch: server.fetch, pageEvents: page,
    sendBeacon: (url, body) => { beacons.push({ url, body: JSON.parse(body) }); return true; } });
  const kept = await provider.reset(fixture.reset);
  const closed = await provider.reset(fixture.reset);
  await provider.close(closed.token);
  page.dispatchEvent(new Event('pagehide'));
  assert.deepEqual(beacons, [{ url: 'http://brain.test:8767/close', body: { token: kept.token } }],
    'only sessions still open are closed');
  // After dispose the page's events no longer reach the provider.
  const again = await provider.reset(fixture.reset);
  provider.dispose();
  page.dispatchEvent(new Event('pagehide'));
  assert.equal(beacons.length, 1);
  assert.ok(again.token);
});

// --- The real providers in the game's chain ------------------------------------------------------

test('real providers in the chain: missing ONNX files fall back to the Python server; when it stops, turret mode', async () => {
  globalThis.document = { hidden: false };
  // The page cannot download the brain's files (an old deploy, a blocked path).
  const missingBrainFiles = async (url) => {
    if (new URL(url).pathname.startsWith('/brains/')) throw new Error(`Could not load ${url} (404)`);
    return fetchBytes(url);
  };
  const server = fakeServer();
  const chain = new BrainProviderChain([
    { kind: 'onnx', create: () => new OnnxBrainProvider({ baseUrl: BASE, createWorker: () => fakeWorker(missingBrainFiles) }) },
    { kind: 'http', create: () => new HttpBrainProvider({ url: 'http://brain.test:8767', fetch: server.fetch, pageEvents: null }) },
  ]);
  const { reset } = fixture;
  const playtest = {
    world: { width: reset.width }, walking: true, message: {}, brainLabel: {},
    target: { mesh: { position: new THREE.Vector3(reset.target[0], 0, reset.target[1]) } },
    simulation: { state: { position: new THREE.Vector3(reset.position[0], 0, reset.position[1]), yaw: reset.yaw }, updateExternal() {} },
  };
  const brain = new JunkyardBrain(playtest, { provider: chain });
  const settle = async () => { while (brain.busy) await new Promise((resolve) => setTimeout(resolve, 2)); };

  // 1. The in-browser brain cannot load, so the Python server answers.
  await brain.reset();
  assert.equal(brain.ready, true);
  assert.equal(chain.kind, 'http');
  assert.match(chain.failures[0], /^ONNX · IN BROWSER: Could not load .*brain\.json \(404\)/);
  assert.match(brain.describe().label, /^BRAIN 7,757,824 · PYTHON SERVER · /);
  brain.start();
  for (let i = 0; i < 3; i += 1) {
    brain.update(0.1);
    await settle();
  }
  assert.equal(brain.frame.step, 3, 'the server made the moves');

  // 2. The server stops: a few retried moves, then turret mode with the reason.
  server.down = true;
  for (let i = 0; i < 10 && !brain.offline; i += 1) {
    brain.update(0.1);
    await settle();
  }
  assert.equal(brain.offline, true);
  assert.equal(brain.describe().label, BRAIN_TURRET_LABEL);
  assert.match(playtest.brainLabel.title, /^OFFLINE · TURRET: .*Failed to fetch/);
  brain.dispose();
});
