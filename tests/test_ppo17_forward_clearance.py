"""Focused checks for PPO_17 forward collision-aware vision."""

import math
import unittest

import numpy as np

from rl_environment import LeaperReachEnv


class ForwardClearanceVisionTests(unittest.TestCase):
    def setUp(self):
        self.env = LeaperReachEnv()
        self.env.obstacles = ()
        self.env.position = np.array([0.0, 0.0], dtype=np.float32)
        self.env.yaw = 0.0

    def tearDown(self):
        self.env.close()

    def test_observation_contract_remains_eighteen_values(self):
        observation, _ = self.env.reset(seed=17)
        self.assertEqual(self.env.RAY_COUNT, 8)
        self.assertEqual(observation.shape, (18,))
        self.assertTrue(self.env.observation_space.contains(observation))

    def test_eight_sectors_tile_exactly_two_hundred_degrees(self):
        bounds = self.env._vision_sector_bounds()
        self.assertEqual(len(bounds), 8)
        self.assertAlmostEqual(math.degrees(bounds[0][0]), -100.0)
        self.assertAlmostEqual(math.degrees(bounds[-1][1]), 100.0)
        for left, right in zip(bounds, bounds[1:]):
            self.assertAlmostEqual(left[1], right[0])
        for start, end in bounds:
            self.assertAlmostEqual(math.degrees(end - start), 25.0)

    def test_directly_forward_obstacle_is_detected_symmetrically(self):
        self.env.obstacles = ((0.0, 10.0, 3.0),)
        vision = self.env._ray_distances(self.env.position, self.env.yaw)
        self.assertLess(float(vision[3]), 1.0)
        self.assertLess(float(vision[4]), 1.0)
        self.assertAlmostEqual(float(vision[3]), float(vision[4]), places=5)

    def test_equivalent_left_and_right_obstacles_are_symmetric(self):
        self.env.obstacles = ((-5.0, 9.0, 2.8), (5.0, 9.0, 2.8))
        vision = self.env._ray_distances(self.env.position, self.env.yaw)
        np.testing.assert_allclose(vision, vision[::-1], atol=1e-5)

    def test_obstacle_entirely_behind_is_not_visible(self):
        self.env.obstacles = ((0.0, -6.0, 3.0),)
        vision = self.env._ray_distances(self.env.position, self.env.yaw)
        np.testing.assert_allclose(vision, np.ones(8), atol=1e-6)

    def test_turning_rotates_the_field_of_view(self):
        self.env.obstacles = ((0.0, 9.0, 3.0),)
        facing = self.env._ray_distances(self.env.position, 0.0)
        away = self.env._ray_distances(self.env.position, math.pi)
        self.assertLess(float(np.min(facing)), float(np.min(away)))

    def test_open_space_reads_fully_clear(self):
        vision = self.env._ray_distances(self.env.position, self.env.yaw)
        np.testing.assert_allclose(vision, np.ones(8), atol=1e-6)

    def test_clearance_decreases_monotonically(self):
        readings = []
        for obstacle_z in (14.0, 12.0, 10.0):
            self.env.obstacles = ((0.0, obstacle_z, 3.0),)
            readings.append(float(np.min(self.env._ray_distances(self.env.position, 0.0))))
        self.assertGreater(readings[0], readings[1])
        self.assertGreater(readings[1], readings[2])

    def test_leg_clearance_warns_before_body_centre_clearance(self):
        self.env.obstacles = ((0.0, 10.0, 3.0),)
        body_only_clearance = 10.0 - 3.0 - self.env.AGENT_RADIUS
        sensed_clearance = float(np.min(self.env._ray_distances(self.env.position, 0.0))) \
            * self.env.RAY_MAX_RANGE
        self.assertLess(sensed_clearance, body_only_clearance - 1.0)
        self.assertGreater(sensed_clearance, 0.0)

    def test_wall_clearance_accounts_for_outer_legs(self):
        self.env.position = np.array([0.0, 87.0], dtype=np.float32)
        centre_to_wall = self.env.WORLD_LIMIT - float(self.env.position[1])
        sensed_clearance = float(np.min(self.env._ray_distances(self.env.position, 0.0))) \
            * self.env.RAY_MAX_RANGE
        self.assertLess(sensed_clearance, centre_to_wall - self.env.AGENT_RADIUS)
        self.assertGreaterEqual(sensed_clearance, 0.0)

    def test_seed_reproduces_sensor_values(self):
        first, _ = self.env.reset(seed=314)
        second, _ = self.env.reset(seed=314)
        np.testing.assert_allclose(first[10:], second[10:], atol=1e-7)

    def test_sampled_clearance_has_no_short_move_false_negatives(self):
        """If a sector reports > one step, each sampled direction must be safe."""
        checked = 0
        for seed in range(12):
            self.env.reset(seed=100 + seed)
            readings = self.env._ray_distances(self.env.position, self.env.yaw)
            angles = self.env._vision_sample_angles(self.env.yaw).reshape(
                self.env.RAY_COUNT,
                self.env.VISION_SAMPLES_PER_SECTOR,
            )
            for sector, reading in enumerate(readings):
                if float(reading) * self.env.RAY_MAX_RANGE <= self.env.MOVE_SPEED + 1e-5:
                    continue
                for angle in angles[sector]:
                    direction = np.array([math.sin(angle), math.cos(angle)], dtype=np.float32)
                    candidate = self.env.position + direction * self.env.MOVE_SPEED
                    self.assertIsNone(
                        self.env._collision_for_pose(candidate, self.env.yaw),
                        f"seed {seed}, sector {sector} reported safe but collided",
                    )
                    checked += 1
        self.assertGreater(checked, 20)


if __name__ == "__main__":
    unittest.main()
