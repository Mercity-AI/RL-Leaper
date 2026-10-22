import * as THREE from 'three';
import { BODY_COLLISION_RADIUS, STANDING_HEIGHT } from '../config/robot.js';

// The title screen's backdrop (owner, 2026-10-22): the Leaper is the star, so
// Lola is hidden and the camera looks at the Leaper, lit a little brighter,
// which turns on the spot: a couple of steps clockwise, back, a couple
// anticlockwise and back, over and over (owner: turning, not sidestepping).
// Only what is shown changes: the Leaper's brain and the fight never see it,
// and leaving the title puts everything back as the new game set it up.

// Distances in world units (the Leaper's own size), angles in radians, times in seconds.
export const TITLE_SHOWCASE = Object.freeze({
  // How far each turn goes (about two of its steps).
  turn: 0.5,
  // One turn takes this long, then it stands this long before the next.
  move: 1.8,
  rest: 1.2,
  // The camera: this far from the Leaper, this high, looking at this height.
  distance: 3.4 * BODY_COLLISION_RADIUS,
  height: 1.9 * STANDING_HEIGHT,
  lookHeight: 0.75 * STANDING_HEIGHT,
  // Turned this far so the Leaper stands right of the title text.
  aside: 0.3,
  // Camera spots tried around the Leaper, from its front outwards.
  angles: Object.freeze([0.45, -0.45, 0.9, -0.9, 0, 1.4, -1.4, 2, -2, Math.PI]),
  // Extra light while the title is up (no new lights, so nothing recompiles):
  // the sky fill brighter, and the cool rim light turned into a soft key light
  // shining from beside the camera onto the Leaper.
  fill: 1.45,
  key: Object.freeze({ intensity: 1.1, colour: 0xdfe6ff, lift: 0.9, swing: 0.6 }),
});

// Where the turn is at time t, from -1 (clockwise) to 1 (anticlockwise):
// clockwise, back, anticlockwise, back, each eased in and out with a rest in between.
const PATTERN = [0, -1, 0, 1];
export function turnAt(t, { move, rest } = TITLE_SHOWCASE) {
  const leg = move + rest, cycle = leg * PATTERN.length;
  const phase = ((t % cycle) + cycle) % cycle;
  const index = Math.floor(phase / leg);
  const from = PATTERN[index], to = PATTERN[(index + 1) % PATTERN.length];
  const k = Math.min(1, (phase - index * leg) / move);
  return from + (to - from) * k * k * (3 - 2 * k);
}

export class TitleShowcase {
  // encounter: the fight (its first Leaper and Lola); camera: the scene camera;
  // scene: for its sky fill and rim lights; sun: the shadow-following sun
  // (SunFollow), centred on the Leaper while shown.
  constructor({ encounter, world, camera, scene = null, sun = null }) {
    Object.assign(this, { encounter, world, camera, sun });
    this.active = false;
    this.time = 0;
    this.lookAt = new THREE.Vector3();
    const lights = [];
    scene?.traverse((object) => { if (object.isLight) lights.push(object); });
    this.fillLight = lights.find((light) => light.isHemisphereLight) ?? null;
    this.keyLight = lights.find((light) => light.isDirectionalLight && !light.castShadow) ?? null;
  }

  get enemy() { return this.encounter.primary; }

  // Show (true) or end (false) the backdrop.
  show(on) {
    if (on === this.active || !this.enemy?.actor) return;
    this.active = on;
    this.encounter.player.mesh.visible = !on;
    this.light(on);
    if (on) this.anchorAt(this.enemy.actor.pose);
    else {
      // Back exactly where the new game put it, feet planted (unless a reset
      // has put it somewhere new meanwhile).
      const { actor } = this.enemy;
      actor.shownOffset = null;
      if (this.samePose(actor.pose)) this.encounter.placeLeaper(this.enemy, this.anchor);
    }
  }

  // The title's extra light on (remembering the game's own) or back off.
  light(on) {
    const { fillLight: fill, keyLight: key } = this;
    if (on) {
      this.saved = { fill: fill?.intensity, key: key && { intensity: key.intensity, colour: key.color.getHex(), position: key.position.clone() } };
      if (fill) fill.intensity *= TITLE_SHOWCASE.fill;
      if (key) {
        key.intensity = TITLE_SHOWCASE.key.intensity;
        key.color.setHex(TITLE_SHOWCASE.key.colour);
      }
    } else if (this.saved) {
      if (fill) fill.intensity = this.saved.fill;
      if (key) {
        key.intensity = this.saved.key.intensity;
        key.color.setHex(this.saved.key.colour);
        key.position.copy(this.saved.key.position);
      }
      this.saved = null;
    }
  }

  // Turn around this pose, filmed from a clear spot.
  anchorAt(pose) {
    this.time = 0;
    this.anchor = { x: pose.x, z: pose.z, yaw: pose.yaw };
    this.view = this.pickView(this.anchor);
    // The key light comes from beside the camera, a little above it (a
    // directional light shines from its position towards the origin).
    if (this.keyLight) {
      const { lift, swing } = TITLE_SHOWCASE.key;
      const angle = Math.atan2(this.view.x - this.anchor.x, this.view.z - this.anchor.z) + swing;
      this.keyLight.position.set(Math.sin(angle), lift, Math.cos(angle)).multiplyScalar(10);
    }
  }

  samePose({ x, z, yaw }) {
    const a = this.anchor;
    return Math.abs(x - a.x) < 1e-6 && Math.abs(z - a.z) < 1e-6 && Math.abs(yaw - a.yaw) < 1e-6;
  }

  // A camera spot with a clear line to the Leaper, as near its front as possible.
  pickView({ x, z, yaw }) {
    const { distance, angles } = TITLE_SHOWCASE;
    const blocked = (px, pz) => this.world.playerBlocked?.(px, pz) ?? false;
    const clear = (angle) => {
      for (let f = 0.45; f <= 1.0001; f += 0.11) {
        if (blocked(x + Math.sin(angle) * distance * f, z + Math.cos(angle) * distance * f)) return false;
      }
      return true;
    };
    const angle = angles.map((a) => yaw + a).find(clear) ?? yaw + angles[0];
    return { x: x + Math.sin(angle) * distance, z: z + Math.cos(angle) * distance };
  }

  // Gameplay phase: turn the shown Leaper (clockwise seen from above is a smaller yaw).
  update(dt) {
    if (!this.active) return;
    // A reset while shown (a new game) moved the Leaper: film it there.
    if (!this.samePose(this.enemy.actor.pose)) this.anchorAt(this.enemy.actor.pose);
    this.time += dt;
    this.enemy.actor.shownOffset = { x: 0, z: 0, yaw: turnAt(this.time) * TITLE_SHOWCASE.turn };
  }

  // Late phase (after the chase camera): look at the Leaper from the chosen spot.
  lateUpdate() {
    if (!this.active) return;
    const floor = this.world.floorHeight ?? 0;
    this.camera.position.set(this.view.x, floor + TITLE_SHOWCASE.height, this.view.z);
    this.camera.lookAt(this.lookAt.set(this.anchor.x, floor + TITLE_SHOWCASE.lookHeight, this.anchor.z));
    this.camera.rotateY(TITLE_SHOWCASE.aside);
    this.camera.updateMatrixWorld();
    this.sun?.update(this.enemy.simulation.state.position);
  }
}
