"""Geometry and compatibility checks for the dormant footprint sensor branch."""
import math
from pathlib import Path
import unittest

import numpy as np
import torch

from rl.seeker_clearance import FootprintSeekerEnv
from rl.seeker_env import SeekerEnv
from rl_environment import LeaperReachEnv


class ClearanceTests(unittest.TestCase):
    def setUp(self):
        self.env = FootprintSeekerEnv()
        self.addCleanup(self.env.close)
        self.env.position = np.zeros(2, dtype=np.float32)
        self.env.yaw = 0.
        self.env.obstacles = ()

    def test_empty_space_range_and_existing_cone(self):
        values = self.env.footprint_clearance()
        self.assertEqual(values.shape, (16,))
        self.assertEqual(values.dtype, np.float32)
        np.testing.assert_array_equal(values, 1.)
        angles = self.env._ray_relative_angles()
        np.testing.assert_allclose(angles, -angles[::-1], atol=1e-14)
        self.assertAlmostEqual(angles[-1] - angles[0], math.radians(270) * 15 / 16)
        self.assertEqual(self.env.CLEARANCE_RANGE, 6.)

    def test_walls_numeric_contact_and_six_unit_normalization(self):
        env = self.env
        # Place the outermost forward sample exactly 3 units from its wall.
        extent = max(float(p[1]) + r for p, r, _ in env._collision_points(env.position, env.yaw))
        env.position[1] = env.WORLD_LIMIT - extent - 3.
        distance = env._clearance_distances([[0., 1.]])[0]
        self.assertAlmostEqual(distance, 3., places=5)
        self.assertAlmostEqual(distance / env.CLEARANCE_RANGE, .5, places=5)
        self.assert_brackets_contact(np.array([0., 1.]), distance)
        angles = env.yaw + env._ray_relative_angles()
        dirs = np.stack((np.sin(angles), np.cos(angles)), axis=1)
        np.testing.assert_allclose(env.footprint_clearance(), env._clearance_distances(dirs) / 6, atol=1e-7)
        # Opposite direction is clear for the full range.
        self.assertEqual(env._clearance_distances([[0., -1.]])[0], 6.)

    def assert_brackets_contact(self, direction, distance):
        env = self.env
        self.assertIsNone(env._collision_for_pose(env.position + direction * (distance - 1e-4), env.yaw))
        self.assertIsNotNone(env._collision_for_pose(env.position + direction * (distance + 1e-4), env.yaw))

    def test_obstacle_body_clear_outer_leg_blocked(self):
        env = self.env
        endpoint = list(env._collision_points(env.position, 0.))[3][0]
        env.obstacles = ((float(endpoint[0]), float(endpoint[1]) + .24 + .5 + .2, .5),)
        distance = env._clearance_distances([[0., 1.]])[0]
        self.assertAlmostEqual(distance, .2, places=5)
        self.assert_brackets_contact(np.array([0., 1.]), distance)
        body_after_move = env.position + [0., env.MOVE_SPEED]
        ox, oz, radius = env.obstacles[0]
        self.assertGreater(np.linalg.norm(body_after_move - [ox, oz]), radius + env.AGENT_RADIUS)
        self.assertEqual(env._collision_for_pose(body_after_move, 0.), 'leg-3')

    def test_vectorized_distances_match_independent_collision_bisection(self):
        env = self.env
        cases = [((0., 0.), .31, ((0., 7., 1.), (6., 0., 1.))),
                 ((25., 24.), -.7, ()),
                 ((0., 0.), 1.2, ((-6., 0., 1.2), (0., -7., 1.)))]
        contacts = 0
        for position, yaw, obstacles in cases:
            env.position = np.array(position, dtype=np.float32)
            env.yaw, env.obstacles = yaw, obstacles
            self.assertIsNone(env._collision_for_pose(env.position, yaw))
            angles = yaw + env._ray_relative_angles()
            directions = np.stack((np.sin(angles), np.cos(angles)), axis=1)
            distances = env._clearance_distances(directions)
            for u, predicted in zip(directions, distances):
                # Independently find FIRST colliding pose; do not assume a distant
                # endpoint remains inside an obstacle after crossing it.
                previous = 0.
                for t in np.linspace(.025, 6., 240):
                    if env._collision_for_pose(env.position + u * t, yaw) is not None:
                        lo, hi = previous, t
                        for _ in range(25):
                            mid = (lo + hi) / 2
                            if env._collision_for_pose(env.position + u * mid, yaw) is None:
                                lo = mid
                            else:
                                hi = mid
                        self.assertAlmostEqual(predicted, (lo + hi) / 2, delta=2e-5)
                        contacts += 1
                        break
                    previous = t
                else:
                    self.assertAlmostEqual(predicted, 6., delta=2e-5)
        self.assertGreater(contacts, 10)

    def test_initial_obstacle_and_wall_overlaps_are_conservative(self):
        env = self.env
        env.obstacles = ((0., 0., 1.),)
        np.testing.assert_array_equal(env.footprint_clearance(), 0.)
        env.obstacles = ()
        env.position[0] = env.WORLD_LIMIT
        np.testing.assert_array_equal(env.footprint_clearance(), 0.)

    def test_nearest_surface_occludes_farther_obstacle_and_range_is_capped(self):
        env = self.env
        env.obstacles = ((0., 5., 1.),)
        near = env.footprint_clearance()
        env.obstacles += ((0., 10., 1.),)
        np.testing.assert_array_equal(env.footprint_clearance(), near)
        env.obstacles = ((0., 20., 1.),)
        np.testing.assert_array_equal(env.footprint_clearance(), 1.)

    def test_target_and_memory_independent_no_sensor_state_changes(self):
        env = self.env
        env.reset(seed=30000)
        before = env.footprint_clearance()
        for target in ((100., 100.), (0., 0.), (-5., 9.)):
            env.target = np.array(target, dtype=np.float32)
            env.target_ever_seen = not env.target_ever_seen
            env.last_seen_target[:] = target
            env.coverage_cleared[:] = ~env.coverage_cleared
            env.previous_action[:] = [-1., 1.]
            np.testing.assert_array_equal(env.footprint_clearance(), before)
        state_keys = set(vars(env))
        position, yaw = env.position.copy(), env.yaw
        env.footprint_clearance()
        self.assertEqual(set(vars(env)), state_keys)
        np.testing.assert_array_equal(env.position, position)
        self.assertEqual(env.yaw, yaw)

    def test_reset_step_preserve34_physics_rewards_and_metrics(self):
        defaults = {k: v for k, v in vars(LeaperReachEnv).items() if k.isupper()}
        for variant in ('control', 'visibility', 'removal', 'icm', 'no_hidden_progress'):
            with self.subTest(variant=variant):
                env = FootprintSeekerEnv(variant, metrics=True)
                base = SeekerEnv(variant, metrics=True)
                self.addCleanup(env.close)
                self.addCleanup(base.close)
                obs, info = env.reset(seed=30000)
                old, old_info = base.reset(seed=30000)
                np.testing.assert_array_equal(obs[:34], old)
                self.assertEqual(info, old_info)
                self.assertEqual(obs.shape, (50,))
                self.assertTrue(env.observation_space.contains(obs))
                # A stationary pose reaches freeze or stuck; compare terminal
                # metrics too, without running a full benchmark episode.
                for _ in range(base.FREEZE_LIMIT):
                    action = np.array([-1., 0.], dtype=np.float32)
                    obs, reward, term, trunc, info = env.step(action)
                    old, r, t, tr, old_info = base.step(action)
                    np.testing.assert_array_equal(obs[:34], old)
                    self.assertEqual((reward, term, trunc), (r, t, tr))
                    self.assertEqual(info, old_info)
                    self.assertTrue(env.observation_space.contains(obs))
                    np.testing.assert_array_equal(obs[34:], env.footprint_clearance())
                    if term or trunc:
                        self.assertIn('research_episode', info)
                        break
                else:
                    self.fail('Stationary fixture failed to terminate')
        self.assertEqual(defaults, {k: v for k, v in vars(LeaperReachEnv).items() if k.isupper()})


