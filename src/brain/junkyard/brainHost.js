// What runs inside the brain Web Worker, without the browser-only wiring (that
// lives in brainWorker.js), so Node tests can drive the very same code.
//
// It loads brain.json, the onnxruntime WebAssembly, the ONNX network, the
// junkyard GLB and the collision raster, then answers init / prepare / reset /
// step / sense / sync / close messages one at a time, like the single-threaded
// Python server. While a message is loading something it also posts
// { id, progress } messages, which the page shows in its loading UI.

import contact from '../../config/player-contact.json' with { type: 'json' };
import eyeVision from '../../config/eye-vision.json' with { type: 'json' };
import { JunkyardBrainCore } from './brainSession.js';
import { JunkyardRaster } from './collisionRaster.js';
import { loadGlbTriangles } from './junkyardSight.js';
import { createJunkyardWorld } from './junkyardWorld.js';
import { OnnxPolicy } from './onnxPolicy.js';

// --- Downloads ----------------------------------------------------------------------

// Fetch a file, reporting bytes as they arrive: onBytes(loaded, total | 0).
async function fetchBytesDefault(url, onBytes = null) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${url} (${response.status})`);
  const total = Number(response.headers.get('Content-Length')) || 0;
  if (!onBytes || !response.body?.getReader) return new Uint8Array(await response.arrayBuffer());
  const reader = response.body.getReader();
  const chunks = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onBytes(loaded, total);
  }
  const bytes = new Uint8Array(loaded);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  return bytes;
}

async function sha256Hex(bytes) {
  if (!globalThis.crypto?.subtle) return null; // plain-http LAN pages have no WebCrypto
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((b) => b.toString(16).padStart(2, '0')).join('');
}

// --- Progress -----------------------------------------------------------------------

// Weighted stages of one loading task. Each stage reports 0..1; the task's
// overall fraction is the weighted sum. Updates are posted at most every 40 ms
// (plus every stage change), so a fast download does not flood the page.
function progressTracker(report, task, stages, extra = {}) {
  const total = Object.values(stages).reduce((sum, { weight }) => sum + weight, 0);
  const done = Object.fromEntries(Object.keys(stages).map((name) => [name, 0]));
  let last = 0;
  let lastStage = null;
  return function update(stage, fraction) {
    if (!(stage in stages)) return;
    done[stage] = Math.max(done[stage], Math.min(1, fraction));
    const now = performance.now();
    if (stage === lastStage && fraction < 1 && now - last < 40) return;
    last = now;
    lastStage = stage;
    const overall = Object.entries(stages).reduce((sum, [name, { weight }]) => sum + weight * done[name], 0) / total;
    report({ task, stage, label: stages[stage].label, fraction: overall, ...extra });
  };
}

// ort: onnxruntime module; glbUrl / collisionUrl: the junkyard map files;
// wasmUrl: the onnxruntime .wasm (downloaded here with progress; optional);
// post(message): sends a reply to the page; fetchBytes(url, onBytes): optional loader.
export function createBrainHost({ ort, glbUrl, collisionUrl, wasmUrl = null, post, fetchBytes = fetchBytesDefault }) {
  let core = null;
  let manifest = null;
  let baseUrl = null;
  let glbTriangles = null;
  let collision = null;
  const worlds = new Map();
  const timings = { worlds: {} };

  // --- The junkyard at one Leaper size ----------------------------------------------
  // The baked raster when brain.json lists one for this width, else the same
  // raster built here from collision.json (bit-identical, ~0.1-0.4 s). Building
  // happens in this worker, so the page keeps running; progress is reported.
  async function loadWorld(width, report = () => {}) {
    if (worlds.has(width)) {
      timings.world = { ...timings.worlds[width], cached: true };
      return worlds.get(width);
    }
    const started = performance.now();
    let baked = null;
    const entry = manifest.rasters?.[String(width)];
    // Stages of this size's loading: a baked file is one small download; any
    // other size downloads collision.json once and builds its raster here.
    const stages = (isBaked) => progressTracker(report, 'world', isBaked
      ? { raster: { weight: 1, label: 'COLLISION MAP (BAKED)' }, sight: { weight: 2, label: 'SIGHT GRID' } }
      : { download: { weight: 5, label: 'DOWNLOADING COLLISION MAP' }, raster: { weight: 3, label: 'BUILDING COLLISION MAP' },
        sight: { weight: 2, label: 'SIGHT GRID' } }, { width });
    let progress = stages(Boolean(entry));
    if (entry) {
      progress('raster', 0);
      baked = JunkyardRaster.decode(await fetchBytes(new URL(entry.file, baseUrl).href, (n, of) => of && progress('raster', 0.9 * n / of)));
      // Only trust a file made for exactly this width and this map export;
      // otherwise fall through and build the raster from collision.json.
      if (baked.collisionSha256 !== entry.collision_sha256 || baked.raster.width !== width) {
        baked = null;
        progress = stages(false);
      }
    }
    if (!baked && !collision) {
      progress('download', 0);
      const bytes = await fetchBytes(collisionUrl, (n, of) => of && progress('download', n / of));
      collision = JSON.parse(new TextDecoder().decode(bytes));
    }
    progress(baked ? 'raster' : 'download', 1);
    const fetchMs = performance.now() - started;
    const world = createJunkyardWorld({ width, glbTriangles, collision, baked,
      onProgress: (stage, fraction) => progress(stage, fraction) });
    progress('sight', 1);
    // Keep a few sizes; the size slider rarely visits more.
    if (worlds.size >= 3) worlds.delete(worlds.keys().next().value);
    worlds.set(width, world);
    // rasterMs = download + decode (baked) or download + build (other sizes).
    timings.worlds[width] = { width, source: world.rasterSource, rasterMs: fetchMs + world.rasterMs,
      sightMs: world.sightMs, totalMs: performance.now() - started, cached: false };
    timings.world = timings.worlds[width];
    return world;
  }

  // --- Loading the brain itself --------------------------------------------------------
  async function init(url, report) {
    const started = performance.now();
    baseUrl = url;
    const progress = progressTracker(report, 'load', {
      manifest: { weight: 1, label: 'BRAIN.JSON' },
      ...(wasmUrl ? { runtime: { weight: 60, label: 'DOWNLOADING BRAIN RUNTIME' } } : {}),
      map: { weight: 15, label: 'DOWNLOADING JUNKYARD MAP' },
      network: { weight: 3, label: 'DOWNLOADING NETWORK' },
      compile: { weight: 10, label: 'STARTING THE NETWORK' },
    });
    progress('manifest', 0);
    manifest = JSON.parse(new TextDecoder().decode(await fetchBytes(new URL('brain.json', baseUrl).href)));
    progress('manifest', 1);
    // The runtime, the network and the map download together.
    const [model, glb, runtime] = await Promise.all([
      fetchBytes(new URL(manifest.onnx.file, baseUrl).href, (n, of) => progress('network', n / (of || manifest.onnx.bytes))),
      fetchBytes(glbUrl, (n, of) => of && progress('map', n / of)),
      wasmUrl ? fetchBytes(wasmUrl, (n, of) => of && progress('runtime', n / of)) : null,
    ]);
    for (const stage of ['network', 'map', ...(wasmUrl ? ['runtime'] : [])]) progress(stage, 1);
    // Refuse a network file that is not the one brain.json vouches for.
    const digest = await sha256Hex(model);
    if (digest && digest !== manifest.onnx.sha256) throw new Error('actor.onnx does not match brain.json');
    timings.modelVerified = Boolean(digest);
    // Hand the runtime bytes we already have to onnxruntime (no second download).
    if (runtime) ort.env.wasm.wasmBinary = runtime;
    progress('compile', 0);
    const policy = await OnnxPolicy.create(ort, model);
    glbTriangles = loadGlbTriangles(glb);
    core = new JunkyardBrainCore({ policy, loadWorld: (width) => loadWorld(width, report), contact, eyeVision,
      policySha256: manifest.policy_sha256 });
    progress('compile', 1);
    timings.loadMs = performance.now() - started;
    return { manifest, timings: { loadMs: timings.loadMs, modelVerified: timings.modelVerified } };
  }

  // --- Requests, strictly one after another ---------------------------------------------
  // `report` is the progress sink of the message being handled (one at a time).
  let report = () => {};
  let queue = Promise.resolve();
  function handle({ id, method, payload }) {
    queue = queue.then(async () => {
      const started = performance.now();
      // Progress of whatever this message loads goes back tagged with its id.
      report = (progress) => post({ id, progress });
      try {
        let result;
        if (method === 'init') result = await init(payload.baseUrl, (progress) => report(progress));
        else if (!core) throw new Error('Brain worker is not loaded');
        else if (method === 'prepare') {
          await loadWorld(Number(payload.width), (progress) => report(progress));
          result = { world: timings.world };
        } else if (method === 'reset') result = await core.reset(payload);
        else if (method === 'step') result = await core.step(payload);
        else if (method === 'sense') result = await core.sense(payload);
        else if (method === 'sync') result = await core.sync(payload);
        else if (method === 'close') result = core.close(payload);
        else throw new Error(`Unknown brain request ${method}`);
        post({ id, ok: true, result, ms: performance.now() - started,
          world: method === 'reset' || method === 'prepare' ? timings.world : undefined });
      } catch (error) {
        post({ id, ok: false, error: error?.message || String(error), ms: performance.now() - started });
      } finally {
        report = () => {};
      }
    });
    return queue;
  }

  return { handle };
}
