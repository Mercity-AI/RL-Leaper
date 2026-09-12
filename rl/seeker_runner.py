"""Single-seed, controlled seeker research with immutable per-run evidence.

Run through run_seeker.ps1. Checkpoint resumes start fresh episodes, explicitly;
optimizer and curiosity state persist, but they are not bitwise mid-episode resumes.
"""
import argparse
import hashlib
import gzip
from datetime import datetime, timezone
import importlib.metadata
import json
import os
from pathlib import Path
import platform
import random
import secrets
import shutil
import subprocess
import sys
import time
import traceback

import numpy as np
import torch
from stable_baselines3 import PPO
from stable_baselines3.common.callbacks import BaseCallback
from stable_baselines3.common.vec_env import DummyVecEnv
from stable_baselines3.common.logger import configure

from rl.seeker_env import SeekerEnv
from train_rl import widen_policy_state_dict, write_live_state

ROOT = Path(__file__).resolve().parents[1]
DONOR = ROOT / 'rl_artifacts/ppo_35_frontier_seed025_500k_s1/leaper_ppo.zip'
CAMPAIGN = ROOT / 'rl_artifacts/seeker_20260909'
DEV = list(range(30000, 30200))
CONFIRM = list(range(80000, 81000))


def dump(path, data):
    path=Path(path)
    temporary=path.with_name(path.name+f'.{os.getpid()}.tmp')
    temporary.write_text(json.dumps(data, indent=2, allow_nan=False), encoding='utf-8')
    for attempt in range(10):
        try:
            os.replace(temporary,path)
            return
        except PermissionError:
            if attempt==9:raise
            time.sleep(.05)


def append(path, data):
    with Path(path).open('a', encoding='utf-8') as f:
        f.write(json.dumps(data, allow_nan=False) + '\n')


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def initialize_campaign():
    CAMPAIGN.mkdir(parents=True, exist_ok=True)
    path = CAMPAIGN / 'protocol.json'
    if not path.exists():
        dump(path, dict(date='2026-09-09', seed=secrets.randbelow(2**30),
             donor=str(DONOR), donor_sha256=digest(DONOR),
             development_seeds=DEV, confirmation_seeds=CONFIRM,
             historical_seeds=list(range(10000,10100)),
             training_runs_per_configuration=1,
             selection='Highest development success; ties: lower early terminal failures, then lower failure-capped arrival steps; only planned decision checkpoints.',
             checkpoints=[106496,253952,507904],
             objective='Exceed 90% deterministic arrival; report honestly if unmet.',
             note='CPU fallback authorized; original 20000 replay seeds are reused, so dev moved. Confirmation is never used for tuning.'))
    return json.loads(path.read_text())


def snapshot(directory, config):
    directory.mkdir(parents=True, exist_ok=False)
    dump(directory / 'config.json', config)
    code = directory / 'source'
    code.mkdir()
    for source in [ROOT/'rl_environment.py', ROOT/'train_rl.py', ROOT/'run_seeker.ps1', *sorted((ROOT/'rl').glob('*.py')), *sorted((ROOT/'tests').glob('test_seeker*.py'))]:
        shutil.copy2(source, code / source.name)
    for name, args in [('working_tree.patch',['git','diff','--binary','HEAD']),('git_status.txt',['git','status','--short']),('git_revision.txt',['git','rev-parse','HEAD'])]:
        result = subprocess.run(args, cwd=ROOT, capture_output=True)
        (directory/name).write_bytes(result.stdout)
    packages = {}
    for distribution in importlib.metadata.distributions():
        if distribution.metadata['Name']:
            packages.setdefault(distribution.metadata['Name'],distribution.version)
    dump(directory/'packages.json',packages)
    dump(directory/'source_hashes.json',{p.name:digest(p) for p in code.iterdir()})


def make_env(variant='control',metrics=False,sensors='body'):
    if sensors=='footprint':
        from rl.seeker_clearance import FootprintSeekerEnv
        return FootprintSeekerEnv(variant=variant,metrics=metrics)
    if sensors=='stall_memory':
        from rl.seeker_stall_memory import StallMemorySeekerEnv
        return StallMemorySeekerEnv(variant=variant,metrics=metrics)
    return SeekerEnv(variant,metrics=metrics)


