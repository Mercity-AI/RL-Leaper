"""Focused contracts for the first genuine target-seeking experiment."""

import math
import unittest

import numpy as np

from rl_environment import LeaperReachEnv


class SeekerTests(unittest.TestCase):
    def setUp(self):
        self.env = LeaperReachEnv()
        self.env.obstacles = ()
        self.env.position = np.array([0.0, 0.0], dtype=np.float32)
        self.env.yaw = 0.0

    def tearDown(self):
        self.env.close()

    def reset_memory(self):
        self.env.target_visible = False
        self.env.target_ever_seen = False
        self.env.last_seen_target.fill(0.0)
        self.env.steps_since_target_seen = self.env.TARGET_MEMORY_STEPS

    def prepare_step(self):
        self.env.steps = 0
        self.env.stuck_steps = 0
        self.env.idle_steps = 0
        self.env.prev_distance = self.env._distance()
        self.env.best_distance = self.env.prev_distance
        self.env.last_collision = 0.0
        self.env.previous_action.fill(0.0)
        self.env.visited_cells.clear()
        self.env.visited_views.clear()
        cell, view = self.env._search_state()
        self.env.visited_cells.add(cell)
        self.env.visited_views.add(view)
        self.env.trajectory = [self.env.position.copy()]
        self.reset_memory()
        self.env._update_target_memory(increment_time=False)

    def test_reset_randomizes_target_reproducibly(self):
        self.env.reset(seed=123)
        first = self.env.target.copy()
        self.env.reset(seed=123)
        np.testing.assert_allclose(self.env.target, first)
        self.env.reset(seed=124)
        self.assertFalse(np.allclose(self.env.target, first))

    def test_hidden_target_reveals_no_direction_or_distance(self):
        self.env.target = np.array([0.0, -20.0], dtype=np.float32)
        self.reset_memory()
        self.env._update_target_memory(increment_time=False)
        observation = self.env._observation()
        self.assertEqual(float(observation[0]), 0.0)
        self.assertEqual(float(observation[1]), 1.0)
        np.testing.assert_allclose(observation[2:4], np.zeros(2), atol=1e-7)
        self.assertEqual(float(observation[4]), 1.0)

    def test_visible_tagged_target_supplies_sight_channels(self):
        self.env.target = np.array([0.0, 10.0], dtype=np.float32)
        self.reset_memory()
        self.env._update_target_memory(increment_time=False)
        observation = self.env._observation()
        self.assertEqual(float(observation[0]), 1.0)
        self.assertEqual(float(observation[1]), 0.0)
        np.testing.assert_allclose(observation[2:4], [0.0, 1.0], atol=1e-6)

    def test_obstacle_occludes_target(self):
        self.env.target = np.array([0.0, 12.0], dtype=np.float32)
        self.env.obstacles = ((0.0, 6.0, 2.0),)
        visible, _ = self.env._target_sensor()
        self.assertFalse(visible)

    def test_target_behind_rear_blind_wedge_is_not_visible(self):
        self.env.target = np.array([0.0, -10.0], dtype=np.float32)
        visible, _ = self.env._target_sensor()
        self.assertFalse(visible)

    def test_last_seen_position_survives_occlusion(self):
        self.env.target = np.array([0.0, 10.0], dtype=np.float32)
        self.reset_memory()
        self.env._update_target_memory(increment_time=False)
        self.assertTrue(self.env.target_ever_seen)
        self.env.obstacles = ((0.0, 5.0, 2.0),)
        self.env._update_target_memory()
        observation = self.env._observation()
        self.assertEqual(float(observation[0]), 0.0)
        self.assertGreater(float(observation[1]), 0.0)
        np.testing.assert_allclose(observation[2:4], [0.0, 1.0], atol=1e-6)

    def test_moving_away_while_target_is_hidden_has_no_distance_penalty(self):
        self.env.target = np.array([0.0, 20.0], dtype=np.float32)
        self.env.yaw = math.pi
        self.prepare_step()
        _, _, _, _, info = self.env.step(np.array([1.0, 0.0], dtype=np.float32))
        self.assertFalse(info["target_visible"])
        self.assertEqual(info["reward_terms"]["progress"], 0.0)

    def test_visible_step_toward_target_is_positive(self):
        self.env.target = np.array([0.0, 20.0], dtype=np.float32)
        self.prepare_step()
        _, _, _, _, info = self.env.step(np.array([1.0, 0.0], dtype=np.float32))
        self.assertTrue(info["target_visible"])
        self.assertGreater(info["reward_terms"]["progress"], 0.0)

    def test_reacquiring_target_does_not_repeat_sight_bonus(self):
        self.env.target = np.array([0.0, 20.0], dtype=np.float32)
        self.prepare_step()
        self.env.target_visible = False
        _, _, _, _, info = self.env.step(np.array([0.0, 0.0], dtype=np.float32))
        self.assertEqual(info["reward_terms"]["sight"], 0.0)

    def test_first_ever_sight_earns_bonus_once(self):
        self.env.target = np.array([0.0, -20.0], dtype=np.float32)
        self.prepare_step()
        self.env.yaw = math.pi
        _, _, _, _, info = self.env.step(np.array([0.0, 0.0], dtype=np.float32))
        self.assertEqual(info["reward_terms"]["sight"], self.env.SIGHT_REWARD)

    def test_retreat_after_discovery_is_penalized_even_when_hidden(self):
        self.env.target = np.array([0.0, 20.0], dtype=np.float32)
        self.prepare_step()
        self.env.target_ever_seen = True
        self.env.last_seen_target = self.env.target.copy()
        self.env.yaw = math.pi
        _, _, _, _, info = self.env.step(np.array([1.0, 0.0], dtype=np.float32))
        self.assertFalse(info["target_visible"])
        self.assertLess(info["reward_terms"]["progress"], 0.0)

    def test_slow_seeker_preserves_turning_radius_and_search_horizon(self):
        self.assertEqual(self.env.MOVE_SPEED, 0.375)
        self.assertAlmostEqual(self.env.TURN_SPEED, math.radians(9.0))
        self.assertEqual(self.env.MAX_STEPS, 1000)


if __name__ == "__main__":
    unittest.main()
