import { LOLA_COLLISION_STEP } from './lolaTuning.js';

// Moves Lola's root across the map without entering anything solid. The world
// answers "is Lola's body blocked at (x, z)?" through world.playerBlocked,
// which the junkyard brain wraps to include the Leaper's legs, so the world is
// passed in on every call rather than remembered.
export class CharacterMover {
  // Move `position` (mutated in place) by `distance` along the unit `direction`.
  // Short steps keep her out of thin walls; each step tries the x and z parts
  // separately, so she slides along walls that line up with the map axes.
  // Returns how far she really moved.
  move(world, position, direction, distance) {
    const startX = position.x, startZ = position.z;
    const steps = Math.max(1, Math.ceil(distance / (LOLA_COLLISION_STEP * world.scale)));
    for (let step = 0; step < steps; step += 1) {
      const dx = direction.x * distance / steps;
      const dz = direction.z * distance / steps;
      if (!world.playerBlocked(position.x + dx, position.z)) position.x += dx;
      if (!world.playerBlocked(position.x, position.z + dz)) position.z += dz;
    }
    return Math.hypot(position.x - startX, position.z - startZ);
  }

  // Is something solid right in front of her (used when the request is tiny)?
  blockedAhead(world, position, direction) {
    const reach = 0.01 * world.scale;
    return world.playerBlocked(position.x + direction.x * reach, position.z + direction.z * reach);
  }
}
