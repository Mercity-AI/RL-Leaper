"""Hide arena (2026-11-18, docs/HIDE_RETRAIN_PLAN_2026-11-18.md): hide scenes in a new random arena each round.

The arena is the yard's size (113 x 106 units, so the brain's distance inputs mean the same) and is made of
blocks the size of the yard's cover, at random places and angles, half of them set against an earlier
block (square to it half the time) so corners, corridors and pockets form as in the yard:

  container (20 ft)  8.85 x 3.54 units, 3.8 tall     the yard's 6.1 x 2.44 map-unit containers (14-20)
  container (40 ft)  17.7 x 3.54 units, 3.8 tall
  bus-sized          13.7 x 5.6 units, 5.5 tall      the yard's bus (9.5 x 3.8 map units)
  low block          2-5 x 1.5-3 units, 1.2-1.6 tall its eye (2.38 up) sees over these

The blocks become exactly what the yard is made of: a solid raster on the yard's 0.145-unit cells (legs,
rays, Lola's routes, the flat sight) and a triangle mesh for the 3D eye sight, both through the same exact
fast code (rl/fast_sim.py). ``build_site`` returns everything a Round1YardEnv needs (``site=``).
``ArenaHidePractice`` plays one hide scene (rl/hide_scenes.py) in a new arena every reset.
"""
from __future__ import annotations

import math
import time

import gymnasium as gym
import numpy as np
from gymnasium import spaces

from rl.fast_kernels import _disk_blocked_py
from rl.fast_sim import make_fast, make_fast_sight
from rl.junkyard_geometry import JunkyardGeometry
from rl.junkyard_sight import JunkyardSight
from rl.moving_target import Grid, JunkyardWorld
from rl.moving_target_game_exam import LEAPER_CLEARANCE, yard

try:
    from numba import njit
except ImportError:      # pragma: no cover
    njit = None

KINDS = (  # name, how many (low, high), length, width, height (callables of rng for the low blocks)
    ("container20", (14, 20), lambda r: 8.85, lambda r: 3.54, lambda r: 3.8),
    ("container40", (3, 5), lambda r: 17.7, lambda r: 3.54, lambda r: 3.8),
    ("bus", (2, 4), lambda r: 13.7, lambda r: 5.6, lambda r: 5.5),
    ("low", (10, 16), lambda r: r.uniform(2.0, 5.0), lambda r: r.uniform(1.5, 3.0), lambda r: r.uniform(1.2, 1.6)),
)
CLUSTER = 0.5        # this share of blocks is placed against an earlier block (corners, corridors, pockets)
GAP = 1.5            # blocks keep at least this far apart
EDGE = 3.0           # and this far from the arena's edge
TRIES = 400


if njit is not None:
    _disk = njit(cache=True, fastmath=False, error_model="numpy")(_disk_blocked_py)

    @njit(cache=True)
    def _many(solid, min_x, min_z, max_x, max_z, cell, points, radius):
        out = np.zeros(points.shape[0], dtype=np.bool_)
        for k in range(points.shape[0]):
            out[k] = _disk(solid, min_x, min_z, max_x, max_z, cell, points[k, 0], points[k, 1], radius)
        return out
else:      # pragma: no cover
    _many = None


def _corners(box):
    x, z, length, width, angle = box[:5]
    c, s = math.cos(angle), math.sin(angle)
    along, across = np.array([s, c]) * length / 2, np.array([c, -s]) * width / 2
    centre = np.array([x, z])
    return np.array([centre + along + across, centre + along - across,
                     centre - along - across, centre - along + across])


