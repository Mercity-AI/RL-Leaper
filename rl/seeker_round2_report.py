"""Static scientific figures and paired results for round two."""
import json
from pathlib import Path
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from rl.seeker_round2 import CAMPAIGN, DONOR
from rl.seeker_runner import dump


def main():
    out=CAMPAIGN/'report'
    out.mkdir(exist_ok=True)
    runs=[]
    baseline=json.loads((DONOR.parent/'dev_253952_summary.json').read_text()) if DONOR else None
    for folder in CAMPAIGN.iterdir():
        if not (folder/'config.json').exists():continue
        config=json.loads((folder/'config.json').read_text())
        evaluations=[]
        for path in folder.glob('dev_*_summary.json'):
            step=int(path.name.split('_')[1])
            summary=json.loads(path.read_text())
            episodes=json.loads(path.with_name(path.name.replace('_summary','_episodes')).read_text())
            evaluations.append(dict(step=step,summary=summary,episodes=episodes))
        evaluations.sort(key=lambda e:e['step'])
        if evaluations:runs.append(dict(name=folder.name,config=config,evals=evaluations))
    runs.sort(key=lambda r:r['name'])
    if not runs:
        print('No completed evaluations yet');return
    colors=plt.get_cmap('tab10').colors
    fixed_colors={name:colors[i] for i,name in enumerate(
        ('original_mlp','removal_mlp','residual_lstm','residual_mlp','history_mlp','recovery_reward'))}
    fixed_colors.update({name+'_extension_2m':fixed_colors[name] for name in ('residual_lstm','residual_mlp')})
    fig,axes=plt.subplots(2,3,figsize=(16,9),layout='constrained')
    specifications=[('success_rate','Arrival (%)',100),('detection_rate','Target discovery (%)',100),
        ('success_given_detection','Arrival after discovery (%)',100),
        ('mean_arrival_steps_capped','Arrival time: failures charged 1,000 steps',1),
        ('mean_collision_rate','Mean episode collision rate (%)',100),
        ('mean_coverage_final','Visible area coverage at episode end (%)',100)]
    for ax,(key,title,scale) in zip(axes.flat,specifications):
        for i,run in enumerate(runs):
            xs=([0] if baseline else [])+[e['step']/1000 for e in run['evals']]
            ys=([baseline[key]*scale] if baseline else [])+[e['summary'][key]*scale for e in run['evals']]
            ax.plot(xs,ys,marker='o',lw=1.7,color=fixed_colors.get(run['name'],colors[i%10]),label=run['name'].replace('_',' '))
        if key=='success_rate':ax.axhline(90,color='black',ls='--',lw=1,label='90% target')
        ax.set_title(title);ax.set_xlabel(('Additional training' if baseline else 'Training')+' steps (thousands)')
        ax.grid(alpha=.2)
        if scale==100:ax.set_ylim(0,100)
    handles,labels=axes[0,0].get_legend_handles_labels()
    fig.legend(handles,labels,loc='outside lower center',ncols=4,fontsize=9)
    origin='zero-step point is the common transferred walker' if baseline else 'all models start from random weights; no pretrained model'
    fig.suptitle('Static target: deterministic development evaluation on the same 200 mazes\nOne training run per configuration; '+origin,fontsize=14)
    fig.savefig(out/'metrics.png',dpi=150);plt.close(fig)
    labels=[r['name'].replace('_',' ')+f"\n{r['evals'][-1]['step']:,} steps" for r in runs]
    categories=['success','pre_detection_stuck','pre_detection_frozen','pre_detection_truncated',
        'post_detection_stuck','post_detection_frozen','post_detection_truncated']
    category_labels=['arrived','stuck before discovery','frozen before discovery','timeout before discovery',
        'stuck after discovery','frozen after discovery','timeout after discovery']
    fig,ax=plt.subplots(figsize=(12,max(4,len(runs)*.6)),layout='constrained')
    left=np.zeros(len(runs))
    # Episode flags can overlap; choose an explicit exclusive terminal priority.
    outcome_counts=[]
    for run in runs:
        counts={k:0 for k in categories}
        for row in run['evals'][-1]['episodes']:
            key='success' if row['success'] else ('post_detection_' if row['detected'] else 'pre_detection_')+('stuck' if row['stuck'] else 'frozen' if row['frozen'] else 'truncated')
            counts[key]+=1
        outcome_counts.append(counts)
    palette=['#259768','#cb6767','#eaab64','#e0cc83','#992d40','#925484','#7b83b7']
    for key,label,color in zip(categories,category_labels,palette):
        values=np.array([c[key]/2 for c in outcome_counts])
        ax.barh(labels,values,left=left,label=label,color=color)
        left+=values
    ax.set_xlim(0,100);ax.set_xlabel('Episodes (%)');ax.invert_yaxis()
    ax.set_title('How episodes end on the same 200 development mazes\nLatest saved checkpoint; training budget shown beside each run')
    handles,legend_labels=ax.get_legend_handles_labels()
    fig.legend(handles,legend_labels,loc='outside lower center',ncols=3,fontsize=9)
    fig.savefig(out/'outcomes.png',dpi=150,bbox_inches='tight');plt.close(fig)
    lines=['# '+('Round-two results' if baseline else 'From-scratch results'),'',
        'Deterministic development results; one training run per configuration. This is not the reserved confirmation exam.',
        '', '![Metrics](metrics.png)', '', '![Outcomes](outcomes.png)', '',
        '| Experiment | Training steps | Arrival | Discovery | Arrival after discovery |',
        '|---|---:|---:|---:|---:|']
    comparisons=[]
    for run in runs:
        control_name='continuation' if baseline else ('original_mlp' if run['name']=='removal_mlp' else 'residual_mlp' if run['name']=='residual_lstm' else 'removal_mlp')
        if not baseline and run['name'] in ('residual_mlp','history_mlp'):
            control_name='original_mlp'
        if not baseline and run['name']=='residual_lstm_extension_2m':
            control_name='residual_mlp_extension_2m'
        if not baseline and run['name']=='residual_mlp_extension_2m':
            control_name=None
        control=next((r for r in runs if r['name']==control_name),None)
        if not baseline and run['name']=='original_mlp':control=None
        e=run['evals'][-1];s=e['summary']
        lines.append(f"| {run['name']} | {e['step']:,} | {s['success_rate']:.1%} | {s['detection_rate']:.1%} | {s['success_given_detection']:.1%} |")
        if control and run!=control:
            matched=next((v for v in control['evals'] if v['step']==e['step']),None)
            if matched:
                a={row['seed']:row for row in e['episodes']}
                b={row['seed']:row for row in matched['episodes']}
                if set(a)!=set(b):raise RuntimeError('Unpaired seeds')
                diff=np.array([float(a[s]['success'])-float(b[s]['success']) for s in sorted(a)])
                rng=np.random.default_rng(20260909)
                boot=np.array([rng.choice(diff,len(diff)).mean() for _ in range(10000)])
                comparisons.append(dict(name=run['name'],control=control_name,step=e['step'],difference=float(diff.mean()),ci95=np.quantile(boot,[.025,.975]).tolist()))
    lines+=['','## Paired development comparisons','',
        'Current minus the named control at the same recorded budget. Intervals quantify fixed-policy maze uncertainty, not training variability; exploratory comparisons are not adjusted for selection.']
    for item in comparisons:
        lo,hi=item['ci95']
        lines.append(f"- {item['name']} versus {item['control']} at {item['step']:,}: {item['difference']*100:+.1f} points [{lo*100:+.1f}, {hi*100:+.1f}].")
    for run in runs:
        lines+=['',f"## {run['name']}",'',run['config'].get('hypothesis',''),
            '',f"Observation size: {run['config'].get('observation_size')}; policy parameters: {run['config'].get('trainable_parameters')}. Final status and every recorded checkpoint remain in the run directory."]
    dump(out/'comparisons.json',comparisons)
    (out/'README.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')
    print(f'Wrote {out}')


if __name__=='__main__':main()
