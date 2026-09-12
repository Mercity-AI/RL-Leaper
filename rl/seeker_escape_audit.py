"""Bounded saved-action geometry audit; no model loading, training, or benchmark run.

Run with the repository Python dependencies: python -m rl.seeker_escape_audit.
Only three explicitly named DEV replay files are read. Counterfactual state lives
in isolated local objects; shared environment code/configuration is never edited.
"""
import ast
import copy
import hashlib
import json
import gzip
import math
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from rl.seeker_env import SeekerEnv

ROOT = Path(__file__).resolve().parents[1]
CAMPAIGN = ROOT / 'rl_artifacts/seeker_scratch_lr_20260909'
RUN = CAMPAIGN / 'residual_lstm_extension_2m'
STEPS = (1056768, 1105920, 1155072)
NINE = [(t, r) for t in (-1., 0., 1.) for r in (-1., 0., 1.)]
DENSE = [(float(t), float(r)) for t in np.linspace(-1, 1, 5)
         for r in np.linspace(-1, 1, 41)]


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


# Reuse exactly the reviewed pure geometry function without importing the old
# diagnostic's Torch/PPO dependencies or executing its model-evaluation entrypoint.
tree = ast.parse((ROOT / 'rl/seeker_contact_diagnostic.py').read_text())
nodes = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in ('resolve', 'margins')]
exec(compile(ast.Module(body=nodes, type_ignores=[]), '<reviewed geometry>', 'exec'))


def option(env, p, y, action):
    q, z, part = resolve(env, p, y, action)
    return dict(action=list(action), translation=float(np.linalg.norm(q-p)),
                rotation=abs((z-y+math.pi) % (2*math.pi)-math.pi),
                intended_collision=part, position=q.tolist(), yaw=z)


def counters(stuck, freeze, moved, collision):
    return (stuck+1 if collision and moved <= .001 else 0,
            freeze+1 if moved <= .001 else 0)


def witness(env, p, y, actions, stuck, freeze, step):
    origin = p.copy()
    records = []
    alive = True
    for a in actions:
        o = option(env, p, y, a)
        p, y = np.array(o['position'], dtype=np.float32), o['yaw']
        stuck, freeze = counters(stuck, freeze, o['translation'], o['intended_collision'])
        step += 1
        reached = float(np.linalg.norm(p-env.target)) <= env.TARGET_RADIUS+env.AGENT_RADIUS
        terminal = reached or stuck >= 40 or (freeze >= 60 and not reached) or step >= 1000
        records.append(dict(**o, stuck=stuck, freeze=freeze, episode_step=step,
                            reached=reached, terminal=terminal))
        if terminal:
            alive = False
            break
    return dict(actions=[list(a) for a in actions], executed=records,
                completed_before_failure=len(records) == len(actions) and
                (alive or records[-1]['reached']),
                net_displacement=float(np.linalg.norm(p-origin)))


