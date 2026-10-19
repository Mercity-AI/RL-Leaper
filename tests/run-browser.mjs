// Runs the browser test pages headless and fails loudly (`pnpm test:browser`).
//
// Starts Vite through its JavaScript API on a free port, opens each page in
// headless Chromium with software WebGL, and waits for the page to set its title
// to "PASS ..." or "FAIL ...". Exits non-zero on a FAIL title, a timeout, or any
// uncaught error on the page. A test can also be a Playwright script
// (tests/*.browser.mjs) that drives the real game with trusted input, on an
// emulated device such as a phone.
//
// Usage: node tests/run-browser.mjs [tests/page.html | tests/script.browser.mjs ...]   (default: all)
//   BROWSER_TEST_TIMEOUT=600  seconds allowed per page (default 300; software
//                             rendering is slow on machines without a GPU)
//   BROWSER_TEST_PORT=5210    use this port instead of a free one
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { chromium, devices } from 'playwright';
import { createServer } from 'vite';

// --- Settings -------------------------------------------------------------------
// Every page that reports PASS/FAIL in its title, and every scripted test with
// the device it runs on. Demos live in demos/ instead.
const PAGES = ['tests/browser-combat.html', 'tests/camera-player.html', 'tests/brain-onnx.html', 'tests/brain-game.html',
  'tests/world-browser.html', 'tests/world-render.html', 'tests/world-visual.html'];
const SCRIPTS = [
  { path: 'tests/game-controls.browser.mjs' },
  { path: 'tests/touch-controls.browser.mjs', device: 'Pixel 7' },
  { path: 'tests/game-flow.browser.mjs' },
  { path: 'tests/hud-layout.browser.mjs', device: 'Pixel 7', viewport: { width: 412, height: 839 } },
];
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TIMEOUT_SECONDS = Number(process.env.BROWSER_TEST_TIMEOUT || 300);
// SwiftShader is Chrome's software WebGL, so the pages also run on CI machines.
const CHROMIUM_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];

// Ask the operating system for a port nobody is using right now.
function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

// --- One page -------------------------------------------------------------------
// Open a page, wait for its verdict, and collect anything that went wrong.
async function runPage(browser, baseUrl, path) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  const started = Date.now();
  let timedOut = false;
  try {
    // Loading gets the same allowance as the verdict wait: on a slow CI machine
    // the page's modules alone can take longer than Playwright's default 30 s.
    await page.goto(`${baseUrl}/${path}`, { timeout: TIMEOUT_SECONDS * 1000 });
    await page.waitForFunction(() => /^(PASS|FAIL)/.test(document.title), null,
      { timeout: TIMEOUT_SECONDS * 1000 });
  } catch (error) {
    timedOut = true;
    pageErrors.push(`no PASS/FAIL title after ${TIMEOUT_SECONDS} s (${error.message.split('\n')[0]})`);
  }
  const title = await page.title().catch(() => '');
  const results = await page.$eval('#results', (element) => element.textContent).catch(() => '');
  await page.close();
  const passed = !timedOut && title.startsWith('PASS') && pageErrors.length === 0;
  return { path, passed, title, results, pageErrors, consoleErrors, seconds: (Date.now() - started) / 1000 };
}

// --- One scripted test -------------------------------------------------------------
// The script's default export drives a page opened on its device (optionally at
// another window size) and calls check(condition, label) for every check; a
// failed check throws.
async function runScript(browser, baseUrl, { path, device, viewport }) {
  const base = device ? devices[device] : { viewport: { width: 1280, height: 720 } };
  const context = await browser.newContext(viewport ? { ...base, viewport } : base);
  const page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  const started = Date.now();
  const lines = [];
  let title;
  let passed = false;
  try {
    const { default: run } = await import(new URL(`../${path}`, import.meta.url).href);
    const check = (condition, label) => {
      if (!condition) throw new Error(label);
      lines.push(`PASS ${label}`);
    };
    const name = await run(page, { baseUrl, check });
    title = `PASS ${lines.length} · ${name}${device ? ` · ${device}` : ''}${viewport ? ` ${viewport.width} x ${viewport.height}` : ''}`;
    passed = pageErrors.length === 0;
  } catch (error) {
    title = `FAIL · ${path}`;
    lines.push(`FAIL ${error.message.split('\n')[0]}`);
  }
  await context.close();
  return { path, passed, title, results: lines.join('\n'), pageErrors, consoleErrors, seconds: (Date.now() - started) / 1000 };
}

// Print one page's verdict, the last result lines and any errors.
function report(result) {
  console.log(`${result.passed ? 'PASS' : 'FAIL'} ${result.path} (${result.seconds.toFixed(1)} s)`);
  console.log(`  title: ${result.title || '(none)'}`);
  const lines = result.results.trim().split('\n').filter(Boolean);
  const shown = result.passed ? lines.slice(-2) : lines.slice(-8);
  for (const line of shown) console.log(`  ${line}`);
  for (const error of result.pageErrors) console.log(`  page error: ${error}`);
  for (const error of result.consoleErrors.slice(0, 5)) console.log(`  console error: ${error}`);
}

// --- Run everything -------------------------------------------------------------
const chosen = process.argv.slice(2);
const pages = chosen.length ? chosen.filter((path) => path.endsWith('.html')) : PAGES;
const scripts = chosen.length
  ? chosen.filter((path) => path.endsWith('.mjs')).map((path) => SCRIPTS.find((item) => item.path === path) ?? { path })
  : SCRIPTS;
const port = Number(process.env.BROWSER_TEST_PORT) || await freePort();
const server = await createServer({
  root: ROOT,
  logLevel: 'warn',
  server: { host: '127.0.0.1', port, strictPort: true },
});
let browser;
let failures = 0;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, args: CHROMIUM_ARGS });
  // One page at a time: software rendering is slow, and the pages must not compete.
  for (const path of pages) {
    const result = await runPage(browser, `http://127.0.0.1:${port}`, path);
    report(result);
    if (!result.passed) failures += 1;
  }
  for (const script of scripts) {
    const result = await runScript(browser, `http://127.0.0.1:${port}`, script);
    report(result);
    if (!result.passed) failures += 1;
  }
} finally {
  await browser?.close();
  await server.close();
}
const total = pages.length + scripts.length;
console.log(failures ? `${failures} of ${total} browser tests FAILED` : `All ${total} browser tests passed`);
process.exitCode = failures ? 1 : 0;
