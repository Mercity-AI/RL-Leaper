"""Summarize the frozen fixed-policy comparison on reserved mazes."""
import json
import math
from pathlib import Path

import numpy as np

from rl.seeker_runner import CAMPAIGN, digest, dump


def wilson(successes, n):
    z = 1.959963984540054
    p = successes / n
    denominator = 1 + z*z/n
    center = (p + z*z/(2*n)) / denominator
    half = z * math.sqrt(p*(1-p)/n + z*z/(4*n*n)) / denominator
    return [center-half, center+half]


def main():
    selection = json.loads((CAMPAIGN/'screen_selection.json').read_text())
    models = [selection['selected'], selection['matched_control']]
    panels = []
    summaries = []
    for model in models:
        if digest(Path(model['model'])) != model['sha256']:
            raise RuntimeError('Frozen model hash changed')
        prefix = CAMPAIGN / (model['name'] + '_confirmation')
        rows = json.loads(Path(str(prefix)+'_episodes.json').read_text())
        by_seed = {r['seed']: r for r in rows}
        if len(rows) != 1000 or set(by_seed) != set(range(80000, 81000)):
            raise RuntimeError('Confirmation must contain exactly the frozen 1000 seeds')
        panel = np.array([by_seed[s]['success'] for s in range(80000, 81000)], dtype=float)
        summary = json.loads(Path(str(prefix)+'_summary.json').read_text())
        if not np.isclose(panel.mean(), summary['success_rate']):
            raise RuntimeError('Episode outcomes disagree with summary')
        summaries.append(dict(name=model['name'], successes=int(panel.sum()),
            episodes=1000, arrival=float(panel.mean()), wilson95=wilson(panel.sum(),1000),
            discovery=summary['detection_rate'],
            arrival_given_discovery=summary['success_given_detection'],
            arrival_steps_success=summary['mean_arrival_steps'],
            arrival_steps_failure_capped=summary['mean_arrival_steps_capped'],
            failures=summary['failure_counts']))
        panels.append(panel)
    differences = panels[0] - panels[1]
    rng = np.random.default_rng(20260909)
    samples = np.array([rng.choice(differences, size=1000, replace=True).mean()
                        for _ in range(10000)])
    result = dict(models=summaries, arrival_difference=float(differences.mean()),
        paired_bootstrap95=np.quantile(samples,[.025,.975]).tolist(),
        candidate_only_success=int((differences==1).sum()),
        control_only_success=int((differences==-1).sum()),
        bootstrap_samples=10000, bootstrap_seed=20260909,
        limitation='Fixed-policy maze uncertainty only; one training seed, no estimate of training-seed variability. Confirmation was not used for selection.')
    dump(CAMPAIGN/'confirmation_comparison.json', result)
    lines = ['# Reserved-maze confirmation', '',
        'Frozen candidate and equal-budget control; 1,000 identical reserved mazes per policy.', '',
        '| Policy | Arrival | 95% Wilson interval | Discovery | Arrival after discovery |',
        '|---|---:|---:|---:|---:|']
    for s in summaries:
        lo, hi = s['wilson95']
        lines.append(f"| {s['name']} | {s['arrival']:.1%} | {lo:.1%}–{hi:.1%} | {s['discovery']:.1%} | {s['arrival_given_discovery']:.1%} |")
    lo, hi = result['paired_bootstrap95']
    lines += ['', f"Arrival difference: **{result['arrival_difference']*100:+.1f} percentage points**; paired bootstrap 95% interval [{lo*100:+.1f}, {hi*100:+.1f}].",
        '', result['limitation'], '',
        'The >90% target is ' + ('exceeded on this panel.' if summaries[0]['arrival']>.9 else 'not achieved.'),
        '', 'Model hashes and selection precede this exam in `screen_selection.json`. Complete episode outcomes and failure/timing metrics accompany each confirmation summary.']
    (CAMPAIGN/'report'/'confirmation_comparison.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')
    print(json.dumps(result,indent=2))


if __name__ == '__main__':
    main()
