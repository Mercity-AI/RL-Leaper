"""PPO_33 / Phase 1B warm-transfer equivalence: widening PPO_29 (26 in) to 31 inputs.

A freshly widened 31-input model must reproduce the PPO_29 donor's deterministic
actions and value predictions when the 5 appended frontier-note inputs are zero, so
the fine-tune starts exactly where PPO_29 left off.
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
        cls._saved_flag = LeaperReachEnv.FRONTIER_NOTE
        cls._saved_throttle = LeaperReachEnv.NORMALIZED_THROTTLE
        LeaperReachEnv.NORMALIZED_THROTTLE = True

        cls.donor = PPO.load(DONOR, device="cpu")

        LeaperReachEnv.FRONTIER_NOTE = True
        env = DummyVecEnv([lambda: LeaperReachEnv()])
        cls.model = PPO(
            "MlpPolicy", env, policy_kwargs=dict(net_arch=[64, 64]), device="cpu"
        )
        widened = widen_policy_state_dict(
            cls.donor.policy.state_dict(), cls.model.policy.state_dict()
        )
        cls.model.policy.load_state_dict(widened, strict=True)

    @classmethod
    def tearDownClass(cls):
        LeaperReachEnv.FRONTIER_NOTE = cls._saved_flag
        LeaperReachEnv.NORMALIZED_THROTTLE = cls._saved_throttle

    def test_five_new_columns_are_zero(self):
        for net in ("policy_net", "value_net"):
            weight = self.model.policy.state_dict()[
                f"mlp_extractor.{net}.0.weight"
            ].cpu().numpy()
            self.assertEqual(weight.shape[1], 31)
            np.testing.assert_array_equal(weight[:, 26:], 0.0)

    def test_actions_match_donor_on_1000_observations(self):
        rng = np.random.default_rng(3300)
        obs26 = rng.uniform(-1.0, 1.0, size=(1000, 26)).astype(np.float32)
        obs31 = np.concatenate([obs26, np.zeros((1000, 5), dtype=np.float32)], axis=1)
        donor_actions, _ = self.donor.predict(obs26, deterministic=True)
        widened_actions, _ = self.model.predict(obs31, deterministic=True)
        np.testing.assert_allclose(widened_actions, donor_actions, atol=1e-5, rtol=0)

    def test_value_predictions_match_donor(self):
        torch = self.torch
        rng = np.random.default_rng(4300)
        obs26 = rng.uniform(-1.0, 1.0, size=(256, 26)).astype(np.float32)
        obs31 = np.concatenate([obs26, np.zeros((256, 5), dtype=np.float32)], axis=1)
        with torch.no_grad():
            donor_values = self.donor.policy.predict_values(torch.as_tensor(obs26)).cpu().numpy()
            widened_values = self.model.policy.predict_values(torch.as_tensor(obs31)).cpu().numpy()
        np.testing.assert_allclose(widened_values, donor_values, atol=1e-5, rtol=0)


if __name__ == "__main__":
    unittest.main()
