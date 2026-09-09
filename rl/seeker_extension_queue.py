"""Wait for the initial screen, then launch the two authorized extensions."""
import json
import os
import subprocess
import sys
import time
from rl.seeker_scratch import CAMPAIGN,ROOT
from rl.seeker_runner import dump


def main():
    status_path=CAMPAIGN/'extension_queue_status.json'
    if status_path.exists():raise RuntimeError('Existing extension supervisor; inspect rather than duplicate')
    names=('residual_lstm','residual_mlp')
    if any((CAMPAIGN/(n+'_extension_2m')).exists() for n in names):
        raise RuntimeError('Extension artifacts already exist')
    dump(status_path,dict(status='waiting_for_initial_screen',pid=os.getpid(),active={}))
    while True:
        state=json.loads((CAMPAIGN/'queue_status.json').read_text())
        if state['status']=='failed':
            dump(status_path,dict(status='blocked_by_initial_failure',pid=os.getpid(),active={}))
            return 1
        if state['status']=='complete':break
        time.sleep(5)
    active={}
    for name in names:
        log=(CAMPAIGN/(name+'_extension_2m_console.log')).open('w')
        p=subprocess.Popen([sys.executable,'-u','-m','rl.seeker_extension','--name',name],cwd=ROOT,
                           stdout=log,stderr=subprocess.STDOUT,
                           creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
        active[name]=(p,log)
        print(f'Started {name}_extension_2m PID {p.pid}',flush=True)
    failed=[]
    while active:
        for name,(p,log) in list(active.items()):
            code=p.poll()
            if code is not None:
                log.close();del active[name]
                if code:failed.append(name)
        dump(status_path,dict(status='running' if active else 'failed' if failed else 'complete',
             pid=os.getpid(),active={n:p.pid for n,(p,_) in active.items()},failed=failed))
        if active:time.sleep(5)
    return bool(failed)


if __name__=='__main__':raise SystemExit(main())
