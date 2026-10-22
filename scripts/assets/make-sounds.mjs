// Make the game's CC0 sound effects from their downloaded originals
// (node scripts/assets/make-sounds.mjs, then `pnpm assets` to encode them).
//
// The originals stay untouched in assets/audio/sources/ (Kenney packs and
// OpenGameArt downloads, all CC0, and the owner's own recordings; see
// src/audio/sounds.json for every source).
// Each recipe below cuts, layers, pitches and fades them into one short mono
// WAV in assets/audio/, which the asset build then turns into Opus and AAC.
// The yard ambience also mixes in wind made here from seeded noise, and the
// pickup sounds are synthesised here outright (tones and noise clicks), so the
// same recipe always writes the same file.
//
// Needs ffmpeg (/usr/bin/ffmpeg or FFMPEG=...) to decode the originals.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// ---- Settings ----

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SOURCES = path.join(ROOT, 'assets/audio/sources');
const OUT = path.join(ROOT, 'assets/audio');
const FFMPEG = process.env.FFMPEG || '/usr/bin/ffmpeg';

// One recipe per sound file. Every time is in seconds, gains are plain factors.
//   rate     sample rate of the WAV (effects 44.1 kHz; the ambience is dark, 24 kHz is plenty)
//   length   the WAV's length
//   layers   originals mixed together: file (under sources/), from (seconds into
//            it), at (where it starts in the mix), gain, speed (below 1 = slower
//            and lower), lowpass (Hz), fadeIn / fadeOut (per layer)
//   fadeIn / fadeOut  on the whole mix; peak: loudest sample after mixing, in dBFS
//   tones    a synthesised layer of notes: { at, hz, decay (seconds to fade to
//            ~37%), gain, partials: [[multiple of hz, gain], ...] }
//   clicks   a synthesised layer of short noise bursts: { at, decay, gain, hz }
//            (hz: the band the noise is filtered around)
//   loop     crossfade (seconds) that makes the file loop without a seam
//   pad      seconds of the loop repeated before and after it, so the codec's
//            start and end (priming, padding) fall outside the part the game
//            loops (sounds.json loop { start: pad, end: pad + length })
const RECIPES = [
  // Lola's pain grunts: the owner's own voice (2026-10-22), four grunts cut out
  // of one recording, tight around each so no breath or inhale comes along.
  // The game picks one at random per hit.
  { name: 'lola-hurt-1', length: 0.2, layers: [{ file: 'owner/lola-grunts-2026-10-22.ogg', from: 0.86 }],
    fadeIn: 0.008, fadeOut: 0.06, peak: -3 },
  { name: 'lola-hurt-2', length: 0.22, layers: [{ file: 'owner/lola-grunts-2026-10-22.ogg', from: 2.27 }],
    fadeIn: 0.008, fadeOut: 0.06, peak: -3 },
  { name: 'lola-hurt-3', length: 0.11, layers: [{ file: 'owner/lola-grunts-2026-10-22.ogg', from: 4.05 }],
    fadeIn: 0.005, fadeOut: 0.04, peak: -3 },
  { name: 'lola-hurt-4', length: 0.17, layers: [{ file: 'owner/lola-grunts-2026-10-22.ogg', from: 6.51 }],
    fadeIn: 0.008, fadeOut: 0.05, peak: -3 },
  // Lola nearly down: the start of a short scream, cut before it becomes a shriek.
  { name: 'lola-hurt-big', length: 0.55, layers: [{ file: 'opengameart/261419__archeos__womanscream.ogg' }],
    fadeOut: 0.22, peak: -3 },
  // The body thud under every hit Lola takes (two takes).
  { name: 'lola-hit-thud-1', length: 0.35, layers: [{ file: 'kenney/impact-sounds/impactPunch_heavy_001.ogg' }],
    fadeOut: 0.12, peak: -2 },
  { name: 'lola-hit-thud-2', length: 0.35, layers: [{ file: 'kenney/impact-sounds/impactPunch_heavy_003.ogg' }],
    fadeOut: 0.12, peak: -2 },
  // The Leaper crouching to stomp (its red ring on the ground): a slow hydraulic groan.
  { name: 'leaper-stomp-windup', length: 0.8, layers: [
    { file: 'kenney/sci-fi-sounds/thrusterFire_001.ogg', from: 1, speed: 0.55, lowpass: 900, fadeIn: 0.5 },
  ], fadeOut: 0.12, peak: -4 },
  // The stomp: a hard metal slam over a low boom, pitched down to sound heavy.
  { name: 'leaper-stomp', length: 1.1, layers: [
    { file: 'kenney/sci-fi-sounds/impactMetal_003.ogg', gain: 0.9, speed: 0.8 },
    { file: 'kenney/sci-fi-sounds/lowFrequency_explosion_001.ogg', gain: 0.8, speed: 0.85 },
  ], fadeOut: 0.3, peak: -1 },
  // Crouching to pounce (its landing spot marked): a servo winding up.
  { name: 'leaper-leap-windup', length: 0.7, layers: [{ file: 'kenney/sci-fi-sounds/forceField_000.ogg', speed: 0.9, fadeIn: 0.4 }],
    fadeOut: 0.1, peak: -4 },
  // Take-off for the leap: a short hydraulic thrust and the push off the ground.
  { name: 'leaper-launch', length: 0.8, layers: [
    { file: 'kenney/sci-fi-sounds/thrusterFire_001.ogg', from: 0.2, gain: 0.8, fadeIn: 0.04 },
    { file: 'kenney/impact-sounds/impactPlate_heavy_002.ogg', gain: 0.6, speed: 0.75 },
  ], fadeOut: 0.35, peak: -2 },
  // Landing after a leap (its shockwave): a heavier plate crash with a long low thump.
  { name: 'leaper-land', length: 1.3, layers: [
    { file: 'kenney/impact-sounds/impactPlate_heavy_001.ogg', gain: 0.9, speed: 0.7 },
    { file: 'kenney/sci-fi-sounds/lowFrequency_explosion_000.ogg', gain: 0.9 },
  ], fadeOut: 0.4, peak: -1 },
  // Knocked off balance by a big hit: a slow metal groan and clank.
  { name: 'leaper-stagger', length: 0.9, layers: [
    { file: 'kenney/sci-fi-sounds/impactMetal_001.ogg', gain: 0.9, speed: 0.5 },
    { file: 'kenney/impact-sounds/impactPlate_heavy_000.ogg', gain: 0.6, speed: 0.65, at: 0.05 },
  ], fadeOut: 0.3, peak: -2 },
  // Too many legs lost: the body crashes to the floor.
  { name: 'leaper-downed', length: 1.3, layers: [
    { file: 'kenney/impact-sounds/impactPlate_heavy_001.ogg', gain: 0.9, speed: 0.55 },
    { file: 'kenney/sci-fi-sounds/lowFrequency_explosion_001.ogg', gain: 0.8, speed: 0.75 },
  ], fadeOut: 0.4, peak: -1 },
  // Death collapse: metal crunching and folding, a slam, then the boom settling.
  { name: 'leaper-collapse', length: 2.2, layers: [
    { file: 'kenney/sci-fi-sounds/explosionCrunch_004.ogg', gain: 0.8 },
    { file: 'kenney/impact-sounds/impactMetal_heavy_001.ogg', gain: 0.8, speed: 0.6, at: 0.05 },
    { file: 'kenney/sci-fi-sounds/lowFrequency_explosion_000.ogg', gain: 0.7, speed: 0.8, at: 0.25 },
  ], fadeOut: 0.6, peak: -1 },
  // The fight is decided (won or lost, owner 2026-10-22): one big cinematic
  // impact before the end screen. A heavy metal slam slowed right down, two deep
  // explosions and a synthesised sub-bass thump, ringing out for about 3 s.
  { name: 'game-end-impact', length: 3.2, layers: [
    { file: 'kenney/impact-sounds/impactMetal_heavy_001.ogg', gain: 0.9, speed: 0.5 },
    { file: 'kenney/sci-fi-sounds/lowFrequency_explosion_000.ogg', gain: 1, speed: 0.7 },
    { file: 'kenney/sci-fi-sounds/lowFrequency_explosion_001.ogg', gain: 0.7, speed: 0.6, at: 0.03 },
    { file: 'kenney/sci-fi-sounds/explosionCrunch_004.ogg', gain: 0.45, speed: 0.75, lowpass: 2500 },
    { tones: [
      { at: 0, hz: 42, decay: 0.7, gain: 0.9, partials: [[1, 1], [2, 0.3]] },
      { at: 0, hz: 84, decay: 0.25, gain: 0.35 },
    ] },
  ], fadeOut: 1.2, peak: -1 },
  // A leg joint bursting (with its sparks): a quick electrical crackle.
  { name: 'leaper-joint-burst', length: 0.3, layers: [
    { file: 'kenney/interface-sounds/glitch_001.ogg', gain: 0.9 },
    { file: 'kenney/interface-sounds/glitch_002.ogg', gain: 0.7, at: 0.05 },
    { file: 'kenney/interface-sounds/glitch_004.ogg', gain: 0.8, at: 0.11 },
    { file: 'kenney/interface-sounds/glitch_003.ogg', gain: 0.5, at: 0.18 },
    { file: 'kenney/sci-fi-sounds/impactMetal_002.ogg', gain: 0.4, speed: 1.4 },
  ], fadeOut: 0.08, peak: -4 },
  // The eye starts charging a bolt (its 0.6 s warning): an energy hum swelling in.
  { name: 'leaper-charge', length: 0.7, layers: [{ file: 'kenney/sci-fi-sounds/forceField_001.ogg', fadeIn: 0.3 }],
    fadeOut: 0.1, peak: -4 },
  // The eye's aim locks (the last moment before the bolt): a sharp click.
  { name: 'leaper-lock', length: 0.3, layers: [
    { file: 'kenney/interface-sounds/tick_004.ogg' },
    { file: 'kenney/interface-sounds/switch_003.ogg', gain: 0.5 },
  ], fadeOut: 0.12, peak: -4 },
  // A laser bolt hitting cover.
  { name: 'leaper-bolt-impact', length: 0.45, layers: [{ file: 'kenney/sci-fi-sounds/impactMetal_002.ogg' }],
    fadeOut: 0.15, peak: -3 },
  // Menu and button clicks.
  { name: 'ui-click', layers: [{ file: 'kenney/interface-sounds/select_001.ogg' }], fadeOut: 0.01, peak: -6 },
  // Taking a health pill: three bright, bell-like notes rising (G5, C6, G6) with
  // a soft high shimmer: a "healed" sparkle. Synthesised, no original.
  { name: 'pickup-health', length: 0.8, layers: [{ tones: [
    { at: 0, hz: 784, decay: 0.22, gain: 0.7, partials: [[1, 1], [2, 0.25], [3, 0.08]] },
    { at: 0.075, hz: 1047, decay: 0.24, gain: 0.7, partials: [[1, 1], [2, 0.25], [3, 0.08]] },
    { at: 0.15, hz: 1568, decay: 0.32, gain: 0.75, partials: [[1, 1], [2, 0.2], [3, 0.06]] },
    { at: 0.15, hz: 3136, decay: 0.4, gain: 0.12, partials: [[1, 1], [1.005, 0.8]] },
  ] }], fadeOut: 0.12, peak: -4 },
  // Taking an ammo bullet: a soft brass tick, then two quick warm notes rising
  // a fifth (E5, B5), lower and shorter than the pill's sparkle so the two are
  // told apart. Replaced the clicks-and-metal-ring take on 2026-10-21 (owner: it
  // sounded weird). Synthesised, no original.
  { name: 'pickup-ammo', length: 0.6, layers: [
    { clicks: [{ at: 0, decay: 0.004, gain: 0.4, hz: 3200 }] },
    { tones: [
      { at: 0, hz: 220, decay: 0.06, gain: 0.45, partials: [[1, 1], [2, 0.2]] },
      { at: 0, hz: 659, decay: 0.1, gain: 0.6, partials: [[1, 1], [2, 0.4], [3, 0.15]] },
      { at: 0.09, hz: 988, decay: 0.22, gain: 0.7, partials: [[1, 1], [2, 0.35], [3, 0.12]] },
    ] },
  ], fadeOut: 0.12, peak: -4 },
  // The yard's background: a dark machine hum under gusts of wind, looping.
  { name: 'yard-ambience', rate: 24000, length: 10, loop: 1.5, pad: 0.25, layers: [
    { file: 'kenney/sci-fi-sounds/spaceEngineLow_001.ogg', gain: 0.35, lowpass: 260, tile: 0.8 },
    { wind: { seed: 7, gain: 1 } },
  ], peak: -6 },
];

