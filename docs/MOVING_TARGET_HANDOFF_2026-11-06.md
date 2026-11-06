# Leaper brain retrain: start here (hand-off, 2026-11-06)

You are getting a game called **Leaper** and a plan to retrain the brain of
its enemy, the Leaper, so it can chase and find a player (Lola) who runs and
hides. You build a few changes, run 16 short training runs, read the results
with fixed rules and report back. Nothing in the game changes.

**The full plan:** `docs/MOVING_TARGET_RUN_LIST_2026-11-06.md` (in the
repository, also in this zip). Read all of it before starting; it has every
number, rule and decision, so you should not need to ask the owner anything.
Section 3 of the plan lists the hard rules (never touch today's brain,
never change the game, never push to the owner's repository without
permission).

## What you get

| Where | What |
|---|---|
| Repository `https://github.com/Mercity-AI/RL-Leaper`, branch **`claude/zen-davinci-ku9f5z`** | All the code: the game, the training lab, the moving-target code from 2026-11-05 (`rl/moving_target*.py`, `tests/test_moving_target.py`), the clear-shot counter (`rl/moving_target_shot_probe.py`), today's brain (`model_7757824/`), the plan and this note. |
| This zip, `leaper-retrain-handoff-2026-11-06.zip` | The brain files git does not store (it ignores `*.zip` and the training-results folder): `model_7757824.zip` (today's game brain, used by the exams) and run A's four saved brains in `rl_artifacts/moving_target_20261105/run_A/` (the baseline), plus run A's and today's 2026-11-05 exam results for reference. Also both documents. |

## Setup

1. Get access to the repository from the owner, then:
   `git clone https://github.com/Mercity-AI/RL-Leaper.git`, `cd RL-Leaper`,
   `git checkout claude/zen-davinci-ku9f5z`.
2. Unzip this zip **into the repository's top folder**, so that
   `model_7757824.zip` sits next to `model_7757824/` and
   `rl_artifacts/moving_target_20261105/run_A/model_1007616.zip` exists.
   (The zip's own `docs/` files are the same as the repository's.)
3. Python 3.12 (the owner's machine: 3.12.10). Make a virtual environment in
   `.venv` and install `requirements-rl.txt` (gymnasium 1.x,
   stable-baselines3 2.9, sb3-contrib 2.9; torch comes with
   stable-baselines3, CPU build is enough):
   - Linux/macOS: `python3.12 -m venv .venv` then
     `.venv/bin/python -m pip install -r requirements-rl.txt`
   - Windows: `py -3.12 -m venv .venv` then
     `.venv\Scripts\python.exe -m pip install -r requirements-rl.txt`
4. Check it works (from the repository's top folder, with the `.venv`
   Python):
   - `python -m unittest tests.test_moving_target`: 7 tests, OK.
   - `python -m rl.moving_target_shot_probe rl_artifacts/moving_target_20261105/run_A/model_1007616.zip 2 check.json`:
     prints a `RESULT` line after a minute or two.
5. Node 20+ and `pnpm` only if you change the training viewer
   (`src/simulation/TrainingVisualizer.js`, plan section 9 item 11) or want
   to watch runs in it (`pnpm dev`, then
   `http://localhost:5173/?training=1&run=<name>`).

## Machine

Many CPU cores, **not a GPU**: the brain is tiny and the time goes into the
Python simulation. 32 cores run all 16 runs and their exams at once. Round 1
is about 2.5-3 hours of training after about 1.5-2 days of building.

## Then

Follow the plan's section 10 order: build and test (section 9), re-measure
the baseline (section 7, step 0), 20,000-step smoke test of every run, the
16 runs, read them with section 7, round 2 by section 8, and send the report
of section 11 to the owner.
