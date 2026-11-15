"""One round-1 exam of a saved model, in its own process (started by rl.round1_train).

--kind practice: practice exam (plain arena, moving Lola, 200 rounds, seeds
  30000-30199) and forgetting check (same arena, Lola standing still). Below
  93% on the forgetting check writes <directory>/STOP and the trainer stops.
--kind yard: the yard exam (real yard, eye-level sight to 50 map units, 100
  rounds, seeds 70000-70099) with the headline numbers H1-H5.

Exams always use run A's round rules (every scoring switch off) with the run's
own inputs. Results: <directory>/{dev,still,yard}_<steps>_*.json and one line
each in practice_exams.jsonl / yard_exams.jsonl.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import torch

from rl.moving_target_exam import run_exam
from rl.round1_brain import load_round1
from rl.round1_env import Round1ArenaEnv, Round1YardEnv
from rl.round1_train import FORGET_GUARD, RUNS, append, input_switches

PRACTICE_SEEDS = list(range(30000, 30200))
YARD_SEEDS = list(range(70000, 70100))


def headline(summary, rows):
    """H1-H5 of the plan (section 7) from a yard exam."""
    shots = [r["lost_her"].get("first_shot_s") for r in rows]
    got = [s for s in shots if s is not None]
    return dict(H1_clear_shot=len(got) / len(rows),
                H2_first_shot_median_s=float(np.median(got)) if got else None,
                H3_stuck_or_frozen=summary["stuck_or_frozen_rate"],
                H4_checks_hiding_spot=summary.get("hiding_checked_rate"),
                H5_touch=summary["catch_rate"],
                time_in_shot=float(np.mean([r["lost_her"].get("shot_share", 0.0) for r in rows])),
                goes_her_way=summary.get("goes_her_way_rate"), refind=summary.get("refind_rate"))


def load_model(path, run, env_fn):
    if RUNS[run].get("window"):
        from rl.window_brain import load_window
        return load_window(path)
    return load_round1(path, env_fn)


def main():
    torch.set_num_threads(1)
    parser = argparse.ArgumentParser()
    parser.add_argument("--kind", choices=("practice", "yard"), required=True)
    parser.add_argument("--run", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--steps", type=int, required=True)
    parser.add_argument("--directory", required=True)
    args = parser.parse_args()
    directory = Path(args.directory)
    inputs = input_switches(args.run)
    if args.kind == "practice":
        model = load_model(args.model, args.run, lambda: Round1ArenaEnv(**inputs))
        moving, _ = run_exam(model, lambda: Round1ArenaEnv(metrics=True, **inputs), PRACTICE_SEEDS,
                             directory / f"dev_{args.steps}", PRACTICE_SEEDS[:4])
        still, _ = run_exam(model, lambda: Round1ArenaEnv(moving=False, metrics=True, **inputs),
                            PRACTICE_SEEDS, directory / f"still_{args.steps}")
        row = dict(steps=args.steps, moving_catch=moving["catch_rate"], still_catch=still["catch_rate"],
                   moving_stuck=moving["stuck_or_frozen_rate"], summary=moving)
        append(directory / "practice_exams.jsonl", row)
        if still["catch_rate"] < FORGET_GUARD:
            (directory / "STOP").write_text(f"stopped: forgetting ({still['catch_rate']:.3f} at {args.steps})")
    else:
        seeds = iter(YARD_SEEDS)
        model = load_model(args.model, args.run, lambda: Round1YardEnv(YARD_SEEDS[0], **inputs))
        summary, _ = run_exam(model, lambda: Round1YardEnv(next(seeds), **inputs), YARD_SEEDS,
                              directory / f"yard_{args.steps}", YARD_SEEDS[:4])
        rows = json.loads((directory / f"yard_{args.steps}_episodes.json").read_text())
        row = dict(steps=args.steps, **headline(summary, rows))
        append(directory / "yard_exams.jsonl", row)
    print(json.dumps(row if args.kind == "yard" else {k: v for k, v in row.items() if k != "summary"}), flush=True)


if __name__ == "__main__":
    main()
