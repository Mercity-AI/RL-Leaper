// Camera feel in one place: lenses, look limits, mouse / touch / gamepad
// sensitivity, shake and recoil recovery. CameraController only reads these.
// Angles are radians unless a name says degrees.

export const CAMERA = Object.freeze({
  // ---- Lenses (vertical field of view, degrees) ----
  // chaseFov: the third-person view behind Lola. eyeFov: the lab's Leaper-eye view.
  // topFov: the map-wide TOP view.
  chaseFov: 55,
  eyeFov: 60,
  topFov: 75,
  // Aiming magnification when a gun gives none of its own (see WEAPONS[id].ads.zoom).
  aimZoom: 1.35,
  // How quickly the lens eases into and out of the aim zoom (per second).
  fovEase: 14,

  // ---- Look limits ----
  // Pitch is "camera above Lola": positive looks down at her, negative looks up.
  // Chase: kept tight so mouse look shows the surroundings, not the floor or the sky.
  chasePitch: Object.freeze({ low: -0.25, high: 0.5 }),
  // Aiming down the sights looks from Lola's eyes, so it may tilt much further
  // (about 57 degrees up or down), enough to put the Leaper's upper knees under the
  // crosshair up close (review fix 5.22).
  aimPitch: Object.freeze({ up: -1.0, down: 1.0 }),
  // Leaving a steep aim, the chase view eases back into its own limits instead of
  // snapping (per second; higher = quicker).
  aimExitEase: 9,

  // ---- Sensitivity (the settings a menu would offer) ----
  // sensitivity: the player's overall look-speed setting (1 = default).
  // mouse: radians turned per pixel of mouse movement at sensitivity 1.
  // verticalRatio: up/down speed as a share of left/right speed (1 = equal; the
  //   current 0.64 keeps the feel the game has always had).
  // touch: radians per pixel dragged on the touch look area.
  // gamepad: radians per second at full right-stick tilt.
  // invertY: true flips up and down for mouse, touch and stick.
  // Aiming also slows the look by the zoom, so the view moves the same amount on
  // screen for the same hand movement at any magnification (review fix 5.38).
  look: Object.freeze({
    sensitivity: 1,
    mouse: 0.0055,
    verticalRatio: 0.0035 / 0.0055,
    touch: 0.006,
    gamepad: 2.6,
    invertY: false,
  }),

  // ---- Chase boom ----
  // Mouse-wheel zoom range of the boom behind Lola, and how much one wheel notch
  // changes it. The wheel does nothing while aiming (review fix 5.38).
  boom: Object.freeze({ start: 8.5, min: 6, max: 22, wheelRate: 0.001 }),

  // ---- Big-impact shake ----
  // strength (0-1) fades out over `duration` seconds; the view wobbles by up to
  // these angles at full strength, `speed` sets how fast it wobbles.
  shake: Object.freeze({ duration: 1, speed: 30, pitch: 0.035, yaw: 0.03, roll: 0.025 }),

  // ---- Recoil ----
  // The most kick the view can build up from sustained fire (each gun sets its own
  // kick and recovery in src/config/weapons.js).
  recoilMax: 0.12,
  // The most the per-shot jolt can push the view back (map units), and how fast
  // the view follows a spray pattern's climb (per second; higher = tighter).
  recoilPushMax: 0.25,
  sprayEase: 30,

  // ---- First-person aim ----
  // While aiming the camera sits inside Lola's head, so only these of her parts
  // stop drawing (by material name in her exported model); her arms, gun, body
  // and shadow stay (finding aim-weapons-ads-hides-whole-body).
  firstPersonHide: Object.freeze(['face', 'neck']),
});
