"""Exams for the moving-target retrain: the plan's numbers 1-11 for one brain.

``run_exam(model, env_fn, seeds, prefix)`` plays every maze once with the brain
deciding deterministically and writes, like rl/seeker_metrics.py:
<prefix>_summary.json (the numbers), <prefix>_episodes.json (one row per round)
and <prefix>_replays.json.gz (every step of the recorded rounds, for the
training viewer). Nothing is trained.

Numbers (plan, "The numbers we track"): 1 catch rate, 2 re-find rate, 3 goes
her way, 4 hover time, 5 gap while hidden, 6 time to re-find / to catch,
7 still-target catch rate (a separate exam with ``moving=False``), 8 stuck or
frozen, 9 first sighting, 10 bumps, 11 checks the hiding spot.
"""
from __future__ import annotations

import gzip
import json
from pathlib import Path

import numpy as np

from rl.seeker_metrics import EpisodeMetrics, _json
from rl.moving_target_env import summarize_lost_her


def _frame(env, info, action=None, reward=0.0):
    return dict(
        x=round(float(env.position[0]), 3), z=round(float(env.position[1]), 3),
        yaw=round(float(env.yaw), 4), target=[round(float(v), 3) for v in env.target],
        distance=round(float(env._distance()), 3),
        target_visible=bool(env.target_visible), target_ever_seen=bool(env.target_ever_seen),
        target_state=info.get("target_state"),
        collision=bool(info.get("collision", False)), collision_part=info.get("collision_part"),
        vision=[round(float(v), 3) for v in env.last_vision],
        throttle=None if action is None else round(float(action[0]), 3),
        turn=None if action is None else round(float(action[1]), 3),
        reward=round(float(reward), 4))


def run_exam(model, env_fn, seeds, prefix, record_seeds=(), progress=None):
    rows, replays = [], []
    record_seeds = set(record_seeds)
    policy = model.policy
    policy.set_training_mode(False)
    for number, seed in enumerate(seeds):
        env = env_fn()
        obs, info = env.reset(seed=int(seed))
        metrics = EpisodeMetrics().reset(env, obs, info)
        kind = info.get("target_kind")
        frames = [_frame(env, info)] if seed in record_seeds else None
        start_target = env.target.tolist()
        state = None
        for step in range(metrics.cap):
            action, state = model.predict(obs, state=state, episode_start=np.array([step == 0]),
                                          deterministic=True)
            obs, reward, terminated, truncated, info = env.step(action)
            row = metrics.step(env, action, reward, terminated, truncated, info)
            if frames is not None:
                frames.append(_frame(env, info, action, reward))
            if row is not None:
                break
        row.update(seed=int(seed), target_kind=kind, lost_her=info.get("lost_her", {}))
        rows.append(row)
        if frames is not None:
            replays.append(dict(seed=int(seed), target_kind=kind, target=start_target,
                                obstacles=[list(o) for o in env.obstacles],
                                world_limit=float(env.WORLD_LIMIT), frames=frames,
                                metrics={k: row[k] for k in ("success", "reward", "steps", "path_length")}))
        env.close()
        if progress and (number + 1) % 50 == 0:
            progress(number + 1, len(seeds))
    summary = summarize(rows)
    prefix = Path(prefix)
    prefix.parent.mkdir(parents=True, exist_ok=True)
    Path(f"{prefix}_episodes.json").write_text(json.dumps(_json(rows)), encoding="utf-8")
    with gzip.open(f"{prefix}_replays.json.gz", "wt", encoding="utf-8") as stream:
        json.dump(_json(dict(schema_version=1, episodes=replays)), stream)
    Path(f"{prefix}_summary.json").write_text(json.dumps(_json(summary), indent=2), encoding="utf-8")
    return summary, replays


def summarize(rows):
    n = len(rows)
    total_steps = sum(r["steps"] for r in rows)
    out = dict(
        rounds=n,
        catch_rate=float(np.mean([r["success"] for r in rows])),                     # 1
        stuck_or_frozen_rate=float(np.mean([r["stuck"] or r["frozen"] for r in rows])),  # 8
        first_sighting_rate=float(np.mean([r["detected"] for r in rows])),            # 9
        bump_rate=sum(r["collision_steps"] for r in rows) / total_steps,              # 10
        mean_reward=float(np.mean([r["reward"] for r in rows])),
        timeouts=int(sum(r["truncated"] for r in rows)),
    )
    out.update(summarize_lost_her(rows))                                            # 2-6, 11
    for kind in ("wanderer", "hider"):
        part = [r for r in rows if r.get("target_kind") == kind]
        if part:
            out[f"{kind}_rounds"] = len(part)
            out[f"{kind}_catch_rate"] = float(np.mean([r["success"] for r in part]))
    return out
