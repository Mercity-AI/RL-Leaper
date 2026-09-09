"""PPO_32 checks: the explicit cleared/search-coverage map (state augmentation).

The hypothesis is that PPO_29's remaining static-target failures come from
forgetting which parts of the arena have already been searched. PPO_32 tests it by
appending 16 egocentric "distance to unchecked ground" summary values (obs indices
26-41) built from an episode-local cleared grid. A cell is cleared only if a
hypothetical target at the cell centre would be DETECTABLE from the current pose
under the exact target-visibility rules -- the map never reads the real target.

The hard compatibility contract: legacy observation indices 0-25 must be byte-for-
byte unchanged whether coverage is on or off. These tests mutate the class-level
COVERAGE_MAP flag, so each restores it in tearDown to avoid leaking state into the
other test modules that run in the same process.
"""

import math
import unittest

import numpy as np

from rl_environment import LeaperReachEnv


def cell_flat_index(env, x, z):
    """Flat grid index of the cell containing world point (x, z)."""
    cell = env.COVERAGE_CELL_SIZE
    limit = env.WORLD_LIMIT
    steps = env.coverage_steps
    ix = int(math.floor((x + limit) / cell))
    iz = int(math.floor((z + limit) / cell))
    return ix * steps + iz


def clear_from_pose(env, position, yaw, obstacles=()):
    """Reset the grid and clear it once from the given pose (no target dependence)."""
    env.obstacles = tuple(obstacles)
    env.position = np.array(position, dtype=np.float32)
    env.yaw = float(yaw)
    env._reset_coverage()
    env._update_coverage()


class CoverageObservationShapeTests(unittest.TestCase):
    def setUp(self):
        self._saved = LeaperReachEnv.COVERAGE_MAP

    def tearDown(self):
        LeaperReachEnv.COVERAGE_MAP = self._saved

    def test_observation_is_42_when_coverage_enabled(self):
        LeaperReachEnv.COVERAGE_MAP = True
        env = LeaperReachEnv()
        try:
            observation, _ = env.reset(seed=1)
            self.assertEqual(observation.shape, (42,))
            self.assertEqual(env.observation_space.shape, (42,))
            self.assertEqual(LeaperReachEnv.observation_size(), 42)
        finally:
            env.close()

    def test_observation_is_26_when_coverage_disabled(self):
        LeaperReachEnv.COVERAGE_MAP = False
        env = LeaperReachEnv()
        try:
            observation, _ = env.reset(seed=1)
            self.assertEqual(observation.shape, (26,))
            self.assertEqual(env.observation_space.shape, (26,))
            self.assertEqual(LeaperReachEnv.observation_size(), 26)
        finally:
            env.close()

    def test_legacy_indices_0_25_identical_on_vs_off(self):
        # Build one env each way, force IDENTICAL state, and compare indices 0-25.
        LeaperReachEnv.COVERAGE_MAP = False
        off = LeaperReachEnv()
        LeaperReachEnv.COVERAGE_MAP = True
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
            LeaperReachEnv.COVERAGE_MAP = False
            legacy = off._observation()
            LeaperReachEnv.COVERAGE_MAP = True
            widened = on._observation()
            np.testing.assert_array_equal(legacy, widened[:26])
        finally:
            off.close()
            on.close()

    def test_new_values_are_finite_and_within_unit_interval(self):
        LeaperReachEnv.COVERAGE_MAP = True
        env = LeaperReachEnv()
        try:
            observation, _ = env.reset(seed=3)
            for _ in range(50):
                observation, _, terminated, truncated, _ = env.step(
                    env.action_space.sample()
                )
                summary = observation[26:]
                self.assertTrue(np.all(np.isfinite(summary)))
                self.assertTrue(np.all(summary >= 0.0))
                self.assertTrue(np.all(summary <= 1.0))
                if terminated or truncated:
                    observation, _ = env.reset()
        finally:
            env.close()


