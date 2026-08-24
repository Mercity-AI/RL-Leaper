"""Focused checks for the PPO_13 larger, randomized-obstacle arena.

PPO_13 keeps every PPO_12 learning rule (signed throttle, eight rays, reward,
19 collision points, decoupled collision response, PPO settings, rollout size)
and changes only the environment: the field is ~2.5x wider each side, a fresh
random obstacle layout is sampled every episode, and the episode-time cap is
raised so the larger field stays reachable. These tests confirm the obstacle
generator behaves and that the observation contract is unchanged.
"""

import math
import unittest

import numpy as np

from rl_environment import LeaperReachEnv


class RandomArenaTests(unittest.TestCase):
    def setUp(self):
        self.env = LeaperReachEnv()

    def tearDown(self):
        self.env.close()

    def test_field_grew_and_target_scaled(self):
        """The field is larger and the goal moved out with it."""
        self.assertGreater(self.env.WORLD_LIMIT, 25.0)
        # Target stays well inside the wall so it remains reachable.
        self.assertTrue(np.all(np.abs(self.env.TARGET) < self.env.WORLD_LIMIT))
        # The episode cap was raised so the bigger field is not an auto-timeout.
        self.assertGreaterEqual(self.env.MAX_STEPS, 1000)

    def test_reset_samples_requested_obstacle_count(self):
        observation, _ = self.env.reset(seed=3)
        self.assertEqual(len(self.env.obstacles), self.env.NUM_OBSTACLES)
        # Observation contract is unchanged from PPO_11/PPO_12.
        self.assertEqual(observation.shape, (10 + self.env.RAY_COUNT,))
        self.assertTrue(self.env.observation_space.contains(observation))

    def test_obstacles_stay_inside_the_wall(self):
        self.env.reset(seed=5)
        for ox, oz, radius in self.env.obstacles:
            self.assertLessEqual(abs(ox) + radius, self.env.WORLD_LIMIT)
            self.assertLessEqual(abs(oz) + radius, self.env.WORLD_LIMIT)
            self.assertGreaterEqual(radius, self.env.OBSTACLE_RADIUS_RANGE[0] - 1e-6)
            self.assertLessEqual(radius, self.env.OBSTACLE_RADIUS_RANGE[1] + 1e-6)

    def test_obstacles_clear_the_target(self):
        """No obstacle may swallow the goal, or episodes become unsolvable."""
        for seed in range(20):
            self.env.reset(seed=seed)
            for ox, oz, radius in self.env.obstacles:
                gap = math.hypot(ox - float(self.env.TARGET[0]), oz - float(self.env.TARGET[1]))
                self.assertGreaterEqual(gap, radius + self.env.OBSTACLE_TARGET_CLEARANCE - 1e-6)

    def test_layout_changes_between_episodes(self):
        """A fresh layout every episode is the whole point of PPO_13."""
        self.env.reset(seed=1)
        first = tuple(self.env.obstacles)
        self.env.reset(seed=2)
        second = tuple(self.env.obstacles)
        self.assertNotEqual(first, second)

    def test_layout_is_reproducible_for_a_seed(self):
        """Same reset seed -> same layout, so fixed-seed evaluation stays fair."""
        self.env.reset(seed=42)
        first = tuple(self.env.obstacles)
        self.env.reset(seed=42)
        second = tuple(self.env.obstacles)
        self.assertEqual(first, second)

    def test_generated_layouts_keep_target_reachable(self):
        """Every generated layout must leave the target in a large open region."""
        for seed in range(15):
            self.env.reset(seed=seed)
            self.assertTrue(
                self.env._target_reachable(self.env.obstacles),
                f"seed {seed} produced an unreachable target",
            )

    def test_reachability_rejects_a_walled_off_target(self):
        """A ring of obstacles sealing the target must fail the reachability check."""
        tx, tz = float(self.env.TARGET[0]), float(self.env.TARGET[1])
        wall = []
        for k in range(16):
            angle = k * (2 * math.pi / 16)
            wall.append((tx + math.cos(angle) * 7.0, tz + math.sin(angle) * 7.0, 3.0))
        self.assertFalse(self.env._target_reachable(tuple(wall)))

    def _place(self, obstacles, pos, yaw):
        self.env.obstacles = tuple(obstacles)
        self.env.position = np.array(pos, dtype=np.float32)
        self.env.yaw = float(yaw)
        self.env.steps = 0
        self.env.stuck_steps = 0
        self.env.prev_distance = self.env._distance()
        self.env.last_collision = 0.0
        self.env.previous_action = np.zeros(2, dtype=np.float32)
        self.env.trajectory = [self.env.position.copy()]

    def test_stuck_rule_ends_a_wedged_episode_with_a_penalty(self):
        """Wedged against a rock with no progress -> terminate + stuck penalty."""
        # One obstacle straight ahead (+z); the robot starts pressed into it.
        self._place([(0.0, 5.0, 3.0)], (0.0, 0.0), 0.0)
        forward = np.array([1.0, 0.0], dtype=np.float32)
        terminated = False
        last_reward = 0.0
        info = {}
        for _ in range(self.env.STUCK_LIMIT + 5):
            _, last_reward, terminated, truncated, info = self.env.step(forward)
            if terminated:
                break
        self.assertTrue(terminated, "a fully wedged robot should hit the stuck rule")
        self.assertTrue(info["stuck"])
        self.assertFalse(info["is_success"])
        # The terminal step carries the one-time -STUCK_PENALTY.
        self.assertLess(last_reward, -self.env.STUCK_PENALTY + 1.0)

    def test_open_space_never_triggers_stuck(self):
        """No contact means the stuck counter never accumulates."""
        self._place((), (0.0, 0.0), 0.0)
        forward = np.array([1.0, 0.0], dtype=np.float32)
        for _ in range(60):
            _, _, terminated, _, info = self.env.step(forward)
            self.assertFalse(info["stuck"])
            self.assertEqual(self.env.stuck_steps, 0)
            if terminated:
                break

    def test_start_position_is_collision_free(self):
        for seed in range(20):
            self.env.reset(seed=seed)
            self.assertIsNone(
                self.env._collision_for_pose(self.env.position, self.env.yaw)
            )


if __name__ == "__main__":
    unittest.main()
