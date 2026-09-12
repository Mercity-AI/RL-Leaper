"""Second, failure-directed static-target screen; isolated from deployed physics."""
import argparse
from collections import deque
from copy import deepcopy
import json
import math
from pathlib import Path
import secrets
import sys
import time
import traceback

import gymnasium as gym
import numpy as np
import torch
from torch import nn
from stable_baselines3 import PPO
from stable_baselines3.common.policies import ActorCriticPolicy
from stable_baselines3.common.vec_env import DummyVecEnv
from stable_baselines3.common.logger import configure

from rl.seeker_env import SeekerEnv
from rl.seeker_clearance import FootprintSeekerEnv
from rl.seeker_metrics import EpisodeMetrics, evaluate
from rl import seeker_runner as base
from train_rl import widen_policy_state_dict

ROOT = base.ROOT
CAMPAIGN = ROOT / 'rl_artifacts/seeker_round2_20260909'
DONOR = ROOT / 'rl_artifacts/seeker_20260909/removal_250k/model_253952.zip'
DEV = list(range(30000,30200))
CONFIRM = list(range(120000,121000))
SPECS = {
    'continuation': dict(hypothesis='More optimization of the confirmed reward-removal policy improves recovery.'),
    'low_entropy': dict(ent_coef=.001, hypothesis='Less action noise during refinement improves deterministic contact recovery.'),
    'footprint': dict(hypothesis='Whole-footprint proximity plus the improved reward helps avoid contact without the old visitation incentives.'),
    'history': dict(hypothesis='Current observation and history at 1, 4, 16 steps distinguish repeated failed actions and motion dynamics.'),
    'resolved_contact': dict(hypothesis='Do not charge the ordinary collision fine when fallback movement or rotation succeeds; retain terminal penalties.'),
    'phase_experts': dict(hypothesis='Separate search and pursuit actor/critic branches reduce interference between the two tasks.'),
}


class ExperimentEnv(gym.Wrapper):
    def __init__(self, flavor='continuation', training=True, metrics=False):
        constructor = FootprintSeekerEnv if flavor == 'footprint' else SeekerEnv
        super().__init__(constructor('removal' if training else 'control'))
        self.flavor, self.training = flavor, training
        self.metrics = EpisodeMetrics() if metrics else None
        self.history = deque(maxlen=16)
        if flavor == 'history':
            self.observation_space = gym.spaces.Box(-1,1,(136,),dtype=np.float32)

    def observation(self, obs):
        if self.flavor != 'history':
            return obs
        parts = [obs]
        for lag in (1,4,16):
            parts.append(self.history[-lag] if len(self.history)>=lag else np.zeros_like(obs))
        self.history.append(obs.copy())
        return np.concatenate(parts)

    def reset(self, **kwargs):
        self.history.clear()
        self.refund_total = 0.
        self.refund_steps = 0
        obs, info = self.env.reset(**kwargs)
        obs = self.observation(obs)
        if self.metrics:
            self.metrics.reset(self, obs, info)
        return obs, info

    def step(self, action):
        pos, yaw = self.unwrapped.position.copy(), self.unwrapped.yaw
        obs, reward, term, trunc, info = self.env.step(action)
        moved = float(np.linalg.norm(self.unwrapped.position-pos))
        turned = abs((self.unwrapped.yaw-yaw+math.pi)%(2*math.pi)-math.pi)
        refund = 0.
        if self.training and self.flavor == 'resolved_contact':
            if self.unwrapped.last_collision and (moved>1e-3 or turned>1e-3):
                refund = self.unwrapped.COLLISION_PENALTY
                reward += refund
                info['reward_terms']['collision'] += refund
        info['recovery_refund'] = refund
        self.refund_total += refund
        self.refund_steps += int(refund > 0)
        info['extrinsic_reward'] = reward
        obs = self.observation(obs)
        if self.metrics:
            row = self.metrics.step(self, action, reward, term, trunc, info)
            if row is not None:
                row['recovery_refund_total'] = self.refund_total
                row['recovery_refund_steps'] = self.refund_steps
                info['research_episode'] = row
        return obs, reward, term, trunc, info


