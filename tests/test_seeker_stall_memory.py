"""Contracts for the optional two-channel stall memory; never train a policy."""
import math
from pathlib import Path
import unittest

import numpy as np
import torch

from rl.seeker_env import SeekerEnv
from rl.seeker_stall_memory import StallMemorySeekerEnv
from rl_environment import LeaperReachEnv


class StallMemoryTests(unittest.TestCase):
    def setUp(self):
        self.env = StallMemorySeekerEnv()
        self.addCleanup(self.env.close)
        self.env.reset(seed=30000)
        self.open_pose()

    def open_pose(self):
        env = self.env
        env.position = np.zeros(2, dtype=np.float32)
        env.yaw = 0.
        env.obstacles = ()
        env.target = np.array([100., 100.], dtype=np.float32)
        env.target_visible = env.target_ever_seen = False
        env.last_seen_target.fill(0.)
        env.steps_since_target_seen = env.TARGET_MEMORY_STEPS
        env.prev_distance = env.best_distance = env._distance()
        env._reset_coverage()
        env._update_coverage()

    def blocked_pose(self):
        env = self.env
        extent = max(float(p[1]) + r for p, r, _ in env._collision_points(env.position, env.yaw))
        env.position[1] = env.WORLD_LIMIT - extent - .1
        env.prev_distance = env.best_distance = env._distance()
        env._reset_coverage()
        env._update_coverage()
        self.assertIsNone(env._collision_for_pose(env.position, env.yaw))
        self.assertIsNotNone(env._collision_for_pose(env.position + [0., env.MOVE_SPEED], env.yaw))

    def test_forced_repetition_alias_old34_but_memory_distinguishes_step39(self):
        self.blocked_pose()
        env = self.env
        action = np.array([1., 0.], dtype=np.float32)
        first, _, term, _, info = env.step(action)
        self.assertFalse(term)
        self.assertTrue(info['collision'])
        np.testing.assert_array_equal(first[31:34], 0.)
        np.testing.assert_allclose(first[34:], [1/40, 1/60])
        for _ in range(38):
            later, _, term, trunc, info = env.step(action)
        self.assertFalse(term or trunc)
        np.testing.assert_array_equal(first[:34], later[:34])
        np.testing.assert_allclose(later[34:], [39/40, 39/60])
        terminal, _, term, trunc, info = env.step(action)
        self.assertTrue(term)
        self.assertFalse(trunc)
        self.assertTrue(info['stuck'])
        np.testing.assert_allclose(terminal[34:], [1., 40/60])

    def test_actual_translation_resets_both_despite_previous_forward_command(self):
        self.blocked_pose()
        env = self.env
        for _ in range(3):
            obs, _, _, _, _ = env.step(np.array([1., 0.], dtype=np.float32))
        np.testing.assert_allclose(obs[34:], [3/40, 3/60])
        # Turn the fixture away from the wall, then take a real forward step.
        env.yaw = math.pi
        previous = env.position.copy()
        obs, _, _, _, _ = env.step(np.array([1., 0.], dtype=np.float32))
        self.assertGreater(np.linalg.norm(env.position - previous), 1e-3)
        np.testing.assert_array_equal(obs[34:], 0.)

    def test_rotation_without_translation_counts_freeze_and_blocked_rotation_counts_stuck(self):
        env = self.env
        obs, _, _, _, info = env.step(np.array([-1., 1.], dtype=np.float32))
        self.assertFalse(info['collision'])
        self.assertAlmostEqual(float(obs[33]), 1.)
        np.testing.assert_allclose(obs[34:], [0., 1/60])
        env.reset(seed=30000)
        self.open_pose()
        self.blocked_pose()
        yaw = env.yaw
        obs, _, _, _, info = env.step(np.array([-1., 1.], dtype=np.float32))
        self.assertTrue(info['collision'])
        self.assertEqual(env.yaw, yaw)
        np.testing.assert_array_equal(obs[31:34], 0.)
        np.testing.assert_allclose(obs[34:], [1/40, 1/60])

    def test_noncolliding_stop_resets_stuck_but_continues_freeze(self):
        self.blocked_pose()
        env = self.env
        env.step(np.array([1., 0.], dtype=np.float32))
        obs, _, _, _, info = env.step(np.array([-1., 0.], dtype=np.float32))
        self.assertFalse(info['collision'])
        np.testing.assert_allclose(obs[34:], [0., 2/60])

    def test_freeze_terminal_and_clipping_and_reset(self):
        env = self.env
        for step in range(60):
            obs, _, term, trunc, info = env.step(np.array([-1., 0.], dtype=np.float32))
            self.assertEqual(term, step == 59)
        self.assertTrue(info['frozen'])
        self.assertFalse(trunc)
        np.testing.assert_array_equal(obs[34:], [0., 1.])
        env.stuck_steps, env.freeze_steps = 100, 200
        np.testing.assert_array_equal(env.stall_memory(), 1.)
        env.stuck_steps, env.freeze_steps = -1, -1
        np.testing.assert_array_equal(env.stall_memory(), 0.)
        obs, _ = env.reset(seed=30001)
        np.testing.assert_array_equal(obs[34:], 0.)
        self.assertEqual(obs.shape, (36,))
        self.assertEqual(obs.dtype, np.float32)
        self.assertTrue(env.observation_space.contains(obs))

    def test_memory_is_target_independent_and_read_only(self):
        env = self.env
        env.stuck_steps, env.freeze_steps = 7, 13
        expected = env.stall_memory()
        for target in ([100., 100.], [-100., -100.], [0., 0.]):
            env.target = np.array(target, dtype=np.float32)
            env.last_seen_target[:] = target
            env.target_ever_seen = not env.target_ever_seen
            np.testing.assert_array_equal(env.stall_memory(), expected)
        self.assertEqual((env.stuck_steps, env.freeze_steps), (7, 13))

    def test_old34_rewards_terminal_info_and_metrics_unchanged_all_variants(self):
        defaults = {k: v for k, v in vars(LeaperReachEnv).items() if k.isupper()}
        for variant in ('control', 'visibility', 'removal', 'icm', 'no_hidden_progress'):
            with self.subTest(variant=variant):
                env = StallMemorySeekerEnv(variant, metrics=True)
                base = SeekerEnv(variant, metrics=True)
                self.addCleanup(env.close)
                self.addCleanup(base.close)
                obs, info = env.reset(seed=30001)
                old, old_info = base.reset(seed=30001)
                np.testing.assert_array_equal(obs[:34], old)
                self.assertEqual(info, old_info)
                for step in range(80):
                    action = np.array([.3, .2] if step < 10 else [-1., 0.], dtype=np.float32)
                    obs, reward, term, trunc, info = env.step(action)
                    old, r, t, tr, old_info = base.step(action)
                    np.testing.assert_array_equal(obs[:34], old)
                    self.assertEqual((reward, term, trunc), (r, t, tr))
                    self.assertEqual(info, old_info)
                    self.assertTrue(env.observation_space.contains(obs))
                    if term or trunc:
                        self.assertIn('research_episode', info)
                        break
                else:
                    self.fail('Fixture must reach terminal metrics')
        self.assertEqual(defaults, {k: v for k, v in vars(LeaperReachEnv).items() if k.isupper()})