def make_model(seed, variant='control', metrics=True, device='cpu',sensors='body'):
    env = DummyVecEnv([lambda:make_env(variant,metrics,sensors) for _ in range(8)])
    donor = PPO.load(DONOR, device=device)
    model = PPO('MlpPolicy',env,learning_rate=1.5e-4,n_steps=1024,batch_size=256,
                n_epochs=10,gamma=.995,gae_lambda=.95,ent_coef=.01,
                policy_kwargs=dict(net_arch=[64,64]),seed=seed,device=device,verbose=0)
    model.policy.load_state_dict(widen_policy_state_dict(donor.policy.state_dict(),model.policy.state_dict()))
    return model


def frozen_evaluate(model, seeds, prefix):
    from rl.seeker_metrics import evaluate
    # Evaluation must not consume the policy RNG stream or modify a training env.
    py_state, np_state, th_state = random.getstate(),np.random.get_state(),torch.get_rng_state()
    try:
        sensors={(50,):'footprint',(36,):'stall_memory',(34,):'body'}[model.observation_space.shape]
        return evaluate(model,lambda:make_env('control',sensors=sensors),seeds,prefix,record_seeds=list(seeds)[:4])
    finally:
        random.setstate(py_state)
        np.random.set_state(np_state)
        torch.set_rng_state(th_state)


