"""Legacy observation checks carried forward from PPO_11.

PPO_17 changes the geometry of observation indices 10-17, so exact current
sensor behaviour lives in test_ppo17_forward_clearance.py. These checks retain
the observation-growth, normalization, and base-channel contracts.
"""

import math
import unittest

import numpy as np

from rl_environment import LeaperReachEnv


class RayVisionTests(unittest.TestCase):
    def setUp(self):
        self.env = LeaperReachEnv()

    def tearDown(self):
        self.env.close()

    def test_observation_grew_by_eight_rays(self):
        observation, _ = self.env.reset(seed=7)
        self.assertEqual(self.env.RAY_COUNT, 8)
        self.assertEqual(observation.shape, (18,))
        self.assertEqual(self.env.observation_space.shape, (18,))
        self.assertTrue(self.env.observation_space.contains(observation))

    def test_first_ten_values_match_legacy_observation(self):
        """Indices 0-9 must still be the exact PPO_10 observation."""
        self.env.position = np.array([-3.0, -4.0], dtype=np.float32)
        self.env.yaw = 0.4
        self.env.last_collision = 1.0
        self.env.previous_action = np.array([-0.5, 0.25], dtype=np.float32)
        delta = self.env.TARGET - self.env.position
        distance = float(np.linalg.norm(delta))
        direction = delta / distance
        max_distance = 2.0 * math.sqrt(2.0) * self.env.WORLD_LIMIT
        expected = np.array(
            [
                self.env.position[0] / self.env.WORLD_LIMIT,
                self.env.position[1] / self.env.WORLD_LIMIT,
                direction[0],
                direction[1],
                distance / max_distance,
                math.sin(self.env.yaw),
                math.cos(self.env.yaw),
                1.0,
                -0.5,
                0.25,
            ],
            dtype=np.float32,
        )
        np.testing.assert_allclose(self.env._observation()[:10], expected, atol=1e-6)

    def test_rays_are_normalized_between_zero_and_one(self):
        for seed in range(25):
            observation, _ = self.env.reset(seed=seed)
            rays = observation[10:]
            self.assertEqual(rays.shape, (8,))
            self.assertTrue(np.all(rays >= 0.0))
            self.assertTrue(np.all(rays <= 1.0))

    def test_open_space_reads_fully_clear(self):
        """A long clear sightline beyond RAY_MAX_RANGE reads 1.0 ahead."""
        # A freshly constructed env has no obstacles until reset(), so looking
        # straight up +z the only thing in the world is the far wall, well beyond
        # RAY_MAX_RANGE, so the ray saturates to 1.0.
        self.env.obstacles = ()
        self.env.position = np.array([-20.0, 0.0], dtype=np.float32)
        self.env.yaw = 0.0  # ray 0 points +z
        rays = self.env._ray_distances(self.env.position, self.env.yaw)
        self.assertAlmostEqual(float(rays[0]), 1.0, places=5)

    def test_forward_sectors_detect_obstacle_dead_ahead(self):
        """A rock straight in front shortens both central sectors."""
        # Obstacles are randomized per episode now, so pin an explicit layout to
        # test the unchanged ray geometry rather than a fixed arena entry.
        self.env.obstacles = ((1.0, 4.0, 3.0),)
        obstacle_x, obstacle_z, radius = self.env.obstacles[0]
        # Stand 8 units below the obstacle, facing +z straight at it.
        self.env.position = np.array([obstacle_x, obstacle_z - 10.0], dtype=np.float32)
        self.env.yaw = 0.0
        rays = self.env._ray_distances(self.env.position, self.env.yaw)
        self.assertLess(float(rays[3]), 1.0)
        self.assertLess(float(rays[4]), 1.0)
        self.assertAlmostEqual(float(rays[3]), float(rays[4]), places=5)

    def test_rays_rotate_with_facing(self):
        """The same obstacle should register on different rays as yaw changes."""
        self.env.obstacles = ((10.0, 11.0, 2.8),)
        obstacle_x, obstacle_z, _ = self.env.obstacles[0]
        self.env.position = np.array([obstacle_x, obstacle_z - 7.0], dtype=np.float32)
        facing_it = self.env._ray_distances(self.env.position, 0.0)
        facing_away = self.env._ray_distances(self.env.position, math.pi)
        self.assertLess(float(np.min(facing_it)), float(np.min(facing_away)))


if __name__ == "__main__":
    unittest.main()
