import { TuningRegistry } from './registry.js';
import { CAMERA as CAMERA_CONFIG } from '../camera.js';
import { HIT_FEEDBACK as HIT_FEEDBACK_CONFIG, SHOOTING as SHOOTING_CONFIG, WEAPON_SLOTS, WEAPONS as WEAPONS_CONFIG } from '../weapons.js';
import { COMBAT as COMBAT_CONFIG } from '../combat.js';
import { ENCOUNTER } from '../encounter.js';
import eyeVision from '../eye-vision.json' with { type: 'json' };
import playerContact from '../player-contact.json' with { type: 'json' };

// The game's tunable configs, read through the tuning registry (registry.js).
// Modules that want live tuning import their config from here instead of from
// its file: `import { CAMERA } from '../config/tuning/index.js'`. For players
// this hands out the frozen config itself; with the developer tools it hands out
// a live copy the tuning panel changes in place (and remembers in this browser).
//
// Registered here:
//   camera       lenses, look limits and speeds, boom, shake, recoil (CameraController)
//   guns         every gun's damage, rate, magazine, spread, recoil, aim zoom (PlayerWeapon)
//   shooting     shot pose timing and the OBSTRUCTED tolerance
//   hitFeedback  how long hit markers and the crosshair kick show
//   combat       health, damage, the Leaper's attack timing and ranges (PlayerVitals;
//                the Leaper's own combat reads it once the developer panel binds it)
// and read-only, clearly labelled (the frozen brain depends on them, or they are
// only read when the game loads):
//   encounter, brainEyeVision, brainPlayerContact
// The Leaper's behaviour config (src/config/leaper-behaviour.js) is picked up by
// the developer panel when it exists; it becomes live once its modules read it
// through `tuning.values('leaperBehaviour')` after registering it here.

// Tuning is on with the developer tools: on the dev server, or with ?dev or
// ?tune in the address (?dev=0 / ?tune=0 switch it off).
export function tuningEnabled({ search = globalThis.location?.search ?? '', dev = Boolean(import.meta.env?.DEV) } = {}) {
  const params = new URLSearchParams(search);
  for (const name of ['tune', 'dev']) {
    const value = params.get(name);
    if (value !== null) return !['0', 'false', 'off', 'no'].includes(value.toLowerCase());
  }
  return Boolean(dev);
}

function browserStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

const live = tuningEnabled();
export const tuning = new TuningRegistry({ live, storage: live ? browserStorage() : null });

// ---- Tunable (live) ----
export const CAMERA = tuning.register('camera', { label: 'Camera', source: CAMERA_CONFIG,
  note: 'Live. Lenses, look speeds and limits, boom, shake and recoil.' });
export const WEAPONS = tuning.register('guns', { label: 'Guns', source: WEAPONS_CONFIG,
  note: 'Live (the next shot uses it). Magazine size applies after a reload.' });
export const SHOOTING = tuning.register('shooting', { label: 'Shooting feel', source: SHOOTING_CONFIG, note: 'Live.' });
export const HIT_FEEDBACK = tuning.register('hitFeedback', { label: 'Hit feedback', source: HIT_FEEDBACK_CONFIG, note: 'Live.' });
export const COMBAT = tuning.register('combat', { label: 'Combat', source: COMBAT_CONFIG,
  note: 'Live for the Leaper\'s attacks once bound; health totals apply on RESTART.' });

// ---- Read-only (shown for reference) ----
tuning.register('encounter', { label: 'Encounter (read at load)', source: ENCOUNTER, readOnly: true,
  note: 'Read when the game loads: edit src/config/encounter.js. The Leaper size and the soft restart feed the frozen brain.' });
tuning.register('brainEyeVision', { label: 'BRAIN CONTRACT: eye vision', source: eyeVision, readOnly: true,
  note: 'Frozen brain contract (src/config/eye-vision.json): never tuned.' });
tuning.register('brainPlayerContact', { label: 'BRAIN CONTRACT: player contact', source: playerContact, readOnly: true,
  note: 'Frozen brain contract (src/config/player-contact.json): never tuned.' });

// Saved changes from earlier sessions in this browser (developer tools only).
tuning.load();

// The weapons file's helpers, on the live guns.
export { WEAPON_SLOTS };
export function weaponForSlot(index) {
  return WEAPONS[WEAPON_SLOTS[index]];
}