class ResearchCallback(BaseCallback):
    def __init__(self,directory,variant,curiosity=None):
        super().__init__()
        self.directory,self.variant,self.curiosity=directory,variant,curiosity
        self.started=time.perf_counter()
        self.rollout_start=self.started
        self.last_evaluated=-1
        self.latest_episodes=[]
        self.intrinsic_totals=np.zeros(8)
        self.intrinsic_contact=np.zeros(8)
        self.intrinsic_no_coverage=np.zeros(8)
        self.exhausted_steps=[None]*8
        self.checkpoints=[]
        self.start_transitions=0
        self.worker0_episode=0

    def _on_training_start(self):
        self.start_transitions=self.model.num_timesteps

    def _on_rollout_start(self):
        if self.num_timesteps in getattr(self,'evaluation_steps',(106496,253952,507904)) and self.num_timesteps!=self.last_evaluated:
            self.checkpoint()
        self.rollout_start=time.perf_counter()
        self.data=[]
        self.raw_errors=[]
        self.bonus_sum=0.
        self.contact_bonus=0.
        self.no_coverage_bonus=0.

    def _on_step(self):
        loc=self.locals
        infos,dones=loc['infos'],loc['dones']
        bonus=np.zeros(8)
        if self.curiosity is not None:
            obs=self.model._last_obs.copy()
            nxt=loc['new_obs'].copy()
            for i,done in enumerate(dones):
                if done:
                    nxt[i]=infos[i]['terminal_observation']
            actions=loc['clipped_actions'].copy()
            errors=self.curiosity.errors(obs,actions,nxt)
            searching=np.array([not info['target_ever_seen'] for info in infos])
            terminal=np.array([bool(done and not info.get('TimeLimit.truncated',False)) for done,info in zip(dones,infos)])
            # Utility API is intentionally simple; reward remains detached numpy.
            q=np.clip(errors/max(self.curiosity.rms,1e-6),0,1)
            if self.variant=='icm':
                bonus=np.where(searching & ~terminal,np.minimum(.01*q,1-self.intrinsic_totals),0)
            self.intrinsic_totals+=bonus
            for i in range(8):
                if self.intrinsic_totals[i]>=1-1e-7 and self.exhausted_steps[i] is None:
                    self.exhausted_steps[i]=int(infos[i].get('episode_step',0))
            loc['rewards'][:]+=bonus.astype(np.float32)
            if searching.any():
                self.data.append((obs[searching],actions[searching],nxt[searching]))
                self.raw_errors.extend(errors[searching].tolist())
            # Predeclared worker 0 trace: time-resolved curiosity evidence, not
            # selected successes. All workers still have complete episode rows.
            info=infos[0]
            append(self.directory/'worker0_reward_trace.jsonl',dict(
                transitions=self.num_timesteps,episode=self.worker0_episode,
                step=info.get('episode_step'),x=info.get('x'),z=info.get('z'),
                action=actions[0].tolist(),collision=bool(info.get('collision')),
                discovered=bool(info['target_ever_seen']),new_visible_cells=len(info.get('coverage_new_cells',[])),
                reward_terms=info.get('reward_terms',{}),extrinsic=info.get('extrinsic_reward'),
                intrinsic=float(bonus[0]),intrinsic_total=float(self.intrinsic_totals[0]),
                raw_error=float(errors[0]),normalized_error=float(q[0]),rms=self.curiosity.rms,
                done=bool(dones[0]),true_terminal=bool(terminal[0])))
            if dones[0]:self.worker0_episode+=1
        for i,(info,done) in enumerate(zip(infos,dones)):
            self.bonus_sum+=float(bonus[i])
            if info.get('collision'):
                self.contact_bonus+=float(bonus[i]); self.intrinsic_contact[i]+=bonus[i]
            if not info.get('coverage_new_cells'):
                self.no_coverage_bonus+=float(bonus[i]); self.intrinsic_no_coverage[i]+=bonus[i]
            if done:
                row=info.get('research_episode',{})
                row.update(transitions=self.num_timesteps,intrinsic=float(self.intrinsic_totals[i]),
                           intrinsic_during_contact=float(self.intrinsic_contact[i]),
                           intrinsic_without_new_visibility=float(self.intrinsic_no_coverage[i]),
                           intrinsic_exhaustion_step=self.exhausted_steps[i],
                           intrinsic_budget_exhausted=bool(self.intrinsic_totals[i]>=1-1e-7))
                append(self.directory/'training_episodes.jsonl',row)
                self.latest_episodes.append(row)
                self.latest_episodes=self.latest_episodes[-100:]
                self.intrinsic_totals[i]=0; self.intrinsic_contact[i]=0; self.intrinsic_no_coverage[i]=0
                self.exhausted_steps[i]=None
        return True

    def _on_rollout_end(self):
        if self.curiosity is not None and self.data:
            data=[np.concatenate([t[i] for t in self.data]) for i in range(3)]
            metrics=self.curiosity.update(*data)
            self.curiosity.update_rms(np.asarray(self.raw_errors))
            for key,value in metrics.items():
                self.logger.record('curiosity/'+key,value)
            self.logger.record('curiosity/rms',self.curiosity.rms)
            self.logger.record('curiosity/payout',self.bonus_sum)
            self.logger.record('curiosity/contact_payout',self.contact_bonus)
            self.logger.record('curiosity/no_new_visibility_payout',self.no_coverage_bonus)
            self.logger.record('curiosity/raw_error_mean',float(np.mean(self.raw_errors)))
            self.logger.record('curiosity/raw_error_p95',float(np.quantile(self.raw_errors,.95)))
        if self.latest_episodes:
            for key in ('success','detected','steps','coverage_final','collision_rate','revisits'):
                values=[r[key] for r in self.latest_episodes if isinstance(r.get(key),(float,int,bool))]
                if values:self.logger.record('stochastic_last100/'+key,float(np.mean(values)))
        elapsed=time.perf_counter()-self.started
        row=dict(transitions=self.num_timesteps,wall_seconds=elapsed,
                 overall_fps=(self.num_timesteps-self.start_transitions)/elapsed,rollout_collection_seconds=time.perf_counter()-self.rollout_start,
                 completed_episodes_last100=len(self.latest_episodes),intrinsic_payout=self.bonus_sum)
        append(self.directory/'rollouts.jsonl',row)
        dump(self.directory/'status.json',dict(status='training',**row))
        print(json.dumps(dict(run=self.directory.name,**row)),flush=True)

    def checkpoint(self,final=False):
        steps=self.model.num_timesteps
        path=self.directory/f'model_{steps}'
        self.model.save(path)
        if self.curiosity is not None:
            self.curiosity.save(self.directory/f'curiosity_{steps}.pt')
        prefix=self.directory/f'dev_{steps}'
        print(f'Evaluating {self.directory.name} at {steps}: 200 deterministic development mazes',flush=True)
        summary=frozen_evaluate(self.model,DEV,prefix)
        self.last_evaluated=steps
        row=dict(transitions=steps,wall_seconds=time.perf_counter()-self.started,summary=summary,model=str(path)+'.zip')
        append(self.directory/'evaluations.jsonl',row)
        for key,value in summary.items():
            if isinstance(value,(float,int)):
                self.logger.record('development/'+key,value)
        self.logger.dump(steps)
        self.publish(prefix,summary,steps,final)
        print(json.dumps(row),flush=True)
        return summary

    def publish(self,prefix,summary,steps,final):
        replay=Path(str(prefix)+'_replays.json.gz')
        if not replay.exists():return
        with gzip.open(replay,'rt',encoding='utf-8') as handle:
            data=json.load(handle)
        episodes=data if isinstance(data,list) else data.get('episodes',data.get('replays',[]))
        for i,episode in enumerate(episodes):
            episode.update(episode=i+1,reward=episode['metrics']['reward'],
                 success=episode['metrics']['success'],path_length=episode['metrics']['path_length'],
                 exploratory=False,deterministic=True,coverage_cell=3.,coverage_map=False,frontier_note=True)
            for frame in episode['frames']:
                frame['distance']=frame.get('info',{}).get('distance',0)
        self.checkpoints.append(dict(step=steps,mean_reward=summary.get('mean_reward',0),
             success_rate=summary.get('success_rate',0),episodes=episodes))
        payload=dict(status='complete' if final else 'training',run=self.directory.name,
             timesteps=steps,total_timesteps=253952,checkpoints=self.checkpoints,training_rollouts=[],
             updated_at=datetime.now(timezone.utc).isoformat(),world_limit=SeekerEnv.WORLD_LIMIT,
             vision=dict(field_of_view_degrees=270,ray_count=16,max_range=28,type='thin_ray_rangefinder',forward_only_throttle=True))
        write_live_state(payload)
        dump(self.directory/'rl_live_state.json',payload)


