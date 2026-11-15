"""Round 1 trainer (cut scope of docs/MOVING_TARGET_RUN_LIST_2026-11-06.md).

    python -m rl.round1_train --run F7 --try 1
    python -m rl.round1_train --run F7 --try 1 --steps 20480 --campaign smoke   # smoke test
    python -m rl.round1_train --run F7 --try 1 --resume --steps 2015232         # continue to 2M

Every run: a copy of today's brain (weights and optimizer, its learning-rate line
continued from 7,757,824), its PPO settings, 16 practice worlds on one core:
8 real-yard rounds (``YardPractice``) and 8 of today's plain arena, Lola moving
and hiding as in run A. Try 1 seed 145032261, try 2 seed 145032262.

Runs (switches in rl/round1_env.py):
  F3   worlds only, today's scorecard                   (compare with run A)
  F1   F3 + R1 shot is the goal + R2 hidden time x2     (compare with F3)
  F7   F1 + R5 no distance points while hidden + I1 + I2 (compare with F3)
  FUSE F7 + the merge layer (rl/round1_brain.py)        (compare with F7)
Round 2 branches (continue F7's own 1M checkpoint, same try, to 2M; compare with F7's continuation):
  F7R6    + R6 "look where she was" (potential-based, walking distance)
  F7B1    + B1 privileged critic (critic sees her real direction, distance, hiding)
  F7R6B1  + both
  F7HIDE  + half the practice rounds with a hider (1/3 before)
  F7R4    + R4 closer/further points on walking distance (close-range navigation around junk)
  F7GL    genuine-loss practice: the 1 s shot pays +10 and does not end the round (she flees to
          cover, so it must re-find her); R6 only after 1 s unseen; 12 yard + 4 arena worlds
  python -m rl.round1_train --run F7R6 --try 1      (needs run_F7_try1/model_1007616.zip)

  W7   F7 with sliding-window memory: the LSTM starts blank every step and
       reads only the last 128 steps (rl/window_brain.py; standard PPO)  (compare with F7)

Exams (own processes, rl/round1_job.py): practice exam + forgetting check
(plain arena, 200 rounds each) every ~100k steps; the yard exam (100 rounds,
seeds 70000-70099) at ~250k, 500k, 750k and the end. Forgetting below 93%
stops the run (status "stopped: forgetting"). Output:
rl_artifacts/<campaign>/run_<RUN>_try<N>/; refuses to overwrite.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
import traceback
from datetime import date
from pathlib import Path

import numpy as np
import torch
from stable_baselines3.common.callbacks import BaseCallback
from stable_baselines3.common.logger import configure
from stable_baselines3.common.monitor import Monitor
from stable_baselines3.common.vec_env import DummyVecEnv

from rl.moving_target_brain import FROZEN_STEPS, HYPER, N_ENVS, ContinuedRate
from rl.round1_brain import make_round1_copy
from rl.round1_env import INPUTS, SCORING, Round1ArenaEnv, YardPractice, observation_size

ROOT = Path(__file__).resolve().parents[1]
SEEDS = {1: 145032261, 2: 145032262}
F1 = dict(shot_goal=True, hidden_cost=True)
F7 = dict(F1, no_hidden_distance=True, new_inputs=True, not_there=True)
RUNS = {
    "F3": dict(switches={}, fusion=False),
    "F1": dict(switches=F1, fusion=False),
    "F7": dict(switches=F7, fusion=False),
    "FUSE": dict(switches=F7, fusion=True),
    "W7": dict(switches=F7, fusion=False, window=128),
    "F7R6": dict(switches=dict(F7, look_where=True), fusion=False, branch_from="F7"),
    "F7B1": dict(switches=dict(F7, privileged=True), fusion=False, branch_from="F7"),
    "F7R6B1": dict(switches=dict(F7, look_where=True, privileged=True), fusion=False, branch_from="F7"),
    "F7HIDE": dict(switches=dict(F7, hider_share=0.5), fusion=False, branch_from="F7"),
    "F7R4": dict(switches=dict(F7, walk_progress=True), fusion=False, branch_from="F7"),
    "F7GL": dict(switches=dict({k: v for k, v in F7.items() if k != "shot_goal"}, shot_flee=True,
                               look_where=True, look_after=10),
                 fusion=False, branch_from="F7", yard_envs=12),
}
BRANCH_AT = 1_007_616
YARD_ENVS = 8
ROLLOUT = N_ENVS * HYPER["n_steps"]   # 8,192
PRACTICE_EVERY = 100_000
YARD_EVERY = 250_000
FORGET_GUARD = 0.93


def aligned(step):
    return ((step + ROLLOUT - 1) // ROLLOUT) * ROLLOUT


def input_switches(run):
    return {k: v for k, v in RUNS[run]["switches"].items() if k in INPUTS}


def make_envs(run, seed, leg=0):
    """``leg`` > 0 (a continuation) gives the yard rounds a fresh stream."""
    switches = RUNS[run]["switches"]
    yard_envs = RUNS[run].get("yard_envs", YARD_ENVS)
    fns = [lambda i=i: Monitor(YardPractice(seed * 100 + i + 50 * leg, **switches)) for i in range(yard_envs)]
    fns += [lambda: Monitor(Round1ArenaEnv(**switches)) for _ in range(N_ENVS - yard_envs)]
    env = DummyVecEnv(fns)
    if RUNS[run].get("window"):
        from rl.window_brain import WindowVecEnv
        env = WindowVecEnv(env, RUNS[run]["window"])
    return env


def dump(path, value):
    path.write_text(json.dumps(value, indent=2), encoding="utf-8")


def append(path, value):
    with path.open("a", encoding="utf-8") as stream:
        stream.write(json.dumps(value) + "\n")


class Progress(BaseCallback):
    def __init__(self, directory, run, total, start=0):
        super().__init__()
        self.directory, self.run, self.total, self.start = directory, run, total, start
        self.practice = sorted({aligned(s) for s in range(PRACTICE_EVERY, total, PRACTICE_EVERY)
                                if start < aligned(s) < aligned(total)})
        self.yard = sorted({aligned(s) for s in range(YARD_EVERY, total, YARD_EVERY)
                            if start < aligned(s) < aligned(total)})
        self.started = time.perf_counter()
        self.jobs = {"practice": None, "yard": []}
        self.recent = []
        self.stopped = None

    def _on_step(self):
        for done, info in zip(self.locals["dones"], self.locals["infos"]):
            if done:
                self.recent.append(dict(win=bool(info.get("is_success")), shot=bool(info.get("shot_win")),
                                        stuck=bool(info.get("stuck") or info.get("frozen"))))
        self.recent = self.recent[-300:]
        return self.stopped is None

    def _on_rollout_end(self):
        steps = self.num_timesteps
        elapsed = time.perf_counter() - self.started
        rate = lambda key: float(np.mean([r[key] for r in self.recent])) if self.recent else None
        row = dict(steps=steps, wall_seconds=round(elapsed, 1),
                   steps_per_second=round((steps - self.start) / elapsed, 1),
                   learning_rate=self.model.policy.optimizer.param_groups[0]["lr"],
                   recent_rounds=len(self.recent), recent_win_rate=rate("win"),
                   recent_shot_win_rate=rate("shot"), recent_stuck_rate=rate("stuck"))
        append(self.directory / "rollouts.jsonl", row)
        dump(self.directory / "status.json", dict(status="training", total=self.total, **row))
        print(json.dumps(dict(run=self.run, **row)), flush=True)
        if (self.directory / "STOP").exists():
            self.stopped = (self.directory / "STOP").read_text().strip() or "stopped"
        kinds = []
        if self.practice and steps >= self.practice[0]:
            while self.practice and steps >= self.practice[0]:
                self.practice.pop(0)
            kinds.append("practice")
        if self.yard and steps >= self.yard[0]:
            while self.yard and steps >= self.yard[0]:
                self.yard.pop(0)
            kinds.append("yard")
        if kinds:
            self.checkpoint(steps, kinds)

    def checkpoint(self, steps, kinds):
        path = self.directory / f"model_{steps}.zip"
        self.model.save(path)
        log = (self.directory / "exams.log").open("a", encoding="utf-8")
        env = dict(os.environ, PYTHONPATH=str(ROOT), OMP_NUM_THREADS="1", MKL_NUM_THREADS="1")
        for kind in kinds:
            command = [sys.executable, "-m", "rl.round1_job", "--kind", kind, "--run", self.run,
                       "--model", str(path), "--steps", str(steps), "--directory", str(self.directory)]
            if kind == "practice":
                if self.jobs["practice"] is not None and self.jobs["practice"].poll() is None:
                    print(f"{self.run}: waiting for the previous practice exam", flush=True)
                    self.jobs["practice"].wait()
                self.jobs["practice"] = subprocess.Popen(command, cwd=ROOT, stdout=log, stderr=subprocess.STDOUT, env=env)
            else:
                self.jobs["yard"].append(subprocess.Popen(command, cwd=ROOT, stdout=log, stderr=subprocess.STDOUT, env=env))

    def wait(self):
        for job in [self.jobs["practice"], *self.jobs["yard"]]:
            if job is not None:
                job.wait()


def train(run, attempt, total, campaign):
    torch.set_num_threads(1)
    seed = SEEDS[attempt]
    directory = ROOT / "rl_artifacts" / campaign / f"run_{run}_try{attempt}"
    if directory.exists() and any(directory.iterdir()):
        raise FileExistsError(f"{directory} already exists; never overwritten")
    directory.mkdir(parents=True, exist_ok=True)
    spec = RUNS[run]
    start = 0
    if spec.get("branch_from"):
        from rl.round2_brain import make_branch
        source = ROOT / "rl_artifacts" / campaign / f"run_{spec['branch_from']}_try{attempt}" / f"model_{BRANCH_AT}.zip"
        model, start = make_branch(make_envs(run, seed, leg=2), source, spec["fusion"],
                                   bool(spec["switches"].get("privileged")), total, seed)
    elif spec.get("window"):
        from rl.window_brain import make_window_copy
        torch.set_num_threads(2)
        model = make_window_copy(make_envs(run, seed), observation_size(**input_switches(run)), total,
                                 fusion=spec["fusion"], window=spec["window"], seed=seed)
    else:
        model = make_round1_copy(make_envs(run, seed), spec["fusion"], total, seed=seed)
    callback = Progress(directory, run, total, start=start)
    dump(directory / "config.json", dict(
        run=run, attempt=attempt, seed=seed, steps=total, campaign=campaign, start=start,
        branch_from=(str(source) if spec.get("branch_from") else None),
        plan="docs/MOVING_TARGET_RUN_LIST_2026-11-06.md, round 1, cut scope (no box arena, no yard flips, "
             "no R3/R4/B1); exams every ~100k, yard exam at ~250k/500k/750k/end",
        starts_from=f"today's brain, model_7757824 ({FROZEN_STEPS:,} steps), weights and optimizer",
        switches={k: bool(spec["switches"].get(k, False)) for k in SCORING + INPUTS},
        hider_share=spec["switches"].get("hider_share", 1 / 3),
        fusion=spec["fusion"], window=spec.get("window"), observation_size=observation_size(**input_switches(run)),
        trainable_parameters=sum(p.numel() for p in model.policy.parameters()),
        worlds=dict(yard=spec.get("yard_envs", YARD_ENVS), plain_arena=N_ENVS - spec.get("yard_envs", YARD_ENVS)),
        look_after=spec["switches"].get("look_after", 0),
        target=dict(moving=True, hider_share=1 / 3, run_step=0.638, sprint_step=0.929),
        practice_exams_at=callback.practice + [aligned(total)], yard_exams_at=callback.yard + [aligned(total)],
        n_envs=N_ENVS, **HYPER, fast_sim=True,
        learning_rate="today's brain's line continued: 0.00015 -> 0.00003 over 10,002,432, from 7,757,824",
        threads=torch.get_num_threads(), pid=os.getpid(), python=sys.version, started=str(date.today())))
    model.set_logger(configure(str(directory / "tensorboard"), ["csv"]))
    try:
        model.learn(total - start, callback=callback, progress_bar=False, reset_num_timesteps=start == 0)
        steps = model.num_timesteps
        model.save(directory / f"model_{steps}.zip")
        if callback.stopped is None:
            callback.checkpoint(steps, ["practice", "yard"])
        callback.wait()
        dump(directory / "status.json", dict(status="complete" if callback.stopped is None else callback.stopped,
                                             steps=steps, wall_seconds=time.perf_counter() - callback.started))
    except BaseException:
        model.save(directory / "interrupted_model.zip")
        dump(directory / "status.json", dict(status="failed", steps=model.num_timesteps,
                                             error=traceback.format_exc()))
        raise
    finally:
        model.get_env().close()


def resume(run, attempt, total, campaign):
    """Continue a finished run from its last checkpoint to ``total`` steps.

    Same folder (new checkpoints, exams and rollout rows are added; nothing is
    overwritten but status.json), same seed + 1000 for the new episodes, the
    optimizer moments from the checkpoint, and the learning-rate line continued
    (the rate depends only on the step count: 7,757,824 + steps so far).
    """
    from rl.seeker_recurrent_train import FixedContextRecurrentPPO
    torch.set_num_threads(1)
    seed = SEEDS[attempt]
    directory = ROOT / "rl_artifacts" / campaign / f"run_{run}_try{attempt}"
    models = sorted(directory.glob("model_*.zip"), key=lambda p: int(p.stem.split("_")[1]))
    path = models[-1]
    start = int(path.stem.split("_")[1])
    if start >= total:
        raise ValueError(f"{path} is already at {start} steps")
    if RUNS[run].get("window"):
        raise NotImplementedError("resume is for the carried-memory runs")
    rate = ContinuedRate(total)
    model = FixedContextRecurrentPPO.load(str(path), env=make_envs(run, seed, leg=1), device="cpu",
                                          custom_objects=dict(learning_rate=rate, lr_schedule=rate))
    if model.num_timesteps != start:
        raise RuntimeError(f"checkpoint says {model.num_timesteps} steps, file name {start}")
    model.set_random_seed(seed + 1000)
    callback = Progress(directory, run, total, start=start)
    dump(directory / f"config_resume_{start}.json", dict(
        run=run, attempt=attempt, resumed_from=str(path), start=start, steps=total, episode_seed=seed + 1000,
        yard_round_stream="leg 1 (fresh)", learning_rate_now=rate(1 - start / total),
        practice_exams_at=callback.practice + [aligned(total)], yard_exams_at=callback.yard + [aligned(total)],
        pid=os.getpid(), started=str(date.today())))
    model.set_logger(configure(str(directory / f"tensorboard_resume_{start}"), ["csv"]))
    try:
        model.learn(total - start, callback=callback, progress_bar=False, reset_num_timesteps=False)
        steps = model.num_timesteps
        model.save(directory / f"model_{steps}.zip")
        if callback.stopped is None:
            callback.checkpoint(steps, ["practice", "yard"])
        callback.wait()
        dump(directory / "status.json", dict(status="complete" if callback.stopped is None else callback.stopped,
                                             steps=steps, resumed_from=start,
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
    parser.add_argument("--try", dest="attempt", type=int, choices=(1, 2), default=1)
    parser.add_argument("--steps", type=int, default=None, help="default 1,007,616; branches 2,015,232")
    parser.add_argument("--campaign", default=f"moving_target_round1_{date.today():%Y%m%d}")
    parser.add_argument("--resume", action="store_true", help="continue the run's last checkpoint to --steps")
    args = parser.parse_args()
    if args.steps is None:
        args.steps = 2_015_232 if RUNS[args.run].get("branch_from") else 1_007_616
    if args.resume:
        resume(args.run, args.attempt, args.steps, args.campaign)
    else:
        train(args.run, args.attempt, args.steps, args.campaign)


if __name__ == "__main__":
    main()
