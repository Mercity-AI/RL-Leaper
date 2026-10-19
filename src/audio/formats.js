// Which sound file the browser gets: Opus in Ogg where it plays (most browsers),
// else AAC in MP4 (older Safari). The WAVs in assets/audio/ are build sources
// only and never shipped. Also turns a manifest file path into a URL.

// Formats in order of preference, with the type the browser is asked about.
export const AUDIO_FORMATS = Object.freeze([
  Object.freeze({ id: 'ogg', type: 'audio/ogg; codecs="opus"' }),
  Object.freeze({ id: 'm4a', type: 'audio/mp4; codecs="mp4a.40.2"' }),
  Object.freeze({ id: 'wav', type: 'audio/wav; codecs="1"' }),
]);

// The formats this browser says it can play, best first. probe: anything with
// canPlayType (an <audio> element); none (Node, tests) means "unknown".
export function supportedFormats(probe = defaultProbe()) {
  if (!probe?.canPlayType) return AUDIO_FORMATS.map((format) => format.id);
  return AUDIO_FORMATS.filter(({ type }) => Boolean(probe.canPlayType(type))).map((format) => format.id);
}

// The order to try a take's files in: supported formats first (best first),
// then the rest, in case the browser's answer was too cautious. files: the
// take's { ogg, m4a, wav } paths (only the ones that exist).
export function formatOrder(files, supported = supportedFormats()) {
  const available = AUDIO_FORMATS.map((format) => format.id).filter((id) => files?.[id]);
  return [...available.filter((id) => supported.includes(id)), ...available.filter((id) => !supported.includes(id))];
}

// The single format the game asks for when it needs one name for all sounds
// (kept for older callers): the best supported compressed one, AAC if unsure.
let pageFormat = null;
export function pickAudioFormat(probe = defaultProbe()) {
  if (pageFormat) return pageFormat;
  const supported = supportedFormats(probe).filter((id) => id !== 'wav');
  pageFormat = supported[0] ?? 'm4a';
  return pageFormat;
}

// A built sound by name ('m416-shot', ...) in a compressed format. The WAV is a
// source only, so asking for 'wav' gives the AAC copy (which every browser that
// lacks Opus plays).
export function audioUrl(name, format = pickAudioFormat()) {
  const id = format === 'ogg' ? 'ogg' : 'm4a';
  return new URL(`../../assets/build/audio/${name}.${id}`, import.meta.url);
}

// The URL of a manifest file path:
//   assets/build/audio/<name>.<ogg|m4a>  bundled by Vite (fingerprinted in a build)
//   public/audio/<file>                  a drop-in file, served as it is from the site root
// Anything else is not a file the game can load (null).
export function fileUrl(file, base = siteBase()) {
  const built = /^assets\/build\/audio\/([\w.-]+)\.(ogg|m4a)$/.exec(file);
  if (built) return new URL(`../../assets/build/audio/${built[1]}.${built[2]}`, import.meta.url).href;
  const dropIn = /^public\/(audio\/[\w.-]+\.(?:ogg|m4a|wav))$/.exec(file);
  if (dropIn) return `${base}${dropIn[1]}`;
  return null;
}

// Drop-in files must prove they are sound (a missing file on many hosts comes
// back as the game's own page with status 200). Built files are checked too,
// but a host that sends no type, or a generic binary type, is trusted for them.
export function isAudioResponse(response, { strict = false } = {}) {
  if (!response?.ok) return false;
  const type = response.headers?.get?.('content-type') ?? null;
  if (type === null) return !strict;
  if (/^audio\//i.test(type)) return true;
  return !strict && /^application\/octet-stream/i.test(type);
}

// Whether a manifest path is a drop-in file (checked strictly).
export const isDropIn = (file) => /^public\//.test(file ?? '');

// The site's base path ('/' locally, '/<repository>/' on GitHub Pages).
function siteBase() {
  return import.meta.env?.BASE_URL ?? '/';
}

// An <audio> element to ask about formats (none outside a browser).
function defaultProbe() {
  return typeof Audio === 'undefined' ? null : new Audio();
}
