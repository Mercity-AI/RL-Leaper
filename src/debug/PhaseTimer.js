// Frame and phase timings for the developer perf overlay (finding
// perf-no-perf-overlay-or-budget). The game's frame phases report to it:
//   const start = timer.begin();  ...the phase...  timer.end('update', start);
// and timer.frame(now) once per frame. stats() then gives frames per second,
// the average and 95th-percentile frame time, and the average milliseconds per
// phase, over the last `window` frames. Players get a no-op stand-in (NO_TIMER),
// so the game pays nothing for it.

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

// The stand-in for players: no timing at all.
export const NO_TIMER = Object.freeze({ begin: () => 0, end() {}, frame() {} });

export class PhaseTimer {
  // window: how many recent frames the averages cover. clock(): milliseconds.
  constructor({ window = 120, clock = now } = {}) {
    this.window = window;
    this.clock = clock;
    this.frames = [];
    this.phases = new Map();
    this.lastFrame = null;
  }

  // A phase starts: returns the start time to hand to end().
  begin() {
    return this.clock();
  }

  // A phase ended: remember how long it took.
  end(name, start) {
    const samples = this.phases.get(name) ?? [];
    samples.push(this.clock() - start);
    if (samples.length > this.window) samples.shift();
    this.phases.set(name, samples);
  }

  // A new frame began (call once per frame): the time since the last one.
  frame(at = this.clock()) {
    if (this.lastFrame !== null) {
      this.frames.push(at - this.lastFrame);
      if (this.frames.length > this.window) this.frames.shift();
    }
    this.lastFrame = at;
  }

  // { fps, frameMs, p95Ms, phases: { name: averageMs } } over the window.
  stats() {
    const average = (list) => (list.length ? list.reduce((sum, value) => sum + value, 0) / list.length : 0);
    const sorted = [...this.frames].sort((a, b) => a - b);
    const frameMs = average(this.frames);
    const p95Ms = sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] : 0;
    const phases = {};
    for (const [name, samples] of this.phases) phases[name] = average(samples);
    return { fps: frameMs ? 1000 / frameMs : 0, frameMs, p95Ms, phases };
  }
}

// The renderer's own counters (three.js renderer.info) as plain numbers.
export function rendererCounts(info) {
  return {
    calls: info?.render?.calls ?? 0,
    triangles: info?.render?.triangles ?? 0,
    geometries: info?.memory?.geometries ?? 0,
    textures: info?.memory?.textures ?? 0,
    programs: info?.programs?.length ?? 0,
  };
}

// The overlay's three lines.
export function perfText({ fps, frameMs, p95Ms, phases }, counts) {
  const ms = (value) => (value ?? 0).toFixed(1);
  const phaseLine = ['input', 'update', 'late', 'render'].map((name) => `${name} ${ms(phases[name])}`).join(' · ');
  return [
    `${Math.round(fps)} fps · ${ms(frameMs)} ms (95% under ${ms(p95Ms)})`,
    `${phaseLine} ms`,
    `draws ${counts.calls} · tris ${Math.round(counts.triangles / 1000)}k · geo ${counts.geometries} · tex ${counts.textures} · shaders ${counts.programs}`,
  ].join('\n');
}
