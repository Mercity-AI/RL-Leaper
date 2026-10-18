// The Leaper's flat collision map: a JavaScript copy of rl/junkyard_geometry.py.
//
// The brain only ever "feels" the junkyard through this grid of 0.1-map-unit
// cells: its 16 sight rays, its 19 body/leg discs and its search-coverage map
// all ask "is this cell solid?". The browser must build exactly the same grid
// as the Python server, bit for bit, or the trained brain would walk into
// different walls. tests/brain-raster.test.js checks that against a grid the
// Python code baked (scripts/bake_junkyard_raster.py).

import { f32, fma } from './pyMath.js';

// The server sizes the map so a Leaper of this clearance width fits (7.98 / width).
export const BODY_DIAMETER = 7.98;
// Raster cell size in unscaled map units (JunkyardGeometry's `cell=0.1`).
export const RASTER_CELL = 0.1;
// Map triangles that only matter for the 2D grid: below the Leaper's clearance
// height (3.82 robot units) and taller than the floor (0.12 map units).
const CLEARANCE_HEIGHT = 3.82;
const FLOOR_HEIGHT = 0.12;
// Baked raster files start with this tag and a 96-byte header (see encodeRaster).
const MAGIC = 'LJR1';
const HEADER_BYTES = 96;

export function scaleForWidth(width) {
  return BODY_DIAMETER / width;
}

export class JunkyardRaster {
  // `bounds` are collision.json's unscaled minX/maxX/minZ/maxZ; `solid` is one
  // byte per cell (1 = blocked) in row-major [ix][iz] order like NumPy.
  constructor({ width, scale, bounds, shape, solid }) {
    this.width = width;
    this.scale = scale;
    this.bounds = bounds;
    // Same order of operations as JunkyardGeometry.__init__, so every double matches.
    this.cell = RASTER_CELL * scale;
    this.minX = bounds.minX * scale;
    this.minZ = bounds.minZ * scale;
    this.maxX = bounds.maxX * scale;
    this.maxZ = bounds.maxZ * scale;
    this.nx = shape[0];
    this.nz = shape[1];
    this.solid = solid;
  }

  // --- Building the grid from the collision export --------------------------

  // Port of JunkyardGeometry.__init__: a cell is solid when a qualifying
  // triangle covers its centre or passes within half a cell diagonal of it.
  static build(collision, width) {
    const scale = scaleForWidth(width);
    const bounds = collision.bounds;
    const cell = RASTER_CELL * scale;
    const minX = bounds.minX * scale, minZ = bounds.minZ * scale;
    const nx = Math.ceil((bounds.maxX * scale - minX) / cell);
    const nz = Math.ceil((bounds.maxZ * scale - minZ) / cell);
    const solid = new Uint8Array(nx * nz);
    const padding = RASTER_CELL / Math.sqrt(2);
    const padding2 = padding * padding;
    // Python divides the scaled minimum back by the scale (not always the raw bound).
    const baseX = minX / scale, baseZ = minZ / scale;
    const half = RASTER_CELL / 2;
    const heightLimit = CLEARANCE_HEIGHT / scale;
    const crosses = new Float64Array(3);

    for (const raw of collision.triangles) {
      // Skip overhead parts the body passes under, and the floor itself.
      if (raw[6] > heightLimit || raw[7] <= FLOOR_HEIGHT) continue;
      const ax = raw[0], az = raw[1], bx = raw[2], bz = raw[3], cx = raw[4], cz = raw[5];

      // Cell range touched by the triangle's box grown by the padding.
      const lowX = Math.max(0, Math.floor((Math.min(ax, bx, cx) - padding - baseX) / RASTER_CELL));
      const lowZ = Math.max(0, Math.floor((Math.min(az, bz, cz) - padding - baseZ) / RASTER_CELL));
      const highX = Math.min(nx - 1, Math.floor((Math.max(ax, bx, cx) + padding - baseX) / RASTER_CELL));
      const highZ = Math.min(nz - 1, Math.floor((Math.max(az, bz, cz) + padding - baseZ) / RASTER_CELL));
      if (highX < lowX || highZ < lowZ) continue;

      // Edge vectors in NumPy's np.roll order (a->b, b->c, c->a), plus each
      // edge's squared length as OpenBLAS computes `edge @ edge` (with FMA).
      const edges = [[ax, az, bx - ax, bz - az], [bx, bz, cx - bx, cz - bz], [cx, cz, ax - cx, az - cz]];
      const lengths = edges.map(([, , ex, ez]) => Math.max(fma(ez, ez, ex * ex), 1e-12));
      const area = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
      const canBeInside = Math.abs(area) > 1e-10;

      for (let ix = lowX; ix <= highX; ix += 1) {
        const px = (ix * RASTER_CELL + baseX) + half;
        for (let iz = lowZ; iz <= highZ; iz += 1) {
          const index = ix * nz + iz;
          if (solid[index]) continue; // already solid; OR-ing again changes nothing
          const pz = (iz * RASTER_CELL + baseZ) + half;
          let distance = Infinity;
          for (let e = 0; e < 3; e += 1) {
            const [sx, sz, ex, ez] = edges[e];
            const dx = px - sx, dz = pz - sz;
            crosses[e] = ex * dz - ez * dx;
            let t = (dx * ex + dz * ez) / lengths[e];
            t = t < 0 ? 0 : t > 1 ? 1 : t;
            const rx = dx - t * ex, rz = dz - t * ez;
            const squared = rx * rx + rz * rz;
            if (squared < distance) distance = squared;
          }
          const inside = canBeInside && ((crosses[0] >= 0 && crosses[1] >= 0 && crosses[2] >= 0)
            || (crosses[0] <= 0 && crosses[1] <= 0 && crosses[2] <= 0));
          if (inside || distance <= padding2) solid[index] = 1;
        }
      }
    }
    return new JunkyardRaster({ width, scale, bounds, shape: [nx, nz], solid });
  }

