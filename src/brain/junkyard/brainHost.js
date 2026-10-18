// What runs inside the brain Web Worker, without the browser-only wiring (that
// lives in brainWorker.js), so Node tests can drive the very same code.
//
// It loads brain.json, the ONNX network, the junkyard GLB and the collision
// raster, then answers init / reset / step / sense messages one at a time,
// like the single-threaded Python server.

import contact from '../../config/player-contact.json' with { type: 'json' };
import eyeVision from '../../config/eye-vision.json' with { type: 'json' };
import { JunkyardBrainCore } from './brainSession.js';
import { JunkyardRaster } from './collisionRaster.js';
import { loadGlbTriangles } from './junkyardSight.js';
import { createJunkyardWorld } from './junkyardWorld.js';
import { OnnxPolicy } from './onnxPolicy.js';

async function fetchBytesDefault(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${url} (${response.status})`);
  return new Uint8Array(await response.arrayBuffer());
}

async function sha256Hex(bytes) {
  if (!globalThis.crypto?.subtle) return null; // plain-http LAN pages have no WebCrypto
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ort: onnxruntime module; glbUrl / collisionUrl: the junkyard map files;
// post(message): sends a reply to the page; fetchBytes(url): optional loader.
export function createBrainHost({ ort, glbUrl, collisionUrl, post, fetchBytes = fetchBytesDefault }) {
  let core = null;
  let manifest = null;
  let baseUrl = null;
  let glbTriangles = null;
  let collision = null;
  const worlds = new Map();
  const timings = { worlds: {} };

  // --- The junkyard at one Leaper size ----------------------------------------------
  // The baked raster when brain.json lists one for this width, else the same
  // raster built here from collision.json (bit-identical, ~0.1-0.4 s).
  async function loadWorld(width) {
    if (worlds.has(width)) {
      timings.world = { ...timings.worlds[width], cached: true };
      return worlds.get(width);
    }
    const started = performance.now();
    let baked = null;
    const entry = manifest.rasters?.[String(width)];
    if (entry) {
      baked = JunkyardRaster.decode(await fetchBytes(new URL(entry.file, baseUrl).href));
      // Only trust a file made for exactly this width and this map export;
      // otherwise fall through and build the raster from collision.json.
      if (baked.collisionSha256 !== entry.collision_sha256 || baked.raster.width !== width) baked = null;
    }
    if (!baked && !collision) collision = JSON.parse(new TextDecoder().decode(await fetchBytes(collisionUrl)));
    const fetchMs = performance.now() - started;
    const world = createJunkyardWorld({ width, glbTriangles, collision, baked });
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
  async function init(url) {
    const started = performance.now();
    baseUrl = url;
    manifest = JSON.parse(new TextDecoder().decode(await fetchBytes(new URL('brain.json', baseUrl).href)));
    const [model, glb] = await Promise.all([fetchBytes(new URL(manifest.onnx.file, baseUrl).href), fetchBytes(glbUrl)]);
    // Refuse a network file that is not the one brain.json vouches for.
    const digest = await sha256Hex(model);
    if (digest && digest !== manifest.onnx.sha256) throw new Error('actor.onnx does not match brain.json');
    timings.modelVerified = Boolean(digest);
    const policy = await OnnxPolicy.create(ort, model);
    glbTriangles = loadGlbTriangles(glb);
    core = new JunkyardBrainCore({ policy, loadWorld, contact, eyeVision, policySha256: manifest.policy_sha256 });
    timings.loadMs = performance.now() - started;
    return { manifest, timings: { loadMs: timings.loadMs, modelVerified: timings.modelVerified } };
  }

  // --- Requests, strictly one after another ---------------------------------------------
  let queue = Promise.resolve();
  function handle({ id, method, payload }) {
    queue = queue.then(async () => {
      const started = performance.now();
      try {
        let result;
        if (method === 'init') result = await init(payload.baseUrl);
        else if (!core) throw new Error('Brain worker is not loaded');
        else if (method === 'reset') result = await core.reset(payload);
        else if (method === 'step') result = await core.step(payload);
        else if (method === 'sense') result = await core.sense(payload);
        else throw new Error(`Unknown brain request ${method}`);
        post({ id, ok: true, result, ms: performance.now() - started,
          world: method === 'reset' ? timings.world : undefined });
      } catch (error) {
        post({ id, ok: false, error: error?.message || String(error), ms: performance.now() - started });
      }
    });
    return queue;
  }

  return { handle };
}
