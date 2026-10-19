import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Assets, LOLA_OUTFITS, audioUrl, expectedBytes, loadLolaFiles, pickAudioFormat, shareTextures } from '../src/core/Assets.js';
import { OUTFIT_WEAPONS, loadLolaAssets } from '../src/actors/lola/LolaAssets.js';
import manifest from '../assets/build/manifest.json' with { type: 'json' };

// The game's loader (src/core/Assets.js): the compressed files it asks for,
// the progress bar's byte accounting, the sound-format choice, and sharing one
// GPU texture per picture across Lola's files.

const fileName = (url) => String(url).split('/').pop();

test('the game loads the same 14 Lola files, in the same roles, as LolaPlayer.create', async () => {
  assert.deepEqual(LOLA_OUTFITS, OUTFIT_WEAPONS, 'outfit order matches weaponIndex');
  // What LolaPlayer.create (loadLolaAssets) asks for, without downloading.
  const original = [];
  const loadAsync = GLTFLoader.prototype.loadAsync;
  GLTFLoader.prototype.loadAsync = async (url) => { original.push(fileName(url)); return { scene: new THREE.Group(), name: fileName(url) }; };
  let expected;
  try { expected = await loadLolaAssets(); } finally { GLTFLoader.prototype.loadAsync = loadAsync; }
  // What the game's loader asks for: the compressed copies of the same files.
  const asked = [];
  const assets = { model: async (url) => { asked.push(fileName(url)); return { scene: new THREE.Group(), name: fileName(url) }; } };
  const files = await loadLolaFiles(assets);
  assert.deepEqual([...asked].sort(), [...original].sort(), 'same file names');
  const roles = (set) => ({
    models: set.models.map(g => g.name), jumps: set.jumps.map(g => g.name), reloads: set.reloads.map(g => g.name),
    runJumps: Object.fromEntries(Object.entries(set.runJumps).map(([k, list]) => [k, list.map(g => g.name)])),
  });
  assert.deepEqual(roles(files), roles(expected), 'each file lands in the same role');
  for (const name of asked) assert.ok(manifest.outputs[`lola/${name}`], `${name} has a compressed copy`);
});

test('the loading bar weighs each file by its real (built) size', async () => {
  // Development names and fingerprinted production names both resolve.
  assert.equal(expectedBytes('/assets/build/lola/lola-m416.glb'), manifest.outputs['lola/lola-m416.glb'].bytes);
  assert.equal(expectedBytes('https://x.io/RL-Leaper/assets/lola-m416-q5_9cAA1.glb'), manifest.outputs['lola/lola-m416.glb'].bytes);
  assert.equal(expectedBytes('/assets/pistol-reload-reserved-AbC12345.ogg'), manifest.outputs['audio/pistol-reload-reserved.ogg'].bytes);
  assert.equal(expectedBytes('data:audio/ogg;base64,AAAA'), 0);
  // Byte accounting: tracked files, partial progress, completion, tasks with progress.
  const assets = new Assets({ overlay: false });
  assets.track('a', 100);
  assets.track('b', 300);
  assets.progress('a', 50);
  assert.deepEqual(assets.status, { expected: 400, received: 50, share: 0.125 });
  assets.progress('b', Infinity);
  assert.equal(assets.status.received, 350, 'complete = the expected size, even when compressed in transit');
  const result = await assets.task('job', (report) => { report(0.5); assert.equal(assets.received.get('job'), 50); return Promise.resolve(7); }, 100);
  assert.equal(result, 7);
  assert.equal(assets.status.received, 450);
});

test('sounds come in the best format the browser plays', () => {
  const probe = (types) => ({ canPlayType: (type) => (types.some(t => type.startsWith(t)) ? 'probably' : '') });
  assert.equal(pickAudioFormat(probe(['audio/ogg', 'audio/mp4'])), 'ogg');
  // (The choice is made once per page; the URLs for each format are fixed.)
  assert.match(String(audioUrl('m416-shot', 'ogg')), /assets\/build\/audio\/m416-shot\.ogg$/);
  assert.match(String(audioUrl('m416-shot', 'm4a')), /assets\/build\/audio\/m416-shot\.m4a$/);
  // The WAVs are build sources only (never shipped): asking for one gives the AAC copy.
  assert.match(String(audioUrl('m416-shot', 'wav')), /assets\/build\/audio\/m416-shot\.m4a$/);
});

test('one texture per picture: copies in other files are swapped for the first and freed', () => {
  const name = Object.keys(manifest.textures)[0];
  const scene = (texture) => {
    const group = new THREE.Group();
    group.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ map: texture })));
    return { scene: group };
  };
  const first = Object.assign(new THREE.Texture(), { name });
  const copy = Object.assign(new THREE.Texture(), { name });
  const other = Object.assign(new THREE.Texture(), { name: 'not_from_the_build' });
  let freed = 0;
  copy.addEventListener('dispose', () => { freed += 1; });
  const files = [scene(first), scene(copy), scene(other)];
  assert.equal(shareTextures(files), 1);
  assert.equal(files[1].scene.children[0].material.map, first, 'the copy now uses the first texture');
  assert.equal(freed, 1, 'the copy is freed');
  assert.equal(files[2].scene.children[0].material.map, other, 'textures the build does not know are left alone');
});
