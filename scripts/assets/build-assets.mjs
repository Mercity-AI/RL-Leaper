// Build the web copies of the game's assets into assets/build/ (pnpm assets).
//
// The source files stay exactly where they are (Blender exports, studio WAVs;
// the Python brain service reads the source map). This script writes smaller
// copies that only the browser game downloads:
//   - GLB models (the junkyard map and the 14 Lola files): duplicates merged
//     and geometry/animation packed with meshopt (EXT_meshopt_compression).
//     Lossless: every vertex, triangle and keyframe decodes to the same numbers,
//     and every node, bone and animation keeps its name.
//   - Textures: re-encoded as lossless WebP (pixel-identical); the two nearly
//     flat-colour gun textures are right-sized from 2048 to 512 pixels.
//   - Sounds: Opus in Ogg and AAC in M4A (the game picks what the browser plays).
// assets/build/manifest.json records every source and output (with fingerprints),
// so tests can spot a stale build.
//
// Needs ffmpeg (/usr/bin/ffmpeg or FFMPEG=...) with libwebp, libopus and aac.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression, EXTTextureWebP } from '@gltf-transform/extensions';
import { dedup } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

// ---- Settings (what gets built, and how) ----

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = path.join(ROOT, 'assets/build');
const FFMPEG = process.env.FFMPEG || '/usr/bin/ffmpeg';

// The GLBs the game loads: the map, then Lola's two outfits and 12 clip files.
const LOLA_FILES = ['m416', 'basic', 'jump-m416', 'jump-basic', 'reload-m416', 'reload-basic',
  'runjumprl-m416', 'runjumprl-basic', 'runjumplr-m416', 'runjumplr-basic',
  'backjumprl-m416', 'backjumprl-basic', 'backjumplr-m416', 'backjumplr-basic'];
const MODELS = [
  ['assets/maps/junkyard/junkyard.glb', 'maps/junkyard.glb'],
  ...LOLA_FILES.map((name) => [`assets/characters/lola/lola-${name}.glb`, `lola/lola-${name}.glb`]),
];

// Textures shrunk on the way: nearly flat colour, drawn small on screen.
const TEXTURE_SIZES = { m416_base_color: 512, Lola_Gun_BaseColor: 512 };

// The recordings the game plays (src/simulation/LaserAudio.js CLIPS), and the
// bit rates per channel: plenty for short effects and footsteps.
const SOUNDS = ['leaper-laser', 'pistol-shot', 'm416-shot', 'leaper-hit', 'lola-run', 'lola-walk', 'leaper-walk',
  'm416-reload-reserved', 'pistol-reload-reserved'];
const OPUS_KBPS_PER_CHANNEL = 48;
const AAC_KBPS_PER_CHANNEL = 64;

// ---- Small helpers ----

const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const ffmpeg = (args, input) => execFileSync(FFMPEG, ['-v', 'error', '-y', ...args], { input, maxBuffer: 1 << 28 });
const write = (relative, bytes) => {
  const file = path.join(OUT, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes);
  return { file: `assets/build/${relative}`, bytes: bytes.length, sha256: sha256(bytes) };
};

// ---- Textures: lossless WebP (optionally right-sized), each image once ----

const webpCache = new Map();
// Texture name -> fingerprint of its built image. The same name must always be
// the same picture: the game then shares one GPU copy per name across files.
const textureNames = new Map();
function toWebp(image, name) {
  const size = TEXTURE_SIZES[name];
  const key = `${sha256(image)}:${size ?? 'full'}`;
  if (!webpCache.has(key)) {
    const scale = size ? ['-vf', `scale=${size}:${size}:flags=area`] : [];
    webpCache.set(key, ffmpeg(['-f', 'image2pipe', '-i', 'pipe:0', ...scale,
      '-c:v', 'libwebp', '-lossless', '1', '-compression_level', '6', '-f', 'webp', 'pipe:1'], image));
  }
  return webpCache.get(key);
}

// ---- Models ----

