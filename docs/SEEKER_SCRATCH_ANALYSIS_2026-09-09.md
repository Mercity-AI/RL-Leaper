# Seeker scratch analysis — 9 September 2026

Recommend **three focused comparisons across six configurations**: establish the reward baseline from scratch; test parallel MLP+LSTM against capacity and finite-history controls; test whether charging successful collision recovery discourages escape. Contact-action selection is the strongest failure signal. More curiosity, larger sensors, and a broad hyperparameter sweep have lower immediate value.

## Scope and superseding instruction

**Every new configuration starts from random initialization. No donor loading, donor fine-tuning, distillation, pretrained branch, inherited optimizer, or donor calibration.** Initialize actor, critic, recurrent weights, projections, and action-distribution parameters afresh under a recorded initialization scheme. The MLP path in the required parallel architecture is also untrained at step zero.

Keep the target stationary within each episode and retain the current randomized seeker arena distribution. This document proposes work only: it does not launch/stop processes, implement architectures, or change runners, environments, or deployment. The owner's update supersedes the older documents' donor-transfer recipes, optional-LSTM wording, and older promotion thresholds. Preserve their historical evidence without treating their recommendations as current authorization.

The owner reports that warm round two is being stopped and only continuation partially ran. Saved artifacts contain its 106,496-step checkpoint: **74% arrival, 86.5% discovery**, versus its starting removal policy's 78%/89.5% on the same development panel. No completed round-two comparison is established. Do not use that partial run as a scratch control or start any remaining warm arm. Process termination was not independently verified during this document-only review.

## What the saved evidence supports

| Evidence | Finding | Implication and limit |
|---|---|---|
| Round-one reserved confirmation, 1,000 shared mazes | Removal 807 arrivals versus control 758; paired difference +4.9 points, maze-bootstrap 95% interval [+2.7, +7.1] | Removing cell/view bonuses improved these trained policies; this does not prove reward removal helps learn walking/search from random weights. |
| Same confirmation, removal policy | Discovery 91.2%; arrival given discovery 88.5%; 193 failures: 31 pre-discovery stuck, 31 frozen, 26 time limits; 103 post-discovery stuck, one frozen, one time limit | 166/193 failures (86.0%) are stuck/frozen. Post-discovery stuck alone accounts for 53.4% of failures. Recovery deserves priority, while pre-discovery failure remains material. |
| Improved-policy development failure audit | All 44 failed episodes reproduce exactly; geometry transitions match. Nine-action probes find immediate translation at 39 final poses. The other five have mobile actions on a finer 5×41 grid. | No endpoint is proven mechanically trapped. Finer-grid mobility includes rotation and does not establish translation or an eventual route to the target. |
| Same audit, retained last up-to-100 steps per failure | 1,273 blocked contact steps; 1,075 (84.4%) have an alternative translating action on the nine-action grid. Of 1,278 contact steps, 1,238 involve `leg-3`. | Repeated ineffective actions and outer-leg clearance matter. `leg-3` is the outer sample on any leg, not leg number three. These are correlated failure-tail frames, not a population contact rate. |
| Completed warm development screen, 253,952 additional steps each | Control 72.5%; removal 78%; ICM 76.5%; visibility 76%; footprint 76.5%; stall counters 74.5% arrival | Neither curiosity nor more sensory/history inputs independently solved the plateau. All results inherit trained behavior and use one training seed. |

Footprint sensing improved conditional arrival to 89.5% but reduced discovery to 85.5%, with 21 pre-discovery frozen endings. Explicit stall counters still left 30 post-discovery stuck endings. Thus neither “make contact more visible” nor “expose the terminal counter” is sufficient in the tested warm settings. They remain mixed evidence, not proven components to stack together.

The improved policy's saved Gaussian standard deviations are approximately 1.53 for normalized throttle and 0.63 for turn. That motivates measuring sampled-versus-deterministic behavior and clipping, but does not prove entropy causes failure. The audit tests alternative actions geometrically; it never establishes that the learned policy assigns useful probability to an escape sequence.

The >90% objective needs both phases. Holding discovery at 91.2% would require conditional arrival above **98.7%** to exceed 90% overall. Perfectly converting the existing discovered episodes would yield only 91.2%. Prioritize recovery without sacrificing discovery; additional discovery improvement may ultimately be needed.

## Six configurations, three scientific questions

All configurations receive the current 34-input interface (31 seeker features plus three actual-motion features), except the explicit history augmentation. Hold physics, body/leg collisions, normalized forward-only throttle, target visibility/memory, frontier inputs, episode cap, and stuck/freeze termination fixed. No action override, escape oracle, easier starts, curriculum, or hidden target coordinates enter the policy.

