# Leaper RL Training Ledger

For the active September9 seeker research, start with
[the cross-chat handoff](docs/SEEKER_HANDOFF.md),
[the generated run index](docs/SEEKER_RUN_INDEX.md), and
[the detailed current ledger](docs/SEEKER_SCRATCH_RUN_LOG_2026-09-09.md).
Live JSON statuses override snapshots in these documents. Earlier entries below
record different task stages and must not be ranked as identical evaluations.

This file is the human-readable history of reinforcement-learning runs. Generated models, raw logs, plots, checkpoints, and browser replay data stay under `rl_artifacts/` because they are large and ignored by Git. Update this ledger whenever a run is started, stopped, completed, or diagnosed.

## PPO_27_SEEKER — completed first seeker run (2026-09-02)

Goal: remove privileged target coordinates and teach Leaper to search for a
semantically tagged target. The target is not recognized from pixels: the game
knows which object is the target, but reveals it to the policy only when it lies
inside the 270° / 28-unit sight cone with an unobstructed line of sight. Obstacles
occlude it. A future mesh can replace the pink cuboid without retraining the
recognizer as long as it keeps the target tag.

- Arena width reduced from 187.5 to 62.5 (`WORLD_LIMIT 93.75 -> 31.25`) and the
  obstacle count from 51 to 6 to preserve roughly comparable area density.
- Target position is randomized each episode. Episode cap is 500 steps.
- Observation remains 26 values to retain PPO_25's navigation weights. Channels
  0-1 become target-visible and memory-age; channels 2-4 carry target direction
  and distance only after sight (last-seen memory for 120 steps); channels 5-25
  retain compatible facing/action/collision and 16-ray obstacle sensing.
- Warm start: load `ppo_25_idle_s3/leaper_ppo.zip`, zero the first-layer weights
  attached to repurposed channels 0-1, and clear old Adam state. This preserves
  useful obstacle-avoidance locomotion without pretending the old policy is fully
  compatible with the new search task.
- Reward: visible clipped progress `0.2`; positive-only new-best progress `0.1`;
  first sight/reacquisition `+0.5`; new cell `+0.01`; new heading-view `+0.002`;
  time `-0.002`; repeated no-move/no-new-view after 15 steps `-0.04`; collision
  `-0.18`; 40-step physical stuck failure `-10`; goal `+25`.
- Exact-config smoke run after clearing inherited optimizer state:
  `ppo_27_seeker_smoke_clean/`, natural seed 290911, 24,576 transitions.
  Fixed-seed deterministic evaluation: **47% success**, 13.84 mean reward,
  16.33 net progress, 9.51% collision steps, 96.25% forward steps, and 14.13 mean
  longest collision streak (worst 44). Latest stochastic training episodes: 60%
  success. This is a healthy pipeline result, not a final score. The earlier
  transfer-pipeline smoke (`ppo_27_seeker_smoke/`) scored 49% but still carried
  PPO_25's Adam moments, so it is retained only as engineering history.
- Every full launch includes TensorBoard plus `/?training=1`, whose live mode,
  worker/episode selection, five checkpoint rollouts, scrubbing, and replay import
  are mandatory monitoring outputs.
- Full run: `ppo_27_seeker_500k/`, natural seed 595018, 507,904 transitions.
  Fixed-seed deterministic evaluation: **64% success**, 16.80 mean reward, 18.90
  net progress, 3.79% collision steps, 44.10% stopped steps, and 5.68 mean longest
  collision streak. Latest stochastic training episodes reached 77% success.
  Diagnosis of a representative orbit failure: target visible for 232/318 frames,
  15 reacquisitions, 84% throttle, no collision, and only one unit of net visible
  progress. Repeated `+0.5` reacquisition bonuses accidentally made sight-boundary
  circling profitable. PPO_27 is therefore a successful search proof of concept,
  not the final seeker.

### PPO_28_SLOW_SEEKER — confirmed next run

Warm-start from the completed PPO_27 seeker with
`MOVE_SPEED = 0.375` (half the current `0.75`) and `MAX_STEPS = 1000` (double the
current 500) so the physical search horizon remains comparable. Halve `TURN_SPEED`
from 18° to 9° as well, preserving turning radius. Close the PPO_27 orbit exploit:
the `+0.5` sight bonus fires only on first-ever sight, exploration bonuses stop
after discovery, and distance progress becomes symmetric after discovery so
retreat is penalized even while the stationary target is temporarily occluded.
All browser checkpoint recordings are deterministic; stochastic PPO experience
continues internally but is not displayed. The viewer explicitly labels target
state as NOT DISCOVERED, VISIBLE, or REMEMBERED/CURRENTLY HIDDEN.

Smoke gate: `ppo_28_slow_seeker_smoke/`, natural seed 162127, 24,576
transitions. Fixed-seed deterministic evaluation reached **62% success**, 8.71
mean reward, 17.09 net progress, and 1.49% collision steps. The 20k checkpoint
scored 64% across 25 deterministic episodes. This passes the pipeline gate;
launch the isolated 500k run and judge it by the final 100-episode deterministic
exam rather than stochastic training success.

Full run complete: `ppo_28_slow_seeker_500k/`, natural seed 742698, 507,904
transitions. Final fixed-seed 100-episode deterministic result: **71% success**,
29% timeout, +14.31 mean reward, 20.99 mean net target progress, 1.90% collision
steps, 4.84 mean longest collision streak (worst 41), and 260.23 mean episode
length. The deterministic policy used burst-like movement: 43.27% moving and
56.73% exactly stopped, with mean throttle 0.368. Latest stochastic training
episodes reached 78% success. Versus PPO_27, deterministic success improved
64% -> 71% and collisions fell 3.79% -> 1.90%, while stopped steps increased
44.10% -> 56.73%. The final 25-episode checkpoint scored 64%; the 100-episode
exam is the authoritative final comparison.

Post-run deterministic freeze diagnosis (same 100 seeds): 14,762 / 26,023 steps
(56.73%) had exactly zero throttle. Of those stopped steps, **89.76% occurred
before first target sight**, 10.24% after sight, and only one step occurred while
the target was remembered but currently hidden. Thus obstacle detouring after
discovery is not the main aggregate failure. Only 34.93% of stopped steps still
turned meaningfully; 65.07% were effectively frozen. Timeout episodes had a
median longest zero-throttle streak of 388 steps and a worst streak of 980.

Root cause: PPO uses an unsquashed Gaussian action mean while the throttle action
space is asymmetric `[0,1]`. On a 30-episode probe, every deterministic stopped
action had a negative raw throttle mean (mean -0.435, minimum -2.754); SB3 clips
all of them to physical zero. Moving states were polarized the other way (raw
mean 1.94, often clipped to full throttle). Stochastic sampling crosses above
zero often enough to move, explaining the persistent stochastic-vs-deterministic
gap. More unchanged training is unlikely to repair this boundary/clipping local
optimum: the best 25-episode checkpoint was already 76% at 10k, later checkpoints
plateaued around 64-72%, and the final 100-episode result was 71%.

Recommended next controlled bundle: normalize the policy throttle to `[-1,1]`
and map it internally to forward-only physical throttle `(action + 1) / 2`, so a
neutral policy output means half-speed rather than stop and intentional stop sits
at the far `-1` boundary. Add a non-collision freeze rule: after 60 consecutive
no-translation steps, terminate with an explicit `-10` failure penalty. Sixty
steps still permits three 180° scans at the 9° turn rate. Preserve PPO_28's arena,
vision, first-sight-only reward, pursuit/search rewards, speeds, and PPO settings.
Warm-transfer PPO_28's policy/value weights into a newly constructed normalized-
action model and reset optimizer state. Run a 20k smoke and then a 500k gate;
do not extend the unchanged PPO_28 to 800k.

### PPO_29_NORMALIZED — implemented; freeze CURED but success unchanged (2026-09-02)

Implemented the recommended bundle. Env (`rl_environment.py`): a class flag
`NORMALIZED_THROTTLE` switches the throttle output to `[-1,1]` and maps it to a
forward-only physical throttle via the new `physical_throttle()` classmethod
`(action+1)/2` (`-1`=stop, `0`=half, `+1`=full; negative never means reverse). A
terminal general-freeze rule (`FREEZE_LIMIT=60`, `FREEZE_PENALTY=10`, in the
`time` reward bucket, `info["frozen"]`) ends any episode with no translation for
60 consecutive steps; real movement resets `freeze_steps`. The 40-step collision
`STUCK_LIMIT` is unchanged (stuck fires first for wedged contact; freeze catches
open-field standstill/spin). Owner-requested scan nudge (`SCAN_REWARD=0.01`, in
the `exploration` bucket): a small reward for facing each new heading bin before
first sight, capped at one revolution per episode via `scanned_headings`, off
after discovery — "just one spin" of encouragement, bounded by the freeze rule.
Trainer (`train_rl.py`): CLI `--normalized-throttle`, `--freeze-limit`,
`--freeze-penalty`, `--scan-reward`, `--warm-transfer` (loads a donor with no env
to skip SB3's action-space check, builds a fresh model with the new bounds, copies
`policy.state_dict()`, keeps the fresh optimizer). Diagnostics now classify
PHYSICAL throttle so stopped/forward stats stay honest under normalization. Tests:
`tests/test_ppo29_normalized_throttle.py` (10 cases); full suite 58/58 pass.

Timing note: plain PPO runs at ~2.1s/1k steps here, so 250k took ~9 min. The "~2h"
figure elsewhere in this ledger is the LSTM memory brain only, NOT plain PPO.

- **20k smoke** (`ppo_29_normalized_throttle_smoke/`, seed 406432, warm-transferred
  from PPO_28): deterministic 100-episode exam 73% success, **stopped steps
  56.73% -> 5.02%** — the go/no-go gate (stopped% collapse) passed at 20k.
- **250k run** (`ppo_29_normalized_throttle_250k/`, seed 208230, 253,952
  transitions): **69% success**, 31% timeout, +16.69 reward, 20.26 net progress,
  **stopped 6.29%**, forward 93.7%, mean physical throttle 0.81, collision 4.83%,
  worst streak 40, avg length 170. A 500k confirmation run was launched and stopped
  by owner at ~300k: its 25-maze checkpoints matched the 250k plateau (68-76%, no
  upward trend), confirming more budget does not help.

Verdict: the freeze fix is a complete, permanent success (57% -> 6% stopped;
behavior now constantly moving/searching) but did NOT raise success — 69% ties
PPO_28's 71%. The freeze was a SYMPTOM, not the ceiling. The true remaining
blocker is SEARCH/DISCOVERY: ~30% of episodes never find the hidden target before
timeout, because a reactive policy has no memory of where it has already looked.
Keep normalized throttle + freeze rule + scan nudge permanently as the new healthy
seeker baseline. PPO_29 (memoryless) is the seeker champion.

### PPO_30_LSTM_SEARCH — memory brain tested for search; CLOSED, memory loses (2026-09-02)

Revived the recurrent LSTM brain (`--memory lstm`, `MlpLstmPolicy`,
`lstm_hidden_size=256`, `n_lstm_layers=1`, lr 2e-4) to test whether memory of
where-searched helps the hidden-target SEARCH problem — the first task where memory
has a plausible job, unlike the still-target-with-known-direction PPO_19-21 line.
ONLY the brain changed; it inherits all PPO_29 env changes (normalized throttle,
freeze rule, scan nudge) and the same 6-obstacle arena. Trains fresh (LSTM weights
cannot warm-transfer from an MLP). Trainer: restored the `RecurrentPPO` build
branch behind `--memory {none,lstm}` + `--lstm-hidden-size`; `predict_with_memory`
and all four inference loops already carried LSTM state. Runs ~15s/1k (7x slower).

- **200k** (`ppo_30_lstm_search_200k/`, seed 27495): **53% success**, 47% timeout,
  stopped 0.25%, forward 99.7%, mean throttle 0.37 (timid), avg length 373. Below
  memoryless (69%) BUT the 25-maze checkpoints were STILL climbing steeply at the
  cut (36->48->60% in the final stretch), so 53% looked budget-limited, not a
  ceiling — which justified a 500k extension.
- **500k** (`ppo_30_lstm_search_500k/`, seed 709447, 507,904 transitions): final
  100-maze exam **39% success**, 61% timeout, 10.85 net progress — WORSE than its
  own 200k. The 25-maze checkpoints oscillated 44-68% throughout and never settled
  (the LSTM instability seen in PPO_19-21); the final saved model landed on a weak
  point and the rigorous exam exposed it.

Verdict: on the hidden-target SEARCH task the recurrent memory brain is worse AND
less stable than memoryless. The "memory of where I searched" hypothesis did not
pay off (matching the owner's tie-or-lose prediction). DECISION: drop the LSTM for
the static-target line; keep memoryless PPO_29 as champion. `--memory lstm` stays
in the trainer for a possible future MOVING-target test (a genuine temporal
signal), which is a later stage.

### PPO_31_LSTM_EXPLORE — 2-layer LSTM + boosted exploration; ABORTED, LSTM closed again (2026-09-03)

Owner's chosen experiment: give the memory brain MORE capacity (2 LSTM layers) plus
a 5x stronger new-area reward, to see if it could finally crack search. Flags:
`--memory lstm --lstm-layers 2 --lstm-hidden-size 256 --normalized-throttle
--exploration-reward 0.05 --new-view-reward 0.01 --learning-rate 0.0002` (lr held at
PPO_30's value per owner's "don't hike the LR"). Trainer changes (kept): new CLI
`--lstm-layers` (default 1), `--exploration-reward`, `--new-view-reward`; the
recurrent branch now auto-uses `n_epochs=5` (plain MLP stays 10) as a stability
lever; config records `lstm_layers`, `exploration_reward`, `new_view_reward`. Reward
env defaults were raised for this run: `EXPLORATION_REWARD 0.01->0.05`,
`NEW_VIEW_REWARD 0.002->0.01`.

- **~164k of 250k, then died on its own** (`ppo_31_lstm_explore_250k/`, natural
  seed). Deterministic exam by step: 40k=0%, 60k=4%, 80k=12%, **100k=24%**, 120k=16%,
  140k=20%, 160k=20% — climbed then FLATTENED at ~20-24%, below memoryless PPO_29
  (69%) and below PPO_30's 39%. Checkpoints saved through 160k; no final model/eval.
- **Stopped externally, not by owner or code.** Log ends cleanly after the 160k
  checkpoint with NO traceback → OS-level kill, almost certainly OUT OF MEMORY (the
  2-layer LSTM is the heaviest brain we run, ~20MB/save, alongside TensorBoard +
  browser). Lesson: prefer the light MLP and watch RAM.
- **Two failure signatures:** (a) 2 layers = harder to train, not smarter (the
  flagged recurrent instability); (b) episode length ballooned 180→640+ steps = the
  boosted exploration reward BACKFIRED into a "professional wanderer" farming
  new-cell bonuses instead of committing to find the target.

Verdict: the from-scratch LSTM is now closed TWICE (PPO_30 39%, PPO_31 ~20%). A
recurrent brain built from scratch wastes its capacity relearning the walk/dodge
body, so it is a worse searcher than the memoryless champion. Do not spend more
budget on a fresh internal-memory brain for the static seeker.

### Next (planned) — memory via STATE AUGMENTATION (coverage map), not LSTM

Owner reaffirmed (2026-09-03) the real goal: a MEMORY seeker reaching **≥85%** on the
hidden target, then a slowly MOVING target. Decision: the memory must NOT be an
internal LSTM (forces relearning the body, unstable). Instead use **state
augmentation** — feed the champion walker an explicit external memory as extra
OBSERVATION inputs: a **coverage / visitation map** ("been-there radar") built only
from cells Leaper has actually visited/seen — and **warm-start on the memoryless
PPO_29 champion** so walking/dodging is preserved and only "steer toward unexplored
ground" is learned. Honesty constraint: only seen/visited info enters; unexplored
cells stay blank and the target note stays empty until genuine line-of-sight — never
feed the full map or the hidden target position (that would be cheating and would
erase the search problem). Moving-target-ready by design: the same memory-as-input
idea later upgrades the existing `last_seen_target` note to carry the target HEADING
("last seen here, moving right"), making the mover a small add-on, not a rebuild.
Build steps when resumed (owner to green-light first): add a coverage-map observation
channel to the env (reuse the existing exploration grid / `EXPLORATION_CELL_SIZE`),
widen the observation, warm-start PPO_29 with the new (zero-initialized) input
columns, run ~250k. Searchable terms: "state/observation augmentation RL",
"visitation/coverage map", "occupancy grid as observation", "external vs recurrent
memory". Densify-the-arena + bigger arena/obstacles remain valid LATER stages but are
paused behind this. Memoryless PPO_29 (69%) stays the fallback champion.

### PPO_32_CLEARED_MAP — explicit cleared-map seeker (state augmentation); Phase 1, RUNNING (2026-09-04)

The planned coverage-map experiment, built. **One controlled change:** the observation
gains an explicit **cleared/search-coverage map** as extra inputs; everything else
(every PPO_29 env rule and PPO hyperparameter) is held, except the learning rate and
the enlarged observation as stated below.

- **Hypothesis.** PPO_29's remaining static-target failures (~30% timeout, ~30% never
  find the target) are caused by the memoryless brain **forgetting which parts of the
  arena it has already searched**, so it re-sweeps covered ground and times out. Giving
  it an explicit "where have I already looked" signal should raise first-detection and
  therefore success.
