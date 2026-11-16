"""Compiled (numba) ray marching for rl/fast_sim.py: same samples, same answers.

Each ray is walked sample by sample exactly as ``JunkyardGeometry.occupied``
sees them (point = origin + direction * distance, then floor((point - minimum)
/ cell)), with plain IEEE arithmetic (no fastmath, no fused multiply-add), and
stops at the first solid or out-of-bounds sample, or once a sample distance
reaches the ray's ``stop`` threshold (index -2). tests/test_fast_sim.py checks
the results against the original numpy code.
"""
from __future__ import annotations

import math

import numpy as np

try:
    from numba import njit
except ImportError:          # numba missing: rl/fast_sim.py keeps its numpy version
    njit = None


def _first_hits_py(solid, min_x, min_z, max_x, max_z, cell, origin_x, origin_z,
                   directions, distances, stop):
    count = directions.shape[0]
    last_i = solid.shape[0] - 1
    last_j = solid.shape[1] - 1
    first = np.full(count, -1, dtype=np.int64)
    for ray in range(count):
        dx = directions[ray, 0]
        dz = directions[ray, 1]
        limit = stop[ray]
        for k in range(distances.shape[0]):
            d = distances[k]
            if d >= limit:
                first[ray] = -2
                break
            px = origin_x + dx * d
            pz = origin_z + dz * d
            if not (px >= min_x and pz >= min_z and px < max_x and pz < max_z):
                first[ray] = k
                break
            i = int(math.floor((px - min_x) / cell))
            j = int(math.floor((pz - min_z) / cell))
            i = 0 if i < 0 else (last_i if i > last_i else i)
            j = 0 if j < 0 else (last_j if j > last_j else j)
            if solid[i, j]:
                first[ray] = k
                break
    return first


first_hits = (njit(cache=True, fastmath=False, error_model="numpy")(_first_hits_py)
              if njit is not None else None)


def _disk_blocked_py(solid, min_x, min_z, max_x, max_z, cell, x, z, radius):
    """JunkyardGeometry.disk_blocked, step for step."""
    if x - radius < min_x or z - radius < min_z or x + radius > max_x or z + radius > max_z:
        return True
    last_i = solid.shape[0] - 1
    last_j = solid.shape[1] - 1
    i0 = int(math.floor((x - radius - min_x) / cell))
    j0 = int(math.floor((z - radius - min_z) / cell))
    i1 = int(math.floor((x + radius - min_x) / cell))
    j1 = int(math.floor((z + radius - min_z) / cell))
    i0 = 0 if i0 < 0 else i0
    j0 = 0 if j0 < 0 else j0
    i1 = last_i if i1 > last_i else i1
    j1 = last_j if j1 > last_j else j1
    half = cell / 2
    limit = radius ** 2
    for i in range(i0, i1 + 1):
        for j in range(j0, j1 + 1):
            if solid[i, j]:
                cx = min_x + (i + 0.5) * cell
                cz = min_z + (j + 0.5) * cell
                dx = abs(cx - x) - half
                dz = abs(cz - z) - half
                dx = dx if dx > 0.0 else 0.0
                dz = dz if dz > 0.0 else 0.0
                if dx * dx + dz * dz < limit:
                    return True
    return False


def _label_regions_py(unchecked):
    """Label 4-connected True cells by their first cell's flat index (scan order); -1 elsewhere."""
    rows, cols = unchecked.shape
    labels = np.full(rows * cols, -1, dtype=np.int64)
    stack = np.empty(rows * cols, dtype=np.int64)
    for seed in range(rows * cols):
        si, sj = seed // cols, seed % cols
        if not unchecked[si, sj] or labels[seed] != -1:
            continue
        labels[seed] = seed
        top = 0
        stack[0] = seed
        top = 1
        while top > 0:
            top -= 1
            cell = stack[top]
            i, j = cell // cols, cell % cols
            for di, dj in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                ni, nj = i + di, j + dj
                if 0 <= ni < rows and 0 <= nj < cols and unchecked[ni, nj]:
                    other = ni * cols + nj
                    if labels[other] == -1:
                        labels[other] = seed
                        stack[top] = other
                        top += 1
    return labels


if njit is not None:
    disk_blocked = njit(cache=True, fastmath=False, error_model="numpy")(_disk_blocked_py)
    label_regions = njit(cache=True, fastmath=False)(_label_regions_py)
else:
    disk_blocked = label_regions = None


