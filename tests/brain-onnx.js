// Browser check of the Python-free Leaper brain (serve with Vite, open
// tests/brain-onnx.html). It runs the real OnnxBrainProvider (Web Worker,
// self-hosted onnxruntime wasm, baked raster, real junkyard GLB) for 300 steps
// from a Python recording and compares every frame, then repeats the exact
// teacher-forced comparison in this page's own JavaScript engine.
// The title becomes "PASS ..." or "FAIL ..." for headless runs.
import contact from '../src/config/player-contact.json' with { type: 'json' };
import eyeVision from '../src/config/eye-vision.json' with { type: 'json' };
import { OnnxBrainProvider, defaultBrainBaseUrl } from '../src/brain/junkyard/OnnxBrainProvider.js';
import { JunkyardRaster } from '../src/brain/junkyard/collisionRaster.js';
import { loadGlbTriangles } from '../src/brain/junkyard/junkyardSight.js';
import { createJunkyardWorld } from '../src/brain/junkyard/junkyardWorld.js';
import { frameDifferences, teacherForced } from '../src/brain/junkyard/fixtureReplay.js';

const STEPS = 300;
const FIXTURE = 'eye-5.5-hide-seek';
const results = document.querySelector('#results');
let passed = 0;
const say = (text) => { results.textContent += `\n${text}`; };
function check(condition, label) {
  if (!condition) throw new Error(label);
  passed += 1;
  say(`PASS ${label}`);
}
const bytes = async (url) => new Uint8Array(await (await fetch(url)).arrayBuffer());

