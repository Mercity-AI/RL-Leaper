// Keeps the game at 60 frames per second or better (owner, 2026-10-22) by
// drawing fewer pixels when the graphics card falls behind: below 57 fps the
// resolution steps down (15% at a time, never under minScale); after a steady
// stretch at 60 it tries one step back up, and if that drops the rate again it
// waits longer before the next try. Gameplay never changes, only sharpness.

// Frame rates per second, shares of the preset's resolution, times in seconds.
export const FRAME_TARGET = Object.freeze({
  // The rate to hold, and the average below which the resolution drops.
  fps: 60,
  low: 57,
  // Never draw fewer than this share of the preset's pixels (per side).
  minScale: 0.6,
  // Each step down / up multiplies the resolution by these.
  down: 0.85,
  up: 1.1,
  // The rate is judged over this long, and a change settles this long first.
  window: 1,
  settle: 1.5,
  // A step up is tried after this long at full rate...
  raiseAfter: 5,
  // ...but not within this long of a step down (doubled each time a try fails).
  lockout: 20,
  // A frame longer than this is a hidden tab or a pause in the page, not
  // drawing. (Single slow frames don't count either: the rate is judged from
  // the middle frame time of the window, so one hitch can't lower it.)
  hitch: 1,
});

// Where the last settled resolution is remembered (this browser only), so the
// next load starts there instead of stuttering down from full again.
export const RESOLUTION_KEY = 'leaper.resolutionScale';

export class AdaptiveResolution {
  // resolution: { scale, set(scale) } (the engine's). enabled(): whether to adapt now.
  // storage: where the settled scale is kept (localStorage in the game; none in tests).
  constructor({ resolution, target = FRAME_TARGET, enabled = () => true, storage = null }) {
    Object.assign(this, { resolution, target, enabled, storage });
    let saved = NaN;
    try { saved = Number(storage?.getItem(RESOLUTION_KEY)); } catch { /* Private storage. */ }
    if (enabled() && saved >= target.minScale && saved < 1) resolution.set(saved);
    this.last = null;
    this.times = [];
    this.time = 0;
    this.quiet = 0;
    this.good = 0;
    this.lockout = 0;
    this.lockoutLength = target.lockout;
    this.raised = false;
  }

  // Call once per frame with the time now (seconds).
  frame(now) {
    const dt = this.last === null ? 0 : now - this.last;
    this.last = now;
    if (!(dt > 0) || dt > this.target.hitch) return;
    this.lockout = Math.max(0, this.lockout - dt);
    if (this.quiet > 0) {
      this.quiet -= dt;
      return;
    }
    this.times.push(dt);
    this.time += dt;
    if (this.time < this.target.window) return;
    const sorted = this.times.sort((a, b) => a - b);
    const fps = 1 / sorted[Math.floor(sorted.length / 2)];
    this.times = [];
    this.time = 0;
    if (!this.enabled()) {
      if (this.resolution.scale !== 1) this.change(1);
      return;
    }
    this.judge(fps);
  }

  judge(fps) {
    const { target, resolution } = this;
    if (fps < target.low) {
      this.good = 0;
      // A step up that made it too slow: back down, and wait longer next time.
      if (this.raised) this.lockoutLength *= 2;
      this.raised = false;
      if (resolution.scale > target.minScale) {
        this.change(Math.max(target.minScale, resolution.scale * target.down));
        this.lockout = this.lockoutLength;
      }
      return;
    }
    this.raised = false;
    if (fps < target.fps - 1 || resolution.scale >= 1) {
      this.good = 0;
      return;
    }
    this.good += target.window;
    if (this.good >= target.raiseAfter && this.lockout <= 0) {
      this.good = 0;
      this.raised = true;
      this.change(Math.min(1, resolution.scale * target.up));
    }
  }

  change(scale) {
    this.resolution.set(scale);
    this.quiet = this.target.settle;
    try { this.storage?.setItem(RESOLUTION_KEY, String(this.resolution.scale)); } catch { /* Private storage. */ }
  }
}