// ---- Reading and writing sound ----

// An original as mono floating-point samples at `rate`.
function decode(file, rate) {
  const raw = execFileSync(FFMPEG, ['-v', 'error', '-i', path.join(SOURCES, file), '-ac', '1', '-ar', String(rate),
    '-f', 'f32le', 'pipe:1'], { maxBuffer: 1 << 28 });
  return new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4).slice();
}

// Mono 16-bit PCM WAV bytes.
function wav(samples, rate) {
  const bytes = Buffer.alloc(44 + samples.length * 2);
  bytes.write('RIFF', 0, 'latin1');
  bytes.writeUInt32LE(36 + samples.length * 2, 4);
  bytes.write('WAVEfmt ', 8, 'latin1');
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24);
  bytes.writeUInt32LE(rate * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36, 'latin1');
  bytes.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((value, i) => bytes.writeInt16LE(Math.round(Math.max(-1, Math.min(1, value)) * 32767), 44 + i * 2));
  return bytes;
}

// ---- Small sound tools ----

// Slower playback (speed < 1) lowers the pitch and stretches the sound.
function changeSpeed(samples, speed) {
  if (speed === 1) return samples;
  const out = new Float32Array(Math.floor(samples.length / speed));
  for (let i = 0; i < out.length; i += 1) {
    const x = i * speed, k = Math.floor(x), t = x - k;
    out[i] = (samples[k] ?? 0) * (1 - t) + (samples[k + 1] ?? 0) * t;
  }
  return out;
}