try {
  results.textContent = 'BROWSER BRAIN PARITY (OnnxBrainProvider vs the Python server recording)';
  const fixture = await (await fetch(new URL(`./fixtures/brain/${FIXTURE}.json`, import.meta.url))).json();

  // --- 1. The real provider: worker + ONNX + baked raster, free running -------------
  const provider = new OnnxBrainProvider();
  let started = performance.now();
  const manifest = await provider.load();
  const loadMs = performance.now() - started;
  check(manifest.num_timesteps === 7757824 && manifest.obs_size === 34, 'worker loaded brain.json for checkpoint 7,757,824');
  check(provider.loadInfo.modelVerified, 'actor.onnx SHA256 verified against brain.json in the worker');

  started = performance.now();
  const resetFrame = await provider.reset(fixture.reset);
  const resetMs = performance.now() - started;
  check(typeof resetFrame.token === 'string' && resetFrame.policy_sha256 === manifest.policy_sha256, 'reset returns a session token and the policy SHA256');
  const first = frameDifferences(resetFrame, fixture.initial.frame);
  check(first.discrete.length === 0 && first.numbers.pose === 0, 'reset frame matches the Python server exactly');
  const world = provider.lastWorld;
  check(world?.source === 'baked', `default size loads the baked raster (${world?.rasterMs.toFixed(1)} ms raster, ${world?.sightMs.toFixed(0)} ms sight grid)`);

  // Same frame keys as the HTTP server, nothing missing or extra.
  check(JSON.stringify(Object.keys(resetFrame).sort()) === JSON.stringify([...Object.keys(fixture.initial.frame), 'token', 'policy_sha256'].sort()),
    'frames have exactly the HTTP server\'s fields');

  let lockstep = 0, untilFlip = 0, inLockstep = true, senses = 0, firstFlip = '';
  const stepTimes = [];
  for (let k = 0; k < STEPS; k += 1) {
    const step = fixture.steps[k];
    const t0 = performance.now();
    const frame = await provider.step({ token: resetFrame.token, ...step.input });
    stepTimes.push(performance.now() - t0);
    const { discrete, numbers } = frameDifferences(frame, step.frame);
    if (discrete.length) {
      firstFlip = `step ${k}: ${discrete[0]}`;
      break;
    }
    if (numbers.pose > 1e-3) inLockstep = false;
    if (inLockstep) lockstep = k + 1;
    untilFlip = k + 1;
    for (const probe of fixture.senses.filter((p) => p.after === k)) {
      const preview = await provider.sense({ token: resetFrame.token, ...probe.input });
      if (inLockstep) {
        const diff = frameDifferences(preview, probe.frame);
        check(diff.discrete.length === 0 && diff.numbers.pose <= 1e-3, `paused /sense preview after step ${k} matches`);
        senses += 1;
      }
    }
  }
  stepTimes.sort((a, b) => a - b);
  const mean = stepTimes.reduce((a, b) => a + b, 0) / stepTimes.length;
  say(`worker free run: lockstep (pose < 1e-3) ${lockstep}/${STEPS}, identical collisions/sightings/memory ${untilFlip}/${STEPS}${firstFlip ? ` (first difference ${firstFlip})` : ''}`);
  say(`timing: load ${loadMs.toFixed(0)} ms (worker ${provider.loadInfo.loadMs.toFixed(0)} ms), first reset ${resetMs.toFixed(0)} ms, `
    + `step round trip mean ${mean.toFixed(2)} ms, median ${stepTimes[stepTimes.length >> 1].toFixed(2)} ms, max ${stepTimes.at(-1).toFixed(2)} ms, `
    + `last worker step ${provider.stats.workerMs.toFixed(2)} ms`);
  check(lockstep >= 100, 'ONNX worker run stays in lockstep with Python for at least 100 steps');
  check(untilFlip >= 150, 'every collision, sighting and memory event matches Python for at least 150 steps');
  check(senses > 0, 'sense previews were compared');
  const errors = await provider.step({ token: 'missing', target: [0, 0] }).catch((error) => error.message);
  check(/Session expired/.test(errors), 'unknown tokens fail like the server ("Session expired")');
  const bad = await provider.reset({ ...fixture.reset, width: 9 }).catch((error) => error.message);
  check(/Invalid robot size/.test(bad), 'out-of-range sizes are refused like the server');

  // A size with no baked raster: the worker downloads collision.json and builds it.
  const small = await (await fetch(new URL('./fixtures/brain/eye-2.9-search.json', import.meta.url))).json();
  started = performance.now();
  const smallReset = await provider.reset(small.reset);
  const smallMs = performance.now() - started;
  const smallWorld = provider.lastWorld;
  const smallDiff = frameDifferences(smallReset, small.initial.frame);
  check(smallWorld?.source === 'built' && smallDiff.discrete.length === 0 && smallDiff.numbers.pose === 0,
    `width 2.9 builds its raster in the worker (${smallWorld?.rasterMs.toFixed(0)} ms incl. download, reset ${smallMs.toFixed(0)} ms) and matches Python`);
  let smallLockstep = 0;
  for (let k = 0; k < 40; k += 1) {
    const frame = await provider.step({ token: smallReset.token, ...small.steps[k].input });
    const diff = frameDifferences(frame, small.steps[k].frame);
    if (diff.discrete.length || diff.numbers.pose > 1e-3) break;
    smallLockstep = k + 1;
  }
  check(smallLockstep === 40, 'width 2.9 worker run matches Python for 40 steps');
  provider.dispose();

  // --- 2. Exact teacher-forced replay in this page's JavaScript engine -------------------
  started = performance.now();
  const glbTriangles = loadGlbTriangles(await bytes(new URL('../assets/maps/junkyard/junkyard.glb', import.meta.url)));
  const baked = JunkyardRaster.decode(await bytes(new URL('raster-5.5.bin', defaultBrainBaseUrl())));
  const bakedMs = performance.now() - started;
  const collision = await (await fetch(new URL('../assets/maps/junkyard/collision.json', import.meta.url))).json();
  started = performance.now();
  const built = JunkyardRaster.build(collision, 5.5);
  const buildMs = performance.now() - started;
  check(built.solid.every((v, i) => v === baked.raster.solid[i]), `browser-built raster equals the baked one (build ${buildMs.toFixed(0)} ms vs GLB + baked load ${bakedMs.toFixed(0)} ms)`);
  const inPage = createJunkyardWorld({ width: 5.5, glbTriangles, baked });
  const short = { ...fixture, steps: fixture.steps.slice(0, STEPS), senses: fixture.senses.filter((p) => p.after < STEPS) };
  const report = await teacherForced(short, inPage, { contact, eyeVision });
  say(`teacher-forced in page: ${report.steps} steps, obs max ${report.obsIn}/${report.obsOut}, pose max ${report.pose}, flips ${report.flips}, `
    + `${report.msPerStep.toFixed(2)} ms/step (env only, main thread)`);
  report.problems.forEach((problem) => say(`  ${problem}`));
  check(report.problems.length === 0 && report.flips === 0 && report.pose === 0, 'teacher-forced: 34 inputs, pose and every yes/no fact match Python exactly');

  document.title = `PASS ${passed} · Leaper browser brain parity`;
  say(`\nALL ${passed} CHECKS PASSED`);
} catch (error) {
  document.title = `FAIL · ${error.message}`;
  say(`FAIL ${error.message}\n${error.stack ?? ''}`);
}
