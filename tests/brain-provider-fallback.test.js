// Which brain answers: ONNX in the browser first, the Python server if that
// cannot load, then turret mode (src/brain/BrainProvider.js), and what the
// game shows for each (src/simulation/JunkyardBrain.js): the badge, its
// tooltip and the loading progress. Stand-in providers keep this fast.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  BrainProviderBase, BrainProviderChain, BrainUnavailableError, TurretBrainProvider,
  brainProviderOrder, createBrainProvider, describeProgress,
} from '../src/brain/BrainProvider.js';
import { BRAIN_TURRET_LABEL, JunkyardBrain, createGameBrainProvider } from '../src/simulation/JunkyardBrain.js';

// --- A stand-in provider ----------------------------------------------------------------------

// loads: true, or an Error to fail load(); reply(path, payload) answers requests.
class FakeProvider extends BrainProviderBase {
  constructor(kind, { loads = true, reply = null } = {}) {
    super(kind);
    this.loads = loads;
    this.reply = reply;
    this.log = [];
    this.disposed = 0;
    this.tokens = 0;
  }

  async load() {
    this.log.push('load');
    this.emitProgress({ task: 'load', stage: 'map', label: 'DOWNLOADING JUNKYARD MAP', fraction: 0.5 });
    if (this.loads !== true) throw this.loads;
    return {};
  }

  async answer(path, payload) {
    this.log.push(path);
    if (this.reply) return this.reply(path, payload);
    return { x: 0, z: 0, yaw: 0, step: 0, model_step: 7757824, policy_sha256: 'sha', token: `${this.kind}-${++this.tokens}` };
  }

  reset(payload) { return this.answer('reset', payload); }

  step(payload) { return this.answer('step', payload); }

  sense(payload) { return this.answer('sense', payload); }

  sync(payload) { return this.answer('sync', payload); }

  async close(token) { this.log.push(`close ${token}`); return { closed: true }; }

  dispose() { this.disposed += 1; super.dispose(); }
}

function chainOf(...providers) {
  return new BrainProviderChain(providers.map((provider) => ({ kind: provider.kind, create: () => provider })));
}

// --- Choosing the order ---------------------------------------------------------------------------

test('?brain= picks the order: in-browser first by default, the Python server only with ?brain=http', () => {
  assert.deepEqual(brainProviderOrder(''), ['onnx', 'http']);
  assert.deepEqual(brainProviderOrder('?brain=auto'), ['onnx', 'http']);
  assert.deepEqual(brainProviderOrder('?brain=http'), ['http']);
  assert.deepEqual(brainProviderOrder('?brain=python'), ['http']);
  assert.deepEqual(brainProviderOrder('?brain=ONNX'), ['onnx']);
  assert.deepEqual(brainProviderOrder('?brain=turret'), []);
  assert.deepEqual(brainProviderOrder('?brain=nonsense'), ['onnx', 'http']);
  // The game's own chain follows the same choice (nothing loads until asked).
  assert.deepEqual(createGameBrainProvider({ search: '' }).candidates.map((c) => c.kind), ['onnx', 'http']);
  assert.deepEqual(createGameBrainProvider({ search: '?brain=http&brainUrl=http://127.0.0.1:8791' }).candidates.map((c) => c.kind), ['http']);
  assert.deepEqual(createBrainProvider({ order: ['onnx', 'http'], factories: { http: () => null } }).candidates.map((c) => c.kind), ['http'],
    'kinds without a factory are skipped');
});

// --- The fallback order ----------------------------------------------------------------------------

test('ONNX loads: it answers everything and the Python server is never contacted', async () => {
  const onnx = new FakeProvider('onnx');
  const http = new FakeProvider('http');
  const chain = chainOf(onnx, http);
  const frame = await chain.reset({});
  await chain.step({ token: frame.token });
  await chain.sync({ token: frame.token });
  assert.equal(chain.kind, 'onnx');
  assert.deepEqual(onnx.log, ['load', 'reset', 'step', 'sync']);
  assert.deepEqual(http.log, []);
});

