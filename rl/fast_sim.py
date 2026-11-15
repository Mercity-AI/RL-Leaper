"""Exact fast versions of the slowest per-step simulation code (training speed only).

Nothing here changes what the brain sees or scores: every function returns the
same values, bit for bit, as the code it replaces (tests/test_fast_sim.py runs
fast and original environments in lockstep and compares every observation,
reward and info). The frozen recipe files are not edited; these are overrides
mixed in front of them in the lab's own environments.

1. ``_frontier_note``: the original labels unchecked regions with a Python
   flood fill every step (about 60% of a plain-arena step). Here the regions are
   labelled with numpy (each region named by its first cell in scan order, which
   is exactly the region the original keeps on a size tie) and the nearest
   candidate is found with numpy, then confirmed with ``math.hypot`` as the
   original does. Only an exact distance tie, where the original's flood-fill
   order decides, falls back to the original code.
2. Junkyard rays and sight checks (``ray_distances``, ``points_visible``): the
   original samples every ray to its full range. Here rays are sampled in short
   chunks and stop at the first solid sample (or, for a sight check, once the
   point is reached), which cannot change the result.
"""
from __future__ import annotations

import math

import numpy as np

from rl.fast_kernels import disk_blocked as _compiled_disk_blocked
from rl.fast_kernels import first_hits as _compiled_first_hits
from rl.fast_kernels import label_regions as _compiled_label_regions

_NEIGHBOURS = ((1, 0), (-1, 0), (0, 1), (0, -1))


def _label_regions(unchecked):
    """Label 4-connected True cells by the flat index of their first cell (scan order).

    Unchecked cells get that index; checked cells get -1.
    """
    if _compiled_label_regions is not None:
        return _compiled_label_regions(np.ascontiguousarray(unchecked))
    steps_i, steps_j = unchecked.shape
    big = unchecked.size
    labels = np.where(unchecked, np.arange(big).reshape(unchecked.shape), big)
    flat_unchecked = unchecked.ravel()
    while True:
        new = labels.copy()
        np.minimum(new[1:, :], labels[:-1, :], out=new[1:, :])
        np.minimum(new[:-1, :], labels[1:, :], out=new[:-1, :])
        np.minimum(new[:, 1:], labels[:, :-1], out=new[:, 1:])
        np.minimum(new[:, :-1], labels[:, 1:], out=new[:, :-1])
        new[~unchecked] = big
        # Pointer jumping: a label is the index of a cell in the same region,
        # whose own label is no larger; following it shortens long chains.
        flat = new.ravel()
        flat[flat_unchecked] = flat[flat[flat_unchecked]]
        if np.array_equal(new, labels):
            break
        labels = new
    labels = labels.ravel()
    labels[~flat_unchecked] = -1
    return labels


