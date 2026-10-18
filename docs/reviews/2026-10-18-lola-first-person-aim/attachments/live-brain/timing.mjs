// Time each brain request the real game makes (browser -> 127.0.0.1:8767) and the frame rate.
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const timings = [];
page.on('requestfinished', async (r) => {
  if (!r.url().includes(':8767/')) return;
  const t = r.timing();
  timings.push({ path: new URL(r.url()).pathname, ms: t.responseEnd, bytes: (r.postData() || '').length });
});
await page.goto('http://127.0.0.1:5173/?map=junkyard&debug');
await page.waitForFunction(() => window.leaperPlaytest?.brain?.ready, null, { timeout: 120000 });
const mode = process.argv[2] || 'eye';
if (mode === 'legacy') {
  await page.selectOption('[data-sight-mode]', 'legacy');
  await page.waitForFunction(() => window.leaperPlaytest?.brain?.ready, null, { timeout: 120000 });
}
await page.click('[data-action=route]');
const fps = await page.evaluate(() => new Promise((resolve) => {
  let n = 0; const s = performance.now();
  const tick = () => { n += 1; if (performance.now() - s < 20000) requestAnimationFrame(tick); else resolve(n / 20); };
  requestAnimationFrame(tick);
}));
const step = timings.filter((t) => t.path === '/step').map((t) => t.ms).sort((a, b) => a - b);
const pct = (q) => step[Math.min(step.length - 1, Math.floor(q * step.length))]?.toFixed(0);
console.log(JSON.stringify({ mode, fps: fps.toFixed(1), steps: step.length, stepMs: { p50: pct(0.5), p90: pct(0.9), max: pct(0.999) },
  paths: [...new Set(timings.map((t) => t.path))], payloadBytes: timings.find((t) => t.path === '/step')?.bytes }, null, 2));
await browser.close();
