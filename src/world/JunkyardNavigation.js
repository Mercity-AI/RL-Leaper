// Conservative flat-ground clearance: a disk around the complete leg span.
// Mesh triangles retain height so roofs above the robot do not seal passages.
function segmentDistanceSquared(x, z, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz)
    / (dx * dx + dz * dz || 1)));
  return (x - ax - t * dx) ** 2 + (z - az - t * dz) ** 2;
}

// Closest point to (x, z) on the segment a-b, written into `out`.
function closestOnSegment(x, z, ax, az, bx, bz, out) {
  const dx = bx - ax;
  const dz = bz - az;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
  out.x = ax + t * dx;
  out.z = az + t * dz;
  return out;
}

// Where a disc of `radius` at (x, z) overlaps triangle t: the outward normal
// (pointing from the solid toward the disc) and the overlap depth, or null.
export function triangleContact(x, z, t, radius) {
  const cross = (ax, az, bx, bz) => (bx - ax) * (z - az) - (bz - az) * (x - ax);
  const a = cross(t[0], t[1], t[2], t[3]);
  const b = cross(t[2], t[3], t[4], t[5]);
  const c = cross(t[4], t[5], t[0], t[1]);
  const area = (t[2] - t[0]) * (t[5] - t[1]) - (t[3] - t[1]) * (t[4] - t[0]);
  const inside = Math.abs(area) > 1e-10 && ((a >= 0 && b >= 0 && c >= 0) || (a <= 0 && b <= 0 && c <= 0));
  // Nearest point on the triangle's outline.
  const edges = [[0, 1, 2, 3], [2, 3, 4, 5], [4, 5, 0, 1]];
  const point = { x: 0, z: 0 };
  let best = null;
  for (const [i, j, k, l] of edges) {
    closestOnSegment(x, z, t[i], t[j], t[k], t[l], point);
    const distance = Math.hypot(x - point.x, z - point.z);
    if (!best || distance < best.distance) best = { distance, x: point.x, z: point.z, edge: [i, j, k, l] };
  }
  if (!inside) {
    if (best.distance >= radius) return null;
    // Outside: push straight away from the nearest point (rounds corners).
    const length = best.distance || 1;
    return { nx: (x - best.x) / length, nz: (z - best.z) / length, depth: radius - best.distance };
  }
  // Centre inside the solid: push out through the nearest edge.
  const [i, j, k, l] = best.edge;
  let nx = t[l] - t[j], nz = -(t[k] - t[i]);
  const length = Math.hypot(nx, nz) || 1;
  nx /= length; nz /= length;
  // Point the normal away from the triangle's third corner.
  const third = [0, 1, 2].map(n => n * 2).find(n => n !== i && n !== k);
  if ((t[third] - t[i]) * nx + (t[third + 1] - t[j]) * nz > 0) { nx = -nx; nz = -nz; }
  return { nx, nz, depth: radius + best.distance };
}

export function triangleDistanceSquared(x, z, t) {
  const cross = (ax, az, bx, bz) => (bx - ax) * (z - az) - (bz - az) * (x - ax);
  const a = cross(t[0], t[1], t[2], t[3]);
  const b = cross(t[2], t[3], t[4], t[5]);
  const c = cross(t[4], t[5], t[0], t[1]);
  const area = (t[2] - t[0]) * (t[5] - t[1]) - (t[3] - t[1]) * (t[4] - t[0]);
  if (Math.abs(area) > 1e-10 && ((a >= 0 && b >= 0 && c >= 0)
    || (a <= 0 && b <= 0 && c <= 0))) return 0;
  return Math.min(
    segmentDistanceSquared(x, z, t[0], t[1], t[2], t[3]),
    segmentDistanceSquared(x, z, t[2], t[3], t[4], t[5]),
    segmentDistanceSquared(x, z, t[4], t[5], t[0], t[1]),
  );
}

