# Leaper RL — Session Run Log: PPO_23 → PPO_26

**Project:** Leaper (hexapod target-reaching agent, PPO / Stable-Baselines3)
**Goal:** ≥ 85% success on the fixed 100-maze exam.
**This session's outcome:** target met and confirmed — **PPO_25 = 91–93%**, reliable across seeds.

---

## How every run is graded (methodology)

| Test | What it is | Mazes | Purpose |
|---|---|---|---|
| **Training** | Fresh random maze every episode (51 obstacles, 187.5-wide field) | thousands, unique | Forces general navigation, not memorization |
| **100-maze exam** | Fixed held-out mazes, seeds `10000–10099` | 100 | The comparable score of record; identical for every run |
| **1,000-maze stress test** | Fresh held-out mazes, seeds `50000–50999` | 1,000 | Tightens the confidence interval; rules out luck on the 100 |
| **Parallel seed replication** | Same recipe, N runs, different random seeds | 3–4 runs | Measures *reliability*, not just a single lucky run |

- Training seeds are natural random per run; the exam seeds are fixed so cross-run comparison stays fair.
- A single run is one *sample*. Because scores vary seed-to-seed, a claim is only trusted after seed replication.
- Deployment ships the single best trained model; reliability tells us whether that best is repeatable.

### Definitions (for readers of this log)

**The 100-maze exam (the score of record).** A fixed set of 100 maze layouts
(random-generator seeds 10000–10099) that the robot never trains on. After
training, the robot attempts all 100 and its score is the percentage it solves
before the time limit. The same 100 mazes are used for every run, so scores are
directly comparable across experiments. Because these mazes are held out from
training, a high score reflects genuine navigation skill, not memorization.
Caveat: 100 is a modest sample, so the true skill sits within roughly ±5
percentage points of the reported number.

**The 1,000-maze stress test (the confidence check).** A larger set of 1,000
fresh maze layouts (seeds 50000–50999), entirely separate from the 100-maze exam.
Used to pin down the true skill level: a much bigger sample shrinks the
uncertainty from about ±5 points to about ±1.7 points, and because these layouts
are also never-before-seen, a matching score confirms the robot learned to
navigate in general rather than memorizing the 100-maze set.

**Seed.** The arbitrary starting value for a run's random-number generator. It
fixes every random choice in that run (maze order, initial network weights), so
quoting a seed makes the run exactly reproducible. Training uses a fresh random
seed each run; the exam seeds are held fixed so comparisons stay fair. A seed is
an identifier, not a score.

---

## Starting point — PPO_23 (entered this session as champion)

- **Config:** 16 vision rays across a 270° forward cone, range 28, forward-only movement, 64×64 network, stuck rule, dense 51-obstacle arena.
- **The known problem:** high variance. Four seeds scored **86 / 73 / 87 / 80 → mean 81.5%**. Deployable best = seed 965726 = **87%**.
- **Root cause identified:** a *decisiveness lottery* — some seeds train **bold** (keep moving, ~86–92% forward-step, clear 85%); others train **timid** (dither/stop, ~50% forward-step, drop to 73–80%). Same recipe, different nerve.
- **This session's mission:** raise the whole distribution and kill the variance so *every* run clears 85%.

---

## PPO_24 — Longer sight *(dismissed)*

- **Changed:** vision range 28 → 45 (`--ray-max-range 45`). Nothing else.
- **Why:** hypothesis that bigger dead-ends would be spotted earlier, cutting timeouts.
- **Ran on:** 1 seed (245103), 500k steps, 100-maze exam.
- **Result:** **80%**, 20% timeout — mid-pack inside PPO_23's own 73–87% swing; the seed came out **timid** (55% forward).
- **Why it didn't work / verdict:** no signal — one sample lands inside existing noise, so longer range showed no benefit. Confirmed the blocker was **nerve, not eyes**. *(Fully retested and ruled out in PPO_26 below.)*

---

## PPO_25 — Anti-dither nerve fix ✅ **NEW CHAMPION**

