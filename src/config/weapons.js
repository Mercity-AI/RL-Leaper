import { COMBAT } from './combat.js';
import { CALF_LENGTH, COXA_LENGTH, FEMUR_LENGTH, SHIN_LENGTH } from './robot.js';

// Lola's guns and how bullets meet the Leaper, as data. Every number a designer
// tunes for shooting lives in this file; the code in src/weapons/ only reads it.

// ---- The guns ------------------------------------------------------------------
// One entry per gun, keyed by id. Field by field:
//   label          name on screen and in the controls list
//   key            keyboard key that equips it ('1' / '2')
//   icon           which silhouette the weapon HUD draws ('rifle' | 'pistol')
//   damage         health one bullet takes from the Leaper, before the hit zone's
//                  multiplier (see HIT_ZONES)
//   interval       seconds between shots. An automatic gun fires at exactly this
//                  rate while the trigger is held, at any frame rate (review fix 5.34)
//   automatic      true: holding fire keeps shooting; false: one shot per press
//   magazine       rounds in a full magazine
//   reserve        spare rounds carried at the start of a fight (Infinity = unlimited
//                  spares, but every magazine still has to be reloaded, automatically
//                  when empty or with R). The M416's run out; ammo bullets in the yard
//                  give more (src/config/pickups.js), the basic gun's never do
//   reserveMax     the most spare rounds it can carry (limited guns only)
//   reloadTime     seconds a reload takes when Lola has no reload animation (with one,
//                  the magazine refills exactly when her animation ends, ~1.43 s)
//   reloadSound    recording played during the reload, reloadSoundAt seconds in,
//                  lined up with the animation's hand work (M416: magazine click on
//                  frame 20; pistol: two clicks on frames 19 and 24)
//   shotSound      recording for each shot
//   range          furthest a bullet reaches, in map units at scale 1 (it grows with the map)
//   spread         how far a bullet may stray from the crosshair, as a cone half-angle
//                  in radians:
//                    base          standing still, first shot
//                    moving        multiplier while Lola walks or runs
//                    bloomPerShot  added by each shot, up to bloomMax
//                    bloomDelay    seconds after a shot before the bloom shrinks again
//                    bloomRecovery how fast it then shrinks (radians per second)
//   recoil         camera kick per shot: pitch (radians up), yawJitter (up to this
//                  many radians left or right, at random) and recovery (how quickly
//                  the view settles back, per second; higher = snappier)
//   ads            aiming-down-sights multipliers: zoom (lens magnification), spread
//                  and recoil (both multiplied while aiming)
//   tracer         which tracer and muzzle-flash style the effects draw ('rifle' | 'pistol')
//
// Balance (owner decision, 2026-10-19). The roles: the M416 is the sustained-damage
// and leg-breaking gun, the pistol the slow precision gun. Before this change the
// pistol fired 6 damage every 0.2 s, about 30 DPS (20.3 with reloads), 2.2x the rifle.
// Numbers (sustained = including reloads, see weaponBalance below; 600 HP Leaper):
//   M416    2 dmg, 7 shots/s, 20 rounds  14.0 DPS burst, 9.3 sustained, ~64 s to kill,
//           a knee (8-10 bullets) in about 1.3 s
//   pistol  5 dmg, 2 shots/s, 15 rounds  10.0 DPS burst, 8.4 sustained, ~71 s to kill,
//           10 per weak-point hit, a knee in about 4.5 s, almost no spread
// Both stay inside the intended 60-90 s fight (TRAINING.md, "600 HP targets 60-90 s").
export const WEAPONS = Object.freeze({
  m416: Object.freeze({
    id: 'm416', label: 'M416', key: '2', icon: 'rifle', tracer: 'rifle',
    damage: 2, interval: 1 / 7, automatic: true, magazine: 20, reserve: 80, reserveMax: 160,
    reloadTime: 43 / 30, reloadSound: 'm416Reload', reloadSoundAt: 0.14, shotSound: 'm416',
    range: 60,
    spread: Object.freeze({ base: 0.006, moving: 1.8, bloomPerShot: 0.003, bloomMax: 0.02,
      bloomDelay: 0.18, bloomRecovery: 0.08 }),
    recoil: Object.freeze({ pitch: 0.006, yawJitter: 0.002, recovery: 9 }),
    ads: Object.freeze({ zoom: 1.35, spread: 0.4, recoil: 0.6 }),
  }),
  pistol: Object.freeze({
    id: 'pistol', label: 'BASIC GUN', key: '1', icon: 'pistol', tracer: 'pistol',
    damage: 5, interval: 0.5, automatic: false, magazine: 15, reserve: Infinity,
    reloadTime: 43 / 30, reloadSound: 'pistolReload', reloadSoundAt: 0.52, shotSound: 'pistol',
    range: 60,
    spread: Object.freeze({ base: 0.002, moving: 1.5, bloomPerShot: 0.004, bloomMax: 0.008,
      bloomDelay: 0.15, bloomRecovery: 0.05 }),
    recoil: Object.freeze({ pitch: 0.02, yawJitter: 0.002, recovery: 10 }),
    ads: Object.freeze({ zoom: 1.35, spread: 0.25, recoil: 0.7 }),
  }),
});

