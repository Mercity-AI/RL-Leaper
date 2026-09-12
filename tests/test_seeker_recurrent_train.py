"""Scratch-only recurrent sampler/trainer contracts; no donor or long training.

python -m unittest discover -s tests -p test_seeker_recurrent_train.py -v
"""

from copy import deepcopy
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import gymnasium as gym
import numpy as np
import torch
from sb3_contrib import RecurrentPPO
from sb3_contrib.common.recurrent.type_aliases import RNNStates
from stable_baselines3.common.callbacks import BaseCallback
from stable_baselines3.common.logger import configure
from stable_baselines3.common.vec_env import DummyVecEnv

from rl import seeker_recurrent_train as trainer
from rl.seeker_recurrent_policy import ResidualLstmPolicy
from rl.seeker_recurrent_train import FixedContextRecurrentPPO, Segment, learning_batches, prepare_batch


class TinyEpisodes(gym.Env):
    observation_space = gym.spaces.Box(-1, 1, (34,), dtype=np.float32)
    action_space = gym.spaces.Box(-1, 1, (2,), dtype=np.float32)

    def __init__(self, worker):
        self.worker = worker

    def reset(self, *, seed=None, options=None):
        super().reset(seed=seed)
        self.steps = 0
        return np.full(34, -.7 + self.worker * .1, np.float32), {}

    def step(self, action):
        self.steps += 1
        done = self.steps == 2
        obs = np.full(34, .2 + self.steps * .1 + self.worker * .05, np.float32)
        return obs, .25, done and self.worker == 1, done and self.worker == 0, {}


class CaptureRollout(BaseCallback):
    def __init__(self):
        super().__init__()
        self.steps = []

    def _on_step(self):
        self.steps.append({key: deepcopy(self.locals[key]) for key in
                           ('new_obs', 'rewards', 'dones', 'infos', 'lstm_states')})
        return True

    def _on_rollout_end(self):
        self.rewards = self.model.rollout_buffer.rewards.copy()
        self.episode_starts = self.model.rollout_buffer.episode_starts.copy()


def sampling_buffer(steps=389, workers=3):
    starts = np.zeros((steps, workers), np.float32)
    for worker, resets in enumerate(((0, 17, 146, 301), (81, 256), (0, 1, 128, 130))):
        if worker < workers:
            starts[[i for i in resets if i < steps], worker] = 1
    return SimpleNamespace(buffer_size=steps, n_envs=workers, episode_starts=starts,
                           full=True, generator_ready=False)


class RecurrentTrainerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.old_threads = torch.get_num_threads()
        torch.set_num_threads(1)

    @classmethod
    def tearDownClass(cls):
        torch.set_num_threads(cls.old_threads)

    def setUp(self):
        self.numpy_state = np.random.get_state()
        self.torch_state = torch.get_rng_state()
        self.addCleanup(np.random.set_state, self.numpy_state)
        self.addCleanup(torch.set_rng_state, self.torch_state)

    def model(self, steps=8, batch_size=16, active_memory=False):
        env = DummyVecEnv([lambda: TinyEpisodes(0), lambda: TinyEpisodes(1)])
        self.addCleanup(env.close)
        model = FixedContextRecurrentPPO(
            ResidualLstmPolicy, env, seed=731, n_steps=steps, batch_size=batch_size,
            n_epochs=1, device='cpu', ent_coef=.01, clip_range_vf=.2,
            verbose=0)
        if active_memory:
            # Production projections start at zero. Open this scratch fixture's
            # memory path so wrong recurrent state/gradients cannot hide behind it.
            with torch.no_grad():
                for layer in (model.policy.residual_actor, model.policy.residual_critic):
                    layer.weight.copy_(torch.eye(64) * .25)
        model.set_logger(configure(format_strings=[]))
        return model

    def populated_buffer(self, model):
        buffer = model.rollout_buffer
        rng = np.random.default_rng(19)
        for key in ('observations', 'actions', 'values', 'log_probs', 'advantages', 'returns',
                    'hidden_states_pi', 'cell_states_pi', 'hidden_states_vf', 'cell_states_vf'):
            array = getattr(buffer, key)
            array[:] = rng.uniform(-.5, .5, array.shape)
        buffer.episode_starts[:] = 0
        buffer.episode_starts[0, 0] = 1
        buffer.episode_starts[3, 0] = 1
        buffer.episode_starts[5, 1] = 1
        buffer.full = True
        return buffer

    def test_every_token_once_episode_local_bounded_context_and_exact_batches(self):
        buffer = sampling_buffer()
        original = buffer.episode_starts.copy()
        np.random.seed(7)
        batches = list(learning_batches(buffer))
        counts = [sum(s.stop - s.start for s in batch) for batch in batches]
        self.assertEqual(counts, [256, 256, 256, 256, 143])
        seen = []
        for batch in batches:
            self.assertIsInstance(batch, list)
            for s in batch:
                self.assertIsInstance(s, Segment)
                self.assertTrue(0 <= s.worker < buffer.n_envs)
                self.assertTrue(0 <= s.warm_start <= s.start < s.stop <= buffer.buffer_size)
                self.assertLessEqual(s.stop - s.start, 128)
                resets = np.flatnonzero(buffer.episode_starts[:s.start + 1, s.worker])
                episode_start = int(resets[-1]) if len(resets) else 0
                self.assertEqual(s.warm_start, max(episode_start, s.start - 32))
                self.assertFalse(buffer.episode_starts[s.start + 1:s.stop, s.worker].any())
                seen.extend((s.worker, t) for t in range(s.start, s.stop))
        self.assertEqual(len(seen), len(set(seen)))
        self.assertEqual(set(seen), {(w, t) for w in range(3) for t in range(389)})
        np.testing.assert_array_equal(buffer.episode_starts, original)
        self.assertFalse(buffer.generator_ready)

    def test_shuffle_whole_chunks_and_split_only_at_batch_boundary(self):
        buffer = sampling_buffer(steps=300, workers=1)
        buffer.episode_starts[:] = 0
        buffer.episode_starts[0] = 1
        with patch.object(trainer.np.random, 'permutation', return_value=np.array([2, 0, 1])) as shuffle:
            batches = list(learning_batches(buffer))
        shuffle.assert_called_once_with(3)
        self.assertEqual(batches, [
            [Segment(0, 256, 300, 224), Segment(0, 0, 128, 0), Segment(0, 128, 212, 96)],
            [Segment(0, 212, 256, 180)]])
        # Repeated epochs retain the same tokens but actually change chunk order.
        buffer = sampling_buffer()
        orders = []
        for seed in (1, 2, 1):
            np.random.seed(seed)
            orders.append(list(learning_batches(buffer)))
        self.assertEqual(orders[0], orders[2])
        self.assertNotEqual(orders[0], orders[1])

    def test_reject_incomplete_or_stock_flattened_buffers(self):
        buffer = sampling_buffer()
        buffer.full = False
        with self.assertRaises(RuntimeError):
            list(learning_batches(buffer))
        buffer.full, buffer.generator_ready = True, True
        with self.assertRaises(RuntimeError):
            list(learning_batches(buffer))

    def test_prepare_packing_reset_and_detached_burn_in_match_independent_replay(self):
        model = self.model(active_memory=True)
        buffer = self.populated_buffer(model)
        policy = model.policy
        segments = [Segment(0, 5, 8, 3), Segment(1, 2, 5, 0), Segment(1, 5, 7, 5)]
        warm_calls = []
        original_forward = policy.forward

        def watch(obs, state, flags, deterministic=False):
            warm_calls.append((torch.is_grad_enabled(), obs.detach().clone()))
            return original_forward(obs, state, flags, deterministic=deterministic)

        with patch.object(policy, 'forward', side_effect=watch):
            b = prepare_batch(policy, buffer, segments, 'cpu')
        self.assertTrue(warm_calls)
        self.assertTrue(all(not enabled for enabled, _ in warm_calls))
        self.assertEqual((b['valid_tokens'], b['padding_tokens'], b['warm_tokens']), (8, 1, 4))
        self.assertEqual(b['mask'].dtype, torch.bool)
        self.assertEqual(b['mask'].tolist(), [True] * 8 + [False])
        self.assertFalse(b['episode_starts'].any())
        for key in ('observations', 'actions', 'values', 'log_probs', 'advantages', 'returns'):
            expected = np.concatenate([getattr(buffer, key)[s.start:s.stop, s.worker] for s in segments])
            np.testing.assert_array_equal(b[key][b['mask']].numpy(), expected)
        for i, s in enumerate(segments):
            fields = [torch.tensor(getattr(buffer, name)[s.warm_start, :, s.worker:s.worker + 1])
                      for name in ('hidden_states_pi', 'cell_states_pi', 'hidden_states_vf', 'cell_states_vf')]
            state = RNNStates(tuple(fields[:2]), tuple(fields[2:]))
            # Independent reference passes the actual reset flag into the LSTM.
            with torch.no_grad():
                for t in range(s.warm_start, s.start):
                    _, _, _, state = original_forward(
                        torch.tensor(buffer.observations[t, s.worker][None]), state,
                        torch.tensor([buffer.episode_starts[t, s.worker]]), deterministic=True)
            if s.warm_start == s.start and buffer.episode_starts[s.start, s.worker]:
                state = RNNStates(tuple(torch.zeros_like(v) for v in state.pi),
                                  tuple(torch.zeros_like(v) for v in state.vf))
            for actual_branch, reference_branch in zip(b['states'], state):
                for actual, reference in zip(actual_branch, reference_branch):
                    self.assertFalse(actual.requires_grad)
                    self.assertIsNone(actual.grad_fn)
                    torch.testing.assert_close(actual[:, i:i + 1], reference, atol=1e-7, rtol=1e-6)
        self.assertTrue(all(p.grad is None for p in policy.parameters()))
        b['observations'].requires_grad_()
        values, log_prob, entropy = policy.evaluate_actions(
            b['observations'], b['actions'], b['states'], b['episode_starts'])
        (values.flatten()[b['mask']].square().mean() - log_prob[b['mask']].mean()
         - .01 * entropy[b['mask']].mean()).backward()
        self.assertGreater(float(b['observations'].grad[b['mask']].abs().sum()), 0)
        self.assertEqual(float(b['observations'].grad[~b['mask']].abs().sum()), 0)
        self.assertTrue(any(p.grad is not None and p.grad.abs().sum() > 0 for p in policy.parameters()))

    def test_actual_train_padding_invariant_loss_gradients_and_parameter_update(self):
        def update(alter_padding):
            model = self.model(active_memory=True)
            buffer = self.populated_buffer(model)
            before = deepcopy(model.policy.state_dict())
            original_prepare = prepare_batch
            padding_seen = []

            def prepare(*args):
                b = original_prepare(*args)
                pad = ~b['mask']
                padding_seen.append(int(pad.sum()))
                if alter_padding:
                    for key, value in (('observations', .9), ('actions', -.8), ('values', 100),
                                       ('log_probs', -10), ('advantages', 10000), ('returns', -10000)):
                        b[key][pad] = value
                return b

            with patch.object(trainer, 'prepare_batch', side_effect=prepare):
                model.train()
            self.assertGreater(sum(padding_seen), 0)
            self.assertTrue(any(not torch.equal(before[k], v) for k, v in model.policy.state_dict().items()))
            self.assertEqual(model.logger.name_to_value['recurrent/learning_tokens'], 16)
            self.assertFalse(buffer.generator_ready)
            return (deepcopy(model.policy.state_dict()),
                    {k: p.grad.clone() for k, p in model.policy.named_parameters() if p.grad is not None},
                    dict(model.logger.name_to_value))

        a, ga, logs_a = update(False)
        b, gb, logs_b = update(True)
        for key in a:
            torch.testing.assert_close(a[key], b[key], rtol=0, atol=0)
        self.assertEqual(ga.keys(), gb.keys())
        for key in ga:
            torch.testing.assert_close(ga[key], gb[key], rtol=0, atol=0)
        self.assertEqual(logs_a, logs_b)

    def test_inherited_real_collection_timeout_uses_outgoing_critic_state(self):
        self.assertIs(FixedContextRecurrentPPO.collect_rollouts, RecurrentPPO.collect_rollouts)
        model = self.model(steps=4, batch_size=8, active_memory=True)
        before = deepcopy(model.policy.state_dict())
        callback = CaptureRollout()
        calls = []
        original = model.policy.predict_values

        def predict(obs, states, starts):
            values = original(obs, states, starts)
            calls.append((obs.detach().clone(), tuple(v.detach().clone() for v in states),
                          starts.detach().clone(), values.detach().clone()))
            return values

        with patch.object(model.policy, 'predict_values', side_effect=predict):
            model.learn(8, callback=callback)
        self.assertEqual(model.num_timesteps, 8)
        self.assertEqual(model._n_updates, 1)
        self.assertTrue(any(not torch.equal(before[k], v) for k, v in model.policy.state_dict().items()))
        terminal_calls = [call for call in calls if len(call[0]) == 1]
        self.assertEqual(len(terminal_calls), 2)  # Only timeout worker, never true terminal.
        for call, step in zip(terminal_calls, (1, 3)):
            obs, states, starts, values = call
            row = callback.steps[step]
            torch.testing.assert_close(obs[0], torch.tensor(row['infos'][0]['terminal_observation']))
            self.assertFalse(np.array_equal(obs[0].numpy(), row['new_obs'][0]))
            self.assertFalse(starts.any())
            self.assertGreater(float(states[0].abs().sum()), 0)
            for actual, outgoing in zip(states, row['lstm_states'].vf):
                torch.testing.assert_close(actual, outgoing[:, :1], rtol=0, atol=0)
            self.assertAlmostEqual(callback.rewards[step, 0], .25 + model.gamma * values.item(), places=6)
            self.assertEqual(callback.rewards[step, 1], .25)
        np.testing.assert_array_equal(callback.episode_starts, [[1, 1], [0, 0], [1, 1], [0, 0]])
        # Identical episodes must produce identical reset-step states despite cached history.
        for a, b in zip(callback.steps[0]['lstm_states'].pi, callback.steps[2]['lstm_states'].pi):
            torch.testing.assert_close(a, b, rtol=0, atol=0)

    def test_unmodified_scratch_residual_initialization_learns_in_two_tiny_rollouts(self):
        model = self.model(steps=4, batch_size=8)
        before = deepcopy(model.policy.state_dict())
        self.assertEqual(int(torch.count_nonzero(model.policy.residual_actor.weight)), 0)
        self.assertEqual(int(torch.count_nonzero(model.policy.residual_critic.weight)), 0)
        # First update opens the zero residual projections; the second can train
        # the underlying recurrent weights. No checkpoint/model loading occurs.
        model.learn(16)
        self.assertEqual(model.num_timesteps, 16)
        self.assertEqual(model._n_updates, 2)
        after = model.policy.state_dict()
        for prefix in ('residual_actor.', 'residual_critic.', 'lstm_actor.', 'lstm_critic.'):
            self.assertTrue(any(not torch.equal(before[k], value)
                                for k, value in after.items() if k.startswith(prefix)), prefix)
        self.assertTrue(all(torch.isfinite(value).all() for value in after.values()))


if __name__ == '__main__':
    unittest.main()
