"""PPO_33 / Phase 1B: the compact GLOBAL frontier note (obs indices 26-30).

PPO_32's 16 LOCAL 28-unit "distance to unchecked ground" rays failed to pull Leaper
toward large DISTANT unchecked regions. Phase 1B replaces them with 5 global values:
the relative x/z direction to the nearest frontier cell of the largest substantial
contiguous unchecked region, that cell's distance (÷ arena diagonal), the region
size, and a valid flag. The note is honest: computed only from the internal cleared
grid, never the target or obstacle positions. Legacy indices 0-25 stay unchanged.

These tests mutate class-level flags and restore them in tearDown.
"""

import math
import unittest

import numpy as np

from rl_environment import LeaperReachEnv


def cell_flat_index(env, x, z):
    cell = env.COVERAGE_CELL_SIZE
    limit = env.WORLD_LIMIT
    steps = env.coverage_steps
    ix = int(math.floor((x + limit) / cell))
    iz = int(math.floor((z + limit) / cell))
    return ix * steps + iz


def uncheck_block(env, x0, x1, z0, z1):
    """Mark a rectangular world region's cells UNCHECKED (all else cleared)."""
    cell = env.COVERAGE_CELL_SIZE
    limit = env.WORLD_LIMIT
    steps = env.coverage_steps
    for ix in range(steps):
        cx = -limit + (ix + 0.5) * cell
        for iz in range(steps):
            cz = -limit + (iz + 0.5) * cell
            if x0 <= cx <= x1 and z0 <= cz <= z1:
                env.coverage_cleared[ix * steps + iz] = False


class FrontierNoteBasicsTests(unittest.TestCase):
    def setUp(self):
        self._saved = LeaperReachEnv.FRONTIER_NOTE

    def tearDown(self):
        LeaperReachEnv.FRONTIER_NOTE = self._saved

    def test_observation_is_31_when_enabled(self):
        LeaperReachEnv.FRONTIER_NOTE = True
        env = LeaperReachEnv()
        try:
            obs, _ = env.reset(seed=1)
            self.assertEqual(obs.shape, (31,))
            self.assertEqual(env.observation_space.shape, (31,))
            self.assertEqual(LeaperReachEnv.observation_size(), 31)
        finally:
            env.close()

    def test_observation_is_26_when_disabled(self):
        LeaperReachEnv.FRONTIER_NOTE = False
        env = LeaperReachEnv()
        try:
            obs, _ = env.reset(seed=1)
            self.assertEqual(obs.shape, (26,))
        finally:
            env.close()

    def test_note_values_finite_and_in_unit_ranges(self):
        LeaperReachEnv.FRONTIER_NOTE = True
        env = LeaperReachEnv()
        try:
            obs, _ = env.reset(seed=3)
            for _ in range(50):
                obs, _, term, trunc, _ = env.step(env.action_space.sample())
                note = obs[26:31]
                self.assertTrue(np.all(np.isfinite(note)))
                self.assertGreaterEqual(note[0], -1.0)
                self.assertLessEqual(note[0], 1.0)
                self.assertGreaterEqual(note[1], -1.0)
                self.assertLessEqual(note[1], 1.0)
                self.assertTrue(0.0 <= note[2] <= 1.0)
                self.assertTrue(0.0 <= note[3] <= 1.0)
                self.assertIn(note[4], (0.0, 1.0))
                if term or trunc:
                    obs, _ = env.reset()
        finally:
            env.close()

    def test_legacy_indices_0_25_unchanged_on_vs_off(self):
        LeaperReachEnv.FRONTIER_NOTE = False
        off = LeaperReachEnv()
        LeaperReachEnv.FRONTIER_NOTE = True
        on = LeaperReachEnv()
        try:
            off.reset(seed=7)
            on.reset(seed=7)
            on.obstacles = off.obstacles
            on.target = off.target.copy()
            on.position = off.position.copy()
            on.yaw = off.yaw
            on.target_visible = off.target_visible
            on.target_ever_seen = off.target_ever_seen
            on.last_seen_target = off.last_seen_target.copy()
            on.steps_since_target_seen = off.steps_since_target_seen
            on.last_collision = off.last_collision
            on.previous_action = off.previous_action.copy()
            LeaperReachEnv.FRONTIER_NOTE = False
            legacy = off._observation()
            LeaperReachEnv.FRONTIER_NOTE = True
            widened = on._observation()
            np.testing.assert_array_equal(legacy, widened[:26])
        finally:
            off.close()
            on.close()


