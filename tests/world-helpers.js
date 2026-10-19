import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

// Shared helpers for the world tests: read a real exported GLB in Node, the
// same way the game's loader does in the browser (no images are decoded).

// GLTFLoader looks for a few browser globals; plain stand-ins are enough here.
globalThis.window ??= { URL, addEventListener() {} };
globalThis.self ??= globalThis.window;

// Parse one GLB file from the repository (path relative to the repo root).
// Meshopt-compressed copies decode through the decoder three.js r128 ships.
// Images are never decoded (Node has none of the browser's image loaders):
// a plugin that runs first hands back blank textures instead.
export async function loadGlb(path) {
  const file = fs.readFileSync(new URL(`../${path}`, import.meta.url));
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  loader.pluginCallbacks.unshift(() => ({ name: 'TEST_BLANK_TEXTURES', loadTexture: () => Promise.resolve(new THREE.Texture()) }));
  await MeshoptDecoder.ready;
  return new Promise((resolve, reject) => loader.parse(
    file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength), '', resolve, reject,
  ));
}

// The JSON chunk of a GLB (names, node tree, animations) without decoding it.
export function glbJson(path) {
  const buffer = fs.readFileSync(new URL(`../${path}`, import.meta.url));
  const length = buffer.readUInt32LE(12);
  return JSON.parse(buffer.subarray(20, 20 + length).toString('utf8'));
}

// A small repeatable random source, so failures can be replayed.
export function seededRandom(seed = 1) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
