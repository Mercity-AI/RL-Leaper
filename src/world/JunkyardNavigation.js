// Conservative flat-ground clearance: a disk around the complete leg span.
// Mesh triangles retain height so roofs above the robot do not seal passages.
function segmentDistanceSquared(x, z, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz)
    / (dx * dx + dz * dz || 1)));
  return (x - ax - t * dx) ** 2 + (z - az - t * dz) ** 2;
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
