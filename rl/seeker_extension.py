"""Explicit same-run continuation of the paired scratch architecture screen.

Preserves checkpoint optimizer moments; resets environments and explicitly reseeds.
This is not bit-exact process resumption and never loads an ancestral walker.
"""
import argparse
from dataclasses import dataclass
import json
import os
import time
import traceback
import torch
from stable_baselines3 import PPO
from stable_baselines3.common.logger import configure
from stable_baselines3.common.vec_env import DummyVecEnv
from rl.seeker_scratch import CAMPAIGN, Callback, make_env, evaluation_steps
from rl.seeker_runner import dump, digest, snapshot

TOTAL = 2031616


@dataclass(frozen=True)
class ExtensionRate:
    start: int
    total: int
    initial: float = .000015
    final: float = .000003

    def __post_init__(self):
        if not 0 <= self.start < self.total or not 0 < self.final <= self.initial:
            raise ValueError('Invalid extension horizon/rates')

    def __call__(self, remaining):
        fraction = min(1., max(0., remaining / (1-self.start/self.total)))
        return self.final + (self.initial-self.final)*fraction

    def config(self):
        return dict(kind='linear_extension',start=self.start,total=self.total,
                    initial=self.initial,final=self.final,
                    clock='SB3 global progress remaining rescaled to extension horizon')


def load_extension(name, checkpoint, total, seed):
    """Load only an explicitly supplied same-model checkpoint and its optimizer."""
    if name not in ('residual_lstm','residual_mlp'):
        raise ValueError('Only the paired scratch architectures are eligible')
    algorithm=PPO
    if name=='residual_lstm':
        from rl.seeker_recurrent_train import FixedContextRecurrentPPO
        algorithm=FixedContextRecurrentPPO
    env=DummyVecEnv([lambda:make_env(name,True,True) for _ in range(8)])
    model=algorithm.load(checkpoint,env=env,device='cpu',force_reset=True)
    if not model.policy.optimizer.state:
        env.close()
        raise RuntimeError('Continuation must preserve trained optimizer state')
    start=model.num_timesteps
    previous_rates=[g['lr'] for g in model.policy.optimizer.param_groups]
    if len(set(previous_rates))!=1:
        env.close()
        raise RuntimeError('Unexpected mixed optimizer rates')
    schedule=ExtensionRate(start,total,initial=previous_rates[0])
    model.learning_rate=model.lr_schedule=schedule
    model.set_random_seed(seed)
    model.seed=seed
    # SB3's fresh episode flags reset any saved recurrent state on first collection.
    model._last_obs=None
    return model,schedule,previous_rates


def train(name):
    torch.set_num_threads(1)
    source=CAMPAIGN/name
    status=json.loads((source/'status.json').read_text())
    config=json.loads((source/'config.json').read_text())
    if status['status']!='complete' or status['transitions']!=507904:
        raise RuntimeError('Completed 507904-step scratch parent required')
    if config['donor'] is not None or config['initial_timesteps']!=0 or config['initial_optimizer_state_entries']!=0:
        raise RuntimeError('Scratch ancestry evidence missing')
    path=source/'model_507904.zip'
    directory=CAMPAIGN/(name+'_extension_2m')
    if directory.exists():raise FileExistsError(directory)
    seed=config['seed']+1
    model,schedule,rates=load_extension(name,path,TOTAL,seed)
    start=model.num_timesteps
    expected_class='ResidualLstmPolicy' if name=='residual_lstm' else 'ResidualMlpPolicy'
    if start!=507904 or type(model.policy).__name__!=expected_class or any(abs(r-.000015)>1e-12 for r in rates):
        model.get_env().close()
        raise RuntimeError('Parent checkpoint step, architecture or LR mismatch')
    cfg=dict(config,name=directory.name,parent_run=name,parent_checkpoint=str(path),
        parent_sha256=digest(path),continuation=True,origin='FROM_SCRATCH',
        extension_start=start,requested_transitions=TOTAL,
        steps=TOTAL,learning_rate=schedule.initial,
        requested_additional_transitions=TOTAL-start,extension_seed=seed,
        learning_rate_schedule=schedule.config(),
        checkpoints=[s for s in evaluation_steps(TOTAL) if s>start],
        restart_note='Optimizer preserved; new seeded episodes/RNG, not bit-exact process resume',
        pid=os.getpid())
    snapshot(directory,cfg)
    audit=json.loads((source/'hyperparameter_audit.json').read_text())
    audit['learning_rate_schedule']=schedule.config()
    audit['optimizer_defaults']=model.policy.optimizer.defaults
    dump(directory/'hyperparameter_audit.json',audit)
    dump(directory/'continuation_audit.json',dict(parent_sha256=cfg['parent_sha256'],
        timesteps=start,optimizer_state_entries=len(model.policy.optimizer.state),
        optimizer_rates=rates,schedule=schedule.config()))
    model.set_logger(configure(str(directory/'tensorboard'),['csv','tensorboard']))
    try:
        callback=Callback(directory,name,TOTAL)
        callback.last_evaluated=start  # Parent exam already saved; do not duplicate.
        model.learn(TOTAL-start,callback=callback,reset_num_timesteps=False,progress_bar=False)
        summary=callback.checkpoint(final=True)
        dump(directory/'status.json',dict(status='complete',transitions=model.num_timesteps,summary=summary))
    except BaseException:
        model.save(directory/'interrupted_model')
        dump(directory/'status.json',dict(status='failed',transitions=model.num_timesteps,error=traceback.format_exc()))
        raise
    finally:model.get_env().close()


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--name',choices=['residual_lstm','residual_mlp'],required=True)
    train(parser.parse_args().name)
