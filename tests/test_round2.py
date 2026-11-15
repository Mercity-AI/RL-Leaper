"""Round 2: R6 shaping, privileged critic branches, hider share.

    python -m unittest tests.test_round2
"""
import glob
import unittest

import numpy as np
import torch
from stable_baselines3.common.vec_env import DummyVecEnv

from rl.round1_env import GAMMA, Round1ArenaEnv, YardPractice
from rl.round1_train import F7, RUNS

torch.set_num_threads(1)


class LookWhereSheWas(unittest.TestCase):
    def test_only_the_look_term_changes_and_it_telescopes(self):
        with_r6 = dict(F7, look_where=True)
        paid_any = False
        for seed in range(30000, 30010):
            base, r6 = Round1ArenaEnv(**F7), Round1ArenaEnv(**with_r6)
            base.reset(seed=seed)
            r6.reset(seed=seed)
            rng = np.random.default_rng(seed)
            discounted, potentials = 0.0, [0.0]
            for t in range(500):
                action = rng.uniform(-1, 1, 2).astype(np.float32)
                o1, rw1, d1, u1, i1 = base.step(action)
                o2, rw2, d2, u2, i2 = r6.step(action)
                self.assertTrue(np.array_equal(o1, o2))
                self.assertAlmostEqual(rw2 - rw1, i2["reward_terms"]["look"], places=9)
                discounted += GAMMA ** t * i2["reward_terms"]["look"]
                potentials.append(r6.look_potential)
                paid_any |= i2["reward_terms"]["look"] != 0.0
                if d2 or u2:
                    break
            # Potential-based: the discounted sum is gamma^T * final potential - first potential.
            self.assertAlmostEqual(discounted, GAMMA ** (t + 1) * potentials[-1] - potentials[0], places=6)
        self.assertTrue(paid_any)


class Privileged(unittest.TestCase):
    def test_branch_actor_ignores_privileged_inputs(self):
        sources = sorted(glob.glob("rl_artifacts/moving_target_round1_20261115/run_F7_try1/model_*.zip"),
                         key=lambda p: int(p.split("_")[-1].split(".")[0]))
        if not sources:
            self.skipTest("no F7 checkpoint yet")
        from rl.round1_brain import load_round1
        from rl.round2_brain import make_branch
        switches = RUNS["F7B1"]["switches"]
        env = DummyVecEnv([lambda: Round1ArenaEnv(**switches)])
        model, steps = make_branch(env, sources[-1], False, True, 2_015_232, 1)
        source = load_round1(sources[-1], lambda: Round1ArenaEnv(**F7))
        self.assertEqual(model.num_timesteps, steps)
        rng = np.random.default_rng(2)
        s_a = s_b = None
        for t in range(40):
            obs = rng.uniform(-1, 1, (1, 42)).astype(np.float32)
            start = np.array([t == 0])
            a, s_a = source.predict(obs[:, :38], state=s_a, episode_start=start, deterministic=True)
            b, s_b = model.predict(obs, state=s_b, episode_start=start, deterministic=True)
            self.assertTrue(np.array_equal(a, b), f"step {t}")
        # No path from the 4 privileged numbers to the action.
        policy = model.policy
        x = torch.tensor(rng.uniform(-1, 1, (5, 42)), dtype=torch.float32, requires_grad=True)
        states = policy.initial_states if hasattr(policy, "initial_states") else None
        from sb3_contrib.common.recurrent.type_aliases import RNNStates
        zeros = (torch.zeros(1, 5, 64), torch.zeros(1, 5, 64))
        latent, _ = policy._actor_latent(x, zeros, torch.zeros(5))
        policy.action_net(latent).sum().backward()
        self.assertTrue(torch.all(x.grad[:, 38:] == 0))
        self.assertTrue(torch.any(x.grad[:, :38] != 0))
        value_latent, _ = policy._critic_latent(x, zeros, torch.zeros(5))
        self.assertEqual(policy.value_net(value_latent).shape, (5, 1))


class HiderShare(unittest.TestCase):
    def test_half_hiders(self):
        env = Round1ArenaEnv(**dict(F7, hider_share=0.5))
        kinds = []
        for seed in range(400):
            _, info = env.reset(seed=seed)
            kinds.append(info["target_kind"] == "hider")
        self.assertAlmostEqual(np.mean(kinds), 0.5, delta=0.08)
        yard = YardPractice(3, **dict(F7, hider_share=0.5, look_where=True, privileged=True))
        obs, info = yard.reset()
        self.assertEqual(obs.shape, (42,))
        for _ in range(30):
            obs, r, d, u, info = yard.step(np.array([1.0, 0.1], dtype=np.float32))
        self.assertIn("look", info["reward_terms"])


if __name__ == "__main__":
    unittest.main()
