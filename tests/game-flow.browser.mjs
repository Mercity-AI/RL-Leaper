// The game's front end in a real browser, driven like a player: the title
// screen, PLAY, the pause menu, the end screen and RESTART, with the mouse, the
// keyboard and a gamepad stand-in; the developer panel and its live tuning
// panel only with ?dev (a change applies, is saved and resets); no HUD
// or menu panel covering another at 1280 x 720 (menus open and closed); and no
// page writes from the HUD while nothing changes. Run by tests/run-browser.mjs
// (tests/hud-layout.browser.mjs repeats the overlap check on a phone).
//
// The page renders in software at a few frames a second, so the checks look at
// states and counts, never at speeds.
import { hudOverlaps } from './hud-layout.browser.mjs';

const state = (page) => page.evaluate(() => {
  const p = window.leaperPlaytest;
  return {
    flow: p.flow.state.name, mode: p.flow.playMode, screen: document.getElementById('screens')?.dataset.screen ?? '',
    focus: document.activeElement?.dataset?.menuItem ?? document.activeElement?.tagName ?? '',
    locked: Boolean(document.pointerLockElement), lolaHealth: p.vitals.health, lolaMax: p.vitals.max, leaperHealth: p.combat.leaperHealth,
  };
});

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

// A few game frames go by (the loop runs slowly here).
const frames = (page, count = 3) => page.evaluate((n) => new Promise((resolve) => {
  let left = n;
  const next = () => (--left <= 0 ? resolve() : requestAnimationFrame(next));
  requestAnimationFrame(next);
}), count);

// After a click that starts or resumes play, the mouse capture settles before
// the next key (Escape while the browser is still granting it can be lost).
async function settle(page) {
  await page.waitForFunction(() => Boolean(document.pointerLockElement) || document.body.classList.contains('mouse-look'),
    null, { timeout: 10000 }).catch(() => {});
  await frames(page, 2);
}

// A gamepad button pressed for a few frames, then let go.
async function padPress(page, button) {
  await page.evaluate((index) => { window.__pad.buttons[index] = { pressed: true, value: 1 }; }, button);
  await frames(page, 3);
  await page.evaluate((index) => { window.__pad.buttons[index] = { pressed: false, value: 0 }; }, button);
  await frames(page, 2);
}