def audit_pose(env, frames, i, cs):
    f, nxt = frames[i], frames[i+1]
    p, y = np.array(f['position'], dtype=np.float32), f['yaw']
    stuck, freeze = cs[i]
    nine = [option(env, p, y, a) for a in NINE]
    dense = [option(env, p, y, a) for a in DENSE]
    mobile = [o for o in dense if o['translation'] > .001]
    label = ('immediate_translation' if mobile else
             'rotation_only_on_grid' if any(o['rotation'] > 1e-8 for o in dense)
             else 'no_grid_motion')
    # Validate nine geometry/counter predictions against actual unmodified step().
    # No reset/arena generation/model inference; reconstruct only state relevant
    # to geometry, counters and termination. Rewards/observations are not audited.
    checks = []
    for a, expected in zip(NINE, nine):
        clone = copy.deepcopy(env)
        clone.position, clone.yaw = p.copy(), y
        clone.steps, clone.stuck_steps, clone.freeze_steps = i, stuck, freeze
        clone.prev_distance = clone.best_distance = clone._distance()
        _, _, term, trunc, info = clone.step(np.asarray(a, dtype=np.float32))
        sc, fc = counters(stuck, freeze, expected['translation'], expected['intended_collision'])
        checks.append(np.array_equal(clone.position, np.array(expected['position'], dtype=np.float32))
                      and clone.yaw == expected['yaw']
                      and info['collision_part'] == expected['intended_collision']
                      and clone.stuck_steps == sc and clone.freeze_steps == fc
                      and bool(term or trunc) == bool(info['is_success'] or sc >= 40 or fc >= 60 or i+1 >= 1000))
        clone.close()
    paths = []
    if mobile:
        best = max(mobile, key=lambda o: o['translation'])
        paths.append(witness(env, p.copy(), y, [best['action']], stuck, freeze, i))
    # Even when an immediate move exists, inspect pure-pivot then translation as
    # a separate possibility. Six fixed signed turn rates, <=60 pivot actions each;
    # at each reachable pivot pose try the nine immediate actions. No graph search.
    for rate in (-1., 1., -.5, .5, -.1, .1):
        py = y
        actions = []
        found = None
        for k in range(1, 61):
            o = option(env, p, py, (-1., rate))
            if o['rotation'] <= 1e-8:
                break
            py = o['yaw']
            actions.append((-1., rate))
            choices = [option(env, p, py, a) for a in NINE]
            choices = [o for o in choices if o['translation'] > .001]
            if choices:
                best = max(choices, key=lambda o: o['translation'])
                found = witness(env, p.copy(), y, actions+[best['action']], stuck, freeze, i)
                found['geometry_pivot_steps'] = k
                found['turn_rate'] = rate
                break
        if found:
            paths.append(found)
    return dict(pre_action_frame=i, position=p.tolist(), yaw=y,
                target_ever_seen=f['target_ever_seen'], stuck_before=stuck, freeze_before=freeze,
                saved_next_action=nxt['action'], saved_next_collision=nxt['info']['collision_part'],
                saved_translation=float(np.linalg.norm(np.array(nxt['position'], dtype=np.float32)-p)),
                pose_collision=env._collision_for_pose(p, y), margins=margins(env, p, y), classification=label,
                nine=nine, dense_translation_actions=len(mobile),
                dense_rotation_actions=sum(o['rotation'] > 1e-8 for o in dense),
                dense_best_translation=max(dense, key=lambda o: o['translation']),
                step_validation_checks=len(checks), step_validation_passed=all(checks),
                witnesses=paths)