class BoxGeometry(JunkyardGeometry):
    """A JunkyardGeometry whose solid raster comes from oriented boxes instead of a collision file."""

    def __init__(self, boxes, minimum, maximum, cell, scale):
        self.scale = scale
        self.cell = cell
        self.minimum = np.asarray(minimum, dtype=np.float64)
        self.maximum = np.asarray(maximum, dtype=np.float64)
        self.shape = np.ceil((self.maximum - self.minimum) / self.cell).astype(int)
        self.solid = np.zeros(tuple(self.shape), dtype=bool)
        self.raster_cached = False
        padding = cell / math.sqrt(2)           # as the yard's rasterizer: any cell the box touches
        for box in boxes:
            x, z, length, width, angle = box[:5]
            c, s = math.cos(angle), math.sin(angle)
            reach = math.hypot(length, width) / 2 + padding
            low = np.maximum(0, np.floor((np.array([x, z]) - reach - self.minimum) / cell).astype(int))
            high = np.minimum(self.shape - 1, np.floor((np.array([x, z]) + reach - self.minimum) / cell).astype(int))
            ix, iz = np.meshgrid(np.arange(low[0], high[0] + 1), np.arange(low[1], high[1] + 1), indexing="ij")
            px = self.minimum[0] + (ix + 0.5) * cell - x
            pz = self.minimum[1] + (iz + 0.5) * cell - z
            along = px * s + pz * c
            across = px * c - pz * s
            inside = (np.abs(along) <= length / 2 + padding) & (np.abs(across) <= width / 2 + padding)
            self.solid[ix, iz] |= inside


class BoxWorld(JunkyardWorld):
    """JunkyardWorld with every disc test of a batch in one compiled call (same answers)."""

    def blocked_many(self, points, radius):
        points = np.ascontiguousarray(np.asarray(points, dtype=np.float64).reshape(-1, 2))
        g = self.geometry
        if _many is None:
            return super().blocked_many(points, radius)
        return _many(np.ascontiguousarray(g.solid), float(g.minimum[0]), float(g.minimum[1]),
                     float(g.maximum[0]), float(g.maximum[1]), float(g.cell), points, float(radius))


def box_triangles(boxes):
    """Top and four sides of every box, as (x, y, z) triangles (the sight test is double-sided)."""
    tris = []
    for box in boxes:
        height = box[5]
        c = _corners(box)
        bottom = [np.array([p[0], 0.0, p[1]]) for p in c]
        top = [np.array([p[0], height, p[1]]) for p in c]
        tris += [[top[0], top[1], top[2]], [top[0], top[2], top[3]]]
        for a in range(4):
            b = (a + 1) % 4
            tris += [[bottom[a], bottom[b], top[b]], [bottom[a], top[b], top[a]]]
    return np.asarray(tris, dtype=np.float64)


def draw_layout(rng):
    """Random blocks for one arena: list of (x, z, length, width, angle, height, kind)."""
    geometry, _, _, _ = yard()
    minimum, maximum = np.asarray(geometry.minimum), np.asarray(geometry.maximum)
    coarse = 0.5
    shape = np.ceil((maximum - minimum) / coarse).astype(int)
    taken = np.zeros(tuple(shape), dtype=bool)
    boxes = []
    for name, (lo, hi), length_of, width_of, height_of in KINDS:
        for _ in range(int(rng.integers(lo, hi + 1))):
            for _ in range(TRIES):
                length, width, height = length_of(rng), width_of(rng), height_of(rng)
                angle = float(rng.uniform(0.0, math.pi))
                reach = math.hypot(length, width) / 2
                if boxes and rng.random() < CLUSTER:
                    other = boxes[int(rng.integers(len(boxes)))]
                    if rng.random() < 0.5:
                        angle = (other[4] + rng.choice([0.0, math.pi / 2])) % math.pi   # square to its neighbour
                    gap = math.hypot(other[2], other[3]) / 2 + reach
                    heading = float(rng.uniform(-math.pi, math.pi))
                    x = other[0] + math.sin(heading) * gap * float(rng.uniform(0.45, 0.9))
                    z = other[1] + math.cos(heading) * gap * float(rng.uniform(0.45, 0.9))
                    if not (minimum[0] + EDGE + reach <= x <= maximum[0] - EDGE - reach
                            and minimum[1] + EDGE + reach <= z <= maximum[1] - EDGE - reach):
                        continue
                else:
                    x = float(rng.uniform(minimum[0] + EDGE + reach, maximum[0] - EDGE - reach))
                    z = float(rng.uniform(minimum[1] + EDGE + reach, maximum[1] - EDGE - reach))
                box = (x, z, length, width, angle, height, name)
                # Footprint grown by GAP must not touch another block's footprint (coarse cells).
                grown = (x, z, length + 2 * GAP, width + 2 * GAP, angle)
                cells = _cells(grown, minimum, coarse, shape)
                if taken[cells].any():
                    continue
                taken[_cells(box, minimum, coarse, shape)] = True
                boxes.append(box)
                break
    return boxes