export default async function gameFlow(page, { baseUrl, check }) {
  // 1. The game as a player sees it (?dev=0: no developer tools even on the dev
  //    server), with a stand-in gamepad.
  await page.addInitScript(() => {
    const buttons = Array.from({ length: 17 }, () => ({ pressed: false, value: 0 }));
    window.__pad = { id: 'Test pad (standard)', connected: true, mapping: 'standard', buttons, axes: [0, 0, 0, 0] };
    navigator.getGamepads = () => [window.__pad];
  });
  await page.goto(`${baseUrl}/?debug&dev=0`, { timeout: 300000 });
  await page.waitForFunction(() => window.leaperPlaytest?.playerWeapon, null, { timeout: 300000 });
  let now = await until(page, (s) => s.screen === 'title');
  check(now.flow === 'ready' && now.focus === 'play', 'the game opens on the title screen with PLAY focused');
  await page.waitForTimeout(1500);
  check(!(await page.locator('.dev-toggle, #devPanel').count()) && !(await page.evaluate(() => document.body.contains(document.getElementById('junkyardPanel')))),
    'a player gets no developer tools: no DEV button, no drawer, no old toolbar on the page');
  check(!(await page.locator('.tp-rotv, .tuning-note').count()) && !(await page.evaluate(() => performance.getEntriesByType('resource')
    .some((entry) => /tweakpane|TuningPanel/i.test(entry.name)))), 'no tuning panel either: Tweakpane is never even downloaded');
  check(!(await page.evaluate(() => [...document.querySelectorAll('[aria-live]')].some((element) => element.closest('#junkyardPanel')))),
    'no per-frame readout is a live region');
  check(await page.evaluate(() => !/maximum-scale|user-scalable/.test(document.querySelector('meta[name=viewport]').content)), 'pinch zoom is allowed');
  await frames(page, 2);
  let overlaps = await hudOverlaps(page);
  check(!overlaps.length, `title at 1280 x 720: nothing overlaps (${overlaps.join('; ') || 'clear'})`);

  // 2. The gamepad drives the menu: D-pad down moves to EXPLORE, up back to PLAY;
  //    the keyboard's arrows too. Then the mouse presses PLAY.
  await padPress(page, 13);
  await until(page, (s) => s.focus === 'explore');
  await padPress(page, 12);
  await until(page, (s) => s.focus === 'play');
  check(true, 'the gamepad\'s D-pad moves through the title menu');
  await page.keyboard.press('ArrowDown');
  await until(page, (s) => s.focus === 'explore');
  await page.keyboard.press('ArrowUp');
  await until(page, (s) => s.focus === 'play');
  check(true, 'the arrow keys move through the title menu');
  // SETTINGS opens with A and closes with B, giving focus back to SETTINGS.
  await page.focus('.screen:not([hidden]) [data-menu-item=settings]');
  await padPress(page, 0);
  await until(page, (s) => s.screen === 'settings');
  // The sound system's own AUDIO section replaced the placeholder: a Sound switch and volume sliders.
  const audioRows = await page.evaluate(() => {
    const section = document.querySelector('.screen:not([hidden]) [data-section=audio]');
    return { sliders: section?.querySelectorAll('input[type=range]').length ?? 0, text: section?.textContent ?? '' };
  });
  check(audioRows.sliders >= 4 && /Master volume/.test(audioRows.text),
    `SETTINGS has the sound system's volume sliders (${audioRows.sliders})`);
  await padPress(page, 1);
  now = await until(page, (s) => s.screen === 'title');
  check(now.focus === 'settings', 'A opens SETTINGS, B goes back to the title with SETTINGS focused');
  // CREDITS lists every sound recording from the manifest, with its licence (the M416's CC BY-NC included).
  await page.click('.screen:not([hidden]) [data-menu-item=credits]');
  await until(page, (s) => s.screen === 'credits');
  const credits = await page.evaluate(() => document.querySelector('.screen:not([hidden]) .credits')?.textContent ?? '');
  check(/CC BY-NC 4\.0/.test(credits) && /CC BY 4\.0/.test(credits) && !/not recorded/.test(credits),
    'CREDITS shows the sound licences from the manifest');
  await padPress(page, 1);
  await until(page, (s) => s.screen === 'title');
  await page.click('.screen:not([hidden]) [data-menu-item=play]');
  now = await until(page, (s) => s.flow === 'playing');
  check(now.mode === 'hunt' && now.screen === '', 'PLAY starts the hunt and the menu leaves');
  await page.keyboard.press('Enter');
  await frames(page, 3);
  check((await state(page)).flow === 'playing', 'Enter after PLAY does nothing (no button keeps focus)');
  await settle(page);

  // 3. The HUD: its corners don't overlap, and an idle frame writes nothing.
  await page.locator('#combatHud').waitFor({ state: 'visible', timeout: 120000 });
  await frames(page, 2);
  overlaps = await hudOverlaps(page);
  check(!overlaps.length, `HUD in play at 1280 x 720: nothing overlaps (${overlaps.join('; ') || 'clear'})`);
  // (Measured while paused: nothing moves, so nothing should be written.)
  await page.keyboard.press('Escape');
  now = await until(page, (s) => s.flow === 'paused' && s.screen === 'pause');
  check(!now.locked && now.focus === 'resume', 'Escape pauses: the pause menu opens with RESUME focused and the mouse free');
  // Escape again stays in the pause menu (browsers spend Escape on the mouse).
  await page.keyboard.press('Escape');
  await frames(page, 4);
  check((await state(page)).flow === 'paused', 'a second Escape keeps the pause menu open');
  await frames(page, 2);
  overlaps = await hudOverlaps(page);
  check(!overlaps.length, `pause menu at 1280 x 720: nothing overlaps (${overlaps.join('; ') || 'clear'})`);
  const writes = await page.evaluate(() => new Promise((resolve) => {
    let count = 0;
    const observer = new MutationObserver((records) => {
      count += records.filter((record) => !record.target.closest?.('#leaperHealthHud')).length;
    });
    observer.observe(document.getElementById('hud'), { subtree: true, childList: true, attributes: true, characterData: true });
    let left = 20;
    const next = () => {
      if (--left > 0) { requestAnimationFrame(next); return; }
      observer.disconnect();
      resolve(count);
    };
    requestAnimationFrame(next);
  }));
  check(writes === 0, `the HUD writes nothing to the page over 20 idle frames (${writes} writes)`);

  // 4. RESUME carries on; RESTART (from the pause menu) is a clean retry of the hunt.
  await page.click('.screen:not([hidden]) [data-menu-item=resume]');
  await until(page, (s) => s.flow === 'playing');
  check(true, 'RESUME carries on');
  await settle(page);
  await page.evaluate(() => window.leaperPlaytest.vitals.damage(30));
  await page.keyboard.press('Escape');
  await until(page, (s) => s.flow === 'paused');
  await page.click('.screen:not([hidden]) [data-menu-item=restart]');
  now = await until(page, (s) => s.flow === 'playing');
  check(now.mode === 'hunt' && now.lolaHealth === now.lolaMax, 'RESTART in the pause menu starts the hunt again at full health');
  // The gamepad: Start pauses, B in the pause menu resumes.
  await settle(page);
  await padPress(page, 9);
  await until(page, (s) => s.flow === 'paused');
  await padPress(page, 1);
  await until(page, (s) => s.flow === 'playing');
  check(true, 'the gamepad\'s Start pauses and B resumes from the pause menu');

  // 5. The end screen: a win, with its stats, then RESTART and TITLE.
  await page.evaluate(() => {
    const combat = window.leaperPlaytest.combat;
    combat.damageLeaper(combat.leaperHealth, false, true);
  });
  now = await until(page, (s) => s.flow === 'ended' && s.screen === 'end');
  const end = await page.evaluate(() => ({
    heading: document.querySelector('.screen[data-screen=end] .screen-heading').textContent,
    stats: [...document.querySelectorAll('.end-stats dt')].map((dt) => dt.textContent),
  }));
  check(end.heading === 'VICTORY' && end.stats.join() === 'TIME,DAMAGE DEALT,DAMAGE TAKEN,KNEES BROKEN' && !now.locked,
    'the end screen shows VICTORY with time, damage dealt and taken and knees broken, mouse free');
  await frames(page, 2);
  overlaps = await hudOverlaps(page);
  check(!overlaps.length, `end screen at 1280 x 720: nothing overlaps (${overlaps.join('; ') || 'clear'})`);
  await page.click('.screen:not([hidden]) [data-menu-item=restart]');
  now = await until(page, (s) => s.flow === 'playing');
  check(now.mode === 'hunt' && now.leaperHealth > 0, 'RESTART after the end starts a fresh hunt');
  await settle(page);
  await page.keyboard.press('Escape');
  await until(page, (s) => s.flow === 'paused');
  await page.click('.screen:not([hidden]) [data-menu-item=quit]');
  now = await until(page, (s) => s.screen === 'title');
  check(now.flow === 'ready' && now.focus === 'play', 'QUIT TO TITLE returns to the title screen');

  // 6. With ?dev the developer panel is there: the DEV button opens the old
  //    toolbar and the perf overlay counts frames.
  await page.goto(`${baseUrl}/?debug&dev`, { timeout: 300000 });
  await page.waitForFunction(() => window.leaperPlaytest?.playerWeapon, null, { timeout: 300000 });
  await page.locator('.dev-toggle').waitFor({ state: 'visible', timeout: 120000 });
  await page.click('.dev-toggle');
  await page.locator('#devPanel [data-action=route]').waitFor({ state: 'visible', timeout: 60000 });
  check(await page.locator('#devPanel [data-action=debug-damage]').count() === 1, '?dev: the DEV button opens the old toolbar with every tool');
  await page.check('[data-dev=perf]');
  await page.waitForFunction(() => /\d+ fps/.test(document.querySelector('.dev-perf')?.textContent ?? ''), null, { timeout: 60000 });
  check(true, 'the perf overlay shows frames per second, phases and renderer counters');
  await page.uncheck('[data-dev=perf]');

  // 7. The drawer's live tuning panel (Tweakpane, downloaded on demand): one
  //    folder per config, the brain contract read-only, a change applies to the
  //    game at once, is remembered over a reload, and RESET ALL undoes it.
  const tuning = '#devPanel [data-dev-section=tuning]';
  await page.locator(`${tuning} .tp-rotv`).waitFor({ state: 'visible', timeout: 120000 });
  const folders = await page.$$eval(`${tuning} .tp-fldv_t`, (titles) => titles.map((title) => title.textContent));
  check(['Camera', 'Guns', 'Shooting feel', 'Hit feedback', 'Combat', 'Leaper behaviour'].every((name) => folders.includes(name))
    && folders.includes('BRAIN CONTRACT: eye vision (read-only)') && folders.includes('BRAIN CONTRACT: player contact (read-only)'),
  `?dev: the tuning panel lists every config, the brain contract labelled read-only (${folders.join(', ')})`);
  const brainInputs = await page.evaluate((root) => [...document.querySelectorAll(`${root} .tp-fldv`)]
    .filter((folder) => /^BRAIN CONTRACT/.test(folder.querySelector('.tp-fldv_t')?.textContent ?? ''))
    .map((folder) => ({ editable: folder.querySelectorAll('input:not([readonly]), button:not(.tp-fldv_b)').length, rows: folder.querySelectorAll('.tp-lblv').length })), tuning);
  check(brainInputs.length === 2 && brainInputs.every(({ editable, rows }) => editable === 0 && rows > 0),
    `the brain contract folders show their numbers with nothing editable (${JSON.stringify(brainInputs)})`);
  const gunDamage = () => page.evaluate(() => ({
    damage: window.leaperPlaytest.playerWeapon.states[0].weapon.damage,
    saved: localStorage.getItem('leaper.tuning.v1'),
  }));
  check((await gunDamage()).damage === 2, 'the M416 starts as written (2 damage a bullet)');
  await page.locator(`${tuning} .tp-fldv_t`, { hasText: /^Guns$/ }).click();
  const damageRow = page.locator(`${tuning} .tp-lblv`).filter({ has: page.locator('.tp-lblv_l', { hasText: /^m416\.damage$/ }) });
  const damageInput = damageRow.locator('input.tp-txtv_i');
  await damageInput.fill('3');
  await damageInput.press('Enter');
  await page.waitForFunction(() => window.leaperPlaytest.playerWeapon.states[0].weapon.damage === 3, null, { timeout: 30000 });
  let gun = await gunDamage();
  check(JSON.parse(gun.saved ?? '{}')?.guns?.['m416.damage'] === 3, 'typing 3 into m416.damage changes the running gun at once and saves it in this browser');
  await page.locator(`${tuning} button`, { hasText: /^COPY JSON$/ }).click();
  const copied = await page.locator(`${tuning} textarea.tuning-json`).inputValue();
  check(JSON.parse(copied)?.guns?.['m416.damage'] === 3, 'COPY JSON gives the changed values');
  await page.reload({ timeout: 300000 });
  await page.waitForFunction(() => window.leaperPlaytest?.playerWeapon, null, { timeout: 300000 });
  check((await gunDamage()).damage === 3, 'after a reload the saved change is back');
  await page.locator(`${tuning} button`, { hasText: /^RESET ALL$/ }).waitFor({ state: 'visible', timeout: 120000 });
  await page.locator(`${tuning} button`, { hasText: /^RESET ALL$/ }).click();
  gun = await gunDamage();
  check(gun.damage === 2 && gun.saved === null, 'RESET ALL puts the gun back as written and forgets the saved change');
  await page.click('.dev-toggle');
  return 'Game flow (title, pause, end, dev panel, tuning, HUD layout)';
}
