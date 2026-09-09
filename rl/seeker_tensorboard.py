"""Add readable failure panels from completed evaluations; never modify training."""
import argparse
import json
import time
from torch.utils.tensorboard import SummaryWriter
from rl.seeker_scratch import CAMPAIGN
from rl.seeker_runner import dump

LAYOUT={
    'Seeker outcomes':{
        'Arrival and discovery (fractions)': ['Multiline',['development/success_rate','development/detection_rate','development/success_given_detection']],
        'Training success is a separate noisy signal': ['Multiline',['stochastic_last100/success']],
        'Before discovery: causes of failure': ['Multiline',['development/failure_rate/pre_detection_stuck','development/failure_rate/pre_detection_frozen','development/failure_rate/pre_detection_truncated']],
        'After discovery: causes of failure': ['Multiline',['development/failure_rate/post_detection_stuck','development/failure_rate/post_detection_frozen','development/failure_rate/post_detection_truncated']],
    },
    'Seeker efficiency':{
        'Failure-capped arrival time (lower is better)': ['Multiline',['development/mean_arrival_steps_capped']],
        'Coverage and collision fractions': ['Multiline',['development/mean_coverage_final','development/mean_collision_rate']],
    },
    'Optimizer':{
        'Learning rate': ['Multiline',['train/learning_rate']],
        'KL and clipping fraction': ['Multiline',['train/approx_kl','train/clip_fraction']],
    },
}


def export():
    for folder in CAMPAIGN.iterdir():
        if not (folder/'config.json').exists():continue
        record=folder/'tensorboard_diagnostic_exports.json'
        done=json.loads(record.read_text()) if record.exists() else []
        pending=[p for p in sorted(folder.glob('dev_*_summary.json')) if p.name not in done]
        layout_marker=folder/'tensorboard_layout.json'
        if not pending and layout_marker.exists():continue
        with SummaryWriter(str(folder/'tensorboard'),filename_suffix='.diagnostics') as writer:
            if not layout_marker.exists():
                writer.add_custom_scalars(LAYOUT)
                dump(layout_marker,LAYOUT)
            for path in pending:
                summary=json.loads(path.read_text())
                step=int(path.name.split('_')[1])
                for key,value in summary['failure_rates'].items():
                    writer.add_scalar('development/failure_rate/'+key,value,step)
                for stratum in ('initially_visible','initially_hidden'):
                    for key in ('success_rate','detection_rate','success_given_detection'):
                        value=summary[stratum].get(key)
                        if isinstance(value,(int,float)):
                            writer.add_scalar(f'development/{stratum}/{key}',value,step)
                done.append(path.name)
            writer.flush()
        dump(record,done)


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--watch',action='store_true')
    args=parser.parse_args()
    while True:
        export()
        if not args.watch:break
        status_paths=[p for p in (CAMPAIGN/'queue_status.json',CAMPAIGN/'extension_queue_status.json') if p.exists()]
        if status_paths and all(json.loads(p.read_text()).get('status') in ('complete','failed','stopped') for p in status_paths):
            break
        time.sleep(15)


if __name__=='__main__':main()
