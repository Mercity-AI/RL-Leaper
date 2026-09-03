"""Observation and ray contracts carried forward into the PPO_27 seeker.

Exact current sensor geometry lives in test_ppo18_human_vision.py. These checks
retain the observation-growth, normalization, and base-channel contracts that
have held since the rays were introduced.
"""

import math
import unittest

import numpy as np

from rl_environment import LeaperReachEnv


class RayObservationContractTests(unittest.TestCase):
    def setUp(self):
        self.env = LeaperReachEnv()

    def tearDown(self):
        self.env.close()

    def test_observation_keeps_the_champion_twenty_six_value_shape(self):
        observation, _ = self.env.reset(seed=7)
        self.assertEqual(self.env.RAY_COUNT, 16)
        self.assertEqual(observation.shape, (26,))
        self.assertEqual(self.env.observation_space.shape, (26,))
        self.assertTrue(self.env.observation_space.contains(observation))

    def test_navigation_state_channels_stay_in_their_champion_positions(self):
        """Facing, collision, and previous action remain at indices 5-9."""
        self.env.position = np.array([-3.0, -4.0], dtype=np.float32)
        self.env.yaw = 0.4
        self.env.last_collision = 1.0
        self.env.previous_action = np.array([0.5, 0.25], dtype=np.float32)
        expected = np.array(
            [
                math.sin(self.env.yaw),
                math.cos(self.env.yaw),
                1.0,
                0.5,
                0.25,
            ],
            dtype=np.float32,
        )
        np.testing.assert_allclose(self.env._observation()[5:10], expected, atol=1e-6)

    def test_rays_are_normalized_between_zero_and_one(self):
        for seed in range(25):
            observation, _ = self.env.reset(seed=seed)
            rays = observation[10:]
            self.assertEqual(rays.shape, (16,))
            self.assertTrue(np.all(rays >= 0.0))
            self.assertTrue(np.all(rays <= 1.0))


if __name__ == "__main__":
    unittest.main()