// The kept triangles sorted into square buckets (bucketSize map units), as one
// dense grid in compressed-row form: bucket b holds items[start[b] .. start[b+1]).
// Each bucket lists its triangles in file order, exactly like the old Map did.
function bucketTriangles(triangles, keep, bucketSize) {
  // 1. The grid's extent: every bucket any kept triangle touches.
  let minIx = Infinity, maxIx = -Infinity, minIz = Infinity, maxIz = -Infinity;
  const spans = new Int32Array(triangles.length * 4);
  for (let i = 0; i < triangles.length; i += 1) {
    if (!keep(triangles[i])) { spans[i * 4] = 1; spans[i * 4 + 1] = 0; continue; }
    const t = triangles[i];
    const x0 = Math.floor(Math.min(t[0], t[2], t[4]) / bucketSize), x1 = Math.floor(Math.max(t[0], t[2], t[4]) / bucketSize);
    const z0 = Math.floor(Math.min(t[1], t[3], t[5]) / bucketSize), z1 = Math.floor(Math.max(t[1], t[3], t[5]) / bucketSize);
    spans.set([x0, x1, z0, z1], i * 4);
    minIx = Math.min(minIx, x0); maxIx = Math.max(maxIx, x1); minIz = Math.min(minIz, z0); maxIz = Math.max(maxIz, z1);
  }
  if (minIx > maxIx) { minIx = maxIx = minIz = maxIz = 0; }
  const nx = maxIx - minIx + 1, nz = maxIz - minIz + 1;
  // 2. Count, then fill, each bucket (triangle order, then x, then z: the old order).
  const start = new Int32Array(nx * nz + 1);
  const visit = (fn) => {
    for (let i = 0; i < triangles.length; i += 1) {
      const [x0, x1, z0, z1] = spans.subarray(i * 4, i * 4 + 4);
      for (let x = x0; x <= x1; x += 1) for (let z = z0; z <= z1; z += 1) fn((x - minIx) * nz + (z - minIz), i);
    }
  };
  visit((b) => { start[b + 1] += 1; });
  for (let b = 0; b < nx * nz; b += 1) start[b + 1] += start[b];
  const items = new Int32Array(start[nx * nz]);
  const cursor = start.slice(0, nx * nz);
  visit((b, i) => { items[cursor[b]++] = i; });
  return { minIx, minIz, nx, nz, start, items };
}

// One triangle list as per-triangle arrays [ax, az, bx, bz, cx, cz, minY, maxY]:
// the parsed JSON rows as they are, or views into one packed Float64Array (the
// same numbers, so every answer is identical).
export function triangleViews(triangles) {
  if (!(triangles instanceof Float64Array)) return triangles;
  return Array.from({ length: triangles.length / 8 }, (_, i) => triangles.subarray(i * 8, i * 8 + 8));
}

// Every triangle as one flat Float64Array (8 numbers each), for handing the
// collision data between a worker and the page without copying.
export function packTriangles(triangles) {
  const packed = new Float64Array(triangles.length * 8);
  triangles.forEach((t, i) => { for (let k = 0; k < 8; k += 1) packed[i * 8 + k] = t[k] ?? 0; });
  return packed;
}

export class JunkyardNavigation {
  // data: { bounds, triangles } from collision.json (or a packed copy).
  // radius: the disc that must fit; height: triangles whose lowest point is
  // above this pass overhead (roofs, upper rack decks); cell: grid cell size.
  constructor(data, radius, height, cell = 0.4, prepared = null) {
    // 1. Shape and grid.
    this.bounds = data.bounds;
    this.radius = radius;
    this.height = height;
    this.cell = cell;
    this.bucketSize = 2;
    this.triangles = triangleViews(data.triangles);
    this.columns = Math.ceil((this.bounds.maxX - this.bounds.minX) / cell);
    this.rows = Math.ceil((this.bounds.maxZ - this.bounds.minZ) / cell);
    // 2. Solid triangles only (taller than the floor, low enough to block),
    //    sorted into buckets so each test only looks nearby.
    this.grid = prepared?.grid ?? bucketTriangles(this.triangles, t => !(t[6] > height || t[7] <= 0.12), this.bucketSize);
    // 3. Which cell centres a disc of `radius` fits on.
    this.free = prepared?.free ?? this.computeFree();
    // 4. Connected regions (labelRegions) and safe spawn cells, when known.
    this.regions = prepared?.regions ?? null;
    this.spawnable = prepared?.spawnable ?? null;
  }

