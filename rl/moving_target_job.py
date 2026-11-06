"""One practice exam of a saved run-A/D model, in its own process.

Started by rl.moving_target_train at each checkpoint. Writes
<directory>/dev_<steps>_{summary,episodes,replays}, appends to
<directory>/evaluations.jsonl and refreshes the training viewer's feed
(public/rl_live_state_<run>.json; run D also feeds the default
public/rl_live_state.json that ?training=1 reads). With --final it also sits
the still-target exam (number 7).
"""
from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

import torch

from rl.moving_target_exam import run_exam
from rl.moving_target_train import ROOT, make_env, append, dump

DEV = list(range(30000, 30200))
RECORD = DEV[:6]
KEEP_CHECKPOINTS = 8


def load(path, run):
    from rl.seeker_recurrent_train import FixedContextRecurrentPPO
    from stable_baselines3.common.vec_env import DummyVecEnv
    import rl.moving_target_brain  # noqa: F401  (ResidualLstmPolicy37 for unpickling)
    return FixedContextRecurrentPPO.load(path, env=DummyVecEnv([lambda: make_env(run)]), device="cpu",
                                         custom_objects=dict(learning_rate=0.0, lr_schedule=lambda _: 0.0))


def publish(directory, run, steps, summary, replays, final, label=None):
    """Feed the training viewer: the last few exams, a few rounds each."""
    feed_path = directory / "rl_live_state.json"
    feed = json.loads(feed_path.read_text()) if feed_path.exists() else dict(checkpoints=[])
    episodes = []
    for i, r in enumerate(replays):
        episodes.append(dict(r, episode=i + 1, reward=r["metrics"]["reward"], success=r["metrics"]["success"],
                             path_length=r["metrics"]["path_length"], deterministic=True))
    feed["checkpoints"] = (feed["checkpoints"] + [dict(step=steps, mean_reward=summary["mean_reward"],
                                                       success_rate=summary["catch_rate"],
                                                       episodes=episodes)])[-KEEP_CHECKPOINTS:]
    feed.update(status="complete" if final else "training", run=label or f"moving target run {run}",
                timesteps=steps, training_rollouts=[], moving_target=True,
                updated_at=datetime.now(timezone.utc).isoformat())
    text = json.dumps(feed)
    feed_path.write_text(text, encoding="utf-8")
    names = [f"rl_live_state_{run}.json"] + (["rl_live_state.json"] if run == "D" else [])
    for name in names:
        (ROOT / "public" / name).write_text(text, encoding="utf-8")


def main():
    torch.set_num_threads(1)
    parser = argparse.ArgumentParser()
    parser.add_argument("--run", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--steps", type=int, required=True)
    parser.add_argument("--directory", required=True)
    parser.add_argument("--final", action="store_true")
    parser.add_argument("--tag", default=None)
    args = parser.parse_args()
    directory = Path(args.directory)
    model = load(args.model, args.run)
    prefix = directory / f"dev_{args.steps}"
    summary, replays = run_exam(model, lambda: make_env(args.run, metrics=True), DEV, prefix, RECORD,
                                progress=lambda n, t: print(f"exam {args.steps}: {n}/{t}", flush=True))
    row = dict(steps=args.steps, summary=summary)
    if args.final:
        still, _ = run_exam(model, lambda: make_env(args.run, metrics=True, moving=False), DEV,
                            directory / f"still_{args.steps}")
        row["still_target_catch_rate"] = still["catch_rate"]
    append(directory / "evaluations.jsonl", row)
    publish(directory, args.run, args.steps, summary, replays, args.final,
            label=f"moving target run {args.run}" + (f" {args.tag}" if args.tag else ""))
    print(json.dumps(row), flush=True)


if __name__ == "__main__":
    main()