| ID | Randomly initialized configuration | Direct comparison |
|---|---|---|
| S0 | Original-reward MLP: separate actor/critic `34 → 64 → 64`, Tanh | Scratch reference; 12,997 parameters under the recorded interface |
| S1 | Same MLP; remove only visited-cell and cell-heading bonuses; no curiosity module | S1 vs S0: does removal help acquisition from scratch? |
| S2 | S1 rewards; parallel current-observation MLP capacity branch | S2 vs S1: extra capacity; S3 vs S2: temporal-state value |
| S3 | S1 rewards; **parallel MLP + one-layer LSTM-64**, independent actor/critic branches | Required recurrent architecture test |
| S4 | S1 rewards; parallel finite-history branch with explicit validity bits | S4 vs S1/S3: is short history sufficient? |
| S5 | S1 architecture/rewards; refund ordinary contact cost on a successfully resolved sub-move | S5 vs S1: does recovery-sensitive cost improve action selection? |

This is six configurations within the requested 5–10 range, with one training run per configuration as specified in the run log. It is not a factorial grid. Keep S2–S5 on the predeclared S1 reward, even if early S0 scores look better; switching rewards after seeing results would change their questions.

### 1. Re-establish the reward baseline from scratch — S0 versus S1

This is the necessary first comparison. Removing visitation incentives improved a policy that already knew how to move and search; a fresh policy might need those incentives for initial learning. Preserve scan, hidden-distance shaping, first sight, signed pursuit progress, time/idle costs, ordinary collision cost, and terminal rewards in both arms. Remove only the two named bonuses in S1.

**Measure:** deterministic arrival/discovery learning curves, initially hidden-target discovery, visible-area gain per path length, pre-discovery frozen/time-limit endings, and canonical evaluation reward components. Report actual training reward separately because objectives differ.

**Risk/decision:** S1 may learn search slowly or never acquire it at this budget. A warm-policy gain cannot resolve that uncertainty. If S0 wins clearly, report that removal did not transfer to scratch acquisition and interpret S2–S5 relative to S1 rather than pretending they used the best scratch reward. This pair supplies a valid baseline without another curiosity sweep.

### 2. Temporal action selection with a parallel MLP+LSTM — S1–S4

For each of actor and critic, use:

```text
current 34 inputs → MLP(64,64) ──────────────────────────┐
                                                        + → output head
current 34 inputs → LSTM(64) → linear projection(64) ────┘
```

Both paths learn jointly from random weights. Use a small **nonzero random** final branch projection, with its initialization rule fixed before training, so recurrence receives gradients immediately. Apply the same projection convention to the feedforward comparators. The old donor-preserving zero-projection test is obsolete; check finite outputs and useful gradients into both paths instead. Use separate actor/critic recurrent parameters and `(h,c)` states, standard LSTM gates, FP32, one layer, and no dropout or extra learned gate.

S2 substitutes a current-observation `34 → 128 → 112 → 64` Tanh residual branch. The prior plan records 73,637 total parameters versus S3's 72,517, about a 1.5% capacity difference; verify these counts in the eventual implementation. S4 uses snapshots at lags 0, 1, 8, 32 plus four validity bits (140 inputs) through the planned history branch. Missing observations are zero-filled and invalid, with no episode leakage. Its recorded 47,685 parameters are not capacity-matched; S2 provides that control. These lags deliberately follow the original memory comparison, not the interrupted round-two 1/4/16 variant.

The hypothesis is that remembered outcomes let the deterministic controller change a failed action, distinguish a continuing stall, or avoid repeating a search loop. The static target already has externally maintained last-seen memory; an LSTM need not relearn target coordinates to help. Conversely, stall-counter results warn that changing inputs alone may not teach escape.

**Required implementation contracts before any future run:** contiguous sequences of at most 128 learning steps; up to 32 preceding burn-in steps where available; 256 valid learning tokens per minibatch excluding padding/burn-in; masked losses; ten passes over valid tokens; independent worker resets; state persistence across rollouts and target discovery; correct terminal-observation context for time-limit bootstrap; no bootstrap at true success/stuck/frozen terminals. Check uninterrupted versus restored-state inference and recurrent/base gradients. Log actual context lengths and the stale-state approximation when burn-in begins from cached rollout state. Reward is never a recurrent observation.

**Measure:** paired arrival and failure-phase differences, contact-to-sustained-motion latency, repeated actions while displacement is zero, collision streak distribution, return visits after leaving cells, initially hidden discovery, recurrent gradient norms and throughput. A predeclared development-only state-reset probe can test dependence on memory; a drop demonstrates dependence, not a learned map. Keep the standard stateful exam primary.

**Risk/decision:** scratch training must learn locomotion and temporal control together; 100k is not a fair verdict. Sequence bugs, branch neglect, stale states, or extra compute can mask useful memory. If S2 matches S3, extra capacity is a sufficient explanation; if S4 matches S3, prefer the simpler history mechanism. A healthy S3 loss means no advantage within this budget, not that all recurrence fails.

### 3. Stop charging ordinary contact cost for successful fallback — S5 versus S1

