// Browser check: the compressed web copies the game downloads (assets/build/,
// scripts/assets/build-assets.mjs) look the same as the source files. Lola in
// both outfits (posed mid-idle, so the packed animation is exercised too), close
// ups of her rifle and pistol (the two textures the build shrinks from 2048 to
// 512 pixels) and the junkyard map are each drawn twice from the same camera:
// once from the source GLB, once from the compressed copy. The pictures are
// compared pixel by pixel and shown side by side on the page. Run with
// `pnpm test:browser`.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { MAP_URL, lolaUrl } from '../src/core/Assets.js';

// ---- Settings ----
// Picture size, and how different the two pictures of a pair may be. "Changed"
// pixels differ by more than CHANGED_LEVEL (of 255) in some colour channel.
// Lossless copies must match exactly; the two shrunk gun textures may soften
// fine detail a little in a close-up that fills the picture with the gun.
const SIZE = 480;
const CHANGED_LEVEL = 16;
const LIMITS = {
  lossless: { mean: 0.05, changed: 0.0005 },
  shrunkTexture: { mean: 0.5, changed: 0.005 },
};
const sourceLola = (name) => new URL(`../assets/characters/lola/lola-${name}.glb`, import.meta.url).href;
const SOURCE_MAP = new URL('../assets/maps/junkyard/junkyard.glb', import.meta.url).href;
// focus: a node to frame, named as three.js keeps it (it drops the dots, so
// Head.001 is Head001); pose: a clip to pose the model in.
const VIEWS = [
  { label: 'Lola (rifle outfit), whole body, mid-idle', source: sourceLola('m416'), built: lolaUrl('m416'), pose: 'Idle', distance: 0.75, limits: 'shrunkTexture' },
  { label: 'Lola\'s rifle, close up (shrunk texture)', source: sourceLola('m416'), built: lolaUrl('m416'), focus: 'm416_ShootingWeapon', distance: 0.6, limits: 'shrunkTexture' },
  { label: 'Lola (pistol outfit), whole body, mid-idle', source: sourceLola('basic'), built: lolaUrl('basic'), pose: 'Idle', distance: 0.75, limits: 'shrunkTexture' },
  { label: 'Lola\'s pistol, close up (shrunk texture)', source: sourceLola('basic'), built: lolaUrl('basic'), focus: 'basic_ShootingWeapon', limits: 'shrunkTexture' },
  { label: 'Lola\'s face, close up', source: sourceLola('m416'), built: lolaUrl('m416'), focus: 'Head001', limits: 'lossless' },
  { label: 'Junkyard map, whole yard', source: SOURCE_MAP, built: MAP_URL, direction: [0.55, 0.9, 0.75], limits: 'lossless' },
  { label: 'Junkyard map, the bus and the props around it', source: SOURCE_MAP, built: MAP_URL, focus: 'bus_upright', direction: [0.6, 0.8, 0.5], distance: 2.4, limits: 'lossless' },
];

const result = document.querySelector('#results');
let passed = 0;
function check(condition, label) {
  if (!condition) throw new Error(label);
  passed += 1;
  result.textContent += `\nPASS ${label}`;
}

// ---- Drawing ----

// One renderer for every picture: the game's colour pipeline (ACES filmic tone
// mapping, sRGB output, the same exposure), no anti-aliasing so equal scenes
// give equal pixels.
const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setPixelRatio(1);
renderer.setSize(SIZE, SIZE);
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.06;
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);

// A small studio: the junkyard's horizon grey behind, a sky fill and a sun.
function studio(model) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x555555);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x777777, 0.95));
  const sun = new THREE.DirectionalLight(0xffffff, 1.25);
  sun.position.set(8, 15, 6);
  scene.add(sun, model);
  return scene;
}

// Pose a model at a moment of one of its clips (both copies get the same moment).
function pose(gltf, clipName, seconds = 0.5) {
  if (!clipName) return;
  const clip = gltf.animations.find((candidate) => candidate.name === clipName);
  if (!clip) throw new Error(`no ${clipName} clip`);
  const mixer = new THREE.AnimationMixer(gltf.scene);
  mixer.clipAction(clip).play();
  mixer.setTime(seconds);
}

