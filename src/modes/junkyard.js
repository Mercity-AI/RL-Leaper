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
import { GameUi } from '../ui/GameUi.js';
import '../styles/ui/dev-panel.css';
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
  // 6. The front end's HUD shell, then the playtest, which wires brain, combat,
  //    weapons and the junkyard panel together and resets the encounter
  //    (Loading -> Ready). The brain owns the provider; the HUD draws Lola's
  //    health and the guns. Then the menus (the title shows in Ready).
  const ui = new GameUi({ input, cameraController, flow, events, quality: engine.quality.name });
  const playtest = new JunkyardPlaytest({ engine, world, simulation, target, cameraController, audio, flow, events, signal,
    brainProvider, hud: ui.hud });
  ui.attach(playtest);
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
    // Read the player's input (the menus' while one is open), run the fight
    // (Encounter order), then presentation.
    input: (dt) => { if (!disposed) ui.input(dt); },
    update: (dt) => { if (!disposed) playtest.update(dt); },
    lateUpdate: (dt) => {
      if (disposed) return;
      playtest.lateUpdate(dt);
      // Dust and sparks hold still while the game is paused.
      world.effects.update(flow.paused ? 0 : dt);
      // The HUD and menus redraw from this frame's numbers (only changes reach the page).
      ui.lateUpdate(dt);
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
      ui.dispose();
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
