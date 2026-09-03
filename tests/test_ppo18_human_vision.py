"""Focused checks for PPO_18 human forward vision and forward-only movement.

PPO_18 replaces PPO_17's 200-degree collision-aware sectors with eight simple
thin rangefinder rays fanned across a 270-degree forward cone at a longer range,
and removes reverse so the robot always travels inside its visible cone.
"""

import math
import unittest

import numpy as np

from rl_environment import LeaperReachEnv


class HumanVisionTests(unittest.TestCase):
    def setUp(self):
        self.env = LeaperReachEnv()
        self.env.obstacles = ()
        self.env.position = np.array([0.0, 0.0], dtype=np.float32)
        self.env.yaw = 0.0

    def tearDown(self):
        self.env.close()

    def test_field_of_view_is_270_degrees(self):
        self.assertAlmostEqual(math.degrees(self.env.VISION_FOV), 270.0)
        self.assertEqual(self.env.RAY_COUNT, 16)

    def test_range_is_longer_than_legacy_twelve(self):
        self.assertGreater(self.env.RAY_MAX_RANGE, 12.0)

    def test_movement_is_forward_only(self):
        self.assertEqual(float(self.env.action_space.low[0]), 0.0)
        self.assertEqual(float(self.env.action_space.high[0]), 1.0)
        self.assertEqual(float(self.env.action_space.low[1]), -1.0)
        self.assertEqual(float(self.env.action_space.high[1]), 1.0)

    def test_rays_span_a_symmetric_cone_within_270(self):
        angles = self.env._ray_relative_angles()
        self.assertEqual(len(angles), self.env.RAY_COUNT)
        # Symmetric about straight-ahead (0 rad).
        np.testing.assert_allclose(angles, -angles[::-1], atol=1e-9)
        # Every ray stays inside the +/-135 degree cone.
        self.assertLessEqual(float(np.max(np.abs(angles))), self.env.VISION_FOV / 2.0 + 1e-9)

    def test_open_space_reads_fully_clear(self):
        rays = self.env._ray_distances(self.env.position, self.env.yaw)
        np.testing.assert_allclose(rays, np.ones(self.env.RAY_COUNT), atol=1e-6)

    def test_obstacle_dead_ahead_shortens_central_rays_symmetrically(self):
        # Forward (0 deg) sits between the two central rays.
        self.env.obstacles = ((0.0, 8.0, 3.0),)
        rays = self.env._ray_distances(self.env.position, 0.0)
        left = self.env.RAY_COUNT // 2 - 1
        right = self.env.RAY_COUNT // 2
        self.assertLess(float(rays[left]), 1.0)
        self.assertLess(float(rays[right]), 1.0)
        self.assertAlmostEqual(float(rays[left]), float(rays[right]), places=5)

    def test_obstacle_behind_in_blind_wedge_is_invisible(self):
        # Directly behind (0, -8) lies in the 90-degree rear blind wedge.
        self.env.obstacles = ((0.0, -8.0, 3.0),)
        rays = self.env._ray_distances(self.env.position, 0.0)
        np.testing.assert_allclose(rays, np.ones(self.env.RAY_COUNT), atol=1e-6)

    def test_sees_farther_than_the_old_twelve_unit_range(self):
        # Place an obstacle 20 units out, centred on ray 4's heading, so that ray
        # passes through it. At the old 12-unit range it would read clear (1.0);
        # with the longer range the ray now registers the hit.
        ray_index = self.env.RAY_COUNT // 2
        angle = self.env.yaw + float(self.env._ray_relative_angles()[ray_index])
        direction = np.array([math.sin(angle), math.cos(angle)])
        center = 20.0 * direction
        self.env.obstacles = ((float(center[0]), float(center[1]), 3.0),)
        rays = self.env._ray_distances(self.env.position, 0.0)
        self.assertLess(float(rays[ray_index]), 1.0)
        # The hit distance is beyond the old 12-unit limit.
        self.assertGreater(float(rays[ray_index]) * self.env.RAY_MAX_RANGE, 12.0)

    def test_rays_rotate_with_facing(self):
        self.env.obstacles = ((0.0, 9.0, 3.0),)
        facing = self.env._ray_distances(self.env.position, 0.0)
        away = self.env._ray_distances(self.env.position, math.pi)
        self.assertLess(float(np.min(facing)), float(np.min(away)))

    def test_seed_reproduces_sensor_values(self):
        first, _ = self.env.reset(seed=314)
        second, _ = self.env.reset(seed=314)
        np.testing.assert_allclose(first[10:], second[10:], atol=1e-7)

    def test_reverse_request_never_moves_backward(self):
        self.env.reset(seed=1)
        start = self.env.position.copy()
        heading = np.array([math.sin(self.env.yaw), math.cos(self.env.yaw)])
        # A full-reverse throttle must clip to zero: no backward translation.
        self.env.step(np.array([-1.0, 0.0], dtype=np.float32))
        backward_component = float(np.dot(self.env.position - start, heading))
        self.assertGreaterEqual(backward_component, -1e-6)


if __name__ == "__main__":
    unittest.main()