class PhaseExtractor(nn.Module):
    def __init__(self, width):
        super().__init__()
        def branch():
            return nn.Sequential(nn.Linear(width,64),nn.Tanh(),nn.Linear(64,64),nn.Tanh())
        self.policy_net, self.value_net = branch(), branch()
        self.pursuit_policy, self.pursuit_value = branch(), branch()
        self.latent_dim_pi = self.latent_dim_vf = 64

    def gate(self, x):
        # The existing remembered target direction is zero until first detection.
        return (x[:,2:4].square().sum(dim=1,keepdim=True)>0).to(x.dtype)

    def forward_actor(self,x):
        g = self.gate(x)
        return (1-g)*self.policy_net(x)+g*self.pursuit_policy(x)

    def forward_critic(self,x):
        g = self.gate(x)
        return (1-g)*self.value_net(x)+g*self.pursuit_value(x)

    def forward(self,x):
        return self.forward_actor(x), self.forward_critic(x)


class PhasePolicy(ActorCriticPolicy):
    def _build_mlp_extractor(self):
        self.mlp_extractor = PhaseExtractor(self.features_dim).to(self.device)


def protocol():
    CAMPAIGN.mkdir(exist_ok=True)
    path = CAMPAIGN/'protocol.json'
    if not path.exists():
        base.dump(path, dict(seed=secrets.randbelow(2**30), donor=str(DONOR),
            donor_sha256=base.digest(DONOR), development_seeds=DEV,
            confirmation_seeds=CONFIRM, steps=253952, runs_per_configuration=1,
            checkpoint_steps=[106496,253952], initial_experiments=SPECS,
            selection='Highest development arrival; tie fewer stuck/frozen endings then lower failure-capped arrival time.',
            optimizer='Fresh Adam for all arms; common transferred weights and log_std. No unpaid ICM module in this round.',
            objective='Static target, exceed 90% deterministic arrival. Six initial hypotheses; up to four adaptive follow-ups.',
            confirmation_note='Previous 80000 panel is now a reported benchmark, not untouched data. Fresh 120000 panel reserved.'))
    return json.loads(path.read_text())


def model_for(flavor, seed):
    env = DummyVecEnv([lambda:ExperimentEnv(flavor,True,True) for _ in range(8)])
    model = PPO(PhasePolicy if flavor=='phase_experts' else 'MlpPolicy',env,
        learning_rate=.00015,n_steps=1024,batch_size=256,n_epochs=10,gamma=.995,
        gae_lambda=.95,ent_coef=SPECS[flavor].get('ent_coef',.01),
        policy_kwargs=dict(net_arch=[64,64]),seed=seed,device='cpu')
    donor = PPO.load(DONOR,device='cpu')
    target = model.policy.state_dict()
    source = donor.policy.state_dict()
    if flavor=='phase_experts':
        source = deepcopy(source)
        for key, value in list(source.items()):
            if 'mlp_extractor.policy_net.' in key:
                source[key.replace('policy_net','pursuit_policy')] = value.clone()
            if 'mlp_extractor.value_net.' in key:
                source[key.replace('value_net','pursuit_value')] = value.clone()
    model.policy.load_state_dict(widen_policy_state_dict(source,target))
    return model


