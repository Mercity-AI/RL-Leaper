import { LEAPER_BEHAVIOUR } from '../../config/leaper-behaviour.js';
import { COMBAT } from '../../config/tuning/index.js';

// The Leaper's decision layer: an explicit state machine above the frozen brain
// (review theme 6.4, finding brain-ai-no-behaviour-layer), in the style of
// AttackController: no engine or page code, every timer in game seconds, so
// Node tests drive it with plain "sense" objects.
//
//   Dormant -> Search -> Chase <-> Engage, and from those Stomp and Leap;
//   Search or Chase -> Investigate (shot from out of sight) -> Search or Chase;
//   Search, Chase or Engage -> Track (Lola dropped out of sight) -> Search or Chase;
//   any of them -> Stagger (a big hit) -> Downed (too many legs) -> Dying -> Dead.
//
// Each state picks where the Leaper's movement comes from (`locomotion`):
//   'rl'       the trained brain steps (Search, Chase);
//   'hold'     the brain is paused; the body only turns in place by animation
//              (Engage turns to face Lola; a stomp, a stagger, a fall do not);
//   'scripted' the brain is paused; an animation moves the body (the leap's
//              flight, the walk to where a shot came from or to where Lola was last
//              seen, the collapse and the wreck).
// The brain itself is only ever paused, resumed or told a new pose (after a
// leap or a turn in place); it never gets new inputs. LeaperActor carries the
// decisions out and calls the hooks below.
//
// The sense object (built by LeaperActor every frame):
//   hunting      the run is live (GameFlow hunting)
//   health       the Leaper's health (0 = dead)
//   lolaDown     Lola has lost
//   brainOnline  a brain answers (not turret mode)
//   aware        the brain sees Lola now (target_visible); in turret mode the eye does
//   remembers    the brain saw her recently (target_ever_seen, memory still fresh)
//   brainSees    the brain's sight sees her right now, also while it is paused (optional;
//                aware stands in for it)
//   eyeSees      the eye has a clear line of fire to her (LeaperCombat)
//   distance     Leaper centre to Lola, world units
//   lola         Lola's spot { x, z } (optional: without it there is no walk to where
//                she was last seen)
//   inReach      Lola is hugging the Leaper (within its reach + stomp.reachMargin)
//   planLeap()   a landing spot for a pounce at her, or null (asked only when one could happen)
//
// Hooks (all optional), called with this director's own data:
//   onStateChange({ from, to, reason })
//   onStompWindup(), onStompImpact()
//   onLeapStart(plan), onLeapLaunch(plan), onLeapLand(plan), onLeapCancel(plan, reason)
//   onStagger(reason), onDowned({ permanent }), onGetUp(), onDeath()

// The scripted walks: the brain is paused while the behaviour layer moves the body.
export const WALKS = Object.freeze(['investigate', 'track']);

// Every state: where movement comes from, and whether the eye may fire.
export const LEAPER_STATES = Object.freeze({
  dormant: Object.freeze({ locomotion: 'hold', bolts: false }),
  search: Object.freeze({ locomotion: 'rl', bolts: false }),
  investigate: Object.freeze({ locomotion: 'scripted', bolts: false }),
  // (It fires as it walks whenever the eye has her.)
  track: Object.freeze({ locomotion: 'scripted', bolts: true }),
  chase: Object.freeze({ locomotion: 'rl', bolts: true }),
  engage: Object.freeze({ locomotion: 'hold', bolts: true }),
  stomp: Object.freeze({ locomotion: 'hold', bolts: false }),
  leap: Object.freeze({ locomotion: 'hold', bolts: false }),
  stagger: Object.freeze({ locomotion: 'hold', bolts: false }),
  // Down: the eye keeps firing, a vulnerable phase (it cannot move or turn).
  downed: Object.freeze({ locomotion: 'hold', bolts: true }),
  dying: Object.freeze({ locomotion: 'scripted', bolts: false }),
  dead: Object.freeze({ locomotion: 'scripted', bolts: false }),
});