- **Changed:** added an **idle penalty** — a small per-step reward tax on sustained standing-still.
  - `IDLE_PENALTY = 0.04` per step, applied only when throttle < `0.1` for more than `IDLE_GRACE = 3` consecutive steps (a brief pivot-in-place stays free).
  - New CLI flags `--idle-penalty` / `--idle-grace`; recorded in `training_config.json`.
- **Why:** the variance was a *decisiveness* effect, and standing still cost almost nothing (only the 0.01 time tax). Timid policies exploited that "safe to loiter" gap. The tax is sized deliberately: **above** the step penalty (0.01, so idling beats a normal step no longer) and **below** the collision penalty (0.18, so she never rams walls to avoid standing).
- **Range held at champion 28** on purpose — isolate one variable against the well-measured 81.5% baseline.
- **Ran on:** 4 seeds (1 lead + 3 parallel), 500k each, 100-maze exam + 1,000-maze stress test.

**Seed replication (parallel):**

| Seed | Success | Timeout | Forward% | Collision% |
|---|---|---|---|---|
| 102911 | 89% | 11% | 86% | 5.6% |
| 456047 | 92% | 8% | 99% | 3.0% |
| 703466 | 92% | 8% | 88% | 3.5% |
| **911743** | **93%** | **7%** | **99%** | **2.2%** |
| **Mean** | **91.5%** | — | all bold | low |

**Head-to-head vs PPO_23 (no idle penalty):**

| | PPO_25 (idle penalty) | PPO_23 (baseline) |
|---|---|---|
| Seeds | 89, 92, 93, 92 | 86, 73, 87, 80 |
| **Mean** | **91.5%** | 81.5% |
| Spread (variance) | **89–93 (4 pts)** | 73–87 (14 pts) |
| Seeds clearing 85% | **4 of 4** | 2 of 4 |
| Forward-step % | 86–99% (all bold) | 49–92% (lottery) |

- **Result:** two wins at once — the variance collapsed (14-pt → 4-pt spread, no timid runs left) **and** the mean jumped +10 points (81.5 → 91.5), with the *floor* (89%) now above target.
- **Generalization confirmed:** champion model graded on **1,000 fresh held-out mazes** = **91.3%** (95% CI 89.6–93.0%), vs 93% on the standard 100. Nearly identical on unseen layouts → genuine learning, not exam-overfit.
- **Verdict:** ✅ the session's win. **Deployable champion = seed 911743 = 93%** (`rl_artifacts/ppo_25_idle_s3/leaper_ppo.zip`) — the top of a tight, reliable cluster, not a lucky pick from a wide one.

---

## PPO_26 — Longer sight + nerve fix together *(dismissed)*

- **Changed:** range 28 → 45 **on top of** the PPO_25 idle penalty (the one untried combination).
- **Why:** last check for a gain hiding in longer sight once timidity was already fixed.
- **Ran on:** 3 parallel seeds, 500k each, 100-maze exam.

| Seed | Success | Timeout | Forward% |
|---|---|---|---|
| 782292 | 80% | 20% | 80% |
| 368918 | 84% | 16% | 70% |
| 934761 | 82% | 18% | 54% |
| **Mean** | **82%** | — | less bold |

- **Why it didn't work / verdict:** all 3 seeds landed **~9 points below** the range-28 champion and came out *more timid*. Longer range **hurts**: at range 45 nearly every ray hits distant clutter in the dense field, the open doorways stop reading as open, and near-field detail is compressed — so she hesitates. Confirms PPO_24's hint. **28 is the right range; range-45 door closed.**

---

## Final standing

| | Champion |
|---|---|
| **Run** | PPO_25, seed 911743 |
| **Recipe** | 16 rays · 270° cone · range 28 · forward-only · idle-penalty 0.04 / grace 3 · 64×64 net |
| **100-maze exam** | 93% |
| **1,000-maze stress test** | 91.3% (CI 89.6–93.0%) |
| **Reliability** | 4/4 seeds clear 85% (89–93) |
| **Model** | `rl_artifacts/ppo_25_idle_s3/leaper_ppo.zip` |

**Session summary:** the target was met by fixing *behavior*, not adding capacity or range. The last blocker was that standing still was free; taxing it made every run decisive. Two candidate levers (longer sight, more seeds) were tested and cleanly ruled out.
