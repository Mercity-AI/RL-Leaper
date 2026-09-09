"""Refresh a small, shareable index of current and archived seeker campaigns."""
import json
from datetime import datetime,timezone
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
CAMPAIGNS={
    'seeker_20260909':'Earlier fine-tuning; inherited walker, not scratch',
    'seeker_round2_20260909':'Superseded warm continuation; do not resume',
    'seeker_scratch_20260909':'Superseded constant-LR scratch; do not resume',
    'seeker_scratch_lr_20260909':'Active scheduled scratch and own-model extensions',
}


def main():
    rows=[]
    for campaign,meaning in CAMPAIGNS.items():
        folder=ROOT/'rl_artifacts'/campaign
        if not folder.exists():continue
        for cfg_path in sorted(folder.glob('*/config.json')):
            run=cfg_path.parent;cfg=json.loads(cfg_path.read_text())
            status=json.loads((run/'status.json').read_text()) if (run/'status.json').exists() else {}
            evaluations=[]
            for p in run.glob('dev_*_summary.json'):
                try:step=int(p.name.split('_')[1])
                except ValueError:continue
                s=json.loads(p.read_text())
                evaluations.append(dict(step=step,arrival=s.get('success_rate'),discovery=s.get('detection_rate')))
            evaluations.sort(key=lambda v:v['step'])
            rows.append(dict(campaign=campaign,campaign_meaning=meaning,run=run.name,
                artifact_dir=run.relative_to(ROOT).as_posix(),status=status.get('status','unknown'),
                trained_steps=status.get('transitions',status.get('timesteps')),
                seed=cfg.get('extension_seed',cfg.get('seed')),donor=cfg.get('donor'),
                parent_checkpoint=cfg.get('parent_checkpoint'),parameters=cfg.get('trainable_parameters'),
                learning_rate_schedule=cfg.get('learning_rate_schedule'),
                hypothesis=cfg.get('hypothesis'),evaluations=evaluations))
    stamp=datetime.now(timezone.utc).isoformat()
    result=dict(updated_utc=stamp,scope='Four September9 seeker campaigns; older PPO history remains in TRAINING.md',
                note='Development evaluations only; fine-tuned and scratch origins differ. Read live statuses before acting.',runs=rows)
    out=ROOT/'docs';(out/'SEEKER_RUN_INDEX.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
    lines=['# Seeker run index','',f'Generated UTC: {stamp}','',result['scope']+'.',
        '',result['note'],'','Regenerate with `python -m rl.seeker_run_index`. No training is launched.','']
    for campaign,meaning in CAMPAIGNS.items():
        lines += [f'## {campaign}', '',meaning,'',
            '| Run | Status | Latest DEV step | Arrival | Discovery |','|---|---|---:|---:|---:|']
        for r in rows:
            if r['campaign']!=campaign:continue
            e=r['evaluations'][-1] if r['evaluations'] else {}
            fmt=lambda v:f'{v:.1%}' if v is not None else '—'
            lines.append(f"| [{r['run']}](../{r['artifact_dir']}/config.json) | {r['status']} | {e.get('step','—')} | {fmt(e.get('arrival'))} | {fmt(e.get('discovery'))} |")
        lines.append('')
    (out/'SEEKER_RUN_INDEX.md').write_text('\n'.join(lines),encoding='utf-8')
    print(f'Indexed {len(rows)} runs; {stamp}')


if __name__=='__main__':main()
