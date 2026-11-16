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
SEEDS = {n: 145032260 + n for n in range(1, 13)}   # tries 1-12 (5+ added 2026-11-16 for F7GLS and back-fill)
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
# 2026-11-16: practice worlds where checking a hiding spot pays (rl/round1_env.py eye_hide,
# flee_stay, close_start_share). F7GLE/F7GLS continue F7GL try 1 at 3,006,480 steps (every
# try from that one checkpoint, seeds differ); F7GLS0 starts the same world from F7 at 1M.
F7GL_AT_3M = "run_F7GL_try1/model_3006480.zip"
_GL = RUNS["F7GL"]["switches"]
_SEEK = dict(_GL, eye_hide=True, flee_stay=True, hider_share=0.5, close_start_share=0.25)
RUNS.update({
    "F7GLE": dict(switches=dict(_GL, eye_hide=True), fusion=False, branch_model=F7GL_AT_3M, yard_envs=12, leg=5),
    "F7GLS": dict(switches=_SEEK, fusion=False, branch_model=F7GL_AT_3M, yard_envs=12, leg=5),
    "F7GLS0": dict(switches=_SEEK, fusion=False, branch_from="F7", yard_envs=12, leg=5),
    # F7GLS + the search drill in half the yard rounds (rl/round1_env.py drill_share); F7GLS is its control.
    # NOT LAUNCHED (gate failed 2026-11-16): seek-worthy losses 1.30/round vs F7GLS's 1.43 (F7GL@3M, 40 rounds each);
    # close to her nothing hides her from the eye, so it keeps or re-finds her within 3 s.
    "F7GLD": dict(switches=dict(_SEEK, drill_share=0.5), fusion=False, branch_model=F7GL_AT_3M, yard_envs=12, leg=6),
    # Search drill v2 (2026-11-16): 6 of the 12 yard worlds play only drills (it watches her dive behind real
    # cover 15-35 units away; ends at the first shot or 30 s); R4 walking-distance progress toward her REAL
    # position also while she is hidden (R5 off; scorer only, nothing reaches the actor) + B1 critic that sees
    # where she is. Control: F7GLS (same branch point, same learning rate).
    "F7GLSD": dict(switches=dict(_SEEK, no_hidden_distance=False, walk_progress=True, privileged=True),
                   fusion=False, branch_model=F7GL_AT_3M, yard_envs=12, drill_envs=6, leg=8),
    # Drill variants (2026-11-16, user: max 2 seeds per experiment, fill CPU with different experiments):
    # F7GLSDL = F7GLSD at a constant 1e-4 learning rate; F7GLSDX = F7GLSD with all 12 yard worlds drilling.
    "F7GLSDL": dict(switches=dict(_SEEK, no_hidden_distance=False, walk_progress=True, privileged=True),
                    fusion=False, branch_model=F7GL_AT_3M, yard_envs=12, drill_envs=6, leg=9, lr=1e-4),
    "F7GLSDX": dict(switches=dict(_SEEK, no_hidden_distance=False, walk_progress=True, privileged=True),
                    fusion=False, branch_model=F7GL_AT_3M, yard_envs=12, drill_envs=12, leg=10),
    # F7GLSDW (2026-11-16 ~18:27 IST): F7GLSD + R6 pays for WALKING to where it lost her (done within
    # 4 units, not when it sees the spot), 3x the points per unit (0.3), and +5 for getting there (a real
    # reward, at most 3 a round: R6 alone is potential-based and cannot change which behaviour is best).
    "F7GLSDW": dict(switches=dict(_SEEK, no_hidden_distance=False, walk_progress=True, privileged=True,
                                  look_reach=True, look_scale=0.3, reach_bonus=5.0),
                    fusion=False, branch_model=F7GL_AT_3M, yard_envs=12, drill_envs=6, leg=11),
    # F7GLSDP (2026-11-16 ~19:26 IST): F7GLSDW with R6 as plain progress toward where it lost her (no
    # refund; look_progress), so walking there is preferred over finding her from the side.
    "F7GLSDP": dict(switches=dict(_SEEK, no_hidden_distance=False, walk_progress=True, privileged=True,
                                  look_reach=True, look_scale=0.3, reach_bonus=5.0, look_progress=True),
                    fusion=False, branch_model=F7GL_AT_3M, yard_envs=12, drill_envs=6, leg=12),
    # F7GLS with a constant learning rate 1e-4 instead of the schedule's 3e-5 floor (2026-11-16, spare CPU).
    "F7GLSL": dict(switches=_SEEK, fusion=False, branch_model=F7GL_AT_3M, yard_envs=12, leg=7, lr=1e-4),
})
F7GLSDP_AT_7M = "run_F7GLSDP_try1/model_7004176.zip"
SDP_AT_12M = {1: "run_F7GLSDP_try1/model_12001312.zip", 2: "run_F7GLSDP_try2/model_12001312.zip"}
_SDP = RUNS["F7GLSDP"]["switches"]
RUNS.update({
    # 2026-11-16 ~21:15 IST: drill brains walk toward V twice as far as today's in drills, but not in
    # the free yard (genuine-loss probe flat). Three environment fixes, each branched from F7GLSDP
    # try 1 at 7M (still-target catch 0.97) and run to 12M: a less staged drill start (drill_vary),
    # yard rounds where she ducks into cover near where she vanished (lose_cover), and both.
    "F7GLSDR": dict(switches=dict(_SDP, drill_vary=True), fusion=False, branch_model=F7GLSDP_AT_7M,
                    yard_envs=12, drill_envs=6, leg=13),
    "F7GLSDN": dict(switches=dict(_SDP, lose_cover=0.5), fusion=False, branch_model=F7GLSDP_AT_7M,
                    yard_envs=12, drill_envs=6, leg=14),
    "F7GLSDRN": dict(switches=dict(_SDP, drill_vary=True, lose_cover=0.5), fusion=False,
                     branch_model=F7GLSDP_AT_7M, yard_envs=12, drill_envs=6, leg=15),
    # ~21:25 IST: deeper drill cover: S also hidden from the walking route to V until 6 units from V
    # (drill_deep_path; census 40/40 drills set, 0.11 s a reset), so walking to where it lost her pays.
    "F7GLSDV": dict(switches=dict(_SDP, drill_deep_path=True), fusion=False, branch_model=F7GLSDP_AT_7M,
                    yard_envs=12, drill_envs=6, leg=16),
    # 23:45 IST (user: use the free cores; advisor): three one-factor arms on the picked line, each try
    # continuing the same try of F7GLSDP at 12M (its 16M continuation is the same-parent control), to 16M.
    # F7GLSDP2: walk-there pay doubled (look_scale 0.3 -> 0.6, per-round cap 10 -> 20 points, so the same
    # walking distance is paid): the only lever that moved sight-break closure.
    "F7GLSDP2": dict(switches=dict(_SDP, look_scale=0.6, progress_cap=20.0), fusion=False,
                     branch_model=SDP_AT_12M, yard_envs=12, drill_envs=6, leg=18),
    # F7GLSDPC: messier drills + she ducks nearby on top of SDP (F7GLSDRN try 1, one seed, had the best
    # closure of any brain at 9-10M; its try 2 forgot).
    "F7GLSDPC": dict(switches=dict(_SDP, drill_vary=True, lose_cover=0.5), fusion=False,
                     branch_model=SDP_AT_12M, yard_envs=12, drill_envs=6, leg=19),
    # F7GLSDPF: the same practice with half the learning-rate floor (1.5e-5 instead of 3e-5): polish.
    "F7GLSDPF": dict(switches=_SDP, fusion=False, branch_model=SDP_AT_12M, yard_envs=12, drill_envs=6,
                     leg=20, lr=1.5e-5),
    # 23:48 IST 16 Nov (user: "it should get as close as possible"): the shot paid at the game's real stand-and-
    # shoot distance, 14 brain units (engage.enterDistance is in world = brain units), not 20.3. From SDP 12M.
    "F7GLSDP14": dict(switches=dict(_SDP, shot_range=14.0), fusion=False, branch_model=SDP_AT_12M,
                      yard_envs=12, drill_envs=6, leg=21),
    # 23:55 IST (user: "the 14-unit range is the job of the layer above the brain; it should just get as close
    # as possible"): F7GLSDP14 stopped. F7GLSDPT: no pay for a shot at range and no forced flee after one
    # (shot_flee off); the round's goal is touching her (the base +25 catch, round ends), with the walking-
    # progress pay toward her kept. Drill rounds then end at a touch or after 30 s. From SDP 12M per try.
    "F7GLSDPT": dict(switches=dict(_SDP, shot_flee=False), fusion=False, branch_model=SDP_AT_12M,
                     yard_envs=12, drill_envs=6, leg=22),
    # 23:58 IST (user: closing speed toward a visible Lola must be at least today's, ideally 0.8-0.9 u/s; the
    # picked brain closes at ~0.55 vs today's ~0.72 walking-distance units/s and reverses 35-37% of its moving
    # steps vs 29%): spin-off of the picked brain (F7GLSDP try 1 @10M, both tries) with the touch goal (no shot
    # pay at range, no forced flee; as F7GLSDPT) and double pay per unit of walking progress toward her (0.4).
    "F7GLSDPA": dict(switches=dict(_SDP, shot_flee=False, walk_scale=0.4), fusion=False,
                     branch_model="run_F7GLSDP_try1/model_10002464.zip", yard_envs=12, drill_envs=6, leg=23),
    # 00:23 IST 17 Nov (user: penalise reversing when plainly not needed; advisor: body context only, two doses,
    # gated): F7GLSDPA + a charge of dose x |throttle| per step of backing up with no bump in 1 s and the way
    # ahead open > 6 units (rl/round1_env.py reverse_cost). Gate on the pick, 30 rounds: 0.02 -> -1.6 points a
    # round, 0.05 -> -3.9 (time cost -12.6, touch +25). From the pick at 10M, to 14M; F7GLSDPA is the control.
    "F7GLSDPB2": dict(switches=dict(_SDP, shot_flee=False, walk_scale=0.4, reverse_cost=0.02), fusion=False,
                      branch_model="run_F7GLSDP_try1/model_10002464.zip", yard_envs=12, drill_envs=6, leg=24),
    "F7GLSDPB5": dict(switches=dict(_SDP, shot_flee=False, walk_scale=0.4, reverse_cost=0.05), fusion=False,
                      branch_model="run_F7GLSDP_try1/model_10002464.zip", yard_envs=12, drill_envs=6, leg=25),
    # 02:25 IST 17 Nov: B5 plateaued at 33% reversing / ~0.58 closing (11.5M -> 14M). Audit: the charged
    # (clear-way) reversing fell (46% -> 30% of reverse steps vs the control) but ~60% of what is left sits in the
    # 10-step after-bump exemption, and flips after bumps run ~0.9/s. Three arms from the pick at 10M to 12M
    # (read at 11.5M), all on F7GLSDPA's world: G5 = 0.05 with a tight gate (3 steps after a bump, way ahead
    # open > 3 units); G10 = the same at 0.10; GF = G5 + 0.05 per forward<->back switch under the same gate.
    "F7GLSDPG5": dict(switches=dict(_SDP, shot_flee=False, walk_scale=0.4, reverse_cost=0.05, reverse_window=3,
                                    reverse_front=3.0), fusion=False,
                      branch_model="run_F7GLSDP_try1/model_10002464.zip", yard_envs=12, drill_envs=6, leg=26),
    "F7GLSDPG10": dict(switches=dict(_SDP, shot_flee=False, walk_scale=0.4, reverse_cost=0.10, reverse_window=3,
                                     reverse_front=3.0), fusion=False,
                       branch_model="run_F7GLSDP_try1/model_10002464.zip", yard_envs=12, drill_envs=6, leg=27),
    "F7GLSDPGF": dict(switches=dict(_SDP, shot_flee=False, walk_scale=0.4, reverse_cost=0.05, reverse_window=3,
                                    reverse_front=3.0, flip_cost=0.05), fusion=False,
                      branch_model="run_F7GLSDP_try1/model_10002464.zip", yard_envs=12, drill_envs=6, leg=28),
    # 02:28 IST (advisor: isolate the flip cost): in-sight flips/s today 0.85 vs pick 1.20; the tight gate (3,3)
    # covers today 0.36 vs pick 0.63, the old gate (10,6) only 0.15 vs 0.27. GFO = flip cost alone, tight gate;
    # BF = flip cost alone, B5's old gate, dosed to a similar charge per round. G10 launched 02:32 IST on free cores with an
    # early stop (yard stuck > 12% or still < 0.94 at 10.5M/11M): -14.9 a round, above the time cost.
    "F7GLSDPGFO": dict(switches=dict(_SDP, shot_flee=False, walk_scale=0.4, reverse_window=3, reverse_front=3.0,
                                     flip_cost=0.05), fusion=False,
                       branch_model="run_F7GLSDP_try1/model_10002464.zip", yard_envs=12, drill_envs=6, leg=29),
    "F7GLSDPBF": dict(switches=dict(_SDP, shot_flee=False, walk_scale=0.4, flip_cost=0.10), fusion=False,
                      branch_model="run_F7GLSDP_try1/model_10002464.zip", yard_envs=12, drill_envs=6, leg=30),
    # 03:15 IST 17 Nov (user: train again from an earlier point, not from the 12M spin-offs; advisor: the pick's own
    # line at 4M). Net/path (1 s net distance / distance walked, in sight & >14 away; today 0.65) on the pick line:
    # 4M 0.60-0.61 -> 10M 0.46-0.49, reversing 28-29% -> 35-37%; sibling lines without the pick's look_* extras
    # (F7GLS, F7GLSD, F7GLSDX, F7GLE) stay at 0.56-0.67 / 23-32% to 10M. So branch each try from its own 4M and
    # keep the reverse charge (B5: 0.05, old gate) on from the first step. P4C = the pick's recipe + charge;
    # P4T = the no-shot-pay world (F7GLSDPA's) + charge; P4L = P4C without look_progress (the per-step R6 pay that
    # the flat sibling lines lack). Rule (written before launch): both seeds reversing <= 30% and net/path >= 0.58
    # at 7M and 8M (pick line there: 32-34% / 0.52-0.56), with no harm (stuck, still guard).
    "F7GLSDP4C": dict(switches=dict(_SDP, reverse_cost=0.05), fusion=False,
                      branch_model={1: "run_F7GLSDP_try1/model_4005904.zip", 2: "run_F7GLSDP_try2/model_4005904.zip"},
                      yard_envs=12, drill_envs=6, leg=31),
    "F7GLSDP4T": dict(switches=dict(_SDP, shot_flee=False, walk_scale=0.4, reverse_cost=0.05), fusion=False,
                      branch_model={1: "run_F7GLSDP_try1/model_4005904.zip", 2: "run_F7GLSDP_try2/model_4005904.zip"},
                      yard_envs=12, drill_envs=6, leg=32),
    "F7GLSDP4L": dict(switches=dict(_SDP, look_progress=False, reverse_cost=0.05), fusion=False,
                      branch_model={1: "run_F7GLSDP_try1/model_4005904.zip", 2: "run_F7GLSDP_try2/model_4005904.zip"},
                      yard_envs=12, drill_envs=6, leg=33),
    # 23:30 IST (user: one experiment scaling, use the free cores): F7GLSDP "wide""""": 40 practice worlds per
    # update instead of 16 (same 3:1 yard:arena and 1:1 drill:yard mix), minibatch 1024 instead of 256,
    # one process per world (--subproc); from F7GLSDP try 2 at 12M. NOT LAUNCHED: benchmark 1,434 steps/s vs
    # 1,345 (16 worlds, --subproc); even with 1 epoch it tops at ~1,850: the trainer's main loop (per-world work
    # in one Python process) is the limit, not the worlds or the update.
    "F7GLSDPW": dict(switches=_SDP, fusion=False, branch_model="run_F7GLSDP_try2/model_12001312.zip",
                     yard_envs=30, drill_envs=15, n_envs=40, batch=1024, leg=17),
})


