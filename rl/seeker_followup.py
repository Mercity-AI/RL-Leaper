"""Conditional single sensor experiment, after the four reward arms finish."""
import json
import os
from pathlib import Path
import subprocess
import sys
import time
from rl.seeker_runner import CAMPAIGN, ROOT, dump


def main():
    while True:
        path=CAMPAIGN/'queue_status.json'
        status=json.loads(path.read_text()) if path.exists() else {}
        if status.get('status')=='complete':break
        if status.get('status')=='failed':raise RuntimeError('Reward queue failed; no followup')
        time.sleep(5)
    runs={name:json.loads((CAMPAIGN/(name+'_250k')/'status.json').read_text())['summary']
          for name in ('control','visibility','removal','icm')}
    best=max(s['success_rate'] for s in runs.values())
    decision=dict(reward_final_scores={name:s['success_rate'] for name,s in runs.items()},
        rule='If all four final reward scores are below 90%, run the separately tested footprint-sensor hypothesis once.',
        hypothesis='Outer-leg contact is poorly represented by body-center rays; add full-footprint local clearance while keeping original control rewards.',
        sensors='16 new 6-unit fixed-yaw full-footprint proximity readings; keep original34 inputs; zero new weights; stronger sensor, not an action override',
        control='control_250k, identical seed/donor/PPO/253952 budget',
        stage='running' if best<.9 else 'skipped')
    dump(CAMPAIGN/'sensor_decision.json',decision)
    if best>=.9:return
    command=[sys.executable,'-u','-m','rl.seeker_runner','train','--name','footprint_250k',
             '--variant','control','--sensors','footprint','--steps','253952']
    with (CAMPAIGN/'footprint_250k_console.log').open('x',encoding='utf-8') as out:
        child=subprocess.run(command,cwd=ROOT,stdout=out,stderr=subprocess.STDOUT,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
    decision['stage']='complete' if child.returncode==0 else 'failed'
    decision['exit_code']=child.returncode
    dump(CAMPAIGN/'sensor_decision.json',decision)
    if child.returncode:raise RuntimeError('Footprint run failed; inspect saved error')


if __name__=='__main__':main()
