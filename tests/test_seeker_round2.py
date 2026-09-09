import math
import unittest
import numpy as np
import torch
from stable_baselines3 import PPO
from rl.seeker_round2 import ExperimentEnv, model_for, DONOR


class RoundTwoTests(unittest.TestCase):
    def test_transfer_all_branches(self):
        torch.set_num_threads(1)
        donor=PPO.load(DONOR,device='cpu')
        source=ExperimentEnv()
        obs,_=source.reset(seed=30000)
        inputs=np.stack([obs,obs.copy()])
        inputs[1,2:4]=0
        with torch.no_grad():
            expected=donor.policy.get_distribution(torch.tensor(inputs)).distribution.mean
            values=donor.policy.predict_values(torch.tensor(inputs))
        for flavor in ('continuation','low_entropy','footprint','history','resolved_contact','phase_experts'):
            model=model_for(flavor,17)
            widened=np.zeros((2,model.observation_space.shape[0]),np.float32)
            widened[:,:34]=inputs
            with torch.no_grad():
                actual=model.policy.get_distribution(torch.tensor(widened)).distribution.mean
                actual_v=model.policy.predict_values(torch.tensor(widened))
            torch.testing.assert_close(actual,expected,atol=2e-6,rtol=2e-6)
            torch.testing.assert_close(actual_v,values,atol=2e-6,rtol=2e-6)
            model.get_env().close()
        source.close()

    def test_history_lags_and_reset(self):
        env=ExperimentEnv('history')
        self.addCleanup(env.close)
        obs,_=env.reset(seed=30001)
        np.testing.assert_array_equal(obs[34:],0)
        sequence=[obs[:34].copy()]
        for i in range(1,18):
            obs,*_=env.step([-1,.3])
            for index,lag in enumerate((1,4,16),start=1):
                expected=sequence[i-lag] if i>=lag else np.zeros(34)
                np.testing.assert_array_equal(obs[34*index:34*(index+1)],expected)
            sequence.append(obs[:34].copy())
        obs,_=env.reset(seed=30001)
        np.testing.assert_array_equal(obs[34:],0)

    def test_reward_only_change_has_identical_physics(self):
        a,b=ExperimentEnv(),ExperimentEnv('resolved_contact')
        self.addCleanup(a.close); self.addCleanup(b.close)
        a.reset(seed=30000); b.reset(seed=30000)
        # Fixed body/leg geometry and commands; confirm reward difference exactly
        # tracks successful fallback movements, and termination never changes.
        rng=np.random.default_rng(31)
        refunds=0
        for i in range(500):
            action=rng.uniform(-1,1,2)
            oa,ra,ta,xa,ia=a.step(action)
            ob,rb,tb,xb,ib=b.step(action)
            np.testing.assert_array_equal(oa,ob)
            self.assertEqual((ta,xa),(tb,xb))
            self.assertAlmostEqual(rb-ra,ib['recovery_refund'])
            refunds+=ib['recovery_refund']>0
            if ta or xa:
                a.reset(seed=30000+i); b.reset(seed=30000+i)
        self.assertGreater(refunds,0)

    def test_canonical_evaluation_rewards(self):
        a,b=ExperimentEnv('continuation',False),ExperimentEnv('resolved_contact',False)
        self.addCleanup(a.close); self.addCleanup(b.close)
        a.reset(seed=30000);b.reset(seed=30000)
        for i in range(45):
            oa,ra,ta,xa,_=a.step([1,.2])
            ob,rb,tb,xb,info=b.step([1,.2])
            np.testing.assert_array_equal(oa,ob)
            self.assertEqual(ra,rb)
            self.assertEqual(info['recovery_refund'],0)
            if ta or xa:break


if __name__=='__main__':unittest.main()
