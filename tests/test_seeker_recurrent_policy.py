"""Scratch-only sidecar contracts. Synthetic optimizer steps test gradient flow."""
import tempfile
from pathlib import Path
import unittest

from gymnasium import spaces
import numpy as np
import torch
from stable_baselines3.common.policies import ActorCriticPolicy
from sb3_contrib.common.recurrent.type_aliases import RNNStates

from rl.seeker_recurrent_policy import ResidualLstmPolicy, ResidualMlpPolicy, copy_fresh_base

OBS = spaces.Box(-1., 1., (34,), dtype=np.float32)
ACT = spaces.Box(-1., 1., (2,), dtype=np.float32)


def make(cls, seed=17):
    torch.manual_seed(seed)
    return cls(OBS, ACT, lambda _: .001)


def states(workers=3, random=False):
    create = torch.randn if random else torch.zeros
    return RNNStates(tuple(create(1, workers, 64) for _ in range(2)),
                     tuple(create(1, workers, 64) for _ in range(2)))


def activate(policy):
    """Nonzero residuals make reset/sequence tests sensitive to memory wiring."""
    with torch.no_grad():
        if isinstance(policy, ResidualLstmPolicy):
            projections = [policy.residual_actor, policy.residual_critic]
        else:
            projections = [policy.mlp_extractor.residual_actor[-1], policy.mlp_extractor.residual_critic[-1]]
        for layer in projections:
            layer.weight.normal_(0, .15)
            layer.bias.normal_(0, .02)


class ResidualPolicyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        torch.set_num_threads(1)

    def assert_states_close(self, left, right):
        for a, b in zip(left, right):
            for x, y in zip(a, b):
                torch.testing.assert_close(x, y, atol=1e-6, rtol=1e-5)

    def test_scratch_initialization_counts_optimizer_and_zero_baseline(self):
        for cls, count in ((ResidualLstmPolicy, 72517), (ResidualMlpPolicy, 73637)):
            with self.subTest(policy=cls.__name__):
                policy = make(cls)
                reference = make(ActorCriticPolicy)
                other = make(cls, 19)
                self.assertEqual(sum(p.numel() for p in policy.parameters()), count)
                self.assertTrue(all(p.requires_grad for p in policy.parameters()))
                self.assertEqual({id(p) for p in policy.parameters()},
                                 {id(p) for g in policy.optimizer.param_groups for p in g['params']})
                self.assertFalse(torch.equal(policy.action_net.weight, other.action_net.weight))
                for name, value in reference.state_dict().items():
                    torch.testing.assert_close(policy.state_dict()[name], value, atol=0, rtol=0)
                obs = torch.randn(12, 34)
                expected = reference(obs, deterministic=True)
                if cls is ResidualLstmPolicy:
                    result = policy(obs, states(3, True), torch.zeros(12), deterministic=True)
                    self.assertIsNot(policy.lstm_actor, policy.lstm_critic)
                    for projection in (policy.residual_actor, policy.residual_critic):
                        self.assertEqual(torch.count_nonzero(projection.weight).item(), 0)
                        self.assertEqual(torch.count_nonzero(projection.bias).item(), 0)
                else:
                    result = policy(obs, deterministic=True)
                for x, y in zip(result[:3], expected):
                    torch.testing.assert_close(x, y, atol=1e-6, rtol=0)

    def test_all_recurrent_entrypoints_agree_with_active_residual(self):
        policy = make(ResidualLstmPolicy)
        activate(policy)
        obs, initial, starts = torch.randn(15, 34), states(3, True), torch.zeros(15)
        starts[[2, 7]] = 1.
        action, value, log_prob, carried = policy(obs, initial, starts, deterministic=True)
        distribution, actor_state = policy.get_distribution(obs, initial.pi, starts)
        torch.testing.assert_close(distribution.get_actions(deterministic=True), action)
        for a, b in zip(actor_state, carried.pi):
            torch.testing.assert_close(a, b)
        torch.testing.assert_close(policy.predict_values(obs, initial.vf, starts), value)
        values, logs, entropy = policy.evaluate_actions(obs, action, initial, starts)
        torch.testing.assert_close(values, value)
        torch.testing.assert_close(logs, log_prob)
        self.assertTrue(torch.isfinite(entropy).all())

    def test_fresh_base_pairing_preserves_branch_initialization(self):
        baseline = make(ActorCriticPolicy, 12)
        obs = torch.randn(6, 34)
        for cls in (ResidualLstmPolicy, ResidualMlpPolicy):
            policy = make(cls, 98)
            branches = {k: v.clone() for k, v in policy.state_dict().items()
                        if 'residual_' in k or k.startswith('lstm_')}
            copy_fresh_base(baseline, policy)
            for name, value in branches.items():
                torch.testing.assert_close(policy.state_dict()[name], value, atol=0, rtol=0)
            expected = baseline(obs, deterministic=True)
            actual = (policy(obs, states(3), torch.zeros(6), deterministic=True)
                      if cls is ResidualLstmPolicy else policy(obs, deterministic=True))
            for a, b in zip(actual[:3], expected):
                torch.testing.assert_close(a, b, atol=1e-6, rtol=0)

    def test_per_worker_reset_both_h_c_and_independent_critic(self):
        policy = make(ResidualLstmPolicy)
        activate(policy)
        obs, initial = torch.randn(3, 34), states(3, True)
        reset = policy(obs, initial, torch.tensor([1., 0., 0.]), deterministic=True)
        fresh = policy(obs, states(3), torch.zeros(3), deterministic=True)
        carry = policy(obs, initial, torch.zeros(3), deterministic=True)
        for index in (0, 1):
            torch.testing.assert_close(reset[index][0], fresh[index][0])
            torch.testing.assert_close(reset[index][1:], carry[index][1:])
        for branch in (0, 1):
            for component in (0, 1):
                torch.testing.assert_close(reset[3][branch][component][:, 0], fresh[3][branch][component][:, 0])
                torch.testing.assert_close(reset[3][branch][component][:, 1:], carry[3][branch][component][:, 1:])
        self.assertGreater((carry[1] - fresh[1]).abs().max().item(), 1e-5)
        changed = policy(obs, RNNStates(initial.pi, states(3, True).vf), torch.zeros(3), deterministic=True)
        torch.testing.assert_close(changed[0], carry[0])
        self.assertGreater((changed[1] - carry[1]).abs().max().item(), 1e-5)

    def test_sequence_matches_steps_and_split_context(self):
        policy = make(ResidualLstmPolicy)
        activate(policy)
        workers, length = 3, 9
        obs = torch.randn(workers, length, 34)
        starts = torch.zeros(workers, length)
        starts[0, 4] = starts[1, 6] = 1.
        initial = states(workers, True)
        full = policy(obs.reshape(-1, 34), initial, starts.flatten(), deterministic=True)
        carried, actions, values = initial, [], []
        for t in range(length):
            a, v, _, carried = policy(obs[:, t], carried, starts[:, t], deterministic=True)
            actions.append(a)
            values.append(v)
        torch.testing.assert_close(full[0], torch.stack(actions, 1).reshape(-1, 2), atol=1e-6, rtol=1e-5)
        torch.testing.assert_close(full[1], torch.stack(values, 1).reshape(-1, 1), atol=1e-6, rtol=1e-5)
        self.assert_states_close(full[3], carried)
        # Parent's burn-in may run without grad, detach, then learn a suffix.
        with torch.no_grad():
            prefix = policy(obs[:, :3].reshape(-1, 34), initial, starts[:, :3].flatten(), deterministic=True)
        suffix = policy(obs[:, 3:].reshape(-1, 34), prefix[3], starts[:, 3:].flatten(), deterministic=True)
        torch.testing.assert_close(suffix[0], full[0].reshape(workers, length, 2)[:, 3:].reshape(-1, 2), atol=1e-6, rtol=1e-5)
        self.assert_states_close(suffix[3], full[3])

    def test_gradients_reach_branch_after_zero_projection_learns(self):
        for cls in (ResidualLstmPolicy, ResidualMlpPolicy):
            with self.subTest(policy=cls.__name__):
                policy = make(cls)
                obs, target = torch.randn(24, 34), torch.randn(24, 2)
                if cls is ResidualLstmPolicy:
                    upstream = [policy.lstm_actor.weight_ih_l0, policy.lstm_critic.weight_ih_l0]
                    projections = [policy.residual_actor.weight, policy.residual_critic.weight]
                else:
                    upstream = [policy.mlp_extractor.residual_actor[0].weight, policy.mlp_extractor.residual_critic[0].weight]
                    projections = [policy.mlp_extractor.residual_actor[-1].weight, policy.mlp_extractor.residual_critic[-1].weight]
                for step in range(2):
                    policy.optimizer.zero_grad()
                    result = (policy(obs, states(3), torch.zeros(24), deterministic=True)
                              if cls is ResidualLstmPolicy else policy(obs, deterministic=True))
                    loss = (result[0] - target).square().mean() + (result[1] - .7).square().mean()
                    loss.backward()
                    for projection in projections:
                        self.assertGreater(projection.grad.abs().sum().item(), 0.)
                    for weight in upstream:
                        gradient = weight.grad.abs().sum().item()
                        self.assertEqual(gradient, 0.) if step == 0 else self.assertGreater(gradient, 0.)
                    policy.optimizer.step()

    def test_policy_save_load_predict_state_carry(self):
        for cls in (ResidualLstmPolicy, ResidualMlpPolicy):
            with self.subTest(policy=cls.__name__), tempfile.TemporaryDirectory() as directory:
                policy = make(cls)
                activate(policy)
                obs = np.random.default_rng(6).normal(size=(3, 34)).astype(np.float32)
                _, carried = policy.predict(obs, deterministic=True)
                path = str(Path(directory) / 'policy.pt')
                policy.save(path)
                restored = cls.load(path, device='cpu')
                expected = policy.predict(obs, state=carried, episode_start=np.array([True, False, False]), deterministic=True)
                actual = restored.predict(obs, state=carried, episode_start=np.array([True, False, False]), deterministic=True)
                np.testing.assert_allclose(actual[0], expected[0], atol=1e-7)
                if cls is ResidualLstmPolicy:
                    for a, b in zip(actual[1], expected[1]):
                        np.testing.assert_array_equal(a, b)
                for name, weight in policy.state_dict().items():
                    torch.testing.assert_close(restored.state_dict()[name], weight, atol=0, rtol=0)

    def test_recurrentppo_construct_save_load_without_learning(self):
        from sb3_contrib import RecurrentPPO
        from rl.seeker_env import SeekerEnv
        env = SeekerEnv()
        self.addCleanup(env.close)
        model = RecurrentPPO(ResidualLstmPolicy, env, n_steps=8, batch_size=8, seed=71, device='cpu')
        self.assertEqual(model.num_timesteps, 0)
        obs, _ = env.reset(seed=30000)
        with tempfile.TemporaryDirectory() as directory:
            path = str(Path(directory) / 'model.zip')
            model.save(path)
            loaded = RecurrentPPO.load(path, device='cpu')
            a, state = model.predict(obs, deterministic=True)
            b, restored = loaded.predict(obs, deterministic=True)
            np.testing.assert_array_equal(a, b)
            for x, y in zip(state, restored):
                np.testing.assert_array_equal(x, y)

    def test_rejects_unplanned_architecture(self):
        for cls in (ResidualLstmPolicy, ResidualMlpPolicy):
            with self.assertRaises(ValueError):
                cls(spaces.Box(-1., 1., (36,), dtype=np.float32), ACT, lambda _: .001)
            with self.assertRaises(ValueError):
                cls(OBS, ACT, lambda _: .001, net_arch=[128, 128])
        with self.assertRaises(ValueError):
            ResidualLstmPolicy(OBS, ACT, lambda _: .001, shared_lstm=True)


if __name__ == '__main__':
    unittest.main()