class StallDonorTests(unittest.TestCase):
    def test_zero_widen_donors_and_13253_parameters(self):
        from stable_baselines3 import PPO
        from train_rl import widen_policy_state_dict

        torch.set_num_threads(1)
        root = Path(__file__).resolve().parents[1] / 'rl_artifacts'
        for path, size in [('seeker_20260909/donor_34.zip', 34),
                           ('ppo_35_frontier_seed025_500k_s1/leaper_ppo.zip', 31)]:
            with self.subTest(inputs=size):
                if not (root / path).is_file():
                    self.fail(f'Required donor missing: {root / path}')
                donor = PPO.load(root / path, device='cpu')
                env = StallMemorySeekerEnv()
                self.addCleanup(env.close)
                wide = PPO('MlpPolicy', env, policy_kwargs=donor.policy_kwargs, device='cpu')
                wide.policy.load_state_dict(widen_policy_state_dict(donor.policy.state_dict(), wide.policy.state_dict()), strict=True)
                self.assertEqual(sum(p.numel() for p in wide.policy.parameters()), 13253)
                for name, old in donor.policy.state_dict().items():
                    new = wide.policy.state_dict()[name]
                    if old.shape != new.shape:
                        self.assertIn(name, ('mlp_extractor.policy_net.0.weight', 'mlp_extractor.value_net.0.weight'))
                        self.assertEqual((old.shape[1], new.shape[1]), (size, 36))
                        torch.testing.assert_close(new[:, size:], torch.zeros_like(new[:, size:]), atol=0, rtol=0)
                        new = new[:, :size]
                    torch.testing.assert_close(new, old, atol=0, rtol=0)
                rng = np.random.default_rng(3634)
                base = rng.uniform(-1, 1, (1000, size)).astype(np.float32)
                for extra in (np.zeros((1000, 36-size), dtype=np.float32), rng.uniform(0, 1, (1000, 36-size)).astype(np.float32)):
                    full = np.concatenate((base, extra), axis=1)
                    np.testing.assert_allclose(wide.predict(full, deterministic=True)[0], donor.predict(base, deterministic=True)[0], atol=1e-5, rtol=0)
                    with torch.no_grad():
                        torch.testing.assert_close(wide.policy.predict_values(torch.as_tensor(full)), donor.policy.predict_values(torch.as_tensor(base)), atol=1e-5, rtol=0)


if __name__ == '__main__':
    torch.set_num_threads(1)
    unittest.main()
