import { AUDIO_CONFIG } from './audioConfig.js';

// Reading the sound manifest (src/audio/sounds.json): checking that it is
// complete, finding a sound or a take, and what each licence asks of us.
// Pure functions: the game, the build scripts and the tests all use them.

// ---- Licences ----

// Every licence the manifest may name, with what it requires. attribution: the
// author must be credited where the game is shown. nonCommercial: no paid,
// ad-supported or promotional use without the author's permission.
export const LICENCES = Object.freeze({
  'CC0 1.0': Object.freeze({ url: 'https://creativecommons.org/publicdomain/zero/1.0/', attribution: false, nonCommercial: false }),
  'CC BY 3.0': Object.freeze({ url: 'https://creativecommons.org/licenses/by/3.0/', attribution: true, nonCommercial: false }),
  'CC BY 4.0': Object.freeze({ url: 'https://creativecommons.org/licenses/by/4.0/', attribution: true, nonCommercial: false }),
  'CC BY-NC 3.0': Object.freeze({ url: 'https://creativecommons.org/licenses/by-nc/3.0/', attribution: true, nonCommercial: true }),
  'CC BY-NC 4.0': Object.freeze({ url: 'https://creativecommons.org/licenses/by-nc/4.0/', attribution: true, nonCommercial: true }),
  // Made by the project itself (it carries the project's own terms).
  'Project original': Object.freeze({ url: null, attribution: false, nonCommercial: false }),
});

// What a source's licence asks for (unknown licences ask for everything).
export function licenceTerms(source) {
  return LICENCES[source?.licence] ?? { url: null, attribution: true, nonCommercial: true, unknown: true };
}

// ---- Looking things up ----

// A sound by id ('m416', 'lolaHurt', ...), or undefined.
export function findSound(manifest, id) {
  return manifest.sounds.find((sound) => sound.id === id);
}

// Every take of every sound, with its sound: [{ sound, variation }].
export function allVariations(manifest) {
  return manifest.sounds.flatMap((sound) => sound.variations.map((variation) => ({ sound, variation })));
}

// The sources a take credits, as records ({ key, ...source }).
export function creditsOf(manifest, variation) {
  return (variation.credits ?? []).map((key) => ({ key, ...manifest.sources[key] }));
}

// ---- Checking the manifest ----

const SOURCE_FIELDS = ['title', 'author', 'sourceUrl', 'licence', 'attribution', 'notes'];
// Where a sound without a given position can play (set by the junkyard mode).
export const EMITTERS = Object.freeze(['leaper', 'leaperEye']);
const FILE_PATTERN = /^(assets\/build\/audio\/[\w.-]+\.(ogg|m4a)|public\/audio\/[\w.-]+\.(ogg|m4a|wav))$/;

// Problems with a manifest, as readable sentences (none = fine), and notes that
// are worth knowing but are not errors (NonCommercial licences).
export function checkManifest(manifest, { buses = AUDIO_CONFIG.buses } = {}) {
  const errors = [];
  const notes = [];
  const ids = new Set();
  const names = new Set();
  // 1. Each sound: unique id, a known bus, sensible numbers.
  for (const sound of manifest.sounds ?? []) {
    const label = `sound "${sound.id}"`;
    if (!sound.id || typeof sound.id !== 'string') errors.push('a sound has no id');
    if (ids.has(sound.id)) errors.push(`${label} is listed twice`);
    ids.add(sound.id);
    if (!buses[sound.bus]) errors.push(`${label} plays on an unknown bus "${sound.bus}"`);
    if (!(sound.gain >= 0 && sound.gain <= 4)) errors.push(`${label} needs a gain between 0 and 4`);
    if (!(sound.priority >= 0 && sound.priority <= 10)) errors.push(`${label} needs a priority from 0 to 10`);
    if (sound.maxVoices !== undefined && !(Number.isInteger(sound.maxVoices) && sound.maxVoices >= 1)) {
      errors.push(`${label} has a bad maxVoices`);
    }
    if (sound.emitter !== undefined && !EMITTERS.includes(sound.emitter)) errors.push(`${label} names an unknown emitter "${sound.emitter}"`);
    if (!Array.isArray(sound.variations)) errors.push(`${label} needs a variations list (empty = silent slot)`);
    // 2. Each take: a unique name, loadable files, credits that exist.
    for (const variation of sound.variations ?? []) {
      const take = `${label} take "${variation.name}"`;
      if (names.has(variation.name)) errors.push(`${take} is listed twice`);
      names.add(variation.name);
      const files = Object.entries(variation.files ?? {});
      if (!files.length) errors.push(`${take} has no files`);
      for (const [format, file] of files) {
        if (!FILE_PATTERN.test(file) || !file.endsWith(`.${format}`)) errors.push(`${take}: "${file}" is not a .${format} file the game can load`);
      }
      if (!variation.credits?.length) errors.push(`${take} credits no source`);
      for (const key of variation.credits ?? []) if (!manifest.sources?.[key]) errors.push(`${take} credits unknown source "${key}"`);
    }
  }
  // 3. Each source: every licence field, a licence we know, an attribution where required.
  for (const [key, source] of Object.entries(manifest.sources ?? {})) {
    for (const field of SOURCE_FIELDS) if (!source[field]) errors.push(`source "${key}" has no ${field}`);
    const terms = licenceTerms(source);
    if (terms.unknown) errors.push(`source "${key}" has an unknown licence "${source.licence}"`);
    if (terms.attribution && !source.attribution?.includes(source.author.split(' (')[0])) {
      errors.push(`source "${key}" (${source.licence}) needs attribution text naming ${source.author}`);
    }
    if (terms.nonCommercial) notes.push(`NOTE: "${source.title}" by ${source.author} is ${source.licence} (NonCommercial): fine for this non-commercial game, not for paid or promotional use.`);
  }
  return { errors, notes };
}
