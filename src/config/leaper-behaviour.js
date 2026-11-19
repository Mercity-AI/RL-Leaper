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

  // ---- Investigate: shot at by something it cannot see ----
  // (owner, 2026-10-30.) A bullet from out of sight makes it stop searching, turn
  // and walk to where the shot came from, along a route around the junk, until
  // it sees Lola or gets there. The brain is paused meanwhile: its inputs never
  // change, and it carries on from the new spot.
  investigate: Object.freeze({
    // A hit is still worth following this long after it landed (a stagger may
    // come first).
    alarmTime: 4,
    // Gives up and searches again after this long.
    maxTime: 40,
    // Same pace as the brain's walk (0.375 units a step, 10 steps a second) and
    // its turn (degrees per second); it only walks facing within walkFacing.
    speed: 3.75,
    turnRate: 90,
    walkFacing: 35,
    // A new shot from this much further along changes where it is heading.
    replanDistance: 3,
    // Stuck (see track): no closer by progress units for stuckTime seconds.
    stuckTime: 1.5,
    progress: 0.5,
    // Route points this close at its start are skipped (see track).
    skipNear: 1.5,
  }),

  // ---- Track: walk to where it last saw Lola ----
  // (owner, 2026-11-19.) Whenever Lola drops out of sight (neither the brain's
  // sight nor the eye sees her), it pauses the brain and walks straight to the
  // spot where it last saw her, around the junk, at the brain's own walking pace.
  // The eye seeing her within shooting range ends it (it stands and shoots);
  // seen further off, or glimpsed by the brain's sight, it walks on toward her.
  // If she is not there, or it cannot get there or gets stuck, it looks round
  // (the brain) for trailWait, then moves on: it follows her trail to where she
  // is now, again and again until it sees her (owner, 2026-11-19: it span on the
  // spot where it last saw her).
  track: Object.freeze({
    // Out of sight this long first (a pole passing in front of her is no loss).
    reactTime: 0.3,
    // Getting no closer than progress world units for stuckTime seconds while it
    // is trying to walk (not turning on the spot) counts as stuck.
    stuckTime: 1.5,
    progress: 0.5,
    // Gives up and lets the brain search when the walk runs this many seconds
    // longer than its route should take (a long detour gets the time it needs).
    spareTime: 5,
    // A glimpse of her this much further along (world units) during the walk
    // moves where it is heading.
    replanDistance: 3,
    // No route gets it any closer to her (she tucked into a gap narrower than its
    // legs): the brain searches, and no walk goes back within this many world
    // units of that spot until she has moved further away (owner, 2026-11-19:
    // waiting there was a waste of time).
    unreachableRadius: 4,
    // The walk stops to stand and shoot once the eye has had her this long without
    // a break (a glimpse through a slit in the junk is no find).
    foundTime: 0.4,
    // A stand that lost her before the eye had her lostSightTime in all: the next
    // walk goes on this many seconds before a sighting may stop it (it stopped,
    // turned, lost her and stopped again on the same spot, probe 2026-11-19).
    walkPast: 2,
    // After a walk that did not find her, it follows her trail after this long
    // still without seeing her.
    trailWait: 1.5,
    // Route points this close at its start are skipped: no turning round for a
    // step behind it; all that close and it only turns to face the spot.
    skipNear: 1.5,
    // The walk ends where its eye would see the spot only if that route is at most
    // this much longer (world units) than the one to the nearest spot it fits;
    // else it goes to the nearest spot and faces hers.
    seeDetour: 8,
    // Same pace and turn as the walk to a shot (see investigate); live in the tuning panel.
    speed: 3.75,
    turnRate: 90,
    walkFacing: 35,
  }),

  // ---- Engage: stop, turn to face Lola and shoot ----
  engage: Object.freeze({
    // Starts holding when Lola is visible this close, and walks again beyond exitDistance.
    enterDistance: 14,
    exitDistance: 18,
    // Lola out of the eye's line of sight this long ends the hold (it hunts her again).
    lostSightTime: 1.0,
    // Holding never adds up to longer than this, a stagger in between or not; then
    // it walks (still firing) for at least repositionTime before it may hold again.
    // Owner, 2026-11-02: at 6 and 2.5 it stood frozen 60-70% of a close fight.
    maxHoldTime: 2.5,
    repositionTime: 3,
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
  investigateTurnRate: deg(LEAPER_BEHAVIOUR.investigate.turnRate),
  investigateWalkFacing: deg(LEAPER_BEHAVIOUR.investigate.walkFacing),
  landingTurns: Object.freeze(LEAPER_BEHAVIOUR.leap.landingTurns.map(deg)),
});
