import * as THREE from 'three';
import { LEAPER_ANGLES, LEAPER_BEHAVIOUR } from '../../config/leaper-behaviour.js';
import { STANDING_HEIGHT } from '../../config/robot.js';
import { contact, leaperReach, severedLegs } from '../../world/playerContact.js';
import { shortestAngle, turnToward, wrapAngle } from '../../core/angles.js';
import { LEAPER_STEPS_PER_SECOND } from '../../simulation/JunkyardBrain.js';
import { LeaperDirector } from './LeaperDirector.js';
import { SnapshotPlayout } from './SnapshotPlayout.js';
import { leapArc, planLeap } from './leapPlanner.js';
import { LeaperFeedback } from './LeaperFeedback.js';
import { LEAPER_EVENTS } from './leaperEvents.js';

// One Leaper in the fight: carries out what its LeaperDirector decides.
//   - It tells the frozen brain when to step (Search, Chase) and when to pause
//     (everything else), and after a turn in place or a leap tells it the new
//     pose through JunkyardBrain.syncPose, the documented API. The brain's
//     inputs, actions and physics are never touched.
//   - It moves the visible Leaper: the brain's replies played back smoothly
//     (SnapshotPlayout), a turn in place, the leap's arc, a crouch, a recoil, a
//     fall, the collapse; and gives Lola's collision the matching shape.
//   - It runs the stomp and the leap (telegraphs, area hits, knockback) and the
//     feedback around them (LeaperFeedback), and announces it all on the event bus.
// Encounter creates one per Leaper (Encounter `leaperBehaviour` option) and
// calls update() each frame between the brain's update and the attacks'.

const ALL_LEGS = Object.freeze([0, 1, 2, 3, 4, 5]);
// The plain walk.
const STANDING = Object.freeze({ lower: 0, pitch: 0, roll: 0, splay: 0, planted: false, slide: 0 });
// How fast the body eases into a new pose (1/seconds).
const POSTURE_RATE = 12;
// A pose this close to the brain's needs no sync.
const SAME_POSE = 1e-4;

const ease = (u) => {
  const t = Math.min(1, Math.max(0, u));
  return t * t * (3 - 2 * t);
};

export class LeaperActor {
  // enemy: { simulation, brain, combat }; encounter: the fight's shared pieces
  // ({ flow, events, world, player, vitals, audio, cameraController }).
  // feedback: false for no visual effects (Node tests); scene: where effects go.
  constructor({ simulation, brain, combat }, { flow, events, world, player, vitals, audio = null, cameraController = null },
    { config = LEAPER_BEHAVIOUR, name = 'leaper', scene = combat?.playtest?.engine?.scene ?? null, feedback = true } = {}) {
    Object.assign(this, { simulation, brain, combat, flow, events, world, player, vitals, audio, cameraController, config, name });
    // 1. The decision layer, with this actor carrying out its hooks.
    this.director = new LeaperDirector({ config, hooks: this.hooks() });
    // 2. The visible pose and how it moves.
    this.playout = new SnapshotPlayout(config.motion);
    this.pose = { x: 0, z: 0, yaw: 0 };
    this.posture = { ...STANDING };
    this.flight = null;
    this.turning = false;
    this.wasRl = false;
    // 3. The brain no longer animates the rig: this actor does (JunkyardBrain.drivesAnimator).
    brain.drivesAnimator = false;
    // 4. Effects, and the hooks from combat: hits, joint breaks, the HUD.
    this.feedback = feedback && scene ? new LeaperFeedback({ scene, rig: simulation.rig, world }) : null;
    if (combat) {
      combat.behaviour = this;
      if (combat.legs) combat.legs.onBroken = (event) => this.legBroken(event);
      combat.onDamaged = (event) => this.damaged(event);
    }
    this.placed({ x: simulation.state.position.x, z: simulation.state.position.z, yaw: simulation.state.yaw });
  }

  // ---- Lifecycle ----

