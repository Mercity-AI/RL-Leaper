import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  QUALITY_PRESETS, QUALITY_NAMES, QUALITY_KEY, autoQuality, pickQuality, setQualityPreference,
  limitShadowCasters, warmUp,
} from '../src/core/Quality.js';
import { prepareJunkyardMap } from '../src/world/createJunkyardWorld.js';
import { junkyardScale } from '../src/world/junkyardCollision.js';
import { createHexapod } from '../src/robot/createHexapod.js';
import { ENCOUNTER } from '../src/config/encounter.js';
import { loadGlb } from './world-helpers.js';

// Graphics quality presets: what each tier turns on, how the tier is chosen,
// the shadow budget and the warm-up before the first frame.

// A stand-in for the browser's localStorage, so the remembered choice can be tested.
function withStorage(run) {
  const store = new Map();
  const previous = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  };
  try { return run(store); } finally { globalThis.localStorage = previous; }
}

// The compressed map the game loads, at the default Leaper size.
const MAP = 'assets/build/maps/junkyard.glb';
const scale = junkyardScale(ENCOUNTER.startWidth);

const desktop = { renderer: 'ANGLE (NVIDIA GeForce RTX 3060)', cores: 12, memory: 16, touch: false, pixelRatio: 1 };

test('three presets, each a full set of settings, getting richer from low to high', () => {
  assert.deepEqual(QUALITY_NAMES, ['low', 'medium', 'high']);
  const fields = ['pixelRatio', 'antialias', 'shadowMapSize', 'softShadows', 'shadowNormalBias', 'shadowMinSize',
    'leaperShadowMinSize', 'bloom', 'sky', 'dust', 'decals'];
  for (const name of QUALITY_NAMES) {
    for (const field of fields) assert.ok(field in QUALITY_PRESETS[name], `${name}.${field}`);
    assert.ok(Object.isFrozen(QUALITY_PRESETS[name]), `${name} is read-only`);
  }
  const { low, medium, high } = QUALITY_PRESETS;
  assert.ok(low.pixelRatio < medium.pixelRatio && medium.pixelRatio < high.pixelRatio, 'sharper with each tier');
  assert.ok(low.shadowMapSize <= medium.shadowMapSize && medium.shadowMapSize <= high.shadowMapSize, 'crisper shadows');
  assert.ok(low.shadowMinSize > medium.shadowMinSize && medium.shadowMinSize > high.shadowMinSize,
    'more small props cast shadows with each tier');
  assert.ok(low.leaperShadowMinSize > medium.leaperShadowMinSize && medium.leaperShadowMinSize > high.leaperShadowMinSize,
    'and more of the Leaper\'s small parts');
  // The optional extras (glow, sky, dust, scorch marks) are off on low.
  assert.equal(low.bloom, null);
  assert.equal(low.dust || low.decals || low.sky || low.antialias, false);
  assert.ok(medium.bloom && high.bloom, 'glow on medium and high');
  assert.ok(high.decals && !medium.decals, 'scorch marks on high only');
});

test('the automatic choice: software rendering low, phones and small machines medium, the rest high', () => {
  assert.equal(autoQuality(desktop), 'high');
  assert.equal(autoQuality({ ...desktop, renderer: 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)))' }), 'low');
  assert.equal(autoQuality({ ...desktop, renderer: 'llvmpipe (LLVM 15.0.7, 256 bits)' }), 'low');
  assert.equal(autoQuality({ ...desktop, touch: true }), 'medium');
  assert.equal(autoQuality({ ...desktop, cores: 4 }), 'medium');
  assert.equal(autoQuality({ ...desktop, memory: 4 }), 'medium');
});

test('?quality= in the address wins, then the remembered choice, then the automatic one', () => {
  withStorage(() => {
    assert.deepEqual(pickQuality({ search: '?quality=low', device: desktop }), { name: 'low', source: 'address' });
    assert.deepEqual(pickQuality({ search: '', device: desktop }), { name: 'high', source: 'auto' });
    setQualityPreference('medium');
    assert.equal(localStorage.getItem(QUALITY_KEY), 'medium');
    assert.deepEqual(pickQuality({ search: '', device: desktop }), { name: 'medium', source: 'saved' });
    assert.deepEqual(pickQuality({ search: '?quality=high', device: desktop }), { name: 'high', source: 'address' });
    // Nonsense in the address or in storage is ignored.
    assert.equal(pickQuality({ search: '?quality=ultra', device: desktop }).name, 'medium');
    setQualityPreference(null);
    assert.equal(localStorage.getItem(QUALITY_KEY), null);
    localStorage.setItem(QUALITY_KEY, 'ultra');
    assert.deepEqual(pickQuality({ search: '', device: desktop }), { name: 'high', source: 'auto' });
  });
});

