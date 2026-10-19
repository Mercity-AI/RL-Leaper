// A pretend Web Audio API for the Node audio tests: every node remembers what it
// is connected to, every parameter its value, so a test can follow a voice from
// its recording to the speakers and read the volumes and 3D settings on the way.

// (peak: the loudest value an automation call set, since an envelope's last ramp ends at 0.)
export class FakeParam {
  constructor(value = 0) {
    this.value = value;
    this.peak = 0;
  }
  setValueAtTime(value) { this.set(value); }
  linearRampToValueAtTime(value) { this.set(value); }
  setTargetAtTime(value) { this.set(value); }
  cancelScheduledValues() {}
  set(value) {
    this.value = value;
    this.peak = Math.max(this.peak, value);
  }
}

class FakeNode {
  constructor(kind) {
    this.kind = kind;
    this.outputs = [];
  }
  connect(node) { this.outputs.push(node); return node; }
  disconnect() { this.outputs = []; }
}

export class FakeContext {
  constructor({ state = 'running', panner = true } = {}) {
    this.state = state;
    this.currentTime = 0;
    this.destination = new FakeNode('destination');
    this.sources = [];
    this.panners = [];
    if (!panner) this.createPanner = undefined;
    const param = () => new FakeParam(0);
    this.listener = { positionX: param(), positionY: param(), positionZ: param(),
      forwardX: param(), forwardY: param(), forwardZ: param(), upX: param(), upY: param(), upZ: param() };
  }
  createGain() {
    const node = new FakeNode('gain');
    node.gain = new FakeParam(1);
    return node;
  }
  createDynamicsCompressor() {
    const node = new FakeNode('limiter');
    for (const key of ['threshold', 'knee', 'ratio', 'attack', 'release']) node[key] = new FakeParam(0);
    return node;
  }
  createPanner() {
    const node = new FakeNode('panner');
    node.positionX = new FakeParam(0);
    node.positionY = new FakeParam(0);
    node.positionZ = new FakeParam(0);
    this.panners.push(node);
    return node;
  }
  createBufferSource() {
    const node = new FakeNode('source');
    node.playbackRate = new FakeParam(1);
    node.start = (...args) => { node.started = args; };
    node.stop = (...args) => { node.stopped = args; node.onended?.(); };
    this.sources.push(node);
    return node;
  }
  async decodeAudioData(bytes) {
    if (bytes?.broken) throw new Error('not audio');
    return { duration: 1, sampleRate: 100, bytes, getChannelData: () => new Float32Array(200).fill(0.1) };
  }
  async resume() { this.state = 'running'; }
  async suspend() { this.state = 'suspended'; }
  async close() { this.state = 'closed'; }
}

// The chain of node kinds from a node to the speakers (first connection each step).
export function route(node) {
  const kinds = [];
  for (let at = node; at; at = at.outputs?.[0]) kinds.push(at.kind);
  return kinds;
}

// A fetch() that answers every URL with a small sound and records what was asked.
// types: URL substring -> content-type (default audio/ogg); bad: URLs that 404.
export function fakeFetch({ types = {}, missing = [], broken = [] } = {}) {
  const asked = [];
  const fetch = async (url) => {
    asked.push(String(url));
    const name = String(url);
    if (missing.some((part) => name.includes(part))) {
      return { ok: true, status: 200, headers: new Map([['content-type', 'text/html']]), arrayBuffer: async () => new ArrayBuffer(4) };
    }
    const type = Object.entries(types).find(([part]) => name.includes(part))?.[1] ?? 'audio/ogg';
    const bytes = new ArrayBuffer(8);
    if (broken.some((part) => name.includes(part))) bytes.broken = true;
    return { ok: true, status: 200, headers: new Map([['content-type', type]]), arrayBuffer: async () => bytes };
  };
  return { fetch, asked };
}

// A small manifest for engine tests (the real one is checked on its own).
export function testManifest() {
  const take = (name) => ({ name, files: { ogg: `assets/build/audio/${name}.ogg`, m4a: `assets/build/audio/${name}.m4a` }, credits: ['cc0'] });
  return {
    sounds: [
      { id: 'shot', bus: 'weapons', gain: 0.5, priority: 6, maxVoices: 2, spatial: false, variations: [take('shot')] },
      { id: 'boom', bus: 'creature', gain: 1, priority: 8, spatial: true, distance: { ref: 10 }, variations: [take('boom')] },
      { id: 'hiss', bus: 'creature', gain: 1, priority: 2, spatial: true, variations: [take('hiss')] },
      { id: 'grunt', bus: 'sfx', gain: 0.7, priority: 9, variation: { pitch: 0.1, volume: 0.2 },
        variations: [take('grunt-1'), take('grunt-2')] },
      { id: 'empty', bus: 'sfx', gain: 1, priority: 5, variations: [] },
      { id: 'bed', bus: 'ambience', gain: 0.3, priority: 10, loop: true, variations: [take('bed')] },
      { id: 'click', bus: 'ui', gain: 0.5, priority: 1, variations: [take('click')] },
    ],
    sources: { cc0: { title: 'T', author: 'A', sourceUrl: 'https://example.org', licence: 'CC0 1.0', attribution: 'T by A', notes: '-' } },
  };
}

// Config with small limits so the voice rules are easy to hit.
export const TEST_CONFIG = Object.freeze({
  buses: {
    weapons: { level: 1, group: 'sfx', maxVoices: 3 },
    creature: { level: 0.8, group: 'sfx', maxVoices: 2 },
    footsteps: { level: 1, group: 'sfx', maxVoices: 4 },
    sfx: { level: 1, group: 'sfx', maxVoices: 4 },
    ui: { level: 0.6, group: 'ui', maxVoices: 2 },
    ambience: { level: 0.5, group: 'ambience', maxVoices: 1 },
  },
  maxVoices: 6,
  limiter: { threshold: -3, knee: 0, ratio: 20, attack: 0.003, release: 0.25 },
  positional: { ref: 6, max: 120, rolloff: 1, model: 'inverse', hrtfOn: ['high'] },
  listener: { maxDistanceFromPlayer: 10 },
  staleAfter: 0.25,
  stopFade: 0,
  volumeGlide: 0,
});
