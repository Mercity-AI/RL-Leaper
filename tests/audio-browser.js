// Browser checks for the audio engine (src/audio/): every sound in the manifest
// downloads and decodes in this browser's format, 3D sounds really come from
// the side the listener hears them on (rendered offline and measured per ear),
// and the credits view lists everyone the licences name. Run with
// `pnpm test:browser` (headless Chromium).
import * as THREE from 'three';
import { AudioService } from '../src/audio/AudioService.js';
import { AudioSettings } from '../src/audio/AudioSettings.js';
import { supportedFormats } from '../src/audio/formats.js';
import { CreditsView } from '../src/ui/CreditsView.js';
import SOUNDS from '../src/audio/sounds.json' with { type: 'json' };

const result = document.querySelector('#results');
const views = document.querySelector('#views');
let passed = 0;
function check(condition, label) {
  if (!condition) throw new Error(label);
  passed += 1;
  result.textContent += `\nPASS ${label}`;
}

// An offline context (renders as fast as it can, no speakers) that reports
// itself running, since the engine only starts sounds on a running device.
function offlineContext(seconds = 1, rate = 44100) {
  const context = new OfflineAudioContext(2, Math.round(seconds * rate), rate);
  Object.defineProperty(context, 'state', { get: () => 'running' });
  return context;
}

// Loudness of each ear in a rendered buffer (root mean square).
function ears(buffer) {
  const rms = (channel) => {
    const data = buffer.getChannelData(channel);
    let sum = 0;
    for (let i = 0; i < data.length; i += 1) sum += data[i] * data[i];
    return Math.sqrt(sum / data.length);
  };
  return { left: rms(0), right: rms(1) };
}

// Render half a second of noise played at `at` through the engine's 3D path,
// with the ears placed by `place(service)`. quality 'high' = HRTF.
async function renderAt(at, place, quality = 'medium') {
  const context = offlineContext();
  const manifest = { sounds: [{ id: 'probe', bus: 'creature', gain: 1, priority: 5, spatial: true, variations: [] }], sources: {} };
  const service = new AudioService({ manifest, settings: new AudioSettings({ storage: null }), createContext: () => context,
    quality, listen: false, random: () => 0.5 });
  service.unlock();
  await service.ready;
  const noise = context.createBuffer(1, context.sampleRate / 2, context.sampleRate);
  let seed = 1;
  const data = noise.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) data[i] = ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  place(service);
  const voice = service.play('probe', { buffer: noise, at });
  if (!voice?.panner) throw new Error('the probe voice has no 3D panner');
  return { ...ears(await context.startRendering()), voice };
}