  // A restart: dormant, standing, no effects, normal damage, lights back on.
  reset() {
    this.director.reset();
    this.flight = null;
    this.posture = { ...STANDING };
    Object.assign(this.simulation.state.posture ??= { ...STANDING }, STANDING);
    this.feedback?.reset();
    if (this.combat) {
      this.combat.hold = null;
      this.combat.damageScale = 1;
      this.combat.dyingGlow = undefined;
    }
    this.brain.heldBy = null;
    this.restoreGlow();
    this.placed({ x: this.simulation.state.position.x, z: this.simulation.state.position.z, yaw: this.simulation.state.yaw });
  }

  // The Leaper was put somewhere directly (RESET, a restart, a teleport): play from there.
  placed({ x, z, yaw }) {
    this.pose = { x, z, yaw };
    this.playout.reset(this.pose);
    this.lastFrame = this.brain.frame;
    this.flight = null;
    this.heldTurn = false;
  }

  dispose() {
    this.feedback?.dispose();
    this.feedback = null;
    if (this.combat?.legs?.onBroken) this.combat.legs.onBroken = null;
    if (this.combat) this.combat.onDamaged = null;
  }

  // ---- What the Leaper knows this frame (the director's sense) ----

  sense() {
    const frame = this.brain.frame;
    const online = Boolean(this.brain.ready && !this.brain.offline);
    const lola = this.player.mesh.position;
    const distance = Math.hypot(lola.x - this.pose.x, lola.z - this.pose.z);
    const eyeSees = Boolean(this.combat?.lolaVisible);
    const scale = this.world.scale ?? 1;
    return {
      hunting: this.flow.hunting,
      health: this.combat?.leaperHealth ?? 1,
      lolaDown: Boolean(this.vitals?.dead),
      brainOnline: online,
      // The brain's own sight decides awareness; in turret mode the eye does.
      aware: online ? Boolean(frame?.target_visible) : eyeSees,
      remembers: online && Boolean(frame?.target_ever_seen) && (frame?.memory_age ?? Infinity) < this.config.awareness.memorySteps,
      eyeSees,
      distance,
      inReach: distance < leaperReach(scale) + this.config.stomp.reachMargin,
      planLeap: () => this.planLeap(),
    };
  }

  // A pounce at Lola from where the Leaper stands (see leapPlanner.js).
  planLeap() {
    const lola = this.player.mesh.position;
    const scale = this.world.scale ?? 1;
    return planLeap({
      from: this.pose, lola: { x: lola.x, z: lola.z },
      // The world's conservative test covers the whole leg span at any heading.
      clear: (x, z) => !this.world.positionBlocked?.(x, z),
      // Never land with Lola inside the Leaper's reach.
      apart: (x, z) => Math.hypot(lola.x - x, lola.z - z) >= leaperReach(scale),
      config: this.config.leap,
    });
  }

  // ---- The frame update ----

  update(dt) {
    if (!(dt > 0)) return;
    // 1. Decide (the state machine), then let the brain step or pause.
    this.director.update(dt, this.sense());
    this.driveBrain();
    // 2. Move the visible Leaper and lay its pose over the walk.
    this.move(dt);
    // 3. The eye's bolts only fly where the state allows; eye and legs glow as it dies.
    if (this.combat) this.combat.hold = this.director.boltsAllowed ? null : this.director.state;
    this.updateGlow();
    this.feedback?.update(dt);
  }

  // Step the brain in RL states, pause it otherwise; resuming after a turn in
  // place (or a cancelled leap) first tells it where the Leaper now stands.
  driveBrain() {
    const brain = this.brain;
    const alive = (this.combat?.leaperHealth ?? 1) > 0 && !this.vitals?.dead;
    const rl = this.director.locomotion === 'rl' && this.flow.hunting && alive;
    if (rl && !this.wasRl) this.resumeBrain();
    if (rl && !brain.running && !brain.offline) brain.start();
    if (!rl && brain.running) brain.stop();
    // The badge says why the brain is not stepping during a hunt.
    brain.heldBy = !rl && this.flow.hunting && alive ? this.director.label : null;
    this.wasRl = rl;
  }

