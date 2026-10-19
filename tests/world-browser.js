// Browser checks for the world track: the real junkyard as the game loads it,
// fast map rays, region labels for RESTART RANDOM and SHOW CLEARANCE, and the
// size slider's maximum. Run with `pnpm test:browser` (headless Chromium).
import { createScene } from '../src/core/createScene.js';
import { createJunkyardWorld } from '../src/world/createJunkyardWorld.js';
import { randomJunkyardStart } from '../src/world/randomJunkyardStart.js';
import { ClearanceOverlay } from '../src/game/ClearanceOverlay.js';
import { JunkyardPanel } from '../src/game/JunkyardPanel.js';
import metrics from '../assets/maps/junkyard/metrics.json' with { type: 'json' };

const result = document.querySelector('#results');
let passed = 0;
function check(condition, label) {
  if (!condition) throw new Error(label);
  passed += 1;
  result.textContent += `\nPASS ${label}`;
}

try {
  // 1. The real map, exactly as the game builds it.
  const engine = createScene(document.querySelector('#app'));
  const world = await createJunkyardWorld(engine.scene);
  result.textContent = 'WORLD AND LOADING CHECKS';
  let meshes = 0, accelerated = 0;
  world.map.traverse((object) => {
    if (!object.isMesh) return;
    meshes += 1;
    if (object.geometry.boundsTree) accelerated += 1;
  });
  check(meshes > 50 && accelerated === meshes, `every map mesh has a ray hierarchy (${accelerated}/${meshes})`);

  // 2. Regions were labelled at load; RESTART RANDOM picks from them quickly.
  const nav = world.navigation;
  check(nav.regions?.count > 0 && nav.spawnable, 'the Leaper grid arrives with region labels and spawn cells');
  let previous = world.spawn, slowest = 0, found = 0;
  for (let i = 0; i < 20; i += 1) {
    const started = performance.now();
    const pick = randomJunkyardStart(world, previous);
    slowest = Math.max(slowest, performance.now() - started);
    if (pick) { found += 1; previous = pick.position; }
  }
  check(found === 20, `RESTART RANDOM finds a pair 20 of 20 times at width ${world.width}`);
  check(slowest < 50, `each RESTART RANDOM pick takes under 50 ms (slowest ${slowest.toFixed(1)} ms)`);

  // 3. SHOW CLEARANCE paints from the same labels, without a fresh flood fill.
  const overlay = new ClearanceOverlay({ scene: engine.scene, world });
  const started = performance.now();
  const summary = overlay.rebuild(world.spawn);
  const rebuildMs = performance.now() - started;
  check(/Reachable from spawn: \d+%/.test(summary), `the overlay reports reachability (${summary})`);
  check(rebuildMs < 50, `the overlay rebuilds in under 50 ms (${rebuildMs.toFixed(1)} ms)`);
  overlay.dispose();

  // 4. The size slider stops at the largest workable width.
  const panel = new JunkyardPanel({ world });
  check(Number(panel.size.max) === metrics.maxWorkableWidth && world.maxWidth === metrics.maxWorkableWidth,
    `the size slider maximum is the largest workable width (${panel.size.max})`);
  panel.dispose();

  // 5. Clean up: the map leaves the scene and its ray hierarchies are freed.
  world.dispose();
  let left = 0;
  world.map.traverse((object) => { if (object.isMesh && object.geometry.boundsTree) left += 1; });
  check(left === 0 && !engine.scene.children.includes(world.map), 'dispose() removes the map and frees its hierarchies');

  result.textContent += `\nALL ${passed} CHECKS PASSED`;
  document.title = `PASS ${passed} · World and loading`;
} catch (error) {
  result.textContent += `\nFAIL ${error.message}`;
  document.title = `FAIL · ${error.message}`;
  console.error(error);
}
