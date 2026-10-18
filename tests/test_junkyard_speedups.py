"""Proof that the brain service's speed-ups change no result.

Three speed-ups, each checked against the slow original:
- the collision raster cached on disk equals a freshly built raster exactly;
- the eye-sight grid gives exactly the same hit/miss and hit point as testing
  every map triangle, on thousands of random and targeted sight lines;
- a brain frame that reuses the step's own sight check equals a frame that
  repeats the check, as the service used to.
Only numpy and gymnasium are needed.
"""
import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
# Lets `python tests/test_junkyard_speedups.py` import the project's rl package.
sys.path.insert(0, str(ROOT))
import numpy as np
from rl.junkyard_geometry import JunkyardGeometry
from rl.junkyard_server import BrainSession
from rl.junkyard_sight import JunkyardSight, load_triangles

COLLISION = ROOT / "assets/maps/junkyard/collision.json"
MAP = ROOT / "assets/maps/junkyard/junkyard.glb"
# Shared with the other brain tests: built once, then reused from tmp/.
RASTER_CACHE = ROOT / "tmp" / "raster-cache"


def brute_force_hit(sight, origin, end):
    """The original JunkyardSight.hit, kept verbatim: tests every triangle."""
    origin, end = np.asarray(origin), np.asarray(end)
    direction = end - origin
    mask = np.all(sight.high >= np.minimum(origin, end) - 1e-8, axis=1)
    mask &= np.all(sight.low <= np.maximum(origin, end) + 1e-8, axis=1)
    tri = sight.triangles[mask]
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


