"""Audit archived training ancestry without loading or executing model weights."""
import json
import zipfile
from pathlib import Path
from rl.seeker_runner import ROOT,dump,digest


def main():
    model=ROOT/'rl_artifacts/ppo_35_frontier_seed025_500k_s1/leaper_ppo.zip'
    seen=set();lineage=[]
    while model:
        model=model.resolve()
        if model in seen:raise RuntimeError('Ancestry cycle')
        seen.add(model)
        config_path=model.parent/'training_config.json'
        config=json.loads(config_path.read_text())
        final_path=model.parent/'final_evaluation.json'
        final=json.loads(final_path.read_text()) if final_path.exists() else {}
        with zipfile.ZipFile(model) as archive:
            metadata=json.loads(archive.read('data'))
        transfer=config.get('warm_transfer')
        warm=config.get('warm_start')
        parent=transfer or warm
        lineage.append(dict(run=model.parent.name,model=str(model),sha256=digest(model),
            requested_steps=config.get('requested_timesteps'),
            collected_steps=final.get('collected_timesteps'),
            checkpoint_step_counter=metadata.get('num_timesteps'),
            connection='weight transfer' if transfer else 'warm start' if warm else 'fresh',parent=parent))
        model=ROOT/parent if parent else None
    result=dict(newest_first=lineage,
        total_recorded_ancestor_steps=sum(r['collected_steps'] or 0 for r in lineage),
        missing_counts=[r['run'] for r in lineage if r['collected_steps'] is None],
        caveat='Ancestral experience spans changing environments, observations, actions and rewards; it is not equivalent to this many scratch steps on the current task. Counts are per-stage final logs; checkpoint counters cross-check resets.')
    dump(ROOT/'rl_artifacts/seeker_20260909/donor_lineage.json',result)
    print(json.dumps(result,indent=2))


if __name__=='__main__':main()
