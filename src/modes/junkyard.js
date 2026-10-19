import { createJunkyardWorld } from '../world/createJunkyardWorld.js';
import { attachWorldCollision } from '../world/WorldCollision.js';
import { LolaPlayer } from '../robot/LolaPlayer.js';
import { Assets, loadLolaFiles } from '../core/Assets.js';
import { limitShadowCasters, warmUp } from '../core/Quality.js';
import { JunkyardPlaytest } from '../simulation/JunkyardPlaytest.js';
import { enableMovableHud } from '../controls/MovableHud.js';
import { EventBus } from '../core/events.js';
import { GameFlow } from '../core/GameFlow.js';
import { disposeObject3D } from '../core/disposeObject3D.js';
import { LaserAudio } from '../simulation/LaserAudio.js';
import { createGameBrainProvider } from '../simulation/JunkyardBrain.js';
import { brainChoice, describeProgress } from '../brain/BrainProvider.js';
import { weaponSlots } from '../simulation/PlayerWeapon.js';
import { Hud } from '../ui/Hud.js';
import '../styles/ui/dev-panel.css';
import { touchButtons, wantsTouchControls } from '../input/touch.js';
import { CAMERA } from '../config/camera.js';
import { createLeaperScene, loadStep, removeFromScene, setStatus } from './shared.js';

// The game (default page, also ?map=junkyard): Lola vs. the Leaper in the
// junkyard. The frozen 7,757,824-step brain moves the Leaper (in this page by
// default, or on the local Python server with ?brain=http); its attacks come
// from the in-browser behaviour tree.

// Longer frame-time cap than the lab modes: Lola and the debris sub-step
// themselves, so a slow frame stays stable.
const MAX_DELTA = 0.1;

// The on-screen panels become movable once per page (doing it twice would stack
// two drag handlers on the panels that outlive a session).
let movableHudEnabled = false;

// Loading steps with the brain's own progress beside them, e.g.
// "LOADING LOLA… · LOADING BRAIN · ONNX · IN BROWSER · 64% · DOWNLOADING BRAIN RUNTIME".
// The brain loads in its worker while the map and Lola load here.
// The HUD shell (src/ui/Hud.js) with the touch band wired to the input actions:
// a touch button presses the same action as its key, mouse button and pad button.
function createHud({ input, cameraController }) {
  const look = CAMERA.look;
  return new Hud({
    weaponSlots: weaponSlots(),
    touch: wantsTouchControls() ? {
      buttons: touchButtons(),
      onDown: (action) => input.virtualDown(action),
      onUp: (action) => input.virtualUp(action),
      onLook: (dx, dy) => cameraController.lookBy(dx * look.touch, dy * look.touch * look.verticalRatio),
    } : null,
  });
}

// Move the page's existing HUD pieces into their corners: VIEW top right, the
// TOP view hint top centre, the Leaper's name plate top left, the LEAPER POV
// crosshair centre, and on phones the joystick (bottom left) and SPRINT (bottom right).
function mountPagePieces(hud, playtest) {
  hud.adopt('top-right', document.getElementById('cameraToggle'));
  hud.adopt('top-centre', document.getElementById('topViewHint'));
  const plate = hud.adopt('top-left', playtest.combat.enemyHud);
  // Its attack-state line is rewritten every frame: no screen-reader live region.
  plate?.querySelector('[data-attack]')?.removeAttribute('role');
  hud.adopt('centre', playtest.pov.reticle);
  hud.adopt('bottom-left', document.getElementById('joyBase'));
  hud.adopt('bottom-right', document.getElementById('btnSprint'));
}

// The plain data the HUD draws each frame, refilled in place (no per-frame garbage).
function hudSnapshot(snapshot, { flow, playtest }) {
  const { encounter } = playtest;
  snapshot.flow = flow.state.name;
  snapshot.vitals = playtest.vitals.view({ over: encounter.over });
  snapshot.weapon = playtest.playerWeapon.hudState;
  encounter.enemies.forEach(({ combat }, index) => {
    const leaper = snapshot.leapers[index] ??= { health: 0, max: 0 };
    leaper.health = combat.leaperHealth;
    leaper.max = combat.config.leaperHealth;
  });
  snapshot.leapers.length = encounter.enemies.length;
  return snapshot;
}

