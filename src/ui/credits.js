// The CREDITS screen's list, as plain data. Sound credits come from the audio
// asset manifest (assets/audio/sources.json, kept by the audio work): one line
// per source recording, with its author, link and licence. Where the manifest
// does not record those yet, they are read from the Freesound file name and the
// known licences below, so every recording is still credited.
//
// Extension point: registerCredits(section) adds a section (e.g. new sounds or
// art) from any module, without touching this file.

// Freesound names its downloads "<id>__<author>__<title>.<ext>".
export function freesoundInfo(file) {
  const match = /^(\d+)__([^_]+(?:_[^_]+)*?)__(.+?)(\.\w+)?$/.exec(String(file ?? ''));
  if (!match) return null;
  const [, id, author, title] = match;
  return { id, author, title: title.replace(/[_-]+/g, ' ').trim(), url: `https://freesound.org/s/${id}/` };
}

// Licences already checked on the Freesound pages (code review of 2026-10-18,
// finding ui-audio-no-attribution-or-provenance), used until the manifest
// records its own. The two M416 sounds (766092) are NonCommercial: this game is
// a non-commercial open-source project, so they stay, with this credit.
export const KNOWN_LICENCES = Object.freeze({
  766092: 'CC BY-NC 4.0',
  812326: 'CC BY 4.0 (credit artninja and gpag1)',
  479353: 'CC0',
  816019: 'CC0',
  856942: 'CC0',
  870197: 'CC0',
  873903: 'CC0',
  154934: 'CC0',
});

// Recordings documented outside the manifest (assets/audio/FOOTSTEPS.md and
// public/audio/SOUND-SLOTS.md), so they are credited too.
export const DOCUMENTED_SOUNDS = Object.freeze({
  'lola-run': '816019__qubodup__fps-footsteps-loop.wav',
  'lola-walk': '856942__artemditkovsky__footsteps.wav',
  'leaper-walk': '812326__artninja__spider_robot_designed_walk_andor_inspired_06162025.wav',
  'leaper-knee-break': '423117__ogsoundfx__guns-explosions-album-metal-impact-5.wav',
  'gun-empty': '154934__klawykogut__empty-gun-shot.wav',
});

// One credit per source recording: { title, author, url, licence, attribution, uses }.
// manifest: { name: { source, author?, url?, license?|licence?, attribution?, title? } }
// (or an array of such entries with a `name`).
export function soundCredits(manifest = {}, documented = DOCUMENTED_SOUNDS) {
  const entries = Array.isArray(manifest)
    ? manifest.map((entry) => [entry.name ?? entry.source, entry])
    : Object.entries(manifest ?? {});
  for (const [name, source] of Object.entries(documented)) {
    if (!entries.some(([, entry]) => entry?.source === source)) entries.push([name, { source }]);
  }
  // Group the game's sounds by the recording they were cut from.
  const bySource = new Map();
  for (const [name, entry] of entries) {
    const source = entry?.source ?? name;
    const info = freesoundInfo(source);
    const credit = bySource.get(source) ?? {
      title: entry.title ?? info?.title ?? source,
      author: entry.author ?? info?.author ?? 'unknown',
      url: entry.url ?? info?.url ?? '',
      licence: entry.license ?? entry.licence ?? KNOWN_LICENCES[info?.id] ?? 'licence not recorded yet',
      attribution: entry.attribution ?? '',
      uses: [],
    };
    credit.uses.push(name);
    bySource.set(source, credit);
  }
  return [...bySource.values()].sort((a, b) => a.author.localeCompare(b.author) || a.title.localeCompare(b.title));
}

// ---- The whole list ----

// The project itself and the open-source libraries the game runs on.
export const PROJECT_CREDITS = Object.freeze([
  Object.freeze({ heading: 'LEAPER', lines: Object.freeze([
    'Game design, characters and junkyard: the Leaper project',
    'The Leaper\'s movement: a reinforcement-learning brain trained for 7,757,824 steps',
    'A non-commercial, open-source fan project inspired by ARC Raiders',
  ]) }),
  Object.freeze({ heading: 'BUILT WITH', lines: Object.freeze([
    'three.js (MIT licence)',
    'three-mesh-bvh (MIT licence)',
    'ONNX Runtime Web (MIT licence)',
    'Vite (MIT licence)',
  ]) }),
]);

const extraSections = [];

// Add a credits section from anywhere: { heading, lines: [...] }. Returns a remover.
export function registerCredits(section) {
  extraSections.push(section);
  return () => {
    const index = extraSections.indexOf(section);
    if (index >= 0) extraSections.splice(index, 1);
  };
}

// Every section for the CREDITS screen: the project, the sounds, then any added ones.
export function creditSections(manifest = {}) {
  const sounds = soundCredits(manifest).map((credit) =>
    `"${credit.title}" by ${credit.author}, ${credit.licence}${credit.url ? ` (${credit.url})` : ''}`
    + `${credit.attribution ? `. ${credit.attribution}` : ''}`);
  return [...PROJECT_CREDITS, { heading: 'SOUNDS (FREESOUND)', lines: sounds }, ...extraSections];
}
