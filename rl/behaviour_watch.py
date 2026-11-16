"""Run rl/behaviour_probe.py on every run's checkpoint at each million-step mark (2026-11-16).

    nohup .venv/bin/python -m rl.behaviour_watch moving_target_round1_20261115 \
        > rl_artifacts/moving_target_round1_20261115/behaviour_watch.log 2>&1 &

Marks: aligned(k x 1,000,000) for k = 1..10 (the yard-exam checkpoints the trainers
save anyway). Output: <run folder>/behaviour_<steps>.json.gz; today's game brain and
run A at 1M in <campaign>/behaviour/. At most ``LIMIT`` probes at once, at nice 3,
so training keeps priority. Stops when every run is complete and probed.
"""
import os
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MARKS = [((k * 1_000_000 + 8191) // 8192) * 8192 for k in range(1, 11)]
LIMIT = int(os.environ.get("PROBE_LIMIT", "3"))
RUN_A = ROOT / "rl_artifacts/moving_target_20261105/run_A/model_1007616.zip"


def wanted(folder):
    jobs = []
    out = folder / "behaviour"
    out.mkdir(exist_ok=True)
    for tag, flag in (("", []), ("_eye", ["--eye-hide"])):
        if not (out / f"today{tag}.json.gz").exists():
            jobs.append((out / f"today{tag}.json.gz", ["--today", *flag]))
        if not (out / f"runA_1007616{tag}.json.gz").exists():
            jobs.append((out / f"runA_1007616{tag}.json.gz", ["--run", "A", "--model", str(RUN_A), *flag]))
    if not (out / "today_drill.json").exists():
        jobs.append((out / "today_drill.json", ["--today"], "rl.drill_exam"))
    for directory in sorted(folder.glob("run_*_try*")):
        run = directory.name[4:].rsplit("_try", 1)[0]
        steps = sorted(int(m.stem.split("_")[1]) for m in directory.glob("model_*.zip"))
        for mark in MARKS:
            # The first checkpoint at or within one rollout past the mark (restarts shift the grid).
            near = [s for s in steps if mark <= s < mark + 8192 * 4]
            if not near:
                continue
            model = directory / f"model_{near[0]}.zip"
            if time.time() - model.stat().st_mtime <= 60:
                continue
            # Eye-hidden variant (2026-11-16): for every run from 3M on, and for the F7/F7GL lines.
            variants = [("", [])]
            if mark >= 3_000_000 or run in ("F7", "F7GL"):
                variants.append(("_eye", ["--eye-hide"]))
            for tag, flag in variants:
                result = directory / f"behaviour{tag}_{near[0]}.json.gz"
                if not result.exists():
                    jobs.append((result, ["--run", run, "--model", str(model), *flag]))
            # Search-drill exam (2026-11-16) for the new-world runs.
            if run.startswith("F7GL") and not (directory / "STOP").exists():
                result = directory / f"drill_{near[0]}.json"
                if not result.exists():
                    jobs.append((result, ["--run", run, "--model", str(model)], "rl.drill_exam"))
    return jobs


def main():
    folder = ROOT / "rl_artifacts" / sys.argv[1]
    env = dict(os.environ, PYTHONPATH=str(ROOT), OMP_NUM_THREADS="1", MKL_NUM_THREADS="1")
    running = {}
    while True:
        running = {k: p for k, p in running.items() if p.poll() is None}
        for job in wanted(folder):
            result, extra = job[0], job[1]
            module = job[2] if len(job) > 2 else "rl.behaviour_probe"
            if len(running) >= LIMIT:
                break
            if result in running:
                continue
            part = result.with_name(result.name + ".part")
            if part.exists() and time.time() - part.stat().st_mtime < 1200:
                continue        # a probe from an earlier watcher is still writing it
            log = (folder / "behaviour_watch_jobs.log").open("a")
            tmp = result.with_name(result.name + ".part")
            command = ["nice", "-n", "3", sys.executable, "-m", module, *extra, "--out", str(tmp)]
            running[result] = subprocess.Popen(
                ["bash", "-c", " ".join(f"'{c}'" for c in command) + f" && mv '{tmp}' '{result}'"],
                cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT)
            print(f"{time.strftime('%H:%M:%S')} probe {result.relative_to(folder)}", flush=True)
        statuses = [(d / "status.json").read_text() if (d / "status.json").exists() else ""
                    for d in folder.glob("run_*_try*")]
        if not running and not wanted(folder) and all('"complete"' in s for s in statuses):
            print("all probed", flush=True)
            return
        time.sleep(30)


if __name__ == "__main__":
    main()
