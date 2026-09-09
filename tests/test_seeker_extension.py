import tempfile
from pathlib import Path
import unittest
import torch
from rl.seeker_scratch import make_model
from rl.seeker_extension import ExtensionRate, load_extension
from stable_baselines3.common.callbacks import BaseCallback


class Rates(BaseCallback):
    def __init__(self):
        super().__init__();self.rates=[]
    def _on_rollout_start(self):
        self.rates.append(self.model.policy.optimizer.param_groups[0]['lr'])
    def _on_step(self):return True


class ExtensionTests(unittest.TestCase):
    def test_global_clock_endpoints(self):
        rate=ExtensionRate(507904,2031616)
        self.assertAlmostEqual(rate(.75),.000015)
        self.assertAlmostEqual(rate(.375),.000009)
        self.assertAlmostEqual(rate(0),.000003)
        self.assertAlmostEqual(rate(1),.000015)

    def test_real_optimizer_continuity_and_rate_no_upward_reset(self):
        torch.set_num_threads(1)
        for name in ('residual_mlp','residual_lstm'):
            with self.subTest(name=name),tempfile.TemporaryDirectory() as tmp:
                model=make_model(name,991,n_steps=32)
                model.learn(512)
                old=model.policy.optimizer.state_dict()
                path=Path(tmp)/'model.zip';model.save(path)
                model.get_env().close()
                resumed,rate,_=load_extension(name,path,1024,992)
                try:
                    self.assertEqual(resumed.num_timesteps,512)
                    self.assertEqual(resumed.seed,992)
                    new=resumed.policy.optimizer.state_dict()
                    self.assertEqual(old['param_groups'],new['param_groups'])
                    for key,values in old['state'].items():
                        for field,value in values.items():
                            torch.testing.assert_close(value,new['state'][key][field],rtol=0,atol=0)
                    cb=Rates()
                    resumed.learn(512,callback=cb,reset_num_timesteps=False)
                    self.assertEqual(resumed.num_timesteps,1024)
                    self.assertAlmostEqual(cb.rates[0],.000015)
                    self.assertAlmostEqual(cb.rates[1],.000009)
                    self.assertAlmostEqual(resumed.policy.optimizer.param_groups[0]['lr'],.000003)
                finally:resumed.get_env().close()

    def test_parent_evaluation_is_not_repeated(self):
        from rl.seeker_scratch import Callback
        callback=Callback(Path('unused'),'residual_lstm',2031616)
        callback.num_timesteps=507904
        callback.last_evaluated=507904
        def unexpected(*args,**kwargs):
            raise AssertionError('Repeated parent evaluation')
        callback.checkpoint=unexpected
        callback._on_rollout_start()


if __name__=='__main__':unittest.main()