// What the HUD says for each state (and phase), in the player's words.
export function stateLabel(state, phase = null, { permanent = false } = {}) {
  if (state === 'leap') return phase === 'windup' ? 'POUNCE!' : phase === 'flight' ? 'LEAPING' : 'LANDED';
  if (state === 'downed') return phase === 'rising' ? 'GETTING UP' : permanent ? 'DOWN FOR GOOD' : 'DOWN · VULNERABLE';
  if (state === 'stomp') return phase === 'windup' ? 'STOMP!' : 'STOMPED';
  return {
    dormant: 'DORMANT', search: 'SEARCHING', investigate: 'INVESTIGATING', track: 'TRACKING', chase: 'HUNTING', engage: 'ENGAGING',
    stagger: 'STAGGERED', dying: 'DESTROYED', dead: 'WRECK',
  }[state] ?? state.toUpperCase();
}

export class LeaperDirector {
  // config: LEAPER_BEHAVIOUR; legs: COMBAT.legs (maxLost); hooks: see above.
  constructor({ config = LEAPER_BEHAVIOUR, legs = COMBAT.legs, hooks = {} } = {}) {
    this.config = config;
    this.legs = legs;
    this.hooks = hooks;
    this.reset();
  }

  // A fresh Leaper: dormant until the run starts, every timer cleared.
  reset() {
    this.state = 'dormant';
    this.phase = null;
    this.reason = 'reset';
    this.stateTime = 0;
    this.phaseTime = 0;
    this.time = 0;
    this.cooldowns = { stomp: 0, leap: 0, stagger: 0, reposition: 0 };
    this.reachTime = 0;
    this.unseenTime = 0;
    this.heldTime = 0;
    this.planClock = 0;
    this.plan = null;
    this.acceptance = null;
    this.pendingStagger = null;
    this.pendingDowned = false;
    this.permanent = false;
    // One whole side has no standing leg: it has tipped over for good.
    this.toppled = false;
    // Legs lost so far (from legBroken), so a stump snapping is not counted again.
    this.lostLegs = 0;
    // The last shot from out of sight { x, z, time } and, while investigating,
    // where it is heading { x, z } and whether it got there.
    this.alarm = null;
    this.goal = null;
    this.arrived = false;
    // Where Lola was when it last saw her { x, z, walked }, how long she has been
    // out of sight since, and whether the walk there failed (LeaperActor: no route,
    // stuck). walked: this sighting has had its walk already.
    this.lastSeen = null;
    this.lostTime = 0;
    this.failed = false;
    // How long the walk may take (walkFor), or null while unknown.
    this.walkLimit = null;
    // When the last scripted walk ended, and where the next trail walk goes.
    this.walkEnded = -Infinity;
    this.trailGoal = null;
    this.noCloser = false;
    // A spot no route reached { x, z }: no walk goes back near it (see goalReachable).
    this.unreachable = null;
    // How long the eye has had her without a break; how long it had her during
    // this stand (Engage); whether the next walk goes on past a sighting, and
    // from when (its state time) a sighting may end it.
    this.eyeTime = 0;
    this.engageSeen = 0;
    this.walkPast = false;
    this.findAfter = 0;
    this.transitions = 0;
  }

  // ---- What the current state means for the rest of the Leaper ----

  get locomotion() {
    // The leap's flight is an animation; its crouch and landing hold still.
    if (this.state === 'leap' && this.phase === 'flight') return 'scripted';
    return LEAPER_STATES[this.state].locomotion;
  }

  get boltsAllowed() {
    return LEAPER_STATES[this.state].bolts;
  }

  // While holding: turn the body toward Lola (Engage), toward the landing spot
  // (the leap's crouch), or keep still (null).
  get facing() {
    if (this.state === 'engage') return 'lola';
    if (this.state === 'leap' && this.phase === 'windup') return 'leap';
    return null;
  }