def _cells(box, minimum, cell, shape):
    x, z, length, width, angle = box[:5]
    c, s = math.cos(angle), math.sin(angle)
    reach = math.hypot(length, width) / 2 + cell
    low = np.maximum(0, np.floor((np.array([x, z]) - reach - minimum) / cell).astype(int))
    high = np.minimum(shape - 1, np.floor((np.array([x, z]) + reach - minimum) / cell).astype(int))
    ix, iz = np.meshgrid(np.arange(low[0], high[0] + 1), np.arange(low[1], high[1] + 1), indexing="ij")
    px = minimum[0] + (ix + 0.5) * cell - x
    pz = minimum[1] + (iz + 0.5) * cell - z
    inside = (np.abs(px * s + pz * c) <= length / 2 + cell) & (np.abs(px * c - pz * s) <= width / 2 + cell)
    return ix[inside], iz[inside]


def build_site(boxes):
    """Everything a Round1YardEnv needs for this arena (``site=``)."""
    base, _, _, _ = yard()
    geometry = make_fast(BoxGeometry(boxes, base.minimum, base.maximum, base.cell, base.scale))
    sight = make_fast_sight(JunkyardSight(box_triangles(boxes)))
    world = BoxWorld(geometry)
    grid = Grid(world)
    spots = grid.open_centres
    leaper_open = spots[~world.blocked_many(spots, LEAPER_CLEARANCE)]
    return dict(geometry=geometry, sight=sight, world=world, grid=grid, leaper_open=leaper_open, boxes=boxes,
                closed=None)


def arena_scene_env(round_seed, switches):
    """A fresh hide-scene environment in the arena drawn by ``round_seed`` (the arena and the start both)."""
    from rl.hide_scenes import scene_env
    rng = np.random.default_rng((int(round_seed), 61120))
    site = build_site(draw_layout(rng))
    return scene_env(round_seed, switches, site=site)


class ArenaHidePractice(gym.Env):
    """Practice world that plays one hide scene in a new arena every reset."""

    metadata = {}

    def __init__(self, seed, **switches):
        from rl.round1_env import observation_size
        self.switches = switches
        self.rng = np.random.default_rng((int(seed), 61121))
        self.inner = None
        size = observation_size(switches.get("new_inputs"), switches.get("not_there"), switches.get("privileged"))
        self.observation_space = spaces.Box(-1, 1, (size,), dtype=np.float32)
        self.action_space = spaces.Box(-1, 1, (2,), dtype=np.float32)
        self.scene_steps = 0
        self.scenes = 0
        self.misses = 0
        self.setup_seconds = 0.0

    def reset(self, *, seed=None, options=None):
        from rl.hide_scenes import EXAM_SEEDS, apply_scene, draw_scene
        started = time.perf_counter()
        if self.inner is not None:
            self.inner.close()
        for _ in range(20):
            round_seed = int(self.rng.integers(1_000_000, 2**31 - 1))
            if EXAM_SEEDS[0] <= round_seed < EXAM_SEEDS[1]:
                continue
            env = arena_scene_env(round_seed, self.switches)
            scene = draw_scene(env, self.rng)
            if scene is not None:
                self.inner = env
                obs = apply_scene(env, scene)
                self.scene_steps = 0
                self.scenes += 1
                self.setup_seconds += time.perf_counter() - started
                return obs, dict(target_visible=bool(env.target_visible))
            env.close()
            self.misses += 1
        raise RuntimeError("no hide scene in 20 arenas")

    def step(self, action):
        from rl.hide_scenes import SCENE_STEPS
        obs, reward, terminated, truncated, info = self.inner.step(action)
        self.scene_steps += 1
        if info.get("shot_win") and not terminated:
            terminated, truncated = True, False
            info["is_success"] = True
        elif not terminated and self.scene_steps >= SCENE_STEPS:
            truncated = True
        if terminated or truncated:
            info["round_look"] = getattr(self.inner, "round_look", None)
            info["round_losses"] = getattr(self.inner, "round_losses", None)
        return obs, reward, terminated, truncated, info
