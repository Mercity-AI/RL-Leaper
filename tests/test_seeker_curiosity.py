"""ICM scientific contracts, independent of the runner and environment."""

import tempfile
from pathlib import Path
import unittest

import numpy as np
import torch

from rl.seeker_curiosity import Curiosity, CuriosityBonus, FEATURE_INDICES


def transitions(n=513):
    rng = np.random.default_rng(83)
    return (rng.uniform(-1, 1, (n, 34)).astype(np.float32),
            rng.uniform(-1, 1, (n, 2)).astype(np.float32),
            rng.uniform(-1, 1, (n, 34)).astype(np.float32))


class CuriosityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.old_threads = torch.get_num_threads()
        torch.set_num_threads(1)

    @classmethod
    def tearDownClass(cls):
        torch.set_num_threads(cls.old_threads)

    def test_exact_architecture_and_error_mse(self):
        model = Curiosity(seed=13)
        self.assertEqual(model.parameter_count, 11906)
        obs, actions, following = transitions(5)
        np.testing.assert_array_equal(model.features(obs).numpy(), obs[:, FEATURE_INDICES])
        with torch.no_grad():
            phi = model.encoder(model.features(obs))
            next_phi = model.encoder(model.features(following))
            prediction = model.forward_model(torch.cat((phi, torch.from_numpy(actions)), 1))
            expected = (prediction - next_phi).square().mean(1).numpy()
        actual = model.errors(obs, actions, following)
        self.assertEqual(actual.shape, (5,))
        np.testing.assert_array_equal(actual, expected)
        self.assertEqual(model.error_count, 0)

    def test_excluded_channels_cannot_leak_into_errors_or_learning(self):
        data = transitions()
        altered = [x.copy() for x in data]
        excluded = sorted(set(range(34)) - set(FEATURE_INDICES))
        # Includes target, previous collision/actions, frontier and odometry.
        altered[0][:, excluded] = np.nan
        altered[2][:, excluded] = 100000
        a, b = Curiosity(seed=7), Curiosity(seed=7)
        np.testing.assert_array_equal(a.errors(*data), b.errors(*altered))
        self.assertEqual(a.update(*data), b.update(*altered))
        for p, q in zip(a.parameters(), b.parameters()):
            torch.testing.assert_close(p, q, rtol=0, atol=0)

    def test_selected_sensors_and_executed_actions_affect_errors(self):
        model = Curiosity(seed=7)
        obs, actions, following = transitions(4)
        baseline = model.errors(obs, actions, following)
        changed = following.copy()
        changed[:, FEATURE_INDICES] = 0
        self.assertFalse(np.array_equal(baseline, model.errors(obs, actions, changed)))
        self.assertFalse(np.array_equal(baseline, model.errors(obs, -actions, following)))

    def test_zero_coefficient_module_does_not_perturb_policy_rng_or_update(self):
        data = transitions()

        def policy_step(with_icm):
            with torch.random.fork_rng(devices=[]):
                torch.random.default_generator.manual_seed(99)
                policy = torch.nn.Linear(34, 2)
                optimizer = torch.optim.Adam(policy.parameters(), lr=1e-3)
                if with_icm:
                    model = Curiosity(seed=4)
                    model.update(*data)
                means = policy(torch.from_numpy(data[0]))
                samples = means + torch.randn_like(means)
                reward = np.ones(len(data[0]))
                if with_icm:
                    bonus = CuriosityBonus(len(reward), coefficient=0)
                    reward += bonus.pay(model.errors(*data), model.rms,
                                        next_discovered=np.zeros(len(reward), bool),
                                        true_terminal=np.zeros(len(reward), bool),
                                        valid_transition=np.ones(len(reward), bool),
                                        dones=np.zeros(len(reward), bool))
                optimizer.zero_grad()
                (samples.square().mean(1) * torch.from_numpy(reward)).mean().backward()
                optimizer.step()
                return samples.detach(), [p.detach().clone() for p in policy.parameters()]

        expected, expected_params = policy_step(False)
        actual, actual_params = policy_step(True)
        torch.testing.assert_close(actual, expected, rtol=0, atol=0)
        for p, q in zip(actual_params, expected_params):
            torch.testing.assert_close(p, q, rtol=0, atol=0)
        before = np.random.get_state()
        Curiosity(seed=9).update(*data)
        after = np.random.get_state()
        self.assertEqual(before[0], after[0])
        np.testing.assert_array_equal(before[1], after[1])
        self.assertEqual(before[2:], after[2:])

    def test_update_finite_clipped_gradients_and_no_caller_gradient(self):
        model = Curiosity(seed=5)
        data = [torch.tensor(x, requires_grad=True) for x in transitions()]
        old = [p.detach().clone() for p in model.parameters()]
        raw = model.errors(*data)
        saved = raw.copy()
        metrics = model.update(*data)
        self.assertEqual(metrics['samples'], 513)
        self.assertEqual(metrics['batches'], 3)
        self.assertTrue(all(np.isfinite(v) for v in metrics.values()))
        self.assertAlmostEqual(metrics['loss'], .8 * metrics['inverse_loss'] + .2 * metrics['forward_loss'], places=6)
        self.assertGreater(metrics['feature_variance'], 0)
        self.assertTrue(all(x.grad is None for x in data))
        grads = [p.grad for p in model.parameters()]
        self.assertTrue(all(g is not None and torch.isfinite(g).all() for g in grads))
        self.assertLessEqual(float(torch.stack([g.norm() for g in grads]).norm()), .50001)
        for branch in (model.encoder, model.inverse, model.forward_model):
            self.assertGreater(sum(float(p.grad.abs().sum()) for p in branch.parameters()), 0)
        self.assertTrue(any(not torch.equal(p, q) for p, q in zip(old, model.parameters())))
        np.testing.assert_array_equal(raw, saved)
        self.assertEqual(model.error_count, 0)

    def test_forward_target_detached_inverse_still_trains_next_encoder(self):
        model = Curiosity(seed=3)
        obs, actions, following = transitions(5)
        current, actions, following = model._inputs(obs, actions, following)
        current.requires_grad_()
        following.requires_grad_()
        inverse, forward = model._losses(current, actions, following)
        forward.backward(retain_graph=True)
        self.assertIsNone(following.grad)
        self.assertGreater(float(current.grad.abs().sum()), 0)
        inverse.backward()
        self.assertGreater(float(following.grad.abs().sum()), 0)

    def test_calibration_and_rollout_statistics_use_prior_uncentered_rms(self):
        model = Curiosity()
        data = transitions(8)
        before = [p.detach().clone() for p in model.parameters()]
        model.update_rms(np.full(24576, 2.0))
        self.assertEqual(model.rms, 2.0)  # Centered std would be zero.
        self.assertEqual(model.error_count, 24576)
        model.errors(*data)
        budget = CuriosityBonus(1)
        paid = budget.pay([1], model.rms, next_discovered=[False], true_terminal=[False],
                          valid_transition=[True], dones=[False])
        self.assertEqual(paid[0], .005)
        self.assertEqual(model.rms, 2)
        model.update_rms([4, 0])
        self.assertAlmostEqual(model.rms, np.sqrt((24576 * 4 + 16) / 24578))
        for p, q in zip(before, model.parameters()):
            torch.testing.assert_close(p, q, rtol=0, atol=0)
        self.assertEqual(len(model.optimizer.state), 0)

    def test_checkpoint_exact_continuation_includes_optimizer_shuffle_and_stats(self):
        model = Curiosity(seed=35)
        data = transitions()
        model.update_statistics(model.errors(*data))
        model.update(*data)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'icm.pt'
            model.save(path)
            restored = Curiosity.load(path)
        self.assertEqual(model.rms, restored.rms)
        self.assertEqual(model.error_count, restored.error_count)
        self.assertEqual(model.rng.bit_generator.state, restored.rng.bit_generator.state)
        self.assertEqual(model.update(*data), restored.update(*data))
        for p, q in zip(model.parameters(), restored.parameters()):
            torch.testing.assert_close(p, q, rtol=0, atol=0)
        np.testing.assert_array_equal(model.errors(*data), restored.errors(*data))

    def test_empty_batch_and_invalid_input(self):
        model = Curiosity()
        self.assertEqual(model.errors(*transitions(0)).shape, (0,))
        self.assertEqual(model.update(*transitions(0))['batches'], 0)
        obs, actions, following = transitions(2)
        with self.assertRaises(ValueError):
            model.errors(obs, actions * 100, following)
        with self.assertRaises(ValueError):
            model.errors(obs[:, :18], actions, following)
        with self.assertRaises(ValueError):
            model.errors(obs, actions[:1], following)
        with self.assertRaises(ValueError):
            model.update_statistics([float('nan')])


