import { Hud } from './Hud.js';
import { GameScreens } from './GameScreens.js';
import { ControlsLegend, legendRows } from './ControlsLegend.js';
import { buildCredits } from './CreditsScreen.js';
import { registerGameSections, settingsScreen } from './SettingsScreen.js';
import { settings as settingsStore } from './settings.js';
import { CAPTION_CUES, ChargeWatch, EYE_CHARGE_CAPTION, captionFor } from './captions.js';
import { registerAudioSettings } from '../audio/audioSettingsSection.js';
import { weaponSlots } from '../simulation/PlayerWeapon.js';
import { touchButtons, wantsTouchControls } from '../input/touch.js';
import { CONTROLS } from '../input/actions.js';
import { CAMERA } from '../config/tuning/index.js';
import { NO_TIMER } from '../debug/PhaseTimer.js';
import { HudLayout, MOVABLE_PIECES } from '../controls/MovableHud.js';
import { loadDevTools, wantsDevTools } from '../debug/devTools.js';
import { TitleShowcase } from '../game/TitleShowcase.js';
import { FpsCounter } from './FpsCounter.js';
import { AdaptiveResolution } from '../core/AdaptiveResolution.js';

// The end of a fight: seconds the final impact (sounds.json gameEnd) rings
// before the end screen and its music appear.
const END_SCREEN = Object.freeze({ delay: 1.6 });

// The game's front end in one place: the HUD shell (src/ui/Hud.js) and the menu
// screens (src/ui/GameScreens.js) on top of the game state, wired to the game
// through its public actions only (start, pause, resume, reset). The junkyard
// mode builds it in two steps: the HUD first (the game's systems draw through
// it), then attach(playtest) once the fight exists.
//
// While a menu is open the menus have the controls: the input controller reports
// only menu actions, Lola's controls are frozen as in a pause, and the mouse is
// free (pointer lock released).

export class GameUi {
  // input: the game's InputController. cameraController: the chase camera (look
  // speed for touch drags, mouse capture). flow: the GameFlow. events: the
  // game's event bus (captions). quality: the graphics preset in use.
  // settings: the player's settings store (src/ui/settings.js). engine and
  // signal: for the developer tools, if this page gets them.
  constructor({ input, cameraController, flow, events = null, quality = 'high', settings = settingsStore,
    engine = null, signal = null }) {
    this.inputController = input;
    this.cameraController = cameraController;
    this.flow = flow;
    this.events = events;
    this.quality = quality;
    this.settings = settings;
    this.engine = engine;
    this.signal = signal;
    // Frame-phase timings for the developer perf overlay (a no-op for players).
    this.profiler = NO_TIMER;
    // 1. The HUD shell, with the touch band (phones and tablets) pressing the
    //    same input actions as the keys, mouse buttons and gamepad.
    const look = CAMERA.look;
    this.hud = new Hud({
      weaponSlots: weaponSlots(),
      touch: wantsTouchControls() ? {
        buttons: touchButtons(),
        onDown: (action) => input.virtualDown(action),
        onUp: (action) => input.virtualUp(action),
        onLook: (dx, dy) => cameraController.lookBy(dx * look.touch, dy * look.touch * look.verticalRatio),
      } : null,
    });
    // 2. The frame's HUD data, refilled in place (no per-frame garbage).
    this.snapshot = { flow: flow.state.name, menu: false, vitals: null, weapon: null, leapers: [], dt: 0 };
    this.playtest = null;
    this.screens = null;
    // The play mode last used (RESTART after the end screen repeats it).
    this.lastMode = 'hunt';
  }

  // ---- Once the fight exists ----

