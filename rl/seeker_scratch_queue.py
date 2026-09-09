"""Two CPU jobs at a time; each owns its models/logs and one recorded seed."""
import json
import os
import subprocess
import sys
import time
from rl.seeker_scratch import CAMPAIGN,ROOT,protocol
from rl.seeker_runner import dump


def main():
    protocol()
    order=['original_mlp','removal_mlp','residual_lstm','residual_mlp','history_mlp','recovery_reward']
    active={}
    pending=[]
    for name in order:
        folder=CAMPAIGN/name
        if folder.exists():
            status=json.loads((folder/'status.json').read_text()) if (folder/'status.json').exists() else {}
            if status.get('status')=='complete':continue
            raise RuntimeError(f'Existing incomplete run {name}; do not duplicate it')
        pending.append(name)
    try:
        while pending or active:
            while pending and len(active)<2:
                name=pending[0]
                if name=='residual_lstm' and not (CAMPAIGN/'recurrent_validation_passed.json').exists():
                    break
                pending.pop(0)
                log=(CAMPAIGN/f'{name}_console.log').open('w')
                process=subprocess.Popen([sys.executable,'-u','-m','rl.seeker_scratch','--name',name],
                    cwd=ROOT,stdout=log,stderr=subprocess.STDOUT,
                    creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
                active[name]=(process,log)
                print(f'Started scratch {name}, pid {process.pid}',flush=True)
            for name,(process,log) in list(active.items()):
                code=process.poll()
                if code is not None:
                    log.close();del active[name]
                    print(f'{name} exited {code}',flush=True)
                    if code:
                        dump(CAMPAIGN/'queue_status.json',dict(status='failed',failed_run=name,
                            active={n:p.pid for n,(p,_) in active.items()},pending=pending))
                        # Leave any independent healthy worker alive; parent diagnoses failure.
                        return 1
            dump(CAMPAIGN/'queue_status.json',dict(status='running' if active or pending else 'complete',
                active={n:p.pid for n,(p,_) in active.items()},pending=pending,cpu_slots=2))
            if active or pending:time.sleep(5)
    finally:
        for _,log in active.values():log.close()
    return 0


if __name__=='__main__':raise SystemExit(main())
