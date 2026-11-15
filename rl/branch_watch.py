"""Launch the round-2 branches (F7R6, F7B1, F7R6B1, F7HIDE) from each F7 try's 1M checkpoint.

    nohup python -m rl.branch_watch <campaign> > rl_artifacts/<campaign>/branch_watch.log &

Waits until run_F7_try<N>/model_1007616.zip has existed for 60 s, then starts the
four branches for that try at nice 15 (they use spare CPU first; the main runs
keep priority). Each branch continues to 2,015,232 steps.
"""
import os
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BRANCHES = ("F7R6", "F7B1", "F7R6B1", "F7HIDE")


def main():
    campaign = sys.argv[1]
    folder = ROOT / "rl_artifacts" / campaign
    waiting = {1, 2}
    while waiting:
        for attempt in sorted(waiting):
            model = folder / f"run_F7_try{attempt}" / "model_1007616.zip"
            if not model.exists() or time.time() - model.stat().st_mtime < 60:
                continue
            for name in BRANCHES:
                log = (folder / f"train_{name}_try{attempt}.log").open("a")
                subprocess.Popen(["nice", "-n", "15", sys.executable, "-m", "rl.round1_train", "--run", name,
                                  "--try", str(attempt), "--campaign", campaign],
                                 cwd=ROOT, stdout=log, stderr=subprocess.STDOUT, start_new_session=True,
                                 env=dict(os.environ, PYTHONPATH=str(ROOT), OMP_NUM_THREADS="1", MKL_NUM_THREADS="1"))
                print(f"{time.strftime('%H:%M:%S')} {name} try{attempt}: launched", flush=True)
            waiting.discard(attempt)
        time.sleep(30)
    print("all branches launched", flush=True)


if __name__ == "__main__":
    main()
