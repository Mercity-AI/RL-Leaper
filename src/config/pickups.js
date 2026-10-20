// Designer numbers for the health pills: blue glowing pills scattered around
// the yard that give Lola back part of her health. The look was approved by
// the owner in previews/health-pill.html (2026-10-20); the sizes there are in
// the preview's units, where the glowing sphere is 1.2 across.

export const HEALTH_PILLS = Object.freeze({
  // ---- What a pill does ----
  // Share of Lola's *total* health one pill gives back (0.1 = 10%).
  heal: 0.1,
  // A pill stays where it is while Lola is at full health (nothing to heal).
  needsDamage: true,

  // ---- How many, and when new ones appear ----
  // A new game starts with this many, at random spots.
  startCount: 3,
  // When only this many are left, new ones start appearing again...
  refillWhenLeft: 1,
  // ...one at a time, this many seconds apart, until there are startCount again.
  refillDelay: 6,
  // Never more than this many on the arena at once.
  maxCount: 4,

  // ---- Where they go (in Lola heights, so they follow the game's scale) ----
  // Pills keep at least this far from each other...
  spacing: 6,
  // ...and appear at least this far from Lola.
  awayFromLola: 4,
  // Lola takes a pill as soon as she touches its glowing sphere: centre to
  // centre (flat), sphere (1/6) plus her body (about 0.15) plus a little slack.
  reach: 0.4,

  // ---- Look (approved in the preview) ----
  // The whole pickup (its glowing sphere) is this share of Lola's height.
  size: 1 / 3,
  // Preview values, in preview units (sphere radius 0.6).
  previewSphereRadius: 0.6,
  floatHeight: 0.8, // centre of the sphere above the ground
  bob: 0.0858, // up and down (exactly 34% less than 0.13)
  bobSeconds: 3, // one bob cycle
  spinSeconds: 8, // one turn around the vertical axis
  leanDegrees: 25, // clockwise from straight up
  colour: 0x3aa8ff,
  glow: 1.4 * 0.6, // the owner toned the blue sphere down to 60%
  // Taking a pill: the pill is gone at once; its glow fades over this many seconds.
  vanishSeconds: 0.12,
});
