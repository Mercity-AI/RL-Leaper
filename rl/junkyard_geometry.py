"""Rasterize the shared Blender collision export for fast inference sensors.

0.1 Blender-unit cells conservatively include any triangle touching the cell.
This is a planar approximation, not a mesh physics engine.
"""
import json
import math
from pathlib import Path

import numpy as np


class JunkyardGeometry:
    def __init__(self, path, scale, cell=0.1):
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        bounds = data["bounds"]
        self.scale = scale
        self.cell = cell * scale
        self.minimum = np.array([bounds["minX"], bounds["minZ"]]) * scale
        self.maximum = np.array([bounds["maxX"], bounds["maxZ"]]) * scale
        self.shape = np.ceil((self.maximum - self.minimum) / self.cell).astype(int)
        self.solid = np.zeros(tuple(self.shape), dtype=bool)
        padding = cell / math.sqrt(2)
        for raw in data["triangles"]:
            if raw[6] > 3.82 / scale or raw[7] <= 0.12:
                continue
            tri = np.array(raw[:6]).reshape(3, 2)
            low = np.maximum(0, np.floor((tri.min(axis=0) - padding - self.minimum / scale) / cell).astype(int))
            high = np.minimum(self.shape - 1, np.floor((tri.max(axis=0) + padding - self.minimum / scale) / cell).astype(int))
            if np.any(high < low):
                continue
            ix, iz = np.meshgrid(np.arange(low[0], high[0] + 1), np.arange(low[1], high[1] + 1), indexing="ij")
            points = np.stack((ix, iz), axis=-1) * cell + self.minimum / scale + cell / 2
            crosses = []
            distance = np.full(ix.shape, np.inf)
            for a, b in zip(tri, np.roll(tri, -1, axis=0)):
                edge = b - a
                delta = points - a
                crosses.append(edge[0] * delta[..., 1] - edge[1] * delta[..., 0])
                t = np.clip(np.sum(delta * edge, axis=-1) / max(float(edge @ edge), 1e-12), 0, 1)
                distance = np.minimum(distance, np.sum((delta - t[..., None] * edge) ** 2, axis=-1))
            area = (tri[1, 0]-tri[0, 0])*(tri[2, 1]-tri[0, 1]) - (tri[1, 1]-tri[0, 1])*(tri[2, 0]-tri[0, 0])
            inside = (np.all(np.array(crosses) >= 0, axis=0) | np.all(np.array(crosses) <= 0, axis=0)) if abs(area) > 1e-10 else False
            self.solid[ix, iz] |= inside | (distance <= padding ** 2)

    def occupied(self, points):
        points = np.asarray(points)
        idx = np.floor((points - self.minimum) / self.cell).astype(int)
        valid = np.all((points >= self.minimum) & (points < self.maximum), axis=-1)
        safe = np.clip(idx, 0, self.shape - 1)
        return ~valid | self.solid[safe[..., 0], safe[..., 1]]

    def disk_blocked(self, point, radius):
        point = np.asarray(point)
        if np.any(point - radius < self.minimum) or np.any(point + radius > self.maximum):
            return True
        low = np.maximum(0, np.floor((point - radius - self.minimum) / self.cell).astype(int))
        high = np.minimum(self.shape - 1, np.floor((point + radius - self.minimum) / self.cell).astype(int))
        patch = self.solid[low[0]:high[0]+1, low[1]:high[1]+1]
        solid = np.argwhere(patch) + low
        if not len(solid):
            return False
        centers = self.minimum + (solid + 0.5) * self.cell
        delta = np.maximum(np.abs(centers - point) - self.cell / 2, 0)
        return bool(np.any(np.sum(delta * delta, axis=1) < radius ** 2))

    def ray_distances(self, origin, directions, max_range):
        distances = np.arange(0, max_range + self.cell / 2, self.cell / 2)
        hits = self.occupied(np.asarray(origin) + np.asarray(directions)[:, None, :] * distances[None, :, None])
        first = hits.argmax(axis=1)
        return np.where(hits.any(axis=1), np.minimum(distances[first], max_range), max_range)

    def points_visible(self, origin, yaw, points, fov, max_range, target_radius):
        points = np.atleast_2d(points)
        delta = points - origin
        distance = np.linalg.norm(delta, axis=1)
        relative = (np.arctan2(delta[:, 0], delta[:, 1]) - yaw + math.pi) % (2 * math.pi) - math.pi
        visible = (np.abs(relative) <= fov / 2) & (distance - target_radius <= max_range)
        visible |= distance <= 1e-9
        indices = np.flatnonzero(visible & (distance > 1e-9))
        # Bounded batches avoid large arrays when the coverage grid grows.
        for batch in np.array_split(indices, max(1, math.ceil(len(indices) / 128))):
            if not len(batch):
                continue
            directions = delta[batch] / distance[batch, None]
            hits = self.ray_distances(origin, directions, min(max_range, float(distance[batch].max())))
            visible[batch] &= hits >= distance[batch] - target_radius
        return visible
