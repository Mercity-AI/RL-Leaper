import { LOLA_COLLISION_STEP } from './lolaTuning.js';

// How many times one blocked step may slide along a new wall (corners need two).
const SLIDE_ATTEMPTS = 3;
// Bisection rounds used to walk up to a wall before sliding (to within a
// quarter of a ~2 cm step: invisible, and each round costs a collision test).
const APPROACH_ROUNDS = 2;
// Points tested around a blocked spot to find which way the wall faces, and
// bisection rounds that pin each edge of the free arc to within ~0.35 degree.
const RING_SAMPLES = 16;
const RING_REFINE = 6;
// A slide keeps this hair of clearance (units, times the map scale), so a
// rounding error never leaves her resting exactly on a surface she cannot leave.
const SKIN = 5e-4;
// The wall is felt this far past the contact point (units, times the map scale),
// and probed with a ring of PROBE_RADIUS around that spot.
const CONTACT_REACH = 0.002;
const PROBE_RADIUS = 0.02;
// A push within ~3 degrees of straight into a wall is a stop, not a slide.
const MIN_SLIDE = 0.05;

// Moves Lola's root across the map without entering anything solid, sliding
// along walls instead of stopping dead ("collide and slide").
//
// The world answers "is Lola's body blocked at (x, z)?" through
// world.playerBlocked, which the junkyard brain wraps to include the Leaper's
// legs, so the world is passed in on every call rather than remembered. The
// junkyard also offers world.playerContact(x, z) with the exact outward
// normal of the nearest map wall; for anything else (the Leaper, test walls)
// the normal is found by probing a small ring of points around the contact.
export class CharacterMover {
  // Move `position` (mutated in place) by `distance` along the unit `direction`.
  // Short steps keep her out of thin walls. Returns { moved, blocked }: how
  // far she really went and whether anything got in the way.
  move(world, position, direction, distance) {
    const startX = position.x, startZ = position.z;
    const steps = Math.max(1, Math.ceil(distance / (LOLA_COLLISION_STEP * world.scale)));
    let blocked = false;
    for (let step = 0; step < steps; step += 1) {
      const dx = direction.x * distance / steps;
      const dz = direction.z * distance / steps;
      if (this.step(world, position, dx, dz)) blocked = true;
    }
    return { moved: Math.hypot(position.x - startX, position.z - startZ), blocked };
  }

  // Is something solid right in front of her (used when the request is tiny)?
  blockedAhead(world, position, direction) {
    const reach = 0.01 * world.scale;
    return world.playerBlocked(position.x + direction.x * reach, position.z + direction.z * reach);
  }

  // One short step. Returns true if a wall changed the step.
  step(world, p, dx, dz) {
    // The whole step is free: take it.
    if (!world.playerBlocked(p.x + dx, p.z + dz)) {
      p.x += dx;
      p.z += dz;
      return false;
    }
    const startX = p.x, startZ = p.z;
    let mx = dx, mz = dz, previous = null;
    for (let attempt = 0; attempt < SLIDE_ATTEMPTS; attempt += 1) {
      // Walk up to the wall, keeping the rest of the step.
      const free = this.freeFraction(world, p, mx, mz);
      p.x += mx * free;
      p.z += mz * free;
      mx *= 1 - free;
      mz *= 1 - free;
      // Remove the part of the rest that points into the wall and keep the
      // part along it; a nearly head-on push simply stops.
      const normal = this.normal(world, p, mx, mz, previous);
      if (!normal) break;
      previous = normal;
      const into = mx * normal.x + mz * normal.z;
      if (into >= 0) break;
      const rest = Math.hypot(mx, mz);
      mx -= into * normal.x;
      mz -= into * normal.z;
      if (Math.hypot(mx, mz) < MIN_SLIDE * rest) break;
      // Lean out by the skin width so she never ends up resting on the surface.
      mx += normal.x * SKIN * world.scale;
      mz += normal.z * SKIN * world.scale;
      if (!world.playerBlocked(p.x + mx, p.z + mz)) {
        p.x += mx;
        p.z += mz;
        return true;
      }
    }
    // Nothing worked (a tight corner or an odd shape): fall back to trying the
    // x and z parts separately, as the original movement did.
    if (p.x === startX && p.z === startZ) {
      if (!world.playerBlocked(p.x + dx, p.z)) p.x += dx;
      if (!world.playerBlocked(p.x, p.z + dz)) p.z += dz;
    }
    return true;
  }

  // The largest share (0..1) of the move (mx, mz) she can take before touching.
  freeFraction(world, p, mx, mz) {
    let low = 0, high = 1;
    for (let round = 0; round < APPROACH_ROUNDS; round += 1) {
      const middle = (low + high) / 2;
      if (world.playerBlocked(p.x + mx * middle, p.z + mz * middle)) high = middle;
      else low = middle;
    }
    return low;
  }

  // Unit normal pointing out of whatever she touches when moving by (mx, mz)
  // from the contact point p, or null when no direction out can be found.
  // It is read just past the contact point, so a curved obstacle gives the
  // normal where she touches it, not where the step would have ended.
  normal(world, p, mx, mz, previous) {
    const length = Math.hypot(mx, mz);
    if (length < 1e-12) return null;
    const reach = Math.min(length, CONTACT_REACH * world.scale) / length;
    const x = p.x + mx * reach, z = p.z + mz * reach;
    // The map knows its exact wall normal; trust it unless it repeats the wall
    // this step already slid along (then something else, like the Leaper, blocks).
    const contact = world.playerContact?.(x, z);
    if (contact && !(previous && contact.nx * previous.x + contact.nz * previous.z > 0.9999)) {
      return { x: contact.nx, z: contact.nz };
    }
    return this.probeNormal(world, x, z, PROBE_RADIUS * world.scale);
  }

  // Probe a ring around the blocked spot: the free part of the ring faces away
  // from what blocks it. Pin down where the ring goes from blocked to free and
  // back, and point through the middle of that free arc. For a flat wall or a
  // round leg this is exactly the outward normal.
  probeNormal(world, x, z, radius) {
    const free = angle => !world.playerBlocked(x + Math.cos(angle) * radius, z + Math.sin(angle) * radius);
    const step = 2 * Math.PI / RING_SAMPLES;
    const samples = Array.from({ length: RING_SAMPLES }, (_, i) => free(i * step));
    const freeCount = samples.filter(Boolean).length;
    if (freeCount === 0 || freeCount === RING_SAMPLES) return null;
    const changes = samples.map((value, i) => (value !== samples[(i + 1) % RING_SAMPLES] ? i : -1)).filter(i => i >= 0);
    if (changes.length !== 2) {
      // An irregular shape: head toward the average free direction.
      let nx = 0, nz = 0;
      samples.forEach((value, i) => { if (value) { nx += Math.cos(i * step); nz += Math.sin(i * step); } });
      const length = Math.hypot(nx, nz);
      return length > 1e-9 ? { x: nx / length, z: nz / length } : null;
    }
    // Refine each boundary between its two neighbouring samples. Going
    // counter-clockwise, "opening" turns blocked into free, "closing" free into blocked.
    let opening = 0, closing = 0;
    for (const i of changes) {
      let a = i * step, b = (i + 1) * step;
      for (let round = 0; round < RING_REFINE; round += 1) {
        const middle = (a + b) / 2;
        if (free(middle) === samples[i]) a = middle;
        else b = middle;
      }
      if (samples[i]) closing = (a + b) / 2;
      else opening = (a + b) / 2;
    }
    const span = ((closing - opening) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
    const middle = opening + span / 2;
    return { x: Math.cos(middle), z: Math.sin(middle) };
  }
}
