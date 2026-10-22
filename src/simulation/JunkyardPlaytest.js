import { JunkyardBrain } from './JunkyardBrain.js';
import { EyeVision } from './EyeVision.js';
import { PlayerWeapon } from './PlayerWeapon.js';
import { LeaperCombat } from './LeaperCombat.js';
import { LeaperPov } from '../camera/LeaperPov.js';
import { EventBus, GAME_EVENTS } from '../core/events.js';
import { GameFlow } from '../core/GameFlow.js';
import { Encounter } from '../game/Encounter.js';
import { createLeaperActor } from '../actors/leaper/LeaperActor.js';
import { PlayerController } from '../game/PlayerController.js';
import { PlayerVitals } from '../game/PlayerVitals.js';
import { HealthPills } from '../game/HealthPills.js';
import { AmmoBullets } from '../game/AmmoBullets.js';
import { PauseOverlay } from '../game/PauseOverlay.js';
import { captureRunState, restoredPlayerSpot, saveRunState, takeRunState } from '../game/runState.js';
import { disposeObject3D } from '../core/disposeObject3D.js';
import { JunkyardPanel, HELP_MESSAGE } from '../game/JunkyardPanel.js';
import { ClearanceOverlay } from '../game/ClearanceOverlay.js';
import { JunkyardPresentation } from '../game/JunkyardPresentation.js';
import { enableTopViewPlacement } from '../game/topViewPlacement.js';
import { randomGameStart, randomJunkyardStart } from '../world/randomJunkyardStart.js';
import { attachWorldCollision } from '../world/WorldCollision.js';
import { SAVED_WIDTH_KEY } from '../world/createJunkyardWorld.js';
import { wantsDevTools } from '../debug/devTools.js';

const ENDED_MESSAGE = 'Encounter over. Press RESTART ENCOUNTER to play again.';

