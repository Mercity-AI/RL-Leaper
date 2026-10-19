// Browser checks for the world track: the real junkyard as the game loads it,
// fast map rays, region labels for RESTART RANDOM and SHOW CLEARANCE, and the
// size slider's maximum. Run with `pnpm test:browser` (headless Chromium).
import { createScene } from '../src/core/createScene.js';
import { Assets, MAP_URL, loadLolaFiles } from '../src/core/Assets.js';
import { LolaPlayer } from '../src/robot/LolaPlayer.js';
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
  // 1. The real map and Lola, loaded the way the game loads them: one loader
  //    with a progress bar, compressed files, map and Lola side by side.
  const engine = createScene(document.querySelector('#app'));
  const assets = new Assets({ title: 'LOADING TEST' });
  const loadingBar = document.querySelector('.leaper-loading');
  const [world, lola] = await Promise.all([createJunkyardWorld(engine.scene, { assets }), loadLolaFiles(assets)]);
  result.textContent = 'WORLD AND LOADING CHECKS';
  check(loadingBar && Number(loadingBar.querySelector('[role=progressbar]').getAttribute('aria-valuenow')) === 100,
    'the loading bar reaches 100% when everything is in');
  assets.done();
  check(loadingBar.classList.contains('done'), 'the loading bar fades out when the game is ready');
  const requested = performance.getEntriesByType('resource').map(entry => entry.name);
  check(requested.some(name => name.includes('/assets/build/maps/')) && !requested.some(name => /maps\/junkyard\/junkyard\.glb/.test(name)),
    `the compressed map is downloaded, not the source (${MAP_URL.split('/').pop()})`);
  check(world.collisionBuiltBy === 'worker', 'the collision grids are built in a worker thread');
  check(lola.models.length === 2 && lola.jumps.length === 2 && lola.reloads.length === 2 && Object.keys(lola.runJumps).length === 4,
    'all 14 compressed Lola files load (WebP textures and meshopt geometry decode)');
  const target = new LolaPlayer(engine.scene, world, document.createElement('button'), lola.models, lola.jumps, lola.reloads, lola.runJumps);
  const textures = new Set(), names = new Map();
  target.mesh.traverse((object) => {
    if (object.material?.map) {
      textures.add(object.material.map);
      names.set(object.material.map.name, (names.get(object.material.map.name) ?? 0) + 1);
    }
  });
  check(textures.size === new Set([...textures].map(texture => texture.name)).size,
    `Lola shares one texture per picture across her files (${textures.size} textures)`);
  check(target.outfits.length === 2 && target.outfits.every(outfit => outfit.actions.Run && outfit.actions.Idle),
    'Lola is built from the compressed files with her clips');
  engine.scene.remove(target.mesh);
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
