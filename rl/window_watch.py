"""Run the free window test (rl/window_exam.py) on F7 and FUSE as their checkpoints land.

    nohup python -m rl.window_watch <campaign> > rl_artifacts/<campaign>/window_watch.log &

For each run_F7_try* / run_FUSE_try* folder, at 1M (model_1007616.zip) and 2M
(model_2015232.zip): once the model file has existed for 60 s, play the yard
exam with the 128-step window (nice 5). Results: yard_window_exams.jsonl next
to the run's normal yard_exams.jsonl.
"""
import os
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MARKS = (1_007_616, 2_015_232)
RUNS = ("F7", "FUSE")


def main():
    folder = ROOT / "rl_artifacts" / sys.argv[1]
    todo = {(d, m) for d in folder.glob("run_*_try*") for m in MARKS
            if d.name[4:].rsplit("_try", 1)[0] in RUNS}
    while todo:
        for directory, mark in sorted(todo):
            model = directory / f"model_{mark}.zip"
            if not model.exists() or time.time() - model.stat().st_mtime < 60:
                continue
            run = directory.name[4:].rsplit("_try", 1)[0]
            log = (directory / "window_exam.log").open("a")
            subprocess.Popen(["nice", "-n", "5", sys.executable, "-m", "rl.window_exam", "--run", run,
                              "--model", str(model)], cwd=ROOT, stdout=log, stderr=subprocess.STDOUT,
                             start_new_session=True,
                             env=dict(os.environ, PYTHONPATH=str(ROOT), OMP_NUM_THREADS="1", MKL_NUM_THREADS="1"))
            print(f"{time.strftime('%H:%M:%S')} {directory.name} {mark}: window exam started", flush=True)
            todo.discard((directory, mark))
        time.sleep(30)
    print("all window exams started", flush=True)


if __name__ == "__main__":
    main()
