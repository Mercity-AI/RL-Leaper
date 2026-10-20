import { FOOT_HEIGHT } from '../config/robot.js';
import { contact, leaperReach, createLeaperBlocker } from '../world/playerContact.js';
import { GAME_EVENTS } from '../core/events.js';
import { PlayerKnockback } from '../actors/leaper/PlayerKnockback.js';

// One junkyard fight: Lola against a list of enemies (one Leaper today). It owns
//   - the gameplay update order each frame,
//   - enemies[] (each { simulation, brain, combat, actor }: animator, brain
//     client, attacks, and the behaviour layer that decides what the Leaper does
//     around its brain: src/actors/leaper/LeaperActor.js),
//   - the start snapshot (where Lola, each Leaper and the camera were when the
//     fight began), used for a clean RESTART ENCOUNTER,
//   - the win / lose bookkeeping (who won, practice or not, time and damage).
// What the game is doing (playing, paused, ended) lives in GameFlow; the
// encounter reacts to it and asks it to change.

// The end-of-fight banner text for an encounter result. PRACTICE marks a result
// that doesn't count as a real fight (see Encounter.end); TURRET MODE marks that
// the brain was offline for part of the hunt (the Leaper fought back but never
// moved), so brain playtests stay honest; DEBUG TEST marks that the OPTIONS
// debug button did damage.
export function resultText({ winner, practice = false, turret = false, debugUsed = false }) {
  const outcome = winner === 'lola' ? 'LEAPER DEFEATED' : 'LOLA DEFEATED';
  return `${practice ? 'PRACTICE · ' : ''}${outcome}${turret ? ' · TURRET MODE' : ''}${debugUsed ? ' · DEBUG TEST' : ''}`;
}

export class Encounter {
  // vitals: Lola's PlayerVitals (her health decides a loss). audio: the shared
  // sound engine. input: the InputController (its jump buffer is cleared on restart).
  // leaperBehaviour(enemy, encounter): builds each Leaper's behaviour layer (the
  // game passes createLeaperActor); without it the brain alone moves the Leaper.
  // pickups: the health pills (src/game/HealthPills.js), scattered afresh by
  // every restart; none on test pages.
  constructor({ flow, events, world, player, vitals, audio = null, playerController, playerWeapon, input, cameraController,
    leaperBehaviour = null, pickups = null }) {
    Object.assign(this, { flow, events, world, player, vitals, audio, playerController, playerWeapon, cameraController, pickups });
    this.inputController = input;
    this.leaperBehaviour = leaperBehaviour;
    // Leaper attacks may shove Lola (a stomp, a landing); she slides along walls.
    this.knockback = leaperBehaviour ? new PlayerKnockback({ player, events }) : null;
    this.enemies = [];
    this.started = false;
    this.startSnapshot = null;
    this.elapsed = 0;
    this.result = null;
    this.stats = Encounter.emptyStats();
    // Damage bookkeeping comes from the event bus, whoever caused it. Every
    // subscription is kept so dispose() can unhook it again.
    this.unsubscribe = [
      events.on(GAME_EVENTS.lolaDamaged, ({ amount = 0 } = {}) => { this.stats.damageTaken += amount; }),
      events.on(GAME_EVENTS.leaperDamaged, ({ amount = 0, debug = false } = {}) => {
        this.stats.damageDealt += amount;
        // Damage from the OPTIONS debug button, or dealt while the Leaper could not
        // fight back (stopped, exploring, paused), makes the eventual win practice.
        if (debug || !this.flow.hunting) this.stats.assisted = true;
        if (debug) this.stats.debugUsed = true;
      }),
      events.on(GAME_EVENTS.jointBroken, () => { this.stats.jointsBroken += 1; }),
      flow.onChange((next, previous) => this.onFlowChange(next, previous)),
    ];
  }

  // Per-fight totals, cleared by every restart.
  static emptyStats() {
    return { damageTaken: 0, damageDealt: 0, jointsBroken: 0, assisted: false, debugUsed: false, turret: false };
  }

