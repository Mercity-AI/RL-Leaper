// Distances/speeds are in source-map units and scale with the junkyard.
// lolaHealth: Lola's real health (120 since 2026-10-22: 20% tougher). The player
// always sees it on a scale of lolaHealthShown (owner: "we are upping the value
// of 100, not the number"), so full health reads 100 and one bolt about 7.
export const COMBAT = Object.freeze({
  lolaHealth: 120, lolaHealthShown: 100, leaperHealth: 600, boltDamage: 8,
  projectileSpeed: 80, weaponRange: 52,
  // How far the Leaper sees Lola and searches the yard (owner, 2026-10-30: 50, was
  // 19.3, the trained 28 world units). Its walking rays stay trained (frozenEnv.js).
  sightRange: 50,
  // A shot is one line that grows from the eye to its tip; beamTime: seconds it
  // takes to thin away where it ended, so even a bolt that lands within a frame
  // shows (owner, 2026-11-02: hits with no laser seen).
  laserLength: 2.2, laserRadius: 0.03, beamTime: 0.18, lowHealthThreshold: 24,
  // Lola badly hurt (owner, 2026-11-02), on the health the player sees. Under pantBelow
  // she pants in short runs (owner, 2026-11-04: nonstop panting was distracting): breathRun
  // breaths (fewest, most) breathEvery seconds apart, then a rest of breathRest seconds,
  // all picked at random each time. Breaths play at standingVolume of their volume
  // unless she is running (no need for huge breaths then). Under blurBelow her sight blurs
  // and she hunches as she runs; a pill eases that back and it has gone by clearAbove.
  // fadeIn / fadeOut: seconds that takes to set in and to clear. Under edgeBelow the
  // screen edges stay slightly red (edge, 0-1), fading on and off over edgeFade seconds.
  lolaHurt: Object.freeze({ pantBelow: 20, breathEvery: Object.freeze([0.85, 1.1]),
    breathRun: Object.freeze([1, 3]), breathRest: Object.freeze([2.5, 4.5]), standingVolume: 0.45,
    blurBelow: 10, clearAbove: 20, fadeIn: 1.5, fadeOut: 2.5, edgeBelow: 20, edge: 0.3, edgeFade: 1 }),
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
  cameraShake: Object.freeze({ bigHit: 0.7, legLanding: 0.5, lolaDown: 1 }),
  // A bolt landing on Lola: sparks (their strength) and the same tilt and jolt back.
  lolaHit: Object.freeze({ sparks: 2.5, roll: 0.05, push: 0.45, recovery: 7 }),
  // A bullet landing on the Leaper: a tilt (radians, either way) and a jolt back
  // (map units) on top of the gun's own kick. They shake the picture without
  // moving the aim, so the spray stays exactly as it was (owner, 2026-11-02). A
  // leg coming off adds the far bigger cameraShake.bigHit. lolaDownJolt: the same
  // two for the moment she loses, added to cameraShake.lolaDown.
  hitJolt: Object.freeze({ roll: 0.022, push: 0.16 }),
  lolaDownJolt: Object.freeze({ roll: 0.09, push: 0.7, recovery: 4 }),
  // Leg rules (review fix 5.7). Each lost leg slows the brain's step clock by
  // mobilityPerLeg, never below minMobility (the limp). Losing maxLost legs
  // knocks the Leaper down (src/config/leaper-behaviour.js `downed` says for how
  // long); losing one more while down keeps it down for good.
  // walkOnStump: a leg cut below its lower knee keeps walking on its stump
  // (thigh + shin), counting stumpCost of a lost leg toward the limp and never
  // toward maxLost. Off since 2026-10-21 (owner: a stump reaching the floor
  // looked like a whole leg): any cut leg now curls up and hangs, a lost leg.
  // With no standing leg left on one side nothing holds that side up: the
  // Leaper tips over for good.
  legs: Object.freeze({ maxLost: 4, mobilityPerLeg: 0.18, minMobility: 0.25, walkOnStump: false, stumpCost: 0.5 }),
});

// How far the Leaper's eye bolts reach, in world units, at a map scale: never
// beyond what its brain can see (review fix 5.31). The brain sees Lola while
// her centre is within sightRange (the trained RAY_MAX_RANGE, 28) plus her
// targetRadius (1.4), whatever the Leaper size; the bolt range itself grows
// with the map (weaponRange map units).
export function attackRange(scale, { sightRange, targetRadius }, config = COMBAT) {
  return Math.min(config.weaponRange * scale, sightRange + targetRadius);
}