  // Rebuild a navigation grid from pack() output (from the collision worker).
  // `triangles` are the shared triangle views (see triangleViews).
  static fromPacked(packed, triangles) {
    return new JunkyardNavigation({ bounds: packed.bounds, triangles }, packed.radius, packed.height, packed.cell, packed);
  }

  // Everything except the shared triangle list, as transferable typed arrays.
  pack() {
    const { bounds, radius, height, cell, grid, free, regions, spawnable } = this;
    return { bounds, radius, height, cell, grid, free, regions, spawnable };
  }

  // The typed arrays pack() hands over (for postMessage's transfer list).
  static transferables(packed) {
    const { grid, free, regions, spawnable } = packed;
    return [grid.start.buffer, grid.items.buffer, free.buffer, regions?.labels.buffer, regions?.sizes.buffer, spawnable?.buffer]
      .filter(Boolean);
  }

  computeFree() {
    const free = new Uint8Array(this.columns * this.rows);
    for (let i = 0; i < free.length; i += 1) {
      const p = this.point(i);
      free[i] = !this.blocked(p.x, p.z);
    }
    return free;
  }

  // Visit every solid triangle in the buckets a disc (x, z, r) overlaps.
  // Return true from `visit` to stop early.
  nearby(x, z, r, visit) {
    const { minIx, minIz, nx, nz, start, items } = this.grid;
    const x0 = Math.max(minIx, Math.floor((x - r) / this.bucketSize)), x1 = Math.min(minIx + nx - 1, Math.floor((x + r) / this.bucketSize));
    const z0 = Math.max(minIz, Math.floor((z - r) / this.bucketSize)), z1 = Math.min(minIz + nz - 1, Math.floor((z + r) / this.bucketSize));
    for (let ix = x0; ix <= x1; ix += 1) {
      for (let iz = z0; iz <= z1; iz += 1) {
        const b = (ix - minIx) * nz + (iz - minIz);
        for (let k = start[b]; k < start[b + 1]; k += 1) if (visit(this.triangles[items[k]])) return true;
      }
    }
    return false;
  }

  // Would a disc of `radius` at (x, z) overlap the map? (The hot path: Lola asks
  // this every movement sub-step, so the bucket loop is written out in full.)
  blocked(x, z, radius = this.radius) {
    const r = radius;
    const b = this.bounds;
    if (x - r < b.minX || x + r > b.maxX || z - r < b.minZ || z + r > b.maxZ) return true;
    const { minIx, minIz, nx, nz, start, items } = this.grid;
    const size = this.bucketSize, triangles = this.triangles, r2 = r * r;
    // A triangle whose bounding box is clearly out of reach can't touch the disc
    // (the 1e-9 keeps this shortcut from ever disagreeing with the exact test).
    const left = x - r - 1e-9, right = x + r + 1e-9, near = z - r - 1e-9, far = z + r + 1e-9;
    const x0 = Math.max(minIx, Math.floor((x - r) / size)), x1 = Math.min(minIx + nx - 1, Math.floor((x + r) / size));
    const z0 = Math.max(minIz, Math.floor((z - r) / size)), z1 = Math.min(minIz + nz - 1, Math.floor((z + r) / size));
    for (let ix = x0; ix <= x1; ix += 1) {
      for (let iz = z0; iz <= z1; iz += 1) {
        const bucket = (ix - minIx) * nz + (iz - minIz);
        for (let k = start[bucket], end = start[bucket + 1]; k < end; k += 1) {
          const t = triangles[items[k]];
          if ((t[0] > right && t[2] > right && t[4] > right) || (t[0] < left && t[2] < left && t[4] < left)
            || (t[1] > far && t[3] > far && t[5] > far) || (t[1] < near && t[3] < near && t[5] < near)) continue;
          if (triangleDistanceSquared(x, z, t) < r2) return true;
        }
      }
    }
    return false;
  }

