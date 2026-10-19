// The real game page (index.html, the junkyard) in an iframe, with the default
// in-browser (ONNX) brain and NO Python server: the brain-server address points
// at a closed port, so falling back to it would fail. After START RUN the
// Leaper must take brain steps, change its pose and fire at Lola. Last, the
// game at another Leaper size: the worker builds that size's collision map
// (with progress) instead of the page.
// The title becomes "PASS ..." or "FAIL ..." for headless runs (tests/run-browser.mjs).

const results = document.querySelector('#results');
const frame = document.querySelector('iframe');
let passed = 0;
const say = (text) => { results.textContent += `\n${text}`; };
function check(condition, label) {
  if (!condition) throw new Error(label);
  passed += 1;
  say(`PASS ${label}`);
}

// Wait until `test()` is truthy (checked every 250 ms), or fail after `seconds`.
async function until(test, seconds, what) {
  const started = performance.now();
  for (;;) {
    const value = test();
    if (value) return value;
    if (performance.now() - started > seconds * 1000) throw new Error(`timed out after ${seconds} s waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

// Browsers refuse port 9 outright, so no brain server can ever answer here
// (its "Failed to load resource" console line in step 6 is expected).
const DEAD_SERVER = 'http://127.0.0.1:9';

try {
  results.textContent = 'GAME WITH THE IN-BROWSER BRAIN (no Python server)';
  // 1. Boot the game itself, collecting any error inside it.
  const errors = [];
  frame.src = `/?debug&width=5.5&brainUrl=${encodeURIComponent(DEAD_SERVER)}`;
  await new Promise((resolve) => frame.addEventListener('load', resolve, { once: true }));
  const win = frame.contentWindow;
  win.addEventListener('error', (event) => errors.push(event.message));
  win.addEventListener('unhandledrejection', (event) => errors.push(String(event.reason?.message ?? event.reason)));

  // 2. The brain loads in the page: ONNX, its badge, its tooltip, the baked raster.
  const brain = await until(() => win.leaperPlaytest?.brain, 180, 'the game to start');
  await until(() => brain.ready || brain.offline, 180, 'the brain to load');
  check(brain.ready && brain.provider.kind === 'onnx', 'the in-browser (ONNX) brain loaded without a Python server');
  const badge = win.document.querySelector('.brain-state');
  await until(() => /^BRAIN 7,757,824 · ONNX · IN BROWSER · /.test(badge.textContent), 30, 'the badge');
  check(true, `the badge names the provider: "${badge.textContent}"`);
  check(/^ONNX · in browser/.test(badge.title) && /policy SHA256 883dade3/.test(badge.title), 'its tooltip names the provider and the policy');
  check(brain.provider.active.lastWorld?.source === 'baked', 'the default Leaper size uses the baked collision raster');

  // 3. Lola straight ahead of the Leaper (a known clear lane), then START RUN.
  const p = win.leaperPlaytest;
  const state = p.simulation.state;
  p.encounter.placePlayer({ x: state.position.x, z: state.position.z + 7 * p.world.scale });
  const start = { x: state.position.x, z: state.position.z, yaw: state.yaw, step: brain.frame.step ?? 0 };
  win.document.querySelector('[data-action=route]').click();
  check(p.walking, 'START RUN starts the hunt');

  // 4. The Leaper hunts: brain steps advance, its pose changes, and it fires.
  const moved = () => Math.hypot(state.position.x - start.x, state.position.z - start.z);
  await until(() => brain.frame.step >= start.step + 15 && moved() > 0.5, 240, 'brain steps and movement');
  check(true, `brain steps advance (${brain.frame.step} steps, ${moved().toFixed(2)} units moved)`);
  check(brain.provider.active.stats.requests >= 15, `every move came from the worker (${brain.provider.active.stats.requests} requests)`);
  await until(() => p.combat.tree.shots >= 1, 240, 'the Leaper to fire');
  check(true, `the Leaper fires at Lola (${p.combat.tree.shots} bolt${p.combat.tree.shots === 1 ? '' : 's'})`);

  // 5. Nothing went to the brain-server address, and nothing broke.
  const serverHits = win.performance.getEntriesByType('resource').filter((entry) => entry.name.startsWith(DEAD_SERVER));
  check(serverHits.length === 0, 'no request ever went to a brain server');
  check(errors.length === 0, `no errors in the game (${errors.join(' | ') || 'none'})`);

  // 6. The OPTIONS brain menu: the Python server (not running here) leaves the
  //    run in turret mode; back to the browser brain, it hunts again.
  const menu = win.document.querySelector('[data-brain-provider]');
  const pick = (value) => {
    menu.value = value;
    menu.dispatchEvent(new win.Event('change'));
  };
  pick('http');
  check(new win.URL(win.location.href).searchParams.get('brain') === 'http', 'the menu choice is kept in the page address');
  await until(() => p.brain.offline, 60, 'the missing Python server to be noticed');
  win.document.querySelector('[data-action=route]').click();
  await until(() => badge.textContent === 'BRAIN OFFLINE · TURRET MODE', 30, 'turret mode');
  check(/no brain service at http:\/\/127\.0\.0\.1:9/.test(badge.title), 'turret mode, and the tooltip says why');
  // "No brain" on purpose (to test turret mode): kept in the address too.
  pick('turret');
  check(new win.URL(win.location.href).searchParams.get('brain') === 'turret' && menu.value === 'turret',
    'the menu can pick turret mode on purpose (?brain=turret)');
  await until(() => p.brain.offline && /no brain selected/.test(badge.title), 30, 'turret mode on purpose');
  check(true, 'no brain loads, and the tooltip says it was chosen');
  pick('auto');
  await until(() => p.brain.ready && p.brain.provider.kind === 'onnx', 120, 'the browser brain again');
  check(!new win.URL(win.location.href).searchParams.has('brain'), 'back to the browser brain (address cleared)');
  check(errors.length === 0, `still no errors (${errors.join(' | ') || 'none'})`);

  // 7. Another Leaper size (APPLY SIZE reloads the page at ?width=): no baked
  //    raster exists for it, so the worker builds it, and its progress reaches
  //    the loading line or the badge.
  const shown = [];
  frame.src = `/?debug&width=6.5&brainUrl=${encodeURIComponent(DEAD_SERVER)}`;
  // Watch every text change on the new page from as early as it exists (the
  // raster is only built after the map has loaded, seconds later).
  const oldDocument = win.document;
  const doc = await until(() => {
    const current = frame.contentDocument;
    return current && current !== oldDocument && current.body ? current : null;
  }, 120, 'the page at the new size');
  const sizedErrors = [];
  frame.contentWindow.addEventListener('error', (event) => sizedErrors.push(event.message));
  frame.contentWindow.addEventListener('unhandledrejection', (event) => sizedErrors.push(String(event.reason?.message ?? event.reason)));
  // The loading line (#status) and the brain badge, read as text even while hidden.
  new frame.contentWindow.MutationObserver(() => {
    for (const element of [doc.getElementById('status'), doc.querySelector('.brain-state')]) {
      const text = element?.textContent ?? '';
      if (/PREPARING LEAPER SIZE 6\.5/.test(text)) shown.push(text.trim());
    }
  }).observe(doc.documentElement, { subtree: true, childList: true, characterData: true });
  const sized = await until(() => frame.contentWindow.leaperPlaytest?.brain, 180, 'the game at size 6.5');
  await until(() => sized.ready || sized.offline, 180, 'the brain at size 6.5');
  const world = sized.provider.active?.lastWorld;
  check(sized.ready && world?.width === 6.5 && world.source === 'built',
    `size 6.5: the worker built its collision map (${world?.source}, ${Math.round(world?.rasterMs ?? 0)} ms)`);
  // The badge is redrawn once per frame, so a slow (software-rendered) page may
  // only catch one or two of the build's progress lines; any one proves it shows.
  check(shown.some((line) => /ONNX · IN BROWSER · \d+% · /.test(line)),
    `the loading UI showed that size's progress ("${shown.at(-1) ?? 'none'}")`);

  // 8. The same build, measured directly (independent of the frame rate): a
  //    size the worker has not seen yet, with the progress events the page
  //    receives while it builds and the page's own timers still ticking.
  const events = [];
  const off = sized.provider.onProgress((event) => events.push(event));
  let ticks = 0;
  let building = true;
  const tick = () => {
    if (!building) return;
    ticks += 1;
    frame.contentWindow.setTimeout(tick, 0);
  };
  tick();
  await sized.provider.prepare(7);
  building = false;
  off();
  const raster = events.filter((event) => event.task === 'world' && event.width === 7 && event.stage === 'raster');
  const builtSeven = sized.provider.active.lastWorld;
  check(builtSeven?.width === 7 && builtSeven.source === 'built', `size 7.0 built in the worker too (${Math.round(builtSeven?.rasterMs ?? 0)} ms)`);
  // The worker posts at most one update per 40 ms per stage (plus the stage's
  // start and end), so a quick build sends only a few.
  check(raster.length >= 2 && raster.at(-1).fraction > raster[0].fraction,
    `the page received the build's progress (${raster.length} raster updates, ${Math.round(raster[0]?.fraction * 100)}% -> ${Math.round(raster.at(-1)?.fraction * 100)}%)`);
  check(ticks >= 2, `the page kept running while the worker built it (${ticks} timer ticks meanwhile)`);
  check(sizedErrors.length === 0, `no errors at the new sizes (${sizedErrors.join(' | ') || 'none'})`);

  say(`\nALL ${passed} CHECKS PASSED`);
  document.title = `PASS ${passed} · Game with the in-browser brain`;
} catch (error) {
  say(`\nFAIL ${error.message}`);
  document.title = `FAIL · ${error.message}`;
}