class RasterCacheTests(unittest.TestCase):
    def test_cached_raster_equals_fresh_build_of_the_real_map(self):
        # One fresh ~30 s build (saved to an empty folder), then a cached load.
        with tempfile.TemporaryDirectory() as folder:
            fresh = JunkyardGeometry(COLLISION, 7.98 / 5.5, cache_dir=folder)
            cached = JunkyardGeometry(COLLISION, 7.98 / 5.5, cache_dir=folder)
            self.assertFalse(fresh.raster_cached)
            self.assertTrue(cached.raster_cached)
            self.assertTrue(np.array_equal(fresh.solid, cached.solid))
            self.assertEqual(cached.solid.dtype, bool)
            for name in ("minimum", "maximum", "shape"):
                np.testing.assert_array_equal(getattr(fresh, name), getattr(cached, name))
            self.assertGreater(fresh.solid.sum(), 1000)

    def test_cache_key_covers_map_size_and_content(self):
        with tempfile.TemporaryDirectory() as folder:
            folder = Path(folder)
            path = folder / "collision.json"
            crate = [[5, 5, 7, 5, 7, 7, 0, 2], [5, 5, 7, 7, 5, 7, 0, 2]]
            path.write_text(json.dumps(dict(bounds=dict(minX=-20, maxX=20, minZ=-20, maxZ=20), triangles=crate)))
            cache = folder / "cache"
            # Each width gets its own file; several widths are kept side by side.
            for width in (4, 5.5, 4, 5.5):
                fresh = JunkyardGeometry(path, 7.98 / width)
                cached = JunkyardGeometry(path, 7.98 / width, cache_dir=cache)
                self.assertTrue(np.array_equal(fresh.solid, cached.solid))
            self.assertEqual(len(list(cache.glob("raster-*.npy"))), 2)
            self.assertTrue(JunkyardGeometry(path, 7.98 / 4, cache_dir=cache).raster_cached)
            # An edited map never reuses the old raster.
            path.write_text(json.dumps(dict(bounds=dict(minX=-20, maxX=20, minZ=-20, maxZ=20), triangles=crate[:1])))
            edited = JunkyardGeometry(path, 7.98 / 4, cache_dir=cache)
            self.assertFalse(edited.raster_cached)
            self.assertTrue(np.array_equal(edited.solid, JunkyardGeometry(path, 7.98 / 4).solid))
            # A damaged cache file is ignored and replaced: foreign bytes, an empty
            # file (left by a crash or power cut) and a file cut off mid-array.
            good = next(cache.glob("raster-*.npy")).read_bytes()
            for damage in (b"not a raster", b"", good[:len(good) // 2]):
                with self.subTest(damaged_bytes=len(damage)):
                    for file in cache.glob("raster-*.npy"):
                        file.write_bytes(damage)
                    damaged = JunkyardGeometry(path, 7.98 / 4, cache_dir=cache)
                    self.assertFalse(damaged.raster_cached)
                    self.assertTrue(np.array_equal(damaged.solid, edited.solid))
                    self.assertTrue(JunkyardGeometry(path, 7.98 / 4, cache_dir=cache).raster_cached)
            self.assertEqual(list(cache.glob("*.tmp")), [])


class SightGridTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.triangles = load_triangles(MAP)

    def sight_lines(self, sight, rng, random_count, targeted_count):
        """Random lines across the yard, plus lines aimed through random triangles."""
        triangles = sight.triangles
        low, high = triangles.min(axis=(0, 1)), triangles.max(axis=(0, 1))
        lines = []
        for _ in range(random_count):
            origin = rng.uniform(low, high)
            origin[1] = rng.uniform(0, 6)
            lines.append((origin, origin + rng.normal(size=3) * rng.uniform(0.5, 25)))
        for _ in range(targeted_count):
            point = rng.dirichlet([1, 1, 1]) @ triangles[rng.integers(len(triangles))]
            direction = rng.normal(size=3)
            direction /= np.linalg.norm(direction)
            lines.append((point - direction * rng.uniform(0.2, 20), point + direction * rng.uniform(-0.1, 10)))
        # Awkward cases: straight up and down, zero length, along grid lines, off the map.
        corner = sight.grid_origin + sight.cell * 3
        lines += [(np.array([0, 5, 0]), np.array([0, -1, 0])), (np.array([3, 2, 3]), np.array([3, 2, 3])),
                  (np.array([corner[0], 1, -20]), np.array([corner[0], 1, 20])),
                  (np.array([-20, 1, corner[1]]), np.array([20, 1, corner[1]])),
                  (np.array([corner[0], 2, corner[1]]), np.array([corner[0] + 9, 0.5, corner[1] + 9])),
                  (np.array([500, 2, 500]), np.array([600, 2, 600])), (np.array([-90, 2, 0]), np.array([90, 2, 0]))]
        return lines

    def assert_same_as_brute_force(self, scale, random_count, targeted_count, seed):
        sight = JunkyardSight(self.triangles * scale)
        rng = np.random.default_rng(seed)
        hits = 0
        for origin, end in self.sight_lines(sight, rng, random_count, targeted_count):
            expected = brute_force_hit(sight, origin, end)
            actual = sight.hit(origin, end)
            # Exactly equal: same hit or miss, and the same hit point to the last bit.
            self.assertEqual(actual, expected, f"sight line {origin.tolist()} -> {end.tolist()}")
            hits += expected is not None
        return hits

    def test_grid_matches_brute_force_at_default_size(self):
        hits = self.assert_same_as_brute_force(7.98 / 5.5, 1400, 1000, seed=5)
        self.assertGreater(hits, 1000, "the sample must include plenty of real hits")

    def test_grid_matches_brute_force_at_another_size(self):
        hits = self.assert_same_as_brute_force(7.98 / 4, 400, 300, seed=4)
        self.assertGreater(hits, 300)

    def test_tiny_and_empty_meshes(self):
        self.assertIsNone(JunkyardSight(np.zeros((0, 3, 3))).hit([0, 1, 0], [0, 1, 10]))
        wall = np.array([[[-5, 0, 5], [5, 0, 5], [5, 4, 5]], [[-5, 0, 5], [5, 4, 5], [-5, 4, 5]]], dtype=float)
        for cell in (0.25, 2.0, 50.0):
            sight = JunkyardSight(wall, cell=cell)
            self.assertEqual(sight.hit([0, 1, 0], [0, 1, 10]), [0.0, 1.0, 5.0])
            self.assertIsNone(sight.hit([0, 1, 0], [0, 1, 4]))
            self.assertIsNone(sight.hit([9, 1, 0], [9, 1, 10]))


class ScriptedModel:
    """Stands in for the brain: a fixed, varied sequence of moves."""
    num_timesteps = 7757824
    observation_space = SimpleNamespace(shape=(34,))

    def __init__(self, seed):
        self.rng = np.random.default_rng(seed)

    def predict(self, obs, state=None, episode_start=None, deterministic=True):
        return np.array([self.rng.uniform(-0.3, 1), self.rng.uniform(-1, 1)], dtype=np.float32), state


class SnapshotReuseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.geometry = JunkyardGeometry(COLLISION, 7.98 / 4, cache_dir=RASTER_CACHE)
        cls.sight = JunkyardSight(load_triangles(MAP) * cls.geometry.scale)

    def check_frames(self, sight):
        session = BrainSession(ScriptedModel(11), self.geometry, [0, 0], 0.3, [0, 6], player_collision=True,
                               sight=sight, sight_pose=self.pose([0, 6]) if sight else None)
        self.assertEqual(session.snapshot(), session.snapshot(fresh_sight=True))
        seen = set()
        for i in range(150):
            target = [9 * np.sin(i * 0.07), 9 * np.cos(i * 0.05)]
            frame = session.step(target, self.pose(target) if sight else None)
            # The old service repeated the sight check here; the frame must not change.
            self.assertEqual(frame, session.snapshot(fresh_sight=True), f"step {i}")
            seen.add(frame["sight_visible"])
        self.assertEqual(seen, {True, False}, "the walk must include both visible and hidden frames")

    def pose(self, target):
        return dict(eye=[0, 2.38, 1.156], points=[[target[0], y, target[1]] for y in (1.6, 1.0, 0.4)])

    def test_eye_sight_frames_are_unchanged(self):
        self.check_frames(self.sight)

    def test_legacy_sight_frames_are_unchanged(self):
        self.check_frames(None)


if __name__ == "__main__":
    unittest.main()
