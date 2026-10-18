// Live brain-driven fight in headless Chromium: does the Leaper search, chase and shoot?
import { chromium } from 'playwright';

const URL = process.argv[2] || 'http://127.0.0.1:5173/?map=junkyard&debug';
const SECONDS = Number(process.argv[3] || 90);
const OUT = process.argv[4] || '.';
const RANDOM = process.argv.includes('--random');

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const logs = [];
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(`${m.type()}: ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
let brainRequests = 0;
page.on('request', (r) => { if (r.url().includes(':8767/')) brainRequests += 1; });

const t0 = Date.now();
await page.goto(URL);
await page.waitForFunction(() => window.leaperPlaytest?.brain, null, { timeout: 120000 });
await page.waitForFunction(() => window.leaperPlaytest.brain.ready, null, { timeout: 120000 });
console.log(`brain ready after ${((Date.now() - t0) / 1000).toFixed(1)} s`);

await page.click(RANDOM ? '[data-action=random]' : '[data-action=route]');
await page.waitForTimeout(500);

const samples = [];
const start = Date.now();
while ((Date.now() - start) / 1000 < SECONDS) {
  samples.push(await page.evaluate(() => {
    const p = window.leaperPlaytest;
    const s = p.simulation.state, l = p.target.mesh.position, f = p.brain.frame || {};
    return {
      t: performance.now() / 1000,
      lx: s.position.x, lz: s.position.z, yaw: s.yaw, serverYaw: f.yaw,
      px: l.x, pz: l.z, dist: Math.hypot(s.position.x - l.x, s.position.z - l.z),
      step: f.step || 0, visible: !!f.target_visible, seen: !!f.target_ever_seen, collision: !!f.collision,
      label: p.brainLabel.textContent, attack: p.combat.tree.state, shots: p.combat.tree.shots,
      lolaHp: p.combat.lolaHealth, leaperHp: p.combat.leaperHealth, dead: !!p.combat.dead,
      running: p.brain.running, walking: p.walking,
    };
  }));
  await page.waitForTimeout(250);
}
await page.screenshot({ path: `${OUT}/fight-end.png` });
const info = await page.evaluate(() => {
  const r = window.leaperPlaytest.engine.renderer.info;
  return { calls: r.render.calls, triangles: r.render.triangles, geometries: r.memory.geometries, textures: r.memory.textures };
});

const first = samples[0], last = samples.at(-1);
let travelled = 0, maxYawJump = 0, maxServerYaw = 0, minServerYaw = 0;
for (let i = 1; i < samples.length; i += 1) {
  const a = samples[i - 1], b = samples[i];
  travelled += Math.hypot(b.lx - a.lx, b.lz - a.lz);
  maxYawJump = Math.max(maxYawJump, Math.abs(b.yaw - a.yaw));
  if (typeof b.serverYaw === 'number') { maxServerYaw = Math.max(maxServerYaw, b.serverYaw); minServerYaw = Math.min(minServerYaw, b.serverYaw); }
}
const firstVisible = samples.find((s) => s.visible);
const firstHit = samples.find((s) => s.lolaHp < first.lolaHp);
console.log(JSON.stringify({
  seconds: SECONDS, samples: samples.length, brainRequests,
  policyStepsStart: first.step, policyStepsEnd: last.step,
  policyStepsPerSecond: ((last.step - first.step) / (last.t - first.t)).toFixed(2),
  leaperTravelled: travelled.toFixed(2), startDistance: first.dist.toFixed(2), endDistance: last.dist.toFixed(2),
  minDistance: Math.min(...samples.map((s) => s.dist)).toFixed(2),
  firstSawLolaAfter: firstVisible ? (firstVisible.t - first.t).toFixed(1) : null,
  visibleFraction: (samples.filter((s) => s.visible).length / samples.length).toFixed(2),
  collisionFraction: (samples.filter((s) => s.collision).length / samples.length).toFixed(2),
  boltsFired: last.shots, firstDamageAfter: firstHit ? (firstHit.t - first.t).toFixed(1) : null,
  lolaHp: [first.lolaHp, last.lolaHp], leaperHp: [first.leaperHp, last.leaperHp], dead: last.dead,
  attackStates: [...new Set(samples.map((s) => s.attack))],
  labels: [...new Set(samples.map((s) => s.label))].slice(0, 8),
  serverYawRange: [minServerYaw.toFixed(2), maxServerYaw.toFixed(2)], maxRenderedYawJumpPerSample: maxYawJump.toFixed(2),
  renderer: info, consoleIssues: logs.slice(0, 15),
}, null, 2));
await browser.close();
