"""Train run A or D of the moving-target retrain (plan of 2026-11-05).

    python -m rl.moving_target_train --run A --steps 1007616
    python -m rl.moving_target_train --run D --steps 1007616

Run A: today's brain copied whole, moving/hiding target only.
Run D: the copy with 3 new inputs at zero, plus the re-find bonus.
Both: today's brain's recipe (reverse, 0.01 time cost after first sight), its
hyperparameters and seed, 16 practice arenas, one processor core.

Every 50,000 steps (at the next 8,192-step rollout) the model is saved and the
200-maze practice exam runs in its own process (rl.moving_target_job), so
training does not wait for it. Files go to
rl_artifacts/moving_target_20261105/run_<A|D>[_<tag>]/. Nothing here touches
today's brain (model_7757824/).
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
import traceback
from pathlib import Path

import numpy as np
import torch
from stable_baselines3.common.callbacks import BaseCallback
from stable_baselines3.common.logger import configure

from rl.moving_target_brain import HYPER, N_ENVS, SEED, FROZEN_STEPS, make_copy
from rl.moving_target_env import MovingTargetEnv

ROOT = Path(__file__).resolve().parents[1]
CAMPAIGN = ROOT / "rl_artifacts" / "moving_target_20261105"
RUNS = {
    "A": dict(new_inputs=False, refind_bonus=False),
    "D": dict(new_inputs=True, refind_bonus=True),
}
EXAM_EVERY = 50_000
ROLLOUT = N_ENVS * HYPER["n_steps"]   # 8,192


def exam_steps(total, every=EXAM_EVERY):
    marks = {((s + ROLLOUT - 1) // ROLLOUT) * ROLLOUT for s in range(every, total, every)}
    return sorted({m for m in marks if m < total} | {total})


def make_env(run, metrics=False, moving=True):
    return MovingTargetEnv(moving=moving, metrics=metrics, **RUNS[run])


def dump(path, value):
    path.write_text(json.dumps(value, indent=2), encoding="utf-8")


def append(path, value):
    with path.open("a", encoding="utf-8") as stream:
        stream.write(json.dumps(value) + "\n")


class Progress(BaseCallback):
    def __init__(self, directory, run, total, exams, tag):
        super().__init__()
        self.directory, self.run, self.total, self.tag = directory, run, total, tag
        self.exams = list(exams)
        self.started = time.perf_counter()
        self.job = None
        self.recent = []

    def _on_step(self):
        for done, info in zip(self.locals["dones"], self.locals["infos"]):
            if done:
                self.recent.append(dict(catch=bool(info.get("is_success")),
                                        stuck=bool(info.get("stuck") or info.get("frozen")),
                                        kind=info.get("target_kind")))
        self.recent = self.recent[-200:]
        return True

    def _on_rollout_end(self):
        steps = self.num_timesteps
        elapsed = time.perf_counter() - self.started
        row = dict(steps=steps, wall_seconds=round(elapsed, 1), steps_per_second=round(steps / elapsed, 1),
                   learning_rate=self.model.policy.optimizer.param_groups[0]["lr"],
                   recent_rounds=len(self.recent),
                   recent_catch_rate=float(np.mean([r["catch"] for r in self.recent])) if self.recent else None,
                   recent_stuck_rate=float(np.mean([r["stuck"] for r in self.recent])) if self.recent else None)
        append(self.directory / "rollouts.jsonl", row)
        dump(self.directory / "status.json", dict(status="training", total=self.total, **row))
        print(json.dumps(dict(run=self.run, **row)), flush=True)
        if self.exams and steps >= self.exams[0]:
            while self.exams and steps >= self.exams[0]:
                self.exams.pop(0)
            self.checkpoint(steps)

    def checkpoint(self, steps, final=False):
        path = self.directory / f"model_{steps}.zip"
        self.model.save(path)
        if self.job is not None and self.job.poll() is None:
            print(f"run {self.run}: waiting for the previous exam", flush=True)
            self.job.wait()
        log = (self.directory / "exams.log").open("a", encoding="utf-8")
        self.job = subprocess.Popen(
            [sys.executable, "-m", "rl.moving_target_job", "--run", self.run, "--model", str(path),
             "--steps", str(steps), "--directory", str(self.directory)]
            + (["--final"] if final else []) + (["--tag", self.tag] if self.tag else []),
            cwd=ROOT, stdout=log, stderr=subprocess.STDOUT,
            env=dict(os.environ, PYTHONPATH=str(ROOT), OMP_NUM_THREADS="1", MKL_NUM_THREADS="1"))


def train(run, total, tag=None, exam_every=EXAM_EVERY):
    torch.set_num_threads(1)
    directory = CAMPAIGN / (f"run_{run}" + (f"_{tag}" if tag else ""))
    if (directory / "status.json").exists():
        raise FileExistsError(f"{directory} already has a run; pick another --tag")
    directory.mkdir(parents=True, exist_ok=True)
    from stable_baselines3.common.monitor import Monitor
    model = make_copy([lambda: Monitor(make_env(run)) for _ in range(N_ENVS)],
                      RUNS[run]["new_inputs"], total)
    exams = exam_steps(total, exam_every)
    dump(directory / "config.json", dict(
        run=run, tag=tag, plan="Leaper brain: moving-target retrain plan (detailed), 2026-11-05",
        starts_from=f"today's brain, model_7757824 ({FROZEN_STEPS:,} steps), weights and optimizer",
        new_inputs=RUNS[run]["new_inputs"], refind_bonus=RUNS[run]["refind_bonus"],
        observation_size=model.observation_space.shape[0],
        trainable_parameters=sum(p.numel() for p in model.policy.parameters()),
        recipe=dict(reverse=True, time_cost_before_sighting=0.002, time_cost_after_sighting=0.01,
                    source="reverse_urgency_config/config.json + run spec (post-discovery cost)"),
        target=dict(moving=True, hider_share=1 / 3, run_step=0.638, sprint_step=0.929,
                    hide_seconds=[30, 60], speeds="Lola's game speeds, measured 2026-11-05"),
        n_envs=N_ENVS, seed=SEED, steps=total, exams_at=exams, **HYPER,
        learning_rate="the run's own line continued: 0.00015 -> 0.00003 over 10,002,432, from 7,757,824",
        threads=torch.get_num_threads(), pid=os.getpid(), python=sys.version))
    model.set_logger(configure(str(directory / "tensorboard"), ["csv"]))
    callback = Progress(directory, run, total, exams[:-1], tag)
    try:
        model.learn(total, callback=callback, progress_bar=False)
        callback.checkpoint(model.num_timesteps, final=True)
        if callback.job is not None:
            callback.job.wait()
        dump(directory / "status.json", dict(status="complete", steps=model.num_timesteps,
                                             wall_seconds=time.perf_counter() - callback.started))
    except BaseException:
        model.save(directory / "interrupted_model.zip")
        dump(directory / "status.json", dict(status="failed", steps=model.num_timesteps,
                                             error=traceback.format_exc()))
        raise
    finally:
        model.get_env().close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--run", choices=sorted(RUNS), required=True)
    parser.add_argument("--steps", type=int, default=1_007_616)
    parser.add_argument("--tag", default=None)
    parser.add_argument("--exam-every", type=int, default=EXAM_EVERY)
    args = parser.parse_args()
    train(args.run, args.steps, args.tag, args.exam_every)


if __name__ == "__main__":
    main()
