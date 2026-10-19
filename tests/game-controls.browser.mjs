// The real game's controls on a desktop, driven like a real player: real mouse
// clicks and key presses through the browser, plus a gamepad stand-in. This
// catches wiring mistakes the component pages can't (the guns reading the wrong
// input, a key that still works while paused, the resume click firing).
// Run by tests/run-browser.mjs on a desktop-sized page.
//
// The page renders in software at a few frames a second, so the checks look at
// counts and states, never at speeds.

// What the game reports (?debug exposes window.leaperPlaytest).
const state = (page) => page.evaluate(() => {
  const p = window.leaperPlaytest;
  return {
    flow: p.flow.state.name, mag: p.playerWeapon.ammoState.mag, reloading: p.playerWeapon.state.reloading,
    weaponIndex: p.target.weaponIndex, crouching: p.target.crouching, aiming: p.cameraController.aiming,
  };
});

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

// A couple of game frames go by (the loop runs slowly here).
const frames = (page, count = 3) => page.evaluate((n) => new Promise((resolve) => {
  let left = n;
  const next = () => (--left <= 0 ? resolve() : requestAnimationFrame(next));
  requestAnimationFrame(next);
}), count);

export default async function gameControls(page, { baseUrl, check }) {
  // 1. The real game, desktop size. A stand-in gamepad the test can press.
  await page.addInitScript(() => {
    const buttons = Array.from({ length: 17 }, () => ({ pressed: false, value: 0 }));
    window.__pad = { id: 'Test pad (standard)', connected: true, mapping: 'standard', buttons, axes: [0, 0, 0, 0] };
    window.__padOn = false;
    navigator.getGamepads = () => [window.__padOn ? window.__pad : null];
  });
  await page.goto(`${baseUrl}/?debug`, { timeout: 300000 });
  await page.waitForFunction(() => window.leaperPlaytest?.playerWeapon, null, { timeout: 300000 });
  check(!(await page.locator('.touch-band').count()), 'no touch controls on a desktop');

  // 2. START PLAYER with the mouse, then a left click on the 3D view fires once.
  await page.click('[data-action=player]');
  await until(page, (s) => s.flow === 'playing');
  const canvas = await page.locator('#app canvas').boundingBox();
  const middle = { x: canvas.x + canvas.width / 2, y: canvas.y + canvas.height / 2 };
  let now = await state(page);
  await page.mouse.click(middle.x, middle.y);
  now = await until(page, (s) => s.mag === now.mag - 1);
  check(true, 'a left click on the game view fires one shot');

  // 3. R reloads; right mouse aims while held.
  await page.keyboard.press('r');
  await until(page, (s) => s.reloading);
  await until(page, (s) => !s.reloading && s.mag === 20, 240000);
  check(true, 'R reloads the M416');
  await page.mouse.move(middle.x, middle.y);
  await page.mouse.down({ button: 'right' });
  await until(page, (s) => s.aiming);
  await page.mouse.up({ button: 'right' });
  await until(page, (s) => !s.aiming);
  check(true, 'holding right mouse aims; letting go stops');

  // 4. 1 / 2 pick guns, C crouches.
  await page.keyboard.press('1');
  await until(page, (s) => s.weaponIndex === 1);
  await page.keyboard.press('2');
  await until(page, (s) => s.weaponIndex === 0);
  check(true, '1 / 2 switch to the pistol and back to the M416');
  await page.keyboard.press('c');
  await until(page, (s) => s.crouching);
  await page.keyboard.press('c');
  await until(page, (s) => !s.crouching);
  check(true, 'C toggles crouch');

  // 5. Escape pauses; while paused the gun keys and clicks do nothing; the click
  //    that resumes (on the pause overlay) never fires.
  await page.keyboard.press('Escape');
  await until(page, (s) => s.flow === 'paused');
  now = await state(page);
  await page.keyboard.press('1');
  await page.keyboard.press('c');
  await frames(page, 4);
  const paused = await state(page);
  check(paused.weaponIndex === now.weaponIndex && !paused.crouching, '1 and C are frozen by the pause');
  await page.mouse.click(middle.x, middle.y);
  await until(page, (s) => s.flow === 'playing');
  await frames(page, 4);
  check((await state(page)).mag === now.mag, 'the click that resumes the game does not fire');

  // 6. A gamepad: RT fires, Y switches guns, Start pauses and resumes.
  await page.evaluate(() => { window.__padOn = true; });
  now = await state(page);
  await page.evaluate(() => { window.__pad.buttons[7] = { pressed: true, value: 1 }; });
  await until(page, (s) => s.mag < now.mag);
  await page.evaluate(() => { window.__pad.buttons[7] = { pressed: false, value: 0 }; });
  check(true, 'the gamepad\'s right trigger fires');
  await page.evaluate(() => { window.__pad.buttons[3] = { pressed: true, value: 1 }; });
  await until(page, (s) => s.weaponIndex === 1);
  await page.evaluate(() => { window.__pad.buttons[3] = { pressed: false, value: 0 }; });
  check(true, 'Y switches guns');
  await page.evaluate(() => { window.__pad.buttons[9] = { pressed: true, value: 1 }; });
  await until(page, (s) => s.flow === 'paused');
  await page.evaluate(() => { window.__pad.buttons[9] = { pressed: false, value: 0 }; });
  await frames(page, 3);
  await page.evaluate(() => { window.__pad.buttons[9] = { pressed: true, value: 1 }; });
  await until(page, (s) => s.flow === 'playing');
  await page.evaluate(() => { window.__pad.buttons[9] = { pressed: false, value: 0 }; });
  check(true, 'Start pauses, and Start again resumes');

  // 7. A touch-screen laptop played with a mouse (?touch shows the touch band
  //    here) in a browser that refuses pointer lock (so the game uses its
  //    hover-look fallback and clicks land on whatever is under the cursor): the
  //    band's look area must not swallow clicks on the right half of the game
  //    view, so a click there still fires.
  await page.evaluate(() => { window.__padOn = false; });
  await page.addInitScript(() => {
    HTMLCanvasElement.prototype.requestPointerLock = () => Promise.reject(new Error('pointer lock refused (test)'));
  });
  await page.goto(`${baseUrl}/?debug&touch`, { timeout: 300000 });
  await page.waitForFunction(() => window.leaperPlaytest?.playerWeapon, null, { timeout: 300000 });
  await page.click('[data-action=player]');
  await until(page, (s) => s.flow === 'playing');
  await page.locator('.touch-band').waitFor({ state: 'visible', timeout: 120000 });
  check(true, '?touch shows the touch band on a desktop once play starts');
  await page.waitForFunction(() => document.body.classList.contains('mouse-look'), null, { timeout: 60000 });
  now = await state(page);
  const right = { x: canvas.x + canvas.width * 0.8, y: canvas.y + canvas.height * 0.5 };
  await page.mouse.click(right.x, right.y);
  await until(page, (s) => s.mag === now.mag - 1);
  check(true, 'with a mouse, a click on the right half of the view fires (the touch look area stands aside)');
  return 'Game controls (mouse, keyboard, gamepad)';
}
