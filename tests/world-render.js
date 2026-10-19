// Browser checks for rendering quality and cost: the glow (bloom) pass, colours
// that match the plain renderer, static batching, the shadow budget, world
// effects and the warm-up before the first frame. Run with `pnpm test:browser`.
import * as THREE from 'three';
import { createScene } from '../src/core/createScene.js';
import { QUALITY_PRESETS, warmUp } from '../src/core/Quality.js';
import { markGlow } from '../src/core/postprocessing.js';
import { Assets, loadLolaFiles } from '../src/core/Assets.js';
import { LolaPlayer } from '../src/robot/LolaPlayer.js';
import { createHexapod } from '../src/robot/createHexapod.js';
import { createJunkyardWorld } from '../src/world/createJunkyardWorld.js';
import { JUNKYARD_ATMOSPHERE } from '../src/world/junkyardAtmosphere.js';

const result = document.querySelector('#results');
let passed = 0;
function check(condition, label) {
  if (!condition) throw new Error(label);
  passed += 1;
  result.textContent += `\nPASS ${label}`;
}

// Read the whole screen right after a draw (the drawing buffer is still there
// within the same task), as RGBA bytes.
function readScreen(renderer) {
  const gl = renderer.getContext();
  const { width, height } = gl.canvas;
  const pixels = new Uint8Array(width * height * 4);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  return { pixels, width, height };
}
// Red channel at a screen point (x, y from the top left, in drawing-buffer pixels).
const redAt = ({ pixels, width, height }, x, y) => pixels[((height - 1 - Math.round(y)) * width + Math.round(x)) * 4];
// Mean difference of two screenshots over all channels.
function meanDifference(a, b) {
  let sum = 0;
  for (let i = 0; i < a.pixels.length; i += 1) sum += Math.abs(a.pixels[i] - b.pixels[i]);
  return sum / a.pixels.length;
}
// Draw calls of one plain frame, shadow pass included.
function callsOf(engine) {
  const { renderer } = engine;
  renderer.info.autoReset = false;
  renderer.info.reset();
  renderer.setRenderTarget(null);
  renderer.render(engine.scene, engine.camera);
  const counts = { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
  renderer.info.autoReset = true;
  return counts;
}

try {
  // 1. A high-quality renderer for the game gets the glow pass.
  const engine = createScene(document.querySelector('#app'), { quality: 'high', glow: true });
  const { renderer, scene, camera } = engine;
  result.textContent = 'RENDER CHECKS';
  check(engine.quality.name === 'high' && engine.glow, 'high quality on WebGL2 gets the glow pass');
  check(renderer.getContext().getContextAttributes().antialias === false && engine.glow.sceneTarget.isWebGLMultisampleRenderTarget,
    'with glow, the off-screen picture is anti-aliased and the screen keeps no second MSAA buffer');
  check(renderer.toneMapping === THREE.ACESFilmicToneMapping && renderer.outputEncoding === THREE.sRGBEncoding,
    'ACES filmic tone mapping with sRGB output');
  const labEngine = createScene(document.createElement('div'), { quality: 'high', glow: false });
  check(!labEngine.glow && labEngine.renderer.getContext().getContextAttributes().antialias === true,
    'a page that does not ask for glow (the lab views) draws plain, anti-aliased on screen');
  labEngine.dispose();

  // 2. Glow: a red light in front of a dark wall gets a halo; walls in front hide it.
  const dark = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ color: 0x202020 }));
  dark.position.z = -2;
  const light = markGlow(new THREE.Mesh(new THREE.SphereGeometry(0.3, 24, 16),
    new THREE.MeshStandardMaterial({ color: 0x1a0402, emissive: 0xff1414, emissiveIntensity: 3 })));
  const cover = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ color: 0x404040 }));
  cover.position.z = 1;
  cover.visible = false;
  const glowScene = new THREE.Group();
  glowScene.add(dark, light, cover);
  scene.add(glowScene);
  camera.position.set(0, 0, 6);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const { width, height } = renderer.getContext().canvas;
  const centre = { x: width / 2, y: height / 2 };
  // Screen radius of the light, then a point just outside it.
  const edge = new THREE.Vector3(0.3, 0, 0).project(camera);
  const radius = (edge.x * 0.5) * width;
  const halo = { x: centre.x + radius * 1.6, y: centre.y };
  engine.render();
  const glowing = readScreen(renderer);
  renderer.setRenderTarget(null);
  renderer.render(scene, camera);
  const plain = readScreen(renderer);
  check(engine.frame.calls > 4, `the glow frame counts every pass (${engine.frame.calls} draw calls)`);
  check(redAt(glowing, halo.x, halo.y) > redAt(plain, halo.x, halo.y) + 12,
    `a glowing light gets a halo (red ${redAt(plain, halo.x, halo.y)} -> ${redAt(glowing, halo.x, halo.y)} beside it)`);
  cover.visible = true;
  engine.render();
  const covered = readScreen(renderer);
  renderer.render(scene, camera);
  const coveredPlain = readScreen(renderer);
  check(Math.abs(redAt(covered, halo.x, halo.y) - redAt(coveredPlain, halo.x, halo.y)) <= 3
    && Math.abs(redAt(covered, centre.x, centre.y) - redAt(coveredPlain, centre.x, centre.y)) <= 3,
  'a wall in front of the light hides its glow too');
  // Nothing glowing: the glow path draws the same picture as the plain renderer.
  light.visible = false;
  cover.visible = false;
  dark.material.color.setHex(0x8a7f70);
  engine.render();
  const noGlow = readScreen(renderer);
  renderer.render(scene, camera);
  const noGlowPlain = readScreen(renderer);
  const difference = meanDifference(noGlow, noGlowPlain);
  check(difference < 1, `with nothing glowing the colours match the plain renderer (mean difference ${difference.toFixed(2)})`);
  scene.remove(glowScene);

  // 3. The real junkyard at high quality: batches, shadow budget, sky and fog.
  const assets = new Assets({ overlay: false });
  const [world, lola] = await Promise.all([createJunkyardWorld(scene, { assets, quality: engine.quality }), loadLolaFiles(assets)]);
  camera.position.set(world.spawn.x, 3 * world.scale, world.spawn.z - 6 * world.scale);
  camera.lookAt(world.spawn.x, 0, world.spawn.z + 4 * world.scale);
  camera.updateMatrixWorld();
  engine.sun.position.set(world.spawn.x + 8 * world.scale, 15 * world.scale, world.spawn.z + 6 * world.scale);
  engine.sun.target.position.set(world.spawn.x, 0, world.spawn.z);
  check(world.batchStats.batches >= 10 && world.batches.parent === scene,
    `the map draws as ${world.batchStats.batches} batches in place of ${world.batchStats.meshes} meshes`);
  const batched = callsOf(engine);
  world.batches.visible = false;
  const hidden = [];
  world.map.traverse((object) => { if (object.isMesh && !object.visible) { hidden.push(object); object.visible = true; } });
  const unbatched = callsOf(engine);
  world.batches.visible = true;
  hidden.forEach((object) => { object.visible = false; });
  check(batched.calls < unbatched.calls,
    `batching cuts the map's draw calls (${unbatched.calls} -> ${batched.calls} per frame, triangles ${unbatched.triangles} -> ${batched.triangles})`);
  // High quality keeps every map prop's shadow (the smallest prop, a loose tire,
  // is above its size limit); lower tiers drop small ones (tests/world-batching.test.js).
  let casters = 0, meshes = 0;
  world.map.traverse((object) => { if (object.isMesh) { meshes += 1; if (object.castShadow) casters += 1; } });
  check(casters === meshes && engine.quality.shadowMinSize < 0.5, `high quality: every map prop casts its shadow (${casters} of ${meshes})`);
  check(scene.getObjectByName('sky') && scene.fog.color.getHex() === JUNKYARD_ATMOSPHERE.horizon,
    'the junkyard has its sky gradient and horizon-coloured fog');

  // 4. World effects: dust when a Leaper foot lands, sparks and a scorch mark on impact.
  const rig = createHexapod(scene);
  rig.robot.position.set(world.spawn.x, 0, world.spawn.z + 4 * world.scale);
  world.effects.watchFeet(rig);
  const leg = rig.legs[0];
  leg.stepping = true;
  world.effects.update(1 / 60);
  leg.stepping = false;
  leg.stepTo.copy(leg.footPosition);
  world.effects.update(1 / 60);
  const floorPoint = new THREE.Vector3(world.spawn.x, world.floorHeight, world.spawn.z + 2 * world.scale);
  world.effects.impact(floorPoint, new THREE.Vector3(0, 1, 0));
  world.effects.update(1 / 60);
  check(world.effects.counts.dust > 0, `a landing Leaper foot puffs dust (${world.effects.counts.dust} particles)`);
  check(world.effects.counts.sparks > 0 && world.effects.counts.decals === 1, 'an impact throws sparks and leaves a scorch mark');
  engine.render();
  check(engine.frame.calls > batched.calls, 'the game frame draws with effects and glow without errors');

  // 5. Warm-up: after it, Lola's first gun swap uploads no texture and compiles no shader.
  const target = new LolaPlayer(scene, world, document.createElement('button'), lola.models, lola.jumps, lola.reloads, lola.runJumps);
  target.mesh.position.set(world.spawn.x, world.floorHeight, world.spawn.z);
  const warm = warmUp(renderer, scene, camera, { render: engine.render });
  const before = { programs: renderer.info.programs.length, textures: renderer.info.memory.textures };
  target.switchWeapon();
  engine.render();
  engine.render();
  const after = { programs: renderer.info.programs.length, textures: renderer.info.memory.textures };
  check(warm.textures > 5 && after.programs === before.programs && after.textures === before.textures,
    `after the warm-up a gun swap compiles and uploads nothing new (${before.programs} programs, ${before.textures} textures)`);

  // 6. Clean up.
  world.dispose();
  check(!scene.getObjectByName('sky') && !scene.getObjectByName('map-batches') && !scene.getObjectByName('world-effects'),
    'dispose() removes the sky, the batches and the effects');
  check(QUALITY_PRESETS.low.bloom === null, 'low quality never builds the glow pass');

  result.textContent += `\nALL ${passed} CHECKS PASSED`;
  document.title = `PASS ${passed} · Rendering quality and cost`;
} catch (error) {
  result.textContent += `\nFAIL ${error.message}`;
  document.title = `FAIL · ${error.message}`;
  console.error(error);
}
