import { BUTTON_ACTIONS } from './actions.js';

// Touch screens: which buttons the on-screen band shows, and whether this device
// gets the band at all (review fix 5.9). Plain data and a pure check, so they can
// be tested in Node; the band itself is src/ui/TouchControls.js.

// ---- The band's buttons ----
// Left to right; the right thumb rests on AIM and FIRE. Each names an input
// action (src/input/actions.js), so a touch button does exactly what its key,
// mouse button and gamepad button do.
//   mode  'hold'   the action lasts while the finger stays down (FIRE keeps an
//                  automatic gun firing)
//         'toggle' each tap flips it on or off (AIM: tap to raise the sights,
//                  tap again to lower them)
//         'tap'    one press per tap
//   gun   the button belongs to the gun, so it dims while the gun can't be used
//         (TOP view, LEAPER POV, paused, the fight is over). SWITCH is not one:
//         like CROUCH and JUMP, swapping guns works in all of those but a pause.
export const TOUCH_BAND = Object.freeze([
  Object.freeze({ action: 'pause', mode: 'tap' }),
  Object.freeze({ action: 'crouch', mode: 'tap' }),
  Object.freeze({ action: 'jump', mode: 'tap' }),
  Object.freeze({ action: 'switchWeapon', mode: 'tap' }),
  Object.freeze({ action: 'reload', mode: 'tap', gun: true }),
  Object.freeze({ action: 'aim', mode: 'toggle', gun: true }),
  Object.freeze({ action: 'fire', mode: 'hold', gun: true }),
]);

// The band as the view needs it: [{ action, label, mode, gun }]. Labels come from
// the action map's `touch` names, so the band and the controls list always agree.
export function touchButtons(band = TOUCH_BAND, buttons = BUTTON_ACTIONS) {
  return band.map(({ action, mode, gun = false }) => {
    const label = buttons[action]?.touch;
    if (!label) throw new Error(`Touch band: "${action}" has no touch label in the action map`);
    return Object.freeze({ action, label, mode, gun });
  });
}

// ---- Does this device get the touch controls? ----
// Yes on a coarse primary pointer (a phone or tablet) or any touch support; the
// ?touch URL flag forces them on, for trying the layout with a mouse.
export function wantsTouchControls(win = globalThis.window) {
  if (!win) return false;
  if (new URLSearchParams(win.location?.search ?? '').has('touch')) return true;
  return Boolean(win.matchMedia?.('(pointer: coarse)')?.matches || 'ontouchstart' in win);
}