  attach(playtest) {
    this.playtest = playtest;
    const { hud, flow, inputController: input } = this;
    // 1. The page's existing HUD pieces go to their corners.
    this.mountPagePieces(playtest);
    // 2. The menu screens, with CONTROLS (opened from SETTINGS) and CREDITS
    //    (SETTINGS registers itself). Players see no key hints on screen: the
    //    keys are listed only under SETTINGS > CONTROLS (owner, 2026-10-22). The
    //    H legend over the fight, its hint and the testing items (EXPLORE) are
    //    developer tools.
    const dev = this.dev = wantsDevTools();
    // The frame rate on screen, and the resolution easing down to hold 60 fps
    // (both switched in SETTINGS > GRAPHICS; owner, 2026-10-22).
    this.fps = new FpsCounter();
    const resolution = playtest.engine?.resolution;
    let storage = null;
    try { storage = globalThis.localStorage ?? null; } catch { /* Private storage. */ }
    this.adaptive = resolution ? new AdaptiveResolution({ resolution, enabled: () => this.settings.get('keep60'), storage }) : null;
    // Behind the title: the Leaper turning on the spot, Lola hidden (src/game/TitleShowcase.js).
    this.showcase = new TitleShowcase({ encounter: playtest.encounter, world: playtest.world,
      camera: this.cameraController.camera, scene: playtest.engine?.scene, sun: playtest.presentation?.sun });
    // The page knows too, for key labels drawn by CSS (the gun circles' 1 and 2).
    document.body.classList.toggle('dev-tools', dev);
    const legend = CONTROLS.find((row) => row.action === 'legend');
    this.legendKey = dev && !wantsTouchControls() ? legend?.keyboard || 'H' : '';
    this.screens = new GameScreens({
      actions: this.menuActions(),
      announce: (text) => hud.announce(text),
      // A menu always has a free mouse.
      onOpenChange: (open) => { if (open) this.cameraController.releaseMouse(); },
      hint: this.legendKey ? `In the fight, ${this.legendKey} shows the controls.` : '',
      dev,
    });
    this.screens.defineScreen('controls', {
      title: 'CONTROLS',
      build: (body) => new ControlsLegend(body, {
        rows: legendRows().filter((row) => dev || row.action !== 'legend'),
        devices: wantsTouchControls() ? ['touch', 'gamepad'] : ['keyboard', 'gamepad', 'touch'],
      }),
    });
    this.screens.defineScreen('credits', { title: 'CREDITS', build: (body) => buildCredits(body) });
    registerGameSections(this.settings, { quality: this.quality, playing: () => flow.playing || flow.paused,
      showControls: () => this.screens.activate('controls') });
    // Sound: the audio engine's own section (on/off and the volume sliders) replaces
    // the placeholder; the saved Sound switch starts in step with the engine.
    if (playtest.audio) {
      this.offAudioSettings = registerAudioSettings(this.settings, playtest.audio);
      if (this.settings.get('sound') !== playtest.audio.enabled) this.settings.set('sound', playtest.audio.enabled);
    }
    // HUD layout: pieces the player may move (EDIT HUD LAYOUT), one layout per form factor.
    this.layout = new HudLayout({
      pieces: Object.entries(MOVABLE_PIECES).map(([name, selector]) => [name, document.querySelector(selector)]),
      formFactor: wantsTouchControls() ? 'touch' : 'desktop',
    });
    this.settings.registerSection({ id: 'hud', title: 'HUD', order: 50, build: (container, { controls: c }) => {
      c.button(container, { label: 'EDIT HUD LAYOUT', hint: 'Drag the HUD pieces where you want them. Touch screens and desktops keep their own layouts.',
        onClick: () => this.editLayout(true) });
      c.button(container, { label: 'RESET LAYOUT', onClick: () => this.layout.reset() });
    } });
    this.screens.defineScreen('settings', { title: 'SETTINGS', ...settingsScreen(this.settings) });
    // The player's settings apply now and whenever one changes.
    this.applySettings();
    this.offSettings = this.settings.onChange((key, value) => this.applySetting(key, value));
    // Captions for sound cues follow the game's events (shown only when switched
    // on); a cue may pick its line from the event (which attack, which phase).
    this.offCaptions = Object.keys(CAPTION_CUES).map((event) => this.events?.on(event, (payload) => {
      const line = captionFor(event, payload);
      if (line) hud.caption(line);
    }));
    // The eye's charge has no event: lateUpdate() watches each Leaper's.
    this.chargeWatch = new ChargeWatch();
    // 3. Menus take the controls while they are open, and follow the game state.
    input.setUiCapture?.(() => this.screens.open);
    this.offFlow = flow.onChange((next) => {
      if (next.name === 'playing') this.lastMode = next.mode;
      // A game state change (a gamepad Start resuming, say) ends the layout editing.
      if (this.editing) this.editLayout(false);
      // The fight is decided: one big impact now, and the end screen once it has
      // rung out (lateUpdate opens it).
      this.endScreenIn = next.name === 'ended' ? END_SCREEN.delay : 0;
      if (next.name === 'ended') playtest.audio?.play?.('gameEnd');
      if (!this.endScreenIn) this.screens.sync(next, { result: playtest.encounter.result });
      // The first fight of the session says how to see the controls.
      if (next.name === 'playing' && !this.hinted && this.legendKey) {
        this.hinted = true;
        hud.hint(`${this.legendKey}: show the controls`, 6);
      }
      // The legend never stays up over a menu or a new fight.
      if (next.name !== 'playing') hud.setLegend(false);
    });
    this.screens.sync(flow.state, { result: playtest.encounter.result });
    // 4. Developer tools, downloaded only with ?dev or on the dev server.
    if (wantsDevTools()) {
      this.devTools = loadDevTools({ ui: this, playtest, engine: this.engine, signal: this.signal })
        .catch((error) => { console.warn('Developer tools failed to load:', error); return null; });
    }
  }

