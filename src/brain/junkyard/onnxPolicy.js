// The saved Leaper brain (public/brains/leaper_7757824/actor.onnx) run by
// onnxruntime. The file holds only the deterministic "actor": 34 inputs plus
// the LSTM memory in, the clipped [throttle, turn] action plus new memory out.
// scripts/export_brain_onnx.py made it and proved it matches the checkpoint.

const HIDDEN = 64;

export class OnnxPolicy {
  // `ort`: the onnxruntime module (onnxruntime-web in the browser, its Node
  // build in tests). `model`: the .onnx bytes (ArrayBuffer / Uint8Array) or URL.
  static async create(ort, model, options = {}) {
    const bytes = typeof model === 'string' ? new Uint8Array(await (await fetch(model)).arrayBuffer()) : model;
    const session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'], ...options });
    return new OnnxPolicy(ort, session);
  }

  constructor(ort, session) {
    this.ort = ort;
    this.session = session;
    this.zero = new Float32Array(HIDDEN);
  }

  // Same contract as model.predict(obs, state, episode_start, deterministic=True):
  // on the first step of a session the incoming memory is zero (SB3 multiplies
  // it by 1 - episode_start), afterwards the previous memory is carried on.
  async act(obs, memory, episodeStart) {
    const fresh = episodeStart || !memory;
    const { Tensor } = this.ort;
    const result = await this.session.run({
      obs: new Tensor('float32', Float32Array.from(obs), [1, 34]),
      h: new Tensor('float32', fresh ? this.zero : memory.h, [1, 1, HIDDEN]),
      c: new Tensor('float32', fresh ? this.zero : memory.c, [1, 1, HIDDEN]),
    });
    return {
      action: Float32Array.from(result.action.data),
      memory: { h: Float32Array.from(result.h_out.data), c: Float32Array.from(result.c_out.data) },
    };
  }
}