class FrontierNoteGeometryTests(unittest.TestCase):
    def setUp(self):
        self._saved = LeaperReachEnv.FRONTIER_NOTE
        LeaperReachEnv.FRONTIER_NOTE = True
        self.env = LeaperReachEnv()
        self.env.position = np.array([0.0, 0.0], dtype=np.float32)
        self.env.yaw = 0.0

    def tearDown(self):
        self.env.close()
        LeaperReachEnv.FRONTIER_NOTE = self._saved

    def test_honesty_independent_of_target_and_obstacles(self):
        a = LeaperReachEnv()
        b = LeaperReachEnv()
        try:
            for env in (a, b):
                env.position = np.array([2.0, -3.0], dtype=np.float32)
                env.yaw = 0.5
                env.coverage_cleared[:] = True
                uncheck_block(env, 10, 25, -6, 6)
            a.target = np.array([12.0, 0.0], dtype=np.float32)
            a.obstacles = ()
            b.target = np.array([-28.0, -28.0], dtype=np.float32)
            b.obstacles = ((5.0, 5.0, 3.0), (-10.0, 8.0, 2.5))
            np.testing.assert_array_equal(a._frontier_note(), b._frontier_note())
        finally:
            a.close()
            b.close()

    def test_points_toward_region_in_any_direction(self):
        # 360-degree coverage: an unchecked block on each side must steer the note
        # toward it (dominant sign on the correct axis).
        cases = {
            "+x": ((15, 27, -6, 6), lambda n: n[0] > 0.6 and abs(n[1]) < 0.5),
            "-x": ((-27, -15, -6, 6), lambda n: n[0] < -0.6 and abs(n[1]) < 0.5),
            "+z": ((-6, 6, 15, 27), lambda n: n[1] > 0.6 and abs(n[0]) < 0.5),
            "-z": ((-6, 6, -27, -15), lambda n: n[1] < -0.6 and abs(n[0]) < 0.5),
        }
        for name, (rect, check) in cases.items():
            self.env.coverage_cleared[:] = True
            uncheck_block(self.env, *rect)
            note = self.env._frontier_note()
            self.assertEqual(note[4], 1.0, f"{name}: expected a valid region")
            self.assertTrue(check(note), f"{name}: note {np.round(note,3)} not toward region")

    def test_selects_large_distant_region_over_local_fragment(self):
        # The PPO_32 failure case: a big region far away must win over a tiny near
        # fragment, and be reported at a genuinely distant range (> local ray reach).
        self.env.coverage_cleared[:] = True
        uncheck_block(self.env, -2, 1, 4, 7)          # tiny near fragment (few cells)
        uncheck_block(self.env, 12, 30, -30, -12)     # large distant region (bottom-right)
        note = self.env._frontier_note()
        self.assertEqual(note[4], 1.0)
        self.assertGreater(note[0], 0.0)              # points +x (toward distant block)
        self.assertLess(note[1], 0.0)                 # and -z
        diagonal = 2.0 * math.sqrt(2.0) * self.env.WORLD_LIMIT
        self.assertGreater(note[2] * diagonal, 15.0)  # distant, not a 28-unit-local blip

    def test_tiny_isolated_fragment_is_ignored(self):
        # A lone rock-shadow-sized fragment (< FRONTIER_MIN_REGION_CELLS) is not a
        # frontier: the note is the invalid sentinel.
        self.env.coverage_cleared[:] = True
        self.env.coverage_cleared[cell_flat_index(self.env, 8.0, 8.0)] = False
        note = self.env._frontier_note()
        np.testing.assert_array_equal(note, [0.0, 0.0, 1.0, 0.0, 0.0])

    def test_fully_cleared_arena_is_invalid(self):
        self.env.coverage_cleared[:] = True
        np.testing.assert_array_equal(
            self.env._frontier_note(), [0.0, 0.0, 1.0, 0.0, 0.0]
        )

    def test_reset_recomputes_note_each_episode(self):
        self.env.reset(seed=11)
        self.env.coverage_cleared[:] = True  # pretend everything cleared
        note_before = self.env._frontier_note()
        np.testing.assert_array_equal(note_before, [0.0, 0.0, 1.0, 0.0, 0.0])
        # A fresh episode must rebuild a real unexplored frontier.
        obs, _ = self.env.reset(seed=12)
        self.assertEqual(float(obs[30]), 1.0)  # valid flag on again
        self.assertGreater(float(obs[29]), 0.0)  # region size > 0


class GymnasiumCheckerTests(unittest.TestCase):
    def setUp(self):
        self._saved = LeaperReachEnv.FRONTIER_NOTE

    def tearDown(self):
        LeaperReachEnv.FRONTIER_NOTE = self._saved

    def test_env_checker_passes(self):
        from stable_baselines3.common.env_checker import check_env

        LeaperReachEnv.FRONTIER_NOTE = True
        env = LeaperReachEnv()
        try:
            check_env(env, warn=True)
        finally:
            env.close()


if __name__ == "__main__":
    unittest.main()