- **Exact observation change.** Observation widens **26 → 42**. Indices **0-25 are
  unchanged** in order, meaning, normalization, and numerical implementation (pinned by
  tests: byte-for-byte identical with coverage on vs off for the same state). Indices
  **26-41** are 16 egocentric "distance to nearest **unchecked** ground" values, one per
  vision-ray angle, each in `[0,1]` (0 = unchecked ground immediately along that heading,
  1 = none within 28 units). Built from an episode-local grid (`EXPLORATION_CELL_SIZE =
  3.0`) where a cell is cleared only if a hypothetical target there would be **detectable**
  under the real target-visibility rules (270° FOV, range 28, unoccluded). **The map never
  reads the actual target position** — only "this spot has been checked." See RL_SPEC §1a.
- **Assurance indices 0-25 unchanged.** `test_ppo32_coverage_map` includes a direct
  on-vs-off equality test plus a `_points_visible == _target_sensor` non-divergence test;
  the sensor code path for channels 0-25 is untouched.
- **Donor model.** `rl_artifacts/ppo_29_normalized_throttle_250k/leaper_ppo.zip`
  (the memoryless SEEKER champion, 69%).
- **Transfer procedure.** Build a fresh 42-input `MlpPolicy` (64,64). Copy the donor's
  actor and critic first-layer columns into destination columns 0-25; **zero columns
  26-41**; copy all later weights, biases, action-distribution params (`log_std`), and
  value params exactly; fresh optimizer. Fail loudly on any unexpected parameter name or
  shape. Equivalence test: with the 16 appended inputs zero, the widened model reproduces
  PPO_29's deterministic actions and value predictions within `1e-5` on 1,000 sampled
  observations. (Zero the new **weight columns**, never the runtime map inputs.)
- **Learning rate.** `1.5e-4` (the only hyperparameter change; lower than PPO_29's `3e-4`
  because we are fine-tuning a good brain, not training from scratch).
- **Training budget.** 250,000 steps per run (PPO completes whole 8,192 rollouts, so it
  collects a little over that), **three natural-seed runs** to separate signal from the
  seed lottery. `n_steps=1024`, 8 envs, rollout 8,192, batch 256, `n_epochs=10`,
  `gamma=0.995`, `gae_lambda=0.95`, `ent_coef=0.01`, normalized throttle on. Each run
  picks its own natural seed, written into `training_config.json`.
- **Three-seed requirement.** Do not select a checkpoint on stochastic training success,
  and do not tune rewards/architecture after seeing one seed. Evaluate every full model
  deterministically on the fixed 100-maze exam (seeds 10000-10099).
- **Evaluation protocol.** Deterministic exam (seeds 10000-10099) reporting success plus
  the new detection diagnostics (first-detection rate, time to first detection, success
  given detection, fraction cleared before detection, outcome split) and body-health
  (collision <6%, stopped <10%, success-after-sight >90% — recorded, not auto-acted-on).
  Baseline: the unchanged PPO_29 donor is evaluated with the same detection diagnostics
  for comparison.
- **Written go/no-go gate.**
  - **Go:** three-seed **mean success ≥ 78%** AND three-seed **mean first-detection ≥ 90%**
    → select the best deterministic checkpoint/model and run a 1,000-maze deterministic
    confirmation.
  - **No-go:** mean success ≤ 73%.
  - **Grey zone:** mean success > 73% but < 78% → extend only the best seed to 500k after
    documenting the decision.
- **Artifacts.** `rl_artifacts/ppo_32_cleared_map_smoke/` (isolated smoke),
  `ppo_32_cleared_map_250k_s1/`, `_s2/`, `_s3/`. Commands:
  `python train_rl.py --coverage-map --normalized-throttle --net-arch 64,64
  --learning-rate 1.5e-4 --warm-transfer rl_artifacts/ppo_29_normalized_throttle_250k/leaper_ppo.zip
  --timesteps 250000 --run-name PPO_32_CLEARED_MAP_S1 --artifact-dir rl_artifacts/ppo_32_cleared_map_250k_s1`
  (repeat for s2/s3). One-change-per-experiment rule kept.

**RESULTS (2026-09-04) — ❌ NO-GO. The cleared map did not help; hypothesis not supported.**
Three natural-seed 250k runs, deterministic 100-maze exam (seeds 10000-10099):

| Seed | Success | First-detection | Success\|detection | Never-detected | Collision % | Stopped % |
|---|---:|---:|---:|---:|---:|---:|
| s1 461014 | 67% | 81% | 83% | 19% | 7.8% | 11.5% |
| s2 113602 | 65% | 79% | 82% | 21% | 8.2% | 8.0% |
| s3 232855 | 70% | 81% | 86% | 19% | 9.5% | 3.3% |
| **3-seed mean** | **67.3%** (65-70) | **80.3%** (79-81) | 83.7% | 19.7% | 8.5% | 7.6% |
| PPO_29 baseline | 69% | 82% | 84.1% | 18% | 9.8% | 5.5% |

- **Gate → NO-GO.** 3-seed mean success 67.3% ≤ 73% (the explicit no-go line), and first-
  detection 80.3% is far under the ≥90% Go requirement. No 1,000-maze confirmation is run
  (that is reserved for a Go), and no 500k extension (that is the grey-zone remedy for
  73-78%, which we are below).
- **Below the memoryless champion.** Every seed landed at or below PPO_29's 69%/82%. The
  explicit cleared-map inputs did NOT raise first-detection — the exact metric the
  hypothesis predicted they would move. So on this evidence, "the seeker fails because it
  forgets where it already looked" is **not** the dominant cause of the remaining timeouts.
- **The walker did not degrade.** Body-health is baseline-level (collisions slightly lower
  than PPO_29, success-after-sight ~identical at ~84%). The threshold breaches (collision
  >6%, stopped occasionally >10%, success-after-sight <90%) are present in the PPO_29
  baseline too — they are properties of the seeker arena, not a PPO_32 regression. So this
  is a genuine "the added signal didn't help discovery," not "we broke the body."
- **Why it plausibly didn't help (for the next hypothesis, not acted on here):** the summary
  is egocentric "distance to unchecked ground" along the 16 ray headings, capped at 28
  units; in a 62.5-wide arena much unchecked ground sits beyond sensing range or in the
  rear blind wedge, so early in an episode most directions read a similar mid-range value
  and the gradient toward *genuinely* new territory is weak. A coarser but global signal
  (e.g. bearing to the nearest large unchecked region, or a low-res whole-arena occupancy
  vector) might carry more search information — but that is a NEW experiment to be proposed
  and green-lit, per the one-change rule; nothing was tuned after seeing these seeds.
- **Fallback champion unchanged: PPO_29 (69%) remains the seeker champion.** PPO_32 is not
  promoted to a browser champion (it did not pass its evaluation gate); browser live-brain
  export is untouched, as instructed.

### PPO_33_FRONTIER_1B — global frontier note (Phase 1B); ❌ NO-GO, but the first improvement (2026-09-08)

Phase 1B, the follow-up to PPO_32's negative. **One controlled change vs PPO_32:** replace the
16 LOCAL 28-unit "distance to unchecked ground" rays (obs 26-41) with a compact **5-value
GLOBAL frontier note** (obs 26-30). Everything else held: static hidden target, all PPO_29 env
rules/rewards/PPO settings, original indices 0-25, plain 64×64 MlpPolicy (no LSTM), LR 1.5e-4,
warm-transfer from the PPO_29 donor.

- **Hypothesis.** PPO_32 failed because its local rays saturated and could not point at large
  DISTANT unchecked regions. A global note — *direction + distance to the nearest frontier cell
  of the largest substantial contiguous unchecked region, that region's size, and a valid flag*
  — should steer Leaper toward the biggest unexplored area and raise first-detection.
- **Observation change.** Obs widens **26 → 31**. Indices 0-25 unchanged (pinned by tests).
  Indices 26-30 = `[rel_dir_x, rel_dir_z, distance/diagonal, region_size/total_cells, valid]`.
  Computed only from the internal cleared grid (the same one PPO_32 built); a 4-connected
  flood-fill picks the largest unchecked component, ignores fragments below
  `FRONTIER_MIN_REGION_CELLS = 6` (rock-shadows), and takes the nearest frontier cell (region
  cell adjacent to cleared). **Honest:** never reads the true target or obstacle positions
  (pinned by a test that varies both and gets an identical note). `--frontier-note` flag.
- **Transfer.** Widen PPO_29 26→31: copy the 26 donor columns exactly, ZERO the 5 new columns
  in actor+critic first layers, copy all later params, fresh optimizer; equivalence test =
  reproduces donor actions+values ≤1e-5 on 1,000 obs with the 5 appended inputs zero.
- **Seed 10007 proof (before training):** at spawn (top-left) the note points +0.98 x / −0.21 z
  into the large bottom-right unchecked region (72% of arena); a naive follow-the-note
  controller drives Leaper straight into that region. `rl_artifacts/ppo_33_frontier_seed10007_proof.png`.

**RESULTS (2026-09-08) — 3 natural-seed 250k, deterministic 100-maze exam (10000-10099):**

| Seed | Success | First-detection | Success\|detection | Never-detected | Collision % | Stopped % |
|---|---:|---:|---:|---:|---:|---:|
| s1 445774 | 73% | 84% | 87% | 16% | 8.3% | 5.5% |
| s2 341696 | 68% | 80% | 85% | 20% | 6.7% | 8.6% |
| s3 460828 | 71% | 84% | 85% | 16% | 8.2% | 5.3% |
| **3-seed mean** | **70.7%** (68-73) | **82.7%** (80-84) | 85.7% | 17.3% | 7.7% | 6.5% |
| PPO_29 baseline | 69% | 82% | 84.1% | 18% | 9.8% | 5.5% |
| PPO_32 (local rays) | 67.3% | 80.3% | 83.7% | 19.7% | 8.5% | 7.6% |

- **Gate → NO-GO.** Go required mean success ≥78% AND first-detection ≥90%; actual 70.7% / 82.7%.
  Mean success is also at/below the 73% no-go line. No 1,000-maze confirmation, no Phase 2 (per
  the instruction: Go only, otherwise stop and report).
- **BUT it is the first real improvement in the memory-augmentation line.** PPO_33 beats BOTH the
  PPO_29 baseline (69%/82%) and the failed PPO_32 (67.3%/80.3%) on success AND first-detection,
  across the seed spread — so the GLOBAL frontier signal is genuinely more useful than PPO_32's
  local rays, and the direction (global > local) is validated. It just isn't enough on its own to
  clear the 78%/90% bar: mean first-detection only moved +0.7pt over baseline, so ~17% of mazes
  are still never solved because the target sits where the agent, even when steered at the biggest
  unknown, does not get unobstructed line-of-sight in time.
- **Walker healthy, no degradation:** collisions LOWER than baseline (7.7% vs 9.8%), stopped ~6.5%,
  success-after-sight 85.7% (~baseline). Threshold breaches (collision >6%, sight <90%) match the
  PPO_29 baseline = seeker-arena properties, not a PPO_33 regression.
- **PPO_29 (69%) remains the seeker champion.** PPO_33 is NOT promoted to browser (did not pass
  its gate); live-brain export untouched. Nothing tuned after seeing the seeds. Artifacts:
  `rl_artifacts/ppo_33_frontier_250k_s{1,2,3}/`. STOPPED per instruction — Phase 2 not started.

### Phase 1B failure inspection (2026-09-08) — the note was being IGNORED

Before designing the next run, ran PPO_29 + all three PPO_33 on the same 100 exam mazes
(identical env; mazes verified byte-identical regardless of the frontier flag; only difference =
obs 26 vs 31). Two decisive findings (`rl_artifacts/phase1b_diagnostics/PHASE1B_FAILURE_REPORT.md`):

1. **The frontier note was inert.** Note-zeroed ablation (zero the 5 inputs, keep the 26) did NOT
   hurt — it *helped* in 2 of 3 seeds; movement-to-note alignment ≈ +0.01; same-state action
   divergence ≈[0.01, 0.06]; revisit fraction identical to PPO_29 (0.84). PPO_33's +1.7pt over
   PPO_29 was warm-transfer/seed noise, not the note.
2. **Dominant failure = "never within 28 units"** (~12-15 of ~16-20 never-detected): Leaper never
   travels to the target's region. Occlusion-behind-a-rock is minor (3-5); pursuit failure ~12.

