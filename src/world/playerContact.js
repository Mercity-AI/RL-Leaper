import contact from '../config/player-contact.json' with { type: 'json' };

// Lola and the Leaper touch where the Leaper actually is: its body plus three
// discs along each leg (the outer one covers a stepping foot), not one circle
// around the whole leg span, so Lola can walk up between its legs. The trained
// brain's server reads the same shape (rl/junkyard_env.py).
//
// Contact rules v4: a severed leg (shot off at any joint, its stump curled up
// under the body) keeps only its first `severedLegPoints` disc(s), the stump by
// the hip, so Lola can walk through the gap it leaves. This is only the
// Lola-contact rule added for the junkyard; the brain's own map-collision discs
// (the frozen recipe's 19 discs) are never changed.
const shape = contact.leaperShape;
const NO_LEGS = Object.freeze([]);
// The stump's discs: the first ones from the hip outward.
const STUMP_POINTS = shape.legPoints.slice(0, shape.severedLegPoints ?? shape.legPoints.length);

// The rig's severed legs as contact leg indices (the rig's leg order is the
// legAngles order), for contactPoses() and the brain's `disabled_legs`.
export function severedLegs(rig) {
  return rig?.legs?.filter((leg) => leg.disabled).map((leg) => leg.index) ?? [];
}

// Discs { x, z, r } covering the Leaper at a pose { x, z, yaw }.
// disabledLegs: indices of severed legs (they keep only their stump disc).
export function leaperDiscs(pose, disabledLegs = NO_LEGS) {
  const discs = [{ x: pose.x, z: pose.z, r: shape.bodyRadius }];
  shape.legAngles.forEach((angle, index) => {
    const sx = Math.sin(pose.yaw + angle), sz = Math.cos(pose.yaw + angle);
    const points = disabledLegs.includes(index) ? STUMP_POINTS : shape.legPoints;
    for (const [distance, r] of points) discs.push({ x: pose.x + sx * distance, z: pose.z + sz * distance, r });
  });
  return discs;
}

// Gap between Lola (at x, z) and the nearest part of the Leaper; negative = overlapping.
export function leaperClearance(x, z, pose, scale, disabledLegs = NO_LEGS) {
  const playerRadius = contact.playerRadius * scale;
  return Math.min(...leaperDiscs(pose, disabledLegs).map(d => Math.hypot(x - d.x, z - d.z) - d.r - playerRadius));
}

// Distance from the Leaper's centre beyond which Lola can never touch it.
export function leaperReach(scale) {
  return Math.max(shape.bodyRadius, ...shape.legPoints.map(([distance, r]) => distance + r)) + contact.playerRadius * scale;
}

// Whether Lola, standing at `current`, may not move to (x, z) because of a
// Leaper. poses = { from, to, margin, disabledLegs }: the rendered Leaper is
// somewhere between its last two poses, so both count, minus `margin` while a
// move is in flight. Touching blocks moving further in, but always allows backing out.
export function leaperBlocksMove(x, z, current, { from, to, margin, disabledLegs = NO_LEGS }, scale) {
  const clearance = (px, pz) => Math.min(leaperClearance(px, pz, from, scale, disabledLegs),
    leaperClearance(px, pz, to, scale, disabledLegs)) - margin;
  const next = clearance(x, z);
  if (next >= 0) return false;
  return next <= clearance(current.x, current.z);
}

// A blocker for WorldCollision.addDynamicBlocker. `leaper.contactPoses()` gives
// the Leaper's { from, to, margin, disabledLegs } (see JunkyardBrain and
// LeaperLocomotion), or null while it touches nothing (high in a leap);
// `player.mesh.position` is where Lola stands now; the world's scale is read
// each time it is asked.
export function createLeaperBlocker(leaper, player, world) {
  return (x, z) => {
    const poses = leaper.contactPoses();
    return poses ? leaperBlocksMove(x, z, player.mesh.position, poses, world.scale) : false;
  };
}

export { contact };
