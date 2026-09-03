"""PPO_29 checks: normalized throttle, the general freeze rule, and the scan nudge.

PPO_28's deterministic policy froze because an unconstrained Gaussian throttle
whose natural neutral is 0 was clipped to a dead stop by the asymmetric [0, 1]
action space. PPO_29 remaps a [-1, 1] output to a forward-only physical throttle
(action + 1) / 2 (so 0 = half speed), adds a terminal freeze failure after 60
steps without translation, and gives a small capped reward for scanning new
headings before the target is first seen.

These tests mutate class-level flags, so each restores them in tearDown to avoid
leaking state into the other test modules that run in the same process.
"""

import math
import unittest

import numpy as np

from rl_environment import LeaperReachEnv


class NormalizedThrottleTests(unittest.TestCase):
    def setUp(self):
        self._saved = LeaperReachEnv.NORMALIZED_THROTTLE
        LeaperReachEnv.NORMALIZED_THROTTLE = True
        self.env = LeaperReachEnv()

    def tearDown(self):
        self.env.close()
        LeaperReachEnv.NORMALIZED_THROTTLE = self._saved

    def open_pose(self, position=(0.0, 0.0), yaw=0.0):
        """Place the robot in an empty arena, far from the target, counters cleared."""
        self.env.obstacles = ()
        self.env.target = np.array([100.0, 100.0], dtype=np.float32)
        self.env.position = np.array(position, dtype=np.float32)
        self.env.yaw = yaw
        self.env.steps = 0
        self.env.stuck_steps = 0
        self.env.idle_steps = 0
        self.env.freeze_steps = 0
        self.env.prev_distance = self.env._distance()
        self.env.best_distance = self.env.prev_distance
        self.env.last_collision = 0.0
        self.env.previous_action.fill(0.0)
        self.env.target_ever_seen = False
        self.env.target_visible = False
        self.env.steps_since_target_seen = self.env.TARGET_MEMORY_STEPS
        self.env.visited_cells.clear()
        self.env.visited_views.clear()
        self.env.scanned_headings.clear()
        cell, view = self.env._search_state()
        self.env.visited_cells.add(cell)
        self.env.visited_views.add(view)
        self.env.scanned_headings.add(view[2])
        self.env.trajectory = [self.env.position.copy()]

    def test_action_space_is_normalized(self):
        self.assertEqual(float(self.env.action_space.low[0]), -1.0)
        self.assertTrue(
            self.env.action_space.contains(np.array([-1.0, 0.0], dtype=np.float32))
        )

    def test_physical_throttle_mapping(self):
        self.assertAlmostEqual(LeaperReachEnv.physical_throttle(-1.0), 0.0)
        self.assertAlmostEqual(LeaperReachEnv.physical_throttle(0.0), 0.5)
        self.assertAlmostEqual(LeaperReachEnv.physical_throttle(1.0), 1.0)

    def test_neutral_output_drifts_forward_at_half_speed(self):
        self.open_pose()
        start = self.env.position.copy()
        self.env.step(np.array([0.0, 0.0], dtype=np.float32))
        np.testing.assert_allclose(
            self.env.position - start,
            np.array([0.0, 0.5 * self.env.MOVE_SPEED]),
            atol=1e-6,
        )

    def test_minus_one_output_fully_stops(self):
        self.open_pose()
        start = self.env.position.copy()
        self.env.step(np.array([-1.0, 0.0], dtype=np.float32))
        np.testing.assert_allclose(self.env.position, start, atol=1e-6)

    def test_freeze_rule_terminates_after_limit(self):
        self.open_pose()
        LeaperReachEnv.FREEZE_LIMIT = 60
        terminated = False
        info = {}
        for step in range(LeaperReachEnv.FREEZE_LIMIT):
            _, reward, terminated, _, info = self.env.step(
                np.array([-1.0, 0.0], dtype=np.float32)  # stop, no turn -> no move
            )
            if terminated:
                break
        self.assertTrue(terminated)
        self.assertTrue(info["frozen"])
        self.assertEqual(step + 1, LeaperReachEnv.FREEZE_LIMIT)
        self.assertLessEqual(reward, -LeaperReachEnv.FREEZE_PENALTY + 1.0)

    def test_real_movement_resets_freeze_counter(self):
        self.open_pose()
        for _ in range(30):
            self.env.step(np.array([-1.0, 0.0], dtype=np.float32))
        self.assertGreater(self.env.freeze_steps, 0)
        self.env.step(np.array([1.0, 0.0], dtype=np.float32))  # full speed -> moves
        self.assertEqual(self.env.freeze_steps, 0)

    def test_scan_reward_fires_for_new_heading_before_sight(self):
        self.open_pose(yaw=0.0)
        start_bin = self.env._search_state()[1][2]
        # Face a genuinely different heading bin (half a turn away).
        self.env.yaw = math.pi
        _, _, _, _, info = self.env.step(np.array([-1.0, 0.0], dtype=np.float32))
        new_bin = self.env._search_state()[1][2]
        self.assertNotEqual(new_bin, start_bin)
        # Exploration bucket carries the scan nudge (plus the tiny new-view bonus).
        self.assertGreaterEqual(info["reward_terms"]["exploration"], self.env.SCAN_REWARD)

    def test_scan_reward_stops_after_target_seen(self):
        self.open_pose(yaw=0.0)
        self.env.target_ever_seen = True
        self.env.yaw = math.pi
        _, _, _, _, info = self.env.step(np.array([-1.0, 0.0], dtype=np.float32))
        self.assertEqual(info["reward_terms"]["exploration"], 0.0)

    def test_scan_reward_capped_at_one_revolution(self):
        self.open_pose()
        # Pretend every heading bin has already been scanned this episode.
        self.env.scanned_headings = set(range(self.env.EXPLORATION_HEADING_BINS))
        self.env.yaw = math.pi
        _, _, _, _, info = self.env.step(np.array([-1.0, 0.0], dtype=np.float32))
        # No new heading bin is available, so the scan nudge contributes nothing.
        self.assertLess(info["reward_terms"]["exploration"], self.env.SCAN_REWARD)


class ThrottleModeIsolationTests(unittest.TestCase):
    def test_default_mode_is_plain_forward_only(self):
        # With the flag off (the default for PPO_18-28), nothing changes: the
        # action space is [0, 1] and physical throttle is the identity.
        self.assertFalse(LeaperReachEnv.NORMALIZED_THROTTLE)
        env = LeaperReachEnv()
        try:
            self.assertEqual(float(env.action_space.low[0]), 0.0)
            self.assertAlmostEqual(LeaperReachEnv.physical_throttle(0.4), 0.4)
        finally:
            env.close()


if __name__ == "__main__":
    unittest.main()
