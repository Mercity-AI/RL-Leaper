import pickle
import unittest
import torch
from stable_baselines3.common.callbacks import BaseCallback
from rl.seeker_schedules import LinearLearningRate
from rl.seeker_scratch import make_model


class Rates(BaseCallback):
    def __init__(self):
        super().__init__();self.rates=[]

    def _on_rollout_start(self):
        self.rates.append(self.model.policy.optimizer.param_groups[0]['lr'])

    def _on_step(self):return True


class ScheduleTests(unittest.TestCase):
    def test_endpoints_monotonicity_clamping_and_serialization(self):
        schedule=pickle.loads(pickle.dumps(LinearLearningRate()))
        self.assertAlmostEqual(schedule(1),.00015)
        self.assertAlmostEqual(schedule(.5),.0000825)
        self.assertAlmostEqual(schedule(0),.000015)
        self.assertEqual(schedule(-1),schedule(0))
        self.assertEqual(schedule(2),schedule(1))
        values=[schedule(p/100) for p in range(100,-1,-1)]
        self.assertTrue(all(a>=b for a,b in zip(values,values[1:])))

    def test_real_mlp_and_lstm_optimizers_follow_schedule(self):
        torch.set_num_threads(1)
        for name in ('removal_mlp','residual_lstm'):
            with self.subTest(name=name):
                model=make_model(name,761,n_steps=32,n_envs=8)
                try:
                    callback=Rates()
                    model.learn(512,callback=callback)
                    self.assertEqual(len(callback.rates),2)
                    self.assertAlmostEqual(callback.rates[0],.00015)
                    self.assertAlmostEqual(callback.rates[1],.0000825)
                    for group in model.policy.optimizer.param_groups:
                        self.assertAlmostEqual(group['lr'],.000015)
                    self.assertAlmostEqual(model.logger.name_to_value['train/learning_rate'],.000015)
                finally:model.get_env().close()


if __name__=='__main__':unittest.main()