  get label() {
    return stateLabel(this.state, this.phase, { permanent: this.permanent });
  }

  // For the HUD's debug line, playtest logs and tests.
  snapshot() {
    return {
      state: this.state, phase: this.phase, label: this.label, reason: this.reason, locomotion: this.locomotion,
      bolts: this.boltsAllowed, stateTime: this.stateTime, permanent: this.permanent,
      cooldowns: { ...this.cooldowns }, reachTime: this.reachTime, transitions: this.transitions,
    };
  }

  // ---- Things that happen to the Leaper (called by LeaperActor) ----

  // A leg snapped (LeaperLegDamage.onBroken; lost = legs gone now). Losing
  // maxLost legs knocks it down; one more while down (or after getting up)
  // keeps it down for good. Any other break is a big hit: a stagger.
  // unsupportedSide (non-zero): no standing leg is left on one side, so it tips
  // over that way and can never get up again.
  legBroken({ lost, unsupportedSide = 0 }) {
    if (this.state === 'dying' || this.state === 'dead') return;
    // A joint snapping on a leg already lost (a stump's thigh or hip) is no new
    // leg: only a stagger, never a fall or "down for good".
    const newLeg = lost > this.lostLegs;
    this.lostLegs = Math.max(this.lostLegs, lost);
    if (unsupportedSide && !this.toppled) {
      this.toppled = true;
      this.permanent = true;
      if (this.state !== 'downed' || this.phase === 'rising') this.pendingDowned = true;
    } else if (!newLeg) {
      this.pendingStagger = 'joint break';
    } else if (this.state === 'downed') {
      this.permanent = true;
      if (this.phase === 'rising') this.pendingDowned = true;
    } else if (lost >= this.legs.maxLost) {
      this.pendingDowned = true;
      if (lost > this.legs.maxLost) this.permanent = true;
    } else {
      this.pendingStagger = 'joint break';
    }
  }

  // Another big hit: a crit on the eye's weak point (when the gun reports it).
  bigHit(kind) {
    if (kind === 'weakPoint' && this.config.stagger.onWeakPoint) this.pendingStagger ??= 'weak point';
  }

  // A bullet hit it, fired from (x, z). Worth acting on only if it cannot see
  // the shooter (see investigateReady); a later shot from elsewhere moves the goal.
  shotAt({ x, z }) {
    this.alarm = { x, z, time: this.time };
    const goal = this.goal;
    if (goal && Math.hypot(x - goal.x, z - goal.z) >= this.config.investigate.replanDistance) this.goal = { x, z };
  }

  // The route's end was reached (LeaperActor).
  reachedGoal() {
    this.arrived = true;
  }

  // The walk to where Lola was last seen cannot go on: no route, or stuck (LeaperActor).
  walkFailed() {
    this.failed = true;
  }

  // No route brings it any closer to the walk's goal (LeaperActor): the brain searches.
  cannotGetCloser() {
    this.noCloser = true;
  }

  // The walk's route, planned just now, should take this many seconds (LeaperActor).
  walkFor(seconds) {
    this.walkLimit = this.stateTime + seconds + this.config.track.spareTime;
  }

  // The brain's answer about the leap's landing spot (true = it accepted the pose).
  leapAccepted(ok) {
    if (this.state === 'leap' && this.phase === 'windup' && this.acceptance === 'pending') {
      this.acceptance = ok ? 'accepted' : 'refused';
    }
  }

  // ---- The frame update ----

