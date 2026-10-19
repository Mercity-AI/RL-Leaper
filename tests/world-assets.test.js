import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import manifest from '../assets/build/manifest.json' with { type: 'json' };
import { glbJson, loadGlb } from './world-helpers.js';

// The compressed web copies in assets/build/ (scripts/assets/build-assets.mjs)
// must match their sources: built from the current files, with every node, bone
// and animation name unchanged, and geometry and keyframes decoding (through
// the meshopt decoder three.js r128 ships) to exactly the original numbers.

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url));
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const models = Object.entries(manifest.outputs).filter(([file]) => file.endsWith('.glb'));

test('every built file exists, is the one recorded, and comes from the current source', () => {
  assert.ok(models.length === 15, 'the map and the 14 Lola files');
  assert.ok(Object.keys(manifest.outputs).filter(file => /\.(ogg|m4a)$/.test(file)).length === 18, '9 sounds in two formats');
  for (const [file, entry] of Object.entries(manifest.outputs)) {
    const built = read(`assets/build/${file}`);
    assert.equal(sha256(built), entry.sha256, `${file} matches the manifest`);
    assert.equal(sha256(read(entry.source)), entry.sourceSha256, `${entry.source} changed: run \`pnpm assets\``);
    assert.ok(built.length < entry.sourceBytes, `${file} is smaller than its source`);
  }
});

test('node, bone and animation names are unchanged in every compressed model', () => {
  for (const [file, { source }] of models) {
    const a = glbJson(source), b = glbJson(`assets/build/${file}`);
    const names = (json) => json.nodes.map(node => node.name);
    assert.deepEqual(names(b), names(a), `${file}: node names and order`);
    const joints = (json) => (json.skins ?? []).map(skin => skin.joints.map(i => json.nodes[i].name));
    assert.deepEqual(joints(b), joints(a), `${file}: skeleton bones`);
    const clips = (json) => (json.animations ?? []).map(clip => [clip.name,
      clip.channels.map(c => `${json.nodes[c.target.node].name}.${c.target.path}`).sort()]);
    assert.deepEqual(clips(b), clips(a), `${file}: animation names and tracks`);
    assert.deepEqual(b.extensionsRequired?.filter(name => !['EXT_meshopt_compression', 'EXT_texture_webp'].includes(name)) ?? [], [],
      `${file}: only extensions three.js r128 decodes are required`);
  }
});

// Each node's rest transform (Lola's bind pose, every prop's placement). The
// writer stores a scale or rotation within a hair of "none" as exactly none
// (1.0000007 becomes 1), so allow 1e-5; anything bigger would move a bone or
// a prop, which the vertex check below would not notice.
test('every node keeps its rest position, rotation and scale', () => {
  const restOf = (node) => node.matrix
    ?? [...(node.translation ?? [0, 0, 0]), ...(node.rotation ?? [0, 0, 0, 1]), ...(node.scale ?? [1, 1, 1])];
  for (const [file, { source }] of models) {
    const a = glbJson(source), b = glbJson(`assets/build/${file}`);
    a.nodes.forEach((node, i) => {
      const before = restOf(node), after = restOf(b.nodes[i]);
      assert.equal(after.length, before.length, `${file}: ${node.name} stored the same way`);
      before.forEach((value, k) => assert.ok(Math.abs(value - after[k]) < 1e-5, `${file}: ${node.name}[${k}] ${value} -> ${after[k]}`));
    });
  }
});

// Triangles as written, each turned to start at its smallest corner (the
// index codec may rotate a triangle's corners; the triangle and its facing stay).
function triangles(geometry) {
  const index = geometry.index ? Array.from(geometry.index.array) : [...Array(geometry.attributes.position.count).keys()];
  const out = [];
  for (let i = 0; i < index.length; i += 3) {
    const t = index.slice(i, i + 3);
    const k = t.indexOf(Math.min(...t));
    out.push(`${t[k]},${t[(k + 1) % 3]},${t[(k + 2) % 3]}`);
  }
  return out;
}

test('compressed models decode to exactly the original geometry and animation', async () => {
  for (const [file, { source }] of models) {
    const original = await loadGlb(source), packed = await loadGlb(`assets/build/${file}`);
    // Meshes by name: three.js adds a loaded scene's children as their data
    // arrives, so the child order is not fixed (shared meshes arrive sooner).
    const listMeshes = (gltf) => {
      const list = [];
      gltf.scene.traverse(o => { if (o.isMesh) list.push(o); });
      return list.sort((x, y) => (x.name < y.name ? -1 : x.name > y.name ? 1 : 0));
    };
    const a = listMeshes(original), b = listMeshes(packed);
    assert.equal(b.length, a.length, `${file}: mesh count`);
    a.forEach((meshA, i) => {
      const meshB = b[i];
      assert.equal(meshB.name, meshA.name, `${file}: mesh ${i} name`);
      assert.equal(meshB.parent.name, meshA.parent.name, `${file}: ${meshA.name} parent`);
      assert.equal(Boolean(meshB.material.map), Boolean(meshA.material.map), `${file}: ${meshA.name} keeps its texture`);
      for (const [key, attribute] of Object.entries(meshA.geometry.attributes)) {
        const other = meshB.geometry.attributes[key];
        assert.ok(other, `${file}: ${meshA.name} keeps ${key}`);
        assert.equal(other.count, attribute.count, `${file}: ${meshA.name} ${key} count`);
        for (let k = 0; k < attribute.count * attribute.itemSize; k += 1) {
          const x = attribute.array[k], y = other.array[k];
          if (x !== y) assert.fail(`${file}: ${meshA.name} ${key}[${k}] ${x} != ${y}`);
        }
      }
      assert.deepEqual(triangles(meshB.geometry), triangles(meshA.geometry), `${file}: ${meshA.name} triangles`);
    });
    // Every keyframe of every clip.
    assert.deepEqual(packed.animations.map(clip => clip.name), original.animations.map(clip => clip.name));
    original.animations.forEach((clip, i) => {
      const other = packed.animations[i];
      assert.equal(other.duration, clip.duration, `${file}: ${clip.name} length`);
      clip.tracks.forEach((track, k) => {
        const copy = other.tracks[k];
        assert.equal(copy.name, track.name);
        assert.deepEqual(Array.from(copy.times), Array.from(track.times), `${file}: ${track.name} times`);
        assert.deepEqual(Array.from(copy.values), Array.from(track.values), `${file}: ${track.name} values`);
      });
    });
  }
});

test('sounds: Ogg Opus and AAC copies are real audio files', () => {
  for (const [file] of Object.entries(manifest.outputs).filter(([name]) => /\.(ogg|m4a)$/.test(name))) {
    const bytes = read(`assets/build/${file}`);
    if (file.endsWith('.ogg')) {
      assert.equal(bytes.subarray(0, 4).toString('latin1'), 'OggS', `${file} is an Ogg file`);
      assert.ok(bytes.includes(Buffer.from('OpusHead')), `${file} holds Opus audio`);
    } else {
      assert.equal(bytes.subarray(4, 8).toString('latin1'), 'ftyp', `${file} is an MP4 file`);
      assert.ok(bytes.includes(Buffer.from('mp4a')), `${file} holds AAC audio`);
    }
  }
});
