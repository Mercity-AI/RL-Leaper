# Leaper brains: which model is for what, and the full work log (15–17 Nov 2026)

Written 17 Nov 2026, 04:37 IST, when training was stopped for the night. Plain language first;
the exact numbers and file names follow. The interactive report with charts is
https://claude.ai/artifact/V1CgGtbXpFB7YBeFqM3xZQ. The day-by-day lab notes are
`rl_artifacts/moving_target_round1_20261115/TODO.md` (in the Hugging Face bucket, not in git).

---

## 1. The brains, and what each one is for

All new brains are **opt-in**: the game still uses today's brain unless the address says
otherwise. Run the game (`pnpm dev`, or `node_modules/.bin/vite --host 127.0.0.1`) and open:

| Brain | Address | What it is | Use it for |
|---|---|---|---|
| **Today's brain** | `http://localhost:5173/` | The brain in the game (7,757,824 steps, trained mostly on a still Lola). Never retrained. | The yardstick |
| **4M brain** | `?brain=leaper_r1_4005904` | Run `F7GLSDP` try 2 at 4,005,904 steps (search drills + walk-there pay, early) | A steady middle: chases like today's brain, gets stuck half as often |
| **7M brain** (newest) | `?brain=leaper_r1_7004176` | Run `F7GLSDP4C` try 2 at 7,004,176 steps: the 4M brain trained 3M more steps with a charge for backing up when nothing is in the way | **Try first for the chase**: smooth like today's brain, best clear-shot rate |
| **10M brain** (the earlier pick) | `?brain=leaper_r1_10002464` | Run `F7GLSDP` try 1 at 10,002,464 steps | **Best search and fewest stuck rounds**, but it shuffles back and forth while chasing, so it closes in slowly |
| 12M alternate | `?brain=leaper_r1_12001312` | Run `F7GLSDP` try 2 at 12M | Only in the Hugging Face bucket, not in git |

The badge in the corner shows which brain is driving (for example `BRAIN R1 7,004,176`).
The new brains need 4 extra inputs (her last direction and speed, and a "she is not there"
signal). The game computes them on a separate path that only these brains use, so today's
brain and its files are unchanged.

### How they compare

600 fresh yard rounds for stuck and clear shot (seeds 80000–80299 and 81000–81299, the
same rounds for every brain); 150 yard rounds for movement and open-yard seeking; 100
fixed search drills.

| What we measure | Today's | 4M | 7M (new) | 10M |
|---|---|---|---|---|
| Gets stuck (lower is better) | 19.0% | 7.3–8.3% | 11.0% | **4.8%** |
| Clear shot at Lola | 72.8% | 76.8–77.2% | **78.2%** | 76.0% |
| Chase: progress per unit walked (she is in sight, over 14 units away) | **65%** | 60–63% | **64%** | 46–50% |
| Steps taken backwards while chasing | 28–29% | 27–28% | 27% | 34–37% |
| Drill: walks toward where she vanished, first 5 s (units; straight = 18) | 5.5 | 6.3 | 9.2 | **11.0** |
| Drill: finds her within 30 s | 73% | 83% | 84% | **87%** |
| Open yard, she vanished close by: speed toward that spot (u/s) | **−0.27** | −0.90 | −1.13 | −0.30 |
| Open yard, she vanished far away: speed toward that spot (u/s) | **+0.17** | −0.34 | −0.11 | +0.16 |
| Still catches a standing Lola (must stay ≥ 93%) | yardstick | 96.5–98.5% | 96.5% | 96.5% |
| Training runs behind it | – | 2 | **1** | 2 |

**In one line:** the training that taught the 10M brain to walk toward where Lola vanished
also brought a forward-and-back shuffle. The 7M brain keeps the smooth chase. In the open
yard, though, it backs away from the spot where she vanished more than today's brain does.
Getting both at once is the open problem.

**Seeking in the open yard is not solved.** Drills are clearly better than today's brain
for every new brain. In ordinary yard play, only the 10M brain matches today's brain on
walking toward where she vanished.

### The last checkpoint of the 7M brain's run (stopped at 9.24M)

`F7GLSDP4C` try 2 kept training to 9,240,624 steps and was stopped on the owner's request.
At 9M (`model_9003040.zip`, in git and the bucket):

| Measure | Value at 9M |
|---|---|
| Chase: progress per unit walked | 62% |
| Steps taken backwards | 29% |
| Drill: walks toward the spot, first 5 s | 10.5 units (now level with the 10M brain) |
| Drill: finds her within 30 s | 84% |
| Open yard, vanished close by / far away | −0.95 / −0.15 u/s (still backs away) |
| Open yard: heads toward the spot within 3 s | 19% (today 14%) |
| Open yard: sees her again within 10 s | 82% (today 72%) |
| Yard exam (100 rounds): stuck / clear shot | 9% / 77% |
| Still-target | 96.5% |

