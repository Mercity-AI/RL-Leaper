"""Replay every prior development failure; never alter a deployed action."""
import json
import math
from collections import Counter
import numpy as np
import torch
from stable_baselines3 import PPO
from rl.seeker_env import SeekerEnv
from rl.seeker_contact_diagnostic import diagnose_episode
from rl.seeker_round2 import CAMPAIGN,DONOR
from rl.seeker_runner import dump,digest


def main():
    torch.set_num_threads(1)
    path=DONOR.parent/'dev_253952_episodes.json'
    rows=json.loads(path.read_text())
    model=PPO.load(DONOR,device='cpu')
    episodes=[]
    for row in rows:
        if not row['success']:
            episodes.append(diagnose_episode(model,row,None))
            if len(episodes)%10==0:
                print(f'Failure audit {len(episodes)}/{sum(not r["success"] for r in rows)}',flush=True)
    frames=[f for e in episodes for f in e['last100']]
    contacts=[f for f in frames if f['collision_part']]
    result=dict(donor=str(DONOR),donor_sha256=digest(DONOR),input_sha256=digest(path),
        sample='All failed episodes from previous 200-maze development evaluation; last 100 steps only.',
        failures=len(episodes),episodes=episodes,
        classifications=dict(Counter(e['final_classification'] for e in episodes)),
        exact_rows=all(e['row_exact_match'] for e in episodes),
        exact_geometry=all(not e['geometry_transition_mismatch_steps'] for e in episodes),
        contact_steps=len(contacts),
        blocked_contact_steps=sum(f['actual_translation']<=.001 for f in contacts),
        blocked_with_alternative_translation=sum(f['actual_translation']<=.001 and f['any_translation'] for f in contacts),
        std=model.policy.log_std.detach().exp().cpu().tolist())
    dump(CAMPAIGN/'failure_diagnostic.json',result)
    print(json.dumps({k:v for k,v in result.items() if k!='episodes'},indent=2))


if __name__=='__main__':main()