  // --- Queries used by the frozen environment --------------------------------

  // JunkyardGeometry.occupied for one point: outside the yard counts as solid.
  occupied(x, z) {
    if (!(x >= this.minX && x < this.maxX && z >= this.minZ && z < this.maxZ)) return true;
    let ix = Math.floor((x - this.minX) / this.cell);
    let iz = Math.floor((z - this.minZ) / this.cell);
    ix = ix < 0 ? 0 : ix >= this.nx ? this.nx - 1 : ix;
    iz = iz < 0 ? 0 : iz >= this.nz ? this.nz - 1 : iz;
    return this.solid[ix * this.nz + iz] === 1;
  }

  // JunkyardGeometry.disk_blocked for a float32 disc centre (the env keeps
  // positions in float32). `radius` is the Python float; NumPy rounds it to
  // float32 for `point +/- radius` but squares the double for the distance test.
  diskBlocked(px, pz, radius) {
    const r32 = f32(radius);
    const lowEdgeX = f32(px - r32), lowEdgeZ = f32(pz - r32);
    const highEdgeX = f32(px + r32), highEdgeZ = f32(pz + r32);
    if (lowEdgeX < this.minX || lowEdgeZ < this.minZ || highEdgeX > this.maxX || highEdgeZ > this.maxZ) return true;
    const lowX = Math.max(0, Math.floor((lowEdgeX - this.minX) / this.cell));
    const lowZ = Math.max(0, Math.floor((lowEdgeZ - this.minZ) / this.cell));
    const highX = Math.min(this.nx - 1, Math.floor((highEdgeX - this.minX) / this.cell));
    const highZ = Math.min(this.nz - 1, Math.floor((highEdgeZ - this.minZ) / this.cell));
    const halfCell = this.cell / 2;
    const limit = radius * radius;
    for (let ix = lowX; ix <= highX; ix += 1) {
      const row = ix * this.nz;
      for (let iz = lowZ; iz <= highZ; iz += 1) {
        if (!this.solid[row + iz]) continue;
        // Distance from the disc centre to the nearest point of the solid cell.
        const centreX = this.minX + (ix + 0.5) * this.cell;
        const centreZ = this.minZ + (iz + 0.5) * this.cell;
        const dx = Math.max(Math.abs(centreX - px) - halfCell, 0);
        const dz = Math.max(Math.abs(centreZ - pz) - halfCell, 0);
        if (dx * dx + dz * dz < limit) return true;
      }
    }
    return false;
  }

