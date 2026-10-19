import { shortestAngle, wrapAngle } from '../../core/angles.js';
import { LEAPER_BEHAVIOUR } from '../../config/leaper-behaviour.js';

// Plays the brain's poses back smoothly (review fix 5.14).
//
// The brain answers with a new pose about 10 times a second (fewer when legs
// are lost). Chasing each reply with a filter made the body surge forward
// right after every reply and nearly stop before the next one, and a crippled
// Leaper lurched stop-go. Here the replies are "knots" on a path, and the drawn
// Leaper walks along that path at the brain's own pace (one knot per expected
// step interval), a little more than one step behind the newest reply. If
// replies come early or late, the pace adapts gently instead of jumping.
// Headings take the short way round, so it never whips through a full turn
// (review fix 5.3).
//
// Pure maths: no Three.js, no clock. The caller pushes poses and advances time.
export class SnapshotPlayout {
  constructor(config = LEAPER_BEHAVIOUR.motion) {
    this.config = config;
    this.reset({ x: 0, z: 0, yaw: 0 });
  }

  // Start over at a pose: nothing left to play.
  reset({ x, z, yaw }) {
    this.knots = [{ x, z, yaw }];
    this.head = 0;
    this.lag = this.config.targetLag;
    this.sinceReply = 0;
    this.interval = 0;
  }

  // The newest pose the brain has reported.
  get latest() {
    return this.knots[this.knots.length - 1];
  }

  // Steps still to be played (0 = the drawn Leaper is at the newest pose).
  get pending() {
    return this.knots.length - 1 - this.head;
  }

  // A brain reply. Returns false when nothing changed (a standstill, a preview).
  push({ x, z, yaw }) {
    const last = this.latest;
    const distance = Math.hypot(x - last.x, z - last.z);
    const turn = shortestAngle(last.yaw, yaw);
    // 1. Same pose: nothing to play.
    if (distance < 1e-6 && Math.abs(turn) < 1e-6) return false;
    // 2. A move the brain could never make in one step (a reset, a pose sync
    //    the brain refused): snap there instead of sliding across the yard.
    if (distance > this.config.snapDistance || Math.abs(turn) > this.config.snapTurnRadians) {
      this.reset({ x, z, yaw });
      return true;
    }
    // 3. A new knot. Its heading continues the previous one (no wrap), so the
    //    blend in between always turns the short way.
    this.knots.push({ x, z, yaw: last.yaw + turn });
    this.sinceReply = 0;
    // 4. Forget knots already walked past, and skip ahead after a long stall.
    const played = Math.floor(this.head);
    if (played > 0) {
      this.knots.splice(0, played);
      this.head -= played;
    }
    const excess = this.pending - this.config.maxLag;
    if (excess > 0) this.head += excess;
    return true;
  }

  // Walk the path for dt seconds. interval: the expected time between brain
  // steps (1 / (steps per second x mobility)).
  advance(dt, interval) {
    if (!(dt > 0) || !(interval > 0)) return;
    const c = this.config;
    // 1. A new interval (a leg lost) is eased in, so the body slows without a jolt.
    this.interval = this.interval ? this.interval + (interval - this.interval) * (1 - Math.exp(-dt / c.intervalEase)) : interval;
    // 2. How far behind the newest reply the body is, counting the part of a
    //    step since that reply: steady while replies keep their rhythm, so the
    //    pace does not pulse with each one. Smoothed against jittery replies.
    this.sinceReply += dt;
    const behind = this.pending + Math.min(this.sinceReply / this.interval, c.maxLag);
    this.lag += (behind - this.lag) * (1 - Math.exp(-dt / c.lagTime));
    // 3. The pace: the brain's own, a little faster when far behind, slower when close.
    let pace = Math.min(c.maxRate, Math.max(c.minRate, 1 + c.catchUp * (this.lag - c.targetLag)));
    // 4. Nearly out of path (a late reply): ease out instead of stopping dead.
    if (this.pending < c.easeOut) pace *= 0.25 + 0.75 * this.pending / c.easeOut;
    this.head = Math.min(this.head + pace * dt / this.interval, this.knots.length - 1);
  }

  // Where the drawn Leaper is now: { x, z, yaw } with yaw wrapped to one turn.
  sample(out = {}) {
    const index = Math.floor(this.head);
    const t = this.head - index;
    const a = this.knots[index];
    const b = this.knots[Math.min(index + 1, this.knots.length - 1)];
    out.x = a.x + (b.x - a.x) * t;
    out.z = a.z + (b.z - a.z) * t;
    out.yaw = wrapAngle(a.yaw + (b.yaw - a.yaw) * t);
    return out;
  }
}