// The junkyard session: builds the fight's systems, connects the toolbar to the
// game state, and is the shared context the older systems (EyeVision, brain,
// combat, POV, weapon) still receive. The fight's rules and update order live in
// Encounter; what the game is doing lives in GameFlow. The old `walking` and
// `playerMode` flags are now read from GameFlow instead of being stored.
export class JunkyardPlaytest {
  // audio: the one sound engine (LaserAudio), created by the junkyard mode.
  // signal: the mode's AbortSignal; every page listener of this session ends with it.
  // brainProvider: where the brain runs (see src/brain/BrainProvider.js); the brain owns it.
  // hud: the game's HUD shell (src/ui/Hud.js), if any: Lola's health and the guns
  //   then only keep their numbers and the shell draws them.
  // healthPill, ammoBullet: the pickups' loaded models (glTF); without one the
  // yard has none of that kind.
  constructor({ engine, world, simulation, target, cameraController, audio, flow = null, events = null, signal = null,
    brainProvider = null, hud = null, healthPill = null, ammoBullet = null }) {
    Object.assign(this, { engine, world, simulation, target, cameraController, audio, signal, hud });
    // 1. Game state and the event bus every system reports to.
    this.events = events ?? new EventBus();
    this.flow = flow ?? new GameFlow({ events: this.events });
    if (!world.collision) attachWorldCollision(world);

    // 2. The toolbar / OPTIONS panel. Older systems still find it as this.panel.
    this.panelView = new JunkyardPanel({ world });
    this.panel = this.panelView.element;
    this.message = this.panelView.message;
    this.brainLabel = this.panelView.brainLabel;

    // 3. Lola's health and HUD (no longer owned by the Leaper's combat).
    this.vitals = new PlayerVitals({ player: target, audio, events: this.events, hud: hud?.vitalsPresenter ?? null });
    this.vitals.onRestart = () => this.restartEncounter();

    // 4. Gameplay systems. Each receives this playtest as its context, so the
    //    order matters (combat, POV and the weapon read the ones before them).
    this.sight = target.isPlayer ? new EyeVision(this) : null;
    // (If the brain service is offline, a run carries on in turret mode: the
    // Leaper stands still but still shoots, and the brain's message says why.)
    this.brain = new JunkyardBrain(this, { provider: brainProvider });
    this.playerController = new PlayerController({ player: target, input: simulation.input, cameraController,
      headingYaw: () => simulation.state.yaw });
    this.combat = new LeaperCombat(this);
    this.pov = new LeaperPov(this);
    this.playerWeapon = new PlayerWeapon(this);

    // 5. The fight: update order, enemies (one Leaper today), start snapshot, results.
    //    Each Leaper gets its behaviour layer (stomp, leap, stagger, downed, death).
    //    Health pills and ammo bullets float around the yard (scattered afresh
    //    by every reset), each kind keeping clear of the other.
    const pickupBase = { scene: engine.scene, world, player: target, audio };
    this.healthPills = healthPill && target.isPlayer
      ? new HealthPills({ ...pickupBase, vitals: this.vitals, model: healthPill.scene,
        others: () => this.ammoBullets?.items ?? [] })
      : null;
    this.ammoBullets = ammoBullet && target.isPlayer
      ? new AmmoBullets({ ...pickupBase, weapon: this.playerWeapon, defeated: () => this.vitals.dead,
        model: ammoBullet.scene, others: () => this.healthPills?.items ?? [] })
      : null;
    this.encounter = new Encounter({ flow: this.flow, events: this.events, world, player: target,
      vitals: this.vitals, audio, playerController: this.playerController, playerWeapon: this.playerWeapon,
      input: simulation.input, cameraController, leaperBehaviour: createLeaperActor,
      pickups: [this.healthPills, this.ammoBullets].filter(Boolean) });
    this.encounter.addEnemy({ simulation, brain: this.brain, combat: this.combat });
    // The result banner reads the encounter's verdict (winner, practice, debug).
    this.events.on(GAME_EVENTS.encounterEnded, ({ stats }) => this.vitals.showResult(stats.text));

    // 6. Footsteps: Lola's always; the Leaper's only while it is really hunting,
    //    placed where it stands (the audio engine fades them with distance).
    target.onFootstep = (kind, crouched) => audio.step(kind, crouched);
    simulation.onFootstep = () => {
      if (!this.walking || this.combat.dead || !this.brain.ready) return;
      audio.step('robot', false, 1, simulation.rig.robot.position);
    };

    // 7. The game state drives mouse capture, the toolbar labels and the pause
    //    overlay; Escape (or a lost mouse lock) pauses, a click on the overlay resumes.
    // (With the game's HUD shell its pause menu takes this job: src/ui/GameScreens.js.)
    this.pauseOverlay = hud ? null : new PauseOverlay({ onResume: () => this.resume(), signal });
    this.offFlowChange = this.flow.onChange((next, previous) => this.onFlowChange(next, previous));
    cameraController.onPauseRequested = () => this.pause();
    target.setSelected(true);

    // 8. Toolbar and OPTIONS buttons.
    this.panelView.bind({
      route: () => (this.walking ? this.stop('Run stopped. Press START RUN to chase Lola again.') : this.start()),
      player: () => (this.playerMode
        ? this.stopPlayer('Exploring stopped. Press START PLAYER to explore again.') : this.startPlayer()),
      random: () => this.restartRandom(),
      reset: () => this.reset(),
      clearance: () => this.toggleClearance(),
      applySize: (width) => this.applySize(width),
      sound: () => this.toggleSound(),
    });
    this.panelView.renderSound(audio.enabled);

    // 9. Presentation: camera, sun, floating health bar and readouts, updated
    //    every frame after gameplay (the Leaper animator no longer drives them).
    this.presentation = new JunkyardPresentation({ engine, world, cameraController, player: target,
      encounter: this.encounter, pov: this.pov, brainLabel: this.brainLabel, statusElement: simulation.statusElement });

    // 10. Designer tools: the clearance overlay and Shift + click placement in TOP view.
    this.overlay = new ClearanceOverlay({ scene: engine.scene, world });
    this.removePlacement = enableTopViewPlacement({
      engine, cameraController, world, player: target,
      allowed: () => !this.pov.active && !this.combat.dead,
      onMessage: (text) => { this.message.textContent = text; },
      onMoved: () => {
        if (!this.walking) this.message.textContent = 'Target moved. Press START RUN to chase it.';
      },
    });

    // 11. First reset (Loading -> Ready). After APPLY SIZE the session picks up
    //     where it was (Lola's spot, camera, gun, sound and the mode, paused);
    //     an old ?run=1 link still starts a run, and ?explore=1 opens straight
    //     into EXPLORE (START PLAYER: Lola moves, the Leaper stands still) with
    //     the developer tools (players have no EXPLORE).
    if (!target.isPlayer) this.topView();
    const resume = takeRunState();
    if (resume) this.restoreRunState(resume);
    // (After APPLY SIZE Lola stays where she was: no random start.)
    this.reset(null, { random: target.isPlayer && !resume });
    if (resume?.mode) this.resumeAfterResize(resume.mode);
    else if (new URLSearchParams(location.search).get('run') === '1') this.start();
    else if (new URLSearchParams(location.search).get('explore') === '1' && wantsDevTools()) this.startPlayer();
  }

