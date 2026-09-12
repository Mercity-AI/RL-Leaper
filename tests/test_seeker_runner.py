"""Real SB3 rollout contracts for the seeker callback (no donor required).

Run: python -m unittest discover -s tests -p test_seeker_runner.py -v
Only rollout length/network size are reduced; PPO collection and optimization,
ResearchCallback hooks, and Curiosity learning run without replacement.
"""

from copy import deepcopy
import contextlib
import io
import json
import tempfile
from pathlib import Path
import unittest
from unittest.mock import patch

import gymnasium as gym
import numpy as np
import torch
from stable_baselines3 import PPO
from stable_baselines3.common.vec_env import DummyVecEnv

from rl.seeker_curiosity import Curiosity
from rl.seeker_env import SeekerEnv
from rl.seeker_runner import ResearchCallback


class RecordingCuriosity(Curiosity):
    def __init__(self):
        super().__init__(seed=701)
        self.calls = []
        self.updates = []
        self.update_rms(np.ones(8))

    def errors(self, obs, actions, next_obs):
        result = super().errors(obs, actions, next_obs)
        self.calls.append(tuple(x.copy() for x in (obs, actions, next_obs, result)))
        return result

    def update(self, *data):
        self.updates.append(tuple(x.copy() for x in data))
        return super().update(*data)


class RecordingCallback(ResearchCallback):
    """Observe hook boundaries without reimplementing the callback logic."""
    def __init__(self, *args):
        super().__init__(*args)
        self.steps = []
        self.buffers = []
        self.logged = []

    def _on_step(self):
        loc = self.locals
        row = {key: deepcopy(loc[key]) for key in
               ('actions', 'clipped_actions', 'new_obs', 'dones', 'infos')}
        row['obs'] = self.model._last_obs.copy()
        row['before'] = loc['rewards'].copy()
        row['rms'] = self.curiosity.rms if self.curiosity else None
        result = super()._on_step()
        row['after'] = loc['rewards'].copy()
        self.steps.append(row)
        return result

    def _on_rollout_end(self):
        buffer = self.model.rollout_buffer
        self.buffers.append({key: getattr(buffer, key).copy() for key in
                             ('observations', 'actions', 'rewards', 'values',
                              'log_probs', 'advantages', 'returns', 'episode_starts')})
        super()._on_rollout_end()
        self.logged.append(dict(self.logger.name_to_value))


class BoundaryEnv(gym.Env):
    """Deterministic boundary fixture; SB3 still owns collection/autoreset.

Workers cover searching, discovery, post-discovery, true terminal, timeout,
discovery on terminal, simultaneous terminal/timeout, and ordinary search.
"""
    observation_space = gym.spaces.Box(-1, 1, (34,), dtype=np.float32)
    action_space = gym.spaces.Box(-1, 1, (2,), dtype=np.float32)

    def __init__(self, worker):
        self.worker = worker
        self.executed = []

    def reset(self, *, seed=None, options=None):
        super().reset(seed=seed)
        self.steps = 0
        return np.full(34, -.8 + .01 * self.worker, np.float32), {}

    def step(self, action):
        self.executed.append(action.copy())
        self.steps += 1
        detected = self.worker in (2, 5) or (self.worker == 1 and self.steps >= 2)
        terminated = self.worker in (3, 5, 6)
        truncated = self.worker in (4, 6)
        obs = np.full(34, .2 + .01 * (self.worker + self.steps), np.float32)
        return obs, .25, terminated, truncated, dict(
            target_ever_seen=detected, collision=False, coverage_new_cells=[1])


class RunnerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.old_threads = torch.get_num_threads()
        torch.set_num_threads(1)

    @classmethod
    def tearDownClass(cls):
        torch.set_num_threads(cls.old_threads)

    def run_ppo(self, factories, with_curiosity, variant, n_steps=4, rollouts=2):
        env = DummyVecEnv(factories)
        self.addCleanup(env.close)
        model = PPO('MlpPolicy', env, seed=123, device='cpu', n_steps=n_steps,
                    batch_size=16, n_epochs=1, learning_rate=1.5e-4,
                    gamma=.995, gae_lambda=.95, ent_coef=.01,
                    policy_kwargs=dict(net_arch=[16, 16]), verbose=0)
        initial = deepcopy(model.policy.state_dict())
        curiosity = RecordingCuriosity() if with_curiosity else None
        initial_icm = deepcopy(curiosity.state_dict()) if curiosity else None
        with tempfile.TemporaryDirectory() as directory:
            callback = RecordingCallback(Path(directory), variant, curiosity)
            with patch.object(ResearchCallback, 'checkpoint') as checkpoint:
                with contextlib.redirect_stdout(io.StringIO()):
                    model.learn(n_steps * 8 * rollouts, callback=callback)
                checkpoint.assert_not_called()
            self.assertTrue((Path(directory) / 'rollouts.jsonl').exists())
            episodes = Path(directory) / 'training_episodes.jsonl'
            callback.saved_episodes = ([json.loads(line) for line in episodes.read_text().splitlines()]
                                       if episodes.exists() else [])
        self.assertEqual(model.num_timesteps, n_steps * 8 * rollouts)
        self.assertEqual(model._n_updates, rollouts)
        self.assertTrue(any(not torch.equal(initial[k], v)
                            for k, v in model.policy.state_dict().items()))
        if curiosity:
            self.assertTrue(curiosity.updates)
            self.assertTrue(any(not torch.equal(initial_icm[k], v)
                                for k, v in curiosity.state_dict().items()))
        return model, callback, curiosity

    def test_removal_zero_bonus_real_ppo_exact_equivalence(self):
        factories = [lambda: SeekerEnv('removal', metrics=True) for _ in range(8)]
        plain, a, _ = self.run_ppo(factories, False, 'removal')
        enabled, b, curiosity = self.run_ppo(factories, True, 'removal')
        self.assertEqual(len(a.buffers), 2)
        self.assertEqual(len(curiosity.updates), 2)
        self.assertGreater(curiosity.error_count, 8)
        for left, right in zip(a.buffers, b.buffers):
            for key in left:
                np.testing.assert_array_equal(left[key], right[key], err_msg=key)
        for left, right in zip(a.steps, b.steps):
            for key in ('obs', 'actions', 'clipped_actions', 'new_obs', 'before', 'after', 'dones'):
                np.testing.assert_array_equal(left[key], right[key], err_msg=key)
            np.testing.assert_array_equal(right['before'], right['after'])
        for key, value in plain.policy.state_dict().items():
            torch.testing.assert_close(value, enabled.policy.state_dict()[key], rtol=0, atol=0)
        # Adam state is part of equivalence, not just the final parameter values.
        p, q = plain.policy.optimizer.state_dict(), enabled.policy.optimizer.state_dict()
        self.assertEqual(p['param_groups'], q['param_groups'])
        self.assertEqual(p['state'].keys(), q['state'].keys())
        for index in p['state']:
            for key, value in p['state'][index].items():
                torch.testing.assert_close(value, q['state'][index][key], rtol=0, atol=0)

    def boundary_rollout(self):
        return self.run_ppo([lambda i=i: BoundaryEnv(i) for i in range(8)],
                            True, 'icm', rollouts=1)

    def test_terminal_observations_and_training_pairs_never_use_autoreset(self):
        _, callback, curiosity = self.boundary_rollout()
        eligible = []
        for row, (obs, actions, following, _) in zip(callback.steps, curiosity.calls):
            np.testing.assert_array_equal(obs, row['obs'])
            expected = row['new_obs'].copy()
            for i, done in enumerate(row['dones']):
                if done:
                    expected[i] = row['infos'][i]['terminal_observation']
                    self.assertFalse(np.array_equal(expected[i], row['new_obs'][i]))
            np.testing.assert_array_equal(following, expected)
            mask = np.array([not info['target_ever_seen'] for info in row['infos']])
            eligible.append((obs[mask], actions[mask], expected[mask]))
        self.assertEqual(len(curiosity.updates), 1)
        for i in range(3):
            np.testing.assert_array_equal(curiosity.updates[0][i],
                                          np.concatenate([x[i] for x in eligible]))

    def test_discovery_true_terminal_gates_and_timeout_bootstrap(self):
        model, callback, curiosity = self.boundary_rollout()
        for row, (_, _, _, errors) in zip(callback.steps, curiosity.calls):
            # Explicit worker expectations keep the oracle independent of callback masks.
            allowed = np.array([True, not row['infos'][1]['target_ever_seen'],
                                False, False, True, False, False, True])
            expected = np.where(allowed, .01 * np.clip(errors / row['rms'], 0, 1), 0)
            np.testing.assert_allclose(row['after'] - row['before'], expected, atol=2e-8, rtol=0)
            self.assertGreater(float(expected[4]), 0)  # Time limits may earn curiosity.
            np.testing.assert_array_equal(row['after'][~allowed], row['before'][~allowed])
        # SB3 adds timeout value AFTER the callback; true terminals never bootstrap.
        for step, row in enumerate(callback.steps):
            expected = row['after'].copy()
            for worker in (4,):
                terminal = torch.as_tensor(row['infos'][worker]['terminal_observation'][None])
                # Values in the completed buffer precede PPO's update. Recover the
                # original policy through the same seed, without modifying the model.
                with torch.random.fork_rng(devices=[]):
                    original = PPO('MlpPolicy', model.get_env(), seed=123, n_steps=4,
                                   batch_size=16, policy_kwargs=dict(net_arch=[16, 16]), device='cpu')
                with torch.no_grad():
                    expected[worker] += model.gamma * original.policy.predict_values(terminal).item()
            np.testing.assert_allclose(callback.buffers[0]['rewards'][step], expected, atol=1e-7, rtol=0)

    def test_icm_uses_executed_clipped_actions_ppo_keeps_raw_samples(self):
        model, callback, curiosity = self.boundary_rollout()
        raw = np.stack([row['actions'] for row in callback.steps])
        clipped = np.stack([row['clipped_actions'] for row in callback.steps])
        self.assertTrue(np.any(np.abs(raw) > 1), 'Fixture must exercise Gaussian clipping')
        np.testing.assert_array_equal(clipped, np.clip(raw, -1, 1))
        np.testing.assert_array_equal(callback.buffers[0]['actions'], raw)
        np.testing.assert_array_equal(np.stack([call[1] for call in curiosity.calls]), clipped)
        for worker, env in enumerate(model.get_env().envs):
            np.testing.assert_array_equal(np.stack(env.executed), clipped[:, worker])

    def test_real_episode_metrics_keep_extrinsic_and_intrinsic_separate(self):
        class ShortSeeker(SeekerEnv):
            MAX_STEPS = 2

        _, callback, _ = self.run_ppo(
            [lambda: ShortSeeker('icm', metrics=True) for _ in range(8)],
            True, 'icm', rollouts=1)
        extrinsic, intrinsic = np.zeros(8), np.zeros(8)
        expected_episodes = []
        for row in callback.steps:
            extrinsic += [info['extrinsic_reward'] for info in row['infos']]
            intrinsic += row['after'] - row['before']
            for i, done in enumerate(row['dones']):
                if done:
                    episode = row['infos'][i]['research_episode']
                    self.assertAlmostEqual(episode['reward'], extrinsic[i], places=6)
                    expected_episodes.append((extrinsic[i], intrinsic[i], episode))
                    extrinsic[i] = intrinsic[i] = 0
        self.assertEqual(len(expected_episodes), 16)
        self.assertEqual(len(callback.saved_episodes), 16)
        self.assertGreater(sum(row['intrinsic'] for row in callback.saved_episodes), 0)
        for saved, (reward, bonus, episode) in zip(callback.saved_episodes, expected_episodes):
            self.assertAlmostEqual(saved['reward'], reward, places=6)
            self.assertAlmostEqual(saved['intrinsic'], bonus, places=6)
            for key in ('success', 'detected', 'steps', 'coverage_final', 'collision_rate', 'revisits'):
                self.assertEqual(saved[key], episode[key])
        for key in ('success', 'detected', 'steps', 'coverage_final', 'collision_rate', 'revisits'):
            self.assertAlmostEqual(callback.logged[-1]['stochastic_last100/' + key],
                                   np.mean([row[key] for row in callback.saved_episodes]))
        np.testing.assert_array_equal(callback.intrinsic_totals, 0)


if __name__ == '__main__':
    unittest.main()