class ConstantRate:
    """A fixed learning rate (picklable, so a saved run resumes with it)."""

    def __init__(self, value):
        self.value = float(value)

    def __call__(self, progress_remaining):
        return self.value


def use_rate(model, run):
    """Runs with a fixed ``lr`` override the continued schedule (weights and Adam moments unchanged)."""
    if RUNS[run].get("lr") is None:
        return
    rate = ConstantRate(RUNS[run]["lr"])
    model.learning_rate = rate
    model.lr_schedule = rate
    for group in model.policy.optimizer.param_groups:
        group["lr"] = rate.value
BRANCH_AT = 1_007_616
YARD_ENVS = 8
ROLLOUT = N_ENVS * HYPER["n_steps"]   # 8,192
SUBPROC = False            # --subproc (2026-11-16 23:20 IST): each practice world in its own process (same
                           # worlds, seeds and batches as one process, just faster wall-clock when cores are free)
PRACTICE_EVERY = 100_000   # --practice-every / --yard-every change these (long runs: 1M / 500k)
YARD_EVERY = 250_000
FORGET_GUARD = 0.93


def aligned(step):
    return ((step + ROLLOUT - 1) // ROLLOUT) * ROLLOUT


def input_switches(run):
    return {k: v for k, v in RUNS[run]["switches"].items() if k in INPUTS}


class LeanInfoVecEnv(DummyVecEnv):
    """DummyVecEnv without the per-step deepcopy of the info dicts (2026-11-16, ~8% of a step).

    Every environment returns a fresh info dict each step and the trainer only reads
    it at once (SB3's terminal observation and time-limit flag, Monitor's episode
    entry, ``Progress``), so a shallow copy of the list gives exactly the same
    training. Observations, rewards and dones are copied as before.
    """

    def step_wait(self):
        for env_idx in range(self.num_envs):
            obs, self.buf_rews[env_idx], terminated, truncated, self.buf_infos[env_idx] = \
                self.envs[env_idx].step(self.actions[env_idx])
            self.buf_dones[env_idx] = terminated or truncated
            self.buf_infos[env_idx]["TimeLimit.truncated"] = truncated and not terminated
            if self.buf_dones[env_idx]:
                self.buf_infos[env_idx]["terminal_observation"] = obs
                obs, self.reset_infos[env_idx] = self.envs[env_idx].reset()
            self._save_obs(env_idx, obs)
        return (self._obs_from_buf(), np.copy(self.buf_rews), np.copy(self.buf_dones),
                [dict(info) for info in self.buf_infos])


def make_envs(run, seed, leg=0):
    """``leg`` > 0 (a continuation) gives the yard rounds a fresh stream. ``drill_envs``: the first
    this many yard environments play only search drills (rl/round1_env.py setup_drill)."""
    switches = RUNS[run]["switches"]
    yard_envs = RUNS[run].get("yard_envs", YARD_ENVS)
    drills = RUNS[run].get("drill_envs", 0)
    fns = [lambda i=i: Monitor(YardPractice(seed * 100 + i + 50 * leg, drill=i < drills, **switches))
           for i in range(yard_envs)]
    fns += [lambda: Monitor(Round1ArenaEnv(**switches)) for _ in range(RUNS[run].get("n_envs", N_ENVS) - yard_envs)]
    if SUBPROC:
        from stable_baselines3.common.vec_env import SubprocVecEnv
        env = SubprocVecEnv(fns, start_method="fork")
    else:
        env = LeanInfoVecEnv(fns)
    if RUNS[run].get("window"):
        from rl.window_brain import WindowVecEnv
        env = WindowVecEnv(env, RUNS[run]["window"])
    return env


def branch_source(parent):
    """The parent's 1M checkpoint: model_1007616.zip, or (after a graceful restart moved the
    rollout grid, 2026-11-16) the first checkpoint within 4 rollouts past it."""
    exact = parent / f"model_{BRANCH_AT}.zip"
    if exact.exists():
        return exact
    near = sorted((int(m.stem.split("_")[1]), m) for m in parent.glob("model_*.zip")
                  if BRANCH_AT <= int(m.stem.split("_")[1]) < BRANCH_AT + 4 * ROLLOUT)
    if not near:
        raise FileNotFoundError(f"{parent} has no checkpoint at {BRANCH_AT:,} steps")
    return near[0][1]


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
                                        stuck=bool(info.get("stuck") or info.get("frozen")),
                                        losses=info.get("round_losses"), look=info.get("round_look")))
        self.recent = self.recent[-300:]
        return self.stopped is None

    def _mean(self, key):
        values = [r[key] for r in self.recent if r.get(key) is not None]
        return float(np.mean(values)) if values else None

    def _on_rollout_end(self):
        steps = self.num_timesteps
        elapsed = time.perf_counter() - self.started
        rate = lambda key: float(np.mean([r[key] for r in self.recent])) if self.recent else None
        row = dict(steps=steps, wall_seconds=round(elapsed, 1),
                   steps_per_second=round((steps - self.start) / elapsed, 1),
                   learning_rate=self.model.policy.optimizer.param_groups[0]["lr"],
                   recent_rounds=len(self.recent), recent_win_rate=rate("win"),
                   recent_shot_win_rate=rate("shot"), recent_stuck_rate=rate("stuck"),
                   recent_losses_per_round=self._mean("losses"), recent_look_per_round=self._mean("look"))
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
    if spec.get("branch_from") or spec.get("branch_model"):
        from rl.round2_brain import make_branch
        if spec.get("branch_model"):
            branch = spec["branch_model"]
            if isinstance(branch, dict):      # per try: try n continues seed n's checkpoint
                branch = branch[attempt]
            source = ROOT / "rl_artifacts" / campaign / branch
        else:
            source = branch_source(ROOT / "rl_artifacts" / campaign / f"run_{spec['branch_from']}_try{attempt}")
        model, start = make_branch(make_envs(run, seed, leg=spec.get("leg", 2)), source, spec["fusion"],
                                   bool(spec["switches"].get("privileged")), total, seed)
    elif spec.get("window"):
        from rl.window_brain import make_window_copy
        torch.set_num_threads(2)
        model = make_window_copy(make_envs(run, seed), observation_size(**input_switches(run)), total,
                                 fusion=spec["fusion"], window=spec["window"], seed=seed)
    else:
        model = make_round1_copy(make_envs(run, seed), spec["fusion"], total, seed=seed)
    use_rate(model, run)
    if spec.get("batch"):          # wide runs (more worlds per update): bigger minibatches, same epochs
        model.batch_size = spec["batch"]
    callback = Progress(directory, run, total, start=start)
    dump(directory / "config.json", dict(
        run=run, attempt=attempt, seed=seed, steps=total, campaign=campaign, start=start,
        branch_from=(str(source) if (spec.get("branch_from") or spec.get("branch_model")) else None),
        world=dict(eye_hide=bool(spec["switches"].get("eye_hide")), flee_stay=bool(spec["switches"].get("flee_stay")),
                   close_start_share=spec["switches"].get("close_start_share", 0.0)),
        plan="docs/MOVING_TARGET_RUN_LIST_2026-11-06.md, round 1, cut scope (no box arena, no yard flips, "
             "no R3/R4/B1); exams every ~100k, yard exam at ~250k/500k/750k/end",
        starts_from=f"today's brain, model_7757824 ({FROZEN_STEPS:,} steps), weights and optimizer",
        switches={k: bool(spec["switches"].get(k, False)) for k in SCORING + INPUTS},
        hider_share=spec["switches"].get("hider_share", 1 / 3),
        fusion=spec["fusion"], window=spec.get("window"), observation_size=observation_size(**input_switches(run)),
        trainable_parameters=sum(p.numel() for p in model.policy.parameters()),
        worlds=dict(yard=spec.get("yard_envs", YARD_ENVS), plain_arena=spec.get("n_envs", N_ENVS) - spec.get("yard_envs", YARD_ENVS)),
        look_after=spec["switches"].get("look_after", 0),
        practice_every=PRACTICE_EVERY, yard_every=YARD_EVERY,
        target=dict(moving=True, hider_share=1 / 3, run_step=0.638, sprint_step=0.929),
        practice_exams_at=callback.practice + [aligned(total)], yard_exams_at=callback.yard + [aligned(total)],
        n_envs=N_ENVS, **HYPER, fast_sim=True,
        learning_rate=(f"constant {spec['lr']}" if spec.get("lr") is not None else
                       "today's brain's line continued: 0.00015 -> 0.00003 over 10,002,432, from 7,757,824"),
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


def resume(run, attempt, total, campaign, leg=1):
    """Continue a finished run from its last checkpoint to ``total`` steps.

    Same folder (new checkpoints, exams and rollout rows are added; nothing is
    overwritten but status.json), seed + 1000 x ``leg`` for the new episodes and
    yard stream ``leg`` (each continuation should use a leg not used before in the
    run's line: 0 first leg, 1 first continuation, 2 branches; 2026-11-16 long runs: 3), the
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
    rate = ConstantRate(RUNS[run]["lr"]) if RUNS[run].get("lr") is not None else ContinuedRate(total)
    model = FixedContextRecurrentPPO.load(str(path), env=make_envs(run, seed, leg=leg), device="cpu",
                                          custom_objects=dict(learning_rate=rate, lr_schedule=rate))
    if model.num_timesteps != start:
        raise RuntimeError(f"checkpoint says {model.num_timesteps} steps, file name {start}")
    model.set_random_seed(seed + 1000 * leg)
    callback = Progress(directory, run, total, start=start)
    dump(directory / f"config_resume_{start}.json", dict(
        run=run, attempt=attempt, resumed_from=str(path), start=start, steps=total, episode_seed=seed + 1000 * leg,
        yard_round_stream=f"leg {leg} (fresh)", practice_every=PRACTICE_EVERY, yard_every=YARD_EVERY, learning_rate_now=rate(1 - start / total),
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
    global PRACTICE_EVERY, YARD_EVERY, SUBPROC
    parser = argparse.ArgumentParser()
    parser.add_argument("--run", choices=sorted(RUNS), required=True)
    parser.add_argument("--try", dest="attempt", type=int, choices=tuple(SEEDS), default=1)
    parser.add_argument("--steps", type=int, default=None, help="default 1,007,616; branches 2,015,232")
    parser.add_argument("--campaign", default=f"moving_target_round1_{date.today():%Y%m%d}")
    parser.add_argument("--resume", action="store_true", help="continue the run's last checkpoint to --steps")
    parser.add_argument("--leg", type=int, default=1, help="--resume: yard/episode stream (use a new one each time)")
    parser.add_argument("--practice-every", type=int, default=PRACTICE_EVERY, help="steps between practice exams")
    parser.add_argument("--yard-every", type=int, default=YARD_EVERY, help="steps between yard exams")
    parser.add_argument("--subproc", action="store_true", help="one process per practice world (spare cores)")
    args = parser.parse_args()
    PRACTICE_EVERY, YARD_EVERY = args.practice_every, args.yard_every
    SUBPROC = args.subproc
    if args.steps is None:
        args.steps = 2_015_232 if (RUNS[args.run].get("branch_from") or RUNS[args.run].get("branch_model")) else 1_007_616
    if args.resume:
        resume(args.run, args.attempt, args.steps, args.campaign, args.leg)
    else:
        train(args.run, args.attempt, args.steps, args.campaign)


if __name__ == "__main__":
    main()