  // Add a Leaper. Its body and legs block Lola through the world's collision service
  // (the shape its behaviour layer gives, else its brain's).
  // spawn: where it starts after a plain reset (the map spawn by default).
  addEnemy({ simulation, brain, combat, spawn = this.world.spawn }) {
    const enemy = { simulation, brain, combat, spawn, actor: null };
    if (this.leaperBehaviour) enemy.actor = this.leaperBehaviour(enemy, this);
    if (this.player.isPlayer && this.world.collision) {
      enemy.removeBlocker = this.world.collision.addDynamicBlocker(createLeaperBlocker(enemy.actor ?? brain, this.player, this.world));
    }
    this.enemies.push(enemy);
    return enemy;
  }

  // The first Leaper: what the single-enemy systems (weapon, POV, HUD) look at.
  get primary() {
    return this.enemies[0];
  }

  // The fight is decided once Lola is down or every Leaper is.
  get lolaDefeated() {
    return this.vitals.dead;
  }

  get leapersDefeated() {
    return this.enemies.length > 0 && this.enemies.every(({ combat }) => combat.leaperHealth <= 0);
  }

  get over() {
    return this.lolaDefeated || this.leapersDefeated;
  }

  // Gameplay time: frozen while paused, real time otherwise.
  gameDelta(dt) {
    return this.flow.paused ? 0 : dt;
  }

  // ---- Frame phases ----

  // Input phase: read what the player asks for (nothing is applied while paused).
  input(dt) {
    this.playerController.sample(dt, { frozen: this.flow.paused });
  }

  // Gameplay phase, in a fixed order: Lola (and any shove she is getting), each
  // Leaper's brain, each Leaper's behaviour and animator, each Leaper's attacks
  // and bolts, the health pills she walks through, Lola's health panel, then Lola's gun.
  update(dt) {
    const gameDt = this.gameDelta(dt);
    this.playerController.update(gameDt);
    this.knockback?.update(gameDt);
    for (const enemy of this.enemies) enemy.brain.update(gameDt);
    for (const enemy of this.enemies) enemy.actor?.update(gameDt);
    for (const enemy of this.enemies) enemy.combat.update(gameDt);
    this.pickups?.update(gameDt);
    this.vitals.update(gameDt, { over: this.over });
    // The Leaper's walking sound only plays during a live hunt.
    if (!this.flow.hunting || this.over) this.quietRobots();
    this.playerWeapon.update(gameDt);
    if (this.flow.hunting) {
      this.elapsed += dt;
      // Remember if the hunt went on without a brain (turret mode) for the result.
      if (this.enemies.some(({ brain }) => brain.offline)) this.stats.turret = true;
    }
  }

  // ---- Reacting to the game state ----

  onFlowChange(next, previous) {
    const hunting = next.name === 'playing' && next.mode === 'hunt';
    const wasHunting = previous.name === 'playing' && previous.mode === 'hunt';
    const wasPlaying = previous.name === 'playing';
    // START RUN (or resume): the fight begins once, then every brain runs (a
    // Leaper with a behaviour layer starts its brain when its state walks).
    if (hunting && !wasHunting) {
      this.begin();
      for (const enemy of this.enemies) if (!enemy.actor) enemy.brain.start();
    }
    // Leaving the hunt (a pause included): brains stop asking for moves until
    // the run continues (their sessions are kept).
    if (wasHunting && !hunting) {
      for (const enemy of this.enemies) enemy.brain.stop();
      this.quietRobots();
    }
    // A pause also silences the fight's sounds still ringing (the eye's charge,
    // a shot, a reload); the yard's ambience bed keeps going under the menu.
    if (next.name === 'paused' && wasPlaying) this.audio?.stop?.();
    // STOP RUN, STOP PLAYER, or switching between them drops the trigger, aim and
    // reload and Lola's flinch, as STOP RUN always did; shots already fired keep
    // fading. A pause and the end of the fight leave both alone: the gun lets go
    // by itself once it can't be used, a paused reload carries on afterwards, and
    // the kill shot's tracer, sparks and shake are not wiped before they are drawn.
    const switchedMode = next.name === 'playing' && wasPlaying && next.mode !== previous.mode;
    if ((wasPlaying && next.name === 'ready') || switchedMode) {
      this.playerWeapon.cancelActions();
      this.player.clearHitReaction?.();
    }
  }