// One-pole low-pass filter (soft treble cut above `hz`).
function lowpass(samples, hz, rate) {
  const a = 1 - Math.exp(-2 * Math.PI * hz / rate);
  let y = 0;
  return samples.map((x) => (y += a * (x - y)));
}

// Linear fade in over the first `seconds`, or out over the last.
function fade(samples, rate, fadeIn = 0, fadeOut = 0) {
  const inLength = Math.round(fadeIn * rate), outLength = Math.round(fadeOut * rate);
  for (let i = 0; i < inLength && i < samples.length; i += 1) samples[i] *= i / inLength;
  for (let i = 0; i < outLength && i < samples.length; i += 1) samples[samples.length - 1 - i] *= i / outLength;
  return samples;
}

// Repeat a steady sound to `length` samples, blending each repeat into the
// next over `crossfade` seconds so the joins can't be heard.
function tile(samples, length, crossfade, rate) {
  const blend = Math.round(crossfade * rate), step = samples.length - blend;
  const out = new Float32Array(length);
  for (let start = 0; start < length; start += step) {
    for (let i = 0; i < samples.length && start + i < length; i += 1) {
      const rise = start > 0 && i < blend ? Math.sqrt(i / blend) : 1;
      const fall = i >= step && start + step < length ? Math.sqrt(1 - (i - step) / blend) : 1;
      out[start + i] += samples[i] * rise * fall;
    }
  }
  return out;
}

