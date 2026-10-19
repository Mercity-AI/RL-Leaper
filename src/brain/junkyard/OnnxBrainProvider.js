// The Leaper brain without Python: the default BrainProvider (src/brain/BrainProvider.js).
//
// It answers the same requests as rl/junkyard_server.py (reset, step, sense,
// sync, close) with the same frame objects, but runs the frozen world rules and
// the saved ONNX network in a Web Worker (brainWorker.js) inside the page.
// Parity with the Python server is proven by tests/brain-parity.test.js and
// tests/brain-onnx.html.
//
//   const brain = new OnnxBrainProvider();
//   const frame = await brain.reset({ width, position, yaw, target, player_collision, sight_mode, sight_pose });
//   const next = await brain.step({ token: frame.token, target, sight_pose });
//
// `request(path, payload)` has the exact shape of JunkyardBrain.request, so the
// game can switch between providers without other changes.

import { BrainProviderBase, BrainUnavailableError } from '../BrainProvider.js';

// Where brain.json, actor.onnx and the baked rasters are served (public/brains/...).
export function defaultBrainBaseUrl() {
  const base = import.meta.env?.BASE_URL ?? '/';
  return new URL('brains/leaper_7757824/', new URL(base, globalThis.location?.href ?? 'http://localhost/')).href;
}

// Same limits as the HTTP client: the first reset (or prepare) loads everything.
const TIMEOUT_MS = { init: 90000, prepare: 90000, reset: 90000, step: 3000, sense: 3000, sync: 3000, close: 3000 };

export class OnnxBrainProvider extends BrainProviderBase {
  constructor({ baseUrl = defaultBrainBaseUrl(), createWorker = null } = {}) {
    super('onnx');
    this.baseUrl = baseUrl;
    this.createWorker = createWorker
      ?? (() => new Worker(new URL('./brainWorker.js', import.meta.url), { type: 'module', name: 'leaper-brain' }));
    this.worker = null;
    this.pending = new Map();
    this.nextId = 1;
    this.loading = null;
    // Filled in as the brain works: load info and per-request timings (ms).
    this.manifest = null;
    this.loadInfo = null;
    this.lastWorld = null;
    this.stats = { requests: 0, lastMs: 0, totalMs: 0, maxMs: 0, workerMs: 0 };
  }

  get tooltipDetail() {
    return this.loadInfo?.modelVerified ? 'actor.onnx SHA256 verified' : '';
  }

  // --- Lifecycle -------------------------------------------------------------------

  // Start the worker and load brain.json, the runtime, the network and the map (once).
  load() {
    if (!this.loading) {
      this.loading = (async () => {
        try {
          this.worker = this.createWorker();
        } catch (error) {
          throw new BrainUnavailableError(`no Web Worker (${error?.message || error})`, { kind: 'onnx', cause: error });
        }
        this.worker.onmessage = (event) => this.receive(event.data);
        // A worker that dies takes its sessions with it: start afresh next time.
        this.worker.onerror = (event) => this.dispose(new BrainUnavailableError(
          `Brain worker failed: ${event?.message || 'could not start'}`, { kind: 'onnx' }));
        const result = await this.call('init', { baseUrl: this.baseUrl });
        this.manifest = result.manifest;
        this.loadInfo = result.timings;
        return result.manifest;
      })().catch((error) => {
        this.dispose();
        throw error?.unavailable ? error
          : new BrainUnavailableError(error?.message || String(error), { kind: 'onnx', cause: error });
      });
    }
    return this.loading;
  }

  // Load the junkyard for one Leaper size ahead of time: the baked raster for
  // the default width, otherwise built in the worker (with progress), so the
  // page never waits on it and the first reset at that size is instant.
  async prepare(width) {
    await this.load();
    return this.call('prepare', { width });
  }

  // Stop the worker (and with it every session). Requests still waiting fail.
  dispose(reason = new BrainUnavailableError('Brain worker stopped', { kind: 'onnx' })) {
    this.worker?.terminate();
    this.worker = null;
    this.loading = null;
    this.failAll(reason);
  }

  // --- The server's requests ------------------------------------------------------------

  async reset(payload) { await this.load(); return this.call('reset', payload); }

  async step(payload) { await this.load(); return this.call('step', payload); }

  async sense(payload) { await this.load(); return this.call('sense', payload); }

  // Pose sync: game logic moved the Leaper between moves (brainSession.js sync()).
  async sync(payload) { await this.load(); return this.call('sync', payload); }

  // Forget one session; a stopped worker has no sessions left to forget.
  async close(token) {
    if (!this.worker || !token) return { closed: false };
    try { return await this.call('close', { token }); } catch { return { closed: false }; }
  }

  // --- Messaging with the worker ---------------------------------------------------

  call(method, payload) {
    if (!this.worker) return Promise.reject(new BrainUnavailableError('Brain worker stopped', { kind: 'onnx' }));
    const id = this.nextId++;
    const sent = performance.now();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Brain ${method} timed out`));
      }, TIMEOUT_MS[method] ?? 3000);
      this.pending.set(id, { resolve, reject, timer, sent, method });
      this.worker.postMessage({ id, method, payload });
    });
  }

  receive(message) {
    // Loading progress for a request still running (init / prepare / reset).
    if (message.progress) {
      if (this.pending.has(message.id)) this.emitProgress(message.progress);
      return;
    }
    const entry = this.pending.get(message.id);
    if (!entry) return;
    this.pending.delete(message.id);
    clearTimeout(entry.timer);
    if (!['init', 'prepare', 'close'].includes(entry.method)) {
      const ms = performance.now() - entry.sent;
      this.stats.requests += 1;
      this.stats.lastMs = ms;
      this.stats.totalMs += ms;
      this.stats.maxMs = Math.max(this.stats.maxMs, ms);
      this.stats.workerMs = message.ms;
    }
    if (message.world) this.lastWorld = message.world;
    if (message.ok) entry.resolve(message.result);
    else entry.reject(new Error(message.error));
  }

  failAll(error) {
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(error);
      this.pending.delete(id);
    }
  }
}
