"""Focused checks for the PPO_10 signed-throttle experiment."""

import math
import unittest

import numpy as np

from rl_environment import LeaperReachEnv
from train_rl import classify_throttle


class SignedThrottleTests(unittest.TestCase):
    def setUp(self):
        self.env = LeaperReachEnv()

    def tearDown(self):
        self.env.close()

    def set_pose(self, position=(-15.0, -15.0), yaw=0.0):
        self.env.position = np.array(position, dtype=np.float32)
        self.env.yaw = yaw
        self.env.steps = 0
        self.env.prev_distance = self.env._distance()
        self.env.last_collision = 0.0
        self.env.previous_action.fill(0.0)
        self.env.trajectory = [self.env.position.copy()]
        self.assertIsNone(self.env._collision_for_pose(self.env.position, yaw))

    def test_action_space_accepts_full_reverse(self):
        self.assertTrue(
            self.env.action_space.contains(np.array([-1.0, 0.0], dtype=np.float32))
        )

    def test_positive_throttle_moves_forward(self):
        self.set_pose()
        start = self.env.position.copy()
        observation, _, _, _, _ = self.env.step(np.array([1.0, 0.0], dtype=np.float32))
        np.testing.assert_allclose(
            self.env.position - start,
            np.array([0.0, self.env.MOVE_SPEED]),
            atol=1e-6,
        )
        self.assertTrue(self.env.observation_space.contains(observation))

    def test_negative_throttle_moves_backward(self):
        self.set_pose()
        start = self.env.position.copy()
        self.env.step(np.array([-1.0, 0.0], dtype=np.float32))
        np.testing.assert_allclose(
            self.env.position - start,
            np.array([0.0, -self.env.MOVE_SPEED]),
            atol=1e-6,
        )

    def test_zero_throttle_does_not_translate(self):
        self.set_pose()
        start = self.env.position.copy()
        self.env.step(np.array([0.0, 0.0], dtype=np.float32))
        np.testing.assert_allclose(self.env.position, start, atol=1e-6)

    def test_reverse_uses_candidate_facing_direction(self):
        self.set_pose()
        start = self.env.position.copy()
        self.env.step(np.array([-1.0, 1.0], dtype=np.float32))
        expected_yaw = self.env.TURN_SPEED
        expected_heading = np.array(
            [math.sin(expected_yaw), math.cos(expected_yaw)], dtype=np.float32
        )
        np.testing.assert_allclose(
            self.env.position - start,
            -expected_heading * self.env.MOVE_SPEED,
            atol=1e-6,
        )
        self.assertAlmostEqual(self.env.yaw, expected_yaw, places=6)

    def test_observation_remains_valid_after_reverse(self):
        observation, _ = self.env.reset(seed=7)
        self.assertEqual(observation.shape, (10 + self.env.RAY_COUNT,))
        self.assertTrue(self.env.observation_space.contains(observation))
        observation, _, _, _, _ = self.env.step(
            np.array([-0.5, 0.25], dtype=np.float32)
        )
        self.assertTrue(self.env.observation_space.contains(observation))
        self.assertAlmostEqual(float(observation[8]), -0.5)

    def test_diagnostic_classifier_does_not_count_reverse_as_stopped(self):
        self.assertEqual(classify_throttle(-0.25), "reverse")
        self.assertEqual(classify_throttle(0.25), "forward")
        self.assertEqual(classify_throttle(1e-9), "stopped")
        self.assertEqual(classify_throttle(-1e-9), "stopped")


if __name__ == "__main__":
    unittest.main()