test('ONNX cannot load: the Python server answers; neither: turret mode, retried by the next reset', async () => {
  const onnx = new FakeProvider('onnx', { loads: new BrainUnavailableError('no WebAssembly') });
  const http = new FakeProvider('http');
  const chain = chainOf(onnx, http);
  const frame = await chain.reset({});
  assert.equal(chain.kind, 'http');
  assert.equal(frame.token, 'http-1');
  assert.equal(onnx.disposed, 1, 'the half-loaded provider is freed');
  assert.deepEqual(chain.failures, ['ONNX · IN BROWSER: no WebAssembly']);

  const none = chainOf(new FakeProvider('onnx', { loads: new Error('no WebAssembly') }),
    new FakeProvider('http', { loads: new Error('no brain service at http://127.0.0.1:8767 (Failed to fetch)') }));
  await assert.rejects(none.reset({}), (error) => error instanceof BrainUnavailableError
    && /ONNX · IN BROWSER: no WebAssembly; PYTHON SERVER: no brain service/.test(error.message));
  assert.equal(none.kind, 'turret');
  assert.ok(none.active instanceof TurretBrainProvider);
  // The next reset (START RUN, or turret mode's retry) tries the whole list again.
  const later = none.candidates[1];
  later.create = () => new FakeProvider('http');
  assert.equal((await none.reset({})).token, 'http-1');
  assert.equal(none.kind, 'http');
});

test('a refused request never falls back, but an unreachable provider is picked again next reset', async () => {
  const refused = new Error('Leaper start intersects the junkyard; reset its position');
  let fail = refused;
  const onnx = new FakeProvider('onnx', { reply: () => { throw fail; } });
  const http = new FakeProvider('http');
  const chain = chainOf(onnx, http);
  await assert.rejects(chain.reset({}), /intersects the junkyard/);
  assert.equal(chain.kind, 'onnx', 'the Python server would refuse it the same way');
  assert.deepEqual(http.log, []);
  // The worker dies: the next reset picks a provider again (ONNX is tried first again).
  fail = new BrainUnavailableError('Brain worker failed');
  await assert.rejects(chain.reset({}), /worker failed/);
  fail = null;
  onnx.reply = null;
  await chain.reset({});
  assert.deepEqual(onnx.log.filter((entry) => entry === 'load'), ['load', 'load']);
});

test('a provider that cannot even be created counts as one that cannot load', async () => {
  const chain = new BrainProviderChain([
    { kind: 'onnx', create: () => { throw new ReferenceError('Worker is not defined'); } },
    { kind: 'http', create: () => new FakeProvider('http') },
  ]);
  await chain.reset({});
  assert.equal(chain.kind, 'http');
  assert.deepEqual(chain.failures, ['ONNX · IN BROWSER: Worker is not defined']);
});

test('sessions are closed by the provider that opened them; dispose frees every provider', async () => {
  const onnx = new FakeProvider('onnx');
  const chain = chainOf(onnx, new FakeProvider('http'));
  const frame = await chain.reset({});
  assert.deepEqual(await chain.close(frame.token), { closed: true });
  assert.deepEqual(await chain.close('unknown'), { closed: false });
  assert.ok(onnx.log.includes(`close ${frame.token}`));
  chain.dispose();
  assert.equal(onnx.disposed, 1);
});

test('progress from whichever provider is loading reaches the chain\'s listeners', async () => {
  const chain = chainOf(new FakeProvider('onnx'));
  const events = [];
  const off = chain.onProgress((event) => events.push(event));
  await chain.load();
  off();
  await chain.prepare(6);
  assert.deepEqual(events.map((e) => [e.kind, e.task, e.fraction]), [['onnx', 'load', 0.5]]);
  assert.equal(describeProgress(events[0]), 'LOADING BRAIN · ONNX · IN BROWSER · 50% · DOWNLOADING JUNKYARD MAP');
  assert.equal(describeProgress({ kind: 'onnx', task: 'world', width: 6, fraction: 0.31, label: 'BUILDING COLLISION MAP' }),
    'PREPARING LEAPER SIZE 6.0 · ONNX · IN BROWSER · 31% · BUILDING COLLISION MAP');
  // A wait whose length nobody knows (the Python server building a size) shows no percentage.
  assert.equal(describeProgress({ kind: 'http', task: 'world', width: 6.5, fraction: null, label: 'WAITING FOR THE SERVER' }),
    'PREPARING LEAPER SIZE 6.5 · PYTHON SERVER · WAITING FOR THE SERVER');
});

test('the Python server\'s slow first reset at a size is announced, not shown as 100% loaded', async () => {
  const { HttpBrainProvider } = await import('../src/brain/HttpBrainProvider.js');
  const replies = { '/': { model_step: 7757824 }, '/reset': { token: 't', x: 0, z: 0, yaw: 0 } };
  const provider = new HttpBrainProvider({ url: 'http://brain.test', pageEvents: null,
    fetch: async (url) => ({ ok: true, json: async () => replies[new URL(url).pathname] }) });
  const events = [];
  provider.onProgress((event) => events.push(event));
  await provider.load();
  await provider.reset({ width: 6.5 });
  const waiting = events.at(-1);
  assert.deepEqual([waiting.task, waiting.width, waiting.fraction], ['world', 6.5, null]);
  assert.match(describeProgress(waiting), /^PREPARING LEAPER SIZE 6\.5 · PYTHON SERVER · WAITING FOR THE PYTHON SERVER/);
});

