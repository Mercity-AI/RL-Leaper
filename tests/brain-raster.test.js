// The browser brain's collision raster and sight triangles must be the Python
// server's, bit for bit. The Python side is recorded in tests/fixtures/brain
// (scripts/make_junkyard_fixtures.py) and baked in public/brains/leaper_7757824
// (scripts/bake_junkyard_raster.py).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { JunkyardRaster, scaleForWidth } from '../src/brain/junkyard/collisionRaster.js';
import { loadGlbTriangles } from '../src/brain/junkyard/junkyardSight.js';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const collisionBytes = read('assets/maps/junkyard/collision.json');
const collision = JSON.parse(collisionBytes);
const index = JSON.parse(read('tests/fixtures/brain/index.json'));
const brain = JSON.parse(read('public/brains/leaper_7757824/brain.json'));

test('baked default-size raster is identical to the JavaScript build', () => {
  // The bake came from rl/junkyard_geometry.py itself, so this proves the port.
  const started = performance.now();
  const built = JunkyardRaster.build(collision, 5.5);
  const buildMs = performance.now() - started;
  const { raster: baked, collisionSha256 } = JunkyardRaster.decode(read('public/brains/leaper_7757824/raster-5.5.bin'));
  assert.equal(collisionSha256, sha256(collisionBytes), 'the bake is from the current collision.json');
  assert.deepEqual([baked.nx, baked.nz], [built.nx, built.nz]);
  assert.equal(baked.scale, scaleForWidth(5.5));
  assert.equal(Buffer.compare(Buffer.from(baked.solid), Buffer.from(built.solid)), 0, 'every cell matches');
  assert.equal(sha256(built.solid), brain.rasters['5.5'].raster_sha256);
  console.log(`raster 5.5: ${built.nx}x${built.nz} cells, ${built.solidCount()} solid, JS build ${buildMs.toFixed(0)} ms, baked file identical`);
});

test('JavaScript rasters match the Python oracle at every recorded Leaper size', () => {
  for (const [width, world] of Object.entries(index.worlds)) {
    const raster = JunkyardRaster.build(collision, Number(width));
    assert.deepEqual([raster.nx, raster.nz], world.raster_shape, `shape at width ${width}`);
    assert.equal(raster.cell, world.cell, `cell size at width ${width}`);
    assert.deepEqual([raster.minX, raster.minZ], world.minimum);
    assert.deepEqual([raster.maxX, raster.maxZ], world.maximum);
    assert.equal(sha256(raster.solid), world.raster_sha256, `raster bits at width ${width}`);
  }
});

test('baked raster files survive an encode/decode round trip', () => {
  const raster = JunkyardRaster.build(collision, 4.2);
  const { raster: copy, collisionSha256 } = JunkyardRaster.decode(raster.encode(sha256(collisionBytes)));
  assert.equal(collisionSha256, sha256(collisionBytes));
  assert.equal(copy.width, 4.2);
  assert.deepEqual([copy.minX, copy.maxX, copy.minZ, copy.maxZ, copy.cell], [raster.minX, raster.maxX, raster.minZ, raster.maxZ, raster.cell]);
  assert.equal(sha256(copy.solid), sha256(raster.solid));
  assert.throws(() => JunkyardRaster.decode(new TextEncoder().encode('<!doctype html>')), /Not a baked junkyard raster/);
});

test('sight triangles read from the GLB match Python load_triangles bit for bit', () => {
  const triangles = loadGlbTriangles(read('assets/maps/junkyard/junkyard.glb'));
  assert.equal(triangles.length / 9, index.glb_triangles.count);
  assert.equal(sha256(new Uint8Array(triangles.buffer)), index.glb_triangles.sha256);
});
