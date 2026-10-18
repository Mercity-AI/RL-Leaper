import { createJunkyardWorld } from '../world/createJunkyardWorld.js';
import { attachWorldCollision } from '../world/WorldCollision.js';
import { LolaPlayer } from '../robot/LolaPlayer.js';
import { JunkyardPlaytest } from '../simulation/JunkyardPlaytest.js';
import { enableMovableHud } from '../controls/MovableHud.js';
import { createLeaperScene, loadStep, removeFromScene } from './shared.js';

// The game (default page, also ?map=junkyard): Lola vs. the Leaper in the
// junkyard. The frozen 7,757,824-step brain on the local Python server moves
// the Leaper; its attacks come from the in-browser behaviour tree.

// Longer frame-time cap than the lab modes: Lola and the debris sub-step
// themselves, so a slow frame stays stable.
const MAX_DELTA = 0.1;

export async function start({ engine, params }) {
  // 1. The junkyard map with its collision service, then Lola (her models need
  //    the map's scale).
  const world = await loadStep('LOADING MAP…', 'MAP LOAD FAILED', () => createJunkyardWorld(engine.scene));
  attachWorldCollision(world);
  const target = await loadStep('LOADING LOLA…', 'CHARACTER LOAD FAILED',
    () => LolaPlayer.create(engine.scene, world, document.getElementById('cuboidToggle')));
  // 2. The Leaper rig, input and a chase camera that follows Lola.
  const { rig, cameraController, simulation } = createLeaperScene({ engine, world, target });
  cameraController.followSubject = target;
  cameraController.pitch = 0.16;
  // 3. The playtest wires brain, combat, weapons and the junkyard panel together.
  const playtest = new JunkyardPlaytest({ engine, world, simulation, target, cameraController });
  enableMovableHud();
  // Testing hook: ?debug exposes the playtest so automated checks can read positions.
  if (params.has('debug')) window.leaperPlaytest = playtest;

  return {
    maxDelta: MAX_DELTA,
    // Read the player's input, run the fight (Encounter order), then presentation.
    input: (dt) => playtest.input(dt),
    update: (dt) => playtest.update(dt),
    lateUpdate: (dt) => playtest.lateUpdate(dt),
    // Render hooks nest: camera -> weapon -> POV before, undone in reverse after.
    beforeRender() {
      cameraController.beforeRender();
      playtest.playerWeapon.beforeRender();
      playtest.pov.beforeRender();
    },
    afterRender() {
      playtest.pov.afterRender();
      playtest.playerWeapon.afterRender();
      cameraController.afterRender();
    },
    dispose() {
      playtest.dispose();
      if (window.leaperPlaytest === playtest) delete window.leaperPlaytest;
      removeFromScene(engine.scene, { world, rig, target });
    },
  };
}