  // ---- Flags derived from the game state (older systems and test tools read these) ----
  get walking() { return this.flow.hunting; }
  get playerMode() { return this.flow.exploring; }
  get paused() { return this.flow.paused; }

  // ---- Frame phases (called by the junkyard mode) ----
  input(dt) { this.encounter.input(dt); }
  update(dt) { this.encounter.update(dt); }
  lateUpdate(dt) { this.presentation.lateUpdate(dt); }

  // ---- Game-state reactions ----

  onFlowChange(next, previous) {
    const playing = next.name === 'playing';
    // Clicking the scene only grabs the mouse again while a mode is running.
    this.cameraController.gameplayStarted = playing;
    if (playing) {
      this.target.setSelected(true);
      // Requested inside the button click itself, before any asynchronous brain load.
      this.cameraController.captureMouse();
    } else if (previous.name === 'playing') {
      this.cameraController.releaseMouse();
    }
    this.panelView.renderFlow(next);
    this.pauseOverlay?.render(next);
  }

  // ---- Toolbar actions ----

  // START RUN / RESUME RUN: the Leaper's brain runs and the mouse is captured.
  // With the brain offline, START RUN retries it and otherwise fights in turret mode.
  start() {
    if (this.flow.ended || this.encounter.over) {
      this.message.textContent = ENDED_MESSAGE;
      return;
    }
    if (this.flow.paused && this.flow.playMode === 'hunt') this.flow.resume();
    else this.flow.hunt();
  }

  // START PLAYER / RESUME PLAYER: only Lola moves (explore and test the map).
  startPlayer() {
    if (this.flow.ended || this.encounter.over) {
      this.message.textContent = ENDED_MESSAGE;
      return;
    }
    if (this.flow.paused && this.flow.playMode === 'explore') this.flow.resume();
    else this.flow.explore();
    this.message.textContent = 'Exploring as Lola. The Leaper stays still. Esc frees the mouse.';
  }

  // STOP PLAYER: back to Ready (the mouse is let go by the flow change).
  stopPlayer(message) {
    this.flow.stop();
    if (message) this.message.textContent = message;
  }

  // A Leaper's combat finished (it is down, or Lola is). The encounter ends once
  // the fight is decided; with several Leapers the hunt goes on until all are down.
  combatFinished() {
    if (!this.encounter.over) return;
    this.encounter.end();
    this.message.textContent = ENDED_MESSAGE;
  }

  // STOP RUN. If the fight is already decided, the encounter ends instead (and
  // records who won).
  stop(message) {
    if (this.encounter.over) {
      this.combatFinished();
      return;
    }
    this.flow.stop();
    if (message) this.message.textContent = message;
  }

  // Escape: a real pause. Gameplay time stops for Lola, her guns, the Leaper and
  // its bolts; the camera and the UI keep running. The overlay or the toolbar resumes.
  pause() {
    const mode = this.flow.playMode;
    if (!this.flow.pause()) return;
    this.message.textContent = mode === 'hunt'
      ? 'Paused with Escape. Click the game or RESUME RUN to continue.'
      : 'Paused with Escape. Click the game or RESUME PLAYER to explore again.';
  }

  // Back to whatever was paused (the mouse is captured again by the flow change).
  resume() {
    if (this.flow.resume()) this.message.textContent = 'Resumed. Esc pauses again.';
  }

  // RESET / RESTART ENCOUNTER (and a vision-mode change): a new game. In the
  // game (Lola playing) the Leaper and Lola start at fresh random spots, a fair
  // distance apart (owner, 2026-10-22; randomGameStart); `random: false` keeps
  // the old clean retry from the fight's start snapshot.
  reset(spawn = null, { random = this.target.isPlayer } = {}) {
    if (!spawn && random) spawn = randomGameStart(this.world);
    this.sight?.clear();
    this.message.textContent = HELP_MESSAGE;
    this.encounter.restart(spawn);
    this.playerController.reset();
    this.rebuildOverlay(spawn?.position ?? this.simulation.state.position);
  }

  // The result banner's RESTART ENCOUNTER: a clean retry, straight back into the run.
  restartEncounter() {
    this.reset();
    this.start();
  }

  // SOUND: ON / OFF for the whole game (guns, laser, footsteps, hurt sounds).
  toggleSound() {
    this.audio.enabled = !this.audio.enabled;
    if (this.audio.enabled) this.audio.unlock();
    this.panelView.renderSound(this.audio.enabled);
  }