// Which gun each of Lola's outfits carries, in her weaponIndex order
// (outfit 0 = the M416 view, outfit 1 = the pistol view; see LolaAssets.OUTFIT_WEAPONS).
export const WEAPON_SLOTS = Object.freeze(['m416', 'pistol']);

// The gun in a weaponIndex slot (0 = M416, 1 = pistol).
export function weaponForSlot(index) {
  return WEAPONS[WEAPON_SLOTS[index]];
}

// The weaponIndex slot of the gun a key equips ('1' -> pistol's slot), or -1.
export function slotForKey(key) {
  return WEAPON_SLOTS.findIndex(id => WEAPONS[id].key === key);
}

// ---- Shooting feel shared by both guns ------------------------------------------
// aimHold: seconds the raised-gun pose lingers after the last shot (hip-fire).
// minShotPose: shortest shot animation, in seconds (a faster gun still raises fully).
// maxShotsPerFrame: an automatic gun never fires more than this many bullets in one
//   frame, so one long hitch can't empty a magazine in a single frame.
// obstruction: how many units short of the crosshair's point cover must stop the
//   muzzle ray before the reticle shows OBSTRUCTED (smaller = more sensitive).
export const SHOOTING = Object.freeze({
  aimHold: 1.2,
  minShotPose: 0.24,
  maxShotsPerFrame: 2,
  obstruction: 0.3,
});

// ---- Hit feedback -------------------------------------------------------------
// Seconds each reaction stays on screen:
//   hitTime        crosshair kicks out in crimson after any hit on the Leaper
//   critTime       brighter crimson after a weak-point (eye core) hit
//   bigHitTime     a "big hit" (a joint snapped, or the kill) holds the crosshair large
//   edgeGlowTime   the blue screen-edge reward glow after a big hit takes this long to fade
//   markers        how long each hit marker (the X around the crosshair) shows, by kind
export const HIT_FEEDBACK = Object.freeze({
  hitTime: 0.15,
  critTime: 0.2,
  bigHitTime: 2,
  edgeGlowTime: 0.9,
  markers: Object.freeze({ normal: 0.22, weak: 0.32, joint: 0.6, kill: 1.2 }),
});

// ---- Leaper hit zones ----------------------------------------------------------
// What a hit on each kind of hit volume means. multiplier scales the gun's damage;
// the eye's red core is the weak point (COMBAT.weakPointMultiplier, 2x today).
//   body   the shell and the eye housing
//   core   the glowing red core in the eye
//   knee   a leg joint (upper knee or lower calf joint); 8-10 bullets snap it
//   shaft  a long leg piece; 24-26 bullets snap it (LEG_HITS in LeaperLegDamage.js)
export const HIT_ZONES = Object.freeze({
  body: Object.freeze({ multiplier: 1 }),
  core: Object.freeze({ multiplier: COMBAT.weakPointMultiplier }),
  knee: Object.freeze({ multiplier: 1 }),
  shaft: Object.freeze({ multiplier: 1 }),
});