The 9M copy is not exported as a game brain. It is the natural next one to try:
`PYTHONPATH=tmp/onnx-pylib .venv/bin/python scripts/export_round1_brain_onnx.py --model rl_artifacts/moving_target_round1_20261115/run_F7GLSDP4C_try2/model_9003040.zip --run F7GLSDP4C --out public/brains/leaper_r1_9003040/`,
then run the 600-round exam (`rl.long_final_exam --job yard`, seeds 80000 and 81000).

---

## 2. How a brain was judged

- **Yard exam:** real junkyard rounds with a moving, hiding Lola. We count clear shots and stuck rounds. Final checks use 600 fresh rounds, compared round by round with today's brain.
- **Still-target check:** the share of standing Lolas it catches. A run that drops below 93% is stopped automatically, because it is forgetting.
- **Search drill:** a staged scene where she has just vanished round a corner and hides 15–35 units away. How fast does it go after her and find her?
- **Losing-her check (open yard):** every time it loses sight of her in normal play, how fast does it move toward where she vanished? Measured separately for "close by" (within 20 units) and "far away".
- **Chase check** (added 17 Nov): while she is in sight and more than 14 units away, how much of each unit it walks turns into progress toward her over one second? Shuffling scores low even at full speed.

One training "step" is a tenth of a second of practice, so 10M steps is about 11.5 days of play.

---

## 3. Work log

### 15 Nov: round 1 (new scorecard and new senses)

- Made the practice simulation about 5 times faster with the same results (`rl/fast_sim.py`, `rl/fast_kernels.py`).
- Runs `F1`, `F3`, `F7`, `FUSE` changed what earns points and added two senses: her last direction and speed (`I1`), and "I am looking at where she was and she is not there" (`I2`). **`F7` was best**, and every later brain builds on it.
- Branches from F7 (walking-distance pay `F7R4`, look-where-she-was `F7R6`, a critic that sees the truth `F7B1`, more hiding practice `F7HIDE`) gave no clear gain by 2M.
- A diagnostic showed it does see her hiding most of the time. Its real weakness was close-range navigation around junk.

### 16 Nov, morning: long runs on a faster machine, and the seeking focus

- Moved to a 16-CPU machine and ran the best ideas to 10M steps. A supervisor keeps runs alive and restarts them after a crash or a requested restart.
- **`F7GL`** (practice where it really loses her): kept.
- **`F7GLE` / `F7GLS`** (hiding spots its eye truly cannot see; she stays in cover 10–25 s after a shot): kept, level by themselves.
- New probes for "does it walk to where she vanished": none of these brains did it more than today's brain.

### 16 Nov, afternoon: search drills (the big step)

- **`F7GLSD`**: 6 of 16 practice worlds play a staged search drill. Within 3M steps it found her more often and faster, and got stuck far less.
- **`F7GLSDX`** (twice the drills): no better, and it got stuck more.
- **`F7GLSDL`** (faster learning rate): forgot the still-target skill and was stopped.
- **`F7GLSDW`** (bonus for reaching the spot): never paid out once. It was replaced by the next idea.
- **`F7GLSDP`** (pay for every step of walking progress toward where she vanished, plus a bonus for reaching it): **best**, with the lowest stuck rate and the still-target skill intact.
- Environment variants on top (messier drills `SDR`, Lola ducking into cover nearby `SDN`, both `SDRN`, deeper drill cover `SDV`): no gain by the two-runs rule, and three of the eight runs started forgetting.

### 16 Nov, evening: the first game brain

