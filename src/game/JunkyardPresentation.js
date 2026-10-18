import { SunFollow } from '../core/sunShadow.js';

// Only touch the page when a readout actually changes.
function setText(element, text) {
  if (element && element.textContent !== text) element.textContent = text;
}

// The junkyard's late (presentation) phase, run every frame after gameplay and
// even after the fight has ended: camera, sun, world-pinned HUD and readouts.
// The Leaper's animator used to drive the camera and sun itself, so they froze
// whenever the brain stopped animating (review fixes 5.2 step 1, 5.17, 5.21).
export class JunkyardPresentation {
  constructor({ engine, world, cameraController, player, encounter, pov, brainLabel, statusElement }) {
    Object.assign(this, { engine, world, cameraController, player, encounter, pov, brainLabel, statusElement });
    // 1. Camera reach and fog at the junkyard's scale.
    cameraController.mapScale = world.scale;
    cameraController.followScale = world.defaultWidth / world.width;
    cameraController.topHeight = 43 * world.scale;
    engine.camera.far = 500 * world.scale;
    engine.camera.updateProjectionMatrix();
    engine.scene.fog.near = 35 * world.scale;
    engine.scene.fog.far = 64 * world.scale;
    // 2. The sun follows Lola, with its shadow box scaled to the map.
    this.sun = new SunFollow(engine.sun, { scale: world.scale });
    // 3. Take presentation away from the Leaper animators: no camera, sun or
    //    status line from them, and each health bar is placed here, after the camera.
    for (const { simulation, combat } of encounter.enemies) {
      simulation.drivesPresentation = false;
      combat.healthBarLate = true;
    }
  }

  lateUpdate(dt) {
    const primary = this.encounter.primary;
    // 1. Chase / top camera, every frame (mouse look, shake and aim zoom keep easing).
    this.cameraController.update(primary.simulation.state, primary.simulation.rig.eyePivot, dt);
    // 2. Sun and shadows centred on Lola, snapped to shadow pixels.
    this.sun.update(this.player.mesh.position);
    // 3. LEAPER POV (spectator) overrides the camera while it is on.
    this.pov.update();
    // 4. Fresh camera matrices, so anything projected below uses this frame's view.
    this.engine.camera.updateMatrixWorld();
    // 5. World-pinned HUD: each Leaper's floating health bar (frozen while paused).
    const gameDt = this.encounter.gameDelta(dt);
    for (const { combat } of this.encounter.enemies) combat.updateHealthBar(gameDt);
    // 6. Brain badge and the top-right status line.
    const { label, status } = primary.brain.describe();
    setText(this.brainLabel, label);
    setText(this.statusElement, status);
  }
}
