"""Static GLB triangles and double-sided 3D sight tests (inference only)."""
import json
import struct

import numpy as np


def load_triangles(path):
    """Read the uncompressed static triangle meshes in our Blender GLB export."""
    raw = path.read_bytes()
    magic, version, length = struct.unpack_from('<4sII', raw)
    if magic != b'glTF' or version != 2 or length != len(raw):
        raise ValueError('Invalid junkyard GLB')
    offset, document, binary = 12, None, None
    while offset < length:
        size, kind = struct.unpack_from('<II', raw, offset)
        chunk = raw[offset + 8:offset + 8 + size]
        if kind == 0x4E4F534A:
            document = json.loads(chunk)
        elif kind == 0x004E4942:
            binary = chunk
        offset += 8 + size
    # Only an image extension may be required (the baked WebP texture atlas):
    # compressed or quantised geometry cannot be read here.
    geometry_extensions = [name for name in (document or {}).get('extensionsRequired', []) if name != 'EXT_texture_webp']
    if document is None or binary is None or geometry_extensions:
        raise ValueError('Sight requires an uncompressed GLB with an embedded buffer')

    def accessor(index):
        item = document['accessors'][index]
        view = document['bufferViews'][item['bufferView']]
        if item.get('sparse') or view.get('buffer', 0) != 0:
            raise ValueError('Unsupported sight mesh accessor')
        dtype = np.dtype({5121: '<u1', 5123: '<u2', 5125: '<u4', 5126: '<f4'}[item['componentType']])
        columns = {'SCALAR': 1, 'VEC3': 3}[item['type']]
        return np.ndarray((item['count'], columns), dtype=dtype, buffer=binary,
            offset=view.get('byteOffset', 0) + item.get('byteOffset', 0),
            strides=(view.get('byteStride', columns * dtype.itemsize), dtype.itemsize))

    triangles = []

    def visit(index, parent):
        node = document['nodes'][index]
        if 'skin' in node:
            raise ValueError('Sight map must be static')
        if 'matrix' in node:
            local = np.array(node['matrix']).reshape(4, 4).T
        else:
            x, y, z, w = node.get('rotation', [0, 0, 0, 1])
            rotation = np.array([
                [1-2*(y*y+z*z), 2*(x*y-z*w), 2*(x*z+y*w)],
                [2*(x*y+z*w), 1-2*(x*x+z*z), 2*(y*z-x*w)],
                [2*(x*z-y*w), 2*(y*z+x*w), 1-2*(x*x+y*y)],
            ])
            local = np.eye(4)
            local[:3, :3] = rotation @ np.diag(node.get('scale', [1, 1, 1]))
            local[:3, 3] = node.get('translation', [0, 0, 0])
        matrix = parent @ local
        if 'mesh' in node:
            for primitive in document['meshes'][node['mesh']]['primitives']:
                if primitive.get('mode', 4) != 4:
                    raise ValueError('Sight map requires triangle primitives')
                vertices = accessor(primitive['attributes']['POSITION'])
                vertices = vertices @ matrix[:3, :3].T + matrix[:3, 3]
                indices = (accessor(primitive['indices']).ravel() if 'indices' in primitive
                           else np.arange(len(vertices)))
                triangles.append(vertices[indices.reshape(-1, 3)])
        for child in node.get('children', []):
            visit(child, matrix)

    for index in document['scenes'][document.get('scene', 0)]['nodes']:
        visit(index, np.eye(4))
    return np.concatenate(triangles)


