// Web Worker that runs the whole Leaper brain off the main thread: the frozen
// world rules (frozenEnv.js) and the saved network (actor.onnx through
// onnxruntime-web). The page talks to it through OnnxBrainProvider.js with the
// same reset / step / sense requests the Python server answers. The actual
// work is in brainHost.js; this file only wires it to the browser.

import * as ort from 'onnxruntime-web/wasm';
// Self-hosted runtime: Vite copies this .wasm into the build (no CDN needed).
import ortWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';
import { createBrainHost } from './brainHost.js';

// Single-threaded wasm: works on any static host (no cross-origin isolation).
ort.env.wasm.numThreads = 1;
ort.env.wasm.wasmPaths = { wasm: ortWasmUrl };

// The junkyard map files, emitted into the build by Vite like the game's own.
const host = createBrainHost({
  ort,
  glbUrl: new URL('../../../assets/maps/junkyard/junkyard.glb', import.meta.url).href,
  collisionUrl: new URL('../../../assets/maps/junkyard/collision.json', import.meta.url).href,
  post: (message) => self.postMessage(message),
});

self.onmessage = (event) => host.handle(event.data);
