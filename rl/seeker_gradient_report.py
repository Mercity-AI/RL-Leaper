"""Read-only optimizer telemetry audit; never loads or modifies a model."""
import csv
import json
from pathlib import Path
from statistics import median

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

ROOT = Path(__file__).resolve().parents[1]
CAMPAIGN = ROOT / 'rl_artifacts/seeker_scratch_lr_20260909'


def main():
    out = CAMPAIGN / 'gradient_audit'
    out.mkdir(exist_ok=True)
    series = {}
    evaluations = []
    for kind in ('lstm', 'mlp'):
        rows = []
        for suffix in ('', '_extension_2m'):
            run = CAMPAIGN / f'residual_{kind}{suffix}'
            with (run / 'tensorboard/progress.csv').open(newline='') as stream:
                for row in csv.DictReader(stream):
                    if row.get('time/total_timesteps') and row.get('train/learning_rate'):
                        rows.append({k: float(v) for k, v in row.items() if v and
                                     (k.startswith('train/') or k == 'time/total_timesteps')})
            if kind == 'lstm':
                evaluations.extend(json.loads(line) for line in
                                   (run / 'evaluations.jsonl').read_text().splitlines() if line)
        series[kind] = sorted(rows, key=lambda r: r['time/total_timesteps'])
    metrics = ('gradient_norm', 'learning_rate', 'approx_kl', 'clip_fraction',
               'value_loss', 'explained_variance')
    audit = {'semantics': {
        'gradient_norm': 'Mean minibatch combined actor+critic L2 norm BEFORE clipping; limit 0.5.',
        'clip_fraction': 'PPO probability-ratio clipping, NOT gradient clipping.',
        'missing': 'Per-branch gradients, postclip norms, clipping frequency, actual optimizer weight deltas.',
        'timing': 'Training rows use logger step labels; PPO metrics can describe the preceding rollout update.',
        'causality': 'Correlations do not establish LR or critic domination as plateau cause.'}, 'windows': []}
    for kind, rows in series.items():
        for low, high in ((0, 254000), (254000, 508000), (508000, 900000),
                          (900000, 1200000), (1200000, float('inf'))):
            group = [r for r in rows if low < r['time/total_timesteps'] <= high]
            audit['windows'].append({'model': kind, 'from': low,
                'through': max((r['time/total_timesteps'] for r in group), default=None),
                'rows': len(group), 'medians': {m: median([r['train/'+m] for r in group
                    if 'train/'+m in r]) for m in metrics
                    if any('train/'+m in r for r in group)}})
    (out / 'audit.json').write_text(json.dumps(audit, indent=2))
    fig, axes = plt.subplots(2, 2, figsize=(12, 8), constrained_layout=True)
    specifications = [('gradient_norm', 'Raw combined gradient norm (before clipping)'),
                      ('learning_rate', 'Actual optimizer learning rate'),
                      ('approx_kl', 'Policy change: approximate KL'),
                      (None, 'Deterministic arrival: same 200 development mazes')]
    for ax, (metric, title) in zip(axes.flat, specifications):
        if metric:
            for kind, color in (('lstm', '#16805d'), ('mlp', '#b85535')):
                rows = [r for r in series[kind] if 'train/'+metric in r]
                if not rows:
                    continue
                xs = [r['time/total_timesteps']/1e6 for r in rows]
                ys = [r['train/'+metric] for r in rows]
                ax.plot(xs, ys, alpha=.2, color=color)
                smooth = [median(ys[max(0, i-4):i+1]) for i in range(len(ys))]
                ax.plot(xs, smooth, color=color, label=kind.upper()+' (5-row median)')
            if metric == 'gradient_norm':
                ax.axhline(.5, color='#555555', ls='--', label='Gradient clip limit: 0.5')
                ax.set_yscale('log')
            if metric == 'learning_rate':
                ax.set_yscale('log')
        else:
            evaluations.sort(key=lambda e: e['transitions'])
            ax.plot([e['transitions']/1e6 for e in evaluations],
                    [100*e['summary']['success_rate'] for e in evaluations],
                    'o-', color='#16805d', markersize=3, label='LSTM arrival (%)')
            ax.set_ylim(0, 100)
        ax.axvline(.507904, color='gray', ls=':', alpha=.7)
        ax.set_title(title, fontsize=11)
        ax.set_xlabel('Million environment transitions')
        ax.grid(alpha=.2)
        ax.legend(fontsize=8)
    fig.suptitle('LSTM plateau audit: raw gradients grow while policy changes shrink\n'
                 'Vertical dotted line: own-checkpoint extension; no upward LR reset', fontsize=13)
    fig.savefig(out / 'optimizer_trends.png', dpi=160)
    plt.close(fig)
    print(json.dumps({'output': str(out), 'latest_evaluation': {
        'steps': evaluations[-1]['transitions'],
        'arrival': evaluations[-1]['summary']['success_rate']}, 'windows': audit['windows']}, indent=2))


if __name__ == '__main__':
    main()
