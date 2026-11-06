"""How often does a brain give the game's Engage a clear shot in the real yard? (2026-11-05)

A clear shot = Lola seen by the eye within engage.enterDistance, 14 map units
(20.3 brain units), in the game exam's world (rl/moving_target_game_exam.py:
the real yard, eye-level sight to 50 map units, a moving and hiding Lola).
Moved from tmp/yard_shot_probe.py (git-ignored) on 2026-11-06 so the
round 1 plan (docs/MOVING_TARGET_RUN_LIST_2026-11-06.md) can use it.

    python -m rl.moving_target_shot_probe today 100 out.json
    python -m rl.moving_target_shot_probe path/to/model.zip 100 out.json

Numbers: clear_shot_rate (H1: rounds with at least one clear shot),
first_shot_median_s (H2), time_in_shot (share of steps with a clear shot),
touch_rate (H5), within_20s (rounds with a first clear shot inside 20 s).
Seeds 70000 onward, the same as the game exam.
"""
import argparse
import json

import numpy as np
import torch

from rl.moving_target import MAP_TO_BRAIN
from rl.moving_target_game_exam import GameExamEnv
from rl.moving_target_brain import load_frozen_predictor
from rl.moving_target_job import load

SHOT = 14 * MAP_TO_BRAIN


def main():
    torch.set_num_threads(1)
    parser = argparse.ArgumentParser()
    parser.add_argument("brain", help="'today' or a run's model zip")
    parser.add_argument("rounds", type=int)
    parser.add_argument("out")
    args = parser.parse_args()
    seeds = list(range(70000, 70000 + args.rounds))
    model = (load_frozen_predictor(lambda: GameExamEnv(seeds[0])) if args.brain == "today"
             else load(args.brain, "A"))
    rows = []
    for seed in seeds:
        env = GameExamEnv(seed)
        obs, info = env.reset(seed=seed)
        state = None
        first = None
        shot_steps = 0
        touch = False
        for step in range(1000):
            action, state = model.predict(obs, state=state, episode_start=np.array([step == 0]),
                                          deterministic=True)
            obs, _, term, trunc, info = env.step(action)
            if env.target_visible and env._distance() <= SHOT:
                shot_steps += 1
                first = step + 1 if first is None else first
            if term or trunc:
                touch = bool(info.get("is_success"))
                break
        rows.append(dict(seed=seed, kind=info.get("target_kind"),
                         first_shot_s=None if first is None else first / 10,
                         shot_share=shot_steps / (step + 1), touch=touch,
                         stuck=bool(info.get("stuck") or info.get("frozen")),
                         seconds=(step + 1) / 10))
        if len(rows) % 25 == 0:
            print(f"{args.out}: {len(rows)}/{args.rounds}", flush=True)
    got = [r for r in rows if r["first_shot_s"] is not None]
    summary = dict(rounds=len(rows), clear_shot_rate=len(got) / len(rows),
                   within_20s=sum(r["first_shot_s"] <= 20 for r in got) / len(rows),
                   first_shot_median_s=float(np.median([r["first_shot_s"] for r in got])) if got else None,
                   time_in_shot=float(np.mean([r["shot_share"] for r in rows])),
                   touch_rate=float(np.mean([r["touch"] for r in rows])))
    with open(args.out, "w", encoding="utf-8") as stream:
        json.dump(dict(summary=summary, rows=rows), stream, indent=1)
    print("RESULT", json.dumps(summary))


if __name__ == "__main__":
    main()