  // The height a disc at (x, z) would stand at: the top of the highest solid
  // triangle it overlaps (0 on the open floor), or null when one of them reaches
  // above maxTop (too tall to step or jump onto) or the disc leaves the map.
  surface(x, z, maxTop, radius = this.radius) {
    const b = this.bounds;
    if (x - radius < b.minX || x + radius > b.maxX || z - radius < b.minZ || z + radius > b.maxZ) return null;
    const r2 = radius * radius;
    let top = 0, tooTall = false;
    this.nearby(x, z, radius, (t) => {
      if (x + radius < Math.min(t[0], t[2], t[4]) || x - radius > Math.max(t[0], t[2], t[4])
        || z + radius < Math.min(t[1], t[3], t[5]) || z - radius > Math.max(t[1], t[3], t[5])) return false;
      if (triangleDistanceSquared(x, z, t) >= r2) return false;
      if (t[7] > maxTop) { tooTall = true; return true; }
      top = Math.max(top, t[7]);
      return false;
    });
    return tooTall ? null : top;
  }

  // The deepest place a disc at (x, z) overlaps the map (a solid triangle or
  // the map's outer edge): { nx, nz } is the unit normal pointing out of the
  // solid and `depth` how far the disc overlaps it; null when the disc is
  // clear. Lola's movement slides along this normal instead of stopping dead.
  // above: only triangles reaching higher than this count (what she can step
  // or jump onto is no wall).
  contact(x, z, radius = this.radius, above = 0.12) {
    let deepest = null;
    const consider = (hit) => { if (hit && hit.depth > 0 && (!deepest || hit.depth > deepest.depth)) deepest = hit; };
    // The map's outer edges are walls facing inward.
    const b = this.bounds;
    consider({ nx: 1, nz: 0, depth: b.minX - (x - radius) });
    consider({ nx: -1, nz: 0, depth: x + radius - b.maxX });
    consider({ nx: 0, nz: 1, depth: b.minZ - (z - radius) });
    consider({ nx: 0, nz: -1, depth: z + radius - b.maxZ });
    this.nearby(x, z, radius, (t) => {
      if (t[7] <= above) return false;
      // Skip triangles whose bounding box the disc cannot reach (most of a bucket).
      if (x + radius < Math.min(t[0], t[2], t[4]) || x - radius > Math.max(t[0], t[2], t[4])
        || z + radius < Math.min(t[1], t[3], t[5]) || z - radius > Math.max(t[1], t[3], t[5])) return false;
      consider(triangleContact(x, z, t, radius));
      return false;
    });
    return deepest;
  }

  // ---- Connected regions (RESTART RANDOM, SHOW CLEARANCE) ----

  // Label every free cell with its connected region: one flood fill over the
  // grid, stepping to a neighbouring free cell only when the disc can slide
  // straight there both ways (the same test route() uses), so two cells with the
  // same label always have a route. Blocked cells get -1. Stored on this.regions.
  labelRegions() {
    const labels = new Int32Array(this.free.length).fill(-1);
    const sizes = [];
    const queue = new Int32Array(this.free.length);
    const linked = (i, j) => this.clearLine(this.point(i), this.point(j)) && this.clearLine(this.point(j), this.point(i));
    for (let seed = 0; seed < this.free.length; seed += 1) {
      if (!this.free[seed] || labels[seed] >= 0) continue;
      const id = sizes.length;
      let head = 0, tail = 0;
      queue[tail++] = seed;
      labels[seed] = id;
      while (head < tail) {
        const i = queue[head++];
        const col = i % this.columns;
        for (const j of [col > 0 ? i - 1 : -1, col < this.columns - 1 ? i + 1 : -1, i - this.columns, i + this.columns]) {
          if (j < 0 || j >= this.free.length || !this.free[j] || labels[j] >= 0 || !linked(i, j)) continue;
          labels[j] = id;
          queue[tail++] = j;
        }
      }
      sizes.push(tail);
    }
    this.regions = { labels, sizes: Int32Array.from(sizes), count: sizes.length };
    return this.regions;
  }