def main():
    start = time.monotonic()
    report = dict(created_utc=datetime.now(timezone.utc).isoformat(), diagnostic_only=True,
                  no_model_inference=True, checkpoints=list(STEPS), inputs={}, episodes=[],
                  selection='All retained failures in three fixed checkpoints; at most three pre-action poses per failure: terminal no-motion streak start, midpoint, last. Timeout without final no-motion streak: last pose only.',
                  immediate_grid=dict(throttle=5, turn=41),
                  pivot_search=dict(rates=[-1, 1, -.5, .5, -.1, .1], maximum_pivots=60,
                                    forward_test='nine actions after each pivot'),
                  limitations=['Retained fixed seed panel plus worst failure; not representative.',
                               'First translation >0.001 is local mobility, not escape to goal.',
                               'Finite grids/sequences cannot establish exhaustive impossibility.',
                               'Geometry-only paths may outlive actual terminal rules; witness records stop at termination.'])
    sources = [ROOT / p for p in ('rl_environment.py', 'rl/seeker_env.py',
               'rl/seeker_contact_diagnostic.py', 'rl/seeker_metrics.py', 'rl/seeker_round2.py',
               'rl/seeker_escape_audit.py')]
    sources += [RUN / 'source_hashes.json', RUN / 'config.json']
    for step in STEPS:
        path = RUN / f'dev_{step}_replays.json.gz'
        sources += [path, RUN / f'model_{step}.zip']  # hash bytes only; never load weights
        data = json.loads(gzip.decompress(path.read_bytes()))
        for ep in data['episodes']:
            assert 30000 <= ep['seed'] <= 30199
            if ep['metrics']['success']:
                continue
            env = SeekerEnv('control')
            env.obstacles = tuple(tuple(o) for o in ep['obstacles'])
            env.target = np.array(ep['target'], dtype=np.float32)
            assert ep['world_limit'] == env.WORLD_LIMIT
            frames = ep['frames']
            cs = [(0, 0)]
            mismatch = []
            for i in range(len(frames)-1):
                f, nxt = frames[i:i+2]
                p = np.array(f['position'], dtype=np.float32)
                q, z, part = resolve(env, p, f['yaw'], nxt['action'])
                if not (np.array_equal(q, np.array(nxt['position'], dtype=np.float32))
                        and z == nxt['yaw'] and part == nxt['info']['collision_part']):
                    mismatch.append(i)
                cs.append(counters(*cs[-1], float(np.linalg.norm(q-p)), part))
            last = len(frames)-2
            onset = max(0, len(frames)-1-cs[-1][1])
            indices = sorted({min(onset, last), (min(onset, last)+last)//2, last})
            result = dict(checkpoint=step, seed=ep['seed'], labels=ep['labels'],
                          metrics=ep['metrics'], replay=str(path.relative_to(ROOT)),
                          target=ep['target'], obstacles=ep['obstacles'],
                          replay_transitions_checked=len(frames)-1,
                          geometry_mismatch_frames=mismatch,
                          final_stuck=cs[-1][0], final_freeze=cs[-1][1],
                          poses=[audit_pose(env, frames, i, cs) for i in indices])
            report['episodes'].append(result)
            env.close()
            print(f"Audited {step} seed {ep['seed']}: {len(indices)} poses", flush=True)
    for p in sources:
        report['inputs'][str(p.relative_to(ROOT))] = digest(p)
    snapshot = json.loads((RUN / 'source_hashes.json').read_text())
    report['launch_source_matches'] = {
        name: digest(ROOT / name) == snapshot[Path(name).name]
        for name in ('rl_environment.py', 'rl/seeker_env.py', 'rl/seeker_contact_diagnostic.py',
                     'rl/seeker_round2.py')}
    poses = [p for e in report['episodes'] for p in e['poses']]
    report['summary'] = dict(episodes=len(report['episodes']), poses=len(poses),
        classifications=dict(Counter(p['classification'] for p in poses)),
        saved_blocked_poses=sum(p['saved_translation'] <= .001 for p in poses),
        poses_with_legal_mobility_witness=sum(any(w['completed_before_failure'] for w in p['witnesses']) for p in poses),
        poses_with_pivot_witness=sum(any(w.get('geometry_pivot_steps') and w['completed_before_failure'] for w in p['witnesses']) for p in poses),
        geometry_only_witnesses_cut_by_rules=sum(not w['completed_before_failure'] for p in poses for w in p['witnesses']),
        replay_transitions_checked=sum(e['replay_transitions_checked'] for e in report['episodes']),
        replay_mismatches=sum(len(e['geometry_mismatch_frames']) for e in report['episodes']),
        actual_step_checks=sum(p['step_validation_checks'] for p in poses),
        actual_step_checks_passed=all(p['step_validation_passed'] for p in poses))
    report['elapsed_seconds'] = time.monotonic()-start
    out = CAMPAIGN / 'escape_audit/escape_audit_2026-09-09.json'
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=2, allow_nan=False)+'\n', encoding='utf-8')
    print(json.dumps(report['summary'], indent=2), flush=True)
    assert report['summary']['replay_mismatches'] == 0
    assert report['summary']['actual_step_checks_passed']


if __name__ == '__main__':
    main()