  update(dt, sense) {
    // 1. Clocks: the state's, the cooldowns', and how long Lola has hugged it.
    this.time += dt;
    this.stateTime += dt;
    this.phaseTime += dt;
    for (const key of Object.keys(this.cooldowns)) this.cooldowns[key] = Math.max(0, this.cooldowns[key] - dt);
    // (Standing next to a dormant Leaper does not count: no stomp the moment the run starts.)
    this.reachTime = sense.inReach && this.state !== 'dormant' ? this.reachTime + dt : 0;
    this.noteSighting(dt, sense);

    // 2. Interrupts, most important first: death, a fall, a stagger, the run stopping.
    const airborne = this.state === 'leap' && this.phase === 'flight';
    if (sense.health <= 0) {
      if (this.state !== 'dying' && this.state !== 'dead') return this.enter('dying', 'destroyed');
    } else if (this.pendingDowned && !airborne) {
      // (A leg lost in mid-air brings it down as soon as it lands.)
      this.pendingDowned = false;
      return this.enter('downed', this.toppled ? 'a whole side lost' : this.permanent ? 'legs gone' : 'too many legs lost');
    } else if (this.pendingStagger) {
      // (A hit that cannot stagger now, mid-air or already down, is not saved for later.)
      const reason = this.pendingStagger;
      this.pendingStagger = null;
      if (this.canStagger()) return this.enter('stagger', reason);
    }
    if (!['dormant', 'dying', 'dead', 'downed'].includes(this.state) && (!sense.hunting || sense.lolaDown) && !airborne) {
      return this.enter('dormant', sense.lolaDown ? 'Lola is down' : 'run stopped');
    }

    // 3. The state's own rules.
    const next = this[this.state](dt, sense);
    if (next) this.enter(next[0], next[1]);
    return undefined;
  }

  // A stagger needs the Leaper on its feet, not mid-leap, and not too soon after the last.
  canStagger() {
    if (['downed', 'dying', 'dead', 'stagger', 'dormant'].includes(this.state)) return false;
    if (this.state === 'leap' && this.phase !== 'windup') return false;
    return this.cooldowns.stagger <= 0;
  }

  // Remember where Lola was the last time it saw her, by the brain's sight or the
  // eye's, and for how long she has been out of sight since.
  noteSighting(dt, sense) {
    this.eyeTime = sense.eyeSees ? this.eyeTime + dt : 0;
    if (this.state === 'dormant') {
      this.lastSeen = null;
      this.lostTime = 0;
      this.unreachable = null;
      return;
    }
    if (sense.lola && ((sense.brainSees ?? sense.aware) || sense.eyeSees)) {
      // Seen during the walk without ending it (see track): this walk covers the
      // sighting, and heads for her new spot when she is somewhere else.
      const walking = this.state === 'track' && !this.foundClose(sense);
      this.lastSeen = { x: sense.lola.x, z: sense.lola.z, walked: walking };
      this.lostTime = 0;
      const goal = this.goal;
      if (walking && goal && Math.hypot(sense.lola.x - goal.x, sense.lola.z - goal.z) >= this.config.track.replanDistance) {
        this.goal = { x: sense.lola.x, z: sense.lola.z };
      }
    } else {
      this.lostTime += dt;
    }
  }

  // ---- Shared triggers ----

  // Lola has hugged the Leaper long enough and the stomp is ready.
  stompReady() {
    return this.reachTime >= this.config.stomp.trigger && this.cooldowns.stomp <= 0;
  }

  // A pounce could happen now: ready, the brain sees her, she is in the band
  // and not hugging it. Looking for a landing spot is throttled (planInterval).
  leapReady(dt, sense) {
    const c = this.config.leap;
    this.planClock = Math.max(0, this.planClock - dt);
    if (this.cooldowns.leap > 0 || !sense.brainOnline || !sense.aware || sense.inReach) return false;
    if (sense.distance < c.minDistance || sense.distance > c.maxDistance || this.planClock > 0) return false;
    this.planClock = c.planInterval;
    this.plan = sense.planLeap?.() ?? null;
    return Boolean(this.plan);
  }

