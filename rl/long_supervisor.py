"""Keep the 2026-11-16 long runs going to 10,002,432 steps (rl/round1_train.py).

    nohup .venv/bin/python -m rl.long_supervisor moving_target_round1_20261115 \
        > rl_artifacts/moving_target_round1_20261115/long_supervisor.log 2>&1 &

Every 60 s, for each planned run (``PLAN``):
- a trainer process for it is alive: nothing to do;
- status "complete": done;
- a STOP file starting "stopped: restart" (a graceful restart, e.g. onto new code):
  once its trainer has exited, the file is removed and the run resumes;
- any other STOP file (the forgetting guard, or a person): left stopped;
- otherwise (not started, stopped for a restart, crashed, machine restarted): resume
  from its last checkpoint with a fresh episode/yard stream (leg 4, 5, ... recorded
  in the run folder's ``legs_used``), at the plan's priority. At most 3 crashes a run.
- ``BRANCHES``: start a branch (``train``) once its parent's 1M checkpoint exists.

Exams: practice every 1M, yard every 500k (round1_train flags), as for the first leg
of the long runs (leg 3).
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TOTAL = 10_002_432
# Runs branched late (2026-11-16 ~21:15 IST, from F7GLSDP try 1 at 7M) go to 12M: 5M on the new world.
TOTALS = {"F7GLSDR": 12_001_280, "F7GLSDN": 12_001_280, "F7GLSDRN": 12_001_280,
          # 21:20 IST (advisor, 3-4 h deadline): SDP, the only line still rising at 7M, extended to 12M;
          # SDV capped at 11M so it ends by ~23:10 IST (training freezes ~23:15).
          "F7GLSDV": 11_001_856,
          # 23:12 IST: the picked line (F7GLSDP) scaled on to 16M (user: scale what works; cores idle).
          "F7GLSDP": 16_007_168,
          # 23:45 IST: three one-factor arms on the picked line, from SDP 12M (per try) to 16M.
          "F7GLSDP2": 16_007_168, "F7GLSDPC": 16_007_168, "F7GLSDPF": 16_007_168,
          "F7GLSDP14": 16_007_168, "F7GLSDPT": 16_007_168,
          "F7GLSDPA": 18_006_016,
          "F7GLSDPB2": 14_008_320, "F7GLSDPB5": 14_008_320,
          # 02:30 IST 17 Nov: four anti-twitch arms from the pick at 10M, +2M (read at 11M/11.5M/12M).
          "F7GLSDPG5": 12_001_280, "F7GLSDPGF": 12_001_280, "F7GLSDPGFO": 12_001_280, "F7GLSDPBF": 12_001_280,
          # 02:32 IST: G10 on the free cores, with an early stop (yard stuck > 12% or still < 0.94 at 10.5M/11M).
          "F7GLSDPG10": 12_001_280,
          # 03:15 IST: from the pick line's own 4M (per try) back to 10M, reverse charge on from the start.
          "F7GLSDP4C": 14_008_320, "F7GLSDP4T": 10_002_432, "F7GLSDP4L": 10_002_432}   # 04:21 IST: 4C (try 2 only) extended to 14M (user: keep scaling it)   # 00:23 IST: reverse charge, two doses   # 23:58 IST: approach-speed spin-off of the pick; 00:10 IST (user: kill
          # every other run, scale this one) -> 18M with its worlds in parallel processes
FLAGS = ["--practice-every", "1000000", "--yard-every", "500000"]
# 23:20 IST (user: only one experiment is scaling, use the free cores): its practice worlds run in parallel processes.
EXTRA_FLAGS = {"F7GLSDP": ["--subproc"]}   # 00:20 IST: F7GLSDPA back to one process (with --subproc it ran ~530 steps/s, main loop ~50% busy, vs ~1,000 alone)
# (run, try, nice)
# 2026-11-16 ~11:50: the runs flat since 1M were stopped (user's OK; STOP files, checkpoints
# kept); their slots went to the seek-worthy practice runs (rl/round1_train.py F7GLE/F7GLS/F7GLS0).
# 2026-11-16 ~12:07: F7 try 1 (control, flat since 1M), F7GL try 2 (old world, answered by try 1) and
# F7GLE try 2 stopped; their slots went to F7GLS tries 5-7 (the search-drill run F7GLD failed its gate).
# ~18:09 IST (12:39 UTC): F7GLS0 x2 and F7GLS tries 6-7 stopped for the search drill v2 run F7GLSD x4
# (user: "a search drill environment does need to exist"); back-fill now adds F7GLSD tries.
# ~18:15 IST: user rule "max 2 seeds per experiment": extra tries stopped; freed CPU goes to new
# experiments (2 seeds each), never more seeds of the same one. No back-fill of extra tries.
PLAN = [("F7GL", 1, 0)]
# ~18:27 IST: F7GLSL x2 swapped for F7GLSDW x2 (R6 pays for walking to where it lost her; F7GLSDL
# already covers the higher learning rate).
# ~19:26 IST: F7GLSDW x2 -> F7GLSDP x2 (its reach bonus fired 0 times in 40 drills; R6 now paid as
# plain progress toward where it lost her, no refund).
# ~21:15 IST: + F7GLSDR, F7GLSDN, F7GLSDRN x2 (drill-to-yard gap: less staged drills, she ducks into
# cover near where she vanished), filling CPU left idle by finished runs.
for _run in ("F7GLE", "F7GLS", "F7GLSD", "F7GLSDL", "F7GLSDX", "F7GLSDP", "F7GLSDR", "F7GLSDN", "F7GLSDRN", "F7GLSDV",
             "F7GLSDP2", "F7GLSDPC", "F7GLSDPF", "F7GLSDP14", "F7GLSDPT",
             "F7GLSDPA", "F7GLSDPB2", "F7GLSDPB5",
             "F7GLSDPG5", "F7GLSDPGF", "F7GLSDPGFO", "F7GLSDPBF", "F7GLSDPG10",
             "F7GLSDP4C", "F7GLSDP4T", "F7GLSDP4L"):
    PLAN += [(_run, 1, 0), (_run, 2, 0)]
# run, try -> parent folder whose 1M checkpoint must exist before ``train`` starts it;
# runs with a fixed branch_model start at once ("-").
BRANCHES = {("F7GL", 2): "run_F7_try2", ("F7GLS0", 1): "run_F7_try1", ("F7GLS0", 2): "run_F7_try2"}
BRANCHES.update({(run, t): "-" for run, t, _ in PLAN if run in ("F7GLE", "F7GLS", "F7GLSL", "F7GLSD", "F7GLSDL", "F7GLSDX", "F7GLSDW", "F7GLSDP", "F7GLSDR", "F7GLSDN", "F7GLSDRN", "F7GLSDV", "F7GLSDP2", "F7GLSDPC", "F7GLSDPF", "F7GLSDP14", "F7GLSDPT", "F7GLSDPA", "F7GLSDPB2", "F7GLSDPB5", "F7GLSDPG5", "F7GLSDPGF", "F7GLSDPGFO", "F7GLSDPBF", "F7GLSDPG10", "F7GLSDP4C", "F7GLSDP4T", "F7GLSDP4L")})
# Back-fill (2026-11-16): keep at least MIN_TRAINERS trainers alive; when runs end or the
# forgetting guard stops one, start the next spare F7GLS try (the main bet) so no CPU idles.
MIN_TRAINERS = 13
FILL = []   # user: no extra seeds; idle CPU gets a new experiment instead (chosen by hand)
FIRST_LEG = 4          # legs 0-2 were used before 2026-11-16, leg 3 by the first long leg
MAX_CRASHES = 3


def alive(run, attempt):
    needle = f"rl.round1_train --run {run} --try {attempt} "
    for proc in Path("/proc").iterdir():
        if not proc.name.isdigit():
            continue
        try:
            cmd = (proc / "cmdline").read_bytes().replace(b"\0", b" ").decode()
        except OSError:
            continue
        if needle in cmd + " ":
            return True
    return False


def status(directory):
    try:
        return json.loads((directory / "status.json").read_text()).get("status", "")
    except (OSError, ValueError):
        return ""


def launch(campaign, run, attempt, nice, resume):
    directory = ROOT / "rl_artifacts" / campaign / f"run_{run}_try{attempt}"
    command = ["nice", "-n", str(nice), sys.executable, "-m", "rl.round1_train", "--run", run, "--try", str(attempt),
               "--steps", str(TOTALS.get(run, TOTAL)), "--campaign", campaign, *FLAGS, *EXTRA_FLAGS.get(run, [])]
    if resume:
        used = directory / "legs_used"
        legs = [int(x) for x in used.read_text().split()] if used.exists() else []
        leg = max(legs + [FIRST_LEG - 1]) + 1
        used.write_text(" ".join(str(x) for x in legs + [leg]))
        command += ["--resume", "--leg", str(leg)]
        log_name = f"train_{run}_try{attempt}_leg{leg}.log"
    else:
        log_name = f"train_{run}_try{attempt}.log"
    log = (ROOT / "rl_artifacts" / campaign / log_name).open("a")
    subprocess.Popen(command, cwd=ROOT, stdout=log, stderr=subprocess.STDOUT, start_new_session=True,
                     env=dict(os.environ, PYTHONPATH=str(ROOT), OMP_NUM_THREADS="1", MKL_NUM_THREADS="1"))
    print(f"{time.strftime('%H:%M:%S')} started {run} try {attempt}: {' '.join(command[3:])}", flush=True)


def trainers_alive():
    count = 0
    for proc in Path("/proc").iterdir():
        if proc.name.isdigit():
            try:
                cmd = (proc / "cmdline").read_bytes().replace(b"\0", b" ").decode()
            except OSError:
                continue
            count += "-m rl.round1_train " in cmd
    return count


def fill(campaign):
    """Start spare F7GLS tries while fewer than MIN_TRAINERS trainers are alive."""
    folder = ROOT / "rl_artifacts" / campaign
    alive = trainers_alive()
    for run, attempt in FILL:
        if (run, attempt, 0) in PLAN:
            continue
        if (folder / f"run_{run}_try{attempt}").exists():
            PLAN.append((run, attempt, 0))
            BRANCHES[(run, attempt)] = "-"
            continue
        if alive >= MIN_TRAINERS:
            break
        PLAN.append((run, attempt, 0))
        BRANCHES[(run, attempt)] = "-"
        launch(campaign, run, attempt, 0, resume=False)
        alive += 1


def tick(campaign):
    folder = ROOT / "rl_artifacts" / campaign
    fill(campaign)
    pending = 0
    for run, attempt, nice in PLAN:
        directory = folder / f"run_{run}_try{attempt}"
        if alive(run, attempt):
            pending += 1
            continue
        if not directory.exists():
            parent = BRANCHES.get((run, attempt))
            source = None
            if parent == "-":
                launch(campaign, run, attempt, nice, resume=False)
                pending += 1
                continue
            if parent:
                from rl.round1_train import branch_source
                try:
                    source = branch_source(folder / parent)
                except FileNotFoundError:
                    source = None
            if source is not None and time.time() - source.stat().st_mtime > 60:
                launch(campaign, run, attempt, nice, resume=False)
            pending += 1
            continue
        state = status(directory)
        if state == "complete":
            continue
        stop = directory / "STOP"
        if stop.exists():
            if stop.read_text().startswith("stopped: restart"):
                stop.unlink()
            else:
                continue
        if state == "failed":
            crashes = directory / "crashes"
            count = int(crashes.read_text()) + 1 if crashes.exists() else 1
            crashes.write_text(str(count))
            if count > MAX_CRASHES:
                print(f"{time.strftime('%H:%M:%S')} {run} try {attempt}: crashed {count} times, left stopped",
                      flush=True)
                (directory / "STOP").write_text("stopped: crashed too often (long_supervisor)")
                continue
        launch(campaign, run, attempt, nice, resume=True)
        pending += 1
    return pending


def main():
    campaign = sys.argv[1]
    while tick(campaign):
        time.sleep(60)
    print(f"{time.strftime('%H:%M:%S')} every run is complete", flush=True)


if __name__ == "__main__":
    main()
