"""Read-only evaluation audit. Run from repository root: python -m rl.seeker_audit."""
import hashlib
import io
import json
from pathlib import Path
import unittest
from unittest.mock import patch

import numpy as np
import torch

from rl_environment import LeaperReachEnv

ROOT = Path(__file__).resolve().parents[1]
DONOR = ROOT / 'rl_artifacts/ppo_35_frontier_seed025_500k_s1/leaper_ppo.zip'
ARCHIVE = ROOT / 'rl_artifacts/note_gate/note_gate_full.json'
OUTPUT = ROOT / 'rl_artifacts/seeker_20260909/audit.json'


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def audit_gate():
    import eval_note_gate as old
    from stable_baselines3 import PPO

    model = PPO.load(DONOR, device='cpu')
    traces = []

    class TracedEnv(LeaperReachEnv):
        NORMALIZED_THROTTLE = True
        FRONTIER_NOTE = True
        COVERAGE_MAP = False

        def reset(self, **kwargs):
            obs, info = super().reset(**kwargs)
            traces.append([])
            traces[-1].append((obs.copy(), self.position.copy(), self.yaw,
                               bool(self.target_ever_seen)))
            return obs, info

        def step(self, action):
            result = super().step(action)
            traces[-1].append((result[0].copy(), self.position.copy(), self.yaw,
                               bool(self.target_ever_seen), np.array(action).copy()))
            return result

    rows = []
    # Exercise the actual old rollout, replacing only its env factory with an
    # identically configured subclass to avoid old.run's global flag mutations.
    with patch.object(old, 'LeaperReachEnv', TracedEnv):
        for seed in range(10000, 10006):
            on = old.rollout(model, seed, False)
            gated = old.rollout(model, seed, True)
            a, b = traces[-2:]
            first = on['first_detection_step']
            through = first if first is not None else on['steps']
            mismatches = []
            for step in range(through + 1):
                if step >= len(b) or any(not np.array_equal(x, y) for x, y in zip(a[step], b[step])):
                    mismatches.append(step)
            rows.append({'seed': seed, 'first_detection_step_on': first,
                         'first_detection_step_gated': gated['first_detection_step'],
                         'compared_transitions': through,
                         'reset_already_detected': first == 0,
                         'exact_observation_action_pose_equality': not mismatches,
                         'mismatch_steps': mismatches, 'note_on': on, 'note_gated': gated})

    archive = json.loads(ARCHIVE.read_text(encoding='utf-8'))
    counts = {}
    errors = []
    pooled = {'note_on': [], 'note_gated': []}
    for key, entry in archive.items():
        if key.startswith('_'):
            continue
        counts[key] = {}
        for mode, field in (('note_on', 'episodes_on'), ('note_gated', 'episodes_gated')):
            episodes = entry[field]
            summary = old.summarize(episodes)
            pooled[mode].extend(episodes)
            if summary != entry[mode]:
                errors.append(f'{key}/{mode}: saved summary differs from episode rows')
            if sorted(r['seed'] for r in episodes) != list(range(10000, 10100)):
                errors.append(f'{key}/{mode}: wrong or duplicate seeds')
            counts[key][mode] = {'episodes': len(episodes),
                                'detected': sum(r['detected'] for r in episodes),
                                'success': sum(r['success'] for r in episodes),
                                'endings': summary['endings']}
        on_by_seed = {r['seed']: r for r in entry['episodes_on']}
        for r in entry['episodes_gated']:
            if r['first_detection_step'] != on_by_seed[r['seed']]['first_detection_step']:
                errors.append(f'{key}/{r["seed"]}: first detection differs')
    for mode, episodes in pooled.items():
        if old.summarize(episodes) != archive['_pooled'][mode]:
            errors.append(f'pooled/{mode}: summary mismatch')
    attempts = sum(map(len, pooled.values()))
    if attempts != archive['_pooled']['attempts']:
        errors.append('pooled attempt count mismatch')
    # Compare the six rerun outcomes to their archived records as well.
    donor_archive = archive['PPO_35_s1']
    for row in rows:
        for mode, field in (('note_on', 'episodes_on'), ('note_gated', 'episodes_gated')):
            prior = next(r for r in donor_archive[field] if r['seed'] == row['seed'])
            if row[mode] != prior:
                errors.append(f'PPO_35_s1/{row["seed"]}/{mode}: rerun differs from archive')
    return {'trajectories': rows, 'archive_counts': counts, 'archive_attempts': attempts,
            'archive_consistency_errors': errors,
            'passed': not errors and all(r['exact_observation_action_pose_equality'] and
                       r['first_detection_step_on'] == r['first_detection_step_gated'] for r in rows)}


def main():
    torch.set_num_threads(1)
    protected = [ROOT / p for p in ('rl_environment.py', 'rl/seeker_env.py', 'train_rl.py',
                                    'eval_note_gate.py', 'run_seeker.ps1')]
    before = {str(p.relative_to(ROOT)): digest(p) for p in protected}
    defaults = {k: v for k, v in vars(LeaperReachEnv).items() if k.isupper()}
    stream = io.StringIO()
    suite = unittest.defaultTestLoader.discover(str(ROOT / 'tests'), pattern='test_seeker_env.py')
    result = unittest.TextTestRunner(stream=stream, verbosity=2).run(suite)
    report = {'training_performed': False, 'torch_threads': torch.get_num_threads(),
              'donor': str(DONOR), 'donor_sha256': digest(DONOR),
              'archive': str(ARCHIVE), 'archive_sha256': digest(ARCHIVE),
              'tests': {'run': result.testsRun, 'failures': len(result.failures),
                        'errors': len(result.errors), 'skipped': len(result.skipped),
                        'output': stream.getvalue()}}
    try:
        report['note_gate'] = audit_gate()
    except Exception as exc:
        import traceback
        report['note_gate'] = {'passed': False, 'error': str(exc), 'traceback': traceback.format_exc()}
    report['production_defaults_unchanged'] = defaults == {
        k: v for k, v in vars(LeaperReachEnv).items() if k.isupper()}
    report['protected_file_sha256'] = before
    report['protected_files_unchanged'] = all(digest(p) == before[str(p.relative_to(ROOT))] for p in protected)
    report['passed'] = (result.wasSuccessful() and not result.skipped and
                        report['note_gate']['passed'] and report['production_defaults_unchanged'] and
                        report['protected_files_unchanged'])
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(stream.getvalue())
    print(json.dumps({k: v for k, v in report.items() if k not in ('tests', 'protected_file_sha256')}, indent=2))
    print(f'Wrote {OUTPUT}')
    return 0 if report['passed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
