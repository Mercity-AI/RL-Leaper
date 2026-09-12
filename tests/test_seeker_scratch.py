import unittest
from unittest.mock import patch
import torch
from rl.seeker_scratch import make_model,make_env


class ScratchTests(unittest.TestCase):
    def test_no_checkpoint_load_fresh_optimizer_and_matched_reward_controls(self):
        torch.set_num_threads(1)
        with patch('stable_baselines3.PPO.load',side_effect=AssertionError('Scratch must never load a checkpoint')):
            a=make_model('original_mlp',123)
            b=make_model('removal_mlp',123)
        self.addCleanup(a.get_env().close);self.addCleanup(b.get_env().close)
        self.assertEqual(a.num_timesteps,0);self.assertEqual(b.num_timesteps,0)
        self.assertEqual(len(a.policy.optimizer.state),0)
        for k,v in a.policy.state_dict().items():
            torch.testing.assert_close(v,b.policy.state_dict()[k],atol=0,rtol=0)

    def test_seed_changes_fresh_weights(self):
        a=make_model('removal_mlp',123);b=make_model('removal_mlp',124)
        self.addCleanup(a.get_env().close);self.addCleanup(b.get_env().close)
        self.assertFalse(torch.equal(a.policy.mlp_extractor.policy_net[0].weight,b.policy.mlp_extractor.policy_net[0].weight))

    def test_residual_architectures_are_scratch_and_share_fresh_base(self):
        torch.set_num_threads(1)
        with patch('stable_baselines3.PPO.load',side_effect=AssertionError('No pretrained checkpoint')):
            base=make_model('removal_mlp',123)
            recurrent=make_model('residual_lstm',123)
            capacity=make_model('residual_mlp',123)
        for model in (base,recurrent,capacity):
            self.addCleanup(model.get_env().close)
            self.assertEqual(model.num_timesteps,0)
            self.assertFalse(model.policy.optimizer.state)
        obs=torch.randn(8,34)
        with torch.no_grad():
            a,v,_=base.policy(obs,deterministic=True)
            ar,vr,_,_=recurrent.policy(obs,recurrent._last_lstm_states,torch.ones(8),deterministic=True)
            am,vm,_=capacity.policy(obs,deterministic=True)
        torch.testing.assert_close(a,ar,rtol=0,atol=0)
        torch.testing.assert_close(a,am,rtol=0,atol=0)
        torch.testing.assert_close(v,vr,rtol=0,atol=0)
        torch.testing.assert_close(v,vm,rtol=0,atol=0)


if __name__=='__main__':unittest.main()