def train(args):
    protocol=initialize_campaign()
    directory=CAMPAIGN/args.name
    device='cuda' if torch.cuda.is_available() else 'cpu'
    config=dict(protocol,variant=args.variant,requested_additional_transitions=args.steps,
       device=device,python=sys.version,executable=sys.executable,platform=platform.platform(),
       imported_packages={name:dict(version=getattr(module,'__version__',None),file=module.__file__)
          for name in ('numpy','torch','gymnasium','stable_baselines3','sb3_contrib','matplotlib')
          for module in [__import__(name)]},
       torch=torch.__version__,threads=torch.get_num_threads(),observation_size={'footprint':50,'stall_memory':36,'body':34}[args.sensors],
       sensors=args.sensors,
       n_envs=8,n_steps=1024,batch_size=256,n_epochs=10,learning_rate=.00015,
       gamma=.995,gae_lambda=.95,ent_coef=.01,clip_range=.2,vf_coef=.5,max_grad_norm=.5,
       resume=args.resume,curiosity_resume=args.curiosity_resume,
       resume_semantics='fresh episodes; saved optimizer' if args.resume else None,
       environment_constants={k:(v.tolist() if isinstance(v,np.ndarray) else v) for k in dir(SeekerEnv) if k.isupper() and isinstance((v:=getattr(SeekerEnv,k)),(int,float,bool,str,tuple,np.ndarray))})
    snapshot(directory,config)
    model=None
    curiosity=None
    try:
        if args.resume and args.variant in ('removal','icm') and not args.curiosity_resume:
            raise ValueError('Curiosity continuation requires the paired module checkpoint')
        if args.resume:
            previous_config=json.loads((Path(args.resume).parent/'config.json').read_text())
            if previous_config['variant']!=args.variant or previous_config.get('sensors','body')!=args.sensors:
                raise ValueError('Resume must preserve reward variant and sensor contract')
            config['resume_model_sha256']=digest(args.resume)
            config['resume_rng_seed']=protocol['seed']+1
            if args.curiosity_resume:
                if Path(args.resume).stem.split('_')[-1]!=Path(args.curiosity_resume).stem.split('_')[-1]:
                    raise ValueError('Model and curiosity checkpoint transition counts must match')
                config['resume_curiosity_sha256']=digest(args.curiosity_resume)
            model=PPO.load(args.resume,device=device,env=DummyVecEnv([lambda:make_env(args.variant,True,args.sensors) for _ in range(8)]))
            model.set_random_seed(protocol['seed']+1)
        else:
            model=make_model(protocol['seed'],args.variant,device=device,sensors=args.sensors)
        config['trainable_parameters']=sum(p.numel() for p in model.policy.parameters())
        if args.sensors=='footprint':
            config['footprint_sensor']=dict(range=6.,count=16,cone_degrees=270,
                footprint_circles=19,semantics='fixed-yaw swept translation to nearest inflated obstacle or wall; stronger multi-origin sensor, no action override',
                added_channels=list(range(34,50)),zero_initialized_input_columns=True)
        if args.sensors=='stall_memory':
            config['stall_memory']=dict(channels=['stuck_steps/40','freeze_steps/60'],
                added_channels=[34,35],semantics='maintained history of collisions and actual translation; no hidden target information',
                reset=[0.,0.],zero_initialized_input_columns=True)
        config['effective_rewards']={k:getattr(model.get_env().envs[0],k) for k in (
            'EXPLORATION_REWARD','NEW_VIEW_REWARD','SCAN_REWARD','BEST_PROGRESS_SCALE',
            'DISTANCE_REWARD_SCALE','STEP_PENALTY','IDLE_PENALTY','COLLISION_PENALTY',
            'STUCK_PENALTY','FREEZE_PENALTY','GOAL_REWARD','SIGHT_REWARD')}
        dump(directory/'config.json',config)
        model.set_logger(configure(str(directory/'tensorboard'),['csv','tensorboard']))
        if args.variant in ('removal','icm'):
            from rl.seeker_curiosity import Curiosity
            curiosity=Curiosity(device=device,seed=protocol['seed']+101)
            if args.curiosity_resume:
                curiosity=Curiosity.load(args.curiosity_resume,device=device)
            else:
                calibration=np.load(CAMPAIGN/'calibration.npz')
                curiosity.update_rms(curiosity.errors(calibration['obs'],calibration['actions'],calibration['next_obs']))
            config['curiosity']=dict(parameters=curiosity.parameter_count,seed=curiosity.seed,
                 coefficient=.01 if args.variant=='icm' else 0.,episode_cap=1.,
                 initial_rms=curiosity.rms,calibration_sha256=digest(CAMPAIGN/'calibration.npz'),
                 learning_rate=.0003,inverse_weight=.8,forward_weight=.2,batch_size=256,
                 epochs_per_rollout=1,features=[5,6,*range(10,26)])
            dump(directory/'config.json',config)
        callback=ResearchCallback(directory,args.variant,curiosity)
        model.learn(args.steps,callback=callback,reset_num_timesteps=not bool(args.resume),progress_bar=False)
        summary=callback.checkpoint(final=True)
        dump(directory/'status.json',dict(status='complete',transitions=model.num_timesteps,summary=summary))
    except BaseException:
        dump(directory/'status.json',dict(status='failed',error=traceback.format_exc(),transitions=model.num_timesteps if model else 0))
        if model:model.save(directory/'interrupted_model')
        if curiosity:curiosity.save(directory/'interrupted_curiosity.pt')
        raise
    finally:
        if model:model.get_env().close()


