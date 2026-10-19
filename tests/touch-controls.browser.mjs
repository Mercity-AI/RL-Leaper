// Touch controls on a phone (review fix 5.9), driven like a real player: the
// real game page in Pixel 7 emulation (a touch screen, coarse pointer), with
// real (trusted) taps and held touches sent through the browser. The browser
// runner (tests/run-browser.mjs) calls this with a page opened on that device.
//
// It checks that START PLAYER never captures the mouse on touch, that every
// on-screen control still receives touches afterwards, and that each touch
// button works: the joystick moves Lola, FIRE held fires, AIM toggles the
// sights, RELOAD / SWITCH / CROUCH / JUMP do their job, in the TOP view FIRE
// dims and does nothing while SWITCH still works, the right side turns the
// camera, PAUSE pauses and RESUME carries on, and while paused a tap on the
// right side resumes instead of turning the camera.
//
// The page renders in software at a few frames a second, so the checks look at
// counts and states, never at speeds.

// What the game reports, read in the page (?debug exposes window.leaperPlaytest).
const state = (page) => page.evaluate(() => {
  const p = window.leaperPlaytest;
  return {
    flow: p.flow.state.name, mode: p.flow.playMode,
    mag: p.playerWeapon.ammoState.mag, reloading: p.playerWeapon.state.reloading,
    weaponIndex: p.target.weaponIndex, crouching: p.target.crouching, jumping: Boolean(p.target.jumpState),
    aiming: p.cameraController.aiming, yaw: p.cameraController.yaw,
    x: p.target.mesh.position.x, z: p.target.mesh.position.z,
    mouseLook: document.body.classList.contains('mouse-look'),
    touchPlay: document.body.classList.contains('touch-play'),
    locked: Boolean(document.pointerLockElement),
  };
});

// Wait until fn(state) is true (the game updates a few times a second here).
// Generous limits: a busy machine renders the game at well under a frame a second.
async function until(page, fn, timeout = 120000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    last = await state(page);
    if (fn(last)) return last;
    await page.waitForTimeout(150);
  }
  throw new Error(`timed out waiting; last state ${JSON.stringify(last)}`);
}