try {
  result.textContent = 'AUDIO CHECKS';

  // 1. Every take in the manifest downloads in this browser's best format and decodes.
  const decoder = offlineContext();
  const service = new AudioService({ settings: new AudioSettings({ storage: null }), createContext: () => decoder, listen: false });
  service.unlock();
  await service.ready;
  const takes = SOUNDS.sounds.flatMap((sound) => sound.variations);
  const best = supportedFormats()[0];
  const missing = takes.filter((variation) => !(service.buffers.get(variation.name)?.duration > 0.01)).map((variation) => variation.name);
  check(!missing.length, `all ${takes.length} takes decode as ${best} (missing: ${missing.join(', ') || 'none'})`);
  // (Only real downloads: the development server also serves each file's URL as a tiny module.)
  const audioRequests = performance.getEntriesByType('resource').filter((entry) => entry.initiatorType === 'fetch')
    .map((entry) => entry.name).filter((name) => /\.(ogg|m4a|wav)(\?|$)/.test(name));
  check(audioRequests.length === takes.length, `one download per take (${audioRequests.length})`);
  check(audioRequests.every((name) => name.includes('/assets/build/audio/') && name.endsWith(`.${best}`)), 'only the compressed copies are downloaded');
  const walk = service.buffers.get('lola-walk');
  check(walk.duration > 5.6 && walk.duration < 6.2, `the walk copy keeps only the 5.8 s it plays (${walk.duration.toFixed(2)} s)`);
  const bed = service.buffers.get('yard-ambience');
  const region = SOUNDS.sounds.find((sound) => sound.id === 'yardAmbience').loop;
  check(bed.duration >= region.end, 'the ambience bed decodes, with its whole loop region');
  // The bed loops without a seam: the part played after the loop's end is the
  // same as its start (the file repeats a little of the loop on both sides),
  // and the jump at the loop point is no bigger than an ordinary step.
  const samples = bed.getChannelData(0);
  const start = Math.round(region.start * bed.sampleRate), end = Math.round(region.end * bed.sampleRate);
  let difference = 0, level = 0, typical = 0;
  for (let i = 0; i < 2000; i += 1) {
    difference += (samples[end + i] - samples[start + i]) ** 2;
    level += samples[start + i] ** 2;
    if (i) typical = Math.max(typical, Math.abs(samples[start + i] - samples[start + i - 1]));
  }
  check(Math.sqrt(difference / level) < 0.2, `the ambience file repeats its loop past the end (difference ${Math.sqrt(difference / level).toFixed(3)})`);
  const jump = Math.abs(samples[start] - samples[end - 1]);
  check(jump <= typical * 1.5, `the ambience loop point has no click (${jump.toFixed(4)} vs ${typical.toFixed(4)})`);

  // 2. 3D sound: a sound to the listener's right is louder in the right ear,
  //    and turning the listener around moves it to the left ear.
  const facingNorth = (s) => s.setListener({ position: { x: 0, y: 0, z: 0 }, forward: { x: 0, y: 0, z: -1 }, up: { x: 0, y: 1, z: 0 } });
  const facingSouth = (s) => s.setListener({ position: { x: 0, y: 0, z: 0 }, forward: { x: 0, y: 0, z: 1 }, up: { x: 0, y: 1, z: 0 } });
  const right = await renderAt({ x: 5, y: 0, z: 0 }, facingNorth);
  check(right.right > right.left * 4, `a sound on the right plays in the right ear (L ${right.left.toFixed(3)} R ${right.right.toFixed(3)})`);
  const turned = await renderAt({ x: 5, y: 0, z: 0 }, facingSouth);
  check(turned.left > turned.right * 4, `turning the listener around moves it to the left ear (L ${turned.left.toFixed(3)} R ${turned.right.toFixed(3)})`);
  check(right.voice.panner.panningModel === 'equalpower', 'medium quality uses simple panning');
  // High quality asks the browser for HRTF. (Only checked, not rendered: an
  // offline render waits for the browser's HRTF data, which can stall headless.)
  const highContext = offlineContext(0.1);
  const high = new AudioService({ manifest: { sounds: [{ id: 'probe', bus: 'creature', gain: 1, priority: 5, variations: [] }], sources: {} },
    settings: new AudioSettings({ storage: null }), createContext: () => highContext, quality: 'high', listen: false });
  high.unlock();
  const probe = high.play('probe', { buffer: highContext.createBuffer(1, 128, highContext.sampleRate), at: { x: 5, y: 0, z: 0 } });
  check(probe.panner.panningModel === 'HRTF', 'high quality uses HRTF 3D sound');
  high.dispose();
  // The ears follow a real three.js camera: looking down -Z, then turned to look down +Z.
  const camera = new THREE.PerspectiveCamera();
  camera.updateMatrixWorld();
  const chase = await renderAt({ x: 5, y: 0, z: 0 }, (s) => s.followCamera(camera));
  camera.rotation.y = Math.PI;
  camera.updateMatrixWorld();
  const behind = await renderAt({ x: 5, y: 0, z: 0 }, (s) => s.followCamera(camera));
  check(chase.right > chase.left * 4 && behind.left > behind.right * 4, 'the listener turns with the camera');
  // Distance: the same sound far away is much quieter.
  const near = await renderAt({ x: 0, y: 0, z: -6 }, facingNorth);
  const far = await renderAt({ x: 0, y: 0, z: -48 }, facingNorth);
  const loudness = (e) => e.left + e.right;
  check(loudness(far) < loudness(near) * 0.3, `a far sound is quieter (${(loudness(far) / loudness(near)).toFixed(2)} of near)`);

  // 3. The credits view: every author the licences name, links that open safely, BACK and Escape.
  let closed = 0;
  const credits = new CreditsView(views, { onClose: () => { closed += 1; } });
  const text = credits.element.textContent;
  for (const name of ['Artninja', 'gpag1', 'Luca2399', 'Astounded', 'qubodup', 'OGsoundFX', 'TB0Y298', 'Kenney', 'three.js']) {
    check(text.includes(name), `the credits name ${name}`);
  }
  check(text.indexOf('Sounds that require credit') < text.indexOf('Public-domain sounds'), 'required credits come first');
  const links = [...credits.element.querySelectorAll('a')];
  check(links.length > 10 && links.every((link) => link.target === '_blank' && link.rel.includes('noopener')), 'links open in a new tab safely');
  credits.back.click();
  credits.element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  check(closed === 2, 'BACK and Escape close the credits');
  credits.hide();
  check(credits.element.hidden, 'hide() hides it');
  credits.show();
  check(!credits.element.hidden && document.activeElement === credits.element, 'show() shows it and moves focus to it');

  result.textContent += `\nALL ${passed} CHECKS PASSED`;
  document.title = `PASS ${passed} · Audio`;
} catch (error) {
  result.textContent += `\nFAIL ${error.message}`;
  document.title = `FAIL · ${error.message}`;
  console.error(error);
}
