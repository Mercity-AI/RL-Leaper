// Eye-level sight for the browser brain: a JavaScript copy of rl/junkyard_sight.py.
//
// "Can the Leaper see Lola?" is answered with three 3D lines from its eye to
// three of Lola's spine bones, tested against every static triangle of the
// junkyard model. The Python server does that by brute force over ~98,600
// triangles; here a flat grid of triangle lists only skips triangles that are
// nowhere near the line, then the same tests run in the same order, so the
// answer (and the hit point drawn as a debug line) matches the server.

import { fma } from './pyMath.js';

// --- Reading the junkyard GLB (port of load_triangles) ------------------------

const COMPONENTS = { 5121: [Uint8Array, 1], 5123: [Uint16Array, 2], 5125: [Uint32Array, 4], 5126: [Float32Array, 4] };
const COLUMNS = { SCALAR: 1, VEC3: 3 };

// Returns every static triangle as a Float64Array of [ax, ay, az, bx, by, bz, cx, cy, cz].
export function loadGlbTriangles(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = String.fromCharCode(...bytes.subarray(0, 4));
  if (magic !== 'glTF' || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== bytes.byteLength) {
    throw new Error('Invalid junkyard GLB');
  }

  // Split the file into its JSON description and its binary buffer.
  let offset = 12, documentJson = null, binary = null;
  while (offset < bytes.byteLength) {
    const size = view.getUint32(offset, true), kind = view.getUint32(offset + 4, true);
    const chunk = bytes.subarray(offset + 8, offset + 8 + size);
    if (kind === 0x4E4F534A) documentJson = JSON.parse(new TextDecoder().decode(chunk));
    else if (kind === 0x004E4942) binary = chunk;
    offset += 8 + size;
  }
  // Only an image extension may be required (the baked WebP texture atlas):
  // compressed or quantised geometry cannot be read here.
  const geometryExtensions = (documentJson?.extensionsRequired ?? []).filter((name) => name !== 'EXT_texture_webp');
  if (!documentJson || !binary || geometryExtensions.length) {
    throw new Error('Sight requires an uncompressed GLB with an embedded buffer');
  }
  const binView = new DataView(binary.buffer, binary.byteOffset, binary.byteLength);

  // Read one accessor into rows of plain numbers (positions or indices).
  function accessor(index) {
    const item = documentJson.accessors[index];
    const bufferView = documentJson.bufferViews[item.bufferView];
    if (item.sparse || (bufferView.buffer ?? 0) !== 0) throw new Error('Unsupported sight mesh accessor');
    const [, size] = COMPONENTS[item.componentType];
    const columns = COLUMNS[item.type];
    const stride = bufferView.byteStride ?? columns * size;
    const start = (bufferView.byteOffset ?? 0) + (item.byteOffset ?? 0);
    const read = {
      5121: (at) => binView.getUint8(at), 5123: (at) => binView.getUint16(at, true),
      5125: (at) => binView.getUint32(at, true), 5126: (at) => binView.getFloat32(at, true),
    }[item.componentType];
    const values = new Float64Array(item.count * columns);
    for (let row = 0; row < item.count; row += 1) {
      for (let column = 0; column < columns; column += 1) values[row * columns + column] = read(start + row * stride + column * size);
    }
    return values;
  }

  // 4x4 matrix product in row-major order, summed like BLAS (FMA, k = 0..3).
  const multiply = (a, b) => {
    const out = new Float64Array(16);
    for (let i = 0; i < 4; i += 1) {
      for (let j = 0; j < 4; j += 1) {
        let sum = a[i * 4] * b[j];
        for (let k = 1; k < 4; k += 1) sum = fma(a[i * 4 + k], b[k * 4 + j], sum);
        out[i * 4 + j] = sum;
      }
    }
    return out;
  };

  // Local transform of a node, built with the same arithmetic as the Python loader.
  function localMatrix(node) {
    if (node.matrix) {
      const m = node.matrix; // column-major in glTF
      return Float64Array.from({ length: 16 }, (_, k) => m[(k % 4) * 4 + Math.floor(k / 4)]);
    }
    const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1];
    const rotation = [
      [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
      [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
      [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ];
    const scale = node.scale ?? [1, 1, 1];
    const translation = node.translation ?? [0, 0, 0];
    const local = new Float64Array(16);
    // rotation @ diag(scale): one non-zero product per entry, so one rounding.
    for (let i = 0; i < 3; i += 1) {
      for (let j = 0; j < 3; j += 1) local[i * 4 + j] = rotation[i][j] * scale[j];
      local[i * 4 + 3] = translation[i];
    }
    local[15] = 1;
    return local;
  }

  // Walk the scene tree; transform each mesh's vertices into world space.
  const parts = [];
  let total = 0;
  function visit(index, parent) {
    const node = documentJson.nodes[index];
    if (node.skin !== undefined) throw new Error('Sight map must be static');
    const matrix = multiply(parent, localMatrix(node));
    if (node.mesh !== undefined) {
      for (const primitive of documentJson.meshes[node.mesh].primitives) {
        if ((primitive.mode ?? 4) !== 4) throw new Error('Sight map requires triangle primitives');
        const source = accessor(primitive.attributes.POSITION);
        const count = source.length / 3;
        // vertices @ matrix[:3,:3].T + matrix[:3,3], accumulated like BLAS dgemm.
        const world = new Float64Array(source.length);
        for (let v = 0; v < count; v += 1) {
          const a = source[v * 3], b = source[v * 3 + 1], c = source[v * 3 + 2];
          for (let j = 0; j < 3; j += 1) {
            const row = j * 4;
            world[v * 3 + j] = fma(c, matrix[row + 2], fma(b, matrix[row + 1], a * matrix[row])) + matrix[row + 3];
          }
        }
        const indices = primitive.indices !== undefined ? accessor(primitive.indices) : Float64Array.from({ length: count }, (_, i) => i);
        const triangles = new Float64Array(indices.length * 3);
        for (let i = 0; i < indices.length; i += 1) triangles.set(world.subarray(indices[i] * 3, indices[i] * 3 + 3), i * 3);
        parts.push(triangles);
        total += triangles.length;
      }
    }
    for (const child of node.children ?? []) visit(child, matrix);
  }
  const identity = Float64Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  for (const index of documentJson.scenes[documentJson.scene ?? 0].nodes) visit(index, identity);

  const triangles = new Float64Array(total);
  let at = 0;
  for (const part of parts) {
    triangles.set(part, at);
    at += part.length;
  }
  return triangles;
}

// --- Segment tests (port of JunkyardSight.hit) ---------------------------------

// Grid bucket size in world units and the slack used when filing triangles,
// generous enough that no triangle the Python bounding-box filter keeps is missed.
const BUCKET = 1.5;
const FILE_SLACK = 1e-4;

export class JunkyardSight {
  // `triangles` are already scaled to world units (load_triangles(...) * scale).
  constructor(triangles) {
    this.triangles = triangles;
    const count = triangles.length / 9;
    this.count = count;
    this.low = new Float64Array(count * 3);
    this.high = new Float64Array(count * 3);
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (let t = 0; t < count; t += 1) {
      for (let axis = 0; axis < 3; axis += 1) {
        const a = triangles[t * 9 + axis], b = triangles[t * 9 + 3 + axis], c = triangles[t * 9 + 6 + axis];
        this.low[t * 3 + axis] = Math.min(a, b, c);
        this.high[t * 3 + axis] = Math.max(a, b, c);
      }
      minX = Math.min(minX, this.low[t * 3]);
      minZ = Math.min(minZ, this.low[t * 3 + 2]);
      maxX = Math.max(maxX, this.high[t * 3]);
      maxZ = Math.max(maxZ, this.high[t * 3 + 2]);
    }

    // File each triangle under every ground bucket its box touches (CSR lists).
    this.originX = minX - BUCKET;
    this.originZ = minZ - BUCKET;
    this.columns = Math.ceil((maxX - this.originX) / BUCKET) + 2;
    this.rows = Math.ceil((maxZ - this.originZ) / BUCKET) + 2;
    const ranges = new Int32Array(count * 4);
    const counts = new Int32Array(this.columns * this.rows + 1);
    for (let t = 0; t < count; t += 1) {
      const [x0, z0, x1, z1] = this.bucketRange(this.low[t * 3] - FILE_SLACK, this.low[t * 3 + 2] - FILE_SLACK,
        this.high[t * 3] + FILE_SLACK, this.high[t * 3 + 2] + FILE_SLACK);
      ranges.set([x0, z0, x1, z1], t * 4);
      for (let x = x0; x <= x1; x += 1) for (let z = z0; z <= z1; z += 1) counts[x * this.rows + z + 1] += 1;
    }
    for (let i = 1; i < counts.length; i += 1) counts[i] += counts[i - 1];
    this.starts = counts;
    this.items = new Int32Array(counts[counts.length - 1]);
    const fill = counts.slice(0, -1);
    for (let t = 0; t < count; t += 1) {
      const x0 = ranges[t * 4], z0 = ranges[t * 4 + 1], x1 = ranges[t * 4 + 2], z1 = ranges[t * 4 + 3];
      for (let x = x0; x <= x1; x += 1) for (let z = z0; z <= z1; z += 1) this.items[fill[x * this.rows + z]++] = t;
    }
    // A visit stamp per triangle avoids testing one triangle twice per segment.
    this.stamp = new Uint32Array(count);
    this.visit = 0;
  }

  bucketRange(x0, z0, x1, z1) {
    const clampX = (v) => Math.max(0, Math.min(this.columns - 1, Math.floor((v - this.originX) / BUCKET)));
    const clampZ = (v) => Math.max(0, Math.min(this.rows - 1, Math.floor((v - this.originZ) / BUCKET)));
    return [clampX(x0), clampZ(z0), clampX(x1), clampZ(z1)];
  }

  // Nearest point where the segment origin -> end crosses a triangle (either
  // face, thin overhead parts included), or null when the line is clear.
  hit(origin, end) {
    const [ox, oy, oz] = origin, [ex, ey, ez] = end;
    const dx = ex - ox, dy = ey - oy, dz = ez - oz;
    // The same bounding-box filter as Python (1e-8 slack on every axis).
    const loX = Math.min(ox, ex) - 1e-8, loY = Math.min(oy, ey) - 1e-8, loZ = Math.min(oz, ez) - 1e-8;
    const hiX = Math.max(ox, ex) + 1e-8, hiY = Math.max(oy, ey) + 1e-8, hiZ = Math.max(oz, ez) + 1e-8;
    const tri = this.triangles, low = this.low, high = this.high;
    this.visit = (this.visit + 1) >>> 0 || 1;
    let best = Infinity;

    // Only buckets the ground track of the segment passes through (plus margin).
    const [bx0, bz0, bx1, bz1] = this.bucketRange(loX, loZ, hiX, hiZ);
    const length = Math.hypot(dx, dz);
    const reach = BUCKET * Math.SQRT1_2 + 1e-3;
    for (let bx = bx0; bx <= bx1; bx += 1) {
      for (let bz = bz0; bz <= bz1; bz += 1) {
        const cx = this.originX + (bx + 0.5) * BUCKET, cz = this.originZ + (bz + 0.5) * BUCKET;
        if (length > 0) {
          // Distance from the bucket centre to the 2D segment.
          let s = ((cx - ox) * dx + (cz - oz) * dz) / (length * length);
          s = s < 0 ? 0 : s > 1 ? 1 : s;
          if (Math.hypot(ox + dx * s - cx, oz + dz * s - cz) > reach) continue;
        }
        const bucket = bx * this.rows + bz;
        for (let k = this.starts[bucket]; k < this.starts[bucket + 1]; k += 1) {
          const t = this.items[k];
          if (this.stamp[t] === this.visit) continue;
          this.stamp[t] = this.visit;
          const i3 = t * 3;
          if (high[i3] < loX || high[i3 + 1] < loY || high[i3 + 2] < loZ
            || low[i3] > hiX || low[i3 + 1] > hiY || low[i3 + 2] > hiZ) continue;
          const distance = this.intersect(tri, t * 9, ox, oy, oz, dx, dy, dz);
          if (distance < best) best = distance;
        }
      }
    }
    return best === Infinity ? null : [ox + dx * best, oy + dy * best, oz + dz * best];
  }

  // Moller-Trumbore with Python's tolerances; returns t in [0, 1) or Infinity.
  // The 3-term dot products are summed in NumPy's own order, so t (the drawn
  // hit point) and the edge tests round exactly like the server:
  // np.einsum('ij,ij->i') adds lanes 0 and 2 first, then lane 1 (two-wide SIMD);
  // `q @ direction` is an OpenBLAS gemv: fma(q2, d2, fma(q0, d0, q1 * d1)).
  // (With exactly one candidate triangle NumPy uses a dot kernel instead; that
  // can only shift v by its last bit, and is rare on the real map.)
  intersect(tri, i, ox, oy, oz, dx, dy, dz) {
    const v0x = tri[i], v0y = tri[i + 1], v0z = tri[i + 2];
    const ax = tri[i + 3] - v0x, ay = tri[i + 4] - v0y, az = tri[i + 5] - v0z;
    const bx = tri[i + 6] - v0x, by = tri[i + 7] - v0y, bz = tri[i + 8] - v0z;
    const px = dy * bz - dz * by, py = dz * bx - dx * bz, pz = dx * by - dy * bx;
    const determinant = (ax * px + az * pz) + ay * py;
    if (!(Math.abs(determinant) > 1e-10)) return Infinity;
    const inverse = 1 / determinant;
    const sx = ox - v0x, sy = oy - v0y, sz = oz - v0z;
    const u = ((sx * px + sz * pz) + sy * py) * inverse;
    const qx = sy * az - sz * ay, qy = sz * ax - sx * az, qz = sx * ay - sy * ax;
    const v = fma(qz, dz, fma(qx, dx, qy * dy)) * inverse;
    const t = ((bx * qx + bz * qz) + by * qy) * inverse;
    if (!(u >= -1e-8 && v >= -1e-8 && u + v <= 1 + 1e-8)) return Infinity;
    if (!(t >= 0 && t < 1 - 1e-7)) return Infinity;
    return t;
  }
}

// Scale raw GLB triangles into world units for one Leaper width (Python's
// `triangles * (7.98 / width)`).
export function scaleTriangles(triangles, scale) {
  const out = new Float64Array(triangles.length);
  for (let i = 0; i < triangles.length; i += 1) out[i] = triangles[i] * scale;
  return out;
}