// A seeded random number generator (mulberry32), so the wind is the same every build.
function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Wind: brown noise through a band whose brightness and loudness drift in slow gusts.
function wind(length, rate, seed) {
  const next = random(seed);
  const out = new Float32Array(length);
  // Three slow drifts (periods 7-17 s) with random phases make the gusts.
  const drifts = [7.3, 11.1, 17.9].map((period) => ({ period, phase: next() * Math.PI * 2 }));
  let brown = 0, low = 0, high = 0;
  for (let i = 0; i < length; i += 1) {
    const time = i / rate;
    const gust = drifts.reduce((sum, { period, phase }) => sum + Math.sin(2 * Math.PI * time / period + phase), 0) / 3;
    brown = brown * 0.995 + (next() * 2 - 1) * 0.05;
    const cutoff = 380 + 260 * gust;
    low += (1 - Math.exp(-2 * Math.PI * cutoff / rate)) * (brown - low);
    high += (1 - Math.exp(-2 * Math.PI * 90 / rate)) * (low - high);
    out[i] = (low - high) * (0.55 + 0.45 * gust);
  }
  return out;
}

// Synthesised notes: each a quick 3 ms attack into an exponential decay, made of
// sine partials (multiples of its pitch, each with its own gain).
function tones(notes, length, rate) {
  const out = new Float32Array(length);
  for (const { at = 0, hz, decay, gain = 1, partials = [[1, 1]] } of notes) {
    const start = Math.round(at * rate);
    for (let i = 0; start + i < length; i += 1) {
      const t = i / rate;
      const envelope = (1 - Math.exp(-t / 0.003)) * Math.exp(-t / decay);
      if (envelope < 1e-5 && t > decay) break;
      let value = 0;
      for (const [multiple, share] of partials) value += Math.sin(2 * Math.PI * hz * multiple * t) * share;
      out[start + i] += value * envelope * gain;
    }
  }
  return out;
}