  // ---- Lifecycle ----

  // The first START RUN after a reset: remember where everyone starts.
  begin() {
    if (this.started) return;
    this.started = true;
    this.startSnapshot = this.snapshot();
    this.events.emit(GAME_EVENTS.encounterStarted, { snapshot: this.startSnapshot });
  }

  // Someone is down: record the result and end the game state. An ending outside
  // a live hunt, or a win helped by debug or free shots, is practice.
  end() {
    if (this.flow.ended || !this.over) return false;
    const winner = this.lolaDefeated ? 'leaper' : 'lola';
    const practice = !this.flow.hunting || (winner === 'lola' && this.stats.assisted);
    this.result = { winner, practice, seconds: this.elapsed, ...this.stats };
    this.result.text = resultText(this.result);
    this.flow.end(winner, practice);
    this.events.emit(GAME_EVENTS.encounterEnded, { winner, practice, stats: this.result });
    return true;
  }

  // Where everyone stands right now (positions in world units, yaw in radians).
  snapshot() {
    const lola = this.player.mesh;
    return {
      lola: { x: lola.position.x, z: lola.position.z, yaw: lola.rotation.y },
      camera: { yaw: this.cameraController.yaw, pitch: this.cameraController.pitch },
      leapers: this.enemies.map(({ simulation }) => ({
        x: simulation.state.position.x, z: simulation.state.position.z, yaw: simulation.state.yaw,
      })),
    };
  }

  // Back to Ready with full health and fresh brain sessions. Positions come from
  // a RESTART RANDOM spawn pair if given, else this fight's start snapshot (a
  // clean retry), else the map spawn with Lola where she is.
  restart(spawn = null) {
    // 1. Fresh health for Lola and every Leaper, no bolts, legs back, attack timers
    //    cleared, behaviour back to dormant, no shove on Lola.
    this.vitals.reset();
    for (const enemy of this.enemies) enemy.combat.reset();
    for (const enemy of this.enemies) enemy.actor?.reset();
    this.knockback?.clear();
    // 2. Ready, then make sure nothing is still firing, walking, flinching or
    //    shaking, and both magazines are full again.
    this.flow.stop();
    this.quietRobots();
    for (const enemy of this.enemies) enemy.brain.stop();
    this.playerWeapon.resetEncounter();
    this.player.clearHitReaction?.();
    this.cameraController.resetEffects?.();
    // 3. Starting positions.
    const snapshot = spawn ? null : this.startSnapshot;
    if (spawn) this.placePlayer({ x: spawn.target.x, z: spawn.target.z });
    else if (snapshot) this.placePlayer(snapshot.lola, snapshot.camera);
    this.enemies.forEach((enemy, index) => {
      const pose = spawn && index === 0 ? { ...spawn.position, yaw: spawn.yaw || 0 }
        : snapshot?.leapers[index] ?? { x: enemy.spawn.x, z: enemy.spawn.z, yaw: 0 };
      this.placeLeaper(enemy, pose);
    });
    this.keepPlayerClear();
    // A new game: fresh health pills, scattered away from where Lola now stands.
    this.pickups?.reset();
    this.player.resetJump?.();
    this.inputController.jumpBuffer = 0;
    this.cameraController.target.copy(this.player.mesh.position);
    this.cameraController.target.y = this.player.height ? this.player.height * 1.05 : 1;
    // 4. A new fight: fresh totals and brain sessions; the next START RUN takes a new snapshot.
    this.started = false;
    this.elapsed = 0;
    this.result = null;
    this.stats = Encounter.emptyStats();
    for (const enemy of this.enemies) enemy.brain.reset();
  }