  // RESTART RANDOM: a fresh separated, connected spawn pair, then run.
  restartRandom() {
    const spawn = randomJunkyardStart(this.world, this.simulation.state.position);
    if (!spawn) {
      // Said in the always-visible message (the brain badge is rewritten every frame).
      this.message.textContent = 'NO ROOM FOR A RANDOM PAIR: no separated, connected spawn pair at this size. Try a smaller Leaper.';
      this.panelView.openOptions();
      return;
    }
    this.reset(spawn);
    this.start();
  }

  // APPLY SIZE reloads the page at the new Leaper size (see runState.js for why it
  // is still a reload) and carries the session over: mode, Lola's spot, camera,
  // gun, sound, OPTIONS open, vision mode.
  applySize(width) {
    // 1. Remember the session for after the reload (this browser tab only).
    const saved = saveRunState(captureRunState({
      playMode: this.flow.playMode, player: this.target, cameraController: this.cameraController,
      world: this.world, soundEnabled: this.audio.enabled, optionsOpen: !this.panelView.options.hidden,
    }));
    // 2. The new size in the address, and remembered so any link keeps it.
    const url = new URL(location.href);
    url.searchParams.set('width', width);
    try { localStorage.setItem(SAVED_WIDTH_KEY, width); } catch { /* Private storage. */ }
    if (this.sight) url.searchParams.set('vision', this.sight.mode);
    // Without session storage, fall back to the old ?run=1 (the run restarts).
    // OPTIONS is only reachable with the mouse free, so a run is usually paused
    // here: ask the game state, not `walking` (which is false while paused).
    if (!saved && this.flow.playMode === 'hunt') url.searchParams.set('run', '1');
    else url.searchParams.delete('run');
    location.assign(url);
  }

  // After an APPLY SIZE reload: put Lola, the camera, her gun, the sound switch
  // and the OPTIONS panel back as they were.
  restoreRunState(state) {
    const spot = restoredPlayerSpot(state, this.world);
    if (spot) this.encounter.placePlayer(spot);
    if (state.camera) {
      if (Number.isFinite(state.camera.yaw)) this.cameraController.yaw = state.camera.yaw;
      if (Number.isFinite(state.camera.pitch)) this.cameraController.pitch = state.camera.pitch;
      if (state.camera.view === 'TOP') this.topView();
    }
    if ((state.weaponIndex === 0 || state.weaponIndex === 1) && state.weaponIndex !== this.target.weaponIndex) {
      this.target.weaponIndex = state.weaponIndex;
      this.target.showWeapon?.();
    }
    if (state.sound === false && this.audio.enabled) this.toggleSound();
    if (state.options) this.panelView.openOptions();
  }

  // The mode that was on before APPLY SIZE comes back paused, so the player's
  // own click resumes it (and can grab the mouse; a reload can't do that itself).
  resumeAfterResize(mode) {
    if (mode === 'hunt') this.flow.hunt();
    else if (mode === 'explore') this.flow.explore();
    if (this.flow.pause()) this.message.textContent = 'New Leaper size applied. Click the game (or RESUME) to carry on.';
  }

  // ---- Designer tools ----

  toggleClearance() {
    this.overlay.visible = !this.overlay.visible;
    this.panelView.showClearance(this.overlay.visible);
    if (this.overlay.visible) this.topView();
  }

  // Redraw the clearance map for where the Leaper now starts.
  rebuildOverlay(spawn) {
    this.panelView.setClearanceSummary(this.overlay.rebuild(spawn));
  }

  // Switch the camera to the TOP view (VIEW cycles, so toggle until it is there).
  topView() {
    while (this.cameraController.mode !== 'TOP') this.cameraController.toggle();
  }

  // Tear the session down: every HUD element, overlay and effect this session put
  // on the page or in the scene. Page listeners end with the mode's AbortSignal;
  // the map, rig and Lola are freed by the mode itself.
  dispose() {
    // 1. The fight: brains stopped, Leaper blockers out of the collision service,
    //    and nothing here reacts to the game state any more.
    this.encounter.dispose();
    this.offFlowChange();
    this.cameraController.releaseMouse();
    // 2. Scene-side leftovers: bolts, debris, gunshot effects, clearance overlay, sight lines.
    this.combat.dispose();
    this.playerWeapon.dispose();
    this.overlay.dispose();
    if (this.sight) {
      this.engine.scene.remove(this.sight.lines);
      disposeObject3D(this.sight.lines);
    }
    // 3. Page-side: HUD panels, overlays, the LEAPER POV reticle and the toolbar.
    this.removePlacement();
    this.pauseOverlay?.dispose();
    this.vitals.dispose();
    this.pov.reticle.remove();
    this.panelView.dispose();
    this.events.clear();
  }
}
