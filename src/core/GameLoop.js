// The one frame loop every mode runs on. Each frame goes through the same named
// phases in the same order, so new code always knows where it belongs:
//   input -> update (gameplay) -> lateUpdate (camera, sun, world-pinned HUD)
//   -> beforeRender -> render -> afterRender
// Gameplay uses the real (capped) frame time; there is deliberately no fixed-tick
// render interpolation. FixedStep below is for the few systems that need a
// steady rate (brain moves, automatic fire).

// Longest frame time the game ever simulates in one go, in seconds. A tab switch
// or a hitch then can't fling Lola or the Leaper across the map.
export const DEFAULT_MAX_DELTA = 0.1;

// Frame time in seconds, clamped to [0, cap]. Negative or broken values become 0,
// so the first frame after loading can never run backwards (review fix 5.35).
export function clampDelta(seconds, cap = DEFAULT_MAX_DELTA) {
  if (!(seconds > 0)) return 0;
  return Math.min(cap, seconds);
}

// Tiny allowance for rounding, so 6 frames of 1/60 s still count as one 0.1 s tick
// instead of waiting a whole extra frame for the last billionth of a second.
const TICK_EPSILON = 1e-9;

// Runs a callback at a steady rate from variable frame times. Leftover time is
// carried to the next frame (so 9.9 ms frames still give exactly 10 ticks per
// second over time), and a long hitch runs at most maxSteps ticks, dropping the
// rest instead of fast-forwarding the game.
export class FixedStep {
  constructor(step, { maxSteps = 5 } = {}) {
    if (!(step > 0)) throw new Error('FixedStep needs a positive step length');
    this.step = step;
    this.maxSteps = Math.max(1, Math.floor(maxSteps));
    this.remainder = 0;
  }

  // Add one frame's time and run tick(step, index) for every whole step now due.
  // Returns how many ticks ran this frame.
  advance(deltaTime, tick = () => {}) {
    if (deltaTime > 0) this.remainder += deltaTime;
    let ticks = 0;
    while (this.remainder + TICK_EPSILON >= this.step && ticks < this.maxSteps) {
      this.remainder = Math.max(0, this.remainder - this.step);
      tick(this.step, ticks);
      ticks += 1;
    }
    // Catch-up cap reached: keep only the part of a step still in progress.
    if (this.remainder + TICK_EPSILON >= this.step) this.remainder %= this.step;
    return ticks;
  }

  // How far (0-1) the clock is into the next step, for smoothing between ticks.
  get alpha() {
    return Math.min(1, this.remainder / this.step);
  }

  reset() {
    this.remainder = 0;
  }
}

// Calls a mode's phase hooks once per animation frame. A mode is an object with
// optional input / update / lateUpdate / beforeRender / afterRender functions
// (each taking dt where it makes sense) and an optional maxDelta cap.
export class GameLoop {
  constructor({
    mode,
    render,
    maxDelta = mode?.maxDelta ?? DEFAULT_MAX_DELTA,
    requestFrame = (callback) => requestAnimationFrame(callback),
    cancelFrame = (id) => cancelAnimationFrame(id),
  }) {
    this.mode = mode;
    this.render = render;
    this.maxDelta = maxDelta;
    this.requestFrame = requestFrame;
    this.cancelFrame = cancelFrame;
    this.previousTime = null;
    this.frameId = null;
    this.running = false;
    this.frameCount = 0;
    this.deltaTime = 0;
    this.tick = (timestamp) => this.frame(timestamp);
  }

  start() {
    if (this.running) return;
    this.running = true;
    // The first frame measures from its own timestamp, so it always runs with dt = 0.
    this.previousTime = null;
    this.frameId = this.requestFrame(this.tick);
  }

  stop() {
    this.running = false;
    if (this.frameId !== null) this.cancelFrame(this.frameId);
    this.frameId = null;
  }

  // One frame. The next frame is requested first, so an error thrown by a phase
  // is reported by the browser but never stops the game for good.
  frame(timestamp) {
    if (!this.running) return;
    this.frameId = this.requestFrame(this.tick);
    const elapsed = this.previousTime === null ? 0 : (timestamp - this.previousTime) / 1000;
    this.previousTime = timestamp;
    const dt = clampDelta(elapsed, this.maxDelta);
    this.deltaTime = dt;
    this.frameCount += 1;
    this.runPhases(dt);
  }

  // The fixed phase order. afterRender always runs once beforeRender has started,
  // so the temporary hide / fade tricks around render() are undone even if
  // something in between throws.
  runPhases(dt) {
    const mode = this.mode;
    mode.input?.(dt);
    mode.update?.(dt);
    mode.lateUpdate?.(dt);
    try {
      mode.beforeRender?.();
      this.render?.();
    } finally {
      mode.afterRender?.();
    }
  }
}
