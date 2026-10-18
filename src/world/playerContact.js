import contact from '../config/player-contact.json' with { type: 'json' };

// Lola and the Leaper touch where the Leaper actually is: its body plus three
// discs along each leg (the outer one covers a stepping foot), not one circle
// around the whole leg span, so Lola can walk up between its legs. The trained
// brain's server reads the same shape (rl/junkyard_env.py).
const shape = contact.leaperShape;

// Discs { x, z, r } covering the Leaper at a pose { x, z, yaw }.
export function leaperDiscs(pose) {
  const discs = [{ x: pose.x, z: pose.z, r: shape.bodyRadius }];
  for (const angle of shape.legAngles) {
    const sx = Math.sin(pose.yaw + angle), sz = Math.cos(pose.yaw + angle);
    for (const [distance, r] of shape.legPoints) discs.push({ x: pose.x + sx * distance, z: pose.z + sz * distance, r });
  }
  return discs;
}

// Gap between Lola (at x, z) and the nearest part of the Leaper; negative = overlapping.
export function leaperClearance(x, z, pose, scale) {
  const playerRadius = contact.playerRadius * scale;
  return Math.min(...leaperDiscs(pose).map(d => Math.hypot(x - d.x, z - d.z) - d.r - playerRadius));
}

// Distance from the Leaper's centre beyond which Lola can never touch it.
export function leaperReach(scale) {
  return Math.max(shape.bodyRadius, ...shape.legPoints.map(([distance, r]) => distance + r)) + contact.playerRadius * scale;
}

// Whether Lola, standing at `current`, may not move to (x, z) because of a
// Leaper. poses = { from, to, margin }: the rendered Leaper is somewhere between
// its last two server poses, so both count, minus `margin` while a move is in
// flight. Touching blocks moving further in, but always allows backing out.
export function leaperBlocksMove(x, z, current, { from, to, margin }, scale) {
  const clearance = (px, pz) => Math.min(leaperClearance(px, pz, from, scale), leaperClearance(px, pz, to, scale)) - margin;
  const next = clearance(x, z);
  if (next >= 0) return false;
  return next <= clearance(current.x, current.z);
}

// A blocker for WorldCollision.addDynamicBlocker. `leaper.contactPoses()` gives
// the Leaper's { from, to, margin } (see JunkyardBrain); `player.mesh.position`
// is where Lola stands now; the world's scale is read each time it is asked.
export function createLeaperBlocker(leaper, player, world) {
  return (x, z) => leaperBlocksMove(x, z, player.mesh.position, leaper.contactPoses(), world.scale);
}

export { contact };