class ClearanceDonorTests(unittest.TestCase):
    def test_zero_widen_34_to50_preserves_weights_actions_and_values(self):
        self.check_donor('seeker_20260909/donor_34.zip', 34)

    def test_zero_widen_31_to50_preserves_weights_actions_and_values(self):
        self.check_donor('ppo_35_frontier_seed025_500k_s1/leaper_ppo.zip', 31)

    def check_donor(self, relative_path, input_size):
        from stable_baselines3 import PPO
        from train_rl import widen_policy_state_dict

        torch.set_num_threads(1)
        donor_path = Path(__file__).resolve().parents[1] / 'rl_artifacts' / relative_path
        if not donor_path.is_file():
            self.skipTest(f'Local {input_size}-input donor is unavailable: {donor_path}')
        donor = PPO.load(donor_path, device='cpu')
        env = FootprintSeekerEnv()
        self.addCleanup(env.close)
        wide = PPO('MlpPolicy', env, policy_kwargs=donor.policy_kwargs, device='cpu')
        wide.policy.load_state_dict(widen_policy_state_dict(donor.policy.state_dict(), wide.policy.state_dict()), strict=True)
        for name, old in donor.policy.state_dict().items():
            new = wide.policy.state_dict()[name]
            if old.shape != new.shape:
                self.assertIn(name, ('mlp_extractor.policy_net.0.weight', 'mlp_extractor.value_net.0.weight'))
                self.assertEqual((old.shape[1], new.shape[1]), (input_size, 50))
                torch.testing.assert_close(new[:, input_size:], torch.zeros_like(new[:, input_size:]), atol=0, rtol=0)
                new = new[:, :input_size]
            torch.testing.assert_close(old, new, atol=0, rtol=0)
        rng = np.random.default_rng(3516)
        base = rng.uniform(-1, 1, (1000, input_size)).astype(np.float32)
        extra_size = 50 - input_size
        nonzero = rng.uniform(0, 1, (1000, extra_size)).astype(np.float32)
        if input_size == 31:
            nonzero[:, :3] = rng.uniform(-1, 1, (1000, 3))
        for extra in (np.zeros((1000, extra_size), dtype=np.float32), nonzero):
            full = np.concatenate((base, extra), axis=1)
            np.testing.assert_allclose(wide.predict(full, deterministic=True)[0], donor.predict(base, deterministic=True)[0], atol=1e-5, rtol=0)
            with torch.no_grad():
                torch.testing.assert_close(wide.policy.predict_values(torch.as_tensor(full)), donor.policy.predict_values(torch.as_tensor(base)), atol=1e-5, rtol=0)


if __name__ == '__main__':
    torch.set_num_threads(1)
    unittest.main()
