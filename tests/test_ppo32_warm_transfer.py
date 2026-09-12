"""PPO_32 warm-transfer equivalence: widening PPO_29 (26 in) into 42 inputs.

A freshly widened 42-input model must reproduce the PPO_29 donor's deterministic
actions (and value predictions) when the 16 appended cleared-map inputs are zero.
This is the guarantee that the transfer copied the legacy columns correctly and
zeroed the new ones -- the training run then starts exactly where PPO_29 left off
and only has to learn what to do with the new map channels.
"""

import unittest
from pathlib import Path

import numpy as np

from rl_environment import LeaperReachEnv

ROOT = Path(__file__).resolve().parent.parent
DONOR = ROOT / "rl_artifacts" / "ppo_29_normalized_throttle_250k" / "leaper_ppo.zip"


@unittest.skipUnless(DONOR.exists(), f"PPO_29 donor not found at {DONOR}")
class WarmTransferEquivalenceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import torch
        from stable_baselines3 import PPO
        from stable_baselines3.common.vec_env import DummyVecEnv

        from train_rl import widen_policy_state_dict

        cls.torch = torch
        cls._saved_flag = LeaperReachEnv.COVERAGE_MAP
        cls._saved_throttle = LeaperReachEnv.NORMALIZED_THROTTLE
        LeaperReachEnv.NORMALIZED_THROTTLE = True  # donor is a normalized-throttle model

        cls.donor = PPO.load(DONOR, device="cpu")

        LeaperReachEnv.COVERAGE_MAP = True
        env = DummyVecEnv([lambda: LeaperReachEnv()])
        cls.model = PPO(
            "MlpPolicy",
            env,
            policy_kwargs=dict(net_arch=[64, 64]),
            device="cpu",
        )
        widened = widen_policy_state_dict(
            cls.donor.policy.state_dict(), cls.model.policy.state_dict()
        )
        cls.model.policy.load_state_dict(widened, strict=True)

    @classmethod
    def tearDownClass(cls):
        LeaperReachEnv.COVERAGE_MAP = cls._saved_flag
        LeaperReachEnv.NORMALIZED_THROTTLE = cls._saved_throttle

    def test_new_first_layer_columns_are_zero(self):
        for net in ("policy_net", "value_net"):
            weight = self.model.policy.state_dict()[
                f"mlp_extractor.{net}.0.weight"
            ].cpu().numpy()
            self.assertEqual(weight.shape[1], 42)
            np.testing.assert_array_equal(weight[:, 26:], 0.0)

    def test_actions_match_donor_on_1000_observations(self):
        rng = np.random.default_rng(2032)
        observations26 = rng.uniform(-1.0, 1.0, size=(1000, 26)).astype(np.float32)
        observations42 = np.concatenate(
            [observations26, np.zeros((1000, 16), dtype=np.float32)], axis=1
        )
        donor_actions, _ = self.donor.predict(observations26, deterministic=True)
        widened_actions, _ = self.model.predict(observations42, deterministic=True)
        np.testing.assert_allclose(widened_actions, donor_actions, atol=1e-5, rtol=0)

    def test_value_predictions_match_donor(self):
        torch = self.torch
        rng = np.random.default_rng(777)
        observations26 = rng.uniform(-1.0, 1.0, size=(256, 26)).astype(np.float32)
        observations42 = np.concatenate(
            [observations26, np.zeros((256, 16), dtype=np.float32)], axis=1
        )
        with torch.no_grad():
            donor_values = self.donor.policy.predict_values(
                torch.as_tensor(observations26)
            ).cpu().numpy()
            widened_values = self.model.policy.predict_values(
                torch.as_tensor(observations42)
            ).cpu().numpy()
        np.testing.assert_allclose(widened_values, donor_values, atol=1e-5, rtol=0)


if __name__ == "__main__":
    unittest.main()