// --- What the game shows ----------------------------------------------------------------------------

function playtest() {
  return {
    world: { width: 4 }, walking: false, message: {}, brainLabel: {},
    target: { mesh: { position: new THREE.Vector3(0, 0, 10) } },
    simulation: { state: { position: new THREE.Vector3(), yaw: 0 }, updateExternal() {} },
  };
}

test('the badge and its tooltip name where the brain runs: ONNX · IN BROWSER, PYTHON SERVER, OFFLINE · TURRET', async () => {
  globalThis.document = { hidden: false };
  // In the browser.
  let p = playtest();
  let brain = new JunkyardBrain(p, { provider: chainOf(new FakeProvider('onnx'), new FakeProvider('http')) });
  await brain.reset();
  assert.equal(brain.describe().label, 'BRAIN 7,757,824 · ONNX · IN BROWSER · STOPPED');
  assert.match(p.brainLabel.title, /^ONNX · in browser: .*policy SHA256 sha$/);
  // The Python server, after ONNX failed to load.
  p = playtest();
  brain = new JunkyardBrain(p, { provider: chainOf(new FakeProvider('onnx', { loads: new Error('no WebAssembly') }), new FakeProvider('http')) });
  await brain.reset();
  brain.start();
  assert.equal(brain.describe().label, 'BRAIN 7,757,824 · PYTHON SERVER · SEARCHING');
  assert.match(p.brainLabel.title, /^PYTHON SERVER: /);
  // Nothing loads: turret mode during a run, with the reasons in the tooltip.
  p = playtest();
  brain = new JunkyardBrain(p, { provider: chainOf(new FakeProvider('onnx', { loads: new Error('no WebAssembly') }),
    new FakeProvider('http', { loads: new Error('Failed to fetch') })) });
  p.walking = true;
  await brain.reset();
  assert.equal(brain.offline, true);
  assert.equal(brain.describe().label, BRAIN_TURRET_LABEL);
  assert.match(p.brainLabel.title, /^OFFLINE · TURRET: .*ONNX · IN BROWSER: no WebAssembly; PYTHON SERVER: Failed to fetch/);
  assert.match(p.message.textContent, /turret mode/);
});

test('while it loads, the badge shows the provider\'s progress', async () => {
  globalThis.document = { hidden: false };
  let finish;
  const onnx = new FakeProvider('onnx', { reply: () => new Promise((resolve) => { finish = resolve; }) });
  const brain = new JunkyardBrain(playtest(), { provider: chainOf(onnx) });
  const resetting = brain.reset();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(brain.describe().label, 'LOADING BRAIN · ONNX · IN BROWSER · 50% · DOWNLOADING JUNKYARD MAP');
  assert.match(brain.describe().status, /LOADING BRAIN · ONNX · IN BROWSER · 50%/);
  finish({ x: 0, z: 0, yaw: 0, step: 0, model_step: 7757824, policy_sha256: 'sha', token: 'a' });
  await resetting;
  assert.match(brain.describe().label, /^BRAIN 7,757,824 · ONNX · IN BROWSER · /);
});

test('switching provider (OPTIONS brain menu) frees the old one; the next reset uses the new one', async () => {
  globalThis.document = { hidden: false };
  const onnx = new FakeProvider('onnx');
  const brain = new JunkyardBrain(playtest(), { provider: chainOf(onnx) });
  await brain.reset();
  const http = new FakeProvider('http');
  brain.useProvider(chainOf(http));
  assert.equal(brain.ready, false, 'not ready until the run is reset');
  assert.ok(onnx.log.includes('close onnx-1'), 'the old session is closed');
  assert.equal(onnx.disposed, 1, 'and its provider freed (the worker stops)');
  await brain.reset();
  assert.equal(brain.token, 'http-1');
  assert.match(brain.describe().label, /· PYTHON SERVER ·/);
});

test('RESET closes the old session; dispose closes the last one and frees the provider (its worker)', async () => {
  globalThis.document = { hidden: false };
  const onnx = new FakeProvider('onnx');
  const brain = new JunkyardBrain(playtest(), { provider: chainOf(onnx) });
  await brain.reset();
  await brain.reset();
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(onnx.log.includes('close onnx-1'), 'the first session is closed by the second reset');
  brain.dispose();
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(onnx.log.includes('close onnx-2'));
  assert.equal(onnx.disposed, 1);
});
