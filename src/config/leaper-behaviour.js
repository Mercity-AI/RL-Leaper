// How the Leaper behaves around its trained brain: the designer's knobs for
// src/actors/leaper/ (LeaperDirector decides, LeaperActor carries it out).
//
// The frozen 7,757,824-step brain only walks and turns (RL locomotion). This
// file decides when it is allowed to (the brain is paused, resumed or, after a
// leap, told its new spot; it never gets new inputs), and everything the
// Leaper does on top: holding still to shoot, stomping, leaping, staggering,
// going down and dying.
//
// Units: distances are world units, the brain's own units (the Leaper is about
// 8 units across at every size; Lola and the map scale around it), times are
// seconds, angles are degrees unless the name says radians.
const deg = (degrees) => degrees * Math.PI / 180;

export const LEAPER_BEHAVIOUR = Object.freeze({
  // ---- Awareness: what the brain knows about Lola (its own trained sight) ----
  awareness: Object.freeze({
    // After losing sight of Lola, the Leaper keeps chasing her last-seen spot
    // for this many brain steps (the brain's own memory span, 120 = 12 s at
    // full health), then goes back to searching.
    memorySteps: 120,
  }),

  // ---- Engage: stop, turn to face Lola and shoot ----
  engage: Object.freeze({
    // Starts holding when Lola is visible this close, and walks again beyond exitDistance.
    enterDistance: 14,
    exitDistance: 18,
    // Lola out of the eye's line of sight this long ends the hold (it hunts her again).
    lostSightTime: 1.0,
    // Holding never lasts longer than this; then it walks for at least
    // repositionTime before it may hold again (keeps the pressure on).
    maxHoldTime: 6,
    repositionTime: 2.5,
    // Body turn while holding, degrees per second (the brain itself turns 90 at
    // most), and how close to facing her counts as facing.
    turnRate: 90,
    faceTolerance: 6,
  }),

  // ---- Stomp: Lola hugging the Leaper gets stamped on ----
  stomp: Object.freeze({
    // Lola within the Leaper's reach (+ reachMargin) this long starts a stomp.
    trigger: 0.8,
    reachMargin: 0.6,
    // Telegraph: the body crouches this low and a red ring grows on the ground.
    windup: 0.75,
    crouch: 0.6,
    // Then the slam: everything within radius of the Leaper's centre is hit once.
    radius: 6,
    damage: 20,
    // Lola is shoved straight away from the Leaper, sliding along walls.
    knockback: Object.freeze({ distance: 3.5, time: 0.35 }),
    cameraShake: 0.6,
    // The body comes back up over recovery; no new stomp during cooldown.
    recovery: 0.6,
    cooldown: 3.5,
    // Once it is back up, the eye waits this long before it starts charging a
    // bolt (owner, 2026-10-29: "a lil cooldown" before it shoots).
    attackRecovery: 0.5,
  }),

  // ---- Leap / pounce: a scripted jump onto Lola, then the brain carries on ----
  leap: Object.freeze({
    // Lola between these distances, seen by the brain right now, and a clear
    // landing spot: it may pounce (from Chase or Engage).
    minDistance: 9,
    maxDistance: 20,
    // It lands this far short of Lola (her shockwave distance), never closer
    // than minTravel from where it took off.
    landingGap: 5.5,
    minTravel: 4,
    // Landing spots tried, as turns (degrees) off the straight line to Lola.
    landingTurns: Object.freeze([0, -18, 18, -36, 36]),
    // How often a leap is looked for while one could happen.
    planInterval: 0.3,
    // Telegraph: crouch low and mark the landing spot; then the jump itself.
    windup: 0.65,
    crouch: 0.75,
    flight: 0.8,
    apexHeight: 3.2,
    // Above this height the airborne Leaper no longer touches Lola (she can run under it).
    clearHeight: 1.8,
    // The landing: a shockwave around the landing spot, then a short recovery.
    shockwave: Object.freeze({ radius: 7, damage: 15, knockback: Object.freeze({ distance: 3, time: 0.3 }) }),
    cameraShake: 0.85,
    recovery: 0.5,
    cooldown: 8,
    // Once it has recovered, the eye waits this long before it starts charging
    // a bolt (owner, 2026-10-29). A leap called off before take-off does not.
    attackRecovery: 0.5,
    // The brain must accept the landing spot (the same check its physics uses)
    // before take-off; the crouch waits at most this long for its answer.
    acceptTimeout: 1.0,
  }),

  // ---- Stagger: a big hit knocks the Leaper off balance ----
  stagger: Object.freeze({
    // The brain is frozen and every wind-up cancelled for this long.
    time: 0.75,
    // No new stagger this soon after one ends (no stun-lock).
    cooldown: 1.5,
    // The eye's next bolt waits at least this long after the stagger.
    attackRecovery: 0.6,
    // Recoil: the body rocks back (radians) and dips (units), then settles.
    recoilPitch: 0.24,
    recoilLower: 0.35,
    // A weak-point (eye core) crit staggers too, when the gun reports it.
    onWeakPoint: true,
  }),

  // ---- Walking with legs lost ----
  crippled: Object.freeze({
    // The body leans toward the side that lost legs, this many radians per
    // missing leg's sideways reach, never more than maxLean.
    leanPerLeg: 0.05,
    maxLean: 0.12,
    // A leg walking on its stump (cut below the lower knee) is shorter, so its
    // side sags this share of a missing leg's lean.
    stumpLean: 0.5,
  }),

  // ---- Downed: too many legs lost (COMBAT.legs.maxLost) ----
  downed: Object.freeze({
    // The body sinks to the floor over sinkTime and rests at restHeight
    // (its centre above the floor); the eye keeps firing (a vulnerable phase).
    sinkTime: 0.8,
    restHeight: 0.85,
    // It gets up limping after recoverTime, taking getUpTime to stand.
    recoverTime: 6,
    getUpTime: 1.2,
    // Bullets do this much more damage while it is down.
    damageTakenScale: 1.5,
    // The surviving feet slide outwards this share of their reach, and the body
    // rolls this far (radians) toward the side that lost the most legs.
    splay: 0.15,
    roll: 0.12,
    // With no standing leg left on one side (COMBAT.legs) it tips over onto that
    // side instead (radians of roll), and never gets up again.
    toppledRoll: 0.3,
    // Camera shake (0-1) as it hits the floor.
    cameraShake: 0.4,
  }),

  // ---- Dying, then the wreck ----
  dying: Object.freeze({
    // The collapse: the body eases to restHeight, rolls toward its missing legs,
    // the surviving legs splay and the eye fades out, with sparks and debris.
    time: 1.8,
    restHeight: 0.7,
    roll: 0.28,
    splay: 0.3,
    eyeFade: 1.2,
    sparks: 36,
    debris: 10,
    cameraShake: 0.7,
  }),

  // ---- Smooth motion between brain replies (review fix 5.14) ----
  motion: Object.freeze({
    // The drawn Leaper plays the brain's poses back about this many steps
    // behind the newest one, at the brain's own pace, so it never surges (the
    // margin over 1 absorbs replies that arrive a little late).
    targetLag: 1.6,
    // How the playback speed adapts when replies come early or late: lag is
    // smoothed over lagTime seconds; catchUp = extra pace per step of lag.
    lagTime: 0.2,
    catchUp: 0.5,
    minRate: 0.5,
    maxRate: 2,
    // With less than this many steps left to play it eases out (a late reply).
    easeOut: 0.4,
    // A change of pace (a leg lost) is eased in over about this many seconds.
    intervalEase: 0.3,
    // More steps than this waiting are skipped; a jump the brain could never
    // make in one step (a reset, a refused pose sync) is snapped to.
    maxLag: 4,
    snapDistance: 2.5,
    snapTurnRadians: deg(60),
  }),

  // ---- Feedback ----
  feedback: Object.freeze({
    // Every hit flashes the hull this bright for hitFlash seconds.
    hitFlash: 0.12,
    hitFlashStrength: 0.55,
    // Sparks from a struck spot, and the bigger burst when a joint snaps.
    hitSparks: 6,
    jointBurstSparks: 28,
    // The eye's charge glow before a bolt: halo size (units) at full charge.
    eyeHalo: 0.7,
  }),
});

// The same values in radians where the code needs them.
export const LEAPER_ANGLES = Object.freeze({
  engageTurnRate: deg(LEAPER_BEHAVIOUR.engage.turnRate),
  faceTolerance: deg(LEAPER_BEHAVIOUR.engage.faceTolerance),
  landingTurns: Object.freeze(LEAPER_BEHAVIOUR.leap.landingTurns.map(deg)),
});
