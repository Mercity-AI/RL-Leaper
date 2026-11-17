import { SCRAP_SIGN } from '../../config/scrapSign.js';

// The scrap sign's motion: the sheet is one rigid body hanging on two chains,
// each a stiff spring that only pulls; gravity and air drag do the rest. Let
// go above the screen and a little to one side, it falls, the chains catch it
// with a jolt (one a moment before the other, so it jerks), and it sways and
// settles. The tags under it are pendulums pushed by the sheet's jolts.
//
// Plain maths, no page. Positions are in sign units with the sheet's resting
// middle at (0, 0), y pointing down; angles in radians.
export class ScrapSignPhysics {
  constructor(config = SCRAP_SIGN) {
    this.config = config;
    const { width, height } = config.size;
    // Chain holes relative to the sheet's middle.
    this.attach = config.chainHoles.map(([x, y]) => [x - width / 2, y - height / 2]);
    this.setTags(config.tagHoles.length);
    this.drop({ top: -2000 });
  }

  // How many tags hang under the sheet (one per menu item). Two use the
  // sheet's tag holes; any other number is spread evenly along its bottom.
  setTags(count) {
    const { width, height } = this.config.size, holes = this.config.tagHoles;
    this.tagHoles = count === holes.length ? holes.map((hole) => [...hole])
      : Array.from({ length: count }, (_, i) => [width * (i + 1) / (count + 1), holes[0][1]]);
    this.pivots = this.tagHoles.map(([x, y]) => [x - width / 2, y - height / 2]);
    this.tags = this.pivots.map(() => ({ phi: 0, spin: 0, prev: null, prev2: null }));
  }

  // Let the sign go. top: the screen's top edge in sign units (negative: above
  // the resting middle); the chains hang from above it and the sign starts out
  // of sight above it. still: hang it at rest at once (no fall; reduced motion).
  drop({ top, still = false }) {
    const { chain, drop, tag, size } = this.config;
    const attachY = this.attach[0][1];
    // Both chains hang from just above the screen's top (longer chains on a
    // taller screen); the right one is a little longer, so it rests crooked.
    const anchorY = Math.min(attachY - chain.length, top - 30);
    this.anchors = this.attach.map(([x]) => [x, anchorY]);
    this.lengths = [attachY - anchorY, attachY - anchorY + chain.skew];
    const lowest = size.height / 2 + tag.wire + tag.height + 20;
    this.body = { x: drop.offsetX, y: Math.min(-drop.minFall, top - lowest), a: drop.tilt, vx: 0, vy: 0, w: 0 };
    for (const t of this.tags) Object.assign(t, { phi: 0, spin: 0, prev: null, prev2: null });
    this.time = 0;
    if (still) {
      Object.assign(this.body, { x: 0, y: 0, a: 0 });
      this.advance(6); // settle out of sight of the player
      this.time = 0;
    }
  }

  // A point on the sheet ([x, y] from its middle) where it is now.
  point([lx, ly]) {
    const { x, y, a } = this.body, c = Math.cos(a), s = Math.sin(a);
    return [x + lx * c - ly * s, y + lx * s + ly * c];
  }

  // A push (e.g. a tag being pointed at): spin in radians/s.
  nudgeTag(index, spin) {
    if (this.tags[index]) this.tags[index].spin += spin;
  }

  // Run the motion on by dt seconds, in small fixed steps.
  advance(dt) {
    if (!(dt > 0)) return; // no time passed (the tags' push is measured over time)
    const steps = Math.max(1, Math.ceil(dt / this.config.step));
    for (let i = 0; i < steps; i++) this.step(dt / steps);
  }

  step(h) {
    const { gravity, chain, drag, tag, size } = this.config, body = this.body;
    const inertia = (size.width ** 2 + size.height ** 2) / 12; // a flat sheet, mass 1
    let fx = 0, fy = gravity, torque = 0;
    this.attach.forEach((at, i) => {
      const [px, py] = this.point(at), rx = px - body.x, ry = py - body.y;
      const dx = px - this.anchors[i][0], dy = py - this.anchors[i][1], dist = Math.hypot(dx, dy);
      const stretch = dist - this.lengths[i];
      if (stretch <= 0) return; // slack: a chain cannot push
      const nx = dx / dist, ny = dy / dist;
      const vpx = body.vx - body.w * ry, vpy = body.vy + body.w * rx;
      const pull = chain.stiffness * stretch + chain.damping * (vpx * nx + vpy * ny);
      if (pull <= 0) return;
      const cx = -pull * nx, cy = -pull * ny;
      fx += cx; fy += cy; torque += rx * cy - ry * cx;
    });
    body.vx += (fx - drag.move * body.vx) * h;
    body.vy += (fy - drag.move * body.vy) * h;
    body.w += (torque / inertia - drag.turn * body.w) * h;
    body.x += body.vx * h; body.y += body.vy * h; body.a += body.w * h;
    // The tags feel gravity less the sheet's own acceleration (only `push` of it).
    this.tags.forEach((t, i) => {
      const p = this.point(this.pivots[i]);
      if (!t.prev) { t.prev = p; t.prev2 = p; }
      const ax = (p[0] - 2 * t.prev[0] + t.prev2[0]) / (h * h), ay = (p[1] - 2 * t.prev[1] + t.prev2[1]) / (h * h);
      t.prev2 = t.prev; t.prev = p;
      const gx = -ax * tag.push, gy = gravity - ay * tag.push;
      t.spin += ((gx * Math.cos(t.phi) - gy * Math.sin(t.phi)) / tag.length - tag.damping * t.spin) * h;
      t.phi += t.spin * h;
    });
    this.time += h;
  }
}