  resumeBrain() {
    const brainPose = this.brain.frame;
    const moved = !brainPose || Math.hypot(brainPose.x - this.pose.x, brainPose.z - this.pose.z) > SAME_POSE
      || Math.abs(shortestAngle(brainPose.yaw ?? 0, this.pose.yaw)) > SAME_POSE;
    this.playout.reset(this.pose);
    if (moved && brainPose && this.brain.syncPose) this.syncBrain(this.pose);
    this.lastFrame = this.brain.frame;
    this.heldTurn = false;
  }

  // Tell the brain the Leaper's pose (a documented pose sync). A refusal puts
  // the brain's frame back where it was, and the playout follows it there.
  syncBrain({ x, z, yaw }) {
    return this.brain.syncPose({ x, z, yaw }).catch(() => null);
  }

  // ---- Movement ----

  move(dt) {
    const director = this.director;
    const locomotion = director.locomotion;
    const interval = 1 / (LEAPER_STEPS_PER_SECOND * Math.max(0.05, this.simulation.rig.mobility ?? 1));
    // 1. Brain replies feed the playback, except while a leap (or the collapse)
    //    owns the body: then the brain's pose is the landing spot, not the body's.
    const frame = this.brain.frame;
    if (frame && frame !== this.lastFrame) {
      this.lastFrame = frame;
      if (this.followsBrain) this.playout.push(frame);
    }
    // 2. Where the body goes this frame.
    if (locomotion === 'scripted' && this.flight) {
      this.flight.time += dt;
      const arc = leapArc(this.flight.plan, this.flight.time, this.config.leap);
      Object.assign(this.pose, { x: arc.x, z: arc.z, yaw: wrapAngle(arc.yaw) });
      this.simulation.setAirborne(arc.height, arc.verticalVelocity);
    } else if (locomotion !== 'scripted') {
      // RL plays the brain's path; Hold finishes any move already on its way.
      this.playout.advance(dt, interval);
      const played = this.playout.sample();
      this.pose.x = played.x;
      this.pose.z = played.z;
      // The heading follows the brain too, until a turn in place takes it over.
      if (locomotion === 'rl' || !this.heldTurn) this.pose.yaw = played.yaw;
      if (locomotion === 'hold') this.turnInPlace(dt);
    } else if (!this.simulation.state.grounded) {
      // Killed in mid-air: drop to the floor where it was.
      const state = this.simulation.state;
      this.simulation.setAirborne(state.jumpHeight - 9 * dt, -9);
      if (state.jumpHeight <= 0) this.simulation.land();
    }
    // 3. The pose of the state (crouch, recoil, fall, collapse) eases in.
    this.applyPosture(dt);
    // 4. The animator walks the legs to it (no idle sway once destroyed).
    const alive = director.state !== 'dying' && director.state !== 'dead';
    this.simulation.applyExternalFrame({ ...this.pose, collision: locomotion === 'rl' && Boolean(frame?.collision) },
      dt, null, { alive });
  }

  // Whether the brain's replies move the body (not during a leap, nor once destroyed).
  get followsBrain() {
    return !['leap', 'dying', 'dead'].includes(this.director.state);
  }

  // Hold: turn the body in place toward Lola (Engage) or the leap's direction
  // (its crouch). Only where the whole leg span is clear at every heading (the
  // world's conservative test), so the brain will accept the pose afterwards.
  turnInPlace(dt) {
    const facing = this.director.facing;
    if (!facing) return;
    const lola = this.player.mesh.position;
    const target = facing === 'lola' ? Math.atan2(lola.x - this.pose.x, lola.z - this.pose.z) : this.director.plan?.heading;
    if (target === undefined || this.world.positionBlocked?.(this.pose.x, this.pose.z)) return;
    const off = Math.abs(shortestAngle(this.pose.yaw, target));
    if (off > LEAPER_ANGLES.faceTolerance) this.turning = true;
    else if (off < LEAPER_ANGLES.faceTolerance / 6) this.turning = false;
    if (this.turning || facing === 'leap') {
      this.pose.yaw = wrapAngle(turnToward(this.pose.yaw, target, LEAPER_ANGLES.engageTurnRate * dt));
      this.heldTurn = true;
    }
  }

