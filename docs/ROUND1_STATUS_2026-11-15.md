# Leaper vs a moving Lola: round 1 status and hand-off (2026-11-15, evening)

**All results live in the Hugging Face bucket `Mercity/RL-Leaper`, folder
`leaper_retrain_20261115/`** (`hf://buckets/Mercity/RL-Leaper/leaper_retrain_20261115`):
a copy of this whole working tree at the end of the session, including
`rl_artifacts/moving_target_round1_20261115/` (every checkpoint, exam,
diagnostic, log and `TODO.md`) and `rl_artifacts/smoke_round1/`. Git holds the
code and docs only (`rl_artifacts/` is git-ignored). To get the results back:

    hf sync hf://buckets/Mercity/RL-Leaper/leaper_retrain_20261115/rl_artifacts rl_artifacts

Plain-language summary first; exact numbers and how to continue below.
Plan: `docs/MOVING_TARGET_RUN_LIST_2026-11-06.md` (cut scope, see "What was
skipped"). Results folder (git-ignored): `rl_artifacts/moving_target_round1_20261115/`.
Live table at any time: `python -m rl.round1_report`.

## In plain words

- **Training is about 5x faster** for the real yard (84 -> ~400+ steps a second
  per core) with exactly the same simulation (bit-for-bit tests), so
  long runs are now affordable.
- **Four retrains** of today's brain (copies, 2 tries each) are running in the
  real yard plus the old arena, with a moving and hiding Lola, towards 2M steps.
  Up to ~1M steps they are **level with run A and today's brain** on the
  headline numbers (within the exam's noise); no idea is clearly better yet.
  As expected, signal needs 1-2M steps.
- **The "it never checks her hiding spot" number was misleading.** A
  diagnostic shows the Leaper **sees her in her hiding spot within 10 s in
  90-95% of hidings** (today's brain 84-90%). The old test asked it to stand
  within 4 units of the spot within 10 s, which a perfect walk can do in only
  ~25% of hidings (median 50 units of walking away), and her "hiding spots"
  are only hidden on the flat map: its eye, 2.4 units up, sees over low junk.
- **The real weakness is close range with junk in between:** it sees her
  10-15 units away behind junk, then dithers and bumps for a minute or
  pushes in and gets stuck (stuck/frozen 11-24% of yard rounds), instead of
  walking around. That is a navigation problem, not a search problem.

## What runs (all copies of today's brain, 16 practice worlds: 8 real yard + 8 old arena)

| Run | Changes | Compared with |
|---|---|---|
| F3 | worlds only, old scorecard | run A |
| F1 | + win = she is in sight within 14 map units for 1 s (+25); hidden steps cost double | F3 |
| F7 | F1 + no closer/further points while she is hidden + 3 inputs (her direction and speed when last seen) + 1 input ("I see where she was and she is not there") | F3 |
| FUSE | F7 + a merge layer: both paths side by side -> 64 neurons -> added on top (starts at zero) | F7 |

Exams: practice exam + forgetting check (old arena, 200 rounds) every ~100k;
yard exam (real yard, 100 rounds, seeds 70000-70099) every 250k.

## Numbers so far (yard exam; H1 clear shot, H2 seconds to first clear shot, H3 stuck/frozen, H4 within 4 units of her hiding spot in 10 s, H5 touch)

See `python -m rl.round1_report` for the full, current table. At 1M (one try each):

| Brain | H1 clear shot | H2 1st shot | H3 stuck | H4 hide 4u | H5 touch |
|---|---|---|---|---|---|
| today's game brain | 77% | 15.5 s | 28% | 4% | 15% |
| run A @1M | 75% | 15.1 s | 11% | 4% | 19% |
| F3 @1M / @1.5M | 76% / 78% | 16.2 / 17.4 s | 12% / 5% | 4% / 4% | 19% / 23% |
| F1 @1M | 79% | 13.4 s | 12% | 4% | 21% |
| F7 @1M | 69% | 13.6 s | 16% | 4% | 19% |
| FUSE @1M | 81% | 16.2 s | 11% | 6% | 18% |

Consistent gain: far less stuck than today's game brain (5-16% vs 28%).
Probably real: F1/F7 reach a first clear shot sooner (13.4-13.6 s vs ~16 s).
Behaviour after losing sight of her is unchanged everywhere: ~40% head where
she went, 90-92% see her again within 12 s (typically ~2 s), 0 s loitering.
Single tries: differences under ~5 points are within the exam's noise.
Forgetting check (still Lola, must stay >= 93%): 94-97% everywhere.

Hide-spot diagnostic (`rl/hide_diagnostic.py`, 50 hider rounds, 77 hidings each,
files in `diagnostic/`), physically reachable hidings only:

| Brain | reachable hidings | sees her hiding <= 10 s | within 4 units <= 10 s |
|---|---|---|---|
| today's brain | 25 | 84% | 12% |
| F3 @901k | 19 | 95% | 11% |
| F7 @606k | 14 | 93% | 7% |
| FUSE @508k | 16 | 94% | 6% |

## Built today (all in `rl/`, tests in `tests/`, nothing pushed, `src/` untouched, today's brain untouched)

- `fast_sim.py`, `fast_kernels.py`: exact speedups (numpy + numba). `tests/test_fast_sim.py`.
- `moving_target_game_exam.py`: bug fix, the Leaper's start spots were rebuilt every yard round (0.14 s -> 0.018 s).
- `round1_env.py`: switches R1, R2, R5, I1, I2; R6 "look where she was"
  (potential-based, walking distance, ends when it has looked); B1 critic-only
  inputs; hider share. `walk_field.py`: walking distances (numba Dijkstra).
- `round1_brain.py` (copies with N inputs, merge layer), `round2_brain.py`
  (privileged critic; branching a checkpoint), `window_brain.py` (sliding-window
  memory model, trainer path and exam wrapper).
- `round1_train.py` (`--run`, `--try`, `--resume`, branches), `round1_job.py`
  (exams), `round1_report.py`, `round1_chain.py` (auto-continue to 2M),
  `window_watch.py` + `window_exam.py` (free window test), `branch_watch.py`,
  `hide_diagnostic.py`.
- `docs/SPEEDUP_NOTES_2026-11-15.md`: which speedups could carry over to the game.

## Decisions taken with the user

- Run everything to 2M, no trade-offs between runs.
- Sliding-window training (W7) **not run** (~10 h for 1M on this machine);
  instead the free test: trained F7/FUSE brains replayed with a 128-step window
  (`window_watch.py`, at 1M and 2M).
- Round 2 "hiding spot" plan approved: diagnose first (done), then branches of
  F7 at 1M -> 2M: F7R6 (look where she was), F7B1 (privileged critic),
  F7R6B1, F7HIDE (half hider rounds), plus F7R4 (closer/further points on
  walking distance around junk; targets the close-range navigation weakness the
  diagnostic found). All five from F7 try 1's 1M checkpoint to 2M, nice 5.
- One try per run (user): try-2 runs stopped.

## Try 2 stopped (user, 20:50 UTC)

Every run was first started twice (try 1 seed 145032261, try 2 seed 145032262)
because the plan judges an idea only when both tries agree. The user stopped
all try-2 runs (F3 418k, F1 319k, F7 418k, FUSE 451k steps; their folders and
checkpoints are kept): one try per run for now. Single-try differences of a
few points are within noise (two tries of F7 differed by 5 points at 254k).

## State at hand-off and how to continue

Processes paused (SIGSTOP) at about 20:45 UTC so try-1 runs reach 1M within
the session: the try-2 trainers, F3 try 1's 2M continuation and their exam
jobs. PIDs are in the scratch file listed by the agent; to resume all paused
processes on this machine:

    ps -eo pid,stat,args | grep -E "round1_(train|job)" | awk '$2 ~ /T/ {print $1}' | xargs -r kill -CONT

Background helpers (restart them if the machine restarted):

    C=moving_target_round1_20261115
    nohup .venv/bin/python -m rl.round1_chain $C  > rl_artifacts/$C/chain.log 2>&1 &
    nohup .venv/bin/python -m rl.window_watch $C  > rl_artifacts/$C/window_watch.log 2>&1 &
    nohup .venv/bin/python -m rl.branch_watch $C  > rl_artifacts/$C/branch_watch.log 2>&1 &

If the machine restarted, continue any run from its last checkpoint:

    .venv/bin/python -m rl.round1_train --run F7 --try 2 --resume --steps 1007616 --campaign $C   # unfinished first leg
    .venv/bin/python -m rl.round1_train --run F7 --try 1 --resume --steps 2015232 --campaign $C   # 1M -> 2M

(`--resume` continues the last `model_*.zip` in the run folder with its
optimizer state and the learning-rate line; it appends, never overwrites.)

## What was skipped from the plan (time)

Box obstacle arena (W1), yard flips (W2 versions), search map (R3), walking
distance on the closer/further points (R4), step-0 baseline re-measure (the
user chose the 2026-11-05 numbers).

## Recommended next steps

1. Let all 8 runs reach 2M; read them with the plan's boxes (`round1_report`).
2. Fix the measurement: add "sees her in her hiding spot within 10 s" to the
   yard exam; make practice/exam hiders pick spots hidden from the Leaper's
   **eye**, not the flat map (a world change: a new exam variant, so old
   numbers stay comparable).
3. Attack close-range navigation: R4 (walking-distance closer/further points)
   as a branch of F7 at 1M, alongside R6 and B1.

## Last-seen and hiding-spot probe (2026-11-15 22:20, `rl/lastseen_probe.py`)

Hider rounds with Lola starting 10-20 map units away (so most spots are
reachable), 60 rounds per brain, seeds 90000+, deterministic play. Files in
`rl_artifacts/moving_target_round1_20261115/probe/`.

Genuine losses (she stays unseen 3 s or more; the last-seen spot is reachable
in 10 s and more than 6 units away):

| Brain | moments | heads to the last-seen spot (3 s) | gets within 4 units in 10 s |
|---|---|---|---|
| today's game brain | 56 | 16% | 5% |
| F3 @2M | 56 | 11% | 5% |
| F1 @1.7M | 65 | 14% | 5% |
| F7 @1.6M | 64 | 16% | 6% |
| FUSE @1.4M | 36 | 11% | 3% |
| F7R4 @1.3M | 62 | 15% | 3% |
| F7R6 @1.3M | 60 | 13% | 3% |

Reachable hidings (she runs to a hiding spot a perfect walk could reach in 10 s):

| Brain | hidings | heads there | gets within 4 units in 10 s | its eye sees the hiding place |
|---|---|---|---|---|
| today's game brain | 83 | 52% | 20% | 98% |
| F3 @2M | 101 | 38% | 16% | 97% |
| F1 @1.7M | 88 | 51% | 25% | 100% |
| F7 @1.6M | 97 | 47% | 18% | 96% |
| FUSE @1.4M | 92 | 45% | 18% | 97% |
| F7R4 @1.3M | 83 | 55% | 24% | 98% |
| F7R6 @1.3M | 91 | 52% | 19% | 98% |

Reading: no retrain is better than today's brain at going where she was. After
a genuine loss it heads to the last-seen spot only 11-16% of the time. Advisor
review (same evening): the practice world rarely demands it (her hiding spots
are visible to the eye; the 1 s shot win ends 93% of practice rounds before any
re-finding). Next round should fix the world first: eye-occluded hiding
spots, a shot that does not end the round (Lola flees to cover), more yard
rounds; gate R6 to switch on after 1 s unseen.
