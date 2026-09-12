"""Six failure-directed experiments from random initialization, no donor loading."""
import argparse
import os
import json
import secrets
import sys
import time
import traceback
import random
import hashlib
import numpy as np
import torch
from stable_baselines3 import PPO
from stable_baselines3.common.vec_env import DummyVecEnv
from stable_baselines3.common.logger import configure
from rl import seeker_runner as base
from rl.seeker_round2 import ExperimentEnv
from rl.seeker_metrics import evaluate
from rl.seeker_schedules import LinearLearningRate

ROOT=base.ROOT
CAMPAIGN=ROOT/'rl_artifacts/seeker_scratch_lr_20260909'
DEV=list(range(30000,30200))
CONFIRM=list(range(120000,121000))


def evaluation_steps(total):
    """Evaluate at the first completed8192-step rollout after each50k milestone."""
    return sorted({((step+8191)//8192)*8192 for step in range(50000,total,50000)
                   if ((step+8191)//8192)*8192 < total} | {total})


SPECS={
    'original_mlp':dict(reward='original',hypothesis='Establish acquisition with the original cell/view rewards, from random weights.'),
    'removal_mlp':dict(hypothesis='Test whether removing cell/view bonuses helps acquisition, not just fine-tuning.'),
    'residual_lstm':dict(reward='original',architecture='lstm',hypothesis='Parallel current-observation MLP and recurrent memory can learn recovery sequences and more effective search.'),
    'residual_mlp':dict(reward='original',architecture='residual_mlp',hypothesis='Matched-capacity feedforward control separates additional capacity from recurrent memory.'),
    'history_mlp':dict(reward='original',env='history',hypothesis='Finite observation history at 1/4/16 steps may resolve motion/recovery ambiguity without recurrent training.'),
    'recovery_reward':dict(env='resolved_contact',hypothesis='Charging only ineffective contact attempts may encourage learned recovery; terminal penalties stay unchanged.'),
}


def protocol():
    CAMPAIGN.mkdir(exist_ok=True)
    path=CAMPAIGN/'protocol.json'
    if not path.exists():
        previous=ROOT/'rl_artifacts/seeker_scratch_20260909/protocol.json'
        seed=json.loads(previous.read_text())['seed'] if previous.exists() else secrets.randbelow(2**30)
        base.dump(path,dict(seed=seed,initialization='FROM_SCRATCH',donor=None,
            learning_rate_schedule=LinearLearningRate().config(),
            steps=507904,training_runs_per_configuration=1,initial_experiments=SPECS,
            development_seeds=DEV,confirmation_seeds=CONFIRM,
            checkpoints=evaluation_steps(507904),engineering_checkpoint=24576,
            common_settings=dict(n_envs=8,n_steps=1024,batch_size=256,n_epochs=10,
                learning_rate=.00015,gamma=.995,gae_lambda=.95,ent_coef=.01),
            recurrent=dict(learning_chunk_max=128,burn_in_max=32,valid_tokens_per_batch=256,
                cached_state_approximation='Refresh up to 32 observations within the current rollout and episode, then detach. Cached prefix can be stale after updates.'),
            initialization_note='No checkpoint loaded. Common newly randomized base weights and fresh log_std are copied at construction; extra history columns and residual output projections start at zero. Every optimizer is empty and timesteps zero.',
            selection='Highest development arrival; ties fewer stuck/frozen endings, then lower failure-capped arrival time.',
            scope='Six initial scratch configurations, up to four failure-directed additional configurations; static target; seek >90% arrival.'))
    return json.loads(path.read_text())


def make_env(name,training=True,metrics=False):
    spec=SPECS[name]
    return ExperimentEnv(spec.get('env','continuation'),
        training=training and spec.get('reward')!='original',metrics=metrics)


def hyperparameters(model):
    return dict(n_envs=model.n_envs,n_steps=model.n_steps,batch_size=model.batch_size,
        n_epochs=model.n_epochs,gamma=model.gamma,gae_lambda=model.gae_lambda,
        ent_coef=model.ent_coef,vf_coef=model.vf_coef,max_grad_norm=model.max_grad_norm,
        clip_range=model.clip_range(1.),
        clip_range_vf=model.clip_range_vf(1.) if model.clip_range_vf else None,
        normalize_advantage=model.normalize_advantage,target_kl=model.target_kl,
        use_sde=model.use_sde,sde_sample_freq=model.sde_sample_freq,
        learning_rate_schedule=LinearLearningRate().config(),
        optimizer=type(model.policy.optimizer).__name__,optimizer_defaults=model.policy.optimizer.defaults,
        policy_class=type(model.policy).__name__,activation='Tanh',
        orthogonal_base_initialization=model.policy.ortho_init,
        observation_size=model.observation_space.shape[0],
        action_low=model.action_space.low.tolist(),action_high=model.action_space.high.tolist())


def make_model(name,seed,n_steps=1024,n_envs=8):
    from stable_baselines3.common.policies import ActorCriticPolicy
    from train_rl import widen_policy_state_dict
    spec=SPECS[name]
    env=DummyVecEnv([lambda:make_env(name,True,True) for _ in range(n_envs)])
    architecture=spec.get('architecture','mlp')
    algorithm=PPO
    policy='MlpPolicy'
    if architecture in ('lstm','residual_mlp'):
        from rl.seeker_recurrent_policy import ResidualLstmPolicy,ResidualMlpPolicy
        if architecture=='lstm':
            from rl.seeker_recurrent_train import FixedContextRecurrentPPO
            algorithm,policy=FixedContextRecurrentPPO,ResidualLstmPolicy
        else:policy=ResidualMlpPolicy
    model=algorithm(policy,env,learning_rate=LinearLearningRate(),n_steps=n_steps,batch_size=256,
        n_epochs=10,gamma=.995,gae_lambda=.95,ent_coef=.01,
        policy_kwargs=dict(net_arch=[64,64]),seed=seed,device='cpu')
    # This is a newly initialized reference network, never a trained checkpoint.
    torch.manual_seed(seed)
    reference_env=make_env('removal_mlp')
    reference=ActorCriticPolicy(reference_env.observation_space,reference_env.action_space,
        lambda _: .00015,net_arch=[64,64])
    source=reference.state_dict()
    target=model.policy.state_dict()
    common={k:v for k,v in source.items() if k in target}
    widened=widen_policy_state_dict(common,{k:target[k] for k in common})
    target.update(widened)
    model.policy.load_state_dict(target)
    reference_env.close()
    model.set_random_seed(seed)
    assert model.num_timesteps==0 and len(model.policy.optimizer.state)==0
    return model


class Callback(base.ResearchCallback):
    def __init__(self,directory,name,total):
        super().__init__(directory,'control')
        self.name,self.total=name,total
        self.evaluation_steps=evaluation_steps(total)

    def _on_rollout_start(self):
        if self.num_timesteps==24576:
            if not all(torch.isfinite(p).all() for p in self.model.policy.parameters()):
                raise FloatingPointError('Nonfinite engineering checkpoint')
            folder=self.directory/'engineering_smoke'
            folder.mkdir(exist_ok=True)
            self.model.save(folder/'model_24576')
            base.dump(folder/'validation.json',dict(transitions=self.num_timesteps,
                finite_parameters=True,wall_seconds=time.perf_counter()-self.started,
                continuation='Same model/optimizer/RNG continues within the single run; no duplicate training seed.'))
            print(f'{self.name}: 24,576-step engineering checkpoint passed',flush=True)
        super()._on_rollout_start()

    def checkpoint(self,final=False):
        steps=self.model.num_timesteps
        path=self.directory/f'model_{steps}'
        self.model.save(path)
        prefix=self.directory/f'dev_{steps}'
        print(f'Evaluating {self.name} at {steps}',flush=True)
        states=random.getstate(),np.random.get_state(),torch.get_rng_state()
        try:
            summary=evaluate(self.model,lambda:make_env(self.name,False),DEV,prefix,DEV[:4])
        finally:
            random.setstate(states[0]);np.random.set_state(states[1]);torch.set_rng_state(states[2])
        self.last_evaluated=steps
        row=dict(transitions=steps,wall_seconds=time.perf_counter()-self.started,summary=summary,model=str(path)+'.zip')
        base.append(self.directory/'evaluations.jsonl',row)
        for key,value in summary.items():
            if isinstance(value,(float,int)):self.logger.record('development/'+key,value)
        self.logger.dump(steps)
        self.publish(prefix,summary,steps,final)
        print(json.dumps(dict(run=self.name,steps=steps,arrival=summary['success_rate'],discovery=summary['detection_rate'])),flush=True)
        return summary

    def publish(self,*args,**kwargs):
        super().publish(*args,**kwargs)
        path=self.directory/'rl_live_state.json'
        if path.exists():
            data=json.loads(path.read_text());data['total_timesteps']=self.total
            base.dump(path,data)
            from train_rl import write_live_state
            write_live_state(data)


def train(name,steps=507904):
    p=protocol()
    directory=CAMPAIGN/name
    config=dict(p,name=name,effective_experiment_spec=SPECS[name],
        protocol_amendments=json.loads((CAMPAIGN/'protocol_amendments.json').read_text()) if (CAMPAIGN/'protocol_amendments.json').exists() else [],
        variant='control' if SPECS[name].get('reward')=='original' else 'removal',
        checkpoints=evaluation_steps(steps),evaluation_interval_requested=50000,
        sensors=SPECS[name].get('env','body'),hypothesis=SPECS[name]['hypothesis'],
        requested_transitions=steps,requested_additional_transitions=steps,donor=None,
        device='cpu',torch=torch.__version__,threads=torch.get_num_threads(),
        pid=os.getpid(),
        python=sys.version,executable=sys.executable,
        imported_packages={name:dict(version=getattr(module,'__version__',None),file=module.__file__)
            for name in ('numpy','torch','gymnasium','stable_baselines3','sb3_contrib','matplotlib')
            for module in [__import__(name)]},**p['common_settings'])
    base.snapshot(directory,config)
    model=None
    try:
        model=make_model(name,p['seed'])
        initial=model.policy.state_dict()
        weight_hash=hashlib.sha256(b''.join(k.encode()+v.detach().cpu().numpy().tobytes() for k,v in sorted(initial.items()))).hexdigest()
        config.update(observation_size=model.observation_space.shape[0],
            trainable_parameters=sum(v.numel() for v in model.policy.parameters()),
            initial_weight_sha256=weight_hash,initial_timesteps=model.num_timesteps,
            initial_optimizer_state_entries=len(model.policy.optimizer.state))
        base.dump(directory/'config.json',config)
        model.save(directory/'initial_model')
        base.dump(directory/'hyperparameter_audit.json',hyperparameters(model))
        model.set_logger(configure(str(directory/'tensorboard'),['csv','tensorboard']))
        callback=Callback(directory,name,steps)
        model.learn(steps,callback=callback,progress_bar=False)
        summary=callback.checkpoint(final=True)
        base.dump(directory/'status.json',dict(status='complete',transitions=model.num_timesteps,summary=summary))
    except BaseException:
        base.dump(directory/'status.json',dict(status='failed',error=traceback.format_exc(),transitions=model.num_timesteps if model else 0))
        if model:model.save(directory/'interrupted_model')
        raise
    finally:
        if model:model.get_env().close()


def main():
    torch.set_num_threads(1)
    parser=argparse.ArgumentParser()
    parser.add_argument('--name',choices=list(SPECS),required=True)
    parser.add_argument('--steps',type=int,default=507904)
    args=parser.parse_args()
    train(args.name,args.steps)


if __name__=='__main__':main()
