"""Focused best fine-tune versus scratch LSTM learning-trajectory comparison."""
import csv
import json
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from rl.seeker_scratch import ROOT,CAMPAIGN


def main():
    out=CAMPAIGN/'best_comparison';out.mkdir(exist_ok=True)
    runs=[]
    for label,folder,color in [
        ('Earlier fine-tuned MLP',ROOT/'rl_artifacts/seeker_20260909/removal_250k','#2266ad'),
        ('Scratch MLP + LSTM',CAMPAIGN/'residual_lstm','#198459')]:
        points=[json.loads(l) for l in (folder/'evaluations.jsonl').read_text().splitlines()]
        if 'removal_250k'==folder.name:
            points.insert(0,dict(transitions=0,summary=json.loads((folder.parent/'baseline_dev_summary.json').read_text())))
        rows=list(csv.DictReader((folder/'tensorboard/progress.csv').open()))
        if folder.name=='residual_lstm':
            extension=CAMPAIGN/'residual_lstm_extension_2m'
            if (extension/'evaluations.jsonl').exists():
                points.extend(json.loads(l) for l in (extension/'evaluations.jsonl').read_text().splitlines())
            if (extension/'tensorboard/progress.csv').exists():
                rows.extend(csv.DictReader((extension/'tensorboard/progress.csv').open()))
        lr=[(float(r['time/total_timesteps'])/1000,float(r['train/learning_rate']))
            for r in rows if r.get('time/total_timesteps') and r.get('train/learning_rate')]
        # The final evaluation dump can carry LR without a time column. Use the
        # final completed saved checkpoint's optimizer rate, audited separately.
        final_rate=next(float(r['train/learning_rate']) for r in reversed(rows) if r.get('train/learning_rate'))
        lr.append((points[-1]['transitions']/1000,final_rate))
        runs.append(dict(label=label,color=color,points=points,lr=lr))
    plt.rcParams.update({'font.size':11,'axes.spines.top':False,'axes.spines.right':False})
    note='Same 200 development mazes. Fine-tune starts after 2.29M ancestral steps; LSTM starts from random weights.\nHorizontal axis counts steps within each plotted phase, not equal lifetime training. Lines connect sparse measured checkpoints.'
    for filename,specs,title in [
        ('outcomes.png',[('success_rate','Reached target (%)',100),('detection_rate','Discovered target (%)',100)],'Learning outcomes: earlier fine-tune versus scratch LSTM'),
        ('efficiency_lr.png',[('mean_arrival_steps_capped','Arrival time: failures charged 1,000 steps',1),('lr','Learning rate',1)],'Arrival efficiency and learning-rate history')]:
        fig,axes=plt.subplots(1,2,figsize=(12,4.7),layout='constrained')
        for ax,(key,label,scale) in zip(axes,specs):
            for run in runs:
                if key=='lr':x,y=zip(*run['lr'])
                else:
                    x=[p['transitions']/1000 for p in run['points']]
                    y=[p['summary'][key]*scale for p in run['points']]
                ax.plot(x,y,color=run['color'],label=run['label'],lw=2,
                        marker=None if key=='lr' else 'o')
                if key!='lr':
                    for a,b in zip(x,y):
                        ax.annotate(f'{b:.1f}' if scale==100 else f'{b:.0f}',(a,b),
                                    xytext=(0,-17 if key=='detection_rate' and run['color']=='#198459' else 8),textcoords='offset points',ha='center',fontsize=9)
            ax.set_title(label);ax.grid(alpha=.2);ax.set_xlabel('Steps within plotted phase (thousands)')
            if scale==100:ax.set_ylim(0,103)
            if key=='success_rate':ax.axhline(90,color='#777',lw=1,ls='--');ax.text(350,92,'90% goal',fontsize=9,color='#555')
            if key=='lr':ax.ticklabel_format(axis='y',style='sci',scilimits=(0,0));ax.set_ylim(0,.00017)
            if key=='mean_arrival_steps_capped':ax.set_ylim(0,1050)
        fig.suptitle(title,fontsize=15)
        handles,labels=axes[0].get_legend_handles_labels()
        fig.legend(handles,labels,loc='upper center',ncols=2,bbox_to_anchor=(.5,-.03))
        fig.text(.5,-.19,note,ha='center',fontsize=9)
        fig.savefig(out/filename,dpi=150,bbox_inches='tight');plt.close(fig)
    (out/'data.json').write_text(json.dumps(runs,indent=2))
    print(out)


if __name__=='__main__':main()