Keep the intended-collision flag and all physics unchanged. Refund only the ordinary 0.18 collision charge when the intended move was blocked but its fallback yields actual translation >0.001 units **or** wrapped actual rotation >0.001 radians. Preserve full stuck/freeze terminal fines and their counters, including on refund-eligible steps. This matches the proposed round-two recovery-cost hypothesis, rebuilt from random initialization.

This tests whether penalizing a useful rotate/slide response discourages the very behavior needed to escape contact. It is a deliberate reward change, not a claim of policy-invariant shaping. The alternative-action audit supports local action-selection headroom, but does not prove that this particular refund will teach the alternatives.

**Measure:** post-discovery stuck endings per all episodes and per discovered episode; arrival; blocked-versus-resolved contact counts; refund frequency/amount; rotation-only refunds; sustained displacement and eventual arrival after refunds; freeze endings and path inefficiency. Continue reporting intended collisions so a reward change cannot hide contact statistically.

**Risk/decision:** repeated turning or scraping could avoid ordinary penalties without getting anywhere; lower penalty totals alone are not success. Keep the negative time/idle terms and terminal rules, and reject a practical promotion if reduced stuck failures merely become frozen/search failures. Do not combine this arm with sensors, recurrence, or reduced entropy in the first test.

## Budget and evaluation discipline

Proposed decision budget: **507,904 total transitions from random initialization per configuration**, 3,047,424 total for six healthy runs, excluding implementation smokes and evaluation. This is a practical floor, not a convergence guarantee. Checkpoints at 106,496 and 253,952 are diagnostic; evaluate comparable later checkpoints on a fixed schedule. Stop broken/nonfinite runs with the reason recorded, but do not eliminate healthy scratch LSTM solely for losing at 100k. No donor-derived “additional steps” accounting applies.

Keep eight workers × 1,024 steps (8,192 transitions/rollout), batch 256, ten epochs, learning rate 0.00015, gamma 0.995, GAE 0.95, entropy coefficient 0.01 and the documented remaining PPO defaults. Record valid-token work separately for recurrence. Use a newly drawn and recorded common seed block with independent initialization/environment RNG streams. Equal numeric seeds across architectures do not create identical action trajectories. Keep CPU fallback and measure actual full-loop time; “parallel branches” means two paths inside the policy, not simultaneous training jobs.

Use development seeds 30000–30199 explicitly as reused development data. The observed 80000–80999 panel can inform diagnosis but cannot serve as a fresh confirmation. Round two proposed 120000–120999; verify that no outcomes have been inspected before retaining it, otherwise reserve a new disjoint panel before training. Freeze candidate/control checkpoint hashes and the selection rule before the final exam: highest development arrival, then fewer stuck/frozen endings, then lower failure-capped arrival time. Report every final checkpoint as well as the selected one.

Confirm the selected candidate against its same-budget scratch comparator on 1,000 paired mazes. Report deterministic arrival with Wilson intervals and paired maze-bootstrap differences; discovery; arrival conditional on discovery; initially visible/hidden strata; every pre/post-discovery ending cause; failure-capped detection/arrival/pursuit time; collision rates/streaks and actual-motion/action-clipping metrics. Stochastic training success stays separate. One run per configuration cannot establish training-seed robustness, regardless of the number of evaluation mazes.

The objective is **>90% deterministic arrival**, not the superseded 78% gate. A >90% point estimate is distinct from a confidence interval wholly above 90%. Show both the estimate and uncertainty, and require improvement over the relevant scratch control before attributing a gain. Do not change the benchmark or use confirmation results to select another checkpoint.

Do not automatically fill the remaining four configuration slots. Curiosity, footprint combinations, low entropy, phase experts, GRU/width sweeps, and moving targets are deferred. Any later experiment requires a specific unresolved failure signature and a fresh random initialization; this analysis authorizes no launch or extension.

## Local evidence reviewed

- [Experiment plan](SEEKER_EXPERIMENT_PLAN.md), [completed run log](SEEKER_RUN_LOG_2026-09-09.md), and [warm round-two plan](SEEKER_ROUND2_2026-09-09.md). Later completion entries take precedence over stale earlier “running” rows.
- [Confirmation counts and paired intervals](../rl_artifacts/seeker_20260909/confirmation_comparison.json).
- [Improved-policy failure diagnostic](../rl_artifacts/seeker_round2_20260909/failure_diagnostic.json): all 44 development failures, exact-row/geometry checks, immediate probes, finer-grid actions and retained tails.
- [Diagnostic implementation](../rl/seeker_contact_diagnostic.py) and [round-two aggregation](../rl/seeker_round2_diagnostic.py), read to establish probe semantics and sampling limits.
- [Partial warm continuation evaluation](../rl_artifacts/seeker_round2_20260909/continuation/dev_106496_summary.json). This is historical warm evidence only.

This document was produced by the authorized analysis sub-agent. It changed no training implementation and launched no training.
