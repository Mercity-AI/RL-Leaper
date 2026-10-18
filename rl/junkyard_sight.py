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
    if document is None or binary is None or document.get('extensionsRequired'):
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
    def __init__(self, triangles):
        self.triangles = np.asarray(triangles, dtype=np.float64)
        self.low = self.triangles.min(axis=1)
        self.high = self.triangles.max(axis=1)

    def hit(self, origin, end):
        """Nearest segment hit, including backfaces and thin overhead surfaces."""
        origin, end = np.asarray(origin), np.asarray(end)
        direction = end - origin
        mask = np.all(self.high >= np.minimum(origin, end) - 1e-8, axis=1)
        mask &= np.all(self.low <= np.maximum(origin, end) + 1e-8, axis=1)
        tri = self.triangles[mask]
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
