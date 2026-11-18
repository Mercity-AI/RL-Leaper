"""Final exams for the long runs (2026-11-16): a bigger yard exam on fresh seeds, the same
rounds with sampled moves, and the last-seen / hiding-spot probe, for every brain.

    python -m rl.long_final_exam --label 10M [--campaign C] [--jobs 16] [--at 10002432]

Brains: each run folder's checkpoint at ``--at`` steps (default: its last ``model_*.zip``),
plus today's game brain and run A at 1M. Per brain, three jobs (one process each, run
``--jobs`` at a time):

  yard     300 yard rounds, seeds 80000-80299 (never used in practice or in the
           regular yard exam), the brain's average move, as the game plays it
  sampled  the same 300 rounds with the brain's moves sampled (torch seed fixed)
  probe    rl.lastseen_probe, 60 hider rounds starting 10-20 map units apart

Output: <campaign>/final_<label>/<brain>_{yard,sampled}_{summary,episodes}.json, and
<brain>_probe.json; one line per job in results.jsonl. Existing outputs are skipped,
so a rerun only fills the gaps.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SEEDS = list(range(80000, 80300))
RUN_A = ROOT / "rl_artifacts/moving_target_20261105/run_A/model_1007616.zip"


def brains(campaign, at):
    found = [("today", None, "today"), ("runA_1M", str(RUN_A), "A")]
    for directory in sorted((ROOT / "rl_artifacts" / campaign).glob("run_*_try*")):
        run, attempt = directory.name[4:].rsplit("_try", 1)
        models = sorted(directory.glob("model_*.zip"), key=lambda p: int(p.stem.split("_")[1]))
        if at:
            models = [m for m in models if int(m.stem.split("_")[1]) == at]
        if models:
            steps = int(models[-1].stem.split("_")[1])
            found.append((f"{run}_try{attempt}_{steps}", str(models[-1]), run))
    return found


def yard_job(name, model_path, run, out, deterministic, real_heights=False):
    import numpy as np
    import torch
    torch.set_num_threads(1)
    torch.manual_seed(80000)
    from rl.moving_target_exam import run_exam
    from rl.round1_env import Round1YardEnv
    from rl.round1_job import headline, load_model
    from rl.round1_train import input_switches
    inputs = {} if run in ("today", "A") else input_switches(run)
    if real_heights:
        inputs = dict(inputs, real_heights=True)
    probe = lambda: Round1YardEnv(SEEDS[0], **inputs)   # noqa: E731
    if run == "today":
        from rl.moving_target_brain import load_frozen_predictor
        model = load_frozen_predictor(probe)
    elif run == "A":
        from rl.moving_target_job import load
        model = load(model_path, "A")
    else:
        model = load_model(model_path, run, probe)
    seeds = iter(SEEDS)
    kind = "yard" if deterministic else "sampled"
    prefix = out / f"{name}_{kind}"
    summary, _ = run_exam(model, lambda: Round1YardEnv(next(seeds), **inputs), SEEDS, prefix,
                          deterministic=deterministic)
    rows = json.loads(Path(f"{prefix}_episodes.json").read_text())
    return dict(brain=name, kind=kind, rounds=len(rows), **headline(summary, rows),
                hider_catch=summary.get("hider_catch_rate"), wanderer_catch=summary.get("wanderer_catch_rate"))


def plan(campaign, label, at):
    out = ROOT / "rl_artifacts" / campaign / f"final_{label}"
    out.mkdir(parents=True, exist_ok=True)
    jobs = []
    for name, path, run in brains(campaign, at):
        for kind in ("yard", "sampled"):
            if not (out / f"{name}_{kind}_summary.json").exists():
                jobs.append([sys.executable, "-m", "rl.long_final_exam", "--job", kind, "--name", name,
                             "--run", run, "--model", path or "-", "--out", str(out)])
        if not (out / f"{name}_probe.json").exists():
            probe = [sys.executable, "-m", "rl.lastseen_probe", "--rounds", "60", "--out", str(out / f"{name}_probe.json")]
            if run == "today":
                probe.append("--today")
            elif run == "A":
                continue        # the probe has no run A loader; today's brain and run A share inputs
            else:
                probe += ["--run", run, "--model", path]
            jobs.append(probe)
    return out, jobs


def drive(out, jobs, limit, nice):
    env = dict(os.environ, PYTHONPATH=str(ROOT), OMP_NUM_THREADS="1", MKL_NUM_THREADS="1")
    running = []
    log = (out / "jobs.log").open("a")
    while jobs or running:
        running = [p for p in running if p.poll() is None]
        while jobs and len(running) < limit:
            command = jobs.pop(0)
            running.append(subprocess.Popen(["nice", "-n", str(nice), *command], cwd=ROOT, env=env,
                                            stdout=log, stderr=subprocess.STDOUT))
        time.sleep(2)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--campaign", default="moving_target_round1_20261115")
    parser.add_argument("--label")
    parser.add_argument("--at", type=int, default=None, help="checkpoint step (default: each run's last)")
    parser.add_argument("--jobs", type=int, default=16)
    parser.add_argument("--nice", type=int, default=0)
    parser.add_argument("--job", choices=("yard", "sampled"))
    parser.add_argument("--name")
    parser.add_argument("--run")
    parser.add_argument("--model")
    parser.add_argument("--out")
    parser.add_argument("--real-heights", action="store_true",
                        help="--job: her sight points at 1.25/1.03/0.81 map units (rl/round1_env.py SIGHT), for any brain")
    parser.add_argument("--first-seed", type=int, default=80000,
                        help="300 rounds from this seed (81000: the confirmation set, 2026-11-16)")
    args = parser.parse_args()
    if args.job:
        global SEEDS
        SEEDS = list(range(args.first_seed, args.first_seed + 300))
        out = Path(args.out)
        row = yard_job(args.name, None if args.model == "-" else args.model, args.run, out, args.job == "yard",
                       real_heights=args.real_heights)
        with (out / "results.jsonl").open("a") as stream:
            stream.write(json.dumps(row) + "\n")
        print(json.dumps(row), flush=True)
        return
    out, jobs = plan(args.campaign, args.label, args.at)
    print(f"{len(jobs)} jobs -> {out}", flush=True)
    drive(out, jobs, args.jobs, args.nice)
    print("done", flush=True)


if __name__ == "__main__":
    main()
