// Where the Leaper's brain runs, hidden behind one interface (review chapter 8:
// "BrainProvider hides *where* the brain runs").
//
// Every provider answers the same requests as rl/junkyard_server.py, with the
// same frame objects (BrainSession.snapshot() keys: x, z, yaw, step, vision,
// target_visible, sight, ...; reset frames add token and policy_sha256):
//
//   load()                 -> start loading (optional; the first reset loads too)
//   prepare(width)         -> load the junkyard for one Leaper size ahead of time
//   reset(payload)         -> a new brain episode           (POST /reset)
//   step(payload)          -> one brain move                 (POST /step)
//   sense(payload)         -> paused sight preview, no move  (POST /sense)
//   sync(payload)          -> game logic moved the Leaper    (POST /sync)
//   close(token)           -> forget one session             (POST /close)
//   dispose()              -> free everything (stops the worker)
//   request(path, payload) -> any of the above by name, like JunkyardBrain.request
//
// Implementations, in the default fallback order:
//   1. OnnxBrainProvider (src/brain/junkyard/): the saved network and the frozen
//      world rules in a Web Worker. The default: the game needs no Python.
//   2. HttpBrainProvider: the local Python service, chosen with ?brain=http or
//      when the in-browser brain cannot load (also the parity reference).
//   3. TurretBrainProvider: no brain at all. Every request is refused, so the
//      game plays turret mode (the Leaper stays put but still shoots).
// BrainProviderChain tries them in that order and is what the game talks to.

// --- Names shown to the player ------------------------------------------------------

// Badge tag and tooltip wording for each kind of provider.
export const BRAIN_PROVIDERS = Object.freeze({
  onnx: Object.freeze({ badge: 'ONNX · IN BROWSER', tooltip: 'ONNX · in browser: the saved network runs in this page (Web Worker, onnxruntime-web)' }),
  http: Object.freeze({ badge: 'PYTHON SERVER', tooltip: 'PYTHON SERVER: the saved checkpoint runs in the local brain service (PyTorch)' }),
  turret: Object.freeze({ badge: 'OFFLINE · TURRET', tooltip: 'OFFLINE · TURRET: no brain could load, so the Leaper stays put but still shoots' }),
});

// Which providers to try, from ?brain= in the page address:
//   (none) / auto   in-browser first, the Python service if that cannot load
//   onnx            in-browser only
//   http / python   the Python service only (the parity reference)
//   turret / off    no brain (turret mode), e.g. to test the fallback
export function brainProviderOrder(search = globalThis.location?.search ?? '') {
  const choice = (new URLSearchParams(search).get('brain') || 'auto').toLowerCase();
  if (choice === 'onnx' || choice === 'browser') return ['onnx'];
  if (choice === 'http' || choice === 'python' || choice === 'server') return ['http'];
  if (choice === 'turret' || choice === 'off' || choice === 'none') return [];
  return ['onnx', 'http'];
}

// The OPTIONS brain menu entry for the page address: 'auto' | 'onnx' | 'http' |
// 'turret'. Read through brainProviderOrder, so aliases (?brain=python,
// ?brain=off, ...) show the brain that really runs.
export function brainChoice(search = globalThis.location?.search ?? '') {
  const order = brainProviderOrder(search);
  if (order.length === 0) return 'turret';
  return order.length === 1 ? order[0] : 'auto';
}

// --- Errors ---------------------------------------------------------------------------

// "This provider cannot answer at all" (not loaded, server unreachable, worker
// gone), as opposed to a refused request (e.g. a start inside a wall). Only
// this kind of failure makes the chain fall back to the next provider.
export class BrainUnavailableError extends Error {
  constructor(message, { kind = null, cause = null } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'BrainUnavailableError';
    this.kind = kind;
    this.unavailable = true;
  }
}

// True for failures that mean "try another provider", whoever raised them.
export function isUnavailable(error) {
  return Boolean(error?.unavailable);
}