- Following a plan written down in advance, we **picked `F7GLSDP` try 1 at 10M**: on 600 rounds, stuck 4.8% (today 19.0%) and clear shot 76.0% (today 72.8%).
- The game got an opt-in path for the 4 new inputs (owner's OK). The exported brain matches the trained one to within 0.0000016.
- **Units mix-up found:** the game's stand-and-shoot distance (14) is in the brain's units, but training paid "clear shots" out to 20.3. The owner's decision was to keep the game at 14/18 and not train for a range: "it should get as close as possible".
- The game-layer changes the new brain might need were **written up only, not built** (owner): "Leaper's new brain: game-layer changes", https://claude.ai/artifact/ToqRSgx9HdaCApdKvWiaAh.

### 16–17 Nov, night: the chase problem

- **Played in the game, the 10M brain closed in on Lola slowly.** It walks at nearly full speed (3.2 of 3.75 units/s) but stepped toward her about a third of the time and away about a third. Of every unit walked, only 46–50% became progress toward her (today 65%).
- **Tried on the 10M brain, none of which fixed it:**
  - `F7GLSDPA` (no pay for shooting from range, double walking pay): got worse (39% backwards at 18M).
  - `F7GLSDPB2` / `B5`: a charge for backing up with nothing in the way.
  - `G5` / `G10`: a tighter rule and a double charge.
  - `GF` / `GFO` / `BF`: a charge per forward-back switch.
  - The charge stopped the habit growing but never undid it. The best reached about 50–53% on the chase check.
- **What found it:** checking every saved copy of the picked run showed the shuffle crept in gradually. At 4M it chased like today's brain (60–61%, 28–29% backwards), then got worse each million steps. Sister runs without the extra walk-there rewards stayed level, near 56–67% at 10M. Those rewards are the likely link, but this is not proven: a test without their per-step part (`F7GLSDP4L`) drifted too.
- **The 4M copy was tested and put in the game** (`leaper_r1_4005904`): it chases like today's brain and gets stuck 7–8%.
- **Restarted from 4M with the backing-up charge on from the first step:**
  - **`F7GLSDP4C`**: the pick's practice plus the charge.
  - `F7GLSDP4T`: the same, without shooting pay.
  - `F7GLSDP4L`: the same, without the per-step walk-there pay.
  - Each ran twice. At 6M only 4C held the smooth chase. 4T and 4L were stopped (4L also neared the forgetting limit), and 4C's weaker seed was stopped so one run had the whole machine (owner).
- **`F7GLSDP4C` at 7M** was exported as `leaper_r1_7004176`: chase 64%, stuck 11.0%, clear shot 78.2%.
- **Is the higher stuck rate from the charge? No.** The pick's own 7M copies, which never had the charge, got stuck 10.2% and 11.8% on the same 600 rounds, and that run reached 4–5% by 10M.
- **Seeking on the new run:** in drills it caught up (walking toward the spot 6.3 → 10.5 units by 9M). In the open yard it still backs away when she vanishes close by (about −1.0 u/s), where the original run learned to stop doing that between 4M and 8M (−0.90 → −0.32). A possible cause, not tested: the charge also prices backing up toward a spot that is just behind it.
- **Stopped at 9,240,624 steps** (owner, 04:35 IST, 17 Nov).

### Things that did not work, in one list

| Idea | Why it was dropped |
|---|---|
| Faster learning rate (`F7GLSDL`) | Forgot the still-target skill |
| More drills (`F7GLSDX`) | No better; got stuck more |
| Reach-the-spot bonus (`F7GLSDW`) | Never paid out |
| Messier or deeper drills, Lola ducking nearby (`SDR`, `SDN`, `SDRN`, `SDV`) | No gain; some runs forgot |
| Shot pay at the game's real 14-unit range (`F7GLSDP14`) | Stopped: the owner does not want training toward a range |
| Backing-up and switch charges on the 10M brain (`SDPA` … `BF`) | Never undid the shuffle |
| Running each world in its own process (`--subproc`) | Slower for one run; the trainer's main loop is the limit |

---

## 4. Where everything is

- **Code, the 4M / 7M / 10M game brains and their checkpoints:** git branch `claude/zen-davinci-ku9f5z` (Mercity-AI/RL-Leaper). Brains are in `public/brains/leaper_r1_*`. Checkpoints are in `rl_artifacts/moving_target_round1_20261115/run_*/model_*.zip`; only the ones named above are in git.
- **Everything else** (every run folder, exam, probe, the 12M alternate, `TODO.md`, the report HTML): Hugging Face bucket `Mercity/RL-Leaper`, folder `leaper_retrain_20261115/`.
- **Report:** https://claude.ai/artifact/V1CgGtbXpFB7YBeFqM3xZQ (rebuilt by `report2/collect.py` + `build.py` in the session scratchpad).
- **Main training code:**
  - `rl/round1_env.py`: the practice world, every reward switch, the backing-up charge (`reverse_cost`, `reverse_window`, `reverse_front`, `flip_cost`).
  - `rl/round1_train.py`: every run's recipe, in `RUNS`.
  - `rl/long_supervisor.py`: keeps runs alive.
  - `rl/behaviour_probe.py`, `rl/drill_exam.py`, `rl/long_final_exam.py`: the exams.
- **Resume a run:** `python -m rl.round1_train --run F7GLSDP4C --try 2 --steps <total> --campaign moving_target_round1_20261115 --practice-every 1000000 --yard-every 500000 --resume --leg <next>`. Or add it to `TOTALS` / `PLAN` in `rl/long_supervisor.py` and start the supervisor.

## 5. Next steps

1. **Play the three brains:** 7M for the chase, 10M for the search, 4M as the middle.
2. **Export and exam the 9M copy of the new run.** Its drill seeking reached the 10M brain's level while the chase stayed smooth.
3. **Test the possible conflict:** the backing-up charge may block "back up toward where she just vanished".
4. **Give practice real hiding pockets.** In the yard, circling around finds her as fast as walking to the spot, so the brain learns to circle.
