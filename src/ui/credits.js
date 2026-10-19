import { PROJECT_CREDITS as BUILT_WITH, soundCredits } from '../audio/credits.js';

// The CREDITS screen's list, as plain data. Everything comes from the audio
// track's sound manifest (src/audio/sounds.json, through src/audio/credits.js):
// the same records CREDITS.md is generated from and tests/audio-licences.test.js
// checks, so the screen and the file can never disagree. Credits that a licence
// requires (CC BY, CC BY-NC) come first, with their exact attribution text.
//
// Extension point: registerCredits(section) adds a section (e.g. new art) from
// any module, without touching this file.

// ---- The list ----

// The game itself, in a few plain words.
export const GAME_CREDITS = Object.freeze({ heading: 'LEAPER', lines: Object.freeze([
  'Game design, characters and junkyard: the Leaper project',
  'The Leaper\'s movement: a reinforcement-learning brain trained for 7,757,824 steps',
  'A non-commercial, open-source fan project inspired by ARC Raiders',
]) });

// What it is built with: the code libraries (with their licence), then the art
// (whose provenance lives in assets/PROVENANCE.md, so only its maker shows here).
export function builtWithSections(entries = BUILT_WITH) {
  const libraries = entries.filter((entry) => entry.licence);
  const art = entries.filter((entry) => !entry.licence);
  return [
    { heading: 'BUILT WITH', lines: libraries.map((entry) => `${entry.title} by ${entry.author} (${entry.licence} licence)`) },
    { heading: 'ART', lines: art.map((entry) => `${entry.title}: ${entry.author}`) },
  ];
}

// One line per recording: its attribution, then what the game uses it for.
export function soundLines(manifest) {
  return soundCredits(manifest).map((credit) => `${credit.attribution}. Used for: ${credit.sounds.join(', ')}.`);
}

const extraSections = [];

// Add a credits section from anywhere: { heading, lines: [...] }. Returns a remover.
export function registerCredits(section) {
  extraSections.push(section);
  return () => {
    const index = extraSections.indexOf(section);
    if (index >= 0) extraSections.splice(index, 1);
  };
}

// Every section for the CREDITS screen: the game, the sounds, what it is built
// with, then any added ones. `manifest` is the sound manifest (default: the game's).
export function creditSections(manifest = undefined) {
  return [GAME_CREDITS, { heading: 'SOUNDS', lines: soundLines(manifest) }, ...builtWithSections(), ...extraSections];
}
