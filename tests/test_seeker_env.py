"""Contracts for the isolated seeker wrapper; never change production flags."""
import math
import unittest
from pathlib import Path

import numpy as np
import torch

from rl_environment import LeaperReachEnv
from rl.seeker_env import SeekerEnv

ROOT = Path(__file__).resolve().parents[1]
DONOR = ROOT / 'rl_artifacts/ppo_35_frontier_seed025_500k_s1/leaper_ppo.zip'


class Base31(LeaperReachEnv):
    NORMALIZED_THROTTLE = True
    FRONTIER_NOTE = True
    COVERAGE_MAP = False


class SeekerEnvTests(unittest.TestCase):
    def env(self, variant='control'):
        env = SeekerEnv(variant)
        self.addCleanup(env.close)
        env.reset(seed=10001)
        return env

    def open_pose(self, env):
        env.obstacles = ()
        env.position = np.zeros(2, dtype=np.float32)
        env.yaw = 0.0
        env.target = np.array([100., 100.], dtype=np.float32)
        env.target_ever_seen = env.target_visible = False
        env.steps_since_target_seen = env.TARGET_MEMORY_STEPS
        env.prev_distance = env.best_distance = env._distance()
        env.visited_cells.clear()
        env.visited_views.clear()
        env.scanned_headings.clear()
        cell, view = env._search_state()
        env.visited_cells.add(cell)
        env.visited_views.add(view)
        env.scanned_headings.add(view[2])
        env._reset_coverage()
        env._update_coverage()

    def test_production_defaults_and_variant_isolation(self):
        saved = {k: v for k, v in vars(LeaperReachEnv).items() if k.isupper()}
        for variant in ('control', 'visibility', 'removal', 'icm', 'no_hidden_progress'):
            self.env(variant).step(np.array([0., 0.], dtype=np.float32))
        self.assertEqual(saved, {k: v for k, v in vars(LeaperReachEnv).items() if k.isupper()})
        self.assertFalse(LeaperReachEnv.NORMALIZED_THROTTLE)
        self.assertFalse(LeaperReachEnv.FRONTIER_NOTE)
        self.assertFalse(LeaperReachEnv.COVERAGE_MAP)
        self.assertEqual(LeaperReachEnv.observation_size(), 26)
        self.assertEqual(self.env().EXPLORATION_REWARD, LeaperReachEnv.EXPLORATION_REWARD)

    def test_34_observations_preserve_base31_and_rewards(self):
        env, base = self.env(), Base31()
        self.addCleanup(base.close)
        obs, _ = env.reset(seed=10001)
        old, _ = base.reset(seed=10001)
        np.testing.assert_array_equal(obs[:31], old)
        np.testing.assert_array_equal(obs[31:], 0)
        rng = np.random.default_rng(91)
        for action in rng.uniform(-1, 1, (80, 2)).astype(np.float32):
            obs, reward, term, trunc, info = env.step(action)
            old, r, t, tr, i = base.step(action)
            self.assertEqual(obs.shape, (34,))
            self.assertEqual(obs.dtype, np.float32)
            self.assertTrue(env.observation_space.contains(obs))
            np.testing.assert_array_equal(obs[:31], old)
            self.assertEqual((reward, term, trunc), (r, t, tr))
            self.assertEqual(info['reward_terms'], i['reward_terms'])
            if term or trunc:
                break

    def test_actual_odometry_and_wrapped_yaw(self):
        env = self.env()
        self.open_pose(env)
        env.yaw = math.pi - env.TURN_SPEED / 2
        before = env.position.copy()
        obs, _, _, _, _ = env.step(np.array([0., 1.], dtype=np.float32))
        expected = np.r_[(env.position - before) / env.MOVE_SPEED, 1.]
        np.testing.assert_allclose(obs[31:], expected, atol=1e-6)
        self.assertLess(env.yaw, 0)
        self.assertAlmostEqual(float(np.linalg.norm(obs[31:33])), 0.5, places=6)

    def test_blocked_translation_reports_zero_actual_odometry(self):
        env = self.env()
        self.open_pose(env)
        # Find real wall contact from a valid pose, without mocking collision math.
        for z in np.linspace(env.WORLD_LIMIT - 6, env.WORLD_LIMIT, 601):
            pos = np.array([0., z], dtype=np.float32)
            if env._is_free(pos, 0.) and not env._is_free(pos + [0., env.MOVE_SPEED], 0.):
                env.position = pos
                break
        else:
            self.fail('No valid wall-contact fixture')
        obs, _, _, _, info = env.step(np.array([1., 0.], dtype=np.float32))
        self.assertTrue(info['collision'])
        np.testing.assert_array_equal(obs[31:], 0)
        self.assertEqual(env.previous_action[0], 1.)

    def test_visibility_reset_has_no_bonus_and_no_spawn_repayment(self):
        env = self.env('visibility')
        for seed in (10001, 10002):
            obs, info = env.reset(seed=seed)
            self.assertNotIn('reward_terms', info)
            self.assertNotIn('visibility_bonus', info)
            np.testing.assert_array_equal(obs[31:], 0)
            cleared = env.coverage_cleared.copy()
            _, _, _, _, info = env.step(np.array([-1., 0.], dtype=np.float32))
            self.assertEqual(info['visibility_bonus'], 0.)
            np.testing.assert_array_equal(env.coverage_cleared, cleared)

    def test_visibility_unique_cells_and_episode_bonus_cap(self):
        env = self.env('visibility')
        self.open_pose(env)
        seen = set(np.flatnonzero(env.coverage_cleared))
        total = 0.
        for _ in range(env.MAX_STEPS):
            _, reward, term, trunc, info = env.step(np.array([0.5, 0.7], dtype=np.float32))
            new = set(env.coverage_new_cells)
            self.assertFalse(seen & new)
            seen.update(new)
            bonus = info['visibility_bonus']
            self.assertAlmostEqual(bonus, len(new) / env.coverage_cleared.size)
            self.assertGreaterEqual(bonus, 0.)
            total += bonus
            self.assertAlmostEqual(reward, sum(info['reward_terms'].values()))
            self.assertEqual(info['extrinsic_reward'], reward)
            if term or trunc:
                break
        self.assertGreater(total, 0.)
        self.assertLessEqual(total, 1. + 1e-12)

    def test_no_visibility_or_scan_bonus_on_detection_and_after(self):
        env = self.env('visibility')
        self.open_pose(env)
        env.target = np.array([0., 10.], dtype=np.float32)
        for _ in range(4):
            _, _, _, _, info = env.step(np.array([-1., 1.], dtype=np.float32))
            self.assertTrue(info['target_ever_seen'])
            self.assertEqual(info['visibility_bonus'], 0.)
            self.assertEqual(info['reward_terms']['exploration'], 0.)

    def test_removal_preserves_scan_only_and_caps_it(self):
        env = self.env('removal')
        self.open_pose(env)
        self.assertEqual(env.EXPLORATION_REWARD, 0.)
        self.assertEqual(env.NEW_VIEW_REWARD, 0.)
        self.assertEqual(env.SCAN_REWARD, LeaperReachEnv.SCAN_REWARD)
        total = 0.
        for _ in range(45):
            _, _, term, trunc, info = env.step(np.array([-1., 1.], dtype=np.float32))
            total += info['reward_terms']['exploration']
            self.assertEqual(info['visibility_bonus'], 0.)
            self.assertFalse(term or trunc)
        self.assertAlmostEqual(total, (env.EXPLORATION_HEADING_BINS - 1) * env.SCAN_REWARD)
        env.target_ever_seen = True
        self.assertEqual(env.step(np.array([-1., 1.]))[4]['reward_terms']['exploration'], 0.)


class DonorWideningTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from stable_baselines3 import PPO
        from train_rl import widen_policy_state_dict
        torch.set_num_threads(1)
        if not DONOR.is_file():
            raise FileNotFoundError(f'Required audit donor missing: {DONOR}')
        cls.donor = PPO.load(DONOR, device='cpu')
        cls.env = SeekerEnv()
        cls.addClassCleanup(cls.env.close)
        cls.wide = PPO('MlpPolicy', cls.env, policy_kwargs=cls.donor.policy_kwargs, device='cpu')
        cls.wide.policy.load_state_dict(widen_policy_state_dict(
            cls.donor.policy.state_dict(), cls.wide.policy.state_dict()), strict=True)

    def test_only_three_zero_columns_added_all_other_weights_exact(self):
        for name, old in self.donor.policy.state_dict().items():
            new = self.wide.policy.state_dict()[name]
            if new.shape != old.shape:
                self.assertIn(name, ('mlp_extractor.policy_net.0.weight', 'mlp_extractor.value_net.0.weight'))
                self.assertEqual((old.shape[1], new.shape[1]), (31, 34))
                torch.testing.assert_close(new[:, 31:], torch.zeros_like(new[:, 31:]), atol=0, rtol=0)
                new = new[:, :31]
            torch.testing.assert_close(new, old, atol=0, rtol=0)

    def test_actions_and_values_match_even_with_nonzero_odometry(self):
        rng = np.random.default_rng(3501)
        base = rng.uniform(-1, 1, (1000, 31)).astype(np.float32)
        for extra in (np.zeros((1000, 3), dtype=np.float32), rng.uniform(-1, 1, (1000, 3)).astype(np.float32)):
            wide = np.concatenate((base, extra), axis=1)
            np.testing.assert_allclose(self.wide.predict(wide, deterministic=True)[0],
                                       self.donor.predict(base, deterministic=True)[0], atol=1e-5, rtol=0)
            with torch.no_grad():
                a = self.donor.policy.predict_values(torch.as_tensor(base))
                b = self.wide.policy.predict_values(torch.as_tensor(wide))
            torch.testing.assert_close(a, b, atol=1e-5, rtol=0)


if __name__ == '__main__':
    torch.set_num_threads(1)
    unittest.main()
