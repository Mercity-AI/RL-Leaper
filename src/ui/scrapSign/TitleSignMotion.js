import { TITLE_SIGN } from '../../config/titleSign.js';

// How the title's sign and its tags move (owner, 2026-11-17: the first, made-up
// sway "looked weird", so this is real physics). Plain math, no page.
//
// The sign hangs level from two equal chains reaching far up off the screen, so
// it swings like a pendulum without turning; a gentle push in time with its own
// swing keeps it going. Each tag hangs from the one above it: it feels gravity
// less part of its hanging point's acceleration, and nothing else (no scripted
// wobble). It steps at a fixed rate, so it moves the same at any frame rate.
export class TitleSignMotion {
  constructor(config = TITLE_SIGN) {
    this.config = config;
    const { gravity, chain } = config.motion;
    this.omega = Math.sqrt(gravity / chain); // the swing's own rate (rad/s)
    this.setTags([]);
  }

  // heights: each tag's height, top to bottom. still: no motion at all (the
  // player asked for reduced motion). Starts the swing again, already settled.
  setTags(heights, { still = false } = {}) {
    const { motion, tag } = this.config;
    this.still = still;
    this.tags = heights.map((height, i) => {
      const wire = tag.wire[Math.min(i, tag.wire.length - 1)];
      return { height, wire, phi: 0, spin: 0, prev: null, prev2: null, length: wire + height * 0.55 };
    });
    this.psi = still ? 0 : -motion.sway / motion.chain;
    this.psiV = 0;
    this.time = 0;
    this.carry = 0;
    if (!still) for (let s = 0; s < motion.warmup * motion.rate; s++) this.step(1 / motion.rate);
  }

  // The sign's top-left corner now.
  sign() {
    const { sign, motion } = this.config;
    return { left: sign.x + motion.chain * Math.sin(this.psi), top: sign.y + motion.chain * (1 - Math.cos(this.psi)) };
  }

  // Each tag's hanging point and angle (phi: radians, positive swings its
  // bottom to the right).
  chain() {
    const { sign, tag } = this.config, at = this.sign();
    let x = at.left + sign.tagHole[0], y = at.top + sign.tagHole[1];
    return this.tags.map((t) => {
      const link = { x, y, phi: t.phi, wire: t.wire, height: t.height };
      const down = t.wire + t.height - tag.bottomHole;
      x += down * Math.sin(t.phi);
      y += down * Math.cos(t.phi);
      return link;
    });
  }

  step(h) {
    const { gravity: G, chain: L, drag, sway, tagShare, tagDamping } = this.config.motion;
    const push = this.still ? 0 : sway * drag * this.omega; // the push that keeps that sway
    this.psiV += (-(G / L) * Math.sin(this.psi) - drag * this.psiV + push * Math.sin(this.omega * this.time) / L) * h;
    this.psi += this.psiV * h;
    this.time += h;
    // Tags, top to bottom.
    this.chain().forEach(({ x, y }, i) => {
      const t = this.tags[i];
      if (!t.prev) { t.prev = [x, y]; t.prev2 = [x, y]; }
      const ax = (x - 2 * t.prev[0] + t.prev2[0]) / (h * h), ay = (y - 2 * t.prev[1] + t.prev2[1]) / (h * h);
      t.prev2 = t.prev;
      t.prev = [x, y];
      const gx = -ax * tagShare, gy = G - ay * tagShare;
      t.spin += ((gx * Math.cos(t.phi) - gy * Math.sin(t.phi)) / t.length - tagDamping * t.spin) * h;
      t.phi += t.spin * h;
    });
  }

  // Move on by dt seconds (fixed steps; a long stall counts as a tenth of a second).
  advance(dt) {
    if (!(dt > 0)) return;
    const h = 1 / this.config.motion.rate;
    this.carry = Math.min(this.carry + dt, 0.1);
    while (this.carry >= h) {
      this.step(h);
      this.carry -= h;
    }
  }

  // A small knock on tag i (the one just chosen); the ones below follow on their own.
  knock(i) {
    if (!this.still && this.tags[i]) this.tags[i].spin += this.config.motion.knock;
  }
}
