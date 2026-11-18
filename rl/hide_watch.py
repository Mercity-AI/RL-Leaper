"""Checks for the hide retrain runs (2026-11-18), one queue for every run, at most LIMIT jobs at once.

    nohup .venv/bin/python -m rl.hide_watch > rl_artifacts/hide_retrain_20261118/hide_watch.log 2>&1 &

For every run in RUNS (both tries) and every checkpoint at a check mark (the first past 1M steps after the
start, then the final one), with Lola's real sight heights:

  hide_<set>_<steps>.json        rl/hide_exam.py, sets stay (100), moveon (40), arena (50)
  behaviour_rh_<steps>.json.gz   rl/behaviour_probe.py, 150 rounds (chase, backwards, sight-breaks:
                                 rl/chase_check.py)
  drill_rh_<steps>.json          rl/drill_exam.py, 100 drills

The still-target guard and the yard exam run inside the trainer (rl/round1_job.py). Stops when every run
has finished and every check is written. Jobs run at nice 5 so the trainers keep priority.
"""
import os
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CAMPAIGN = ROOT / "rl_artifacts/moving_target_round1_20261115"
START = 9_003_040
STEP_MARK = 1_000_000
RUNS = ["F7GLSDP4CH", "F7GLSDP4CS", "F7GLSDP4CHY", "F7GLSDP4CHS", "F7GLSDP4CG", "F7GLSDP4CG15", "F7GLSDP4CGD", "F7GLSDP4CGH"]
LIMIT = int(os.environ.get("CHECK_LIMIT", "4"))     # at least this many checks at once
CORES = os.cpu_count() or 16


def trainers_running():
    """Training processes now (each keeps one core busy); checks may use the cores they leave."""
    out = subprocess.run(["pgrep", "-fc", "python -m rl.round1_train"], capture_output=True, text=True).stdout
    return int(out.strip() or 0)


def in_flight(out):
    """A check started by an earlier watcher is still writing (its log is fresh, no result yet)."""
    log = out.with_suffix(out.suffix + ".log")
    return log.exists() and not out.exists() and time.time() - log.stat().st_mtime < 20 * 60


def checkpoints(directory):
    steps = sorted(int(m.stem.split("_")[1]) for m in directory.glob("model_*.zip"))
    steps = [s for s in steps if s > START]
    if not steps:
        return []
    # The trainer saves its 1M checkpoint at the first update past aligned(10,000,000) (10,002,464), a little
    # before START + 1M: take the checkpoint within 4 updates either side.
    marks = []
    for mark in (500_000, 1_000_000, 1_500_000):      # +0.5M marks exist only for the reward-redesign arms
        marks += [s for s in steps if abs(s - (START + mark)) <= 8192 * 4][:1]
    status = (directory / "status.json").read_text() if (directory / "status.json").exists() else ""
    if '"complete"' in status or '"stopped' in status:
        marks.append(steps[-1])
    return sorted(set(marks))


def jobs_for(directory, run):
    jobs = []
    for steps in checkpoints(directory):
        model = directory / f"model_{steps}.zip"
        if time.time() - model.stat().st_mtime < 30:
            continue
        for name in ("stay", "moveon", "arena"):
            out = directory / f"hide_{name}_{steps}.json"
            if not out.exists():
                jobs.append((out, ["rl.hide_exam", "--set", name, "--run", run, "--model", str(model), "--out", str(out)]))
        out = directory / f"behaviour_rh_{steps}.json.gz"
        if not out.exists():
            jobs.append((out, ["rl.behaviour_probe", "--run", run, "--model", str(model), "--real-heights",
                               "--out", str(out)]))
        out = directory / f"drill_rh_{steps}.json"
        if not out.exists():
            jobs.append((out, ["rl.drill_exam", "--run", run, "--model", str(model), "--real-heights", "--out", str(out)]))
        if finished(directory) and steps == checkpoints(directory)[-1]:
            # The final checkpoint: a 450-round probe (seeds 90000-90449) for tight "ducked" intervals.
            out = directory / f"behaviour_rh450_{steps}.json.gz"
            if not out.exists():
                jobs.append((out, ["rl.behaviour_probe", "--run", run, "--model", str(model), "--real-heights",
                                   "--rounds", "450", "--out", str(out)]))
            # The final checkpoint: the baselines' 300-round yard exam (seeds 80000-80299, real heights).
            folder = directory / "final300"
            folder.mkdir(exist_ok=True)
            name = f"{run}_try{directory.name.rsplit('_try', 1)[1]}_{steps}"
            out = folder / f"{name}_yard_summary.json"
            if not out.exists():
                jobs.append((out, ["rl.long_final_exam", "--job", "yard", "--name", name, "--run", run,
                                   "--model", str(model), "--out", str(folder), "--real-heights"]))
    return jobs


def finished(directory):
    status = (directory / "status.json").read_text() if (directory / "status.json").exists() else ""
    return '"complete"' in status or '"stopped' in status or '"failed"' in status


def main():
    env = dict(os.environ, PYTHONPATH=str(ROOT), OMP_NUM_THREADS="1", MKL_NUM_THREADS="1")
    running = {}
    while True:
        for out, process in list(running.items()):
            if process.poll() is not None:
                print(f"{time.strftime('%H:%M:%S')} done {out.name} (exit {process.returncode})", flush=True)
                del running[out]
        pending, all_done = [], True
        for run in RUNS:
            for attempt in (1, 2, 3):
                directory = CAMPAIGN / f"run_{run}_try{attempt}"
                if not directory.exists():
                    all_done = False
                    continue
                pending += [j for j in jobs_for(directory, run) if j[0] not in running and not in_flight(j[0])]
                all_done &= finished(directory)
        limit = max(LIMIT, CORES - 1 - trainers_running())
        while pending and len(running) < limit:
            out, command = pending.pop(0)
            log = open(out.with_suffix(out.suffix + ".log"), "w")
            running[out] = subprocess.Popen(["nice", "-n", "5", sys.executable, "-m", *command], cwd=ROOT, env=env,
                                            stdout=log, stderr=subprocess.STDOUT)
            print(f"{time.strftime('%H:%M:%S')} start {out.name}", flush=True)
        if all_done and not pending and not running:
            print("all checks written", flush=True)
            return
        time.sleep(20)


if __name__ == "__main__":
    main()