class BonusTests(unittest.TestCase):
    def pay(self, budget, errors=None, **overrides):
        n = len(budget.remaining)
        arguments = dict(next_discovered=np.zeros(n, bool), true_terminal=np.zeros(n, bool),
                         valid_transition=np.ones(n, bool), dones=np.zeros(n, bool))
        arguments.update(overrides)
        return budget.pay(np.ones(n) if errors is None else errors, 1., **arguments)

    def test_zero_coefficient_and_zero_errors_pay_nothing(self):
        zero = CuriosityBonus(3, coefficient=0)
        np.testing.assert_array_equal(self.pay(zero), 0)
        np.testing.assert_array_equal(zero.remaining, 1)
        budget = CuriosityBonus(3)
        np.testing.assert_array_equal(self.pay(budget, [0, 0, 0]), 0)
        np.testing.assert_array_equal(budget.remaining, 1)

    def test_cap_gates_and_independent_resets(self):
        budget = CuriosityBonus(4)
        paid = np.zeros(4)
        for _ in range(110):
            paid += self.pay(budget, next_discovered=[False, True, False, False],
                             true_terminal=[False, False, True, False],
                             valid_transition=[True, True, True, False])
        np.testing.assert_allclose(paid, [1, 0, 0, 0], atol=1e-15)
        np.testing.assert_allclose(budget.remaining, [0, 1, 1, 1])
        budget.reset([True, False, False, False])
        np.testing.assert_array_equal(budget.remaining, 1)

    def test_terminal_autoreset_uses_outgoing_budget_then_resets_only_done_workers(self):
        budget = CuriosityBonus(3)
        budget.remaining[:] = [.003, .4, .2]
        # Worker 0 times out: last within-episode transition earns only .003.
        # Worker 1 discovers on terminal step: next episode must not leak in.
        paid = self.pay(budget, dones=[True, True, False], next_discovered=[False, True, False])
        np.testing.assert_allclose(paid, [.003, 0, .01])
        np.testing.assert_allclose(budget.remaining, [1, 1, .19])
        paid = self.pay(budget, valid_transition=[False, False, True])
        np.testing.assert_allclose(paid, [0, 0, .01])
        np.testing.assert_allclose(budget.remaining, [1, 1, .18])

    def test_checkpoint_budgets_and_floor(self):
        budget = CuriosityBonus(2)
        paid = budget.pay([0, 1e-7], 0, next_discovered=[False, False],
                          true_terminal=[False, False], valid_transition=[True, True], dones=[False, False])
        np.testing.assert_allclose(paid, [0, .001])
        restored = CuriosityBonus(2)
        restored.load_checkpoint_state(budget.checkpoint_state())
        np.testing.assert_array_equal(self.pay(budget), self.pay(restored))
        np.testing.assert_array_equal(budget.remaining, restored.remaining)


if __name__ == '__main__':
    unittest.main()
