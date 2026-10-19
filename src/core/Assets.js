import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { RUN_JUMPS } from '../actors/lola/lolaTuning.js';
import manifest from '../../assets/build/manifest.json' with { type: 'json' };

// Loading the game's files: one place that downloads models, sounds and data,
// shows a progress bar while it does, and knows where the compressed web copies
// live (assets/build/, written by `pnpm assets`; see scripts/assets/).
//
// It wraps three.js's LoadingManager, so every file counts towards one total,
// and weights each file by its real size (from the build manifest), so the bar
// moves with the bytes rather than jumping per file.

// ---- Where the built files are ----

// The junkyard map's compressed copy (same geometry and names as the source).
export const MAP_URL = new URL('../../assets/build/maps/junkyard.glb', import.meta.url).href;

// One of Lola's 14 compressed files by its short name ('m416', 'jump-basic', ...).
export function lolaUrl(name) {
  return new URL(`../../assets/build/lola/lola-${name}.glb`, import.meta.url).href;
}

// The browser's preferred sound format: Opus in Ogg (most browsers), else AAC
// in MP4 (older Safari), else the original WAV. Asked once per page.
let audioFormat = null;
export function pickAudioFormat(probe = typeof Audio === 'undefined' ? null : new Audio()) {
  if (audioFormat) return audioFormat;
  const can = (type) => Boolean(probe?.canPlayType?.(type));
  audioFormat = can('audio/ogg; codecs="opus"') ? 'ogg' : can('audio/mp4; codecs="mp4a.40.2"') ? 'm4a' : 'wav';
  return audioFormat;
}

// A sound by name ('m416-shot', 'lola-walk', ...) in the best format the browser plays.
export function audioUrl(name, format = pickAudioFormat()) {
  if (format === 'ogg' || format === 'm4a') return new URL(`../../assets/build/audio/${name}.${format}`, import.meta.url);
  return new URL(`../../assets/audio/${name}.wav`, import.meta.url);
}

