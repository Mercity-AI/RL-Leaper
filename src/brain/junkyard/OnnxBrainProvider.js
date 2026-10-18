// The Leaper brain without Python: a drop-in for the HTTP brain service.
//
// It answers the same three requests as rl/junkyard_server.py (reset, step,
// sense) with the same frame objects, but runs the frozen world rules and the
// saved ONNX network in a Web Worker (brainWorker.js) inside the page. Parity
// with the Python server is proven by tests/brain-parity.test.js and
// tests/brain-onnx.html.
//
//   const brain = new OnnxBrainProvider();
//   const frame = await brain.reset({ width, position, yaw, target, player_collision, sight_mode, sight_pose });
//   const next = await brain.step({ token: frame.token, target, sight_pose });
//
// `request(path, payload)` has the exact shape of JunkyardBrain.request, so the
// game can switch between the two without other changes.

// Where brain.json, actor.onnx and the baked rasters are served (public/brains/...).
export function defaultBrainBaseUrl() {
  const base = import.meta.env?.BASE_URL ?? '/';
  return new URL('brains/leaper_7757824/', new URL(base, globalThis.location?.href ?? 'http://localhost/')).href;
}

// Same limits as the HTTP client: the first reset loads everything.
const TIMEOUT_MS = { init: 90000, reset: 90000, step: 3000, sense: 3000 };

export class OnnxBrainProvider {
  constructor({ baseUrl = defaultBrainBaseUrl(), createWorker = null } = {}) {
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

  // --- Lifecycle -------------------------------------------------------------------

  // Start the worker and load brain.json, the network and the map (once).
  load() {
    if (!this.loading) {
      this.worker = this.createWorker();
      this.worker.onmessage = (event) => this.receive(event.data);
      this.worker.onerror = (event) => this.failAll(new Error(`Brain worker failed: ${event.message || 'could not start'}`));
      this.loading = this.call('init', { baseUrl: this.baseUrl }).then((result) => {
        this.manifest = result.manifest;
        this.loadInfo = result.timings;
        return result.manifest;
      }).catch((error) => {
        this.dispose();
        throw error;
      });
    }
    return this.loading;
  }

  dispose() {
    this.worker?.terminate();
    this.worker = null;
    this.loading = null;
    this.failAll(new Error('Brain worker stopped'));
  }

  // --- The three server requests ------------------------------------------------------

  async request(path, payload) {
    if (!['reset', 'step', 'sense'].includes(path)) throw new Error(`Unknown brain request ${path}`);
    await this.load();
    return this.call(path, payload);
  }

  reset(payload) { return this.request('reset', payload); }

  step(payload) { return this.request('step', payload); }

  sense(payload) { return this.request('sense', payload); }

  // --- Messaging with the worker ---------------------------------------------------

  call(method, payload) {
    const id = this.nextId++;
    const sent = performance.now();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Brain ${method} timed out`));
      }, TIMEOUT_MS[method]);
      this.pending.set(id, { resolve, reject, timer, sent, method });
      this.worker.postMessage({ id, method, payload });
    });
  }

  receive(message) {
    const entry = this.pending.get(message.id);
    if (!entry) return;
    this.pending.delete(message.id);
    clearTimeout(entry.timer);
    if (entry.method !== 'init') {
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