export default async function touchControls(page, { baseUrl, check }) {
  // 1. The real game on a phone.
  await page.goto(`${baseUrl}/?debug`, { timeout: 300000 });
  await page.waitForFunction(() => window.leaperPlaytest?.playerWeapon, null, { timeout: 300000 });
  check(await page.evaluate(() => matchMedia('(pointer: coarse)').matches), 'the page sees a coarse (touch) pointer');
  check(await page.locator('.touch-band').isVisible(), 'the touch controls are shown on a touch screen');
  const touch = await page.context().newCDPSession(page);
  const centre = async (selector) => {
    const box = await page.locator(selector).first().boundingBox();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };
  // A finger held down (and optionally dragged), then lifted.
  const hold = async (selector, milliseconds, drag = null) => {
    const at = await centre(selector);
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: at.x, y: at.y, id: 1 }] });
    if (drag) {
      for (let step = 1; step <= 5; step += 1) {
        await touch.send('Input.dispatchTouchEvent', { type: 'touchMove',
          touchPoints: [{ x: at.x + drag.x * step / 5, y: at.y + drag.y * step / 5, id: 1 }] });
        await page.waitForTimeout(40);
      }
    }
    await page.waitForTimeout(milliseconds);
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  const tap = (selector) => page.tap(selector);

  // 2. START PLAYER by touch: no pointer lock, no mouse-look, so nothing goes dead.
  await tap('[data-action=player]');
  let now = await until(page, (s) => s.flow === 'playing');
  check(now.mode === 'explore' && !now.locked && !now.mouseLook && now.touchPlay,
    'START PLAYER on a phone never captures the mouse (no pointer lock, no mouse-look)');
  // Every on-screen control is still the thing under its own centre, and takes touches.
  const controls = ['#joyBase', '#btnSprint', '[data-action=player]', '#cameraToggle',
    ...['fire', 'aim', 'reload', 'switchWeapon', 'crouch', 'jump', 'pause'].map(action => `.touch-band [data-action=${action}]`)];
  for (const selector of controls) {
    const at = await centre(selector);
    const reachable = await page.evaluate(({ selector, x, y }) => {
      const element = document.querySelector(selector), top = document.elementFromPoint(x, y);
      return Boolean(top && (top === element || element.contains(top))) && getComputedStyle(element).pointerEvents !== 'none';
    }, { selector, ...at });
    check(reachable, `${selector} still receives touches after START PLAYER`);
  }

  // 3. The joystick moves Lola.
  now = await state(page);
  await hold('#joyBase', 1500, { x: 0, y: -45 });
  const moved = await state(page);
  check(Math.hypot(moved.x - now.x, moved.z - now.z) > 0.05, 'the joystick moves Lola');

  // 4. FIRE held fires (the M416 keeps firing while held); letting go stops it.
  now = await state(page);
  await hold('.touch-band [data-action=fire]', 1500);
  const fired = await until(page, (s) => s.mag < now.mag);
  check(fired.mag < now.mag, `holding FIRE fires (${now.mag - fired.mag} rounds)`);
  await page.waitForTimeout(600);
  const settled = await state(page);
  await page.waitForTimeout(800);
  check((await state(page)).mag === settled.mag, 'letting go of FIRE stops firing');

  // 5. RELOAD refills the magazine just used.
  await tap('.touch-band [data-action=reload]');
  await until(page, (s) => s.reloading);
  now = await until(page, (s) => !s.reloading, 240000);
  check(now.mag === 20, 'RELOAD refills the M416');

  // 6. AIM is a toggle.
  await tap('.touch-band [data-action=aim]');
  await until(page, (s) => s.aiming);
  check(await page.locator('.touch-band [data-action=aim]').getAttribute('aria-pressed') === 'true', 'AIM raises the sights');
  await tap('.touch-band [data-action=aim]');
  await until(page, (s) => !s.aiming);
  check(true, 'a second AIM tap lowers them');

  // 7. Dragging the right side of the screen turns the camera.
  now = await state(page);
  await hold('.touch-look', 400, { x: -80, y: 0 });
  check(Math.abs((await state(page)).yaw - now.yaw) > 0.05, 'dragging the right side turns the camera');

  // 8. SWITCH, CROUCH and JUMP (and the gun's buttons in the TOP view).
  now = await state(page);
  await tap('.touch-band [data-action=switchWeapon]');
  await until(page, (s) => s.weaponIndex !== now.weaponIndex);
  check(true, 'SWITCH changes guns');
  await tap('.touch-band [data-action=crouch]');
  await until(page, (s) => s.crouching);
  check(true, 'CROUCH crouches');
  await tap('.touch-band [data-action=crouch]');
  await until(page, (s) => !s.crouching);
  await tap('.touch-band [data-action=jump]');
  await until(page, (s) => s.jumping);
  check(true, 'JUMP jumps');
  // In the TOP view the gun is put away: FIRE dims and does nothing, while SWITCH
  // stays lit because swapping guns still works there.
  await tap('#cameraToggle');
  await page.waitForFunction(() => document.querySelector('.touch-band [data-action=fire]').dataset.disabled === 'true', null, { timeout: 120000 });
  check(await page.locator('.touch-band [data-action=switchWeapon]').getAttribute('data-disabled') !== 'true',
    'in the TOP view FIRE dims but SWITCH stays lit');
  now = await state(page);
  await hold('.touch-band [data-action=fire]', 800);
  check((await state(page)).mag === now.mag, 'the dimmed FIRE fires nothing in the TOP view');
  await tap('.touch-band [data-action=switchWeapon]');
  await until(page, (s) => s.weaponIndex !== now.weaponIndex);
  check(true, 'SWITCH swaps guns in the TOP view');
  await tap('#cameraToggle');
  await page.waitForFunction(() => document.querySelector('.touch-band [data-action=fire]').dataset.disabled === 'false', null, { timeout: 120000 });

  // 9. PAUSE pauses everything; the same button (now RESUME) carries on.
  await tap('.touch-band [data-action=pause]');
  await until(page, (s) => s.flow === 'paused');
  check(await page.locator('.touch-band [data-action=pause]').textContent() === 'RESUME', 'PAUSE pauses, and the button offers RESUME');
  await tap('.touch-band [data-action=pause]');
  await until(page, (s) => s.flow === 'playing');
  check(true, 'RESUME carries on');
  // While paused the look area steps aside, so a tap on the right of the screen
  // lands on the pause overlay and resumes, instead of turning the camera.
  const lookBox = await page.locator('.touch-look').boundingBox();
  await tap('.touch-band [data-action=pause]');
  await until(page, (s) => s.flow === 'paused');
  check(!(await page.locator('.touch-look').isVisible()), 'the look area steps aside while paused');
  await page.touchscreen.tap(lookBox.x + lookBox.width / 2, lookBox.y + lookBox.height / 2);
  await until(page, (s) => s.flow === 'playing');
  // (The view redraws on the next game frame, a moment after the resume.)
  await page.locator('.touch-look').waitFor({ state: 'visible', timeout: 120000 });
  check(true, 'a tap on the right of the paused screen resumes, and the look area is back');
  // Sound needs a finger lift to start on phones; after these taps it is running.
  // (Headless Chromium may allow sound without one, so this is only a smoke check.)
  check(await page.evaluate(() => window.leaperPlaytest.audio.context?.state === 'running'), 'the game sound is unlocked by touch');

  // 10. The toolbar still works: STOP PLAYER.
  await tap('[data-action=player]');
  await until(page, (s) => s.flow === 'ready');
  check(true, 'STOP PLAYER still responds to a tap');
  return 'Touch controls';
}
