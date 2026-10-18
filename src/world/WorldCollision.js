// One place that answers "can Lola stand here?". It combines the map's fixed
// collision with any number of moving blockers (today: each Leaper's body and
// legs), instead of systems wrapping world.playerBlocked one inside another.
export class WorldCollision {
  // mapBlocked(x, z): the level's own fixed test (walls, props).
  constructor({ mapBlocked = () => false } = {}) {
    this.mapBlocked = mapBlocked;
    this.blockers = new Set();
  }

  // Add a moving blocker fn(x, z) -> true when Lola may not move to (x, z).
  // Returns a function that removes it again.
  addDynamicBlocker(blocker) {
    this.blockers.add(blocker);
    return () => this.removeDynamicBlocker(blocker);
  }

  // Take a moving blocker out again (the same function that was added).
  removeDynamicBlocker(blocker) {
    this.blockers.delete(blocker);
  }

  // The map first (cheap and most common), then every moving blocker.
  playerBlocked(x, z) {
    if (this.mapBlocked(x, z)) return true;
    for (const blocker of this.blockers) if (blocker(x, z)) return true;
    return false;
  }
}

// Give a freshly built world its collision service. Everything that already asks
// world.playerBlocked (Lola's movement, the TOP-view placement) now goes through
// it, and moving blockers register on world.collision.
export function attachWorldCollision(world) {
  const collision = new WorldCollision({ mapBlocked: world.playerBlocked ?? (() => false) });
  world.collision = collision;
  world.playerBlocked = (x, z) => collision.playerBlocked(x, z);
  return collision;
}
