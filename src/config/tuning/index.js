import { TuningRegistry } from './registry.js';
import { wantsDevTools } from '../../debug/devTools.js';
import { CAMERA as CAMERA_CONFIG } from '../camera.js';
import { HIT_FEEDBACK as HIT_FEEDBACK_CONFIG, SHOOTING as SHOOTING_CONFIG, WEAPON_SLOTS, WEAPONS as WEAPONS_CONFIG } from '../weapons.js';
import { COMBAT as COMBAT_CONFIG } from '../combat.js';
import { ENCOUNTER } from '../encounter.js';
import eyeVision from '../eye-vision.json' with { type: 'json' };
import playerContact from '../player-contact.json' with { type: 'json' };

// The game's tunable configs, read through the tuning registry (registry.js).
// A module that should follow live tuning imports its config from here instead
// of from its file: `import { CAMERA } from '../config/tuning/index.js'`. For
// players this hands out the frozen config itself; with the developer tools it
// hands out a live copy that the tuning panel (src/debug/TuningPanel.js) changes
// in place and remembers in this browser.
//
// Live (read through the registry by):
//   camera       CameraController, PlayerController, GameUi, PlayerWeapon
//   guns         PlayerWeapon and its WeaponState per gun
//   shooting     PlayerWeapon
//   hitFeedback  HitFeedback
//   combat       LeaperCombat (and its AttackController), PlayerVitals
// Read-only, clearly labelled: encounter (read when the game loads) and the
// frozen brain contract (eye-vision.json, player-contact.json).

// Every config the game registers, in panel order. Returns the configs modules
// read (live copies while tuning is on). Tests call it on a registry of their own.
export function registerGameConfigs(registry) {
  // ---- Tunable (live) ----
  // `fixed` paths are shown but not tunable: read only once, or owned by SETTINGS.
  const configs = {
    CAMERA: registry.register('camera', { label: 'Camera', source: CAMERA_CONFIG,
      fixed: ['chaseFov', 'look.sensitivity', 'look.invertY', 'aimZoom', 'boom.start'],
      note: 'Live. Fixed here: chaseFov, look.sensitivity and look.invertY are the player\'s SETTINGS; '
        + 'boom.start is read when the camera is made; each gun sets its own aim zoom (Guns, ads.zoom).' }),
    WEAPONS: registry.register('guns', { label: 'Guns', source: WEAPONS_CONFIG,
      note: 'Live: the next shot uses it. A new magazine size shows after a reload.' }),
    SHOOTING: registry.register('shooting', { label: 'Shooting feel', source: SHOOTING_CONFIG,
      fixed: ['maxShotsPerFrame'], note: 'Live. maxShotsPerFrame is read when the guns are made.' }),
    HIT_FEEDBACK: registry.register('hitFeedback', { label: 'Hit feedback', source: HIT_FEEDBACK_CONFIG, note: 'Live.' }),
    COMBAT: registry.register('combat', { label: 'Combat', source: COMBAT_CONFIG,
      fixed: ['lolaHealth', 'weakPointMultiplier', 'laserLength', 'laserRadius'],
      note: 'Live. leaperHealth applies on RESTART. Fixed here (read when the game loads): lolaHealth, '
        + 'weakPointMultiplier (the hit zones) and the laser\'s length and radius.' }),
  };

  // ---- Read-only (shown for reference) ----
  registry.register('encounter', { label: 'Encounter (read at load)', source: ENCOUNTER, readOnly: true,
    note: 'Read when the game loads: edit src/config/encounter.js. The Leaper size and the soft restart feed the frozen brain.' });
  registry.register('brainEyeVision', { label: 'BRAIN CONTRACT: eye vision', source: eyeVision, readOnly: true,
    note: 'Frozen brain contract (src/config/eye-vision.json): never tuned.' });
  registry.register('brainPlayerContact', { label: 'BRAIN CONTRACT: player contact', source: playerContact, readOnly: true,
    note: 'Frozen brain contract (src/config/player-contact.json): never tuned.' });
  return configs;
}

// localStorage, if this page may use it (a private window may refuse).
function browserStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

// The game's registry. Tuning comes with the developer tools: ?dev, or the dev
// server (?dev=0 is off). Saved changes from earlier visits apply at once.
export const tuning = new TuningRegistry({ live: wantsDevTools(), storage: browserStorage() });
export const { CAMERA, WEAPONS, SHOOTING, HIT_FEEDBACK, COMBAT } = registerGameConfigs(tuning);
tuning.load();

// The weapons file's helpers, on the guns this module hands out.
export { WEAPON_SLOTS };
export function weaponForSlot(index) {
  return WEAPONS[WEAPON_SLOTS[index]];
}
