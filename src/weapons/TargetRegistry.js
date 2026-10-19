// Everything Lola's bullets can hit, besides the map. Each enemy registers one
// target; a shot asks the registry for the nearest hit across all of them, and
// only the enemy that was hit takes the damage. Two Leapers (or a new enemy
// type) can then be shot independently, and the gun never reaches into one
// particular rig.
//
// A target is a plain object:
//   update()                               move its hit volumes to the current pose
//   raycast(origin, direction, far)        nearest hit on it, or null
//   applyHit(hit, { damage, direction })   take the bullet; returns what happened:
//                                          { zone, weakPoint, brokeJoint, killed }
//   active() (optional)                    false while it can't be hit at all
export class TargetRegistry {
  constructor() {
    this.targets = new Set();
  }

  // Register a target. Returns a function that removes it again.
  add(target) {
    this.targets.add(target);
    return () => this.targets.delete(target);
  }

  get size() {
    return this.targets.size;
  }

  // Bring every target's hit volumes up to date (once per shot or per frame).
  update() {
    for (const target of this.targets) target.update?.();
  }

  // The nearest hit across every active target within `far`, with the target it
  // belongs to: { ...hit, target } or null.
  raycast(origin, direction, far = Infinity) {
    let best = null;
    for (const target of this.targets) {
      if (target.active && !target.active()) continue;
      const hit = target.raycast(origin, direction, best ? best.distance : far);
      if (hit && (!best || hit.distance < best.distance)) best = { ...hit, target };
    }
    return best;
  }

  // Forget every target (the session is over).
  clear() {
    this.targets.clear();
  }
}