  // Lola in the eye's line of fire and close enough, and no reposition under way.
  // The eye alone is enough (owner, 2026-11-04): from some spots, such as deep in a
  // container seen past its doors, the eye has a clear shot while the brain's own
  // sight misses her. Then it may stand and shoot out to exitDistance, and a
  // reposition cooldown does not stop it (walking would only make the brain search).
  engageReady(sense) {
    const c = this.config.engage;
    if (!sense.eyeSees) return false;
    if (sense.brainSees ?? sense.aware) return sense.distance <= c.enterDistance && this.cooldowns.reposition <= 0;
    return sense.distance <= c.exitDistance;
  }

  // Shot recently, and neither the brain nor the eye can see who did it.
  investigateReady(sense) {
    const alarm = this.alarm;
    return Boolean(alarm) && !sense.aware && !sense.eyeSees
      && this.time - alarm.time <= this.config.investigate.alarmTime;
  }

  // Lola dropped out of sight a moment ago and this sighting has had no walk yet.
  trackReady() {
    return Boolean(this.lastSeen) && !this.lastSeen.walked && this.lostTime >= this.config.track.reactTime
      && this.goalReachable(this.lastSeen);
  }

  // Not near a spot a walk found no way to (owner, 2026-11-19: if it physically
  // cannot reach her, the brain searches, rather than trying the same spot again).
  goalReachable({ x, z }) {
    const spot = this.unreachable;
    return !spot || Math.hypot(x - spot.x, z - spot.z) > this.config.track.unreachableRadius;
  }

  // Moving on (owner, 2026-11-19): the walk to where she was last seen is done and
  // she is still out of sight; after trailWait of looking round it follows her
  // trail, a walk to where she is now. Only once it has seen her this hunt.
  trailReady(sense) {
    const c = this.config.track;
    // (A sighting at a spot it cannot reach gets no walk of its own: the trail it is.)
    const seen = this.lastSeen;
    return Boolean(sense.lola && seen && (seen.walked || !this.goalReachable(seen))) && this.lostTime >= c.reactTime
      && this.time - this.walkEnded >= c.trailWait && this.goalReachable(sense.lola);
  }

  followTrail(sense) {
    this.trailGoal = { x: sense.lola.x, z: sense.lola.z };
    return ['track', 'following her trail'];
  }

  // ---- One function per state: returns [next state, reason] or nothing ----

  dormant(dt, sense) {
    if (sense.health > 0 && sense.hunting && !sense.lolaDown) return ['search', 'run started'];
    return null;
  }

  search(dt, sense) {
    if (this.stompReady()) return ['stomp', 'Lola under it'];
    if (this.engageReady(sense)) return ['engage', 'eye on Lola'];
    if (this.investigateReady(sense)) return ['investigate', 'shot from out of sight'];
    if (this.trackReady()) return ['track', 'lost sight of Lola'];
    if (this.trailReady(sense)) return this.followTrail(sense);
    if (sense.aware || sense.remembers) return ['chase', 'spotted Lola'];
    return null;
  }

  // The walk has found her: the eye has had her for foundTime, within shooting
  // range (and, after a stand that lost her at once, the walk has gone on a while).
  foundClose(sense) {
    return Boolean(sense.eyeSees) && sense.distance <= this.config.engage.exitDistance
      && this.eyeTime >= this.config.track.foundTime && this.stateTime >= this.findAfter;
  }

  // Walking to where Lola was last seen. A shot from out of sight is newer news.
  // It ends when the eye sees her within shooting range: it stands and shoots.
  // Seen further off (by the eye, firing as it walks) or glimpsed by the brain's
  // flickering sight, it keeps walking, toward her new spot (noteSighting). Handing her
  // back to the brain sooner made it rock: the brain backed off, lost her within
  // 0.3 s and the walk brought it back, over and over (probe, 2026-11-19).
  track(dt, sense) {
    if (this.stompReady()) return ['stomp', 'Lola under it'];
    if (this.investigateReady(sense)) return ['investigate', 'shot from out of sight'];
    if (this.foundClose(sense)) return ['engage', 'found Lola'];
    if (this.noCloser || this.failed) {
      this.unreachable = { x: this.goal.x, z: this.goal.z };
      return ['search', this.noCloser ? 'cannot get closer' : 'cannot get there'];
    }
    if (this.arrived) return ['search', 'not there'];
    if (this.walkLimit !== null && this.stateTime >= this.walkLimit) return ['search', 'gave up'];
    return null;
  }