  // Move the page's existing pieces into the HUD: VIEW top right (developers
  // only: its other views are lab tools), the TOP view hint top centre, the Leaper's name plate top left, the LEAPER POV crosshair
  // centre, and on phones the joystick (bottom left) and SPRINT (bottom right).
  mountPagePieces(playtest) {
    const { hud } = this;
    const view = hud.adopt('top-right', document.getElementById('cameraToggle'));
    if (view && !wantsDevTools()) view.hidden = true;
    hud.adopt('top-centre', document.getElementById('topViewHint'));
    const plate = hud.adopt('top-left', playtest.combat?.enemyHud);
    // Its attack-state line is rewritten every frame: no screen-reader live region.
    plate?.querySelector('[data-attack]')?.removeAttribute('role');
    hud.adopt('centre', playtest.pov?.reticle);
    hud.adopt('bottom-left', document.getElementById('joyBase'));
    hud.adopt('bottom-right', document.getElementById('btnSprint'));
  }

  // ---- HUD layout editing ----

  // EDIT HUD LAYOUT: the menus step aside, every HUD piece shows with an outline
  // and drags with a single press; DONE (or Escape / B) goes back to the settings.
  editLayout(on) {
    on = Boolean(on);
    if (on === Boolean(this.editing)) return;
    this.editing = on;
    this.layout.setEditing(on);
    this.hud.setEditing(on);
    this.screens.setSuspended(on);
    if (on) {
      this.editBar = document.createElement('div');
      this.editBar.className = 'hud-edit-bar';
      this.editBar.setAttribute('role', 'dialog');
      this.editBar.setAttribute('aria-label', 'Edit HUD layout');
      this.editBar.innerHTML = '<p>Drag the HUD pieces where you want them.</p>'
        + '<button type="button" data-layout="reset">RESET LAYOUT</button><button type="button" data-layout="done">DONE</button>';
      this.editBar.querySelector('[data-layout=reset]').addEventListener('click', () => this.layout.reset());
      this.editBar.querySelector('[data-layout=done]').addEventListener('click', () => this.editLayout(false));
      document.body.append(this.editBar);
      this.editBar.querySelector('[data-layout=done]').focus({ preventScroll: true });
    } else {
      this.editBar?.remove();
      this.editBar = null;
      // Back in the settings, on the button that started the editing.
      [...document.querySelectorAll('#screens .setting-button')].find((button) => button.textContent === 'EDIT HUD LAYOUT')?.focus();
    }
  }

  // ---- Settings ----

  // Every setting, as saved. (Sound only switches off here: a session carried
  // over a reload may already have switched it.)
  applySettings() {
    for (const [key, value] of Object.entries(this.settings.values)) {
      if (key !== 'sound' || !value) this.applySetting(key, value);
    }
  }

  // One setting: the camera's look speed, up/down and field of view, the text
  // size, captions, and the game's sound.
  applySetting(key, value) {
    const camera = this.cameraController;
    if (key === 'sensitivity') camera.lookSensitivity = value;
    else if (key === 'invertY') camera.invertY = value;
    else if (key === 'fov') camera.chaseFov = value;
    else if (key === 'textSize') document.documentElement.dataset.textSize = value;
    else if (key === 'captions') this.hud.setCaptions(value);
    else if (key === 'showFps' && this.fps) this.fps.visible = value;
    else if (key === 'sound' && this.playtest && this.playtest.audio.enabled !== value) this.playtest.toggleSound();
  }