test('small props stop casting shadows; big ones, kept ones and scaled-up ones keep theirs', () => {
  const root = new THREE.Group();
  const box = (size) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), new THREE.MeshStandardMaterial());
    mesh.castShadow = true;
    root.add(mesh);
    return mesh;
  };
  const small = box(0.2), big = box(2), kept = box(0.2), scaled = box(0.2);
  scaled.scale.setScalar(10);
  const notCasting = box(0.2);
  notCasting.castShadow = false;
  // Bounding radius of a 0.2 box is ~0.17; of a 2 box ~1.7; of the scaled one ~1.7.
  assert.equal(limitShadowCasters(root, 0.5, { keep: [kept] }), 1);
  assert.equal(small.castShadow, false);
  assert.ok(big.castShadow && kept.castShadow && scaled.castShadow);
  assert.equal(limitShadowCasters(root, 0), 0, 'a minimum size of 0 leaves everything casting');
});

test('warm-up uploads each texture once, compiles every shader and can draw one frame', () => {
  const scene = new THREE.Scene();
  const shared = new THREE.Texture();
  const normal = new THREE.Texture();
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ map: shared, normalMap: normal })));
  const hidden = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ map: shared }));
  hidden.visible = false;
  scene.add(hidden);
  const uploads = [], calls = [];
  const renderer = {
    info: { programs: [1, 2, 3] },
    initTexture: (texture) => uploads.push(texture),
    compile: (s, c) => calls.push(['compile', s, c]),
  };
  const camera = new THREE.PerspectiveCamera();
  const result = warmUp(renderer, scene, camera, { render: () => calls.push(['render']) });
  assert.equal(uploads.length, 2, 'the shared texture (also on a hidden mesh) uploads once');
  assert.deepEqual(new Set(uploads), new Set([shared, normal]));
  assert.deepEqual(calls.map(([name]) => name), ['compile', 'render'], 'compile, then one frame');
  assert.equal(calls[0][1], scene);
  assert.ok(hidden.visible === false, 'hidden things stay hidden');
  assert.deepEqual(result, { textures: 2, programs: 3 });
});

test('the shadow budget: low quality drops the small loose tires, never the floor and walls', async () => {
  const counts = {};
  for (const name of ['low', 'medium', 'high']) {
    const map = (await loadGlb(MAP)).scene;
    const { floor } = prepareJunkyardMap(map, scale, { accelerate: false });
    limitShadowCasters(map, QUALITY_PRESETS[name].shadowMinSize, { keep: [floor] });
    const off = [];
    map.traverse((object) => { if (object.isMesh && !object.castShadow) off.push(object.name); });
    assert.ok(floor.castShadow, `${name}: the floor and perimeter walls cast`);
    counts[name] = off;
  }
  assert.deepEqual(counts.high, [], 'high: every prop casts');
  assert.ok(counts.low.length >= 6 && counts.low.every((name) => /tire/i.test(name)), `low: ${counts.low.join(', ')}`);
  assert.ok(counts.medium.length <= counts.low.length);
});

test('the Leaper\'s smallest parts skip the shadow on lower quality; its body never does', () => {
  const casters = {};
  for (const name of ['low', 'medium', 'high']) {
    const rig = createHexapod(new THREE.Scene());
    const roots = [rig.robot, ...rig.legs.flatMap((leg) => [leg.coxa, leg.femur, leg.tibia, leg.calf, leg.knee, leg.calfJoint])];
    for (const root of roots) limitShadowCasters(root, QUALITY_PRESETS[name].leaperShadowMinSize);
    let count = 0, all = 0;
    for (const root of roots) root.traverse((object) => { if (object.isMesh) { all += 1; if (object.castShadow) count += 1; } });
    casters[name] = count;
    casters.all = all;
    const shell = rig.robot.children.filter((object) => object.isMesh && object.geometry.type === 'SphereGeometry');
    assert.ok(shell.length >= 2 && shell.every((object) => object.castShadow), `${name}: the body shell casts`);
    for (const leg of rig.legs) assert.ok(leg.tibia.children.some((object) => object.isMesh && object.castShadow), `${name}: every leg casts`);
  }
  assert.ok(casters.low < casters.medium && casters.medium < casters.high && casters.high < casters.all,
    `Leaper shadow casters of ${casters.all} meshes: low ${casters.low}, medium ${casters.medium}, high ${casters.high}`);
});