  // Free cells with `margin` extra room all round: where a random start may
  // put the Leaper (the margin covers the brain raster's conservative cell edges).
  markSpawnable(margin = 0.2) {
    this.spawnable = new Uint8Array(this.free.length);
    for (let i = 0; i < this.free.length; i += 1) {
      if (!this.free[i]) continue;
      const p = this.point(i);
      this.spawnable[i] = !this.blocked(p.x, p.z, this.radius + margin);
    }
    return this.spawnable;
  }

  // The region label of the free cell nearest to a map point (-1 if none).
  regionAt(p) {
    const regions = this.regions ?? this.labelRegions();
    const i = this.nearest(p);
    return i < 0 ? -1 : regions.labels[i];
  }

  point(i) {
    return { x: this.bounds.minX + (i % this.columns + 0.5) * this.cell,
      z: this.bounds.minZ + (Math.floor(i / this.columns) + 0.5) * this.cell };
  }

  nearest(p) {
    let best = -1;
    let distance = Infinity;
    for (let i = 0; i < this.free.length; i += 1) {
      if (!this.free[i]) continue;
      const q = this.point(i);
      const d = (q.x - p.x) ** 2 + (q.z - p.z) ** 2;
      if (d < distance) { best = i; distance = d; }
    }
    return best;
  }

  clearLine(a, b) {
    const steps = Math.max(1, Math.ceil(Math.hypot(a.x - b.x, a.z - b.z) / 0.1));
    for (let i = 0; i <= steps; i += 1) {
      const f = i / steps;
      if (this.blocked(a.x + (b.x - a.x) * f, a.z + (b.z - a.z) * f)) return false;
    }
    return true;
  }

  route(start, goal) {
    if (this.blocked(start.x, start.z) || this.blocked(goal.x, goal.z)) return [];
    if (this.clearLine(start, goal)) return [start, goal];
    const first = this.nearest(start);
    const last = this.nearest(goal);
    if (first < 0 || last < 0 || !this.clearLine(start, this.point(first))
      || !this.clearLine(this.point(last), goal)) return [];
    const parent = new Int32Array(this.free.length).fill(-1);
    const queue = [first];
    parent[first] = first;
    for (let head = 0; head < queue.length && parent[last] < 0; head += 1) {
      const i = queue[head];
      const col = i % this.columns;
      for (const j of [col > 0 ? i - 1 : -1, col < this.columns - 1 ? i + 1 : -1,
        i - this.columns, i + this.columns]) {
        if (j < 0 || j >= this.free.length || !this.free[j] || parent[j] >= 0) continue;
        if (!this.clearLine(this.point(i), this.point(j))) continue;
        parent[j] = i;
        queue.push(j);
      }
    }
    if (parent[last] < 0) return [];
    const path = [goal];
    for (let i = last; i !== first; i = parent[i]) path.push(this.point(i));
    path.push(this.point(first), start);
    path.reverse();
    const smooth = [start];
    let anchor = 0;
    while (anchor < path.length - 1) {
      let next = anchor + 1;
      while (next + 1 < path.length && this.clearLine(path[anchor], path[next + 1])) next += 1;
      smooth.push(path[next]);
      anchor = next;
    }
    return smooth;
  }
}