// The Leaper's hit volumes: simple spheres and capsules that ride on its rig, so
// bullets no longer test the visible meshes (an art swap can't break targeting).
// Sizes are world units; positions are measured from the rig piece and turn with
// it (its size does not stretch them).
//   part    'robot' (the body), 'eye' (the turning eye) or, with `leg`, one piece
//           of every leg: coxa, femur, knee, tibia, calfJoint, calf
//   shape   'sphere' around `at`, or 'capsule' from `from` to `to` (a leg piece's
//           own axis runs up its local Y from the joint it starts at)
//   radius  how fat the volume is; a little bigger than the art is more forgiving
//   zone    a HIT_ZONES name
//   joint   the leg-damage counter a hit adds to (LeaperLegDamage: upper, lower,
//           coxa, femur, tibia, calf)
//   atEachHip  (body only) repeat the volume over every leg's hip on the body,
//           turned with that leg: +Z then points out from the body along the leg
// Long leg pieces stop short of the joints at their ends, so a shot at a knee
// counts for the knee, not the thigh next to it.
// The fin over each hip sticks up and out past the body sphere; without its own
// volume, bullets that visibly struck a fin flew straight through it.
export const LEAPER_HITBOXES = Object.freeze([
  Object.freeze({ part: 'robot', shape: 'sphere', at: [0, 0.05, 0], radius: 0.8, zone: 'body' }),
  Object.freeze({ part: 'robot', atEachHip: true, shape: 'capsule', from: [0, 0.78, 0.745], to: [0, 0.86, 1.095], radius: 0.18, zone: 'body' }),
  Object.freeze({ part: 'eye', shape: 'sphere', at: [0, 0, -0.12], radius: 0.48, zone: 'body' }),
  Object.freeze({ part: 'eye', shape: 'sphere', at: [0, 0, 0.28], radius: 0.18, zone: 'core' }),
  Object.freeze({ leg: 'coxa', shape: 'capsule', from: [0, 0, 0], to: [0, COXA_LENGTH, 0], radius: 0.18, zone: 'shaft', joint: 'coxa' }),
  Object.freeze({ leg: 'femur', shape: 'capsule', from: [0, 0.2, 0], to: [0, FEMUR_LENGTH - 0.3, 0], radius: 0.24, zone: 'shaft', joint: 'femur' }),
  Object.freeze({ leg: 'knee', shape: 'sphere', at: [0, 0, 0], radius: 0.24, zone: 'knee', joint: 'upper' }),
  Object.freeze({ leg: 'tibia', shape: 'capsule', from: [0, 0.3, 0], to: [0, SHIN_LENGTH - 0.32, 0], radius: 0.2, zone: 'shaft', joint: 'tibia' }),
  Object.freeze({ leg: 'calfJoint', shape: 'sphere', at: [0, 0, 0], radius: 0.28, zone: 'knee', joint: 'lower' }),
  Object.freeze({ leg: 'calf', shape: 'capsule', from: [0, 0.3, 0], to: [0, CALF_LENGTH, 0], radius: 0.15, zone: 'shaft', joint: 'calf' }),
]);

// ---- Balance numbers ---------------------------------------------------------------
// The numbers in the balance note above, worked out from a gun's data (reload time
// as given, i.e. without Lola's reload animation). health: the Leaper's full health.
export function weaponBalance(weapon, health = COMBAT.leaperHealth) {
  const burstDps = weapon.damage / weapon.interval;
  const magazineSeconds = weapon.magazine * weapon.interval;
  const sustainedDps = (weapon.magazine * weapon.damage) / (magazineSeconds + weapon.reloadTime);
  return { burstDps, sustainedDps, secondsToKill: health / sustainedDps };
}