  // Put Lola on the floor at { x, z } (and facing yaw, with the camera behind her).
  placePlayer({ x, z, yaw }, camera = null) {
    this.player.mesh.position.set(x, this.player.isPlayer ? 0 : 3.5, z);
    if (yaw !== undefined) this.player.mesh.rotation.y = yaw;
    if (camera) {
      this.cameraController.yaw = camera.yaw;
      this.cameraController.pitch = camera.pitch;
    }
  }

  // Put a Leaper at a pose, standing, still, with its feet planted around it
  // (its behaviour layer plays on from there).
  placeLeaper({ simulation, actor }, { x, z, yaw }) {
    const state = simulation.state;
    state.position.set(x, 0, z);
    state.previousVelocity.set(0, 0, 0);
    state.jumpHeight = 0;
    state.verticalVelocity = 0;
    state.grounded = true;
    state.yaw = yaw;
    state.velocity.set(0, 0, 0);
    const c = Math.cos(yaw), s = Math.sin(yaw);
    simulation.rig.legs.forEach((leg) => {
      leg.footPosition.set(x + leg.homeLocal.x * c + leg.homeLocal.z * s, (this.world.floorHeight ?? 0) + FOOT_HEIGHT,
        z - leg.homeLocal.x * s + leg.homeLocal.z * c);
      leg.stepping = false;
    });
    actor?.placed({ x, z, yaw });
  }

  // Game logic moves a Leaper between brain moves (a leap, a scripted
  // reposition): its animator stands it at the new pose and its brain is told
  // (JunkyardBrain.syncPose), so the brain sees and moves from there. Resolves
  // with the brain's frame at the new pose. If the brain refuses the spot (it
  // overlaps a wreck), the Leaper is put back where the brain still has it and
  // the promise rejects. The brain's rules themselves are never changed.
  async teleportLeaper(enemy, { x, z, yaw }) {
    this.placeLeaper(enemy, { x, z, yaw });
    if (!enemy.brain.syncPose) return null;
    try {
      return await enemy.brain.syncPose({ x, z, yaw });
    } catch (error) {
      const back = enemy.brain.frame;
      if (back) this.placeLeaper(enemy, { x: back.x, z: back.z, yaw: back.yaw });
      throw error;
    }
  }

  // Lola must never start inside a Leaper's reach: if she does, move her to the
  // first clear navigation cell far enough from every Leaper.
  keepPlayerClear() {
    if (!this.player.isPlayer) return;
    const minimum = leaperReach(this.world.scale) + contact.pendingStepMargin;
    const tooClose = (px, pz) => this.enemies.some(({ simulation: { state } }) =>
      Math.hypot(px - state.position.x, pz - state.position.z) < minimum);
    const p = this.player.mesh.position;
    if (!tooClose(p.x, p.z)) return;
    const nav = this.world.navigation;
    for (let i = 0; i < nav.free.length; i += 1) {
      if (!nav.free[i]) continue;
      const point = nav.point(i);
      const px = point.x * this.world.scale, pz = point.z * this.world.scale;
      if (tooClose(px, pz)) continue;
      p.set(px, 0, pz);
      break;
    }
  }

  // Cut the Leapers' walking sounds (one shared sound engine plays them all).
  quietRobots() {
    this.audio?.stopRobotSteps();
  }

  // The session is over (a mode is disposed): unhook the Leapers from the world's
  // collision, stop their brains (late replies are dropped), and stop listening
  // to the game state and events, so a later session on the same flow or bus
  // never drives this finished fight.
  dispose() {
    for (const enemy of this.enemies) {
      enemy.removeBlocker?.();
      enemy.actor?.dispose();
      enemy.brain.stop();
      enemy.brain.dispose?.();
    }
    this.knockback?.dispose();
    this.pickups?.dispose();
    for (const off of this.unsubscribe.splice(0)) off();
  }
}
