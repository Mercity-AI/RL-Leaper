# Leaper RL experiment log — PPO_13 to PPO_16

Same format as `TRAINING.md` (see it for full tables and every number). This is a
focused log of the recent arc: take the trained robot into big **random** fields,
make them harder, and fix the "gets stuck grinding on a rock" freeze.

## Run history

| Run | Collected steps | Change from previous | Deterministic result | Outcome |
|---|---:|---|---|---|
| PPO_13 | 303,104 | Field 2.5x wider (WORLD_LIMIT 62.5), 10 obstacles randomized fresh every episode (was 5 fixed), episode cap 1000, 300k | 85% success, +31.66 reward, 0.11% collision | Best generalization result; but the field was open, so low collisions were partly geometry |
| PPO_14 | 303,104 | Hardened arena: WORLD_LIMIT 93.75, 51 obstacles, target moved SW to (-40,-10), reachability guarantee | 54% success, +3.38 reward, 15.87% collision, one 994-step wedge | Dense field brings the freeze back; confirms PPO_13's clean dodging was mostly open space |
| PPO_15 | 303,104 | Raised flat collision penalty -0.18 -> -0.5 (nothing else) | 51% success, 12.84% collision, forward 74%->46% | Not impressive: a bit less contact, but success flat and the robot turned timid; penalty reverted |
| PPO_16 | 303,104 | Stuck rule: 40 collide-and-no-progress steps -> terminal failure + one-time -10 penalty; bump fine back to -0.18 | 64% success, 1.35% collision, worst wedge 43 steps, forward 70% | The fix: best on the hard arena, freeze gone, not timid |

---

## PPO_13 — first generalization run (random fields)

- **Parent run:** PPO_12 configuration; fresh model.
- **Reason for the run:** rays were proven across seeds, so test whether the policy
  can handle fields it has never seen instead of one memorized arena.
- **Environment changes:** field 2.5x wider each side (WORLD_LIMIT 25 -> 62.5, target
  scaled to (45,45)); 10 obstacles randomized into a fresh layout every episode (was
  5 fixed); episode cap 400 -> 1000.
- **Observation / action / reward / PPO changes:** none (robot's brain unchanged).
- **Command:** `train_rl.py --timesteps 300000 --run-name PPO_13 --artifact-dir rl_artifacts/ppo_13_random_arena_300k` (natural seed 364970).
- **Final deterministic success / reward:** 85% / +31.66.
- **Collision rate / worst wedge:** 0.11% / 2 steps.
- **Forward-step share / avg episode length:** 78% / 236.85.
- **Training-rollout success:** 99%.
- **Artifact directory:** `rl_artifacts/ppo_13_random_arena_300k/`.
- **Conclusion:** strongest result yet and the first measured on unseen maps (real
  generalization). Caveat: three env changes at once + a single seed, and a bigger
  field is inherently roomier, so the near-zero collisions are partly geometry.
- **Next decision:** make the field harder/denser to see whether the low collision
  rate is skill or open space.

## PPO_14 — hard, dense, moved-target arena

- **Parent run:** PPO_13; fresh model.
- **Reason for the run:** stress the arena to test whether PPO_13's low collisions
  were real avoidance or just space, and make the task genuinely hard.
- **Environment changes:** WORLD_LIMIT 62.5 -> 93.75 (187.5-wide field); obstacles
  10 -> 51; target moved off-center to the south-west (-40,-10); target-plaza
  clearance tightened; flood-fill **reachability guarantee** added (re-rolls any
  layout that seals the goal in a pocket). Episode cap 1000, 300k steps.
- **Observation / action / reward / PPO changes:** none.
- **Command:** `train_rl.py --timesteps 300000 --run-name PPO_14 --artifact-dir rl_artifacts/ppo_14_sw51_300k` (natural seed 876919).
- **Final deterministic success / reward:** 54% / +3.38.
- **Collision rate / worst wedge / mean longest streak:** 15.87% / 994 steps / 67.18.
- **Forward-step share / avg episode length:** 74.4% / 510.76.
- **Training-rollout success:** 100%.
- **Artifact directory:** `rl_artifacts/ppo_14_sw51_300k/`.
- **Conclusion:** the dense field is much harder and brings the stuck-in-contact
  freeze back (one run wedged 994/1000 steps). So PPO_13's near-perfect dodging was
  substantially open space, not pure skill. Contact avoidance is the real problem.
- **Next decision:** attack the freeze directly.

## PPO_15 — flat collision penalty raise (condensed; not impressive)

- **Change:** the only lever moved was the collision penalty, -0.18 -> -0.5 per
  step; arena and everything else identical to PPO_14. Natural seed 889404.
- **Result:** 51% success (flat vs PPO_14's 54%); contact down modestly (15.87% ->
  12.84%) but the robot turned **timid** (forward 74% -> 46%) and one run still
  wedged 990 steps.
- **Verdict:** a bigger flat fine buys caution, not smarter navigation, and does not
  fix the freeze. Penalty reverted to -0.18. This motivated the PPO_16 design.
- **Artifact directory:** `rl_artifacts/ppo_15_collision_penalty_300k/`.

## PPO_16 — the stuck rule (the fix)

- **Parent run:** PPO_14 arena; PPO_15's penalty reverted. Fresh model.
- **Reason for the run:** the freeze is a deterministic re-issue-of-a-blocked-move
  loop. Owner insight: ending an episode early is not itself a punishment, so a bare
  early-stop could even reward quitting; it needs an explicit failure penalty.
- **Reward / physics change (the one lever):** a **terminal stuck-failure** — if the
  robot collides with no forward progress for `STUCK_LIMIT = 40` consecutive steps,
  end the episode as a true terminal failure (not a truncation) with a one-time
  `STUCK_PENALTY = 10`. Collision penalty back to -0.18. Everything else identical.
- **Command:** `train_rl.py --timesteps 300000 --run-name PPO_16 --artifact-dir rl_artifacts/ppo_16_stuck_rule_300k` (natural seed 489429).
- **Final deterministic success / reward:** 64% / (reward not comparable across the
  reward change).
- **Collision rate / worst wedge / mean longest streak:** 1.35% / 43 steps / 3.66.
- **Forward-step share / avg episode length:** 70.0% / 366.82.
- **Training-rollout success:** 94%.
- **Artifact directory:** `rl_artifacts/ppo_16_stuck_rule_300k/`.
- **Conclusion:** the decisive win and best result on the hard arena. The freeze is
  gone by construction (worst wedge 994 -> 43) and, more importantly, the policy
  learned to **avoid** dead-ends (collision 15.87% -> 1.35%), with success up to 64%
  and forward driving healthy at 70% (no timidity). Pairing the early end with an
  explicit terminal penalty is what taught "getting wedged is the worst outcome."
- **Next decision:** keep the stuck rule permanently. Remaining gap is the 36%
  timeout rate. Candidates (one at a time): replicate on 2 more seeds to confirm
  64%; tune STUCK_LIMIT / STUCK_PENALTY; richer/longer rays or more training to cut
  timeouts.

---

## Keepers (permanent, don't drift without a recorded decision)
- **Rays** (PPO_11) — obstacle vision; the biggest single win.
- **Decoupled collisions** (PPO_12) — a touching robot can rotate/reverse out.
- **Stuck rule** (PPO_16) — terminal failure + penalty when wedged.
- **Randomized arena** (PPO_13+) — fresh obstacle layout every episode with a
  reachability guarantee (PPO_14+).
