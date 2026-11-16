"""rl/fast_sim.py must give exactly the original values (bit for bit).

    python -m unittest tests.test_fast_sim
"""
import json
import math
import unittest

import numpy as np

from rl.fast_sim import fast_points_visible, fast_ray_distances
from rl.moving_target_env import MovingTargetEnv


def _same_info(a, b):
    return json.dumps(a, sort_keys=True, default=str) == json.dumps(b, sort_keys=True, default=str)


def lockstep(make, seeds, steps, case, make_slow=None):
    """Run a fast and an original env side by side on the same actions."""
    for seed in seeds:
        fast = make(seed)
        slow = make_slow(seed) if make_slow else make(seed)
        slow.FAST_SIM = False
        obs_f, info_f = fast.reset(seed=seed)
        obs_s, info_s = slow.reset(seed=seed)
        case.assertTrue(np.array_equal(obs_f, obs_s), f"reset obs, seed {seed}")
        case.assertTrue(_same_info(info_f, info_s), f"reset info, seed {seed}")
        rng = np.random.default_rng(seed)
        for step in range(steps):
            action = rng.uniform(-1, 1, 2).astype(np.float32)
            rf, rs = fast.step(action), slow.step(action)
            where = f"seed {seed} step {step}"
            case.assertTrue(np.array_equal(rf[0], rs[0]), f"obs, {where}")
            case.assertEqual(rf[1], rs[1], f"reward, {where}")
            case.assertEqual(rf[2:4], rs[2:4], f"done, {where}")
            case.assertTrue(_same_info(rf[4], rs[4]), f"info, {where}")
            if rf[2] or rf[3]:
                obs_f, _ = fast.reset(seed=seed + 1000 + step)
                obs_s, _ = slow.reset(seed=seed + 1000 + step)
                case.assertTrue(np.array_equal(obs_f, obs_s), f"re-reset obs, {where}")


class FrontierNote(unittest.TestCase):
    def test_random_grids_and_positions(self):
        env = MovingTargetEnv()
        env.reset(seed=1)
        rng = np.random.default_rng(7)
        cells = env.coverage_cleared.size
        for trial in range(3000):
            share = rng.uniform(0.0, 1.0)
            env.coverage_cleared[:] = rng.random(cells) < share
            if trial % 3 == 0:   # blobby grids: several regions, ties in size
                grid = env.coverage_cleared.reshape(env.coverage_steps, -1)
                grid[:] = False
                for _ in range(rng.integers(1, 6)):
                    i, j = rng.integers(0, env.coverage_steps, 2)
                    grid[max(0, i - 2):i + 3, :] = True
                    grid[:, max(0, j - 2):j + 3] = True
            if trial % 5 == 0:   # cell centres exactly: distance ties
                i, j = rng.integers(0, env.coverage_steps, 2)
                env.position = np.array([-env.WORLD_LIMIT + (i + 0.5) * 3.0, -env.WORLD_LIMIT + (j + 1.0) * 3.0])
            else:
                env.position = rng.uniform(-env.WORLD_LIMIT, env.WORLD_LIMIT, 2)
            env.FAST_SIM = True
            fast = env._frontier_note(), env._frontier_target, env._frontier_valid
            env.FAST_SIM = False
            slow = env._frontier_note(), env._frontier_target, env._frontier_valid
            self.assertTrue(np.array_equal(fast[0], slow[0]), f"trial {trial}")
            self.assertEqual(fast[1:], slow[1:], f"trial {trial}")


class PlainArena(unittest.TestCase):
    def test_lockstep(self):
        lockstep(lambda s: MovingTargetEnv(), range(30000, 30020), 300, self)

    def test_lockstep_new_inputs(self):
        lockstep(lambda s: MovingTargetEnv(new_inputs=True, metrics=True), range(30100, 30105), 300, self)


class Yard(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from rl.moving_target_game_exam import GameExamEnv, yard
        cls.GameExamEnv = GameExamEnv
        cls.geometry = yard(fast=False)[0]
        cls.fast_geometry = yard()[0]

    def test_rays_and_points(self):
        g = self.geometry
        rng = np.random.default_rng(3)
        for trial in range(300):
            origin = rng.uniform(g.minimum, g.maximum)
            yaw = rng.uniform(-math.pi, math.pi)
            angles = rng.uniform(-math.pi, math.pi, 16)
            directions = np.stack((np.sin(angles), np.cos(angles)), axis=1)
            f = self.fast_geometry
            for reach in (28.0, 72.6, 3.0):
                expected = g.ray_distances(origin, directions, reach)
                self.assertTrue(np.array_equal(fast_ray_distances(g, origin, directions, reach), expected))
                self.assertTrue(np.array_equal(f.ray_distances(origin, directions, reach), expected))
            points = rng.uniform(g.minimum - 2, g.maximum + 2, (int(rng.integers(1, 400)), 2))
            for reach, radius, fov in ((28.0, 1.4, 270), (72.6, 0.0, 270), (5.0, 2.0, 270), (1e6, 1.4, 360)):
                expected = g.points_visible(origin, yaw, points, math.radians(fov), reach, radius)
                self.assertTrue(np.array_equal(
                    fast_points_visible(g, origin, yaw, points, math.radians(fov), reach, radius), expected))
                self.assertTrue(np.array_equal(
                    f.points_visible(origin, yaw, points, math.radians(fov), reach, radius), expected),
                    f"trial {trial}")
            for radius in (0.24, 0.5, 0.75, 2.5, 3.5):
                for p in rng.uniform(g.minimum - 1, g.maximum + 1, (20, 2)):
                    self.assertEqual(self.fast_geometry.disk_blocked(p, radius), g.disk_blocked(p, radius))

    def test_lockstep(self):
        lockstep(lambda s: self.GameExamEnv(s), range(70000, 70004), 250, self,
                 make_slow=lambda s: self.GameExamEnv(s, fast=False))

    def test_eye_sight(self):
        """make_fast_sight (2026-11-16): same candidate triangles and same hits as JunkyardSight."""
        from rl.moving_target_game_exam import yard
        sight, fast = yard(fast=False)[1], yard()[1]
        self.assertIsNot(sight, fast)
        rng = np.random.default_rng(11)
        low = sight.grid_origin - 5
        high = sight.grid_origin + sight.grid_shape * sight.cell + 5
        for trial in range(4000):
            a = np.array([rng.uniform(low[0], high[0]), rng.uniform(0, 4), rng.uniform(low[1], high[1])])
            if trial % 3 == 0:
                b = a + np.array([rng.normal(0, 15), rng.uniform(-3, 1), rng.normal(0, 15)])
            else:
                b = np.array([rng.uniform(low[0], high[0]), rng.uniform(0, 4), rng.uniform(low[1], high[1])])
            if trial % 10 == 1:
                b[0] = a[0]
            if trial % 10 == 2:
                b[2] = a[2]
            if trial % 10 == 3:
                b[0] = a[0] + 1e-13
            if trial % 50 == 4:
                b = a.copy()
            expected = sight._nearby(a, b)
            got = fast._nearby(a, b)
            self.assertEqual(got.dtype, expected.dtype)
            self.assertTrue(np.array_equal(got, expected), f"trial {trial}")
            self.assertEqual(fast.hit(a, b), sight.hit(a, b), f"trial {trial}")
            self.assertEqual(fast.hit(a.tolist(), b.tolist()), sight.hit(a.tolist(), b.tolist()))


if __name__ == "__main__":
    unittest.main()