  // ---- Poses laid over the walk ----

  // The pose the current state asks for, at this moment of it.
  targetPosture() {
    const { state, phase, phaseTime: t, stateTime } = this.director;
    const c = this.config;
    const target = { ...STANDING };
    if (state === 'stomp') {
      // Crouch for the stamp, then spring back up.
      const crouch = phase === 'windup' ? ease(t / c.stomp.windup) : 1 - ease(t / c.stomp.recovery);
      target.lower = c.stomp.crouch * crouch;
      target.pitch = 0.08 * crouch;
    } else if (state === 'leap' && phase === 'windup') {
      target.lower = c.leap.crouch * ease(t / c.leap.windup);
      target.pitch = -0.06 * ease(t / c.leap.windup);
    } else if (state === 'stagger') {
      // Rocked back hard at first, then settling.
      const u = stateTime / c.stagger.time;
      const recoil = u < 0.2 ? ease(u / 0.2) : 1 - ease((u - 0.2) / 0.8);
      target.pitch = -c.stagger.recoilPitch * recoil;
      target.lower = c.stagger.recoilLower * recoil;
    } else if (state === 'downed') {
      // Sinks to the floor, legs splayed and planted; later stands back up.
      const drop = STANDING_HEIGHT - c.downed.restHeight;
      const down = phase === 'falling' ? ease(t / c.downed.sinkTime) : phase === 'rising' ? 1 - ease(t / c.downed.getUpTime) : 1;
      target.lower = drop * down;
      target.roll = this.rollSide() * 0.12 * down;
      target.splay = c.downed.splay * down;
      target.planted = true;
      target.slide = 4;
    } else if (state === 'dying' || state === 'dead') {
      // The collapse: eases to the floor, rolls toward its missing legs, legs splay.
      const u = state === 'dead' ? 1 : ease(stateTime / c.dying.time);
      target.lower = (STANDING_HEIGHT - c.dying.restHeight) * u;
      target.roll = this.rollSide() * c.dying.roll * u;
      target.pitch = 0.1 * u;
      target.splay = c.dying.splay * u;
      target.planted = true;
      target.slide = 3;
    }
    return target;
  }

  applyPosture(dt) {
    const target = this.targetPosture();
    const blend = 1 - Math.exp(-POSTURE_RATE * dt);
    for (const key of ['lower', 'pitch', 'roll', 'splay']) this.posture[key] += (target[key] - this.posture[key]) * blend;
    this.posture.planted = target.planted;
    this.posture.slide = target.slide;
    Object.assign(this.simulation.state.posture ??= { ...STANDING }, this.posture);
  }

  // +1 or -1: which way to roll so the side with missing legs goes down.
  rollSide() {
    const lateral = this.simulation.rig.legs.filter((leg) => leg.disabled).reduce((sum, leg) => sum + leg.out.x, 0);
    return lateral > 0 ? -1 : 1;
  }

  // ---- Glow: the eye and leg lights fade out as it dies ----

  updateGlow() {
    const { state, stateTime } = this.director;
    if (state !== 'dying' && state !== 'dead') return;
    const level = state === 'dead' ? 0 : Math.max(0, 1 - stateTime / this.config.dying.eyeFade);
    if (this.combat) this.combat.dyingGlow = level;
    const materials = this.simulation.rig.materials;
    if (materials?.glow) materials.glow.emissiveIntensity = 1.9 * level;
    if (materials?.glowSoft) materials.glowSoft.emissiveIntensity = level;
  }

  restoreGlow() {
    const materials = this.simulation.rig.materials;
    if (materials?.glowSoft) materials.glowSoft.emissiveIntensity = 1;
    if (materials?.glow) materials.glow.emissiveIntensity = 2;
  }

  // ---- Lola's collision with this Leaper ----

