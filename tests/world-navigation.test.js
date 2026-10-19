import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JunkyardNavigation, triangleContact, triangleDistanceSquared } from '../src/world/JunkyardNavigation.js';
import { buildJunkyardCollision, leaperGridSize, packJunkyardCollision, PLAYER_GRID, unpackJunkyardCollision }
  from '../src/world/junkyardCollision.js';
import { ENCOUNTER } from '../src/config/encounter.js';
import { seededRandom } from './world-helpers.js';

// The navigation grid was rebuilt for speed (dense buckets, a bounding-box
// shortcut, typed arrays a worker can hand over). Its answers must not change:
// this test keeps the original implementation as a reference and compares.

const data = JSON.parse(fs.readFileSync(new URL('../assets/maps/junkyard/collision.json', import.meta.url)));

// The original grid, verbatim (string-keyed Map buckets, no shortcuts).
class ReferenceNavigation {
  constructor(source, radius, height, cell = 0.4) {
    this.bounds = source.bounds;
    this.radius = radius;
    this.cell = cell;
    this.bucketSize = 2;
    this.buckets = new Map();
    for (const t of source.triangles) {
      if (t[6] > height || t[7] <= 0.12) continue;
      const minX = Math.floor(Math.min(t[0], t[2], t[4]) / this.bucketSize);
      const maxX = Math.floor(Math.max(t[0], t[2], t[4]) / this.bucketSize);
      const minZ = Math.floor(Math.min(t[1], t[3], t[5]) / this.bucketSize);
      const maxZ = Math.floor(Math.max(t[1], t[3], t[5]) / this.bucketSize);
      for (let x = minX; x <= maxX; x += 1) {
        for (let z = minZ; z <= maxZ; z += 1) {
          const key = `${x},${z}`;
          if (!this.buckets.has(key)) this.buckets.set(key, []);
          this.buckets.get(key).push(t);
        }
      }
    }
    this.columns = Math.ceil((this.bounds.maxX - this.bounds.minX) / cell);
    this.rows = Math.ceil((this.bounds.maxZ - this.bounds.minZ) / cell);
    this.free = new Uint8Array(this.columns * this.rows);
    for (let i = 0; i < this.free.length; i += 1) {
      const p = { x: this.bounds.minX + (i % this.columns + 0.5) * cell, z: this.bounds.minZ + (Math.floor(i / this.columns) + 0.5) * cell };
      this.free[i] = !this.blocked(p.x, p.z);
    }
  }

  blocked(x, z, radius = this.radius) {
    const r = radius;
    const b = this.bounds;
    if (x - r < b.minX || x + r > b.maxX || z - r < b.minZ || z + r > b.maxZ) return true;
    for (let ix = Math.floor((x - r) / this.bucketSize); ix <= Math.floor((x + r) / this.bucketSize); ix += 1) {
      for (let iz = Math.floor((z - r) / this.bucketSize); iz <= Math.floor((z + r) / this.bucketSize); iz += 1) {
        for (const t of this.buckets.get(`${ix},${iz}`) || []) {
          if (triangleDistanceSquared(x, z, t) < r * r) return true;
        }
      }
    }
    return false;
  }

  contact(x, z, radius = this.radius) {
    let deepest = null;
    const consider = (hit) => { if (hit && hit.depth > 0 && (!deepest || hit.depth > deepest.depth)) deepest = hit; };
    const b = this.bounds;
    consider({ nx: 1, nz: 0, depth: b.minX - (x - radius) });
    consider({ nx: -1, nz: 0, depth: x + radius - b.maxX });
    consider({ nx: 0, nz: 1, depth: b.minZ - (z - radius) });
    consider({ nx: 0, nz: -1, depth: z + radius - b.maxZ });
    for (let ix = Math.floor((x - radius) / this.bucketSize); ix <= Math.floor((x + radius) / this.bucketSize); ix += 1) {
      for (let iz = Math.floor((z - radius) / this.bucketSize); iz <= Math.floor((z + radius) / this.bucketSize); iz += 1) {
        for (const t of this.buckets.get(`${ix},${iz}`) || []) {
          if (x + radius < Math.min(t[0], t[2], t[4]) || x - radius > Math.max(t[0], t[2], t[4])
            || z + radius < Math.min(t[1], t[3], t[5]) || z - radius > Math.max(t[1], t[3], t[5])) continue;
          consider(triangleContact(x, z, t, radius));
        }
      }
    }
    return deepest;
  }
}

// Random probes over (and a little beyond) the yard, with every disc size the game uses.
function probes(count, seed) {
  const random = seededRandom(seed);
  return Array.from({ length: count }, () => ({ x: random() * 54 - 27, z: random() * 50 - 25, r: random() * 4.2 }));
}

test('the faster grid gives the original answers (clear cells, blocked, contact)', () => {
  for (const [width, grid] of [[1.2], [ENCOUNTER.startWidth], [8], [null, PLAYER_GRID]]) {
    const { radius, height } = grid ?? leaperGridSize(width);
    const reference = new ReferenceNavigation(data, radius, height);
    const fast = new JunkyardNavigation(data, radius, height);
    assert.deepEqual(fast.free, reference.free, `clear cells at ${width ?? 'Lola'}`);
    for (const { x, z, r } of probes(6000, 3)) {
      assert.equal(fast.blocked(x, z, r), reference.blocked(x, z, r), `blocked(${x}, ${z}, ${r})`);
    }
    // contact() is Lola's wall-slide query, so it is compared at her disc size.
    for (const { x, z } of probes(4000, 4)) {
      assert.deepEqual(fast.contact(x, z, PLAYER_GRID.radius), reference.contact(x, z, PLAYER_GRID.radius), `contact(${x}, ${z})`);
    }
  }
});

test('packing for the worker and unpacking on the page changes nothing', () => {
  const built = buildJunkyardCollision(data, ENCOUNTER.startWidth);
  const { packed, transfer } = packJunkyardCollision(data, built);
  assert.ok(packed.triangles instanceof Float64Array && transfer.length >= 6, 'typed arrays, all handed over');
  // Structured cloning is what postMessage does on the way back to the page.
  const copy = unpackJunkyardCollision(structuredClone(packed));
  for (const key of ['navigation', 'playerNavigation']) {
    const a = built[key], b = copy[key];
    assert.deepEqual(b.free, a.free);
    assert.equal(b.radius, a.radius);
    for (const { x, z, r } of probes(5000, 8)) assert.equal(b.blocked(x, z, r), a.blocked(x, z, r));
    for (const { x, z } of probes(1000, 9)) assert.deepEqual(b.contact(x, z, PLAYER_GRID.radius), a.contact(x, z, PLAYER_GRID.radius));
  }
  assert.deepEqual(copy.navigation.regions.labels, built.navigation.regions.labels);
  assert.deepEqual(copy.navigation.spawnable, built.navigation.spawnable);
});
