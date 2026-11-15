"""Walking distance for the Leaper around obstacles: one distance map per goal spot.

Used by the hide-spot diagnostic and by the R6 "look where she was" scoring
(scorer only: nothing here is an input to the brain).

``LeaperWalk(world)`` builds an open-cell grid (1-unit cells) for a body of
radius 1.5 (the Leaper's body plus its near legs; the plan's R4 fallback size),
then ``field(spot)`` returns walking distances from every open cell to within
4 units of ``spot`` (cells there start at their straight-line distance to the
spot, since a hiding spot may be too tight for the Leaper itself), and
``distance(field, point)`` reads it, falling back to the straight line when the
point is off the grid's open cells. Dijkstra on 8 neighbours with the same
no-corner-cutting rule as rl.moving_target.Grid, compiled with numba.
"""
from __future__ import annotations

import heapq
import math

import numpy as np

from rl.moving_target import Grid

try:
    from numba import njit
except ImportError:
    njit = None

LEAPER_RADIUS = 1.5
NEAR_SPOT = 4.0


def _dijkstra_py(open_, seeds_i, seeds_j, seeds_cost):
    rows, cols = open_.shape
    dist = np.full((rows, cols), np.inf)
    heap = [(0.0, 0, 0)]
    heap.pop()
    for k in range(seeds_i.shape[0]):
        i, j, c = seeds_i[k], seeds_j[k], seeds_cost[k]
        if c < dist[i, j]:
            dist[i, j] = c
            heapq.heappush(heap, (c, i, j))
    steps_i = (1, -1, 0, 0, 1, 1, -1, -1)
    steps_j = (0, 0, 1, -1, 1, -1, 1, -1)
    costs = (1.0, 1.0, 1.0, 1.0, 1.4142135623730951, 1.4142135623730951,
             1.4142135623730951, 1.4142135623730951)
    while heap:
        d, i, j = heapq.heappop(heap)
        if d > dist[i, j]:
            continue
        for s in range(8):
            ni, nj = i + steps_i[s], j + steps_j[s]
            if ni < 0 or nj < 0 or ni >= rows or nj >= cols or not open_[ni, nj]:
                continue
            if s >= 4 and not (open_[i + steps_i[s], j] and open_[i, j + steps_j[s]]):
                continue
            nd = d + costs[s]
            if nd < dist[ni, nj]:
                dist[ni, nj] = nd
                heapq.heappush(heap, (nd, ni, nj))
    return dist


_dijkstra = njit(cache=True)(_dijkstra_py) if njit is not None else _dijkstra_py


class LeaperWalk:
    def __init__(self, world, radius=LEAPER_RADIUS):
        self.grid = Grid(world, radius=radius)
        self.open = np.ascontiguousarray(self.grid.open)
        self.cell = float(self.grid.cell)
        self.origin = np.asarray(self.grid.origin, dtype=np.float64)

    def field(self, spot):
        spot = np.asarray(spot, dtype=np.float64)
        near = self.grid.centres[self.open.reshape(-1)]
        gap = np.linalg.norm(near - spot, axis=1)
        keep = gap <= NEAR_SPOT
        if not keep.any():
            keep = gap <= gap.min() + 1e-9
        cells = np.floor((near[keep] - self.origin) / self.cell).astype(np.int64)
        return _dijkstra(self.open, cells[:, 0].copy(), cells[:, 1].copy(), gap[keep].astype(np.float64))

    def distance(self, field, point, spot):
        point = np.asarray(point, dtype=np.float64)
        i, j = np.clip(np.floor((point - self.origin) / self.cell).astype(int), 0, np.asarray(field.shape) - 1)
        best = math.inf
        for di in (-1, 0, 1):
            for dj in (-1, 0, 1):
                a, b = i + di, j + dj
                if 0 <= a < field.shape[0] and 0 <= b < field.shape[1] and math.isfinite(field[a, b]):
                    centre = self.origin + (np.array([a, b]) + 0.5) * self.cell
                    best = min(best, field[a, b] + float(np.linalg.norm(point - centre)))
        if math.isfinite(best):
            return best
        return float(np.linalg.norm(point - np.asarray(spot, dtype=np.float64)))