  // What each menu item does, through the game's own actions.
  menuActions() {
    const run = (mode) => {
      // The title's backdrop ends before the fight starts (the Leaper back on its spot).
      this.showcase?.show(false);
      return mode === 'explore' ? this.playtest.startPlayer() : this.playtest.start();
    };
    return {
      play: () => run('hunt'),
      explore: () => run('explore'),
      resume: () => this.playtest.resume(),
      // Paused while exploring: the real hunt from right here, nothing reset.
      hunt: () => run('hunt'),
      // A clean retry in the same mode (the one paused, or the one just finished).
      restart: () => {
        const mode = this.flow.playMode ?? this.lastMode;
        this.playtest.reset();
        run(mode);
      },
      quit: () => this.playtest.reset(),
      title: () => this.playtest.reset(),
    };
  }

  // ---- Frame phases ----

  // Input phase: with a menu open, Lola's controls are frozen (as in a pause) and
  // the menu reads the keyboard and gamepad; otherwise the fight reads them.
  input(dt) {
    const playtest = this.playtest;
    if (this.screens?.open) playtest.playerController.sample(dt, { frozen: true });
    else playtest.input(dt);
    // While the HUD layout is edited, Escape / B / A / Space finish it.
    if (this.editing) {
      const input = this.inputController;
      if (input.pressed('menuBack') || input.pressed('menuConfirm')) this.editLayout(false);
      return;
    }
    this.screens?.handleInput(this.inputController, dt);
    // H (gamepad Back) shows or hides the controls legend over the fight (developers only).
    if (this.dev && this.inputController.pressed?.('legend')) this.hud.toggleLegend();
  }

  // Late phase: the HUD redraws from this frame's numbers and the title its notice
  // (only what changed reaches the page).
  lateUpdate(dt = 0) {
    const { playtest, snapshot, flow } = this;
    const { encounter } = playtest;
    // Frame rate: counted, shown, and held at 60 by the resolution.
    const now = performance.now() / 1000;
    this.adaptive?.frame(now);
    this.fps?.frame(now, playtest.engine?.resolution?.scale ?? 1);
    // The title's backdrop, while the title (or a screen opened from it) is up.
    const onTitle = flow.state.name === 'ready' && this.screens?.stack.base === 'title';
    this.showcase?.show(onTitle);
    // The end screen opens once the fight's final impact has rung out.
    if (this.endScreenIn > 0) {
      this.endScreenIn = Math.max(0, this.endScreenIn - dt);
      if (!this.endScreenIn) this.screens.sync(flow.state, { result: playtest.encounter.result });
    }
    const onEnd = flow.state.name === 'ended' && !this.endScreenIn && this.screens?.stack.base === 'end';
    // The title music plays while the title or the end screen is up (owner,
    // 2026-10-22) and fades out when they go.
    const music = onTitle || onEnd;
    if (music !== this.titleMusic) {
      this.titleMusic = music;
      if (music) playtest.audio?.startAmbience?.('titleMusic');
      else playtest.audio?.stopAmbience?.('titleMusic');
    }
    this.showcase?.update(flow.paused ? 0 : dt);
    this.showcase?.lateUpdate();
    snapshot.flow = flow.state.name;
    snapshot.dt = flow.paused ? 0 : dt;
    snapshot.menu = Boolean(this.screens?.open);
    snapshot.vitals = playtest.vitals.view({ over: encounter.over });
    snapshot.weapon = playtest.playerWeapon.hudState;
    encounter.enemies.forEach(({ combat }, index) => {
      const leaper = snapshot.leapers[index] ??= { health: 0, max: 0 };
      leaper.health = combat.leaperHealth;
      leaper.max = combat.config.leaperHealth;
      // A new wind-up of its eye gets the charge caption (when captions are on).
      const charging = combat.leaperHealth > 0 && combat.tree?.started != null;
      if (this.chargeWatch?.started(index, charging)) this.hud.caption(EYE_CHARGE_CAPTION);
    });
    snapshot.leapers.length = encounter.enemies.length;
    this.hud.update(snapshot);
    this.screens?.update({ brain: playtest.brain });
  }

  // The session is over: menus and HUD leave the page, the input forgets the menus.
  dispose() {
    this.offFlow?.();
    this.offSettings?.();
    this.offAudioSettings?.();
    if (this.editing) this.editLayout(false);
    this.layout?.dispose();
    for (const off of this.offCaptions ?? []) off?.();
    this.inputController.setUiCapture?.(null);
    this.screens?.dispose();
    this.fps?.dispose();
    this.hud.dispose();
  }
}
