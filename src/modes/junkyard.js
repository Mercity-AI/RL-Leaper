import { createJunkyardWorld } from '../world/createJunkyardWorld.js';
import { attachWorldCollision } from '../world/WorldCollision.js';
import { LolaPlayer } from '../robot/LolaPlayer.js';
import { JunkyardPlaytest } from '../simulation/JunkyardPlaytest.js';
import { enableMovableHud } from '../controls/MovableHud.js';
import { EventBus } from '../core/events.js';
import { GameFlow } from '../core/GameFlow.js';
import { disposeObject3D } from '../core/disposeObject3D.js';
import { LaserAudio } from '../simulation/LaserAudio.js';
import { createLeaperScene, loadStep, removeFromScene } from './shared.js';

// The game (default page, also ?map=junkyard): Lola vs. the Leaper in the
// junkyard. The frozen 7,757,824-step brain on the local Python server moves
// the Leaper; its attacks come from the in-browser behaviour tree.

// Longer frame-time cap than the lab modes: Lola and the debris sub-step
// themselves, so a slow frame stays stable.
const MAX_DELTA = 0.1;

// The on-screen panels become movable once per page (doing it twice would stack
// two drag handlers on the panels that outlive a session).
let movableHudEnabled = false;

export async function start({ engine, params }) {
  // 1. One AbortController for the whole session: every page listener of the
  //    systems that support it ends with session.abort() in dispose().
  const session = new AbortController();
  const { signal } = session;
  // 2. The game state starts in Loading while the assets download. The one sound
  //    engine for the whole game starts fetching its recordings at the same time.
  const events = new EventBus();
  const flow = new GameFlow({ events });
  const audio = new LaserAudio({ signal });
  // 3. The junkyard map with its collision service, then Lola (her models need
  //    the map's scale).
  const world = await loadStep('LOADING MAP…', 'MAP LOAD FAILED', () => createJunkyardWorld(engine.scene));
  attachWorldCollision(world);
  const target = await loadStep('LOADING LOLA…', 'CHARACTER LOAD FAILED',
    () => LolaPlayer.create(engine.scene, world, document.getElementById('cuboidToggle')));
  // 4. The Leaper rig, input and a chase camera that follows Lola.
  const { rig, cameraController, simulation } = createLeaperScene({ engine, world, target, signal });
  cameraController.followSubject = target;
  cameraController.pitch = 0.16;
  // 5. The playtest wires brain, combat, weapons and the junkyard panel together,
  //    then resets the encounter (Loading -> Ready).
  const playtest = new JunkyardPlaytest({ engine, world, simulation, target, cameraController, audio, flow, events, signal });
  if (!movableHudEnabled) {
    enableMovableHud();
    movableHudEnabled = true;
  }

  // 6. The frame phases. After dispose() they do nothing, so a loop that is still
  //    running for one more frame can't touch a torn-down session.
  let disposed = false;
  const mode = {
    maxDelta: MAX_DELTA,
    // Read the player's input, run the fight (Encounter order), then presentation.
    input: (dt) => { if (!disposed) playtest.input(dt); },
    update: (dt) => { if (!disposed) playtest.update(dt); },
    lateUpdate: (dt) => { if (!disposed) playtest.lateUpdate(dt); },
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