class FastFrontierMixin:
    """Exact fast ``_frontier_note`` for LeaperReachEnv subclasses (PPO_33 note)."""

    FAST_SIM = True

    def _frontier_note(self):
        if not self.FAST_SIM:
            return super()._frontier_note()
        invalid = np.array([0.0, 0.0, 1.0, 0.0, 0.0], dtype=np.float32)
        steps = self.coverage_steps
        total = self.coverage_cleared.size
        cleared_grid = self.coverage_cleared.reshape(steps, steps)
        unchecked = ~cleared_grid
        if not unchecked.any():
            self._frontier_target = None
            self._frontier_valid = 0.0
            return invalid

        labels = _label_regions(unchecked)
        present = labels[labels >= 0]
        sizes = np.bincount(present, minlength=total)
        region_size = int(sizes.max())
        if region_size < self.FRONTIER_MIN_REGION_CELLS:
            self._frontier_target = None
            self._frontier_valid = 0.0
            return invalid
        # The original keeps the first region (in scan order) of the largest size.
        best_label = int(np.flatnonzero(sizes == region_size)[0])
        region = (labels == best_label).reshape(steps, steps)

        touches = np.zeros_like(region)
        touches[1:, :] |= cleared_grid[:-1, :]
        touches[:-1, :] |= cleared_grid[1:, :]
        touches[:, 1:] |= cleared_grid[:, :-1]
        touches[:, :-1] |= cleared_grid[:, 1:]
        frontier = region & touches
        candidates = frontier if frontier.any() else region
        ci, cj = np.nonzero(candidates)

        cell = self.COVERAGE_CELL_SIZE
        limit = self.WORLD_LIMIT
        px, pz = float(self.position[0]), float(self.position[1])
        cx = -limit + (ci + 0.5) * cell
        cz = -limit + (cj + 0.5) * cell
        rough = np.hypot(cx - px, cz - pz)
        near = np.flatnonzero(rough <= rough.min() * (1.0 + 1e-12) + 1e-300)
        exact = [math.hypot(float(cx[k]) - px, float(cz[k]) - pz) for k in near]
        best_distance = min(exact)
        winners = [k for k, d in zip(near, exact) if d == best_distance]
        if len(winners) > 1:
            # An exact tie: the original's flood-fill order picks; use it.
            return super()._frontier_note()
        best_x, best_z = float(cx[winners[0]]), float(cz[winners[0]])

        diagonal = 2.0 * math.sqrt(2.0) * limit
        if best_distance > 1e-6:
            dir_x = (best_x - px) / best_distance
            dir_z = (best_z - pz) / best_distance
        else:
            dir_x = dir_z = 0.0
        self._frontier_target = (best_x, best_z)
        self._frontier_valid = 1.0
        return np.array(
            [dir_x, dir_z, min(best_distance / diagonal, 1.0), min(region_size / total, 1.0), 1.0],
            dtype=np.float32,
        )


# --- Junkyard raster rays ------------------------------------------------------

_SAMPLES = {}


def _samples(geometry, max_range):
    key = (float(geometry.cell), float(max_range))
    if key not in _SAMPLES:
        if len(_SAMPLES) > 4096:
            _SAMPLES.clear()
        _SAMPLES[key] = np.arange(0, max_range + geometry.cell / 2, geometry.cell / 2)
    return _SAMPLES[key]


def _first_hits(geometry, origin, directions, distances, stop=None, chunk=24):
    """First solid sample index per ray (-1 = none), scanning in growing chunks.

    With ``stop`` (one threshold per ray), a ray also stops once a sample
    distance reaches its threshold with nothing solid before it (index -2).
    Identical to ``geometry.occupied`` over every sample, then argmax.
    """
    origin = np.asarray(origin)
    directions = np.asarray(directions)
    kernel = getattr(geometry, "_kernel", None)
    if kernel is not None:
        solid, bounds = kernel
        limits = (np.full(len(directions), np.inf) if stop is None
                  else np.ascontiguousarray(stop, dtype=np.float64))
        return _compiled_first_hits(solid, *bounds, float(origin[0]), float(origin[1]),
                                    np.ascontiguousarray(directions, dtype=np.float64),
                                    np.ascontiguousarray(distances, dtype=np.float64), limits)
    count = len(directions)
    first = np.full(count, -1, dtype=np.int64)
    active = np.arange(count)
    start = 0
    total = len(distances)
    while len(active) and start < total:
        end = min(total, start + chunk)
        part = distances[start:end]
        hits = geometry.occupied(origin + directions[active][:, None, :] * part[None, :, None])
        any_hit = hits.any(axis=1)
        index = hits.argmax(axis=1) + start
        done = any_hit.copy()
        first[active[any_hit]] = index[any_hit]
        if stop is not None:
            # Reached its point with no earlier solid sample: resolved, clear.
            reached = part[-1] >= stop[active]
            hit_before = any_hit & (distances[index] < stop[active])
            clear = reached & ~hit_before
            first[active[clear]] = -2
            done |= clear
        active = active[~done]
        start = end
        chunk *= 2
    return first


def fast_ray_distances(geometry, origin, directions, max_range):
    """Same result as ``JunkyardGeometry.ray_distances``."""
    distances = _samples(geometry, max_range)
    first = _first_hits(geometry, origin, directions, distances)
    hit = first >= 0
    out = np.full(len(first), max_range, dtype=np.float64)
    out[hit] = np.minimum(distances[first[hit]], max_range)
    return out


