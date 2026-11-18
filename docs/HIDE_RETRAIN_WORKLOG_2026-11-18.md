# Hide retrain: work log and results (18–19 Nov 2026)

Written 19 Nov 2026, ~03:15 IST, after the last runs finished. Plain language first; exact numbers, files
and how to continue follow. The plan these runs were judged against (written before training) is
`docs/HIDE_RETRAIN_PLAN_2026-11-18.md`. No game brain was exported and nothing in `src/` changed; today's
game brain (7,757,824 steps) was never touched.

---

## 1. In plain words

**The goal (designer):** when Lola ducks behind cover close by, the Leaper should walk over to where it
last saw her and find her: "snooping around the last seen location".

**What we found before training:**

- In practice she always came back out by herself (a hider after 30–60 s, a wanderer keeps running, a hit
  Lola after 10–25 s), so waiting for her paid and going to look did not (the engineer's diagnosis).
- The old "it backs away from where she vanished" number mixed two cases. In about 60% of close-by
  sight-breaks she had slipped into the blind wedge behind it (it walks on and turns round, and sees her
  again within 3 s 93% of the time). The designer's case is the other one: **she ducks behind junk in front
  of it**. There, today's game brain sees her again within 3 s 83% of the time, the 9M brain only 74%.
- **Nobody walks to the spot.** After a real loss (out of sight 3 s+, she stays put), every brain, today's
  included, walks to where she vanished only 2–5% of the time. They turn and circle instead, and in the yard
  circling finds her about as fast as walking over, which is why training never picked the walk up.
- In staged scenes (she is hidden close by and stays) the retrained brains already go and look (found
  within 10 s 87–90%, a scripted perfect seeker 98%). The skill exists; it does not show in ordinary play.

**What we tried (12 experiments, each run twice with different random seeds, all from the 9M brain, +2M
steps):** Lola's real sight heights everywhere; staged hide-and-stay scenes in the yard and in random
arenas; "she stays in cover until found" in ordinary practice; and a reward redesign that pays strongly
for walking toward where she ducked (x3.3 and x5) and charges for moving away, gated to the designer's case.

**Result: the behaviour did not change enough.** The redesign made the Leaper move away from where she
ducked less often (37% of the time down to 32–33%, close to today's brain's 29%), so its speed toward the
spot improved from -0.29 to about -0.18 units/s. But it still walks toward the spot only about 1 time in 5,
still re-finds her within 3 s no more often (71–75%, today's brain 83%), and still walks to the spot after
a real loss only 2–3% of the time. No brain from this work is better than today's game brain at the
designer's case, so none was put into the game.

**Recommended next step:** make ordinary practice work like the staged scenes: when she breaks line of
sight she ducks into cover that a turn on the spot or a side step cannot reveal (the scene census rules),
so only walking round the cover finds her, and keep the x3.3 gated pay. Alternative outside this task's
"no scripted behaviour" rule: a scripted walk to where it last saw her in the game layer, like the existing
walk to where a shot came from (the designer's call).

---

## 2. The six seeking metrics, and how a brain was judged

From the open yard (real yard rounds, Lola a hider who dashes for cover when spotted and crouches, 450
rounds per brain per seed), counting only moments where **she stayed put** while out of sight, so a
re-sighting is earned by the Leaper's own movement (`rl/seek_metrics.py`):

1. **Ducked, found in 3 s**: she ducked behind junk in its view, 6–20 units away: it sees her again within 3 s
2. **… in 10 s**
3. **Speed toward the spot**: units/s toward where she vanished over the first 3 s (negative = moving away)
4. **Real loss, walks to the spot**: out of sight 3 s+, the spot reachable: within 4 units of it in 10 s

From the staged hide exam (`rl/hide_exam.py`, fixed scenes, she never moves):

5. **Staged hide, found in 10 s**: 100 yard scenes
6. **Arenas, found in 10 s**: 50 scenes in random arenas it cannot know by heart

Safety checks: chase smoothness (net/path, at least 0.58), steps backwards (at most 31%), drills, the
still-target skill (at least 93%), yard stuck and clear shot (300 rounds). Every exam uses Lola's real sight
heights (1.25 / 1.03 / 0.81 map units). Intervals are 90%, resampling whole rounds (open yard) or scenes.

---

## 3. Final results (+2M steps, each experiment's two seeds pooled)

Regenerate with `python -m rl.hide_report --markdown out.md` (needs the bucket's `rl_artifacts`).

| Brain | Ducked: found in 3 s | … in 10 s | Speed toward spot (u/s) | Real loss: walks to spot | Staged hide: found in 10 s | Arenas: found in 10 s | Toward / hold / away |
|---|---|---|---|---|---|---|---|
| Today's game brain | 83% [80%–86%] | 94% [92%–96%] | -0.25 [-0.34, -0.17] | 4% [2%–6%] | 66% [58%–74%] | 70% [60%–80%] | 20% / 51% / 29% |
| 7M brain | 76% [73%–79%] | 92% [90%–94%] | -0.33 [-0.42, -0.24] | 5% [3%–8%] | 90% [85%–95%] | 84% [76%–92%] | 18% / 44% / 37% |
| 9M start | 74% [70%–77%] | 92% [90%–94%] | -0.29 [-0.37, -0.22] | 4% [3%–6%] | 87% [81%–92%] | 86% [78%–94%] | 20% / 44% / 37% |
| Control: +2M of the 4C recipe (CR) | 72% [70%–75%] | 92% [91%–93%] | -0.27 [-0.32, -0.21] | 3% [2%–4%] | 88% [84%–91%] | 82% [75%–88%] | 19% / 46% / 35% |
| She stays until found (CS) | 75% [72%–77%] | 93% [92%–94%] | -0.28 [-0.33, -0.22] | 3% [2%–4%] | 89% [85%–92%] | 83% [77%–89%] | 24% / 41% / 35% |
| Yard hide scenes (CHY) | 73% [70%–75%] | 93% [92%–94%] | -0.27 [-0.34, -0.21] | 2% [2%–4%] | 92% [88%–95%] | 86% [80%–92%] | 20% / 42% / 38% |
| Hide scenes + stays until found (CHS) | 73% [70%–75%] | 92% [91%–93%] | -0.16 [-0.21, -0.11] | 2% [1%–3%] | 88% [84%–92%] | 86% [80%–92%] | 23% / 43% / 34% |
| Designer's run: yard + arena scenes (CH) | 72% [70%–75%] | 93% [92%–94%] | -0.20 [-0.26, -0.14] | 3% [2%–4%] | 90% [86%–94%] | 82% [76%–88%] | 23% / 42% / 35% |
| Big gated pay x3.3 + stays until found (CG) | 72% [69%–75%] | 92% [90%–93%] | -0.18 [-0.23, -0.13] | 2% [1%–3%] | 88% [84%–92%] | 81% [75%–87%] | 21% / 46% / 33% |
| Big gated pay x5 + stays until found (CG15) | 72% [69%–75%] | 92% [91%–93%] | -0.19 [-0.25, -0.13] | 2% [1%–3%] | 86% [82%–90%] | 82% [75%–88%] | 21% / 47% / 32% |
| Big pay + more drills (CGD) | 74% [71%–76%] | 93% [92%–94%] | -0.17 [-0.22, -0.13] | 2% [1%–3%] | 88% [84%–91%] | 79% [72%–86%] | 21% / 46% / 32% |
| Big pay + hide scenes (CGH) | 71% [69%–74%] | 92% [91%–93%] | -0.19 [-0.25, -0.14] | 2% [1%–3%] | 88% [84%–92%] | 82% [75%–89%] | 25% / 44% / 32% |

| Brain | Chase net/path (≥ 0.58) | Steps backwards (≤ 31%) | Drills: found in 30 s | Still-target, lowest (≥ 93%) | Yard stuck (300 rounds) | Yard clear shot |
|---|---|---|---|---|---|---|
| Today's game brain | 0.66 | 28% | 72% | – | 16% | 72% |
| 7M brain | 0.65 | 26% | 86% | 96.5% | 9% | 77% |
| 9M start | 0.63 | 28% | 86% | 96.5% | 9% | 78% |
| Control (CR) | 0.64 | 29% | 87% | 97.0% | 7% | 77% |
| She stays until found (CS) | 0.66 | 26% | 88% | 96.5% | 7% | 77% |
| Yard hide scenes (CHY) | 0.65 | 27% | 88% | 96.5% | 8% | 78% |
| Hide scenes + stays until found (CHS) | 0.63 | 28% | 85% | 97.0% | 9% | 78% |
| Designer's run (CH) | 0.64 | 28% | 88% | 98.0% | 8% | 76% |
| Big gated pay x3.3 (CG) | 0.63 | 29% | 84% | 97.0% | 8% | 78% |
| Big gated pay x5 (CG15) | 0.62 | 29% | 86% | 96.0% | 9% | 77% |
| Big pay + more drills (CGD) | 0.61 | 30% | 84% | 95.0% | 9% | 76% |
| Big pay + hide scenes (CGH) | 0.61 | 29% | 85% | 96.5% | 13% | 77% |

Judged against the plan's pre-registered "What we expect": no experiment met expectation 1 (ducked,
found in 3 s at least today's 84%, speed toward the spot above 0). Safety held everywhere (the "more
drills" and "hide scenes" arms touched the chase limits at +2M on the 150-round probes; on 450 rounds they
pass). The x5 dose looked best at +1M (walking toward 26%, moving away 30%) and slipped back by +2M.

Stopped early: CHL (CHY at learning rate 6e-5), at 10.3M / 10.5M, on the user's call (a higher learning
rate was already tried last session: F7GLSDL forgot the still-target skill). Third seeds of CS, CH and CHS
were started, paused for CPU and then dropped (their arms were flat at +1M).

---

## 4. What was built (all switches off by default; old numbers stay exact)

| File | What |
|---|---|
| `rl/moving_target_game_exam.py` | `real_heights`: Lola's sight points at 1.25 / 1.03 / 0.81 map units (per environment); `site=`: another world built like the yard |
| `rl/round1_env.py` | `real_heights` passthrough; `stay_found` (she ducks into cover on every sight-break and stays until seen); `ducked_scale` / `ducked_after` / `ducked_reach` / `ducked_cap` (bigger walk-to-the-spot pay only when she ducked behind something inside its view; scorer only) |
| `rl/hide_scenes.py` | Hide-and-stay scenes (stay / shift / back-off; natural or built-in loss), the census, the scene bank, the scripted perfect seeker, `HidePractice` |
| `rl/hide_arena.py` | Random arenas of container / bus / low blocks with the yard's raster, rays and 3D eye sight; `ArenaHidePractice` |
| `rl/hide_exam.py` | The fixed hide exam (stay 100, move-on 40, arena 50; arena layouts fingerprinted) |
| `rl/seek_metrics.py`, `rl/chase_check.py` | The six seeking metrics; chase / backwards / sight-break checks (the 17 Nov analysis scripts, moved into the repo) |
| `rl/hide_watch.py`, `rl/hide_report.py` | The check queue (uses the cores the trainers leave free); the results table above |
| `rl/round1_train.py` | Runs `F7GLSDP4CR/CS/CHY/CHS/CH/CHL/CG/CG15/CGD/CGH`; `hide_envs` / `arena_hide_envs` world kinds; `input_switches` carries `real_heights` to every exam |
| `rl/behaviour_probe.py`, `rl/drill_exam.py`, `rl/long_final_exam.py` | `--real-heights` for any brain |
| `scripts/export_round1_brain_onnx.py` | Writes the run's sight heights into `brain.json` |
| `tests/test_hide_retrain.py` | 10 tests: heights, scenes (hidden, she never moves), stay_found, the arena, exam switches |

**Census (before training, 500 scenes each, real heights):** yard: hidden at the start and after a 1.5 or
3-unit step back / left / right whichever way it faces 100%; the scripted seeker finds her within 20 s 98%,
clear shot 96%; she never moves in stay scenes; 337 distinct hiding spots. Arena: hidden 100%, seeker 95.6%,
clear shot 95%. Practice used a bank of 20,000 pre-drawn yard scenes (drawing one live took ~0.17 s and
stalled training).

**The reward gate (before the redesign runs, the 9M brain on the same 30 yard rounds):** pay for
walking to / from where she ducked, net per round: 4C recipe -3.9, x3.3 -31.5, x5 -47.2 (charges for moving
away -69 at x3.3), against +25.5 from shots and -17.5 time cost. Training normalizes advantages per batch,
so the dose only matters relative to the other rewards; the critic adapted (explained variance ~0.95).

---

## 5. Where everything is

- **Code and docs:** branch `claude/zen-davinci-ku9f5z`.
- **Results** (git-ignored `rl_artifacts/`): Hugging Face bucket `Mercity/RL-Leaper`, folder
  `leaper_hide_retrain_20261118/rl_artifacts/`:
  - `hide_retrain_20261118/`: census, scene bank, exam scenes, baseline hide exams, `final_results.{json,md}`,
    the check queue's log;
  - `moving_target_round1_20261115/run_F7GLSDP4C{R,S,HY,HS,H,HL,G,G15,GD,GH}_try{1,2}/`: checkpoints, exams,
    probes; `hide_retrain_baselines/`: today's / 7M / 9M baselines with real heights.
  - The 9M start, `run_F7GLSDP4C_try2/model_9003040.zip`, is in git and in the older bucket folder.
- **Run a new arm:** add it to `RUNS` in `rl/round1_train.py`, then
  `python -m rl.round1_train --run <RUN> --try 1 --steps 11003040 --campaign moving_target_round1_20261115 --practice-every 1000000 --yard-every 500000`
  and add it to `RUNS` in `rl/hide_watch.py` (checks at +0.5M, +1M and the end).
- **Machine note:** this container is pinned to 16 of the server's 32 threads (8 physical cores); the
  limit is read-only from inside. One trainer keeps one thread busy (~1,000 steps/s alone, ~500–800 with 10).

## 6. Not done / open

- The game's I2 code (`src/brain/junkyard/round1Inputs.js`) still has the old sight heights; a real-heights
  brain needs it to read `brain.json` before it is played. No such brain was exported.
- The recommended next run (deep cover on every duck in ordinary practice + the x3.3 gated pay) is designed,
  not built.