  // Number of half-cell samples JunkyardGeometry.ray_distances takes up to
  // `maxRange` (np.arange(0, maxRange + cell/2, cell/2)).
  sampleCount(maxRange) {
    const step = this.cell / 2;
    return Math.ceil((maxRange + step) / step);
  }

  // Distance along one ray to the first solid sample (or `maxRange`).
  // `ox, oz` are the (float32) origin and `dx, dz` the double direction.
  rayDistance(ox, oz, dx, dz, maxRange) {
    const step = this.cell / 2;
    const count = this.sampleCount(maxRange);
    for (let i = 0; i < count; i += 1) {
      const distance = i * step;
      if (this.occupied(ox + dx * distance, oz + dz * distance)) return Math.min(distance, maxRange);
    }
    return maxRange;
  }

  // Count of solid cells (for quick sanity prints).
  solidCount() {
    let count = 0;
    for (let i = 0; i < this.solid.length; i += 1) count += this.solid[i];
    return count;
  }

  // --- Baked raster files (public/brains/leaper_7757824/raster-<width>.bin) ----

  // Header: 'LJR1', nx, nz, solid count (uint32), width, scale, minX, maxX,
  // minZ, maxZ (float64), SHA256 of collision.json (32 bytes); then one bit
  // per cell, least significant bit first (np.packbits(..., bitorder='little')).
  static decode(buffer) {
    const bytes = new Uint8Array(buffer);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const magic = String.fromCharCode(...bytes.subarray(0, 4));
    if (magic !== MAGIC || bytes.byteLength < HEADER_BYTES) throw new Error('Not a baked junkyard raster');
    const nx = view.getUint32(4, true), nz = view.getUint32(8, true), count = view.getUint32(12, true);
    const width = view.getFloat64(16, true), scale = view.getFloat64(24, true);
    const bounds = { minX: view.getFloat64(32, true), maxX: view.getFloat64(40, true),
      minZ: view.getFloat64(48, true), maxZ: view.getFloat64(56, true) };
    const collisionSha256 = [...bytes.subarray(64, 96)].map((b) => b.toString(16).padStart(2, '0')).join('');
    if (bytes.byteLength !== HEADER_BYTES + Math.ceil((nx * nz) / 8)) throw new Error('Baked raster has the wrong size');
    const solid = new Uint8Array(nx * nz);
    for (let i = 0; i < solid.length; i += 1) solid[i] = (bytes[HEADER_BYTES + (i >> 3)] >> (i & 7)) & 1;
    const raster = new JunkyardRaster({ width, scale, bounds, shape: [nx, nz], solid });
    if (raster.solidCount() !== count) throw new Error('Baked raster is corrupt');
    return { raster, collisionSha256 };
  }

  encode(collisionSha256) {
    const bytes = new Uint8Array(HEADER_BYTES + Math.ceil(this.solid.length / 8));
    const view = new DataView(bytes.buffer);
    for (let i = 0; i < 4; i += 1) bytes[i] = MAGIC.charCodeAt(i);
    view.setUint32(4, this.nx, true);
    view.setUint32(8, this.nz, true);
    view.setUint32(12, this.solidCount(), true);
    view.setFloat64(16, this.width, true);
    view.setFloat64(24, this.scale, true);
    view.setFloat64(32, this.bounds.minX, true);
    view.setFloat64(40, this.bounds.maxX, true);
    view.setFloat64(48, this.bounds.minZ, true);
    view.setFloat64(56, this.bounds.maxZ, true);
    for (let i = 0; i < 32; i += 1) bytes[64 + i] = parseInt(collisionSha256.slice(i * 2, i * 2 + 2), 16);
    for (let i = 0; i < this.solid.length; i += 1) if (this.solid[i]) bytes[HEADER_BYTES + (i >> 3)] |= 1 << (i & 7);
    return bytes;
  }
}