  investigate(dt, sense) {
    if (this.stompReady()) return ['stomp', 'Lola under it'];
    if (sense.eyeSees) return ['chase', 'found Lola'];
    if (this.arrived) return ['search', 'nobody there'];
    if (this.failed) return ['search', 'cannot get there'];
    if (this.stateTime >= this.config.investigate.maxTime) return ['search', 'gave up'];
    return null;
  }

  chase(dt, sense) {
    if (this.stompReady()) return ['stomp', 'Lola under it'];
    if (this.leapReady(dt, sense)) return ['leap', 'pounce'];
    if (this.investigateReady(sense)) return ['investigate', 'shot from out of sight'];
    if (this.engageReady(sense)) return ['engage', 'in range'];
    if (this.trackReady()) return ['track', 'lost sight of Lola'];
    if (this.trailReady(sense)) return this.followTrail(sense);
    if (!sense.aware && !sense.remembers) return ['search', 'lost Lola'];
    return null;
  }

  engage(dt, sense) {
    const c = this.config.engage;
    if (this.stompReady()) return ['stomp', 'Lola under it'];
    if (this.leapReady(dt, sense)) return ['leap', 'pounce'];
    this.unseenTime = sense.eyeSees ? 0 : this.unseenTime + dt;
    if (sense.eyeSees) this.engageSeen += dt;
    this.heldTime += dt;
    if (sense.distance > c.exitDistance) return ['chase', 'out of range'];
    // Standing to shoot it keeps its own patience (lostSightTime) before it walks: the eye
    // flickers at the edge of cover, and 0.3 s cut every hold short (probe, 2026-11-19).
    if (this.unseenTime >= c.lostSightTime) {
      // Barely had her at all: the next walk goes on past the spot it stood on.
      this.walkPast = this.engageSeen < c.lostSightTime;
      return this.trackReady() ? ['track', 'lost sight of Lola'] : ['chase', 'lost sight'];
    }
    // It walks off only when the brain sees her too: with only the eye on her, the
    // brain would search on the spot (it spun between shots, owner 2026-11-04).
    if (this.heldTime >= c.maxHoldTime && (sense.brainSees ?? sense.aware)) {
      this.cooldowns.reposition = c.repositionTime;
      return ['chase', 'reposition'];
    }
    return null;
  }

  stomp() {
    const c = this.config.stomp;
    if (this.phase === 'windup' && this.phaseTime >= c.windup) {
      this.setPhase('recover');
      this.hooks.onStompImpact?.();
    } else if (this.phase === 'recover' && this.phaseTime >= c.recovery) {
      this.cooldowns.stomp = c.cooldown;
      this.reachTime = 0;
      return ['chase', 'stomp done'];
    }
    return null;
  }

  leap() {
    const c = this.config.leap;
    if (this.phase === 'windup') {
      // Take off once the crouch is done and the brain accepted the landing spot.
      if (this.acceptance === 'refused') return this.cancelLeap('landing refused');
      if (this.phaseTime >= c.windup && this.acceptance === 'accepted') {
        this.setPhase('flight');
        this.hooks.onLeapLaunch?.(this.plan);
      } else if (this.phaseTime >= c.windup + c.acceptTimeout) {
        return this.cancelLeap('no answer');
      }
    } else if (this.phase === 'flight' && this.phaseTime >= c.flight) {
      this.setPhase('recover');
      this.hooks.onLeapLand?.(this.plan);
    } else if (this.phase === 'recover' && this.phaseTime >= c.recovery) {
      this.cooldowns.leap = c.cooldown;
      return ['chase', 'landed'];
    }
    return null;
  }