class Callback(base.ResearchCallback):
    def __init__(self,directory,flavor):
        super().__init__(directory,'control')
        self.flavor = flavor

    def checkpoint(self,final=False):
        steps=self.model.num_timesteps
        path=self.directory/f'model_{steps}'
        self.model.save(path)
        prefix=self.directory/f'dev_{steps}'
        print(f'Evaluating {self.flavor} at {steps}',flush=True)
        # CPU deterministic inference does not draw RNG samples; restore anyway.
        import random
        states=random.getstate(),np.random.get_state(),torch.get_rng_state()
        try:
            summary=evaluate(self.model,lambda:ExperimentEnv(self.flavor,False),DEV,prefix,DEV[:4])
        finally:
            random.setstate(states[0]); np.random.set_state(states[1]); torch.set_rng_state(states[2])
        self.last_evaluated=steps
        row=dict(transitions=steps,wall_seconds=time.perf_counter()-self.started,summary=summary,model=str(path)+'.zip')
        base.append(self.directory/'evaluations.jsonl',row)
        for key,value in summary.items():
            if isinstance(value,(float,int)):
                self.logger.record('development/'+key,value)
        self.logger.dump(steps)
        self.publish(prefix,summary,steps,final)
        print(json.dumps(dict(run=self.flavor,steps=steps,arrival=summary['success_rate'],discovery=summary['detection_rate'])),flush=True)
        return summary


def train(flavor,steps=253952):
    p=protocol()
    directory=CAMPAIGN/flavor
    config=dict(p,flavor=flavor,variant='removal',sensors=flavor,
        hypothesis=SPECS[flavor]['hypothesis'],requested_additional_transitions=steps,
        torch=torch.__version__,device='cpu',threads=torch.get_num_threads(),
        python=sys.version,executable=sys.executable,
        imported_packages={name:dict(version=getattr(module,'__version__',None),file=module.__file__)
            for name in ('numpy','torch','gymnasium','stable_baselines3','sb3_contrib','matplotlib')
            for module in [__import__(name)]},
        n_envs=8,n_steps=1024,batch_size=256,n_epochs=10,learning_rate=.00015,
        gamma=.995,gae_lambda=.95,ent_coef=SPECS[flavor].get('ent_coef',.01))
    base.snapshot(directory,config)
    model=None
    try:
        model=model_for(flavor,p['seed'])
        config.update(observation_size=model.observation_space.shape[0],
            trainable_parameters=sum(x.numel() for x in model.policy.parameters()))
        base.dump(directory/'config.json',config)
        model.set_logger(configure(str(directory/'tensorboard'),['csv','tensorboard']))
        callback=Callback(directory,flavor)
        model.learn(steps,callback=callback,progress_bar=False)
        summary=callback.checkpoint(final=True)
        base.dump(directory/'status.json',dict(status='complete',transitions=model.num_timesteps,summary=summary))
    except BaseException:
        base.dump(directory/'status.json',dict(status='failed',error=traceback.format_exc()))
        if model:model.save(directory/'interrupted_model')
        raise
    finally:
        if model:model.get_env().close()


def main():
    torch.set_num_threads(1)
    parser=argparse.ArgumentParser()
    parser.add_argument('command',choices=['train','queue'])
    parser.add_argument('--flavor',choices=list(SPECS),default='continuation')
    parser.add_argument('--steps',type=int,default=253952)
    args=parser.parse_args()
    protocol()
    if args.command=='train':train(args.flavor,args.steps)
    else:
        import subprocess
        for flavor in SPECS:
            if (CAMPAIGN/flavor/'status.json').exists():
                status=json.loads((CAMPAIGN/flavor/'status.json').read_text())
                if status['status']=='complete':continue
                raise RuntimeError(f'{flavor} already exists but is not complete; inspect before resuming')
            base.dump(CAMPAIGN/'queue_status.json',dict(status='running',active=flavor))
            with (CAMPAIGN/f'{flavor}_console.log').open('w') as log:
                result=subprocess.run([sys.executable,'-u','-m','rl.seeker_round2','train','--flavor',flavor,'--steps',str(args.steps)],cwd=ROOT,stdout=log,stderr=subprocess.STDOUT)
            if result.returncode:
                base.dump(CAMPAIGN/'queue_status.json',dict(status='failed',active=flavor,returncode=result.returncode))
                raise RuntimeError(f'{flavor} failed')
        base.dump(CAMPAIGN/'queue_status.json',dict(status='complete'))


if __name__=='__main__':main()
