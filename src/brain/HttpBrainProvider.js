import { BrainProviderBase, BrainUnavailableError } from './BrainProvider.js';

// The Leaper brain in the local Python service (rl/junkyard_server.py), over
// HTTP: the original way the game ran the brain, now the reference the
// in-browser brain is checked against, and the fallback when it cannot load.
// Chosen with ?brain=http, or automatically when ONNX fails to load.

// --- Where the service lives ----------------------------------------------------------

// The brain service's address when nothing else is configured (the owner's PC).
export const DEFAULT_BRAIN_URL = 'http://127.0.0.1:8767';

// VITE_BRAIN_URL when the game is built (or the dev server started), else
// ?brainUrl= in the page address, else the default. Only http(s) addresses are
// accepted; anything else falls back to the default.
export function brainServiceUrl({
  envUrl = import.meta.env?.VITE_BRAIN_URL,
  search = globalThis.location?.search ?? '',
} = {}) {
  for (const candidate of [envUrl, new URLSearchParams(search).get('brainUrl')]) {
    if (!candidate) continue;
    try {
      const url = new URL(candidate);
      if (url.protocol === 'http:' || url.protocol === 'https:') return url.href.replace(/\/+$/, '');
    } catch { /* Not an address: try the next source. */ }
  }
  return DEFAULT_BRAIN_URL;
}

// --- Timing ---------------------------------------------------------------------------

// Seconds-scale limits, in milliseconds. The first reset at a new Leaper size
// may build its collision raster (~30 s in Python), so it gets much longer.
const TIMEOUT_MS = Object.freeze({ health: 3000, reset: 90000, step: 3000, sense: 3000, sync: 3000, close: 3000 });

// The identity the service must report before the game trusts it.
const MODEL_STEP = 7757824;

export class HttpBrainProvider extends BrainProviderBase {
  // fetch / sendBeacon / pageEvents are injectable so Node tests run without a server.
  constructor({
    url = brainServiceUrl(), fetch = globalThis.fetch?.bind(globalThis),
    sendBeacon = globalThis.navigator?.sendBeacon?.bind(globalThis.navigator),
    pageEvents = globalThis.addEventListener ? globalThis : null,
  } = {}) {
    super('http');
    this.url = url;
    this.fetch = fetch;
    this.sendBeacon = sendBeacon;
    this.health = null;
    // Sessions opened here and not yet closed: told to the server when the page goes away.
    this.tokens = new Set();
    // 1. Leaving the page (closing the tab, reloading, APPLY SIZE) frees this
    //    page's sessions on the server at once instead of waiting for eviction.
    this.lifetime = new AbortController();
    pageEvents?.addEventListener?.('pagehide', () => this.closeAllOnExit(), { signal: this.lifetime.signal });
  }

  get tooltipDetail() { return `at ${this.url}`; }

  // --- Lifecycle -------------------------------------------------------------------

  // "Loading" the service = checking it answers and runs the approved checkpoint.
  async load() {
    if (this.health) return this.health;
    this.emitProgress({ task: 'load', stage: 'connect', label: 'CONNECTING TO THE PYTHON SERVER', fraction: 0 });
    let response, health;
    try {
      response = await this.fetch(`${this.url}/`, { method: 'GET', signal: AbortSignal.timeout(TIMEOUT_MS.health) });
      health = await response.json();
    } catch (error) {
      throw new BrainUnavailableError(`no brain service at ${this.url} (${error?.message || error})`, { kind: 'http', cause: error });
    }
    if (!response.ok || health?.model_step !== MODEL_STEP) {
      throw new BrainUnavailableError(`the service at ${this.url} is not the 7,757,824-step brain`, { kind: 'http' });
    }
    this.health = health;
    this.emitProgress({ task: 'load', stage: 'ready', label: 'PYTHON SERVER READY', fraction: 1 });
    return health;
  }

  // The page is going away: a beacon still gets through while the page unloads.
  closeAllOnExit() {
    for (const token of this.tokens) {
      try { this.sendBeacon?.(`${this.url}/close`, JSON.stringify({ token })); } catch { /* Best effort. */ }
    }
    this.tokens.clear();
  }

  dispose() {
    this.lifetime.abort();
    this.health = null;
    super.dispose();
  }

  // --- The server's requests ------------------------------------------------------------

  // One POST. Plain-text content type makes it a "simple" request: no extra
  // permission (CORS preflight) round trip before every move. The body is still JSON.
  async post(path, payload) {
    let response;
    try {
      response = await this.fetch(`${this.url}/${path}`, {
        method: 'POST', headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify(payload), signal: AbortSignal.timeout(TIMEOUT_MS[path] ?? 3000),
      });
    } catch (error) {
      // Unreachable or too slow: the game may retry, or fall back to another
      // brain; the next load() checks the service's health again.
      this.health = null;
      const failure = new Error(error?.name === 'TimeoutError' ? `Brain ${path} timed out` : (error?.message || 'Failed to fetch'));
      failure.unavailable = true;
      throw failure;
    }
    const result = await response.json();
    // Refused requests keep the server's own wording (e.g. "Session expired. Reset Leaper to reconnect").
    if (!response.ok) throw new Error(result.error || 'Brain service failed');
    return result;
  }

  async reset(payload) {
    const frame = await this.post('reset', payload);
    if (frame?.token) this.tokens.add(frame.token);
    return frame;
  }

  step(payload) { return this.post('step', payload); }

  sense(payload) { return this.post('sense', payload); }

  // Pose sync: game logic moved the Leaper between moves (see rl/junkyard_server.py /sync).
  sync(payload) { return this.post('sync', payload); }

  // Forget a session (RESET, a soft episode restart, the session ending).
  async close(token) {
    if (!token) return { closed: false };
    this.tokens.delete(token);
    try { return await this.post('close', { token }); } catch { return { closed: false }; }
  }
}