class JunkyardSight:
    # Ground-plane (x, z) grid used to find the triangles near a sight line quickly,
    # instead of testing all ~98,600 map triangles for every line.
    GRID_CELL = 2.0
    # Every grid lookup is padded by this much (map units), far more than rounding
    # error, so a triangle the line touches is never left out.
    GRID_MARGIN = 1e-3

    def __init__(self, triangles, cell=GRID_CELL):
        self.triangles = np.asarray(triangles, dtype=np.float64)
        self.low = self.triangles.min(axis=1)
        self.high = self.triangles.max(axis=1)
        self._build_grid(float(cell))

    def _build_grid(self, cell):
        """List every triangle in each grid cell its padded ground footprint touches."""
        self.cell = cell
        low = self.low[:, [0, 2]] - self.GRID_MARGIN
        high = self.high[:, [0, 2]] + self.GRID_MARGIN
        if not len(low):
            self.grid_origin, self.grid_shape = np.zeros(2), np.ones(2, dtype=np.int64)
            self.cell_start, self.cell_triangles = np.zeros(2, dtype=np.int64), np.zeros(0, dtype=np.int64)
            return
        self.grid_origin = low.min(axis=0)
        first = np.floor((low - self.grid_origin) / cell).astype(np.int64)
        last = np.floor((high - self.grid_origin) / cell).astype(np.int64)
        self.grid_shape = last.max(axis=0) + 1
        # One entry per (triangle, cell) pair, enumerated without a Python loop.
        span = last - first + 1
        counts = span[:, 0] * span[:, 1]
        owner = np.repeat(np.arange(len(low)), counts)
        offset = np.arange(counts.sum()) - np.repeat(np.cumsum(counts) - counts, counts)
        ix = first[owner, 0] + offset // span[owner, 1]
        iz = first[owner, 1] + offset % span[owner, 1]
        cell_id = ix * self.grid_shape[1] + iz
        # Sorted by cell (stable, so triangle order is kept within each cell).
        order = np.argsort(cell_id, kind='stable')
        self.cell_triangles = owner[order]
        self.cell_start = np.searchsorted(cell_id[order], np.arange(self.grid_shape.prod() + 1))

    def _nearby(self, origin, end):
        """Ascending indices of triangles listed in the grid cells the line's ground path crosses."""
        a, b = origin[[0, 2]], end[[0, 2]]
        margin = self.GRID_MARGIN
        first = np.floor((np.minimum(a, b) - margin - self.grid_origin) / self.cell).astype(np.int64)
        last = np.floor((np.maximum(a, b) + margin - self.grid_origin) / self.cell).astype(np.int64)
        first, last = np.maximum(first, 0), np.minimum(last, self.grid_shape - 1)
        if np.any(last < first):
            return np.zeros(0, dtype=np.int64)
        ix, iz = np.meshgrid(np.arange(first[0], last[0] + 1), np.arange(first[1], last[1] + 1), indexing='ij')
        ix, iz = ix.ravel(), iz.ravel()
        # Keep the cells whose padded square the 2D line really passes through (slab test).
        box_low = self.grid_origin + np.stack((ix, iz), axis=1) * self.cell - margin
        box_high = box_low + self.cell + 2 * margin
        enter, leave = np.zeros(len(ix)), np.ones(len(ix))
        for axis in (0, 1):
            step = b[axis] - a[axis]
            if abs(step) < 1e-12:
                inside = (box_low[:, axis] <= a[axis]) & (a[axis] <= box_high[:, axis])
                leave = np.where(inside, leave, -1.0)
            else:
                near = (box_low[:, axis] - a[axis]) / step
                far = (box_high[:, axis] - a[axis]) / step
                enter = np.maximum(enter, np.minimum(near, far))
                leave = np.minimum(leave, np.maximum(near, far))
        cells = (ix * self.grid_shape[1] + iz)[enter <= leave]
        parts = [self.cell_triangles[self.cell_start[c]:self.cell_start[c + 1]] for c in cells]
        return np.unique(np.concatenate(parts)) if parts else np.zeros(0, dtype=np.int64)

    def hit(self, origin, end):
        """Nearest segment hit, including backfaces and thin overhead surfaces."""
        origin, end = np.asarray(origin), np.asarray(end)
        direction = end - origin
        # Only triangles in the grid cells under the line can be hit. They then get
        # the original bounding-box test and ray maths, unchanged.
        nearby = self._nearby(origin, end)
        mask = np.all(self.high[nearby] >= np.minimum(origin, end) - 1e-8, axis=1)
        mask &= np.all(self.low[nearby] <= np.maximum(origin, end) + 1e-8, axis=1)
        tri = self.triangles[nearby[mask]]
        if not len(tri):
            return None
        a, b = tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0]
        p = np.cross(direction, b)
        determinant = np.einsum('ij,ij->i', a, p)
        valid = np.abs(determinant) > 1e-10
        inverse = np.divide(1, determinant, out=np.zeros_like(determinant), where=valid)
        delta = origin - tri[:, 0]
        u = np.einsum('ij,ij->i', delta, p) * inverse
        q = np.cross(delta, a)
        v = (q @ direction) * inverse
        t = np.einsum('ij,ij->i', b, q) * inverse
        valid &= (u >= -1e-8) & (v >= -1e-8) & (u + v <= 1 + 1e-8)
        valid &= (t >= 0) & (t < 1 - 1e-7)
        return (origin + direction * t[valid].min()).tolist() if np.any(valid) else None
