// Designer numbers for the floating pickups Lola collects in the yard:
//   - health pills (blue glow): give back part of her health,
//   - ammo bullets (yellow glow): give the M416 spare magazines.
// Both share one look and motion, approved by the owner in
// previews/health-pill.html (2026-10-20/21); sizes there are in the preview's
// units, where the glowing sphere is 1.2 across.

// What every pickup shares: how many, where they go, how they look and move.
const SHARED = Object.freeze({
  // ---- How many, and when new ones appear (per kind) ----
  // A new game starts with this many, at random spots.
  startCount: 3,
  // When only this many are left, new ones start appearing again...
  refillWhenLeft: 1,
  // ...one at a time, this many seconds apart, until there are startCount again.
  refillDelay: 6,
  // Never more than this many of one kind on the arena at once.
  maxCount: 4,

  // ---- Where they go (in Lola heights, so they follow the game's scale) ----
  // Pickups keep at least this far from each other (of either kind)...
  spacing: 6,
  // ...and appear at least this far from Lola.
  awayFromLola: 4,
  // Lola takes one as soon as she touches its glowing sphere: centre to
  // centre (flat), sphere (1/6) plus her body (about 0.15) plus a little slack.
  reach: 0.4,

  // ---- Look and motion (approved in the preview) ----
  // The whole pickup (its glowing sphere) is this share of Lola's height.
  // A third of her height, then 10% bigger (owner, 2026-10-21).
  size: (1 / 3) * 1.1,
  // Preview values, in preview units (sphere radius 0.6).
  previewSphereRadius: 0.6,
  floatHeight: 1.05 * 1.1, // centre of the sphere above the ground (owner: 0.95, 1.05, then +10%: 1.155, 2026-10-21)
  bob: 0.04673, // up-and-down travel, separate from the float height (owner's B)
  bobSeconds: 3, // one bob cycle
  spinSeconds: 8, // one turn around the vertical axis
  leanDegrees: 25, // clockwise from straight up
  // Glow strength 2.2 (owner's B) on the toned-down sphere (x0.6); the glow on
  // the ground uses the plain 2.2.
  glowStrength: 2.2,
  glow: 2.2 * 0.6,
  // The object itself: no tint of the glow colour, a little shine (preview
  // "shine" 0.55 = roughness 0.9 - 0.55 x 0.7).
  tint: 0,
  roughness: 0.515,
  // Taking one: the object is gone at once; its glow fades over this many seconds.
  vanishSeconds: 0.12,
});

export const HEALTH_PILLS = Object.freeze({
  ...SHARED,
  name: 'healthPill',
  sound: 'healthPickup', // src/audio/sounds.json
  colour: 0x3aa8ff, // blue
  // The pill model lies along x; it is drawn 80% as thick as modelled, same length.
  modelAxis: 'x',
  thickness: 0.8,
  // Share of Lola's *total* health one pill gives back (0.1 = 10%).
  heal: 0.1,
  // A pill stays where it is while Lola is at full health (nothing to heal).
  needsDamage: true,
});

export const AMMO_BULLETS = Object.freeze({
  ...SHARED,
  name: 'ammoBullet',
  sound: 'ammoPickup', // src/audio/sounds.json
  colour: 0xffc23a, // yellow
  // The bullet model stands along y; it is centred and scaled to the pill's
  // length (0.925 preview units) so it fills the sphere the same way.
  modelAxis: 'y',
  modelLength: 0.925,
  // The gun it feeds and how many spare rounds one bullet gives (2 magazines).
  gun: 'm416',
  rounds: 40,
  // A bullet stays where it is while that gun's spares are full.
});