def fast_points_visible(geometry, origin, yaw, points, fov, max_range, target_radius):
    """Same result as ``JunkyardGeometry.points_visible``."""
    points = np.atleast_2d(points)
    delta = points - origin
    distance = np.linalg.norm(delta, axis=1)
    relative = (np.arctan2(delta[:, 0], delta[:, 1]) - yaw + math.pi) % (2 * math.pi) - math.pi
    visible = (np.abs(relative) <= fov / 2) & (distance - target_radius <= max_range)
    visible |= distance <= 1e-9
    indices = np.flatnonzero(visible & (distance > 1e-9))
    for batch in np.array_split(indices, max(1, math.ceil(len(indices) / 128))):
        if not len(batch):
            continue
        directions = delta[batch] / distance[batch, None]
        limit = min(max_range, float(distance[batch].max()))
        distances = _samples(geometry, limit)
        threshold = distance[batch] - target_radius
        first = _first_hits(geometry, origin, directions, distances, stop=threshold)
        # A solid sample before the point hides it (the original's hit < distance - r).
        hit = first >= 0
        hidden = np.zeros(len(batch), dtype=bool)
        hidden[hit] = np.minimum(distances[first[hit]], limit) < threshold[hit]
        visible[batch] &= ~hidden
    return visible


class FastGeometry:
    """Mixed in front of JunkyardGeometry (see ``make_fast``): same answers, faster.

    ``disk_blocked`` first sums the solid cells under the disc's square with a
    summed-area table; an empty square is "not blocked" in the original too, so
    only squares with something solid run the original test.
    """

    def _prepare_fast(self):
        solid = np.asarray(self.solid, dtype=np.int64)
        table = np.zeros((solid.shape[0] + 1, solid.shape[1] + 1), dtype=np.int64)
        table[1:, 1:] = solid.cumsum(axis=0).cumsum(axis=1)
        self._table = table
        self._min = (float(self.minimum[0]), float(self.minimum[1]))
        self._max = (float(self.maximum[0]), float(self.maximum[1]))
        self._last = (int(self.shape[0]) - 1, int(self.shape[1]) - 1)
        self._cell = float(self.cell)
        self._kernel = None
        if _compiled_first_hits is not None:
            self._kernel = (np.ascontiguousarray(self.solid, dtype=np.bool_),
                            (self._min[0], self._min[1], self._max[0], self._max[1], self._cell))

    def disk_blocked(self, point, radius):
        x, z = float(point[0]), float(point[1])
        r = float(radius)
        if self._kernel is not None:
            solid, bounds = self._kernel
            return bool(_compiled_disk_blocked(solid, *bounds, x, z, r))
        (min_x, min_z), (max_x, max_z) = self._min, self._max
        if x - r < min_x or z - r < min_z or x + r > max_x or z + r > max_z:
            return True
        cell = self._cell
        i0 = max(0, math.floor((x - r - min_x) / cell))
        j0 = max(0, math.floor((z - r - min_z) / cell))
        i1 = min(self._last[0], math.floor((x + r - min_x) / cell))
        j1 = min(self._last[1], math.floor((z + r - min_z) / cell))
        if i1 < i0 or j1 < j0:
            return False
        t = self._table
        if t[i1 + 1, j1 + 1] - t[i0, j1 + 1] - t[i1 + 1, j0] + t[i0, j0] == 0:
            return False
        return super().disk_blocked(point, radius)

    def ray_distances(self, origin, directions, max_range):
        return fast_ray_distances(self, origin, directions, max_range)

    def points_visible(self, origin, yaw, points, fov, max_range, target_radius):
        return fast_points_visible(self, origin, yaw, points, fov, max_range, target_radius)


_FAST_CLASSES = {}


def make_fast(geometry):
    """A fast copy of a JunkyardGeometry (shares its raster; the original is untouched)."""
    base = type(geometry)
    if base not in _FAST_CLASSES:
        _FAST_CLASSES[base] = type("Fast" + base.__name__, (FastGeometry, base), {})
    fast = object.__new__(_FAST_CLASSES[base])
    fast.__dict__.update(geometry.__dict__)
    fast._prepare_fast()
    return fast
