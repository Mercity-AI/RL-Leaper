// Distances/speeds are in source-map units and scale with the junkyard.
export const COMBAT = Object.freeze({
  lolaHealth: 100, leaperHealth: 600, boltDamage: 8,
  projectileSpeed: 80, weaponRange: 22,
  laserLength: 2.2, laserRadius: 0.012, lowHealthThreshold: 20,
  // A shot every shotInterval + warning seconds while Lola stays in view
  // (1.73 s = 1.5x as often as the original 2.6 s; the 0.6 s warning glow is kept).
  warning: 0.6, aimLock: 0.2, shotInterval: 1.13, recovery: 0.35,
  yawLimit: Math.PI / 4, pitchDown: -70 * Math.PI / 180,
  pitchUp: 80 * Math.PI / 180, detectionHalfAngle: 135 * Math.PI / 180,
  bodyRadius: 0.23, headRadius: 0.17, debugDamage: 100,
  // Bullets hitting the red core in the Leaper's eye do this many times normal damage.
  weakPointMultiplier: 2,
  // Floating Leaper health bar: shows when at least burstShare of full health is
  // lost within burstWindow seconds (or a joint snaps), then fades after showTime.
  healthBar: Object.freeze({ burstShare: 0.02, burstWindow: 2, showTime: 3.5 }),
  // Camera shake strength (0-1) added per event; it fades out over about a second.
  cameraShake: Object.freeze({ bigHit: 0.7, legLanding: 0.5 }),
  // Leg rules (review fix 5.7). Each lost leg slows the brain's step clock by
  // mobilityPerLeg, never below minMobility (the limp). Losing maxLost legs
  // knocks the Leaper down (src/config/leaper-behaviour.js `downed` says for how
  // long); losing one more while down keeps it down for good.
  legs: Object.freeze({ maxLost: 4, mobilityPerLeg: 0.18, minMobility: 0.25 }),
});

// How far the Leaper's eye bolts reach, in world units, at a map scale: never
// beyond what its brain can see (review fix 5.31). The brain sees Lola while
// her centre is within sightRange (the trained RAY_MAX_RANGE, 28) plus her
// targetRadius (1.4), whatever the Leaper size; the bolt range itself grows
// with the map (weaponRange map units).
export function attackRange(scale, { sightRange, targetRadius }, config = COMBAT) {
  return Math.min(config.weaponRange * scale, sightRange + targetRadius);
}