// Synthesised clicks: seeded noise bursts with a sharp decay, filtered to a
// band around `hz` (a low-pass above it minus a low-pass well below it).
function clicks(list, length, rate, seed = 3) {
  const next = random(seed);
  const out = new Float32Array(length);
  for (const { at = 0, decay, gain = 1, hz = 2500 } of list) {
    const start = Math.round(at * rate);
    const above = 1 - Math.exp(-2 * Math.PI * hz * 1.6 / rate), below = 1 - Math.exp(-2 * Math.PI * hz * 0.4 / rate);
    let low = 0, lower = 0;
    for (let i = 0; start + i < length && i < rate * decay * 8; i += 1) {
      const noise = (next() * 2 - 1) * Math.exp(-i / rate / decay);
      low += above * (noise - low);
      lower += below * (low - lower);
      out[start + i] += (low - lower) * gain * 3;
    }
  }
  return out;
}

// Make a file of `length` samples loop seamlessly: the extra `blend` samples
// after the end are crossfaded into its start.
function seamless(samples, length, blend) {
  const out = samples.slice(0, length);
  for (let i = 0; i < blend; i += 1) {
    const share = i / blend;
    out[i] = samples[i] * Math.sqrt(share) + samples[length + i] * Math.sqrt(1 - share);
  }
  return out;
}

// A seamless loop with `pad` samples of itself before and after: any window
// of the loop's length inside the result loops just as seamlessly.
function wrap(loop, pad) {
  const out = new Float32Array(loop.length + 2 * pad);
  out.set(loop.subarray(loop.length - pad), 0);
  out.set(loop, pad);
  out.set(loop.subarray(0, pad), pad + loop.length);
  return out;
}

// ---- One recipe ----

function make(recipe) {
  const rate = recipe.rate ?? 44100;
  const blend = Math.round((recipe.loop ?? 0) * rate);
  // 1. Every layer as samples, placed in the mix.
  const layers = recipe.layers.map((layer) => {
    let samples;
    if (layer.wind) samples = wind(Math.round((recipe.length ?? 1) * rate) + blend, rate, layer.wind.seed);
    else if (layer.tones) samples = tones(layer.tones, Math.round((recipe.length ?? 1) * rate), rate);
    else if (layer.clicks) samples = clicks(layer.clicks, Math.round((recipe.length ?? 1) * rate), rate);
    else {
      samples = decode(layer.file, rate).subarray(Math.round((layer.from ?? 0) * rate));
      samples = changeSpeed(samples, layer.speed ?? 1);
      if (layer.lowpass) samples = lowpass(samples, layer.lowpass, rate);
      if (layer.tile) samples = tile(samples, Math.round(recipe.length * rate) + blend, layer.tile, rate);
      samples = fade(Float32Array.from(samples), rate, layer.fadeIn, layer.fadeOut);
    }
    const gain = layer.gain ?? layer.wind?.gain ?? 1;
    return { samples, gain, at: Math.round((layer.at ?? 0) * rate) };
  });
  // 2. Mix them (the length is the recipe's, else the longest layer).
  const length = recipe.length ? Math.round(recipe.length * rate)
    : Math.max(...layers.map(({ samples, at }) => samples.length + at));
  let mix = new Float32Array(length + blend);
  for (const { samples, gain, at } of layers) {
    for (let i = 0; i < samples.length && at + i < mix.length; i += 1) mix[at + i] += samples[i] * gain;
  }
  // 3. Loop seam or fades, then the loudest sample at the recipe's peak.
  mix = blend ? seamless(mix, length, blend) : fade(mix.subarray(0, length), rate, recipe.fadeIn, recipe.fadeOut);
  if (recipe.pad) mix = wrap(mix, Math.round(recipe.pad * rate));
  const loudest = mix.reduce((max, value) => Math.max(max, Math.abs(value)), 0) || 1;
  const scale = 10 ** ((recipe.peak ?? -1) / 20) / loudest;
  return wav(mix.map((value) => value * scale), rate);
}

// ---- Run (all recipes, or only the names given on the command line) ----

const chosen = process.argv.slice(2);
for (const recipe of RECIPES.filter(({ name }) => !chosen.length || chosen.includes(name))) {
  const bytes = make(recipe);
  fs.writeFileSync(path.join(OUT, `${recipe.name}.wav`), bytes);
  console.log(`assets/audio/${recipe.name}.wav: ${bytes.length} bytes`);
}