class CoverageClearingGeometryTests(unittest.TestCase):
    def setUp(self):
        self._saved = LeaperReachEnv.COVERAGE_MAP
        LeaperReachEnv.COVERAGE_MAP = True
        self.env = LeaperReachEnv()

    def tearDown(self):
        self.env.close()
        LeaperReachEnv.COVERAGE_MAP = self._saved

    def test_cell_outside_fov_is_not_cleared(self):
        # Facing +z (forward). A cell straight behind (-z) is in the rear blind wedge.
        clear_from_pose(self.env, (0.0, 0.0), yaw=0.0)
        behind = cell_flat_index(self.env, 0.0, -10.0)
        front = cell_flat_index(self.env, 0.0, 10.0)
        self.assertFalse(self.env.coverage_cleared[behind])
        self.assertTrue(self.env.coverage_cleared[front])

    def test_cell_beyond_range_is_not_cleared(self):
        clear_from_pose(self.env, (0.0, 0.0), yaw=0.0)
        far = cell_flat_index(self.env, 0.0, 30.0)  # ~30 units > 28 range
        near = cell_flat_index(self.env, 0.0, 10.0)
        self.assertFalse(self.env.coverage_cleared[far])
        self.assertTrue(self.env.coverage_cleared[near])

    def test_cell_behind_obstacle_is_not_cleared(self):
        # Obstacle at (0, 6) blocks the line of sight to a cell at (0, 12).
        clear_from_pose(self.env, (0.0, 0.0), yaw=0.0, obstacles=[(0.0, 6.0, 2.0)])
        occluded = cell_flat_index(self.env, 0.0, 12.0)
        self.assertFalse(self.env.coverage_cleared[occluded])
        # A cell of the same distance off to the side has a clear line and IS cleared.
        clear_side = cell_flat_index(self.env, 9.0, 8.0)
        self.assertTrue(self.env.coverage_cleared[clear_side])

    def test_visible_unoccluded_cell_is_cleared(self):
        clear_from_pose(self.env, (0.0, 0.0), yaw=0.0)
        visible = cell_flat_index(self.env, 0.0, 9.0)
        self.assertTrue(self.env.coverage_cleared[visible])

    def test_cleared_cells_persist_within_episode(self):
        # Clear from pose A, then move to pose B that can no longer see the cell.
        clear_from_pose(self.env, (0.0, 0.0), yaw=0.0)
        seen = cell_flat_index(self.env, 0.0, 9.0)
        self.assertTrue(self.env.coverage_cleared[seen])
        # Move far away and face elsewhere; do NOT reset the grid.
        self.env.position = np.array([28.0, 28.0], dtype=np.float32)
        self.env.yaw = math.pi
        self.env._update_coverage()
        self.assertTrue(self.env.coverage_cleared[seen])  # still remembered

    def test_map_resets_between_episodes(self):
        self.env.reset(seed=11)
        self.env.coverage_cleared[:] = True  # pretend everything was cleared
        self.env.reset(seed=12)
        # A fresh episode must not start fully cleared: reset zeroed it, then only
        # re-cleared what the new spawn can actually see.
        self.assertLess(int(self.env.coverage_cleared.sum()), self.env.coverage_cleared.size)
        self.assertGreater(int(self.env.coverage_cleared.sum()), 0)

    def test_map_is_independent_of_actual_target_position(self):
        LeaperReachEnv.COVERAGE_MAP = True
        a = LeaperReachEnv()
        b = LeaperReachEnv()
        try:
            for env in (a, b):
                env.obstacles = ((3.0, 5.0, 2.0),)
                env.position = np.array([0.0, 0.0], dtype=np.float32)
                env.yaw = 0.4
            a.target = np.array([10.0, 10.0], dtype=np.float32)
            b.target = np.array([-25.0, -20.0], dtype=np.float32)
            a._reset_coverage()
            a._update_coverage()
            b._reset_coverage()
            b._update_coverage()
            np.testing.assert_array_equal(a.coverage_cleared, b.coverage_cleared)
        finally:
            a.close()
            b.close()

    def test_points_visible_matches_target_sensor(self):
        # The map's geometry must not diverge from the real target sensor.
        LeaperReachEnv.COVERAGE_MAP = False
        env = LeaperReachEnv()
        try:
            mismatches = 0
            for seed in range(60):
                env.reset(seed=seed)
                for _ in range(4):
                    env.step(env.action_space.sample())
                    scalar_visible = env._target_sensor()[0]
                    vector_visible = bool(
                        env._points_visible(env.target.astype(np.float64)[None, :])[0]
                    )
                    mismatches += int(scalar_visible != vector_visible)
            self.assertEqual(mismatches, 0)
        finally:
            env.close()

    def test_summary_directions_align_with_vision_rays(self):
        # Place a single unchecked cell far along one ray; that ray's summary value
        # must be the minimum (nearest unchecked ground) and match its distance.
        self.env.position = np.array([0.0, 0.0], dtype=np.float32)
        self.env.yaw = 0.3
        self.env._reset_coverage()
        self.env.coverage_cleared[:] = True  # everything checked...
        ray = 8
        angle = self.env.yaw + self.env._ray_relative_angles()[ray]
        distance = 15.0
        point = self.env.position + distance * np.array(
            [math.sin(angle), math.cos(angle)], dtype=np.float32
        )
        idx = cell_flat_index(self.env, float(point[0]), float(point[1]))
        self.env.coverage_cleared[idx] = False  # ...except one cell on ray 8
        summary = self.env._coverage_summary()
        # The single unchecked cell lies on ray 8, so that direction reports the
        # nearest unchecked ground (the global minimum of the summary).
        self.assertEqual(int(np.argmin(summary)), ray)
        # The value is the ray's ENTRY distance into that cell (per the documented
        # ray-march), which is at most the cell-centre distance and no more than one
        # cell-plus-sample-step nearer.
        reported = float(summary[ray]) * self.env.RAY_MAX_RANGE
        self.assertLessEqual(reported, distance + 1e-6)
        self.assertGreaterEqual(
            reported, distance - self.env.COVERAGE_CELL_SIZE - self.env.COVERAGE_SAMPLE_STEP
        )
        # Every other direction sees only cleared ground -> saturates at 1.0.
        others = np.delete(summary, ray)
        self.assertTrue(np.all(others >= summary[ray]))


class GymnasiumCheckerTests(unittest.TestCase):
    def setUp(self):
        self._saved = LeaperReachEnv.COVERAGE_MAP

    def tearDown(self):
        LeaperReachEnv.COVERAGE_MAP = self._saved

    def test_env_checker_passes_with_coverage(self):
        from stable_baselines3.common.env_checker import check_env

        LeaperReachEnv.COVERAGE_MAP = True
        env = LeaperReachEnv()
        try:
            check_env(env, warn=True)  # raises on any contract violation
        finally:
            env.close()


if __name__ == "__main__":
    unittest.main()
