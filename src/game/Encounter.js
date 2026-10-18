import { FOOT_HEIGHT } from '../config/robot.js';
import { contact, leaperReach, createLeaperBlocker } from '../world/playerContact.js';
import { GAME_EVENTS } from '../core/events.js';

// One junkyard fight: Lola against a list of enemies (one Leaper today). It owns
//   - the gameplay update order each frame,
//   - enemies[] (each { simulation, brain, combat }: animator, brain client, attacks),
//   - the start snapshot (where Lola, each Leaper and the camera were when the
//     fight began), used for a clean RESTART ENCOUNTER,
//   - the win / lose bookkeeping (who won, practice or not, time and damage).
// What the game is doing (playing, paused, ended) lives in GameFlow; the
// encounter reacts to it and asks it to change.
export class Encounter {
  // input: the InputController (its jump buffer is cleared on restart).
  constructor({ flow, events, world, player, playerController, playerWeapon, input, cameraController }) {
    Object.assign(this, { flow, events, world, player, playerController, playerWeapon, cameraController });
    this.inputController = input;
    this.enemies = [];
    this.started = false;
    this.startSnapshot = null;
    this.elapsed = 0;
    this.result = null;
    this.stats = Encounter.emptyStats();
    // Damage bookkeeping comes from the event bus, whoever caused it.
    events.on(GAME_EVENTS.lolaDamaged, ({ amount = 0 } = {}) => { this.stats.damageTaken += amount; });
    events.on(GAME_EVENTS.leaperDamaged, ({ amount = 0 } = {}) => { this.stats.damageDealt += amount; });
    events.on(GAME_EVENTS.jointBroken, () => { this.stats.jointsBroken += 1; });
    flow.onChange((next, previous) => this.onFlowChange(next, previous));
  }

  static emptyStats() {
    return { damageTaken: 0, damageDealt: 0, jointsBroken: 0 };
  }

  // Add a Leaper. Its body and legs block Lola through the world's collision service.
  // spawn: where it starts after a plain reset (the map spawn by default).
  addEnemy({ simulation, brain, combat, spawn = this.world.spawn }) {
    const enemy = { simulation, brain, combat, spawn };
    if (this.player.isPlayer && this.world.collision) {
      enemy.removeBlocker = this.world.collision.addDynamicBlocker(createLeaperBlocker(brain, this.player, this.world));
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
    return this.enemies.some(({ combat }) => combat.lolaHealth <= 0);
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

  // Gameplay phase, in a fixed order: Lola, each Leaper's brain and animator,
  // each Leaper's attacks and bolts, then Lola's gun.
  update(dt) {
    const gameDt = this.gameDelta(dt);
    this.playerController.update(gameDt);
    for (const enemy of this.enemies) enemy.brain.update(gameDt);
    for (const enemy of this.enemies) enemy.combat.update(gameDt);
    // The Leaper's walking sound only plays during a live hunt.
    if (!this.flow.hunting || this.over) for (const enemy of this.enemies) enemy.combat.audio.stopRobotSteps();
    this.playerWeapon.update(gameDt);
    if (this.flow.hunting) this.elapsed += dt;
  }

  // ---- Reacting to the game state ----

  onFlowChange(next, previous) {
    const hunting = next.name === 'playing' && next.mode === 'hunt';
    const wasHunting = previous.name === 'playing' && previous.mode === 'hunt';
    const wasPlaying = previous.name === 'playing';
    // START RUN (or resume): the fight begins once, then every brain runs.
    if (hunting && !wasHunting) {
      this.begin();
      for (const enemy of this.enemies) enemy.brain.start();
    }
    // Leaving the hunt: brains stop asking for moves (their sessions are kept).
    if (wasHunting && !hunting) {
      for (const enemy of this.enemies) enemy.brain.stop();
      this.quietRobots();
      this.player.clearHitReaction?.();
    }
    // Leaving the hunt or play (for Ready, Paused or exploring) drops the trigger,
    // aim and reload, as STOP RUN always did. At the end of the fight the gun is
    // left alone, so the kill shot's effects are not wiped before they are drawn.
    const leftPlay = wasPlaying && next.name !== 'playing';
    if (next.name !== 'ended' && (leftPlay || (wasHunting && !hunting))) this.playerWeapon.reset();
  }

  // ---- Lifecycle ----

  // The first START RUN after a reset: remember where everyone starts.
  begin() {
    if (this.started) return;
    this.started = true;
    this.elapsed = 0;
    this.result = null;
    this.stats = Encounter.emptyStats();
    this.startSnapshot = this.snapshot();
    this.events.emit(GAME_EVENTS.encounterStarted, { snapshot: this.startSnapshot });
  }

  // Someone is down: record the result and end the game state. A win while not
  // hunting (START PLAYER, stopped, or paused) is practice.
  end() {
    if (this.flow.ended || !this.over) return false;
    const winner = this.lolaDefeated ? 'leaper' : 'lola';
    const practice = !this.flow.hunting;
    this.result = { winner, practice, seconds: this.elapsed, ...this.stats };
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
    // 1. Fresh health, bolts, legs and attack timers.
    for (const enemy of this.enemies) enemy.combat.reset();
    // 2. Ready, then make sure nothing is still firing, walking or flinching.
    this.flow.stop();
    this.quietRobots();
    for (const enemy of this.enemies) enemy.brain.stop();
    this.playerWeapon.reset();
    this.player.clearHitReaction?.();
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
    this.player.resetJump?.();
    this.inputController.jumpBuffer = 0;
    this.cameraController.target.copy(this.player.mesh.position);
    this.cameraController.target.y = this.player.height ? this.player.height * 1.05 : 1;
    // 4. A new fight: fresh brain sessions, and the next START RUN takes a new snapshot.
    this.started = false;
    this.elapsed = 0;
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

  // Put a Leaper at a pose, standing, still, with its feet planted around it.
  placeLeaper({ simulation }, { x, z, yaw }) {
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

  quietRobots() {
    for (const enemy of this.enemies) enemy.combat.audio.stopRobotSteps();
  }

  // Unhook the Leapers from the world's collision (used when a mode is disposed).
  dispose() {
    for (const enemy of this.enemies) {
      enemy.removeBlocker?.();
      enemy.brain.stop();
    }
  }
}
