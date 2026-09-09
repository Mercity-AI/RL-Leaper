"""Diagnostic only: known stationary targets in obstacle-free space, no training."""
import json
import math
import numpy as np
import torch
from stable_baselines3 import PPO
from rl.seeker_env import SeekerEnv
from rl.seeker_scratch import CAMPAIGN
from rl.seeker_runner import dump,digest


def main():
    torch.set_num_threads(1)
    results={}
    for name in ('original_mlp','removal_mlp'):
        path=CAMPAIGN/name/'model_253952.zip'
        model=PPO.load(path,device='cpu')
        rows=[]
        for yaw_index in range(8):
            for relative_index in range(8):
                env=SeekerEnv('control')
                env.reset(seed=731)
                env.obstacles=()
                env.position=np.zeros(2,dtype=np.float32)
                env.yaw=yaw_index*math.pi/4
                relative=(relative_index-4)*math.pi/4
                angle=env.yaw+relative
                env.target=np.array([8*math.sin(angle),8*math.cos(angle)],dtype=np.float32)
                env.target_ever_seen=True
                env.last_seen_target=env.target.copy()
                env.steps_since_target_seen=0
                env.prev_distance=env.best_distance=8.
                env.steps=env.stuck_steps=env.freeze_steps=env.idle_steps=0
                env.previous_action.fill(0);env.last_collision=0.
                env._update_target_memory(increment_time=False)
                env._reset_coverage();env._update_coverage()
                obs=np.concatenate((env._observation(),np.zeros(3,np.float32)))
                positions=[env.position.tolist()];actions=[]
                for step in range(200):
                    action,_=model.predict(obs,deterministic=True)
                    obs,_,term,trunc,info=env.step(action)
                    actions.append(action.tolist());positions.append(env.position.tolist())
                    if term or trunc:break
                rows.append(dict(yaw=env.yaw,initial_yaw=yaw_index*math.pi/4,
                    relative_goal=relative,success=bool(info['is_success']),steps=step+1,
                    distance=info['distance'],positions=positions,actions=actions))
                env.close()
        results[name]=dict(model_sha256=digest(path),cases=64,arrival=sum(r['success'] for r in rows)/64,
            mean_end_distance=float(np.mean([r['distance'] for r in rows])),rows=rows)
    dump(CAMPAIGN/'open_space_pursuit_probe.json',dict(
        diagnostic_only=True,training=False,
        intervention='Remove obstacles, start at origin, known fixed target distance8; eight headings by eight relative bearings; 200-step diagnostic cap. Not benchmark scores.',
        results=results))
    print(json.dumps({k:{n:v for n,v in r.items() if n!='rows'} for k,r in results.items()},indent=2))


if __name__=='__main__':main()