Likely cause of (1): the new columns are warm-transferred at exactly zero, and 250k of fine-tuning
of an already-rewarded reactive policy never grows them (chicken-and-egg: the net won't route
through a feature until it helps, and it can't help until the net routes through it). → PPO_34.

### PPO_34_FRONTIER_SEED — seed the frontier-direction weights; ❌ NO-GO, but a diagnostic win (2026-09-08)

**One controlled change vs PPO_33:** at warm-transfer, seed the two frontier-direction first-layer
columns (obs 26-27) with **0.5 × the donor's learned target-direction columns (obs 2-3)** in BOTH
actor and critic, instead of zeroing them (`--seed-frontier-from-target 0.5`; default 0.0 keeps
PPO_33). Rationale: give the frontier direction the same "walk toward it" wiring the target
direction already has, at half strength, so the note is behaviorally active from step 0 and
fine-tuning only calibrates it. Only the new columns are touched, so a **zero note still reproduces
PPO_29 exactly** (equivalence intact). Everything else held (env, rewards, PPO, indices 0-25, 64×64
MLP, note computation, LR 1.5e-4, 3 seeds, 78%/90% gate).

**RESULTS (3 natural-seed 250k, exam 10000-10099):**

| Seed | Success | First-detection | Success\|detection | Never-detected | Detected-but-failed |
|---|---:|---:|---:|---:|---:|
| s1 867683 | 65% | 85% | 76% | 15% | 20% |
| s2 68174 | 73% | 90% | 81% | 10% | 17% |
| s3 854104 | 72% | 89% | 81% | 11% | 17% |
| **mean** | **70.0%** | **88.0%** | 79% | 12% | 18% |
| PPO_33 | 70.7% | 82.7% | 85.7% | 17.3% | 12 |
| PPO_29 | 69% | 82% | 84.1% | 18% | 13 |

- **Gate → NO-GO** (70.0% / 88.0%; both under 78% / 90%).
- **But the seeding worked as intended — the note is now genuinely USED.** Ablation
  (`ppo34_ablation.json`): zeroing the note now **drops first-detection 5-7 pts** (PPO_33 lost 0),
  movement-to-note alignment rose to **+0.07–0.17** (PPO_33 +0.01), turn action-divergence ~0.32
  (PPO_33 0.06). This confirms PPO_33's failure was **adoption** (dead zeroed columns), not the
  concept.
- **It revealed the real bottleneck: the always-on note fights PURSUIT.** Search improved
  (first-detection 82.7 → 88.0, never-detected 17.3 → 12), but once the target is found the note
  still points at unchecked ground away from it, so success-given-detection fell (85.7 → 79) and
  detected-but-failed rose (12 → 18). The two effects cancel → success flat at ~70%.
- Walker healthy; PPO_29 (69%) stays champion; PPO_34 not promoted to browser.
- **Recommended next (PPO_35, one change, propose-before-build): gate the frontier note OFF after
  detection** (zero it / valid=0 once `target_ever_seen`), mirroring the PDF's "exploration only in
  not-found mode". Hypothesis: keep the +5pt detection gain while restoring pursuit → the cleanest
  shot at the 78%/90% gate. Artifacts: `rl_artifacts/ppo_34_frontier_seed_250k_s{1,2,3}/`,
  diagnostics in `rl_artifacts/phase1b_diagnostics/`.

### PPO_35_FRONTIER_SEED025 — faint note + longer budget; ❌ NO-GO, best of the line; note sweep done (2026-09-08)

The "trust the reward" path (owner's call) instead of gating the note off after detection: keep the
frontier note always-on but faint enough that pursuit reward overrides it on its own. **Two changes
vs PPO_34** (owner-directed, attribution caveat): `--seed-frontier-from-target 0.5 → 0.25` and
250k → 500k. Everything else held.

**RESULTS (3 natural-seed 500k, exam 10000-10099):**

| Seed | Success | First-detection | Success\|detection | Never-det | Det-but-failed |
|---|---:|---:|---:|---:|---:|
| s1 437104 | 71% | 86% | 83% | 14% | 15% |
| s2 888602 | 72% | 86% | 84% | 14% | 14% |
| s3 869952 | 74% | 85% | 87% | 15% | 11% |
| **mean** | **72.3%** | **85.7%** | ~85% | 14% | 13% |

- **Gate → NO-GO** (72.3% / 85.7%). But the **highest and tightest success of the whole seeker line**
  and **pursuit fully healed** (success|det back to ~85 from PPO_34's 79; detected-but-failed 18 → 13).
- Ablation (`ppo35_ablation.json`): at 0.25 the note is **lightly used** — alignment +0.05–0.10 (PPO_33
  +0.01, PPO_34 +0.13), turn action-divergence ~0.10–0.15 (PPO_34 0.32); zeroing drops first-detection
  only 0–3 pts, and on s3 zeroing hurts net success (74 → 69), so it does help there.

**Frontier-note sweep conclusion.** Across seed strength 0.0 → 0.25 → 0.5, the frontier note as an
observation input plateaus at **~70–72% success / 85–88% first-detection**: 0.0 ignored (70.7), 0.5
strongly used but hurts pursuit (70.0), 0.25 balanced and best (72.3). It is a **~+3 pt lever, not a
path to 78%/90%.** The remaining wall is **traversal/coverage** — ~14% of mazes she never gets near
the target (never within 28 u), and a directional hint alone cannot force a reactive walker to cross
the arena. Note tuning is exhausted. PPO_29 (69%) stays champion; PPO_35 (72.3%) is the best seeker
but not promoted (failed gate). Decision fork (nothing launched): accept, or a structural change (one
at a time) — after-detection note gate, region-**centroid** note (not nearest rim), or a
waypoint/planner layer.

## Terms used in this project

- **Environment step:** one action applied to one Leaper environment. PPO_28 moves at most `0.375` units and turns at most `9` degrees.
- **Episode:** one attempt from a random spawn. It ends on goal success, PPO_16's terminal stuck failure, or after `1,000` environment steps in the slow-seeker arena.
- **Training rollout:** the experience PPO collects before updating its neural network. `n_steps=1024` means 1,024 steps from each of 8 parallel environments, so one training rollout contains `8,192` transitions.
- **PPO update:** after a training rollout, PPO reuses those 8,192 transitions for `10` epochs. With `batch_size=256`, that is 32 mini-batches per epoch and 320 gradient updates per rollout.
- **Evaluation checkpoint:** every 10,000 total training steps, training pauses briefly for 25 deterministic evaluation episodes. Five deterministic episodes are recorded for the browser visualizer. These recordings are replays only and are not used to train the policy.
- **Total timesteps:** total transitions across all 8 environments. Because PPO completes whole 8,192-transition rollouts, a requested 300,000-step run currently finishes at 303,104 collected steps.

## Current seeker configuration

### Environment

- Arena boundary: `[-31.25, 31.25]` on both planar axes
- Random semantic target; direction/distance hidden until unoccluded sight
- Random circular obstacles: 6, regenerated every episode with a reachability guard
- Collision samples: body plus 3 samples on each of 6 legs (19 total)
- Maximum episode length: 1,000 steps
- Maximum movement: 0.375 units per step
- Maximum turn: 9 degrees per step
- PPO_9 observation: original 7 navigation values plus `last_collision`,
  `previous_forward_action`, and `previous_turn_action` (10 values total)
- PPO_10 forward throttle: signed `[-1, 1]`; negative reverses, zero stops,
  and positive moves forward. Turning remains `[-1, 1]`.
- PPO_17_SMOKE kept the 18-value observation shape but replaced the old eight
  360° centre rays with eight 25° collision-aware sectors covering only the
  forward 200°, each returning the 19-point safe clearance normalized by the
  12-unit range. This was discarded by owner decision (see PPO_18).
- **PPO_25 (16 rays + idle penalty) remains the previous fully-informed champion and warm-start parent.** It is
  the PPO_23 design (16 rays, 270° cone, range 28, forward-only) plus ONE behavioral
  change — an **idle penalty** that taxes sustained standing-still (`--idle-penalty
  0.04 --idle-grace 3`). Deployable champion = seed 911743 = **93%** on the 100-maze
  exam and **91.3%** on a 1,000-fresh-maze stress test (95% CI 89.6–93.0%). It cleared
  the 85% target reliably: 4 seeds scored 89 / 92 / 93 / 92 (mean **91.5%**), vs
  PPO_23's high-variance 81.5% (73–87). Keep 16 rays + idle penalty for all runs.
- **PPO_23 (16 rays) was the prior champion (81.5% mean, best seed 87%).** Same as
  PPO_18 with vision detail doubled 8 → **16 rays** (observation 18 → 26, channels
  0–9 unchanged). Set with `--ray-count 16`. Superseded by PPO_25's idle penalty,
  which raised the mean +10 points and removed the seed-to-seed variance.
- **PPO_18 was the prior 8-ray baseline (75%).** It keeps the 18-value shape (base
  channels 0–9 unchanged) but the eight rays (indices 10–17) are the simple thin
  rangefinder — distance from the body centre to the nearest obstacle or
  wall — re-aimed into a **270° forward cone** and normalized by a longer
  **28-unit** range; the rear 90° is blind. Movement is **forward-only**: throttle
  is `[0, 1]` (reverse removed), superseding PPO_10's signed `[-1, 1]`. These
  changes invalidate every earlier policy even though the shape stays 18. The
  trainer is plain `PPO("MlpPolicy")`; `--ray-count` / `--ray-max-range` /
  `--net-arch` are CLI-selectable (defaults 8 / 28.0 / "64,64").

### Reward used by PPO_8

```python
progress_reward = 0.2 * (prev_distance - current_distance)
time_penalty = -0.01
collision_penalty = -0.18 if collided else 0.0
goal_reward = 25.0 if reached else 0.0

reward = (
    progress_reward
    + time_penalty
    + collision_penalty
    + goal_reward
)
```

Only `prev_distance` is additional reward state. It is initialized at episode reset and updated after every step.

### Reward addition in PPO_25 (idle penalty)

PPO_25 adds one term to the reward above — an **idle penalty** that discourages
sustained standing-still (the root cause of the PPO_23 timid-run variance):

```python
# idling = throttle < IDLE_THROTTLE (0.1) for more than IDLE_GRACE (3) steps in a row
idle_penalty = -IDLE_PENALTY if idling else 0.0   # IDLE_PENALTY = 0.04
reward = progress_reward + time_penalty + idle_penalty + collision_penalty + stuck_penalty + goal_reward
```

Sized deliberately between the time cost (0.01, so idling is worse than a normal
step) and the collision penalty (0.18, so she never rams walls to avoid standing).
The 3-step grace keeps a brief pivot-in-place free. Reported inside the `time`
diagnostics bucket so keys are unchanged. Overridable via `--idle-penalty` /
`--idle-grace` (defaults 0.04 / 3; `--idle-penalty 0` disables). New idle-state
counter `self.idle_steps` is reset each episode.

### PPO

```text
policy: MlpPolicy
parallel environments: 8
learning rate: 0.0003
n_steps: 1024 per environment
rollout buffer: 8192 transitions
batch size: 256
epochs per rollout: 10
gamma: 0.995
GAE lambda: 0.95
entropy coefficient: 0.01
seed: 7
evaluation interval: 10,000 steps
```

## RESOLVED (2026-08-27): the 85% target is met — PPO_25 = 91–93%

The section below documents the problem as it stood at PPO_22. It was solved in
two steps: **PPO_23** (sharper eyes, 8→16 rays) lifted the mean to 81.5% but was a
seed lottery; **PPO_25** (an idle penalty on standing-still) removed the variance
and lifted the mean to 91.5%, with every seed clearing 85%. Confirmed on 1,000
fresh mazes at 91.3%. Two follow-ups were tested and cleanly ruled out: longer
range alone (PPO_24) and longer range + idle penalty (PPO_26) both scored *below*
the range-28 champion — in a dense field, longer rays flood the reading with
distant clutter and make her hesitate. Champion recipe: **16 rays · range 28 ·
forward-only · idle-penalty 0.04 / grace 3.** Original PPO_22-era analysis follows
for the historical record.

## The core unsolved problem (as of PPO_22, 2026-08-26)

The champion is **PPO_18 = 75%** and the owner's target is **85%**. Two "more
thinking power" experiments have now failed to close that gap: recurrent memory
(PPO_19-21, best 71%) and a wider 256x256 network (PPO_22, 74%). Both were washes
because **capacity is not the bottleneck.**

**What she fails at:** the robot always knows the exact direction and distance to
the target (a built-in compass observation). She no longer crashes (collision
handling solved) and no longer freezes (the PPO_16 stuck rule solved that). The
remaining ~25% of failures are **timeouts** — on the dense field, roughly 1 in 4
mazes contains a pocket / cul-de-sac that *opens toward the target*. Her compass
pulls her straight in; escaping requires temporarily moving *away* from the
target and around an obstacle, which her greedy reactive policy resists. She
paces inside the pocket until the 1,000-step budget runs out. **She is a strong
reactive walker but a weak route-planner; the last 10% is dead-end solving.**

**Why better eyes is the next lever (not more compute):** she has `RAY_COUNT = 8`
beams over a 270° cone = one every ~34°. At `RAY_MAX_RANGE = 28` two neighbouring
beams are ~19 units apart at the far end, but obstacles are only ~6 units wide, so
a whole obstacle or a false "doorway" can fall in the blind gap between beams. Her
picture of what is ahead is too coarse to read where the real openings are, so she
commits to a trap before she can tell it is a trap.

**Planned experiments (one variable at a time, fresh model each — changing the
number of rays changes the 18-value observation size and invalidates older
policies):**
- **PPO_23 — more beams: `RAY_COUNT` 8 -> 16** (spacing ~34° -> ~17°). Everything
  else identical to PPO_18. Targets the resolution problem directly so she can
  read the shape of openings and route around pockets. This is the recommended
  next run.
- **PPO_24 — longer range: `RAY_MAX_RANGE` 28 -> ~45** — only if PPO_23 does not
  reach ~85%. Lets her see large dead-end structures (several obstacles forming a
  wall) sooner, ~2-3 obstacle layers ahead instead of ~1.
- Cheap sanity check alongside: seed-replicate PPO_18 on 2-3 seeds to confirm 75%
  is real, since PPO_18 (75%) vs PPO_22 (74%) is within single-seed noise.

## Run history

| Run | Collected steps | Change from previous known run | Deterministic result | Outcome |
|---|---:|---|---|---|
| PPO_1 | 24,576 | Initial body-only smoke run | Final evaluation was not archived separately | Smoke test completed |
| PPO_2 | 303,104 | Same PPO settings, trained body-only environment longer | 60% success and 9.89 mean reward at the 300k checkpoint; 57% and 5.38 over the final 100 episodes | Best known run; archived in `body_only_run/` |
| PPO_3 | 229,376 | Added 18 leg collision sample points | 4% deterministic success at the last archived 220k checkpoint | Stopped/incomplete; collision version was much harder |
| PPO_4 | 303,104 | Pre-potential reward version with the 19-point collision model | 4% and -51.89 at 300k; final 100 episodes: 7% and -46.23 | Completed; poor compared with PPO_2 |
| PPO_5 | 106,496 | Diagnostic run; exact reward delta was not archived in the ledger at the time | No separate final evaluation preserved | Stopped/incomplete |
| PPO_6 | 303,104 | Time-decaying goal-reward experiment | 0% and -19.68 at 300k; final: 0% and -17.57 | Completed; archived in `time_decaying_goal_run/` |
| PPO_7 | 147,456 | Interrupted reward experiment later withdrawn | No final evaluation | Stopped; not a baseline |
| PPO_8 | 303,104 | Replaced prior shaping with distance-change shaping `k=0.2`, fixed `-0.01` time cost, `-0.18` collision cost, and `+25` goal | 0% and -9.66 at 300k; final 100 episodes: 0% and -8.27 | Completed and archived in `ppo_8_collision_unaware_run/`; deterministic policy collapsed toward zero throttle |
| PPO_9 | 106,496 | Adds only collision memory to the observation: last collision plus previous forward/turn action. Adds read-only diagnostics and actual 8,192-transition rollout capture. Physics, actions, reward, and PPO settings remain PPO_8-identical. | 0% and -7.20 at the 100k checkpoint; final 100 episodes: 0% and -6.03 | Completed and archived in `ppo_9_collision_awareness_100k/`; collision memory alone did not fix deterministic zero throttle |
| PPO_10 | 106,496 | Change only forward throttle from `[0, 1]` to signed `[-1, 1]`; negative is reverse | Final 100 episodes: 5% success and -28.04 mean reward | Completed and archived in `ppo_10_signed_throttle_100k/`; signed throttle removed deterministic freezing but collisions remain severe |
| PPO_11 | 106,496 | Add only eight obstacle-clearance rangefinder rays to the observation (10 to 18 values); no other change | 69% deterministic success and +12.96 mean reward over the final 100-episode evaluation (best in project history) | Completed and archived in `ppo_11_ray_vision_100k/`; sight of obstacles cut collisions and roughly fixed the failure |
| PPO_12 | 106,496 | Keep PPO_11's rays; change only the collision response so rotation and translation resolve independently (a touching robot can turn or reverse out of contact) | 65% deterministic success and +6.09 mean reward (natural seed 53054) | Completed and archived in `ppo_12_collision_recovery_100k/`; escape mechanic proven and typical jams shorter, but collision rate did not fall |
| PPO_13 | 303,104 | Generalization run (owner decision): field ~2.5x wider each side (WORLD_LIMIT 25->62.5), 10 obstacles randomized into a fresh layout every episode (was 5 fixed), episode cap 400->1000, trained 300k. Robot's brain (rays, reward, signed throttle, decoupled collisions, PPO settings, rollout) identical to PPO_12 | 85% deterministic success and +31.66 mean reward on unseen random mazes (natural seed 364970); collision rate collapsed to 0.11% | Completed and archived in `ppo_13_random_arena_300k/`; best run in project history and it generalizes, but three env changes + 3x steps at once and a single seed limit clean attribution |
| PPO_14 | 303,104 | Harder-arena run (owner decision): field grown to WORLD_LIMIT 93.75 (187.5 wide), obstacle count 10->51 randomized per episode, target moved off-center to the south-west (-40, -10) with a small plaza plus a flood-fill reachability guarantee, episode cap 1000, trained 300k. Robot's brain identical to PPO_13 | 54% deterministic success and +3.38 mean reward on unseen dense mazes (natural seed 876919); collision rate back up to 15.87% with a 994-step worst wedge | Completed and archived in `ppo_14_sw51_300k/`; the density largely answers "was PPO_13's low collision just open space?"-yes: the stuck-in-contact freeze returns under a dense field |
| PPO_15 | 303,104 | Contact-avoidance experiment: raise only the collision penalty from -0.18 to -0.5 per step; arena, target, rays, PPO settings, and 300k steps identical to PPO_14 | 51% deterministic success (natural seed 889404); collision rate 12.84% (down from 15.87%), mean longest streak 52.41 (down from 67.18), but worst wedge still 990 steps and forward-step share fell 74%->46% | Completed and archived in `ppo_15_collision_penalty_300k/`; a small, mixed win-less contact and shorter jams, but success flat and the deep freeze persists; the heavier fine bought timidity, not smarter navigation |
| PPO_16 | 303,104 | Stuck rule: revert collision penalty to -0.18 and add a terminal stuck-failure - if the robot collides with no forward progress for STUCK_LIMIT=40 consecutive steps, end the episode with a one-time STUCK_PENALTY=10; arena/target/rays/PPO settings/300k identical to PPO_14 | 64% deterministic success (natural seed 489429); collision rate collapsed to 1.35%, mean longest streak 3.66, worst wedge capped at 43 steps, forward-step share healthy at 70% | Completed and archived in `ppo_16_stuck_rule_300k/`; best result on the hard arena and it fixes the freeze without timidity - the robot learned to avoid dead-ends rather than endure them |
| PPO_17_SMOKE | 24,576 | Validation only: eight forward 25° collision-aware sectors over 200°, same 18-value shape and 12-unit range; all reward, action, arena, collision recovery, stuck rule, and PPO settings unchanged | Smoke final: 1% deterministic success, 18.75 target progress, 3.88% collision steps; natural seed 308443 | Technical pipeline passed, NaN-free with empty stderr; not experimental evidence; isolated under `ppo_17_forward_clearance_smoke/` |
| PPO_17 | 106,496 | Main 100k gate for PPO_17's eight forward body/leg-aware clearance sectors; otherwise PPO_16 environment, reward, action, stuck rule, and PPO settings | Final 100 episodes: 8% deterministic success, -6.45 mean reward, 28.67 target progress, 2.91% collision steps; natural seed 846909 | Completed under `ppo_17_forward_clearance_100k_rerun/`; low contact but weak, nearly zero-mean throttle and a 38% stochastic/8% deterministic gap. Do not extend automatically to 300k |
| PPO_18 | 303,104 | Discard PPO_17 (owner) and return to the PPO_16 baseline with one "make her human" bundle: replace PPO_17's 200° collision-aware sectors with simple thin rangefinder rays re-aimed into a **270° forward cone**, range 12->28, and make movement **forward-only** (throttle `[0, 1]`, reverse removed). Dense 51-obstacle arena, stuck rule, reward, and PPO settings identical to PPO_16 | **75% deterministic success**, +20.39 mean reward on unseen dense mazes (natural seed 677925); collision-step rate 17.69% but no wedging (worst streak 43, mean longest 5.76) | Completed and archived in `ppo_18_human_vision_300k/`; **+11 over PPO_16** with decisive forward movement (0% reverse) — the opposite of PPO_17's timid collapse |
| PPO_19 | 507,904 | Recurrent **memory** brain: only change from PPO_18 is `RecurrentPPO("MlpLstmPolicy")` (lstm_hidden_size 256) so she carries hidden state between steps. New dep `sb3-contrib`. lr 3e-4, 500k | **71%** deterministic (natural seed 736031); training jittered hard | Below champion. Archived `ppo_19_memory_500k/`. 25-maze checkpoints spiked to 84-92% but real 100-maze exam = 71% — never report the small-sample number |
| PPO_20 | ~246k (aborted) | Same memory brain, only `--learning-rate 1e-4` (gentler) to cure PPO_19 jitter | Flat 0% to 160k, ~16-32% by 240k | Over-corrected: 1e-4 too slow to finish inside 500k. Stopped by owner, no final exam |
| PPO_21 | 507,904 | Same memory brain, `--learning-rate 2e-4` (middle ground) | **69%** deterministic (natural seed 61224); healthiest curve of the three (smooth) | Below champion. Archived `ppo_21_memory_mid_500k/`. Collides less (10%) and more decisive (121 avg ep len) but times out more (31%). **Memory line abandoned** — loses at all three learning rates |
| PPO_22 | 303,104 | Memoryless PPO_18 champion exactly, ONLY the brain widened: plain `PPO("MlpPolicy")` with `net_arch=[256,256]` instead of default 64x64 | **74%** deterministic (natural seed 570077); 26% timeout; collision-step rate 6.6% (down from PPO_18's 17.69%) | Archived `ppo_22_wider_brain_300k/`. **Statistical tie with PPO_18 (75%)** — wider network is a wash, timeout/planning gap unchanged. Converged by ~240k (checkpoints plateaued 80-88%), so longer budget won't help |
| PPO_23 | 303,104 | PPO_18 champion exactly (64x64 brain, forward-only), ONLY the eyes sharpened: `RAY_COUNT` 8 -> 16 (spacing ~34° -> ~17°) via new `--ray-count` flag | **4 seeds: 86 / 73 / 87 / 80% -> mean 81.5%**, range 73-87 (high variance); collision-step rate ~2-4% | **CONFIRMED win of ~+5 pts over the tight ~76.7% 8-ray baseline; new baseline going forward.** Variance is a decisiveness effect (decisive seeds ~86-87% clear target, timid seeds 73-80%). Two of four cleared 85%. **Deployable champion = seed 965726 (87%, `..._seedC_300k`).** Replay `leaper_ppo23_replay.html` = the 86% seed |
| PPO_24 | 507,904 | PPO_23 eyes (16 rays) with ONLY `--ray-max-range 28 -> 45` (longer sight); idle penalty NOT yet added | **80%** deterministic (seed 245103), 20% timeout, timid (55% forward) | **Inconclusive — dismissed.** Lands inside PPO_23's own 73-87% swing; range alone shows no signal. Confirmed the blocker is nerve, not eyes |
| PPO_25 | 507,904 | PPO_23 champion (16 rays, range 28) + NEW **idle penalty** (per-step tax on standing still): `--idle-penalty 0.04 --idle-grace 3` | **4 seeds: 89 / 92 / 93 / 92 -> mean 91.5%**, range 89-93, all bold; **1,000 fresh mazes = 91.3% (95% CI 89.6-93.0)** | ✅ **NEW CHAMPION.** Variance crushed (14pt->4pt spread; 4/4 clear 85%) and mean +10pts. Deployable = seed 911743 (93%, `ppo_25_idle_s3/`) |
| PPO_26 | 507,904 | PPO_25 idle penalty + `--ray-max-range 45` (the one untried combo) | **3 seeds: 80 / 84 / 82 -> mean 82%**, more timid (54-80% forward), 16-20% timeout | **Dismissed.** ~9 pts below the range-28 champion; longer range hurts even with the nerve fix (distant clutter in a dense field → hesitation). Range-45 door closed |

## PPO_26 range-45 + idle-penalty experiment (dismissed)

- Date: 2026-08-27
- Status: complete (3 parallel seeds)
- Parent: PPO_25 champion. Fresh models.
- Reason: the only untried combination — test whether longer sight adds anything
  *once* timidity is already fixed by the idle penalty.
- Change from PPO_25: `--ray-max-range 28 -> 45`; idle penalty kept (0.04 / grace 3).
- Command: `train_rl.py --ray-count 16 --ray-max-range 45 --idle-penalty 0.04 --idle-grace 3 --timesteps 500000 --run-name PPO_26_Sx` (seeds 782292 / 368918 / 934761).
- Result (100-maze exam): 80% / 84% / 82% → mean **82%**; forward-step 80% / 70% / 54%; timeout 20% / 16% / 18%.
- Artifacts: `rl_artifacts/ppo_26_r45_idle_s1|s2|s3/`.
- Conclusion: all three ~9 pts below the range-28 PPO_25 cluster (89-93) and *more*
  timid. Longer range hurts: at 45 nearly every ray hits distant clutter in the
  dense 51-obstacle field, so open doorways stop reading as open and near-field
  detail is compressed (a ray reports `distance / max_range`, so the same obstacle
  reads fainter at a longer range). Confirms PPO_24's hint.
- Next decision: **28 is the right range. Close the range-45 line. Ship PPO_25.**

## PPO_25 idle-penalty experiment (NEW CHAMPION)

- Date: 2026-08-27
- Status: complete (1 lead + 3 parallel confirmation seeds)
- Parent: PPO_23 champion (16 rays, range 28). Fresh models.
- Reason: PPO_23's variance was a *decisiveness lottery* — timid seeds dithered to
  73-80%. Standing still cost almost nothing (only the 0.01 time tax), so loitering
  was a safe habit. Attack that at its source instead of reseeding.
- Reward change (the one lever): add an **idle penalty** — `IDLE_PENALTY = 0.04`
  per step when throttle < `IDLE_THROTTLE = 0.1` for more than `IDLE_GRACE = 3`
  consecutive steps (brief pivot-in-place stays free). New CLI flags `--idle-penalty`
  / `--idle-grace`, recorded in `training_config.json`. Range held at champion 28 to
  isolate one variable. Everything else identical to PPO_23.
- Command: `train_rl.py --ray-count 16 --ray-max-range 28 --idle-penalty 0.04 --idle-grace 3 --timesteps 500000 --run-name PPO_25[_Sx]` (seeds 102911 / 456047 / 703466 / 911743).
- Result (100-maze exam): 89% / 92% / 92% / 93% → mean **91.5%**, range 89-93; every
  seed **bold** (forward-step 86-99%), timeout 7-11%, collision 2-5.6%.
- Generalization: champion model graded on **1,000 fresh held-out mazes** (seeds
  50000-50999) = **91.3%** (95% CI 89.6-93.0%), vs 93% on the standard 100 → genuine
  learning, not exam-overfit.
- Artifacts: `rl_artifacts/ppo_25_idle_s3/` (champion, seed 911743) + s2/s4 + root run.
- Conclusion: ✅ the win. Two effects at once — variance crushed (14pt → 4pt spread,
  4/4 clear 85%, no timid runs) **and** mean +10 points (81.5 → 91.5), floor (89%)
  now above target. The last blocker was that standing still was free.
- Next decision: **PPO_25 is champion.** Deployable = seed 911743 (93%). Keep 16
  rays + idle penalty as the baseline. (Longer range tested next in PPO_26 — worse.)

## PPO_24 longer-sight experiment (dismissed)

- Date: 2026-08-27
- Status: complete (1 seed)
- Parent: PPO_23 champion. Fresh model.
- Reason: hypothesis that longer sight lets her spot big dead-ends earlier and cut
  timeouts.
- Change from PPO_23: `--ray-max-range 28 -> 45` only. No idle penalty yet.
- Command: `train_rl.py --ray-count 16 --ray-max-range 45 --timesteps 500000 --run-name PPO_24` (seed 245103).
- Result (100-maze exam): **80%**, 20% timeout, timid (55% forward / 45% stopped).
- Artifacts: `rl_artifacts/` root run.
- Conclusion: inconclusive — one seed lands mid-pack inside PPO_23's own 73-87%
  swing, so longer range shows no signal, and the seed came out timid. Pointed the
  search at *nerve* (→ PPO_25). Range-45 later fully ruled out in PPO_26.
- Next decision: drop the range change; fix the decisiveness variance instead.

## PPO_23 more-rays experiment (superseded by PPO_25)

- Date: 2026-08-26
- Status: complete
- Parent: PPO_18 (the 75% champion). Fresh model.
- Change (single variable): the eyes only. `RAY_COUNT` 8 -> 16, so the 270° cone
  is sampled every ~17° instead of ~34°. Selected via the new `--ray-count` CLI
  flag (default 8); the observation grows from 18 to 26 values (10 base + 16
  rays), which invalidates older policies. Everything else identical to PPO_18 —
  64x64 network, forward-only throttle `[0, 1]`, 28-unit range, dense 51-obstacle
  arena, decoupled collisions, stuck rule, reward, PPO settings, 8,192 rollout.
- Result (fixed-seed 100-episode deterministic exam, comparable to PPO_18's 75%):
  **86% success, 14% timeout**, +31.86 mean reward, 68.55 net progress, 2.22%
  collision-step rate, 3.73 mean longest collision streak, 51 worst (no freezes),
  174.69 average episode length, 73.5% forward / 0% reverse (natural seed 671597,
  303,104 steps, NaN-free). Stochastic training success also 86%.
- **CORRECTION + FULL PICTURE (2026-08-26): the first 86% was optimistic; the
  true 16-ray level is a 4-seed mean of ~81.5%, high variance, best seed 87%.**
  The four 16-ray seeds:
  - seed 671597 = **86%**, decisive (73.5% forward, throttle 0.64).
  - seed 621697 = **73%**, TIMID (49% forward / 51% stopped, throttle 0.38).
  - seed 965726 = **87%**, very decisive (91.9% forward, throttle 0.87). **Best.**
  - seed 960925 = **80%**, moderately timid (67.6% forward, throttle 0.52).
- Honest interpretation: 16 rays is a **CONFIRMED real win of ~+5 points on
  average** (81.5% vs the confirmed 8-ray baseline mean 76.7% = 75/77/78, which is
  tight/low-variance) and clearly better vision (collision rate ~2-4%). The
  perception diagnosis was right. BUT it is **high-variance, and the variance is a
  decisiveness effect**: the two decisive seeds hit ~86-87% (clear the 85%
  target); the two that collapse toward stopping drop to 73-80% (the same
  deterministic-timidity failure seen in PPO_17/PPO_19). **Two of four seeds
  cleared 85%.** Do not report the *average* as meeting 85% (it's ~81.5%), but
  since deployment ships the single best trained model, the **deployable champion
  is seed 965726 = 87%** (`ppo_23_more_rays_seedC_300k/`), which does meet target.
- Baseline confirmation (the comparison it rests on): PPO_18 reruns
  `ppo_18_rerun_seedA_300k` (seed 270166) = **78%** and `ppo_18_rerun_seedB_300k`
  (seed 869854) = **77%**, bracketing the original 75% — so the memoryless
  baseline is a solid, low-variance ~75-78%.
- Replay of the strong seed is at `rl_artifacts/leaper_ppo23_replay.html` (8/8
  deterministic episodes reached the target), built with
  `tmp/build_viewer.py ... --ray-count 16`; note it shows the lucky 86% seed, not
  the typical policy.
- Follow-ups to actually reach 85%: (1) 1-2 more 16-ray seeds to pin the true
  mean; (2) attack the deterministic-timidity variance (e.g. `ent_coef`, or the
  throttle-cancelling collapse); (3) PPO_24 = `--ray-max-range` 28 -> ~45 (longer
  sight) as the next perception lever. Pick one; record it here.

## PPO_22 wider-network experiment

- Date: 2026-08-26
- Status: complete
- Parent: PPO_18 (the memoryless champion). Fresh model.
- Change (single variable): the brain only. Plain `PPO("MlpPolicy", ...,
  policy_kwargs=dict(net_arch=[256, 256]))` instead of SB3's default 64x64
  hidden layers. Everything else identical to PPO_18 — 270°/28-unit forward
  cone, forward-only throttle `[0, 1]`, dense 51-obstacle arena, decoupled
  collisions, stuck rule, reward, PPO settings, 8,192 rollout. The trainer had
  been left wired for `RecurrentPPO` after the memory experiments; it was
  switched back to plain `PPO`. The `predict_with_memory` inference helper was
  kept unchanged because plain PPO's `.predict()` accepts the same `state`/
  `episode_start` arguments and simply returns a `None` state.
- Result (fixed-seed 100-episode deterministic exam, comparable to PPO_18's 75%):
  **74% success, 26% timeout**, +23.72 mean reward, 58.80 net progress, 6.59%
  collision-step rate (down from PPO_18's 17.69%), 4.92 mean longest collision
  streak, 42 worst (no freezes), 244.04 average episode length, 56.79% forward /
  0% reverse (natural seed 570077, 303,104 steps, NaN-free, exit 0). Stochastic
  training success 78%.
- Interpretation: a statistical **tie** with PPO_18 (74 vs 75, single seed each).
  The wider network cut contact further but did NOT move the timeout/planning
  gap at all — route-planning *capacity* is not the bottleneck. The 25-maze
  checkpoints climbed and then plateaued in the 80-88% band from ~240k onward
  (peaked 92% at 250k), so the policy converged; a longer budget will not help.
  Two lines are now exhausted — recurrent memory (PPO_19-21) and wider network
  (PPO_22) — neither beats 75%. The next lever should target **perception or
  reward**, not compute: richer/longer vision (more than 8 rays, or range beyond
  28 on the 187.5-wide field so large dead-ends are seen sooner), or an
  anti-wandering reward tweak. Cheapest sanity move first: seed-replicate PPO_18
  on 2-3 seeds to confirm 75% is real, since 75 vs 74 is within single-seed noise.

## PPO_19-PPO_21 recurrent-memory experiments

- Date: 2026-08-25 to 2026-08-26
- Status: complete (PPO_20 aborted); **memory line abandoned**
- Parent: PPO_18. Fresh models.
- Change: give her a **memory** — replace PPO_18's plain `MlpPolicy` with an LSTM
  recurrent policy (`RecurrentPPO("MlpLstmPolicy")`, lstm_hidden_size 256,
  n_lstm_layers 1) so hidden state carries between steps and she can, in
  principle, remember explored dead-ends. New dependency `sb3-contrib>=2.9,<3`.
  All four inference loops updated to carry LSTM state and reset it at each
  episode start via `predict_with_memory()`. A `--learning-rate` CLI arg
  (default 3e-4) was added so the rate is tunable without editing code.
  Everything else identical to PPO_18.
- Runs and results (fixed-seed 100-episode deterministic exam):
  - **PPO_19** (lr 3e-4, 500k, seed 736031): **71%**. Trained but jittered hard
    (72->48->92->76% across checkpoints), the signature of a learning rate a
    touch too high for the recurrent policy. `ppo_19_memory_500k/`.
  - **PPO_20** (lr 1e-4, seed logged in config): over-corrected — flat 0% to
    160k, ~16-32% by 240k. Stopped by owner ~246k as clearly on track to miss
    75%. No final exam written. `ppo_20_memory_gentle_500k/`.
  - **PPO_21** (lr 2e-4, 500k, seed 61224): **69%**. Healthiest curve of the
    three (smooth, no jitter, no crawl). Collides less (10.1%) and is more
    decisive (121.41 avg ep len, mean throttle 0.80) than PPO_18, but times out
    more (31% vs 25%). `ppo_21_memory_mid_500k/`.
- Interpretation: recurrent memory does **not** beat memoryless PPO_18 at any of
  the three learning rates tried (3e-4 = 71%, 2e-4 = 69%, 1e-4 = too slow).
  Abandon the memory brain; PPO_18 (75%) stays champion. Reading note: the
  per-10k checkpoints only sample **25** mazes and flatter (PPO_19 spiked to
  84-92%); always report the rigorous 100-maze exam number, never the checkpoint.
- Note: this arc was tracked in detail in the auto-memory during the runs and is
  summarized here for the permanent ledger.

## PPO_18 human forward-vision experiment

- Date: 2026-08-24
- Status: complete
- Parent: PPO_16 (dense 51-obstacle arena, stuck rule, -0.18 collision penalty).
  Fresh model.
- Numbering note: the owner chose to discard the earlier PPO_17 forward-clearance
  experiment as a direction. Because PPO_17's runs already occupy that slot in the
  archives and above in this ledger, this human-vision run is recorded as **PPO_18**
  so run names stay consistent with the files on disk. PPO_17's eyes were never
  rebuilt to PPO_16's 360° form; PPO_18 replaces PPO_17's eyes directly (the working
  tree sat at PPO_17 when this run began).
- Reason for the run: two owner goals. (1) Creative: 360° all-round vision looks
  unnatural — Leaper should see like a human, a forward field with a blind back.
  (2) Performance: PPO_16's remaining gap is its 36% timeout rate; push success
  toward the 85% target. PPO_17 had already tried forward vision and *failed* (8% vs
  PPO_16's 64%) because it left the robot half-blind while still allowing reverse —
  so a narrow-sighted robot backed into obstacles it could not see. The fix designed
  here is to pair narrow vision with forward-only movement: **see forward, walk
  forward**, so the robot never travels into its blind spot.

### The one coherent change (a bundle, not a single variable)

This is deliberately **not** a single-variable experiment; vision span, vision
semantics, range, and the action space all moved together as one intended
"human" redesign, by owner decision. Everything else (arena, target, 19 collision
points, decoupled collision recovery, stuck rule, reward formula and amounts, PPO
settings, 8,192 rollout, 10k eval interval) is identical to PPO_16.

- **Vision geometry:** eight thin rangefinder rays (the simple PPO_11–16 sensor:
  distance from the body centre to the nearest obstacle surface or wall), re-aimed
  from a full circle into a **270° forward cone** (`VISION_FOV = 270°`). The rays
  sit at the centres of eight equal sectors, symmetric about straight-ahead; the
  robot is blind only to a 90° wedge directly behind it.
- **Vision range:** `RAY_MAX_RANGE` 12.0 → **28.0**, so dead-ends are visible while
  forming on the 187.5-wide field.
- **Movement (the safety pairing):** reverse removed. Throttle is now `[0, 1]`
  forward-only (`action_space.low = [0, -1]`); the robot turns to face, then walks
  forward. It still escapes contact by rotating in place plus the stuck rule.
- Observation stays 18 values and base channels 0–9 are unchanged, but the new
  sensor geometry and action space invalidate every older policy (fresh start).

```text
        PPO_16 — 360° all-round eyes            PPO_18 — 270° human cone
              (old, unnatural)                     (sees forward, walks forward)

                  ↖  ↑  ↗                                ↖  ↑  ↗
                  ←  R  →                                ←  R  →
                  ↙  ↓  ↘                                 ·  ·  ·   ← rear 90° BLIND
             rays in every direction               no rays behind; reverse removed
                (can reverse too)                   so she never enters the blind spot
```

- Command: `python train_rl.py --timesteps 300000 --run-name PPO_18 --artifact-dir rl_artifacts/ppo_18_human_vision_300k` (natural seed 677925; smoke first under `ppo_18_human_vision_smoke/`).
- Tests: `tests/test_ppo18_human_vision.py` (270° cone, longer range, forward-only,
  symmetric rays, rear blind wedge); the reverse cases in
  `test_ppo10_signed_throttle.py` / `test_ppo12_collision_recovery.py` were
  converted to forward-only. All 36 focused tests pass; env passes Gymnasium's
  checker NaN-free.

### PPO_18 final result

Deterministic values use the same fixed seeds from 10,000 (the identical exam
PPO_14–PPO_17 sat), so this is directly comparable to PPO_16.

| Deterministic metric | PPO_16 (360° eyes, reverse) | PPO_18 (270° human, forward-only) |
|---|---|---:|
| Success rate | 64% | **75%** |
| Timeout rate | 36% | 25% |
| Mean reward | (not comparable) | +20.39 |
| Mean net target progress | 57.28 | 59.07 |
| Collision rate | 1.35% | 17.69% |
| Mean longest collision streak | 3.66 | 5.76 |
| Worst collision streak (wedge) | 43 | 43 |
| Forward step share | 70.0% | 69.64% |
| Reverse step share | (some) | 0% |
| Mean absolute throttle | — | 0.52 (decisive) |
| Average episode length | 366.82 | 209.68 |
| Stochastic training success | 94% | 81% |

Reward breakdown per deterministic episode: +11.81 progress, -2.10 time, -8.08
collision/stuck, +18.75 goal.

### Deterministic success over training (answers the "it says 5%?" question)

The 5% some graphs show is the **start** of training, not the result. The
deterministic exam climbed from 0% to 75% over the run (checkpoint quick-evals use
25 episodes and are noisier than the final 100-episode exam):

| Steps | Success | |
|--:|--:|:--|
| 10k–80k | 0% | |
| 90k | 4% | ▏ |
| 100k | 20% | ████ |
| 130k | 44% | █████████ |
| 150k | 60% | ████████████ |
| 160k | 64% | █████████████ |
| 190k | 80% | ████████████████ |
| 250k | 76% | ███████████████ |
| 300k | 84%\* | █████████████████ |

\* 300k checkpoint quick-eval (25 episodes); the rigorous final 100-episode exam
scored **75%**, which is the number of record.

Conclusion: the human-vision redesign is a genuine **+11-point win** over the
previous champion (64% → 75%) and, critically, it is **healthy** — the exact
opposite of PPO_17's failure. PPO_17 collapsed into timid, near-zero throttle
(0.12 absolute) and 8% success; PPO_18 drives decisively (0.52 absolute throttle,
70% forward, 0% reverse) and finishes episodes far faster (367 → 210 steps). This
confirms the design reasoning: PPO_17 failed not because narrow vision is bad, but
because a half-blind robot was still allowed to reverse into its blind spot;
pairing the 270° cone with forward-only movement removes that mismatch.

Honest caveats:
- **Collision-step rate rose (1.35% → 17.69%).** With reverse removed the robot can
  no longer peel *backwards* off an obstacle, so it scrapes along edges more while
  pushing forward toward the goal. This is mostly benign edge-contact, not the old
  freeze: the stuck rule held (mean longest streak 5.76, worst 43, no wedging), and
  success *rose* despite the extra brushing. Still, contact avoidance is a clear
  next target.
- **Single natural seed** (677925), and this run **bundled several changes**
  (vision span, semantics, range, forward-only), so the +11 cannot be attributed to
  any one lever.

Next decision: keep the 270° human vision and forward-only movement — proven a net
win and behaviourally healthy. Remaining gap to the owner's 85% target is the 25%
timeout rate (getting lost, not wedging — a navigation-planning shortfall). The
design is now proven healthy, so the training-side power-ups deliberately held back
from this run are justified as the next changes, one at a time: (1) larger network
via `policy_kwargs` (net_arch ~256×256) and/or a longer training budget to cut
timeouts; (2) recurrent memory (dead-end recall) if still short of 85%; (3) seed
replication to confirm 75%; (4) reduce edge-brushing contact. Test one at a time
and record here.

## PPO_17 forward collision-aware vision smoke test

- Status: complete; smoke only, not a main result. Natural seed 308443.
- Purpose: prove that a forward 200° field can report body-and-leg-safe clearance,
  train without numerical failures, publish rollouts, and render the actual
  randomized obstacle layout plus vision readings.
- Observation: indices 0-9 remain unchanged. The target remains a known static
  destination through exact direction and distance channels; it is not visually
  detected. Indices 10-17 are eight contiguous 25° sectors, each internally
  sampling three directions and returning the minimum 19-point safe translation
  clearance divided by 12.
- Rear vision: none outside `yaw ±100°`. No maps, obstacle coordinates, routes,
  waypoints, or long-term obstacle memory are added.
- Reverse remains signed and unrestricted. Forward/reverse/stopped behaviour will
  be measured, not altered, in this smoke test.
- Command: `python train_rl.py --timesteps 20000 --run-name PPO_17_SMOKE --artifact-dir rl_artifacts/ppo_17_forward_clearance_smoke`
- Expected collection: 24,576 transitions. Do not start the 300k main run until
  the geometry, replay, logs, and smoke outputs have been inspected.

### PPO_17_SMOKE validation result

- Requested/collected: 20,000 / 24,576 transitions.
- Deterministic fixed-seed exam (100 episodes): 1% success, 99% timeout,
  -11.06 mean reward, 18.75 mean net target progress, 3.88% collision steps,
  15.38 mean longest collision streak, 43 worst streak, 663.38 average steps,
  55.33% forward, 44.67% reverse, and effectively 0% stopped.
- Latest stochastic training sample (24 completed episodes): 0% success, 15.57
  mean progress, 1.60% collision steps, 50.42% forward and 49.58% reverse.
- Reward breakdown per deterministic episode: +3.75 progress, -6.63 time,
  -8.43 collision/stuck, +0.25 goal.
- Validation: all 40 focused tests, Gymnasium checker, production browser build,
  populated CSVs, two checkpoints, final model/evaluation, TensorBoard event,
  replay JSON, progress plot, no NaN/Infinity, and empty stderr.
- Interpretation: the sensor/training/telemetry pipeline works. These 20k smoke
  numbers must not be compared as learning performance against PPO_16 at 300k.

### PPO_17 100k decision-gate result

- Status: complete, natural seed 846909, 106,496 collected transitions. Archive:
  `rl_artifacts/ppo_17_forward_clearance_100k_rerun/`.
- An initial attempt stopped at roughly 10k because Windows kept the browser live
  JSON open during atomic replacement. `write_live_state()` now retries briefly
  and skips a monitoring refresh instead of allowing a viewer lock to terminate
  training. The failed partial archive remains separate at
  `ppo_17_forward_clearance_100k/` and is not an experimental result.
- Deterministic fixed-seed exam (100 episodes): 8% success, 92% timeout, -6.45
  mean reward, 28.67 mean target progress, 2.91% collision steps, 1.51 mean
  longest collision streak, 42 worst streak, and 910.79 average steps.
- Movement diagnosis: 46.92% forward, 53.05% reverse, effectively 0% stopped,
  but mean signed throttle was -0.00094 and mean absolute throttle only 0.1184.
  The policy did not literally stop; it settled into weak, almost perfectly
  cancelling forward/reverse movement and usually timed out.
- Latest 100 stochastic training episodes: 38% success, +5.00 reward, 45.37
  progress, 3.44% collision steps, and 0.629 mean absolute throttle. Exploration
  moves decisively and sometimes succeeds; the deterministic mean policy does not.
- Checkpoint deterministic success was 0% through 40k, 4% at 50k/60k, 8% at
  70k, 4% at 80k/90k/100k. There is no stable upward deterministic trend.
- Verdict: forward body-aware clearance greatly limits contact, but this exact
  200°/eight-sector configuration does not yet produce reliable navigation on
  the dense hard arena. Do not automatically extend it to 300k. The next change
  should address deterministic indecision or restore some rear/peripheral safety
  information while preserving an animal-like preference for forward travel.

## PPO_16 stuck-rule experiment

- Date: 2026-08-20
- Status: complete
- Parent: PPO_14 arena; PPO_15's -0.5 penalty reverted to -0.18. Fresh model.
- Reason: PPO_15 showed scaling the flat penalty only buys timidity, not a fix.
  The freeze is a deterministic re-issue-of-a-blocked-move loop, so target it
  directly. Owner insight during design: ending an episode early is NOT a
  punishment on its own - without an explicit penalty, quitting early can even
  look attractive because it avoids accumulated time/collision costs. So the stuck
  end must carry a clear negative.
- The only learning-related change: a terminal stuck-failure. If the robot is in
  contact and makes no forward progress (`prev_distance - distance <= 1e-3`) for
  `STUCK_LIMIT = 40` consecutive steps, `step()` returns `terminated = True` (a
  true terminal failure, not a truncation, so the future value bootstraps to just
  the penalty) and applies a one-time `STUCK_PENALTY = 10`. Reported inside the
  collision reward term so diagnostics keys are unchanged. `COLLISION_PENALTY`
  reverted 0.5 -> 0.18. Everything else identical to PPO_14. Tests:
  `tests/test_ppo13_random_arena.py` (wedged episode terminates with penalty;
  open space never triggers stuck).
- Command: `python train_rl.py --timesteps 300000 --seed <random> --run-name PPO_16 --artifact-dir rl_artifacts/ppo_16_stuck_rule_300k` (natural seed 489429).

### PPO_16 final result

| Deterministic metric | PPO_14 (-0.18) | PPO_15 (-0.5) | PPO_16 (stuck rule) |
|---|---|---|---:|
| Success rate | 54% | 51% | 64% |
| Timeout rate | 46% | 49% | 36% |
| Collision rate | 15.87% | 12.84% | 1.35% |
| Mean longest collision streak | 67.18 | 52.41 | 3.66 |
| Worst collision streak | 994 | 990 | 43 |
| Forward step share | 74.4% | 46.0% | 70.0% |
| Average episode length | 510.76 | 552.55 | 366.82 |
| Mean net target progress | 47.89 | 49.38 | 57.28 |
| Stochastic training success | 100% | 100% | 94% |

Conclusion: the decisive win of the PPO_14-16 sequence and the best result on the
hard arena. The stuck rule eliminates the freeze by construction (worst wedge 994
-> 43, capped near STUCK_LIMIT) and, more importantly, the policy learned to avoid
dead-ends entirely: collision rate collapsed 15.87% -> 1.35% and mean longest
streak 67 -> 3.7. Deterministic success rose 54% -> 64% while forward-step share
stayed healthy at 70% (vs PPO_15's timid 46%), so the terminal penalty fixed the
behavior without the global caution tax of a flat fine. This confirms the design
reasoning: pairing the early end with an explicit failure penalty (and treating it
as terminal, not truncation) is what teaches "getting wedged is the worst outcome."

Next decision: keep the stuck rule permanently. Remaining headroom is the 36%
timeout rate - runs that neither reach the goal nor wedge, just don't arrive in
time on the big field. Candidate single changes: replicate PPO_16 on two more
seeds to confirm 64%; tune STUCK_LIMIT (e.g., 30 vs 60) or STUCK_PENALTY; or, for
the timeouts, revisit ray range/count so it plans routes better, or a longer
training budget. Test one at a time and record here.

## PPO_15 collision-penalty experiment

- Date: 2026-08-20
- Status: complete
- Parent: PPO_14 configuration; fresh model.
- Reason: PPO_14 showed the stuck-in-contact deterministic freeze returns in a
  dense field. The hypothesis: the -0.18 collision penalty makes grinding too
  cheap, so raising it should push the policy to steer around obstacles.
- The only learning-related change: `COLLISION_PENALTY` 0.18 -> 0.5. A blocked
  step now costs -0.5 instead of -0.18. Everything else identical to PPO_14
  (WORLD_LIMIT 93.75, 51 randomized obstacles with reachability, target (-40,-10),
  rays, signed throttle, decoupled collisions, PPO settings, 8,192 rollout, 1000
  cap, 300k steps). Reward change, so it invalidates prior policies (fresh run).
- Command: `python train_rl.py --timesteps 300000 --seed <random> --run-name PPO_15 --artifact-dir rl_artifacts/ppo_15_collision_penalty_300k` (natural seed 889404).

### PPO_15 final result

| Deterministic metric | PPO_14 (-0.18) | PPO_15 (-0.5) |
|---|---|---:|
| Success rate | 54% | 51% |
| Timeout rate | 46% | 49% |
| Collision rate | 15.87% | 12.84% |
| Mean longest collision streak | 67.18 | 52.41 |
| Worst collision streak | 994 | 990 |
| Forward step share | 74.4% | 46.0% |
| Average episode length | 510.76 | 552.55 |
| Mean net target progress | 47.89 | 49.38 |

(Mean reward is not comparable across the penalty change and is omitted; -18.38 for
PPO_15 mostly reflects the larger fine, not worse behavior.)

Conclusion: a small, mixed result, not the fix. The heavier fine did reduce contact
(15.87% -> 12.84%) and shorten typical jams (67 -> 52 steps), confirming the penalty
does influence contact. But deterministic success did not improve (54% -> 51%), one
episode still wedged for 990 of 1000 steps, and the forward-step share collapsed
from 74% to 46%: the policy bought caution/timidity rather than better avoidance,
and the core re-issue-blocked-move freeze is intact. A larger penalty alone would
likely deepen the timidity without solving the freeze.

Next decision: stop scaling the flat penalty. Target the freeze mechanism directly.
Preferred single change (PPO_16 candidate): a stuck/no-progress consequence - e.g.
truncate the episode (or apply an escalating penalty) after K consecutive collision
steps with no net progress, so the 990-step wedge cannot persist and the policy
gets a clean signal that being stuck is terminal, without a global timidity tax.
Alternatives: an escalating (not flat) collision penalty that stays cheap for a
single necessary brush but rises fast during sustained grinding; or a sparse->dense
obstacle curriculum. Test one at a time and record here.

## PPO_14 denser-arena, moved-target stress run

- Date: 2026-08-20
- Status: complete
- Parent: PPO_13 configuration (rays, signed throttle, decoupled collisions,
  reward, PPO settings, rollout); starts from a completely fresh model.
- Reason: PPO_13 hit 85% on the roomy 10-obstacle field with a near-zero 0.11%
  collision rate, but two caveats stood: the field was inherently open (more room
  to dodge) and it was a single seed. The owner chose to stress the arena directly
  to see whether the low collision rate was real avoidance skill or just open
  space, and to make the task harder overall.
- Environment changes (multiple at once, by explicit owner decision):
  - Field grown from WORLD_LIMIT 62.5 to 93.75 (a 187.5-wide field, ~1.5x each
    side, ~2.25x area).
  - Obstacle count raised 10 -> 51, still randomized into a fresh layout every
    episode; target-plaza clearance tightened 12 -> 6 so obstacles may sit close
    and force detours.
  - Target relocated from (-20, 15) to the south-west (-40, -10), off-center and
    farther out, so the robot must weave through obstacles rather than sit near
    the goal.
  - Reachability guarantee added: `_generate_obstacles` re-rolls any layout whose
    target is walled into a pocket, verified by a coarse-grid flood-fill
    (`_target_reachable`, `REACHABILITY_MIN_FRACTION = 0.5`). Detours are allowed;
    a sealed goal is rejected. Covered by `tests/test_ppo13_random_arena.py`.
  - Episode cap kept at 1000; total training kept at 300k.
- Unchanged (the learned brain): 18-value observation with eight rays, signed
  throttle, reward formula and amounts, 19 collision points, decoupled collision
  response, speeds, all PPO hyperparameters, 8,192 rollout, 10k eval interval.
- Command: `python train_rl.py --timesteps 300000 --seed <random> --run-name PPO_14 --artifact-dir rl_artifacts/ppo_14_sw51_300k` (natural seed 876919).

### PPO_14 final result

| Deterministic metric | PPO_13 (roomy, 10 obs) | PPO_14 (dense, 51 obs, SW target) |
|---|---|---:|
| Success rate | 85% | 54% |
| Timeout rate | 15% | 46% |
| Mean reward | +31.66 | +3.38 |
| Mean net target progress | 64.12 | 47.89 |
| Collision rate | 0.11% | 15.87% |
| Mean longest collision streak | 0.02 | 67.18 |
| Worst collision streak | 2 | 994 |
| Average episode length | 236.85 | 510.76 |
| Stochastic training success | 99% | 100% |

Conclusion: the dense field is much harder and it largely answers PPO_13's open
question. Packing the arena with 51 obstacles and forcing the robot to weave to a
south-west goal brings the stuck-in-contact freeze back: collision rate rose from
0.11% to 15.87%, the mean longest collision streak from 0.02 to 67 steps, and one
deterministic episode fully wedged for 994 of 1000 steps. So PPO_13's near-perfect
dodging was substantially a product of open space, not purely skill. The
stochastic training policy still reaches the goal ~100% of the time, but the
deterministic deployment policy re-issues blocked moves and freezes - the same
mechanism seen in PPO_10-PPO_12, now under real pressure. 54% deterministic on a
dense, generalized, moved-target field is a respectable result and a clear signal
that contact-avoidance/escape is the remaining problem.

Next decision: the arena is now a good hard benchmark; keep it. The contact
problem is the priority. The cleanest single controlled experiment is a reward
change (raise the -0.18 collision penalty so grinding costs more) or a curriculum
that starts sparser and densifies, with everything else at PPO_14 settings; also
worth adding is replication across two more natural seeds. Test one learning
change at a time and record here.

## PPO_13 larger randomized-arena generalization experiment

- Date: 2026-08-20
- Status: complete
- Parent: PPO_12 configuration (rays, signed throttle, decoupled collision
  response, reward, PPO settings, rollout); starts from a completely fresh model.
- Reason: the previously planned PPO_13 (raise the collision penalty) was
  superseded by an owner decision. Because the rays were confirmed across three
  seeds in PPO_11, the precondition recorded in the handoff notes for randomized
  and larger arenas was met, so the owner chose to test generalization directly:
  can the ray-based policy handle fields and obstacle layouts it has never seen,
  instead of one memorized arena.
- Environment changes (this is a multi-change run by explicit owner decision, not
  the usual single-variable experiment):
  - Field ~2.5x wider each side: `WORLD_LIMIT` 25.0 -> 62.5 (play area ~6x). The
    fixed target scaled with it, (18, 18) -> (45, 45), same proportional corner.
  - Obstacles randomized every episode: a fresh layout of `NUM_OBSTACLES = 10`
    (was 5 fixed) is sampled in `reset()` via `_generate_obstacles`. Radii stay
    robot-relative in `[2.5, 3.6]` (not scaled with the world, because the robot
    is unchanged), kept inside a wall margin, spaced apart, and cleared of the
    target so every episode stays solvable. Generation uses `self.np_random`, so a
    given reset seed reproduces its layout and the fixed-seed evaluation stays fair
    and identical across future runs.
  - Episode cap raised `MAX_STEPS` 400 -> 1000 so the much larger field is not an
    automatic timeout; the robot's speed is unchanged.
- Unchanged (the learned brain): 18-value observation with eight rays, signed
  `[-1, 1]` throttle and `[-1, 1]` turn, `RAY_MAX_RANGE = 12.0`, 19 collision
  points, decoupled collision response, movement/turn speeds, reward formula and
  amounts, eight environments, all PPO hyperparameters, 8,192-transition rollout,
  and the 10,000-step evaluation/checkpoint interval.
- Model compatibility: randomized geometry and the larger world change the
  dynamics but not the observation or action shape, so the network shape is
  unchanged; PPO_13 still starts fresh because it must learn against different
  dynamics.
- Replay change: `step()` info and the recorded replay episodes now carry the
  per-episode obstacle layout so viewers can draw the actual random maze rather
  than a stale fixed arena. Coverage in `tests/test_ppo13_random_arena.py`
  (obstacle count, in-bounds, target clearance, per-episode variation,
  seed reproducibility, collision-free start, unchanged observation size).
- Smoke command: `python train_rl.py --timesteps 20000 --seed <random> --run-name PPO_13_SMOKE --artifact-dir rl_artifacts/ppo_13_random_arena_smoke`
- Main command: `python train_rl.py --timesteps 300000 --seed <random> --run-name PPO_13 --artifact-dir rl_artifacts/ppo_13_random_arena_300k`

The isolated 20,000-step smoke test collected 24,576 steps under run name
`PPO_13_SMOKE` (natural seed 435196), NaN-free, stored in
`rl_artifacts/ppo_13_random_arena_smoke/`; technical verification only. The main
run collected 303,104 steps under natural seed 364970 with an empty stderr log and
no NaN in evaluation, stored in `rl_artifacts/ppo_13_random_arena_300k/`.

### PPO_13 final result and comparison

Deterministic values use the same fixed seeds from 10,000, but note the exam is
now harder than every prior run: each evaluation episode is a different random
maze in a much larger field, so this is not the same fixed arena PPO_1-PPO_12 were
scored on. The comparison below is "memorized fixed arena" (PPO_12) versus
"unseen random mazes" (PPO_13).

| Deterministic metric | PPO_12 (fixed arena) | PPO_13 (random mazes) |
|---|---|---:|
| Success rate | 65% | 85% |
| Timeout rate | 35% | 15% |
| Mean reward | +6.09 | +31.66 |
| Mean net target progress | 21.45 | 64.12 |
| Collision rate | 40.47% | 0.11% |
| Mean longest collision streak | 62.78 | 0.02 |
| Worst collision streak | 400 | 2 |
| Average episode length | 174.46 | 236.85 |
| Forward step share | (mostly reverse) | 78.0% |
| Stochastic training success | 93% | 99% |

Conclusion: this is the strongest result in the project and, unlike every prior
run, it is measured on fields the policy has never seen, so it is genuine
generalization rather than memorization of one arena. The stuck-in-contact failure
that dominated PPO_10-PPO_12 is effectively absent here (collision rate 0.11%,
mean longest streak 0.02, worst streak 2 steps), and the reverse-gait quirk is
gone: the robot walks forward (78% forward steps) to the goal.

Caveats on attribution (important, do not over-claim the collision fix):
- This run changed three environment variables at once (field size, obstacle
  count/randomization) and trained 3x longer (300k vs 100k), by explicit owner
  decision. So the dramatic collision drop cannot be attributed to any single
  cause.
- A larger field is inherently more open: with the same-size robot and obstacles
  spread across ~6x the area, there is simply more room to route around contact,
  which makes low collision rates easier independent of skill. Part of the 40% ->
  0.11% drop is this geometry, not only better avoidance.
- Single natural seed (364970). Like PPO_12, one seed cannot separate policy
  quality from seed luck.

Next decision: keep the larger randomized arena as the new baseline world; it is
a better generalization test and the policy clearly handles it. To make the result
trustworthy and to understand what drove it, the recommended follow-ups, one
controlled change at a time, are: (1) replicate PPO_13 on two more natural seeds
(three total) and compare on the same fixed-seed evaluation; (2) to isolate how
much of the collision drop is open-field geometry versus skill, run a variant that
restores the original obstacle density (more obstacles for the larger area) with
everything else at PPO_13 settings. Record each in this ledger.

## PPO_12 decoupled-collision-response experiment

- Date: 2026-08-19
- Status: complete
- Parent: PPO_11 configuration; starts from a completely fresh model
- Reason: across three seeds PPO_11 confirmed the rays work but left the
  stuck-in-contact failure unsolved (collision rates up to 43%, mean longest
  collision streaks of 90-112 steps, episodes reaching a ~400-step streak). The
  cause is the collision rule: a blocked step rejected translation and rotation
  together, so a touching deterministic policy re-issued the same rejected action
  and looped until timeout.
- Behavioral change (the only learning-related change): when the combined
  turn-and-move is blocked, resolve the two independently. First rotate in place
  if the turned pose alone is collision-free, then translate along the resolved
  facing if that alone is collision-free. This lets a wedged robot turn or reverse
  out of contact. The collision flag and its -0.18 penalty still reflect the full
  intended move, so reward semantics are identical to PPO_11.
- Unchanged: signed `[-1, 1]` throttle and `[-1, 1]` turn, the 18-value
  observation with eight rays, arena, target, spawning, five obstacles, 19
  collision points, movement and turning speeds, 400-step limit, reward formula
  and amounts, eight environments, all PPO hyperparameters, 8,192-transition
  rollout, and the 10,000-step evaluation/checkpoint interval.
- Seeding: per the owner's decision, training no longer fixes seed 7. Each run
  uses a fresh natural random seed, recorded in `training_config.json`. The
  100-episode deterministic evaluation still uses fixed seeds from 10,000, so the
  comparison against PPO_11 remains the same exam.
- This changes only physics, not the observation size, so it does not by itself
  invalidate PPO_11's policy shape, but PPO_12 still starts fresh because the
  world dynamics it learns against are different.
- Smoke command: `python train_rl.py --timesteps 20000 --seed <random> --run-name PPO_12_SMOKE --artifact-dir rl_artifacts/ppo_12_collision_recovery_smoke`
- Main command: `python train_rl.py --timesteps 100000 --seed <random> --run-name PPO_12 --artifact-dir rl_artifacts/ppo_12_collision_recovery_100k`
- Decision rule: judge against PPO_11 primarily on collision step rate, mean and
  worst collision streak, and deterministic success. The fix succeeds if collision
  streaks shrink and deterministic success rises or holds.

The isolated 20,000-step smoke test collected 24,576 steps under run name
`PPO_12_SMOKE` (natural seed 6123), NaN-free, and is stored in
`rl_artifacts/ppo_12_collision_recovery_smoke/`. It is a technical verification
only. The main run collected 106,496 steps under natural seed 53054 with an empty
stderr log, 456 completed training episodes, and no NaN in evaluation, stored in
`rl_artifacts/ppo_12_collision_recovery_100k/`.

### PPO_12 final result and comparison

Deterministic values use the same fixed seeds from 10,000. PPO_11 is shown as its
three-seed spread (seeds 7 / 11 / 23) so PPO_12's single natural-seed run can be
placed against the range rather than one lucky point.

| Deterministic metric | PPO_11 (7 / 11 / 23) | PPO_12 (natural) |
|---|---|---:|
| Success rate | 69% / 54% / 39% | 65% |
| Timeout rate | 31% / 46% / 61% | 35% |
| Mean reward | +12.96 / -1.70 / -10.48 | +6.09 |
| Mean net target progress | 22.79 / 19.57 / 14.93 | 21.45 |
| Collision rate | 24.50% / 42.92% / 42.08% | 40.47% |
| Mean longest collision streak | 31.54 / 92.66 / 111.99 | 62.78 |
| Worst collision streak | 400 / 399 / 400 | 400 |
| Average episode length | 163.64 / 219.00 / 270.79 | 174.46 |
| Stochastic training success | 83% / 88% / 93% | 93% |

Conclusion: the escape mechanic works and is proven in the unit tests
(`tests/test_ppo12_collision_recovery.py`): a wedged robot now rotates or reverses
out of contact instead of freezing. Its effect on the trained policy is a modest,
real improvement rather than a knockout. Deterministic success (65%) sits at the
strong end of PPO_11's spread and clearly above PPO_11's seed average (about 54%),
with a short average episode length (174 steps) showing the robot reaches the goal
and finishes. The mean longest collision streak (62.78) is far below PPO_11's
worse seeds (92.66, 111.99), i.e. typical jams are shorter.

But the deterministic collision rate did not fall (40.47%), and one episode still
reached a full 400-step streak. Part of the high collision rate is a measurement
artifact: the collision flag marks any blocked intended move even when the robot
then successfully rotates or reverses, so a policy that slides along an obstacle
edge while still progressing registers a collision every step. The remaining real
failure is that avoiding contact is a different skill from escaping it, and the
unchanged -0.18 penalty leaves the policy willing to grind past obstacles.

Caveat: this is a single natural-seed run against PPO_11's three seeds. Because
PPO_11 seed 7 alone also reached 69%, one PPO_12 seed cannot cleanly separate the
fix's contribution from seed variation for the success number; the trustworthy
evidence for the fix is the shorter mean jam length and the unit-tested escape
behavior, not the headline success percentage.

Next decision: keep the decoupled collision response permanently; it is a sound
mechanic that strictly gives the robot more ways out and never freezes a pose that
a sub-move could clear. It did not by itself drive collisions down, so the next
single controlled experiment should target contact avoidance directly. The
cleanest candidate is a reward change (PPO_13): raise the collision penalty so
grinding along obstacles costs more, keeping rays, the decoupled physics, PPO
settings, and rollout size unchanged. An alternative single change is denser or
longer-range rays so the policy sees narrow gaps between beams. Test only one.

## PPO_11 obstacle-clearance ray-vision experiment

- Date: 2026-08-19
- Status: complete
- Parent: PPO_10 configuration; starts from a completely fresh model
- Reason: PPO_10 fixed the deterministic freeze but still spent 38.87% of steps
  in collision with a worst streak of 399, because the policy had no sensor for
  obstacles ahead. It could only feel a collision after it happened via the
  single `last_collision` bit. This run gives it forward-looking sight.
- Observation change: the observation grows from 10 to 18 values. Indices 0-9 are
  the exact PPO_10 observation, unchanged. Indices 10-17 are eight rangefinder
  rays cast every 45 degrees around the current facing (ray 0 straight ahead),
  each reporting the clear distance to the nearest obstacle or wall, divided by
  `RAY_MAX_RANGE = 12.0` and clipped to `[0, 1]`; 1.0 means nothing within range.
- We do not tell the policy to avoid obstacles. It only gains the sensor values;
  the unchanged `-0.18` collision penalty and progress reward supply the incentive
  and PPO must learn the avoidance behavior itself.
- Unchanged: signed `[-1, 1]` throttle and `[-1, 1]` turn, arena, target,
  spawning, five obstacles, 19 collision points, combined movement-and-rotation
  rejection, movement and turning speeds, 400-step limit, reward formula and
  amounts, eight environments, all PPO hyperparameters, 8,192-transition rollout,
  seed 7, and 10,000-step evaluation/checkpoint interval.
- Adding sensors to the observation invalidates every earlier trained policy. A
  PPO_10 model wired for 10 inputs cannot be loaded into PPO_11's 18-input policy;
  PPO_11 must start fresh. Do not load PPO_8, PPO_9, or PPO_10 as a starting point.
- Requested steps: 100,000 (expected collection: 106,496 because PPO completes
  full 8,192-transition rollouts)
- Smoke command: `python train_rl.py --timesteps 20000 --run-name PPO_11_SMOKE --artifact-dir rl_artifacts/ppo_11_ray_vision_smoke`
- Main command: `python train_rl.py --timesteps 100000 --run-name PPO_11 --artifact-dir rl_artifacts/ppo_11_ray_vision_100k`
- Artifact directory: `rl_artifacts/ppo_11_ray_vision_100k/`
- Decision rule: judge against PPO_10 primarily on collision step rate, mean and
  worst collision streak, and deterministic success. Extend or add seeds only if
  the rays clearly reduce collisions or raise deterministic success.

The isolated 20,000-step smoke test collected 24,576 steps under run name
`PPO_11_SMOKE`. Its populated progress and diagnostic CSVs (60 rows each), model,
checkpoints, TensorBoard event, replay, logs, and NaN-free final evaluation are
stored in `rl_artifacts/ppo_11_ray_vision_smoke/`. It confirmed the 18-value
observation passes Gymnasium's checker and already reached 20% deterministic
success; it is a technical verification only and is not the experimental result.

The main run completed 106,496 steps, the expected whole-rollout total. Its 10
checkpoint models, 459 completed training episodes, final model, replay, progress
files, full console logs, TensorBoard event, exact configuration, and final
evaluation are in `rl_artifacts/ppo_11_ray_vision_100k/`. The stderr log is empty,
and the evaluation and both CSV files contain no NaN values.

### PPO_11 final result and controlled comparison

All deterministic values below use the fixed seeds beginning at 10,000, the same
100-episode procedure used for PPO_8, PPO_9, and PPO_10. PPO_11 is the final
fresh model after PPO completed its requested 100k run at 106,496 collected steps.

| Deterministic metric | PPO_10 signed throttle | PPO_11 ray vision |
|---|---:|---:|
| Success rate | 5% | 69% |
| Timeout rate | 95% | 31% |
| Mean reward | -28.0351 | +12.9552 |
| Mean net target progress | 6.2933 | 22.7891 |
| Stopped steps | 0% | 0.1100% |
| Forward steps | 54.6371% | 19.6529% |
| Reverse steps | 45.3629% | 80.2371% |
| Mean signed throttle | 0.11636 | -0.17218 |
| Mean absolute throttle | 0.36975 | 0.35474 |
| Collision rate | 38.8746% | 24.4989% |
| Mean longest collision streak | 49.44 | 31.54 |
| Worst collision streak | 399 | 400 |
| Average episode length | 381.92 | 163.64 |
| Mean distance reward | +1.25867 | +4.55783 |
| Mean time reward | -3.81920 | -1.63640 |
| Mean collision reward | -26.72460 | -7.21620 |
| Mean goal reward | +1.25 | +17.25 |

The latest 100 stochastic training episodes reached 83% success with 26.2070 units
of mean net target progress, mean reward 20.6941, average length 166.31 steps,
collision rate 12.1400%, mean longest collision streak 3.52, and worst streak 32.
This stochastic success is reported separately and is not treated as evidence of
deterministic deployment quality, though here the two agree that the run works.

Conclusion: adding forward-looking sight was the decisive change. With eight rays,
the deterministic policy reached 69% success — the best in this project's history,
and higher than the body-only PPO_2 (60%) in the harder 19-point-collision arena.
Collision rate fell from 38.87% to 24.50%, mean longest collision streak from
49.44 to 31.54, and average episode length from 381.92 to 163.64, meaning the
robot now reaches the target and ends the episode rather than timing out. It
learned to keep its rays clear and steer around obstacles it can now perceive
before contact, which it never had a sensor for in PPO_8 through PPO_10.

Two honest caveats. First, the policy settled on a mostly-reverse gait (mean
signed throttle -0.17, 80.24% reverse steps): backing toward the target scores as
well as facing it, and PPO committed to it. This is a cosmetic quirk, not a
failure, because net progress is strongly positive. Second, 31% of episodes still
time out and one episode still reached a 400-step collision streak, so obstacle
recovery is improved but not solved.

Next decision: PPO_11 clearly passes the gate — deterministic success rose from 5%
to 69% with fewer collisions from a single controlled change. The recommended next
work is to confirm robustness with two additional fresh 100,000-step runs at
different seeds (three seeds total), changing only the seed and using distinct run
names and artifact directories. Do not change reward, sensors, collision response,
PPO settings, or rollout size for that replication. If the sensors repeat across
seeds, a longer or randomized-arena run becomes justified. A randomized-obstacle
or larger arena should not be attempted before sensors are confirmed, because the
earlier blind observation could only avoid obstacles by memorizing this one arena.

### PPO_11 seed replication

- Status: complete
- Purpose: confirm the 69% deterministic result is the sensor, not seed-7 luck
- Change from PPO_11: only the training seed. Reward, observation (18 values with
  eight rays), collision response, PPO settings, and 8,192-transition rollout are
  identical. The 100-episode deterministic evaluation still uses fixed seeds from
  10,000, so all three seeds sit the same exam.
- Runs: `PPO_11_S11` (seed 11, `rl_artifacts/ppo_11_ray_vision_seed11_100k/`) and
  `PPO_11_S23` (seed 23, `rl_artifacts/ppo_11_ray_vision_seed23_100k/`). Both
  collected 106,496 steps with empty stderr and no NaN in evaluation.

| Deterministic metric | Seed 7 (PPO_11) | Seed 11 | Seed 23 |
|---|---:|---:|---:|
| Success rate | 69% | 54% | 39% |
| Timeout rate | 31% | 46% | 61% |
| Mean reward | +12.9552 | -1.6964 | -10.4816 |
| Mean net target progress | 22.7891 | 19.5682 | 14.9277 |
| Collision rate | 24.4989% | 42.9224% | 42.0769% |
| Mean longest collision streak | 31.54 | 92.66 | 111.99 |
| Worst collision streak | 400 | 399 | 400 |
| Average episode length | 163.64 | 219.00 | 270.79 |
| Reverse steps | 80.24% | 65.91% | 58.53% |
| Stochastic training success | 83% | 88% | 93% |

Read: two findings, both important.

1. The ray sensor is confirmed, decisively. All three seeds tower over the blind
   PPO_10 baseline (5% deterministic, 0-10% stochastic). Stochastic training
   success is high and tight across seeds (83%, 88%, 93%), and deterministic
   success is 39-69% versus 5%. The jump is the sensor, not seed-7 luck.

2. But the collision-recovery failure is not solved, and it is seed-sensitive.
   Deterministic success spans 39-69% (mean about 54%), and seeds 11 and 23 spend
   about 43% of steps colliding with mean longest streaks of 92 and 112 steps.
   Seed 7 was the luckiest on collisions (24.5%), which flattered the first
   result. Every seed still has episodes that reach a ~400-step collision streak.

The gap between high stochastic success and lower, variable deterministic success
is the known mechanism: a collision rejects both translation and rotation, so a
deterministic policy that faces an obstacle re-issues the same rejected action and
loops until timeout, while stochastic exploration noise escapes. The rays let the
robot avoid many obstacles, but once it is stuck against one it still cannot
reliably turn out of contact.

Next decision: keep the rays permanently; they are a proven win. Do not extend
this exact configuration to 300k and do not move to a randomized or larger arena
yet, because the unsolved stuck-in-contact behavior would dominate there. The next
single controlled experiment is the one the ledger already anticipated: resolve
rotation and translation collisions independently so a touching robot can still
turn or reverse out of contact. Keep the rays, reward, PPO settings, and rollout
size unchanged for that test and change only the collision response. Re-run the
same three seeds afterward and compare collision rate, mean and worst collision
streak, and deterministic success.

## PPO_10 signed-throttle experiment

- Date: 2026-08-12
- Status: complete
- Parent: PPO_9 configuration; starts from a completely fresh model
- Reason: isolate whether PPO's asymmetric forward action and clipping at zero
  caused the deterministic freeze strategy
- Action change: forward throttle becomes signed `[-1, 1]`; negative means
  reverse, zero means stop, and positive means forward. Turning remains `[-1, 1]`.
- Unchanged: 10-value PPO_9 observation, arena, target, spawning, five obstacles,
  19 collision points, combined movement-and-rotation rejection, movement and
  turning speeds, 400-step limit, reward formula and amounts, eight environments,
  all PPO hyperparameters, 8,192-transition rollout, seed 7, and 10,000-step
  evaluation/checkpoint interval
- Requested steps: 100,000 (expected collection: 106,496)
- Command: `python train_rl.py --timesteps 100000 --run-name PPO_10 --artifact-dir rl_artifacts/ppo_10_signed_throttle_100k`
- Artifact directory: `rl_artifacts/ppo_10_signed_throttle_100k/`
- Decision rule: extend only if deterministic success exceeds zero or fixed-seed
  deterministic target progress is clearly and consistently improving

Changing the action space invalidates every older trained policy. PPO_8 and
PPO_9 models cannot be loaded into PPO_10 or treated as compatible starting
points.

The isolated 20,000-step smoke test collected 24,576 steps under run name
`PPO_10_SMOKE`. Its populated progress and diagnostic CSVs, model, checkpoints,
TensorBoard event, replay, logs, and NaN-free final evaluation are stored in
`rl_artifacts/ppo_10_signed_throttle_smoke/`.

The main run completed 106,496 steps, the expected whole-rollout total. Its
10 checkpoint models, 297 completed training episodes, final model, replay,
progress files, full console logs, TensorBoard event, exact configuration, and
final evaluation are in `rl_artifacts/ppo_10_signed_throttle_100k/`. The stderr
log is empty, and the evaluation and both CSV files contain no NaN values.

### PPO_10 final result and controlled comparison

All deterministic values below use the fixed seeds beginning at 10,000. PPO_8
and PPO_9 are their documented same-seed 100k checkpoint comparisons; PPO_10 is
the final fresh model after PPO completed its requested 100k run at 106,496
collected steps.

| Deterministic metric | PPO_8 at 100k | PPO_9 at 100k | PPO_10 signed throttle |
|---|---:|---:|---:|
| Success rate | 0% | 0% | 5% |
| Timeout rate | 100% | 100% | 95% |
| Mean reward | -6.8566 | -6.8530 | -28.0351 |
| Mean net target progress | -0.00008 | 0 | 6.2933 |
| Stopped steps | 99.9875% | 100% | 0% |
| Forward steps | 0.0125% | 0% | 54.6371% |
| Reverse steps | 0% | 0% | 45.3629% |
| Mean signed throttle | 0.00000068 | 0 | 0.11636 |
| Mean absolute throttle | 0.00000068 | 0 | 0.36975 |
| Collision rate | 3.9675% | 3.9625% | 38.8746% |
| Mean longest collision streak | 15.87 | 15.84 | 49.44 |
| Worst collision streak | 400 | 400 | 399 |
| Average episode length | 400 | 400 | 381.92 |
| Mean distance reward | -0.00002 | 0 | +1.25867 |
| Mean time reward | -4.00 | -4.00 | -3.81920 |
| Mean collision reward | -2.8566 | -2.8530 | -26.72460 |
| Mean goal reward | 0 | 0 | +1.25 |

The latest 100 stochastic training episodes reached 34% success with 16.1391
units of mean net target progress. Their mean reward was -0.4840, average length
330.54 steps, and collision rate 14.9694%. This stochastic success is reported
separately and is not used as evidence that deterministic deployment is solved.

Conclusion: allowing reverse movement fixed the literal freeze strategy. The
deterministic policy used both directions on every evaluated step, reached 5%
success, and made meaningful average target progress. It learned locomotion and
some target approach, but not reliable obstacle recovery: collision cost and
long collision streaks dominate its deterministic reward.

Next decision: PPO_10 passes the stated gate because deterministic success is
above zero, but one seed and 5% success are too weak to justify a 300k extension.
First repeat this exact 100k configuration with two additional seeds, producing
three comparable seeds in total. If signed throttle had failed, the next single
controlled experiment would have been to resolve rotation and translation
collisions independently so a touching robot could turn or reverse out of
contact, while leaving reward, observations, PPO settings, and rollout size
unchanged.

## PPO_8 diagnosis

A read-only evaluation over 100 fixed-seed episodes found:

- 100 deterministic failures ended by the 400-step timeout; collisions never terminate an episode.
- Deterministic throttle was zero on 98.85% of evaluated steps, and 99.85% of steps produced no displacement.
- Deterministic collision rate was 4.99% overall, but this came from only 5 episodes becoming stuck in repeated leg collisions. The other episodes mostly stood still.
- Average deterministic failed-episode reward: distance shaping `-0.001`, time `-4.00`, collision `-3.591`, goal `0`, total `-7.592`.
- In stochastic failed episodes, collision rate was 36.85%. Average reward: distance shaping `+0.844`, time `-4.00`, collision `-26.533`, goal `0`, total `-29.689`.
- A collision rejects both movement and rotation. A deterministic policy then sees the same observation and can repeat the same collision until timeout.
- The target is reachable: a typical spawn needs about 39–43 full-speed straight steps, the worst of 10,000 sampled spawns needed 70, and the episode limit is 400.

Conclusion: PPO_8 is not limited by episode length or by an insufficient terminal bonus. More training with the same setup is unlikely to escape the learned zero-throttle/collision-avoidance strategy.

## PPO_9 diagnostic result

- Status: complete; do not continue to 300k without a new decision
- Parent: PPO_8
- Requested steps: 100,000 (expected collection: 106,496 because PPO completes full rollouts)
- Seed: 7
- Behavioral change: observation grows from 7 to 10 values
- New values: last collision, previous forward action, previous turn action
- Reset behavior: all three new values reset to zero
- Unchanged: arena, target, five obstacles, movement, turn rate, timestep,
  episode limit, collision decisions, 19 collision points, reward, and every PPO
  hyperparameter
- Monitoring only: per-episode diagnostic CSV and the latest three real PPO
  rollout buffers, each split into eight workers and episode segments
- Required comparison: deterministic zero throttle, longest collision streak,
  collision rate, net target progress, success rate, and reward breakdown versus
  PPO_8 at 100k

Same-seed deterministic comparison over 100 episodes using each run's 100k
checkpoint:

| Metric | PPO_8 at 100k | PPO_9 at 100k |
|---|---:|---:|
| Success rate | 0% | 0% |
| Timeout rate | 100% | 100% |
| Zero-throttle steps | 99.9875% | 100% |
| Mean throttle | 0.00000068 | 0 |
| Collision steps per episode | 15.87 | 15.85 |
| Collision step rate | 3.9675% | 3.9625% |
| Mean longest collision streak | 15.87 | 15.84 |
| Worst collision streak | 400 | 400 |
| Mean net target progress | -0.00008 units | 0 units |
| Mean distance reward | -0.00002 | 0 |
| Mean time reward | -4.00 | -4.00 |
| Mean collision reward | -2.8566 | -2.8530 |
| Mean total reward | -6.8566 | -6.8530 |

The stochastic training policy reached a 10% rolling success rate near the end,
but the deterministic policy still chose zero forward throttle everywhere. The
new collision memory did not improve the frozen-policy failure at 100k. This
isolates the next likely issue: PPO's asymmetric `[0, 1]` throttle action is
still being clipped to zero. PPO_9 should remain a completed diagnostic rather
than being extended unchanged.

## Where the logs are stored

Each new run uses its own directory selected with `--artifact-dir`. PPO_10's
completed main directory contains:

```text
rl_artifacts/ppo_10_signed_throttle_100k/
  training_stdout.log       console and evaluation output
  training_stderr.log       Python warnings and errors
  training_progress.csv     reward for every completed training episode
  training_diagnostics.csv  movement, collision, progress, and reward details
  training_progress.png     reward and evaluation plots
  final_evaluation.json      fixed-seed deterministic and stochastic summaries
  training_config.json       exact run configuration
  browser_replay.json        archived visualizer data
  leaper_ppo.zip             final PPO_10 policy
  checkpoints/              policy snapshot every 10,000 steps
  tensorboard/PPO_10_1/      detailed PPO metrics
public/
  rl_live_state.json        latest live evaluation and rollout replay frames
```

Historical archives currently include:

```text
rl_artifacts/body_only_run/
rl_artifacts/leg_collision_freeze_run/
rl_artifacts/pre_potential_reward_run/
rl_artifacts/time_decaying_goal_run/
rl_artifacts/ppo_8_collision_unaware_run/
rl_artifacts/ppo_9_collision_awareness_100k/
rl_artifacts/ppo_10_signed_throttle_smoke/
rl_artifacts/ppo_10_signed_throttle_100k/
rl_artifacts/ppo_11_ray_vision_smoke/
rl_artifacts/ppo_11_ray_vision_100k/
rl_artifacts/ppo_11_ray_vision_seed11_100k/
rl_artifacts/ppo_11_ray_vision_seed23_100k/
rl_artifacts/ppo_12_collision_recovery_smoke/
rl_artifacts/ppo_12_collision_recovery_100k/
```

The PPO_8 archive contains its final model, per-episode CSV, graph, console logs,
complete browser replay JSON, all 10k model checkpoints, and its TensorBoard
event file. It is the immutable comparison baseline for PPO_9.

Launch TensorBoard with `tensorboard --logdir rl_artifacts` to see PPO_1 through
PPO_10. PPO_8 and PPO_9 events also exist in their immutable archive folders, so
an explicit `--logdir_spec` may be used when a duplicate-free named list matters.

These generated files are intentionally excluded from Git, but they remain on this computer unless manually deleted.

## What to change when increasing training

- Increase **total timesteps** only after a change repeats across seeds and its
  deterministic success or target progress is still improving. For PPO_10,
  first run two additional fresh 100k seeds with no other changes; do not jump
  directly from the seed-7 result to 300k.
- Do not increase `n_steps` just to make training longer. It changes how much experience PPO collects before each update. Current `1024 × 8 = 8192` already covers multiple 400-step episodes per update.
- If testing rollout size later, compare one controlled change at a time: `512` gives 4,096 transitions and more frequent/noisier updates; `2048` gives 16,384 transitions and less frequent/more stable updates with higher memory use.
- Increasing the 25 evaluation episodes or five visualizer recordings improves measurement confidence or replay variety; it does not provide more learning experience.
- Never compare raw reward between runs without recording reward changes. A new reward scale can make the number look better or worse without improving behavior.

## Template for the next run

Copy this section for every future run:

```text
Run ID / TensorBoard name:
Date and time:
Status: planned | running | stopped | complete
Parent run:
Reason for the run:

Environment changes:
Observation changes:
Action or physics changes:
Reward changes:
PPO/hyperparameter changes:

Command:
Requested timesteps:
Actual collected timesteps:
Seed:

Final deterministic mean reward:
Final deterministic success rate:
Training-rollout success rate:
Average episode length:
Collision rate:
Reward breakdown:

Artifact/archive directory:
Conclusion:
Next decision:
```

## 2026-09-09: controlled seeker research campaign

Owner requested single-run experiments (no multi-seed repetitions), complete metrics,
TensorBoard, clear explanations, and progress toward >90% deterministic arrival.
The live ledger is [docs/SEEKER_RUN_LOG_2026-09-09.md](docs/SEEKER_RUN_LOG_2026-09-09.md).
Exact settings, seed123953224, donor SHA-256, code snapshots, imported runtime,
per-episode data and checkpoints live under `rl_artifacts/seeker_20260909/`.

The original PPO35s1 donor scores74% arrival /88% discovery on the separate200-maze
development set. Completed253,952-transition continuations: control72.5%/90.5%,
new-visible-space reward76%/87.5%, visitation-reward removal78%/89.5%.
Active ICM finished76.5%/89.5%, versus removal's78%/89.5%; its bonus did not improve
the completed comparison. These are deterministic scores, not stochastic
training success. After completing all six arms, selection was frozen in
`rl_artifacts/seeker_20260909/screen_selection.json`: removal at 253,952 transitions.
On confirmation seeds 80000–80999, the frozen selected model reaches **80.7% arrival**
versus **75.8%** for its equal-budget control. Discovery is 91.2% versus 91.3%, and
arrival conditional on discovery is 88.5% versus 83.0%. The paired arrival gain is
4.9 percentage points (95% maze-bootstrap interval +2.7 to +7.1). These outcomes
were unavailable at selection. The interval concerns these fixed policies, not
training-seed variability. The >90% target remains unmet.

The new tooling is isolated under `rl/`, using34 observations (31 donor inputs plus
three actual-motion values). The 50-input full-footprint sensor follow-up finished
at 76.5% arrival / 85.5% discovery: better conversion after discovery, but more
freezing during search. The independent 36-input stall-counter memory run finished
at 74.5% arrival / 89.5% discovery. Both kept physics and original control rewards.
No new LSTM was trained in this six-arm screen. The production browser brain is not replaced. The viewer
now identifies which saved experiment its deterministic replay represents.

Important diagnosis:47/52 baseline failures are stuck/frozen, and local action
probes find movement alternatives in failed poses. Old body-center rays can show
clearance while distal leg samples block. Reward removal currently has the strongest
completed arrival result; discovery gains alone do not imply successful pursuit.

## September 9: new owner requirement — train from scratch

All new comparisons now start from random weights, empty optimizers and zero
steps. The warm round-two queue was stopped after partial continuation (188,416
last reported steps; 106,496 saved checkpoint). It is not a scratch experiment.
The first-round 80.7% remains explicitly a fine-tuning result.

Six scheduled scratch configurations are active/queued under `rl_artifacts/seeker_scratch_lr_20260909/`:
original_mlp, removal_mlp, residual_lstm, residual_mlp, history_mlp, recovery_reward.
Each healthy run has a 507,904-step initial budget; the owner additionally authorizes
justified longer training and further experiments based on failure/learning evidence.
One training seed per configuration persists. No moving target is introduced.
The parallel MLP/LSTM and matched feedforward policies have 72,517 and 73,637
parameters; 9 policy, 7 recurrent trainer, and 3 scratch-initialization checks pass.
See `docs/SEEKER_SCRATCH_RUN_LOG_2026-09-09.md` for the current protocol and results.

Owner subsequently required explicit learning-rate decay: linear 0.00015 → 0.000015,
shared by PPO and recurrent PPO, with real optimizer-rate tests. The two constant-rate
scratch runs stopped at saved 253,952-step models during evaluation and are archived
under `seeker_scratch_20260909`; they are not scheduled-screen results. The new runs
restart from the same random seed, not those checkpoints. `AGENTS.md` records the
schedule and hyperparameter audit requirements.

### Scheduled scratch architecture results (507,904 steps)

Same200-maze development exam: original MLP29% arrival/73.5% discovery;
removal27.5%/60.5%; residual MLP37%/72.5%; residual LSTM46.5%/82%.
The LSTM recovered from14.5% at253952 and is the best completed scratch policy.
History and contact-refund runs are ongoing; no confirmation exam opened.
New runs evaluate approximately every50k steps. Paired same-scratch-model extensions
to2,031,616 total steps are prepared, not launched: optimizer continuity verified,
LR0.000015->0.000003, fresh seeded episodes at the continuation boundary. Full
details and all checkpoint results: docs/SEEKER_SCRATCH_RUN_LOG_2026-09-09.md.