function brainLoadingStatus(brainProvider) {
  let step = '';
  let brain = '';
  const show = () => setStatus(brain ? `${step} · ${brain}` : step);
  const off = brainProvider.onProgress?.((progress) => {
    brain = describeProgress(progress);
    if (step) show();
  });
  return {
    // One of the mode's loading steps (same failure handling as loadStep).
    run(label, failure, load) {
      step = label;
      return loadStep(label, failure, async () => {
        show();
        return load();
      });
    },
    // Loading is over: the brain badge and the status line take over its progress.
    done() {
      step = '';
      off?.();
    },
  };
}

export async function start({ engine, params }) {
  // 1. One AbortController for the whole session: every page listener of the
  //    systems that support it ends with session.abort() in dispose().
  const session = new AbortController();
  const { signal } = session;
  // 2. The game state starts in Loading while the assets download. One loader
  //    shows the progress bar for everything; the one sound engine for the whole
  //    game starts fetching its recordings through it straight away.
  const events = new EventBus();
  const flow = new GameFlow({ events });
  const assets = new Assets({ title: 'LOADING JUNKYARD' });
  const audio = new LaserAudio({ signal, fetchFile: (url) => assets.fetch(url) });
  // 3. The Leaper's brain starts loading at once, in its own worker: the saved
  //    network in the browser by default (?brain=http uses the Python service).
  //    Failures are not fatal here: the first reset falls back (finally to turret mode).
  const brainProvider = createGameBrainProvider({ search: location.search });
  const loading = brainLoadingStatus(brainProvider);
  brainProvider.load().catch(() => {});
  // 4. The map (with its collision grids, built in a worker) and Lola's files
  //    download side by side; Lola is put together once both are in (her model
  //    needs the map's scale), then the map gets its collision service. As soon
  //    as the map is in, the brain prepares the junkyard at this Leaper size
  //    (baked raster at the default size, built in its worker otherwise).
  const tag = (label, promise) => promise.catch((error) => { throw new Error(`${label}: ${error.message}`); });
  const mapForBrain = (map) => { brainProvider.prepare?.(map.width)?.catch(() => {}); return map; };
  let world, target;
  try {
    let lola;
    [world, lola] = await loading.run('LOADING JUNKYARD…', 'LOAD FAILED', () => Promise.all([
      tag('map', createJunkyardWorld(engine.scene, { assets, quality: engine.quality }).then(mapForBrain)),
      tag('Lola', loadLolaFiles(assets)),
    ]));
    attachWorldCollision(world);
    target = await loading.run('BUILDING LOLA…', 'CHARACTER LOAD FAILED', async () => new LolaPlayer(
      engine.scene, world, document.getElementById('cuboidToggle'), lola.models, lola.jumps, lola.reloads, lola.runJumps));
  } catch (error) {
    // The page and the loading bar show the failure; stop the brain's worker with it.
    assets.fail(`LOAD FAILED: ${error.message} — reload to retry`);
    brainProvider.dispose();
    throw error;
  } finally {
    loading.done();
  }
  // 5. The Leaper rig, input and a chase camera that follows Lola.
  const { rig, input, cameraController, simulation } = createLeaperScene({ engine, world, target, signal });
  cameraController.followSubject = target;
  cameraController.pitch = 0.16;
  // The Leaper's smallest parts skip the sun's shadow on lower quality, and its
  // feet kick up dust where the preset allows it.
  for (const root of [rig.robot, ...rig.legs.flatMap((leg) => [leg.coxa, leg.femur, leg.tibia, leg.calf, leg.knee, leg.calfJoint])]) {
    limitShadowCasters(root, engine.quality.leaperShadowMinSize);
  }
  world.effects.watchFeet(rig);
  // 6. The HUD shell, then the playtest, which wires brain, combat, weapons and
  //    the junkyard panel together and resets the encounter (Loading -> Ready).
  //    The brain owns the provider; the HUD draws Lola's health and the guns.
  const hud = createHud({ input, cameraController });
  const playtest = new JunkyardPlaytest({ engine, world, simulation, target, cameraController, audio, flow, events, signal,
    brainProvider, hud });
  mountPagePieces(hud, playtest);
  const snapshot = { flow: 'loading', menu: false, vitals: null, weapon: null, leapers: [] };
  if (!movableHudEnabled) {
    enableMovableHud();
    movableHudEnabled = true;
  }
  // 7. The OPTIONS brain menu switches where the brain runs. The page address
  //    keeps the choice (so a reload or APPLY SIZE remembers it); the run restarts.
  playtest.panelView.bindBrainChoice(brainChoice(location.search), (choice) => {
    const url = new URL(location.href);
    if (choice === 'auto') url.searchParams.delete('brain');
    else url.searchParams.set('brain', choice);
    history.replaceState(history.state, '', url);
    playtest.brain.useProvider(createGameBrainProvider({ search: url.search }));
    playtest.reset();
  });
  // 8. The game is ready: upload every texture, compile every shader and draw one
  //    frame now (so the first shot, jump or gun swap doesn't stall), then the
  //    loading bar fills and fades (sounds may still be arriving; they play as
  //    soon as they are in).
  warmUp(engine.renderer, engine.scene, engine.camera, { render: engine.render });
  assets.done();

  // 9. The frame phases. After dispose() they do nothing, so a loop that is still
  //    running for one more frame can't touch a torn-down session.
  let disposed = false;
  const mode = {
    maxDelta: MAX_DELTA,
    // Read the player's input, run the fight (Encounter order), then presentation.
    input: (dt) => { if (!disposed) playtest.input(dt); },
    update: (dt) => { if (!disposed) playtest.update(dt); },
    lateUpdate: (dt) => {
      if (disposed) return;
      playtest.lateUpdate(dt);
      // Dust and sparks hold still while the game is paused.
      world.effects.update(flow.paused ? 0 : dt);
      // The HUD redraws from this frame's numbers (only what changed reaches the page).
      hud.update(hudSnapshot(snapshot, { flow, playtest }));
    },
    // Render hooks nest: camera -> weapon -> POV before, undone in reverse after.
    beforeRender() {
      if (disposed) return;
      cameraController.beforeRender();
      playtest.playerWeapon.beforeRender();
      playtest.pov.beforeRender();
    },
    afterRender() {
      if (disposed) return;
      playtest.pov.afterRender();
      playtest.playerWeapon.afterRender();
      cameraController.afterRender();
    },
    // Tear the whole session down: listeners, page elements, scene objects and
    // their GPU memory, the sound engine. (InputController and LolaPlayer keep
    // a few listeners of their own; they have no removal API yet.)
    dispose() {
      if (disposed) return;
      disposed = true;
      playtest.dispose();
      hud.dispose();
      session.abort();
      audio.dispose();
      removeFromScene(engine.scene, { world: null, rig, target });
      for (const root of [rig.robot, ...rig.legs.flatMap((leg) => [leg.coxa, leg.femur, leg.tibia, leg.calf, leg.knee, leg.calfJoint]), target.mesh]) {
        disposeObject3D(root);
      }
      world.dispose();
      if (window.leaperPlaytest === playtest) delete window.leaperPlaytest;
      if (window.leaperJunkyard === mode) delete window.leaperJunkyard;
    },
  };
  // Testing hooks: ?debug exposes the playtest (positions, state) and the mode
  // (to check that dispose() really cleans up).
  if (params.has('debug')) {
    window.leaperPlaytest = playtest;
    window.leaperJunkyard = mode;
  }
  return mode;
}