  // { from, to, margin, disabledLegs } for createLeaperBlocker, or null when it
  // touches nothing (high in a leap, Lola can run under it). The wreck keeps
  // only its hull and stumps, so Lola can walk right up to it.
  contactPoses() {
    const pose = { ...this.pose };
    const state = this.director.state;
    if (state === 'dying' || state === 'dead') return { from: pose, to: pose, margin: 0, disabledLegs: ALL_LEGS };
    if ((this.simulation.state.jumpHeight ?? 0) > this.config.leap.clearHeight) return null;
    const disabledLegs = severedLegs(this.simulation.rig);
    // While following the brain, its newest pose counts too (the body is on its way there).
    const to = this.followsBrain && this.brain.frame ? this.brain.frame : pose;
    const margin = this.director.locomotion === 'rl' && this.brain.pendingMovement ? contact.pendingStepMargin : 0;
    return { from: pose, to, margin, disabledLegs };
  }

  // ---- Damage coming in (from LeaperCombat) ----

  // A bullet (or the debug button) hurt the Leaper: flash and sparks; a crit on
  // the weak point is a big hit.
  damaged({ point = null, normal = null, weakPoint = false, major = false } = {}) {
    this.feedback?.hit({ point, normal, strength: weakPoint ? 1.5 : 1 });
    if (weakPoint && !major) this.director.bigHit('weakPoint');
  }

  // A joint snapped: the burst, and a stagger or a fall (the director decides).
  legBroken(event) {
    this.feedback?.jointBurst(event.position);
    this.audio?.playSlot?.('leaperJointBurst');
    this.events?.emit(LEAPER_EVENTS.jointBurst, { leaper: this.name, position: { x: event.position.x, y: event.position.y, z: event.position.z }, lost: event.lost });
    this.director.legBroken(event);
  }

  // ---- The director's hooks: what each decision does in the game ----

  hooks() {
    const c = this.config;
    const emit = (name, payload) => this.events?.emit(name, { leaper: this.name, ...payload });
    return {
      onStateChange: ({ from, to, reason }) => {
        if (from === 'downed' && this.combat) this.combat.damageScale = 1;
        emit(LEAPER_EVENTS.stateChanged, { from, to, reason, locomotion: this.director.locomotion, label: this.director.label });
      },
      // Stomp: warn (crouch, red ring, sound), then slam the area around it.
      onStompWindup: () => {
        this.combat?.tree.cancel();
        this.feedback?.stompWarning(this.pose, c.stomp.radius, c.stomp.windup);
        this.audio?.playSlot?.('leaperStompWindup');
        emit(LEAPER_EVENTS.attack, { kind: 'stomp', phase: 'windup', position: { x: this.pose.x, z: this.pose.z } });
      },
      onStompImpact: () => {
        const hit = this.areaHit(this.pose, c.stomp.radius, c.stomp.damage, c.stomp.knockback);
        this.cameraController?.shake(c.stomp.cameraShake);
        this.audio?.playSlot?.('leaperStomp');
        emit(LEAPER_EVENTS.attack, { kind: 'stomp', phase: 'impact', hit, position: { x: this.pose.x, z: this.pose.z } });
      },
      // Leap: crouch and mark the landing while the brain checks the spot...
      onLeapStart: (plan) => {
        this.combat?.tree.cancel();
        this.feedback?.landingMarker(plan.to, c.leap.shockwave.radius);
        this.audio?.playSlot?.('leaperLeapWindup');
        emit(LEAPER_EVENTS.attack, { kind: 'leap', phase: 'windup', position: { x: plan.to.x, z: plan.to.z } });
        this.brain.syncPose(plan.to).then(() => this.director.leapAccepted(true), () => this.director.leapAccepted(false));
      },
      // ...jump (a scripted arc; the brain stays paused)...
      onLeapLaunch: (plan) => {
        plan.from = { ...this.pose };
        plan.launchYaw = this.pose.yaw;
        this.flight = { plan, time: 0 };
        emit(LEAPER_EVENTS.attack, { kind: 'leap', phase: 'launch', position: { x: plan.to.x, z: plan.to.z } });
      },
      // ...land with a shockwave, and let the brain look from its new spot.
      onLeapLand: (plan) => {
        this.flight = null;
        Object.assign(this.pose, plan.to);
        this.simulation.land();
        this.playout.reset(this.pose);
        const hit = this.areaHit(plan.to, c.leap.shockwave.radius, c.leap.shockwave.damage, c.leap.shockwave.knockback);
        this.cameraController?.shake(c.leap.cameraShake);
        this.audio?.playSlot?.('leaperLand');
        this.syncBrain(plan.to);
        emit(LEAPER_EVENTS.attack, { kind: 'leap', phase: 'land', hit, position: { x: plan.to.x, z: plan.to.z } });
      },
      // Called off before take-off: the brain is told it never left.
      onLeapCancel: (plan, reason) => {
        this.feedback?.clearWarnings();
        if (!this.flight) this.syncBrain(this.pose);
        emit(LEAPER_EVENTS.attack, { kind: 'leap', phase: 'cancel', reason, position: { x: this.pose.x, z: this.pose.z } });
      },
      // Stagger: every wind-up is cancelled and the next bolt waits.
      onStagger: (reason) => {
        this.feedback?.clearWarnings();
        this.combat?.tree.interrupt?.(c.stagger.attackRecovery);
        this.audio?.playSlot?.('leaperStagger');
        emit(LEAPER_EVENTS.staggered, { reason });
      },
      // Down: it sinks, takes extra damage and keeps firing.
      onDowned: ({ permanent }) => {
        this.feedback?.clearWarnings();
        this.combat?.tree.cancel();
        if (this.combat) this.combat.damageScale = c.downed.damageTakenScale;
        this.cameraController?.shake(0.4);
        this.audio?.playSlot?.('leaperDowned');
        emit(LEAPER_EVENTS.downed, { permanent });
      },
      onGetUp: () => emit(LEAPER_EVENTS.downed, { permanent: false, rising: true }),
      // Death: the collapse with sparks and debris; the wreck stays.
      onDeath: () => {
        this.feedback?.clearWarnings();
        this.flight = null;
        const center = this.simulation.rig.robot.getWorldPosition(new THREE.Vector3());
        this.feedback?.deathBurst(center, c.dying);
        this.cameraController?.shake(c.dying.cameraShake);
        this.audio?.playSlot?.('leaperCollapse');
        emit(LEAPER_EVENTS.died, { position: { x: this.pose.x, z: this.pose.z } });
      },
    };
  }