def _sight_nearby_py(ax, az, bx, bz, margin, origin_x, origin_z, cell, shape_x, shape_z,
                     cell_start, cell_triangles, stamp, counter):
    """JunkyardSight._nearby, step for step (2026-11-16): the same grid cells by the same
    float operations (slab test), then their triangle lists merged into ascending unique
    indices (what np.unique returns). ``stamp``/``counter`` are scratch: a per-triangle mark
    and the call counter, so no array is cleared between calls."""
    lo_x = ax if ax < bx else bx
    lo_z = az if az < bz else bz
    hi_x = ax if ax > bx else bx
    hi_z = az if az > bz else bz
    f0 = int(math.floor((lo_x - margin - origin_x) / cell))
    f1 = int(math.floor((lo_z - margin - origin_z) / cell))
    l0 = int(math.floor((hi_x + margin - origin_x) / cell))
    l1 = int(math.floor((hi_z + margin - origin_z) / cell))
    f0 = f0 if f0 > 0 else 0
    f1 = f1 if f1 > 0 else 0
    l0 = l0 if l0 < shape_x - 1 else shape_x - 1
    l1 = l1 if l1 < shape_z - 1 else shape_z - 1
    if l0 < f0 or l1 < f1:
        return np.zeros(0, dtype=np.int64)
    step_x = bx - ax
    step_z = bz - az
    twice = 2 * margin
    nx = l0 - f0 + 1
    nz = l1 - f1 + 1
    keep = np.zeros(nx * nz, dtype=np.bool_)
    total = 0
    for i in range(nx):
        ix = f0 + i
        low_x = origin_x + ix * cell - margin
        high_x = low_x + cell + twice
        for j in range(nz):
            iz = f1 + j
            low_z = origin_z + iz * cell - margin
            high_z = low_z + cell + twice
            enter = 0.0
            leave = 1.0
            if abs(step_x) < 1e-12:
                if not (low_x <= ax and ax <= high_x):
                    leave = -1.0
            else:
                near = (low_x - ax) / step_x
                far = (high_x - ax) / step_x
                lo = near if near < far else far
                hi = near if near > far else far
                enter = enter if enter > lo else lo
                leave = leave if leave < hi else hi
            if abs(step_z) < 1e-12:
                if not (low_z <= az and az <= high_z):
                    leave = -1.0
            else:
                near = (low_z - az) / step_z
                far = (high_z - az) / step_z
                lo = near if near < far else far
                hi = near if near > far else far
                enter = enter if enter > lo else lo
                leave = leave if leave < hi else hi
            if enter <= leave:
                keep[i * nz + j] = True
                c = ix * shape_z + iz
                total += cell_start[c + 1] - cell_start[c]
    out = np.empty(total, dtype=np.int64)
    counter[0] += 1
    mark = counter[0]
    n = 0
    for i in range(nx):
        for j in range(nz):
            if keep[i * nz + j]:
                c = (f0 + i) * shape_z + (f1 + j)
                for k in range(cell_start[c], cell_start[c + 1]):
                    t = cell_triangles[k]
                    if stamp[t] != mark:
                        stamp[t] = mark
                        out[n] = t
                        n += 1
    return np.sort(out[:n])


sight_nearby = (njit(cache=True, fastmath=False, error_model="numpy")(_sight_nearby_py)
                if njit is not None else None)


def _sight_candidates_py(ax, az, bx, bz, margin, origin_x, origin_z, cell, shape_x, shape_z,
                         cell_start, cell_triangles, stamp, counter, low, high, box_min, box_max):
    """JunkyardSight.hit's candidates: ``_nearby`` then its bounding-box mask (pure
    comparisons against the same ``np.minimum(origin, end) - 1e-8`` / ``np.maximum(...) + 1e-8``
    bounds, computed by the caller), in the same ascending order."""
    nearby = sight_nearby(ax, az, bx, bz, margin, origin_x, origin_z, cell, shape_x, shape_z,
                          cell_start, cell_triangles, stamp, counter)
    out = np.empty(nearby.shape[0], dtype=np.int64)
    n = 0
    for k in range(nearby.shape[0]):
        t = nearby[k]
        if (high[t, 0] >= box_min[0] and high[t, 1] >= box_min[1] and high[t, 2] >= box_min[2]
                and low[t, 0] <= box_max[0] and low[t, 1] <= box_max[1] and low[t, 2] <= box_max[2]):
            out[n] = t
            n += 1
    return out[:n]


sight_candidates = (njit(cache=True, fastmath=False, error_model="numpy")(_sight_candidates_py)
                    if njit is not None else None)
