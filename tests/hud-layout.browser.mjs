// No HUD panel or menu covers another (review fix 5.26): every visible HUD
// element and the open menu screen are measured, and any two that intersect
// fail the check. tests/game-flow.browser.mjs runs it at 1280 x 720; this script
// runs it on a phone (Pixel 7 at 412 x 839, touch controls on) with the menus
// open and closed. Run by tests/run-browser.mjs.

// The elements that make up the player's screen. The touch look area is an
// invisible input surface and the full-screen layers (reticle layer, veils) are
// not panels, so they are left out; the crosshair itself is measured.
export const HUD_SELECTORS = Object.freeze([
  '#leaperHealthHud', '#cameraToggle', '.dev-toggle', '#topViewHint', '.hud-hint', '.hud-captions',
  '#combatHud', '#playerGuns', '#playerReticle', '#joyBase', '#btnSprint', '.touch-band',
  '#screens .screen:not([hidden])', '.hud-legend', '#devPanel', '.dev-perf',
]);

// Pairs of visible elements whose boxes overlap (by more than a pixel), as
// "a × b" strings; [] when the screen is clear.
export function hudOverlaps(page, selectors = HUD_SELECTORS) {
  return page.evaluate((list) => {
    const visible = (element) => {
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) === 0) return false;
      const box = element.getBoundingClientRect();
      return box.width > 0 && box.height > 0;
    };
    const boxes = [];
    for (const selector of list) {
      for (const element of document.querySelectorAll(selector)) {
        if (visible(element)) boxes.push({ name: selector, box: element.getBoundingClientRect() });
      }
    }
    const overlaps = [];
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i].box, b = boxes[j].box;
        const x = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (x > 1 && y > 1) overlaps.push(`${boxes[i].name} × ${boxes[j].name}`);
      }
    }
    // Everything also stays on screen.
    for (const { name, box } of boxes) {
      if (box.left < -1 || box.top < -1 || box.right > innerWidth + 1 || box.bottom > innerHeight + 1) overlaps.push(`${name} off screen`);
    }
    return overlaps;
  }, selectors);
}

const flow = (page) => page.evaluate(() => window.leaperPlaytest.flow.state.name);
async function untilFlow(page, name) {
  const end = Date.now() + 120000;
  while (Date.now() < end) {
    if (await flow(page) === name) return;
    await page.waitForTimeout(150);
  }
  throw new Error(`timed out waiting for ${name}`);
}

export default async function hudLayout(page, { baseUrl, check }) {
  // 1. The game on a phone, as a player (no developer tools).
  await page.goto(`${baseUrl}/?debug&dev=0`, { timeout: 300000 });
  await page.waitForFunction(() => window.leaperPlaytest?.playerWeapon, null, { timeout: 300000 });
  await page.locator('.screen:not([hidden]) [data-menu-item=play]').waitFor({ state: 'visible', timeout: 120000 });
  const size = await page.evaluate(() => `${innerWidth} x ${innerHeight}`);
  const clear = async (label) => {
    // (The HUD redraws on the next game frames.)
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const overlaps = await hudOverlaps(page);
    check(!overlaps.length, `${label} at ${size}: nothing overlaps (${overlaps.join('; ') || 'clear'})`);
  };
  await clear('title');
  // 2. SETTINGS from the title: it scrolls inside the screen.
  await page.tap('.screen:not([hidden]) [data-menu-item=settings]');
  await page.locator('.screen[data-screen=settings]').waitFor({ state: 'visible', timeout: 60000 });
  await clear('settings');
  check(await page.evaluate(() => {
    const body = document.querySelector('.screen[data-screen=settings] .screen-body');
    return body.scrollHeight > body.clientHeight && getComputedStyle(body).overflowY === 'auto';
  }), 'the settings scroll inside their screen on a phone');
  await page.tap('.screen[data-screen=settings] [data-menu-back]');
  // 3. In play: the corners, the joystick, SPRINT and the touch band.
  await page.tap('.screen:not([hidden]) [data-menu-item=explore]');
  await untilFlow(page, 'playing');
  await page.locator('.touch-band').waitFor({ state: 'visible', timeout: 120000 });
  await page.locator('#combatHud').waitFor({ state: 'visible', timeout: 120000 });
  await clear('HUD in play');
  // 4. Paused: the pause menu above the touch band.
  await page.tap('.touch-band [data-action=pause]');
  await untilFlow(page, 'paused');
  await page.locator('.screen:not([hidden]) [data-menu-item=resume]').waitFor({ state: 'visible', timeout: 60000 });
  await clear('pause menu');

  // 5. EDIT HUD LAYOUT (Settings > HUD): the menus step aside, a single press
  //    drags Lola's panel, the spot is saved for touch screens, DONE returns to
  //    the settings and RESET LAYOUT puts the panel back in its corner.
  await page.tap('.screen:not([hidden]) [data-menu-item=settings]');
  await page.locator('.screen[data-screen=settings]').waitFor({ state: 'visible', timeout: 60000 });
  const edit = page.locator('#screens .setting-button', { hasText: 'EDIT HUD LAYOUT' });
  await edit.scrollIntoViewIfNeeded();
  await edit.tap();
  await page.locator('.hud-edit-bar').waitFor({ state: 'visible', timeout: 60000 });
  await page.locator('#combatHud').waitFor({ state: 'visible', timeout: 60000 });
  check(await page.evaluate(() => document.body.classList.contains('hud-editing') && document.getElementById('screens').hidden),
    'EDIT HUD LAYOUT shows the HUD with outlines and steps the menu aside');
  const before = await page.locator('#combatHud').boundingBox();
  const touch = await page.context().newCDPSession(page);
  const at = { x: before.x + before.width / 2, y: before.y + before.height / 2 };
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: at.x, y: at.y, id: 1 }] });
  for (let step = 1; step <= 5; step += 1) {
    await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: at.x + 20 * step / 5, y: at.y - 260 * step / 5, id: 1 }] });
    await page.waitForTimeout(40);
  }
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const after = await page.locator('#combatHud').boundingBox();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('leaper.hud-layout.v3.touch') ?? '{}'));
  check(after.y < before.y - 200 && Math.abs(after.x - before.x - 20) <= 2 && saved.vitals,
    `a single press drags Lola's panel up (${Math.round(before.y)} -> ${Math.round(after.y)}) and the touch layout saves it`);
  await page.tap('.hud-edit-bar [data-layout=done]');
  await page.locator('.screen[data-screen=settings]').waitFor({ state: 'visible', timeout: 60000 });
  check(await page.evaluate(() => !document.body.classList.contains('hud-editing') && !document.querySelector('.movable-hud')),
    'DONE returns to the settings and no piece listens for drags any more');
  await page.locator('#screens .setting-button', { hasText: 'RESET LAYOUT' }).tap();
  check(await page.evaluate(() => document.getElementById('combatHud').style.position === ''
    && !localStorage.getItem('leaper.hud-layout.v3.touch')), 'RESET LAYOUT puts the panel back in its corner');
  await page.tap('.screen[data-screen=settings] [data-menu-back]');

  // 6. Back in play the corners are clear again and JUMP answers the first tap.
  await page.tap('.screen:not([hidden]) [data-menu-item=resume]');
  await untilFlow(page, 'playing');
  await clear('HUD after editing');
  await page.tap('.touch-band [data-action=jump]');
  await page.waitForFunction(() => Boolean(window.leaperPlaytest.target.jumpState), null, { timeout: 60000 });
  check(true, 'JUMP answers the first tap (no gesture in the way)');
  return 'HUD layout on a phone';
}