  // An area attack centred at `at`: Lola within `radius` takes `damage` and is
  // shoved straight away from the centre. Returns whether she was hit.
  areaHit(at, radius, damage, knockback) {
    this.feedback?.shockwave(at, radius);
    const lola = this.player.mesh.position;
    let dx = lola.x - at.x, dz = lola.z - at.z;
    const distance = Math.hypot(dx, dz);
    if (distance > radius || this.vitals?.dead) return false;
    // Standing dead centre: shoved the way the Leaper faces.
    if (distance < 1e-3) { dx = Math.sin(this.pose.yaw); dz = Math.cos(this.pose.yaw); }
    const direction = new THREE.Vector3(dx, 0, dz).normalize();
    if (this.combat?.damageLola) this.combat.damageLola(direction, damage);
    else this.vitals?.damage(damage, direction);
    this.events?.emit(LEAPER_EVENTS.lolaKnockback, { direction: { x: direction.x, z: direction.z },
      distance: knockback.distance, time: knockback.time, source: this.name });
    return true;
  }

  // ---- Readouts ----

  // For the Leaper's HUD panel: the state in the player's words, and a debug line.
  hudState() {
    const d = this.director;
    const lost = this.simulation.rig.damagedLegCount ?? 0;
    return {
      state: d.state, label: d.label, locomotion: d.locomotion,
      debug: `${d.state}${d.phase ? `/${d.phase}` : ''} · ${d.locomotion.toUpperCase()} · legs ${6 - lost}/6`
        + ` · stomp ${d.cooldowns.stomp.toFixed(1)} · leap ${d.cooldowns.leap.toFixed(1)}`,
    };
  }
}

// The factory Encounter takes as its `leaperBehaviour` option.
export function createLeaperActor(enemy, encounter) {
  return new LeaperActor(enemy, encounter);
}
