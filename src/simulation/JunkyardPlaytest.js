import { JunkyardBrain } from './JunkyardBrain.js';
import { EyeVision } from './EyeVision.js';
import { PlayerWeapon } from './PlayerWeapon.js';
import { LeaperCombat } from './LeaperCombat.js';
import { LeaperPov } from '../camera/LeaperPov.js';
import { EventBus, GAME_EVENTS } from '../core/events.js';
import { GameFlow } from '../core/GameFlow.js';
import { Encounter } from '../game/Encounter.js';
import { PlayerController } from '../game/PlayerController.js';
import { PlayerVitals } from '../game/PlayerVitals.js';
import { JunkyardPanel, HELP_MESSAGE } from '../game/JunkyardPanel.js';
import { ClearanceOverlay } from '../game/ClearanceOverlay.js';
import { JunkyardPresentation } from '../game/JunkyardPresentation.js';
import { enableTopViewPlacement } from '../game/topViewPlacement.js';
import { randomJunkyardStart } from '../world/randomJunkyardStart.js';
import { attachWorldCollision } from '../world/WorldCollision.js';
import { SAVED_WIDTH_KEY } from '../world/createJunkyardWorld.js';

const ENDED_MESSAGE = 'Encounter over. Press RESTART ENCOUNTER to play again.';

// The junkyard session: builds the fight's systems, connects the toolbar to the
// game state, and is the shared context the older systems (EyeVision, brain,
// combat, POV, weapon) still receive. The fight's rules and update order live in
// Encounter; what the game is doing lives in GameFlow. The old `walking` and
// `playerMode` flags are now read from GameFlow instead of being stored.
export class JunkyardPlaytest {
  // audio: the one sound engine (LaserAudio), created by the junkyard mode.
  constructor({ engine, world, simulation, target, cameraController, audio, flow = null, events = null }) {
    Object.assign(this, { engine, world, simulation, target, cameraController, audio });
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
    this.vitals = new PlayerVitals({ player: target, audio, events: this.events });
    this.vitals.onRestart = () => this.restartEncounter();

    // 4. Gameplay systems. Each receives this playtest as its context, so the
    //    order matters (combat, POV and the weapon read the ones before them).
    this.sight = target.isPlayer ? new EyeVision(this) : null;
    this.brain = new JunkyardBrain(this);
    this.brain.onFailed = () => this.brainFailed();
    this.playerController = new PlayerController({ player: target, input: simulation.input, cameraController,
      headingYaw: () => simulation.state.yaw });
    this.combat = new LeaperCombat(this);
    this.pov = new LeaperPov(this);
    this.playerWeapon = new PlayerWeapon(this);

    // 5. The fight: update order, enemies (one Leaper today), start snapshot, results.
    this.encounter = new Encounter({ flow: this.flow, events: this.events, world, player: target,
      vitals: this.vitals, audio, playerController: this.playerController, playerWeapon: this.playerWeapon,
      input: simulation.input, cameraController });
    this.encounter.addEnemy({ simulation, brain: this.brain, combat: this.combat });
    // The result banner reads the encounter's verdict (winner, practice, debug).
    this.events.on(GAME_EVENTS.encounterEnded, ({ stats }) => this.vitals.showResult(stats.text));

    // 6. Footsteps: Lola's always; the Leaper's only while it is really hunting,
    //    quieter with distance from the camera.
    target.onFootstep = (kind, crouched) => audio.step(kind, crouched);
    simulation.onFootstep = () => {
      if (!this.walking || this.combat.dead || !this.brain.ready) return;
      const distance = engine.camera.position.distanceTo(simulation.rig.robot.position);
      audio.step('robot', false, 1 / (1 + (distance / (12 * world.scale)) ** 2));
    };

    // 7. The game state drives mouse capture and the toolbar labels; Escape (or a
    //    lost mouse lock) pauses.
    this.flow.onChange((next, previous) => this.onFlowChange(next, previous));
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

    // 10. Presentation: camera, sun, floating health bar and readouts, updated
    //     every frame after gameplay (the Leaper animator no longer drives them).
    this.presentation = new JunkyardPresentation({ engine, world, cameraController, player: target,
      encounter: this.encounter, pov: this.pov, brainLabel: this.brainLabel, statusElement: simulation.statusElement });

    // 11. Designer tools: the clearance overlay and Shift + click placement in TOP view.
    this.overlay = new ClearanceOverlay({ scene: engine.scene, world });
    this.removePlacement = enableTopViewPlacement({
      engine, cameraController, world, player: target,
      allowed: () => !this.pov.active && !this.combat.dead,
      onMessage: (text) => { this.message.textContent = text; },
      onMoved: () => {
        if (!this.walking) this.message.textContent = 'Target moved. Press START RUN to chase it.';
      },
    });

    // 12. First reset (Loading -> Ready). ?run=1 (set by APPLY SIZE) resumes the run.
    if (!target.isPlayer) this.topView();
    this.reset();
    if (new URLSearchParams(location.search).get('run') === '1') this.start();
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
  }

  // The brain went offline. A run carries on in turret mode (the Leaper stands
  // still but still shoots); the brain's message says how to bring it back.
  brainFailed() {}

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

  stopPlayer(message) {
    this.flow.stop();
    if (message) this.message.textContent = message;
  }

  // STOP RUN. LeaperCombat also calls this the moment Lola or the Leaper is
  // down; then the encounter ends instead (and records who won).
  stop(message) {
    if (this.encounter.over) {
      this.encounter.end();
      this.message.textContent = ENDED_MESSAGE;
      return;
    }
    this.flow.stop();
    if (message) this.message.textContent = message;
  }

  // Escape: freeze everything; the toolbar offers to resume.
  pause() {
    const mode = this.flow.playMode;
    if (!this.flow.pause()) return;
    this.message.textContent = mode === 'hunt'
      ? 'Paused with Escape. Click RESUME RUN to continue.'
      : 'Paused with Escape. Click RESUME PLAYER to explore again.';
  }

  // RESET / RESTART ENCOUNTER (and a vision-mode change): a clean retry.
  reset(spawn = null) {
    this.sight?.clear();
    this.message.textContent = HELP_MESSAGE;
    this.encounter.restart(spawn);
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

  // APPLY SIZE reloads the page at the new Leaper size, keeping vision and run state.
  applySize(width) {
    const url = new URL(location.href);
    url.searchParams.set('width', width);
    // Remember it, so opening the game from any link keeps this size.
    try { localStorage.setItem(SAVED_WIDTH_KEY, width); } catch { /* Private storage. */ }
    if (this.sight) url.searchParams.set('vision', this.sight.mode);
    url.searchParams.set('run', this.walking ? '1' : '0');
    location.assign(url);
  }

  // ---- Designer tools ----

  toggleClearance() {
    this.overlay.visible = !this.overlay.visible;
    this.panelView.showClearance(this.overlay.visible);
    if (this.overlay.visible) this.topView();
  }

  rebuildOverlay(spawn) {
    this.panelView.setClearanceSummary(this.overlay.rebuild(spawn));
  }

  topView() {
    while (this.cameraController.mode !== 'TOP') this.cameraController.toggle();
  }

  // What can be torn down without a page reload today (the older systems'
  // listeners and HUD elements still need their own dispose()).
  dispose() {
    this.encounter.dispose();
    this.removePlacement();
    this.overlay.dispose();
    this.vitals.dispose();
    this.panelView.dispose();
    this.events.clear();
  }
}