// Expected size of a built file (for the progress bar), from the build manifest.
// A production build adds an 8-character fingerprint to each file name
// ("lola-m416-q5_9cAA1.glb"), so the name is tried as it is, then without it.
const BUILT_BYTES = new Map(Object.entries(manifest.outputs).map(([file, { bytes }]) => [file.split('/').pop(), bytes]));
export function expectedBytes(url) {
  const name = String(url).split(/[?#]/)[0].split('/').pop();
  return BUILT_BYTES.get(name) ?? BUILT_BYTES.get(name.replace(/-[\w-]{8}(\.\w+)$/, '$1')) ?? 0;
}

// ---- The loader ----

export class Assets {
  // overlay: show the progress bar (the game page); off for tests and tools.
  constructor({ overlay = true, title = 'LOADING' } = {}) {
    // 1. One LoadingManager counts every file; three.js loaders report to it,
    //    and the plain downloads below report to it by hand.
    this.manager = new THREE.LoadingManager();
    this.gltfLoader = new GLTFLoader(this.manager).setMeshoptDecoder(MeshoptDecoder);
    // 2. Byte accounting per file: what we expect and what has arrived.
    this.expected = new Map();
    this.received = new Map();
    this.overlay = overlay && typeof document !== 'undefined' ? new LoadingOverlay(title) : null;
    this.manager.onProgress = () => this.render();
    this.manager.onError = (url) => this.overlay?.detail(`Could not load ${url.split('/').pop()}`);
  }

  // A glTF model (map, Lola). Resolves to the loaded glTF.
  model(url) {
    this.track(url, expectedBytes(url));
    return new Promise((resolve, reject) => this.gltfLoader.load(url, (gltf) => {
      this.progress(url, Infinity);
      resolve(gltf);
    }, (event) => this.progress(url, event.loaded), reject));
  }

  // Any file as bytes (sounds): counted, and streamed for byte progress. Returns
  // a Response-like object ({ ok, status, arrayBuffer() }) like fetch() does.
  async fetch(url) {
    const key = String(url);
    this.track(key, expectedBytes(key));
    this.manager.itemStart(key);
    try {
      const response = await fetch(url);
      if (!response.ok || !response.body) return response;
      const chunks = [];
      let received = 0;
      for (const reader = response.body.getReader(); ;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.byteLength;
        this.progress(key, received);
      }
      const bytes = new Uint8Array(received);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      this.progress(key, Infinity);
      return { ok: true, status: response.status, headers: response.headers, arrayBuffer: async () => bytes.buffer };
    } catch (error) {
      this.manager.itemError(key);
      throw error;
    } finally {
      this.manager.itemEnd(key);
    }
  }

  // Any other loading job (the collision worker): counted as one file of `bytes`.
  // `job` is a promise, or a function given report(share 0..1) that returns one.
  async task(name, job, bytes = 0) {
    this.track(name, bytes);
    this.manager.itemStart(name);
    try {
      const result = await (typeof job === 'function' ? job((share) => this.progress(name, share * bytes)) : job);
      this.progress(name, Infinity);
      return result;
    } catch (error) {
      this.manager.itemError(name);
      throw error;
    } finally {
      this.manager.itemEnd(name);
    }
  }

  // Byte bookkeeping for the bar.
  track(key, bytes) {
    this.expected.set(key, Math.max(bytes, 1));
    this.received.set(key, 0);
    this.render();
  }

  // `bytes` so far for one file (Infinity = complete; a server that compresses
  // files in transit reports fewer bytes than the file holds).
  progress(key, bytes) {
    this.received.set(key, Math.min(bytes, this.expected.get(key) ?? 0));
    this.manager.onProgress?.(key);
  }

  // Share of all known bytes that have arrived (0..1), and the totals.
  get status() {
    let expected = 0, received = 0;
    for (const [key, bytes] of this.expected) {
      expected += bytes;
      received += this.received.get(key) ?? 0;
    }
    return { expected, received, share: expected ? received / expected : 0 };
  }

  render() {
    if (!this.overlay) return;
    const { expected, received, share } = this.status;
    this.overlay.update(share, `${(received / 1e6).toFixed(1)} / ${(expected / 1e6).toFixed(1)} MB`);
  }

  // Loading is over (the game is ready): fill the bar and fade it out.
  done() {
    this.overlay?.finish();
  }

  // Loading failed: keep the bar, say why.
  fail(message) {
    this.overlay?.detail(message);
  }
}

// ---- The junkyard's characters ----

// Lola's outfits in weaponIndex order (the same as OUTFIT_WEAPONS in
// src/actors/lola/LolaAssets.js; a test keeps the two in step).
export const LOLA_OUTFITS = Object.freeze(['m416', 'basic']);

// Lola's 14 files, all at once, in the shape LolaPlayer's constructor takes:
// { models: [m416, basic], jumps, reloads, runJumps } (the same files, in the
// same order, as src/actors/lola/LolaAssets.js loadLolaAssets(), compressed).
export async function loadLolaFiles(assets) {
  const load = (name) => assets.model(lolaUrl(name));
  const perGun = (base) => LOLA_OUTFITS.map((weapon) => load(`${base}-${weapon}`));
  const [models, jumps, reloads, ...runJumpFiles] = await Promise.all([
    Promise.all(LOLA_OUTFITS.map((weapon) => load(weapon))),
    Promise.all(perGun('jump')),
    Promise.all(perGun('reload')),
    ...Object.values(RUN_JUMPS).map(({ file }) => Promise.all(perGun(file))),
  ]);
  const runJumps = Object.fromEntries(Object.keys(RUN_JUMPS).map((name, i) => [name, runJumpFiles[i]]));
  const files = { models, jumps, reloads, runJumps };
  shareTextures([...models, ...jumps, ...reloads, ...runJumpFiles.flat()]);
  return files;
}

// The name of the picture behind a loaded texture (the glTF image's name, which
// three.js doesn't copy onto the texture), else the texture's own name.
function pictureName(gltf, texture) {
  const reference = gltf.parser?.associations?.get(texture);
  if (reference?.type !== 'textures') return texture.name || null;
  const definition = gltf.parser.json.textures[reference.index];
  const source = definition.extensions?.EXT_texture_webp?.source ?? definition.source;
  return gltf.parser.json.images?.[source]?.name ?? (texture.name || null);
}

// The same picture often sits in several files (both outfits carry all body
// textures; every clip file carries its gun's). The build guarantees one name
// is one picture, so each name keeps a single texture, uploaded to the graphics
// card once instead of once per file. Returns how many copies were dropped.
export function shareTextures(gltfs) {
  const kept = new Map();
  let dropped = 0;
  for (const gltf of gltfs) {
    gltf.scene.traverse((object) => {
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (!material) continue;
        for (const [slot, texture] of Object.entries(material)) {
          if (!texture?.isTexture) continue;
          const name = pictureName(gltf, texture);
          if (!name || !(name in manifest.textures)) continue;
          texture.name = name;
          const first = kept.get(name);
          if (!first) { kept.set(name, texture); continue; }
          if (first === texture) continue;
          material[slot] = first;
          texture.dispose();
          dropped += 1;
        }
      }
    });
  }
  return dropped;
}

// ---- The progress bar (self-contained: its own element and styles) ----

const STYLE = `
.leaper-loading { position: fixed; inset: 0; z-index: 40; display: grid; place-items: center;
  background: radial-gradient(circle at 50% 40%, #6a6f74 0%, #44484c 60%, #2e3134 100%);
  color: #f2f4f5; font: 600 12px/1.4 ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
  letter-spacing: 0.2em; transition: opacity 0.45s ease; pointer-events: none; }
.leaper-loading.done { opacity: 0; }
.leaper-loading .box { width: min(420px, 80vw); text-align: center; }
.leaper-loading .title { font-size: 15px; letter-spacing: 0.42em; color: #ff6a3d; margin-bottom: 14px; }
.leaper-loading .track { height: 6px; background: rgba(255,255,255,0.14); border-radius: 3px; overflow: hidden; }
.leaper-loading .fill { height: 100%; width: 0; background: linear-gradient(90deg, #df4522, #ffb347);
  transition: width 0.15s linear; }
.leaper-loading .detail { margin-top: 10px; font-size: 10px; color: #c9cfd3; min-height: 1.4em; }
`;

class LoadingOverlay {
  constructor(title) {
    // 1. Styles once per page, then the bar itself.
    if (!document.getElementById('leaper-loading-style')) {
      const style = document.createElement('style');
      style.id = 'leaper-loading-style';
      style.textContent = STYLE;
      document.head.append(style);
    }
    this.element = document.createElement('div');
    this.element.className = 'leaper-loading';
    this.element.innerHTML = `<div class="box"><div class="title"></div>
      <div class="track" role="progressbar" aria-label="Loading" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
      <div class="fill"></div></div><div class="detail"></div></div>`;
    this.element.querySelector('.title').textContent = title;
    this.bar = this.element.querySelector('.track');
    this.fill = this.element.querySelector('.fill');
    this.text = this.element.querySelector('.detail');
    document.body.append(this.element);
    this.shown = -1;
  }

  // Move the bar (only when the whole percent changes, to keep page work low).
  update(share, text) {
    const percent = Math.floor(share * 100);
    if (percent === this.shown) return;
    this.shown = percent;
    this.fill.style.width = `${percent}%`;
    this.bar.setAttribute('aria-valuenow', String(percent));
    this.text.textContent = text;
  }

  detail(text) {
    this.text.textContent = text;
  }

  // Full bar, fade out, then leave the page.
  finish() {
    this.update(1, 'READY');
    this.element.classList.add('done');
    setTimeout(() => this.element.remove(), 500);
  }
}