// --- Shared provider plumbing -----------------------------------------------------------

// Base class: identity, progress listeners and the request-by-name dispatch.
export class BrainProviderBase {
  // kind: 'onnx' | 'http' | 'turret' (the chain reads it from its active provider).
  constructor(kind) {
    if (kind !== undefined) this.kind = kind;
    this.listeners = new Set();
  }

  get badge() { return BRAIN_PROVIDERS[this.kind]?.badge ?? ''; }

  // Loading progress: listener({ kind, task, stage, label, fraction, width? }).
  // Returns a function that removes the listener again.
  onProgress(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emitProgress(progress) {
    const event = { kind: this.kind, ...progress };
    for (const listener of [...this.listeners]) {
      try { listener(event); } catch { /* A broken progress view must not stop loading. */ }
    }
  }

  // The request names the game uses, mapped onto the methods below.
  request(path, payload) {
    switch (path) {
      case 'reset': return this.reset(payload);
      case 'step': return this.step(payload);
      case 'sense': return this.sense(payload);
      case 'sync': return this.sync(payload);
      case 'close': return this.close(payload?.token);
      default: return Promise.reject(new Error(`Unknown brain request ${path}`));
    }
  }

  load() { return Promise.resolve(null); }

  prepare() { return this.load(); }

  close() { return Promise.resolve({ closed: false }); }

  dispose() { this.listeners.clear(); }
}

// --- 3. No brain: turret mode -----------------------------------------------------------

// The last resort. It "loads" instantly and refuses every request with the
// reasons the real providers gave, which the game shows while it plays turret mode.
export class TurretBrainProvider extends BrainProviderBase {
  constructor({ reasons = [] } = {}) {
    super('turret');
    this.reasons = reasons;
  }

  get reason() {
    return this.reasons.length ? this.reasons.join('; ') : 'no brain selected (?brain=turret)';
  }

  refuse() {
    return Promise.reject(new BrainUnavailableError(`No brain could load: ${this.reason}`, { kind: 'turret' }));
  }

  reset() { return this.refuse(); }

  step() { return this.refuse(); }

  sense() { return this.refuse(); }

  sync() { return this.refuse(); }
}

// --- The fallback chain the game talks to -----------------------------------------------

// Tries each provider in order: the first one that loads answers every request
// from then on. When none loads, turret mode answers (it refuses everything),
// and the next reset tries the whole list again (the game retries every few
// seconds during a run). A refused request (e.g. a start inside a wall) never
// falls back: another provider would refuse it the same way.
export class BrainProviderChain extends BrainProviderBase {
  // candidates: [{ kind, create: () => provider }] in fallback order.
  constructor(candidates) {
    super();
    this.candidates = candidates;
    this.created = new Map();
    this.active = null;
    this.selecting = null;
    this.failures = [];
    // Which provider opened which session, so close() reaches the right one.
    this.owners = new Map();
    // Set by dispose(): a pick or a reset still on its way starts nothing more.
    this.disposed = false;
  }

  get kind() { return this.active?.kind ?? null; }

  // One provider instance per kind, created on first use and listened to.
  provider({ kind, create }) {
    if (!this.created.has(kind)) {
      const provider = create();
      provider.onProgress?.((event) => this.emitProgress(event));
      this.created.set(kind, provider);
    }
    return this.created.get(kind);
  }

  // Pick the first provider that loads (once; a failed pick is retried by the next reset).
  select() {
    if (!this.selecting) {
      this.selecting = (async () => {
        const failures = [];
        for (const candidate of this.candidates) {
          // Disposed while choosing (the mode ended, OPTIONS switched brains):
          // do not start the next provider (a worker, a server health check).
          if (this.disposed) break;
          let provider = null;
          try {
            provider = this.provider(candidate);
            await provider.load();
            if (this.disposed) {
              provider.dispose?.();
              break;
            }
            this.active = provider;
            this.failures = failures;
            return provider;
          } catch (error) {
            failures.push(`${BRAIN_PROVIDERS[candidate.kind]?.badge ?? candidate.kind}: ${error?.message || error}`);
            // Free a half-loaded provider; a later retry starts it from scratch.
            provider?.dispose?.();
            this.created.delete(candidate.kind);
          }
        }
        if (this.disposed) failures.push('the brain was shut down');
        this.failures = failures;
        this.active = new TurretBrainProvider({ reasons: failures });
        return this.active;
      })();
    }
    return this.selecting;
  }