async function buildModel(io, source, target) {
  const document = await io.read(path.join(ROOT, source));
  // 1. Merge duplicate accessors, meshes, materials and textures inside the file.
  await document.transform(dedup());
  // 2. Every texture becomes lossless WebP (right-sized where listed).
  const textures = document.getRoot().listTextures();
  if (textures.length) document.createExtension(EXTTextureWebP).setRequired(true);
  for (const texture of textures) {
    const webp = toWebp(texture.getImage(), texture.getName());
    const known = textureNames.get(texture.getName());
    if (known && known !== sha256(webp)) throw new Error(`Two different images are both named ${texture.getName()}`);
    textureNames.set(texture.getName(), sha256(webp));
    texture.setImage(webp).setMimeType('image/webp');
    texture.setURI(texture.getURI().replace(/\.png$/i, '.webp'));
  }
  // 3. Pack geometry and animation with meshopt's lossless codecs (no
  //    quantisation, no lossy filters: the decoded numbers are the originals).
  document.createExtension(EXTMeshoptCompression).setRequired(true)
    .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
  return write(target, Buffer.from(await io.writeBinary(document)));
}

// ---- Sounds ----

function buildSound(name) {
  const source = `assets/audio/${name}.wav`;
  const channels = Number(execFileSync(path.join(path.dirname(FFMPEG), 'ffprobe'), ['-v', 'error', '-select_streams', 'a:0',
    '-show_entries', 'stream=channels', '-of', 'csv=p=0', path.join(ROOT, source)]).toString().trim()) || 1;
  const input = path.join(ROOT, source);
  // bitexact: no random stream serial numbers or encoder tags, so rebuilding an
  // unchanged sound gives exactly the same bytes (no needless churn in the repo).
  const exact = ['-fflags', '+bitexact', '-flags:a', '+bitexact'];
  const opus = ffmpeg(['-i', input, ...exact, '-map_metadata', '-1', '-c:a', 'libopus', '-b:a', `${OPUS_KBPS_PER_CHANNEL * channels}k`,
    '-application', 'audio', '-f', 'ogg', 'pipe:1']);
  const tmp = path.join(OUT, `audio/.${name}.m4a`);
  fs.mkdirSync(path.dirname(tmp), { recursive: true });
  // MP4 needs a seekable file (its index goes at the front for streaming).
  ffmpeg(['-i', input, ...exact, '-map_metadata', '-1', '-c:a', 'aac', '-b:a', `${AAC_KBPS_PER_CHANNEL * channels}k`,
    '-movflags', '+faststart', tmp]);
  const aac = fs.readFileSync(tmp);
  fs.rmSync(tmp);
  return [[source, write(`audio/${name}.ogg`, opus)], [source, write(`audio/${name}.m4a`, aac)]];
}

// ---- Run ----

await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
fs.rmSync(OUT, { recursive: true, force: true });
const entries = [];
// 1. Models.
for (const [source, target] of MODELS) {
  const result = await buildModel(io, source, target);
  entries.push([source, result]);
  console.log(`${target}: ${fs.statSync(path.join(ROOT, source)).size} -> ${result.bytes} bytes`);
}
// 2. Sounds.
for (const name of SOUNDS) {
  for (const [source, result] of buildSound(name)) {
    entries.push([source, result]);
    console.log(`${result.file}: ${fs.statSync(path.join(ROOT, source)).size} -> ${result.bytes} bytes`);
  }
}
// 3. The manifest: every output with its source's fingerprint.
const sources = new Map();
for (const [source] of entries) {
  if (!sources.has(source)) {
    const bytes = fs.readFileSync(path.join(ROOT, source));
    sources.set(source, { bytes: bytes.length, sha256: sha256(bytes) });
  }
}
const manifest = {
  about: 'Web copies of the game assets, written by scripts/assets/build-assets.mjs (pnpm assets). Do not edit; rebuild after changing a source.',
  outputs: Object.fromEntries(entries.map(([source, result]) => [result.file.replace('assets/build/', ''), {
    source, sourceBytes: sources.get(source).bytes, sourceSha256: sources.get(source).sha256,
    bytes: result.bytes, sha256: result.sha256,
  }])),
  // Every texture name and its one picture (identical in every file it appears in).
  textures: Object.fromEntries([...textureNames].sort()),
};
fs.writeFileSync(path.join(OUT, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
const models = Object.values(manifest.outputs).filter((o) => o.source.endsWith('.glb'));
const total = (list, key) => list.reduce((sum, o) => sum + o[key], 0);
console.log(`models: ${total(models, 'sourceBytes')} -> ${total(models, 'bytes')} bytes`);
