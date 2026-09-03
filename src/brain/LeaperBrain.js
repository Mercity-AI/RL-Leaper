// LeaperBrain — runs the trained champion brain live in the browser.
//
// The brain itself is the tiny file public/leaper.onnx (25 KB), exported from
// the champion PPO_25 run. This wrapper's whole job is:
//   1. load()  — start the engine and open the brain file (once, on page load).
//   2. think() — hand the brain 26 numbers, get 2 numbers back (every frame).
//
// The engine that actually does the thinking is onnxruntime-web, made by
// Microsoft. We never see its guts; we just feed it and read its answer.

import * as ort from 'onnxruntime-web/wasm';

// Configure the engine for plain static hosting (Netlify, itch, anywhere):
//   - single-threaded, so it needs no special cross-origin security headers
//     that free hosts don't provide.
//   - load its WebAssembly files from the version-matched public CDN, which
//     works identically in local dev and on the deployed site (no bundler
//     tricks, no /public import rules to fight).
ort.env.wasm.numThreads = 1;
ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.29.0/dist/';

// The brain answers with two raw numbers. Before we use them, we squeeze each
// into the range the robot was trained on — exactly what training did.
//   throttle: 0 (stop) .. 1 (full go)
//   turn:    -1 (hard left) .. 1 (hard right)
const ACTION_LOW = [0.0, -1.0];
const ACTION_HIGH = [1.0, 1.0];

const OBS_SIZE = 26; // 16 vision rays + 10 self-facts

export class LeaperBrain {
  constructor(modelUrl = '/leaper.onnx') {
    this.modelUrl = modelUrl;
    this.session = null;
  }

  // Open the brain file and get the engine ready. Call once, and wait for it.
  async load() {
    this.session = await ort.InferenceSession.create(this.modelUrl);
    return this;
  }

  // Give the brain what it sees (26 numbers); get back [throttle, turn].
  async think(observation) {
    if (!this.session) {
      throw new Error('LeaperBrain.think() called before load() finished.');
    }
    if (observation.length !== OBS_SIZE) {
      throw new Error(
        `Brain expects ${OBS_SIZE} numbers, got ${observation.length}.`,
      );
    }

    // Package the 26 numbers the way the engine expects (a 1-row grid).
    const input = new ort.Tensor(
      'float32',
      Float32Array.from(observation),
      [1, OBS_SIZE],
    );

    const result = await this.session.run({ observation: input });
    const raw = result.action.data; // two raw numbers

    // Squeeze into the allowed range, same as training.
    const throttle = clamp(raw[0], ACTION_LOW[0], ACTION_HIGH[0]);
    const turn = clamp(raw[1], ACTION_LOW[1], ACTION_HIGH[1]);
    return [throttle, turn];
  }
}

function clamp(value, low, high) {
  return Math.max(low, Math.min(high, value));
}
