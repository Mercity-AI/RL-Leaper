"""The game's no-hiding containers, for practice worlds (2026-11-16).

The game blocks Lola from walking into containers 01 and 06 (``PLAYER_BLOCKED_PROPS`` in
src/world/playerBlockers.js: their deep ends are seen from under 5% of the Leaper's places).
That block is game-side only; the RL yard (collision.json, the Leaper's and Lola's grids)
was never changed. An eye-hidden hiding picker (rl/round1_env.py ``eye_hide``) would be
drawn to exactly those interiors, so it skips spots inside their footprints.

Footprint = the convex hull, on the ground, of every mesh node whose name starts with the
prop's name in assets/maps/junkyard/junkyard.glb (as the game finds them), in brain units
(map units x MAP_TO_BRAIN, the scale the yard simulation uses).
"""
from __future__ import annotations

import json
import struct
from pathlib import Path

import numpy as np

from rl.moving_target import MAP_TO_BRAIN

ROOT = Path(__file__).resolve().parents[1]
GLB = ROOT / "assets/maps/junkyard/junkyard.glb"
BLOCKED = ("01 - central side-fallen freight", "06 - northeast fallen freight")


def _hull(points):
    pts = sorted(map(tuple, points))
    if len(pts) < 3:
        return np.asarray(pts)

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    def half(seq):
        out = []
        for p in seq:
            while len(out) >= 2 and cross(out[-2], out[-1], p) <= 0:
                out.pop()
            out.append(p)
        return out[:-1]
    return np.asarray(half(pts) + half(pts[::-1]))


def footprints(path=GLB, names=BLOCKED):
    raw = path.read_bytes()
    size, _ = struct.unpack_from('<II', raw, 12)
    doc = json.loads(raw[20:20 + size])
    offset = 20 + size
    bsize, _ = struct.unpack_from('<II', raw, offset)
    binary = raw[offset + 8:offset + 8 + bsize]

    def positions(index):
        item = doc['accessors'][index]
        view = doc['bufferViews'][item['bufferView']]
        return np.ndarray((item['count'], 3), dtype='<f4', buffer=binary,
                          offset=view.get('byteOffset', 0) + item.get('byteOffset', 0),
                          strides=(view.get('byteStride', 12), 4))

    found = {name: [] for name in names}

    def local(node):
        if 'matrix' in node:
            return np.array(node['matrix']).reshape(4, 4).T
        x, y, z, w = node.get('rotation', [0, 0, 0, 1])
        r = np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                      [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                      [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])
        m = np.eye(4)
        m[:3, :3] = r @ np.diag(node.get('scale', [1, 1, 1]))
        m[:3, 3] = node.get('translation', [0, 0, 0])
        return m

    def visit(index, parent):
        node = doc['nodes'][index]
        matrix = parent @ local(node)
        name = node.get('name', '').replace('_', ' ')
        owner = next((n for n in names if name.startswith(n)), None)
        if owner and 'mesh' in node:
            for primitive in doc['meshes'][node['mesh']]['primitives']:
                v = positions(primitive['attributes']['POSITION'])
                v = v @ matrix[:3, :3].T + matrix[:3, 3]
                found[owner].append(v[:, [0, 2]])
        for child in node.get('children', []):
            visit(child, matrix)

    for index in doc['scenes'][doc.get('scene', 0)]['nodes']:
        visit(index, np.eye(4))
    return {name: _hull(np.concatenate(parts) * MAP_TO_BRAIN) for name, parts in found.items() if parts}


_HULLS = None


def hulls():
    global _HULLS
    if _HULLS is None:
        _HULLS = list(footprints().values())
    return _HULLS


def inside(points, margin=0.0):
    """True where a point is inside (or within ``margin`` of) a blocked footprint."""
    points = np.asarray(points, dtype=np.float64).reshape(-1, 2)
    out = np.zeros(len(points), dtype=bool)
    for hull in hulls():
        a = hull
        b = np.roll(hull, -1, axis=0)
        edge = b - a
        rel = points[:, None, :] - a[None, :, :]
        cross = edge[None, :, 0] * rel[:, :, 1] - edge[None, :, 1] * rel[:, :, 0]
        within = np.all(cross >= 0, axis=1)          # counter-clockwise hull
        if margin > 0:
            t = np.clip(np.einsum('pkd,kd->pk', rel, edge) / np.maximum((edge * edge).sum(1), 1e-12), 0, 1)
            closest = a[None] + t[:, :, None] * edge[None]
            near = np.min(np.linalg.norm(points[:, None, :] - closest, axis=2), axis=1) <= margin
            within |= near
        out |= within
    return out
