"""Run the predeclared reward arms serially after the control completes."""
import json
import os
from pathlib import Path
import subprocess
import sys
import time

from rl.seeker_runner import CAMPAIGN, ROOT, dump


def main():
    status=CAMPAIGN/'control_250k/status.json'
    while True:
        current=json.loads(status.read_text()) if status.exists() else {}
        if current.get('status')=='complete':break
        if current.get('status')=='failed':raise RuntimeError('Control failed; queue stopped')
        time.sleep(5)
    for variant in ('visibility','removal','icm'):
        name=variant+'_250k'
        dump(CAMPAIGN/'queue_status.json',dict(status='running',active=name))
        command=[sys.executable,'-u','-m','rl.seeker_runner','train','--name',name,
                 '--variant',variant,'--steps','253952']
        print('Starting '+name,flush=True)
        with (CAMPAIGN/(name+'_console.log')).open('x',encoding='utf-8') as out:
            child=subprocess.run(command,cwd=ROOT,stdout=out,stderr=subprocess.STDOUT,
                                 creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
        if child.returncode:
            dump(CAMPAIGN/'queue_status.json',dict(status='failed',active=name,exit_code=child.returncode))
            raise RuntimeError(f'{name} failed; inspect its console and status')
    dump(CAMPAIGN/'queue_status.json',dict(status='complete',runs=['control_250k','visibility_250k','removal_250k','icm_250k']))
    print('All four reward arms completed',flush=True)


if __name__=='__main__':main()
