"""Yard exam of a trained round-1 brain played in sliding-window mode (128 steps).

    python -m rl.window_exam --run F7 --model rl_artifacts/.../model_1007616.zip

Same 100 yard rounds (seeds 70000-70099) and numbers (H1-H5) as rl/round1_job.py
--kind yard; writes <model folder>/yardwindow_<steps>_* and a line in
yard_window_exams.jsonl. Compare with the same checkpoint's normal yard exam.
"""
import argparse
import json
from pathlib import Path

import torch

from rl.moving_target_exam import run_exam
from rl.round1_brain import load_round1
from rl.round1_env import Round1YardEnv
from rl.round1_job import YARD_SEEDS, headline
from rl.round1_train import append, input_switches
from rl.window_brain import WINDOW, WindowedRecurrent


def main():
    torch.set_num_threads(1)
    parser = argparse.ArgumentParser()
    parser.add_argument("--run", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--window", type=int, default=WINDOW)
    args = parser.parse_args()
    path = Path(args.model)
    steps = int(path.stem.split("_")[-1]) if path.stem.split("_")[-1].isdigit() else 0
    inputs = input_switches(args.run)
    model = WindowedRecurrent(load_round1(path, lambda: Round1YardEnv(YARD_SEEDS[0], **inputs)), args.window)
    seeds = iter(YARD_SEEDS)
    prefix = path.parent / f"yardwindow{args.window}_{steps}"
    summary, _ = run_exam(model, lambda: Round1YardEnv(next(seeds), **inputs), YARD_SEEDS, prefix)
    rows = json.loads(Path(f"{prefix}_episodes.json").read_text())
    row = dict(steps=steps, window=args.window, **headline(summary, rows))
    append(path.parent / "yard_window_exams.jsonl", row)
    print(json.dumps(row), flush=True)


if __name__ == "__main__":
    main()
