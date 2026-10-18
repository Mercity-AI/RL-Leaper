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

export class JunkyardNavigation {
  constructor(data, radius, height, cell = 0.4) {
    this.bounds = data.bounds;
    this.radius = radius;
    this.cell = cell;
    this.bucketSize = 2;
    this.buckets = new Map();
    for (const t of data.triangles) {
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
      const p = this.point(i);
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

  // The deepest place a disc at (x, z) overlaps the map (a solid triangle or
  // the map's outer edge): { nx, nz } is the unit normal pointing out of the
  // solid and `depth` how far the disc overlaps it; null when the disc is
  // clear. Lola's movement slides along this normal instead of stopping dead.
  contact(x, z, radius = this.radius) {
    let deepest = null;
    const consider = (hit) => { if (hit && hit.depth > 0 && (!deepest || hit.depth > deepest.depth)) deepest = hit; };
    // The map's outer edges are walls facing inward.
    const b = this.bounds;
    consider({ nx: 1, nz: 0, depth: b.minX - (x - radius) });
    consider({ nx: -1, nz: 0, depth: x + radius - b.maxX });
    consider({ nx: 0, nz: 1, depth: b.minZ - (z - radius) });
    consider({ nx: 0, nz: -1, depth: z + radius - b.maxZ });
    for (let ix = Math.floor((x - radius) / this.bucketSize); ix <= Math.floor((x + radius) / this.bucketSize); ix += 1) {
      for (let iz = Math.floor((z - radius) / this.bucketSize); iz <= Math.floor((z + radius) / this.bucketSize); iz += 1) {
        for (const t of this.buckets.get(`${ix},${iz}`) || []) {
          // Skip triangles whose bounding box the disc cannot reach (most of a bucket).
          if (x + radius < Math.min(t[0], t[2], t[4]) || x - radius > Math.max(t[0], t[2], t[4])
            || z + radius < Math.min(t[1], t[3], t[5]) || z - radius > Math.max(t[1], t[3], t[5])) continue;
          consider(triangleContact(x, z, t, radius));
        }
      }
    }
    return deepest;
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