// A camera that frames `box`, looking from `direction`, `distance` times the
// distance that just fits the box.
function framing(box, direction = [0.5, 0.3, 1], distance = 1) {
  const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 1000);
  const centre = box.getCenter(new THREE.Vector3());
  const radius = box.getSize(new THREE.Vector3()).length() / 2;
  const fit = radius / Math.sin(THREE.MathUtils.degToRad(20)) * distance;
  camera.position.copy(centre).addScaledVector(new THREE.Vector3(...direction).normalize(), fit);
  camera.near = Math.max(0.01, fit - radius * 2);
  camera.far = fit + radius * 2;
  camera.lookAt(centre);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  return camera;
}

// Draw and read the picture back straight away (RGBA bytes, bottom row first).
function picture(scene, camera) {
  renderer.render(scene, camera);
  const gl = renderer.getContext();
  const pixels = new Uint8Array(SIZE * SIZE * 4);
  gl.readPixels(0, 0, SIZE, SIZE, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  return pixels;
}

// How far apart two pictures are: mean difference per channel (of 255), the
// share of changed pixels, and the largest single difference.
function difference(a, b) {
  let sum = 0, changed = 0, largest = 0;
  for (let i = 0; i < a.length; i += 4) {
    const d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]));
    sum += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
    if (d > CHANGED_LEVEL) changed += 1;
    largest = Math.max(largest, d);
  }
  const count = a.length / 4;
  return { mean: sum / (count * 3), changed: changed / count, largest };
}

// The picture as an image for the page (rows flipped back to top first).
function thumbnail(pixels) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const image = canvas.getContext('2d').createImageData(SIZE, SIZE);
  for (let y = 0; y < SIZE; y += 1) image.data.set(pixels.subarray((SIZE - 1 - y) * SIZE * 4, (SIZE - y) * SIZE * 4), y * SIZE * 4);
  canvas.getContext('2d').putImageData(image, 0, 0);
  const img = document.createElement('img');
  img.src = canvas.toDataURL('image/png');
  return img;
}

function showPair(label, source, built, stats) {
  const figure = document.createElement('figure');
  figure.append(thumbnail(source), thumbnail(built));
  const caption = document.createElement('figcaption');
  caption.textContent = `${label}: source | compressed. Mean difference ${stats.mean.toFixed(3)}, `
    + `${(stats.changed * 100).toFixed(2)}% changed pixels, largest ${stats.largest}`;
  figure.append(caption);
  document.querySelector('#pairs').append(figure);
}

// ---- The checks ----

try {
  result.textContent = 'VISUAL CHECKS';
  const cache = new Map();
  // Each file is loaded fresh for every view (a model can only be in one scene).
  const load = (url) => loader.loadAsync(url);
  for (const view of VIEWS) {
    const [source, built] = await Promise.all([load(view.source), load(view.built)]);
    pose(source, view.pose);
    pose(built, view.pose);
    source.scene.updateMatrixWorld(true);
    built.scene.updateMatrixWorld(true);
    // The camera is framed on the source model and reused as it is for the
    // compressed one, so a moved part would show up as a difference.
    const focus = view.focus ? source.scene.getObjectByName(view.focus) : source.scene;
    if (!focus) throw new Error(`${view.label}: no ${view.focus} in the source`);
    check(!view.focus || built.scene.getObjectByName(view.focus), `${view.label}: the compressed copy has ${view.focus ?? 'the model'}`);
    const camera = framing(new THREE.Box3().setFromObject(focus), view.direction, view.distance);
    const a = picture(studio(source.scene), camera);
    const b = picture(studio(built.scene), camera);
    const stats = difference(a, b);
    showPair(view.label, a, b, stats);
    cache.set(view.label, stats);
    // Something must actually be in the picture (not just the background).
    const background = a.slice(0, 4);
    let covered = 0;
    for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - background[0]) + Math.abs(a[i + 1] - background[1]) > 6) covered += 1;
    const limits = LIMITS[view.limits];
    check(covered / (SIZE * SIZE) > 0.05 && stats.mean <= limits.mean && stats.changed <= limits.changed,
      `${view.label}: looks the same (mean difference ${stats.mean.toFixed(3)} of 255, `
      + `${(stats.changed * 100).toFixed(2)}% changed pixels; ${(covered / (SIZE * SIZE) * 100).toFixed(0)}% of the picture is model)`);
  }
  window.visualStats = Object.fromEntries(cache);
  result.textContent += `\nALL ${passed} CHECKS PASSED`;
  document.title = `PASS ${passed} · Compressed assets look the same`;
} catch (error) {
  result.textContent += `\nFAIL ${error.message}`;
  document.title = `FAIL · ${error.message}`;
  console.error(error);
}
