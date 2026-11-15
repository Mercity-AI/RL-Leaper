"""Round 1: copies start as today's brain; scoring switches change only what they say.

    python -m unittest tests.test_round1
"""
import unittest

import numpy as np
import torch
from stable_baselines3.common.vec_env import DummyVecEnv

from rl.moving_target_brain import load_frozen_predictor
from rl.moving_target_env import MovingTargetEnv
from rl.round1_brain import make_round1_copy
from rl.round1_env import HIDDEN_EXTRA_COST, Round1ArenaEnv, YardPractice
from rl.round1_train import F7, RUNS

torch.set_num_threads(1)


class CopyStartsAsToday(unittest.TestCase):
    def test_same_moves_as_today(self):
        today = load_frozen_predictor(lambda: MovingTargetEnv())
        for name in ("F3", "F7", "FUSE"):
            switches = RUNS[name]["switches"]
            env = DummyVecEnv([lambda: Round1ArenaEnv(**switches)])
            model = make_round1_copy(env, RUNS[name]["fusion"], 1_000_000)
            rng = np.random.default_rng(5)
            size = env.observation_space.shape[0]
            state_a = state_b = None
            for step in range(60):
                obs = rng.uniform(-1, 1, (1, size)).astype(np.float32)
                start = np.array([step == 0])
                a, state_a = today.predict(obs[:, :34], state=state_a, episode_start=start, deterministic=True)
                b, state_b = model.predict(obs, state=state_b, episode_start=start, deterministic=True)
                self.assertTrue(np.array_equal(a, b), f"{name} step {step}")
            if RUNS[name]["fusion"]:
                self.assertEqual(sum(p.numel() for p in model.policy.parameters()) - 72517 - 640 * (size - 34),
                                 2 * (128 * 64 + 64 + 64 * 64 + 64))


class Scoring(unittest.TestCase):
    def test_only_the_named_terms_change(self):
        """F7's switches vs run A's rules on the same rounds and moves."""
        shot_wins = hidden_steps = 0
        for seed in range(30000, 30012):
            plain, f7 = Round1ArenaEnv(), Round1ArenaEnv(**F7)
            plain.reset(seed=seed)
            f7.reset(seed=seed)
            rng = np.random.default_rng(seed)
            for _ in range(400):
                action = rng.uniform(-1, 1, 2).astype(np.float32)
                was_visible, had_seen = f7.target_visible, f7.target_ever_seen
                o1, r1, t1, u1, i1 = plain.step(action)
                o2, r2, t2, u2, i2 = f7.step(action)
                self.assertTrue(np.array_equal(o1, o2[:34]))
                self.assertEqual(o2.shape, (38,))
                expected = r1
                seen = had_seen or f7.target_ever_seen
                if seen and not (was_visible and f7.target_visible):
                    expected -= i1["reward_terms"]["progress"]
                if f7.target_ever_seen and not f7.target_visible:
                    expected -= HIDDEN_EXTRA_COST
                    hidden_steps += 1
                if i2["shot_win"]:
                    shot_wins += 1
                    expected += 25.0
                    self.assertTrue(t2)
                self.assertAlmostEqual(r2, expected, places=9)
                if t2 or u2 or t1 or u1:
                    break
        self.assertGreater(hidden_steps, 0)
        self.assertGreater(shot_wins, 0)


class Yard(unittest.TestCase):
    def test_yard_practice_rounds(self):
        env = YardPractice(1, **F7)
        obs, _ = env.reset()
        self.assertEqual(obs.shape, (38,))
        first = env.inner.position.copy()
        for _ in range(20):
            obs, *_ = env.step(np.array([1.0, 0.2], dtype=np.float32))
        self.assertEqual(obs.shape, (38,))
        env.reset()
        self.assertFalse(np.array_equal(first, env.inner.position))


if __name__ == "__main__":
    unittest.main()
