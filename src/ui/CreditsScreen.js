import { creditSections } from './credits.js';

// The CREDITS screen's page side. The sound list comes from the audio asset
// manifests found in the repository when the game is built (whichever of these
// exist: assets/audio/*.json, src/audio/*.json), so a manifest the audio work
// adds or extends (authors, links, licences) shows up here without a code change.
// (Bundled with the game: they are a few kilobytes, and a lazy import here would
// make the game's file depend on the page's entry file.)
const MANIFESTS = import.meta.glob(['/assets/audio/*.json', '/src/audio/*.json'], { eager: true, import: 'default' });

// Every manifest merged into one { soundName: entry } table. A manifest may be
// { name: entry }, [{ name, ... }], or { sounds: one of those }; `manifests` maps
// file names to their contents (or to functions loading them).
export async function loadSoundManifest(manifests = MANIFESTS) {
  const merged = {};
  for (const manifest of Object.values(manifests)) {
    try {
      const data = typeof manifest === 'function' ? await manifest() : manifest;
      const sounds = data?.sounds ?? data;
      const entries = Array.isArray(sounds) ? sounds.map((entry) => [entry.name ?? entry.source, entry]) : Object.entries(sounds ?? {});
      for (const [name, entry] of entries) {
        if (entry && typeof entry === 'object' && (entry.source || entry.author || entry.license || entry.licence)) {
          merged[name] = { ...merged[name], ...entry };
        }
      }
    } catch { /* A manifest that fails to load is skipped; the rest still show. */ }
  }
  return merged;
}

// Fill the screen: one section per heading, one line per credit.
export function buildCredits(body) {
  const list = document.createElement('div');
  list.className = 'credits';
  list.textContent = 'Loading credits…';
  body.append(list);
  loadSoundManifest().then((manifest) => {
    list.textContent = '';
    for (const { heading, lines } of creditSections(manifest)) {
      const section = document.createElement('section');
      section.className = 'credits-section';
      const title = document.createElement('h3');
      title.textContent = heading;
      const items = document.createElement('ul');
      for (const line of lines) items.append(Object.assign(document.createElement('li'), { textContent: line }));
      section.append(title, items);
      list.append(section);
    }
  });
}