def calibrate():
    protocol=initialize_campaign()
    if (CAMPAIGN/'calibration.npz').exists():
        raise FileExistsError('Calibration already exists; do not overwrite')
    env=SeekerEnv()
    donor=PPO.load(DONOR,device='cpu')
    obs,_=env.reset(seed=protocol['seed']+201)
    data=[]
    start=time.perf_counter()
    for i in range(24576):
        action,_=donor.predict(obs[:31],deterministic=True)
        nxt,_,term,trunc,info=env.step(action)
        if not info['target_ever_seen']:
            data.append((obs.copy(),action.copy(),nxt.copy()))
        obs=nxt
        if term or trunc:obs,_=env.reset()
        if (i+1)%8192==0:print(f'Calibration {i+1}/24576',flush=True)
    np.savez_compressed(CAMPAIGN/'calibration.npz',obs=np.stack([d[0] for d in data]),
                        actions=np.stack([d[1] for d in data]),next_obs=np.stack([d[2] for d in data]))
    dump(CAMPAIGN/'calibration.json',dict(collected=24576,eligible=len(data),wall_seconds=time.perf_counter()-start,
         donor_sha256=digest(DONOR),seed=protocol['seed']+201,policy_updates=0,module_updates=0))
    env.close()


def main():
    torch.set_num_threads(1)
    p=argparse.ArgumentParser()
    p.add_argument('command',choices=['train','calibrate','baseline','confirm'])
    p.add_argument('--name',default='control_250k')
    p.add_argument('--variant',default='control',choices=['control','visibility','removal','icm','no_hidden_progress'])
    p.add_argument('--steps',type=int,default=253952)
    p.add_argument('--resume')
    p.add_argument('--curiosity-resume')
    p.add_argument('--model')
    p.add_argument('--sensors',choices=['body','footprint','stall_memory'],default='body')
    args=p.parse_args()
    if args.command=='train':train(args)
    elif args.command=='calibrate':calibrate()
    else:
        protocol=initialize_campaign()
        if args.command=='baseline':
            model=make_model(protocol['seed'],metrics=False)
            model.save(CAMPAIGN/'donor_34')
            summary=frozen_evaluate(model,DEV,CAMPAIGN/'baseline_dev')
        else:
            model=PPO.load(args.model,device='cpu')
            summary=frozen_evaluate(model,CONFIRM,CAMPAIGN/(args.name+'_confirmation'))
        print(json.dumps(summary,indent=2),flush=True)


if __name__=='__main__':main()
