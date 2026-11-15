"""Continue every round-1 run to 2M steps as soon as its 1M leg has saved its final model.

    nohup python -m rl.round1_chain > rl_artifacts/<campaign>/chain.log &

Checks every 30 s. A run continues when model_1007616.zip has existed for 60 s
(its trainer saves it twice in a row) and it was not stopped by the forgetting
guard. Try 1 runs at normal priority, try 2 at nice 10, as in the first leg.
The 1M leg's own final exams keep running in its old process.
"""
import json
import os
import subprocess
import sys
import time
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIRST, TOTAL = 1_007_616, 2_015_232


def main():
    campaign = sys.argv[1] if len(sys.argv) > 1 else f"moving_target_round1_{date.today():%Y%m%d}"
    folder = ROOT / "rl_artifacts" / campaign
    waiting = {d for d in folder.glob("run_*_try*") if not (d / "resume_launched").exists()}
    while waiting:
        for directory in sorted(waiting):
            model = directory / f"model_{FIRST}.zip"
            if (directory / "STOP").exists():
                print(f"{directory.name}: stopped by the guard, not continued", flush=True)
                waiting.discard(directory)
                continue
            if not model.exists() or time.time() - model.stat().st_mtime < 60:
                continue
            name, attempt = directory.name[4:].rsplit("_try", 1)
            (directory / "resume_launched").write_text(time.strftime("%H:%M:%S"))
            log = (directory / "train_resume.log").open("a")
            command = ["nice", "-n", "0" if attempt == "1" else "10", sys.executable, "-m", "rl.round1_train",
                       "--run", name, "--try", attempt, "--resume", "--steps", str(TOTAL), "--campaign", campaign]
            subprocess.Popen(command, cwd=ROOT, stdout=log, stderr=subprocess.STDOUT, start_new_session=True,
                             env=dict(os.environ, PYTHONPATH=str(ROOT), OMP_NUM_THREADS="1", MKL_NUM_THREADS="1"))
            print(f"{time.strftime('%H:%M:%S')} {directory.name}: continuing to {TOTAL:,}", flush=True)
            waiting.discard(directory)
        time.sleep(30)
    print("all runs continued", flush=True)


if __name__ == "__main__":
    main()
