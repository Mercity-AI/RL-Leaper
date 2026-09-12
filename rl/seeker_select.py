"""Freeze the completed six-arm screen before accessing confirmation mazes."""
import json

from rl.seeker_runner import CAMPAIGN, digest, dump


def main():
    destination = CAMPAIGN / 'screen_selection.json'
    if destination.exists():
        raise FileExistsError('Selection is frozen; do not overwrite it')
    names = ['control_250k', 'visibility_250k', 'removal_250k', 'icm_250k',
             'footprint_250k', 'stall_memory_250k']
    candidates = []
    for name in names:
        directory = CAMPAIGN / name
        status = json.loads((directory / 'status.json').read_text())
        if status['status'] != 'complete' or status['transitions'] != 253952:
            raise RuntimeError(f'{name} has not completed the fixed screen')
        for step in (106496, 253952):
            summary = json.loads((directory / f'dev_{step}_summary.json').read_text())
            failures = summary['failure_counts']
            model = directory / f'model_{step}.zip'
            candidates.append(dict(name=name, transitions=step, model=str(model),
                sha256=digest(model), arrival=summary['success_rate'],
                early_physical_failures=sum(v for k, v in failures.items()
                                            if k.endswith(('_stuck', '_frozen'))),
                capped_arrival_steps=summary['mean_arrival_steps_capped']))
    candidates.sort(key=lambda c: (-c['arrival'], c['early_physical_failures'],
                                   c['capped_arrival_steps']))
    winner = candidates[0]
    control = next(c for c in candidates if c['name'] == 'control_250k'
                   and c['transitions'] == winner['transitions'])
    result = dict(scope='Completed six-arm September 9 screen; no recurrent models',
        rule='Highest dev arrival, then fewer early physical failures, then lower capped arrival time',
        selected=winner, matched_control=control, ranked_candidates=candidates,
        confirmation_seeds=[80000, 80999], confirmation_episodes=1000,
        confirmation_used_for_selection=False,
        interpretation='One training run per configuration. Confirmation compares fixed policies, not training-seed repeatability.')
    dump(destination, result)
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