  load() { return this.select(); }

  // Load the junkyard for one Leaper size ahead of the first reset (worker only).
  async prepare(width) {
    const provider = await this.select();
    return provider.prepare?.(width);
  }

  // A new episode: the provider that answers it owns the session's token.
  async reset(payload) {
    const provider = await this.select();
    try {
      const frame = await provider.reset(payload);
      // Disposed while this reset was on its way: nobody will use or close
      // that session, so close it now (the Python server would keep it).
      if (this.disposed) {
        if (frame?.token) provider.close?.(frame.token)?.catch?.(() => {});
        throw new BrainUnavailableError('The brain was shut down', { kind: provider.kind });
      }
      if (frame?.token) this.owners.set(frame.token, provider);
      return frame;
    } catch (error) {
      // Nothing (or nothing any more) can answer: the next reset picks again.
      if (isUnavailable(error)) this.forgetSelection();
      throw error;
    }
  }

  step(payload) { return this.forward('step', payload); }

  sense(payload) { return this.forward('sense', payload); }

  sync(payload) { return this.forward('sync', payload); }

  async forward(method, payload) {
    const provider = this.owners.get(payload?.token) ?? this.active;
    if (!provider) throw new BrainUnavailableError('No brain session yet', { kind: null });
    try {
      return await provider[method](payload);
    } catch (error) {
      if (isUnavailable(error)) this.forgetSelection();
      throw error;
    }
  }

  // Forget a session wherever it lives. Never throws (it is sent on the way out).
  async close(token) {
    const provider = this.owners.get(token);
    this.owners.delete(token);
    if (!provider) return { closed: false };
    try { return await provider.close(token); } catch { return { closed: false }; }
  }

  // The current pick failed: the next reset tries the list again (until then
  // `kind` still names the last pick, e.g. 'turret').
  forgetSelection() {
    this.selecting = null;
  }

  dispose() {
    this.disposed = true;
    for (const provider of this.created.values()) provider.dispose?.();
    this.created.clear();
    this.owners.clear();
    this.active = null;
    this.selecting = null;
    super.dispose();
  }
}

// --- Progress wording ---------------------------------------------------------------------

// One line for a loading event, e.g. "LOADING BRAIN · ONNX · IN BROWSER · 42% · DOWNLOADING RUNTIME".
// A wait whose length nobody knows (fraction null, e.g. the Python server
// building a new size) shows no percentage rather than a misleading 0%.
export function describeProgress(progress) {
  if (!progress) return '';
  const percent = Number.isFinite(progress.fraction)
    ? `${Math.round(Math.max(0, Math.min(1, progress.fraction)) * 100)}%` : null;
  const who = BRAIN_PROVIDERS[progress.kind]?.badge;
  const what = progress.task === 'world'
    ? `PREPARING LEAPER SIZE ${Number(progress.width).toFixed(1)}`
    : 'LOADING BRAIN';
  return [what, who, percent, progress.label].filter(Boolean).join(' · ');
}

// --- The default chain for this page ------------------------------------------------------

// factories: { onnx: () => provider, http: () => provider } (tests pass stand-ins;
// the game uses the real ones from createGameBrainProvider in JunkyardBrain.js).
export function createBrainProvider({ order = brainProviderOrder(), factories }) {
  return new BrainProviderChain(order.filter((kind) => factories[kind])
    .map((kind) => ({ kind, create: factories[kind] })));
}