  // Called off before take-off (enter() tells the Leaper and starts the cooldown).
  cancelLeap(reason) {
    return ['chase', reason];
  }

  stagger() {
    const c = this.config.stagger;
    if (this.stateTime >= c.time) {
      this.cooldowns.stagger = c.cooldown;
      return ['chase', 'recovered'];
    }
    return null;
  }

  downed() {
    const c = this.config.downed;
    if (this.phase === 'falling' && this.phaseTime >= c.sinkTime) this.setPhase('down');
    else if (this.phase === 'down' && !this.permanent && this.phaseTime >= c.recoverTime) {
      this.setPhase('rising');
      this.hooks.onGetUp?.();
    } else if (this.phase === 'rising' && this.phaseTime >= c.getUpTime) {
      return ['chase', 'back up'];
    }
    return null;
  }

  dying() {
    if (this.stateTime >= this.config.dying.time) return ['dead', 'collapsed'];
    return null;
  }

  dead() {
    return null;
  }

  // ---- Changing state ----

  setPhase(phase) {
    this.phase = phase;
    this.phaseTime = 0;
  }

  enter(next, reason) {
    const from = this.state;
    // 1. Leaving a leap before take-off cancels it (the brain is told to stay put).
    if (from === 'leap' && this.phase === 'windup' && next !== 'leap') {
      this.cooldowns.leap = this.config.leap.cooldown;
      this.hooks.onLeapCancel?.(this.plan, reason);
      this.plan = null;
    }
    // 2. The new state starts its clocks and its first phase.
    this.state = next;
    this.reason = reason;
    this.stateTime = 0;
    this.transitions += 1;
    this.setPhase({ stomp: 'windup', leap: 'windup', downed: 'falling' }[next] ?? null);
    if (next === 'engage') {
      this.unseenTime = 0;
      this.engageSeen = 0;
    }
    // A scripted walk ended (its trail is followed trailWait from now).
    if (WALKS.includes(from) && !WALKS.includes(next)) this.walkEnded = this.time;
    // (A stagger leaves Engage too, but it comes back to finish the same hold.)
    if (from === 'engage' && next === 'chase') this.heldTime = 0;
    if (next === 'investigate') {
      this.goal = { x: this.alarm.x, z: this.alarm.z };
      this.alarm = null;
      this.arrived = false;
      this.failed = false;
      // The shot is newer news than where she vanished: no walk back there afterwards.
      if (this.lastSeen) this.lastSeen.walked = true;
    } else if (next === 'track') {
      // Where she was last seen, or (following her trail) where she is now.
      this.goal = this.trailGoal ?? { x: this.lastSeen.x, z: this.lastSeen.z };
      this.trailGoal = null;
      if (this.lastSeen) this.lastSeen.walked = true;
      this.arrived = false;
      this.failed = false;
      this.noCloser = false;
      this.walkLimit = null;
      this.findAfter = this.walkPast ? this.config.track.walkPast : 0;
      this.walkPast = false;
    } else {
      this.goal = null;
    }
    if (next === 'leap') this.acceptance = 'pending';
    if (next === 'downed' && from !== 'downed') this.reachTime = 0;
    // 3. Tell the Leaper (and anyone listening) what started.
    this.hooks.onStateChange?.({ from, to: next, reason });
    if (next === 'stomp') this.hooks.onStompWindup?.();
    if (next === 'leap') this.hooks.onLeapStart?.(this.plan);
    if (next === 'stagger') this.hooks.onStagger?.(reason);
    if (next === 'downed') this.hooks.onDowned?.({ permanent: this.permanent });
    if (next === 'dying') this.hooks.onDeath?.();
    return undefined;
  }
}
