# Seeker: findings, unresolved questions, and next experiments

Consolidated after the September9–10 batch. This is the current scientific synthesis
and next-session plan; the original experiment proposal is historical. Plans below
are not launched jobs. Owner expects the next session on a larger multicore CPU.

## Status and evidence trail

All six scheduled scratch screens and both extensions are complete. Nothing is
queued. TensorBoard was stopped at the owner's request; the supplemental watcher
exited and the existing completion heartbeat is paused. Models, checkpoints, CSVs,
TensorBoard events, per-episode outcomes and selected replays are preserved.
The >90% deterministic-arrival objective has NOT been achieved.

- [Chronological decisions and audits](SEEKER_SCRATCH_RUN_LOG_2026-09-09.md)
- [Generated run index](SEEKER_RUN_INDEX.md), with configs and artifact locations
- [Cross-chat handoff](SEEKER_HANDOFF.md)
- [Escape geometry audit](SEEKER_ESCAPE_AUDIT_2026-09-09.md)
- [Final metrics](../rl_artifacts/seeker_scratch_lr_20260909/report/metrics.png)
- [Stacked failure breakdown](../rl_artifacts/seeker_scratch_lr_20260909/report/outcomes.png)
- [Gradient trends](../rl_artifacts/seeker_scratch_lr_20260909/gradient_audit/optimizer_trends.png)
- [Paired comparisons](../rl_artifacts/seeker_scratch_lr_20260909/report/comparisons.json)

## Experimental contract

Static target, randomized arenas, deterministic evaluation on the same200 development
seeds30000–30199. The reserved1000-seed confirmation set120000–120999 remains
untouched. Freeze candidate and control hashes before using it; never tune on it.
One training run per configuration, no automatic repetitions. All novel models
start from random weights; extensions may preserve their OWN scratch checkpoints.
Record zero-step weights, initial hashes and empty optimizers for new models.
Report development selection, stochastic training and confirmation separately.

Announce each launch: name, hypothesis, exact architecture and parameter count,
inputs/actions, initialization, control, changed/shared settings, schedule, budget,
compute, validation and next evaluation. Give five-minute progress updates.
Evaluate about every50K transitions, aligned to completed rollouts, plus final.
Do not reject recurrence solely on an early100K screen: the observed early ranking
changed substantially later. Do not assume additional steps will always help.

## What actually ran

All six screens below collected507,904 transitions with linear LR0.00015→0.000015.
They used34 observations except history136. Same training seed145032259 and
controlled fresh base initialization; one configuration each, not a seed study.

| Run | Parameters | Arrival | Discovery | Training reward / purpose |
|---|---:|---:|---:|---|
| original_mlp |12,997|29%|73.5%|Original rewards, small MLP |
| removal_mlp |12,997|27.5%|60.5%|Remove cell/view exploration bonuses |
| residual_mlp |73,637|37%|72.5%|Original rewards, additional feedforward capacity |
| residual_lstm |72,517|46.5%|82%|Original rewards, additive recurrent memory |
| history_mlp |26,053|50.5%|85.5%|Original rewards, observations at current/1/4/16 steps |
| recovery_reward |12,997|26%|83%|Removal rewards plus useful-contact refund |

Both residual models then continued their OWN507,904 checkpoints to2,031,616.
Adam state was preserved. LR explicitly decayed0.000015→0.000003 without an upward
reset. Episodes/RNG restarted explicitly with seed145032260; this was not bitwise
uninterrupted continuation. There were1,523,712 additional transitions per model.

| Model | Final arrival | Final discovery | Best DEV arrival | Best step |
|---|---:|---:|---:|---:|
| MLP + LSTM |60.5%|80%|63.5%|901,120 |
| Residual MLP |56.5%|77.5%|59%|1,957,888 |

LSTM final improved14 percentage points over its507K parent; MLP improved19.5.
LSTM stayed near60% for much of the later run, while MLP improved late. Thus the
final gap narrowed to4 points. Paired development-maze bootstrap95% interval for
that final gap is[-3,+11] points. At507K it was9.5 points [3,16.5]. These intervals
describe maze uncertainty for these fixed policies, NOT training-seed variability;
they are exploratory and do not correct for repeated checkpoint selection.
We cannot declare LSTM universally superior, or memory unnecessary.

Historical best fine-tuning reached78% DEV and80.7% on a DIFFERENT confirmation
set80000–80999. It had about2.54M ancestral transitions (2,285,568 donor plus253,952
fine-tuning), constant LR0.00015 and transferred locomotion. This is not a fresh
training control. The original donor chain was PPO25→27→28→29→35. Older walker
scores also used different tasks/arenas and must not be compared as the same exam.
Interrupted warm-start and constant-LR campaigns remain archived, not resumed.

## Model and environment interpretation

The LSTM retained separate actor/critic34→64→64 tanh MLP branches and ADDED separate
one-layer64-unit actor/critic LSTMs with64-dimensional residual projections. Actor
outputs two Gaussian action means with learned standard deviations; critic outputs
one value. MLP capacity was not removed to make room. The similar-sized residual
MLP is a control, not a permanent capacity ceiling.1–2M-parameter architectures
are permitted, but no large architecture has been trained yet.

The recurrent trainer learns contiguous chunks up to128 steps with up to32 steps
of detached burn-in. Padding and burn-in do not enter losses; episode/worker
boundaries are respected. Cached states remain an approximation after policy
updates. Passing sequence/reset/masking tests establishes implementation behavior,
not effective long-term memory in the learned policy.

Current observations contain explicit persistent last-seen target location; the
age channel saturating at120 does NOT erase that memory. History includes lagged
observations with reset padding. Production browser ONNX still uses26 inputs and
has not been replaced by these research models.

Current physical throttle is forward-only: normalized-1 stops,0 is half-forward,
+1 full-forward. Reverse is PROPOSED, not implemented. Collision tests cover body
and leg sample circles, unlike thin body-origin rays. A clear ray does not imply
leg clearance. Decoupled fallback tries safe rotation then forward translation.
The intended blocked-action collision flag can remain true during useful fallback.

## Failures: contact is dominant for LSTM, but not the whole problem

Final200-episode endings:

| Outcome | LSTM | MLP |
|---|---:|---:|
| Arrival |121|113 |
| Stuck before discovery |35|14 |
| Stuck after discovery |33|23 |
| Timeout before discovery |5|31 |
| Timeout after discovery |6|18 |
| Frozen after discovery |0|1 |

Before/after discovery labels identify phase, not distinct collision mechanisms.
Stuck termination uses40 consecutive colliding, nontranslating attempts; freeze
uses60 nontranslating steps. Both have terminal penalties. A robot moving in loops
can avoid both. Rotations and collision-counter resets have subtleties documented
in the escape audit; do not equate the collision flag with zero actual movement.

The small geometry audit found legal immediate movement and safe pivot/forward
sequences in all18 sampled stalled poses, spanning ONLY three distinct mazes and
three checkpoints.3282 replay transitions and189 actual-step probes agreed with
the geometry calculation. This supports missed legal escape actions in that sample.
It does not prove every jam escapable or a complete route to the target. Coarse
body reachability does not prove orientation-dependent full-leg passage; the
bounded layout-generation fallback also needs auditing. No physics fix was made.

Collision-free wandering is directly observed at LSTM2,007,040:
- Seed30002:1000 steps,342.382 path units, no discovery, zero collisions,
  38 distinct cells and98 revisits (~72.6% of cell transitions).
- Seed30052:discovered at259,1000 total steps,323.925 path units, zero collisions,
  no arrival. Persistent target memory did not guarantee pursuit completion.

At THAT checkpoint122 arrived,67 ended stuck and11 timed out. Filtering stuck
endings gives122/133=91.7%, but is selection, not the effect of rescue. Converting
all67 to successes would arithmetically yield94.5%; that is NOT a prediction.
A rescued robot may get stuck again or wander. Keep checkpoint-specific counts
separate from final counts above.

## Seeking: use the correct denominator

63 of200 development episodes begin with a visible target. Overall discovery
includes these easy detections. Among137 initially hidden episodes:
- LSTM2,007,040 discovered104/137=75.9%; final97/137=70.8%.
- History MLP507,904 discovered108/137=78.8%.
- Residual MLP1,654,784 discovered82/137=59.9% (not its final checkpoint).

For the final LSTM,35 of40 undiscovered episodes ended stuck and5 timed out.
Contact cuts search short; collision-free revisiting separately demonstrates
ineffective searching. Overall coverage alone can hide both problems. Track
hidden-only discovery, failure-capped discovery time, coverage over time, revisits,
and contact-shortened search. No evidence establishes a single underlying cause.

## What the recovery-reward experiment really tested

Implementation: `ExperimentEnv.step` in `rl/seeker_round2.py`, selected by
`rl/seeker_scratch.py`. It refunds ordinary0.18 collision cost during training if
an intended collision still produces translation>0.001 OR rotation>0.001 radians.
It retains terminal penalties. It adds no reverse, planner, rescue controller,
demonstrations or reward for sustained escape. Even a tiny turn can qualify.
Evaluation uses common environment rewards; physical dynamics remain identical.

The right507K control is removal_mlp:26% versus27.5% arrival,83% versus60.5%
discovery. Arrival difference interval[-6.5,+3.5] points gives no demonstrated
arrival benefit; the discovery shift is interesting, not a solved recovery claim.
The test removed cell/view bonuses in both arms; it was NOT the original-reward
large LSTM plus a refund. Longer MLP/LSTM runs used original rewards without refund.
Do not generalize this result to all recovery shaping or larger-model performance.

## Gradient audit and plateau hypotheses

LSTM logs mean minibatch combined actor+critic gradient norm BEFORE clipping to0.5.
Stock MLP does not log gradient norm. PPO `clip_fraction` measures probability-ratio
clipping, not gradient clipping. Actual weight deltas, branch norms, postclip norms
and gradient clipping frequency were missing. Optimizer step counts and LR exist.

The audit snapshot through1.6384M showed raw-norm window medians16.57 early versus
190.30 after1.2M, LR1.152e-4 versus7.839e-6, approximate KL0.00420 versus0.00114.
Value loss rose3.33→14.56 while explained variance stayed about0.874 late. Final
graphs/audit.json were subsequently refreshed; these numerical windows describe
the earlier recorded snapshot. Combined vanishing gradients are unsupported.
Critic-dominated global clipping and declining LR are hypotheses, not proven
causes. Adam moments mean raw gradient norm does not directly determine weight
change. A schedule can be implemented correctly and still be suboptimal.

Before new runs instrument actor/critic and MLP/LSTM gradients, postclip norms,
clipping frequency, actual optimizer update norms and update/weight ratios.
Measure instrumentation overhead and verify logging does not change updates.
Do not silently change optimizer settings while calling it instrumentation.

## Prioritized next experiments: staged, not a blind sweep

First finish diagnostic/tooling preparation, then select a few controlled branches.
Every novel training run starts random. No automatic seed repeats or wholesale
launch of every item. Keep static targets and common evaluation seeds.

| Priority | Experiment / control | Hypothesis and decision evidence |
|---|---|---|
| 0 | Broader final-checkpoint escape audit | Sample all failure categories across many mazes; search bounded legal action sequences with and without reverse. Measure actual escape, not just one safe step; flag unreachable/full-footprint layouts separately. |
| 0 | Optimizer telemetry on both trainers | Establish whether actor gradients are suppressed or weight updates shrink; include fresh small correctness checks and overhead measurement. |
| 1 | Signed reverse versus forward-only | Change action interpretation only, train scratch; measure stuck rates, escape duration, arrival and reverse usage. Save zero-step action contract; old policy outputs are incompatible. |
| 1 | LR schedule with a higher late floor versus declared decay | Same architecture/rewards/budget, prospective schedule from step0; use KL, actual updates and arrival to test whether late learning was constrained. Do not infer causality from old correlations. |
| 2 | Separate actor/critic clipping versus global clipping | Only if telemetry supports imbalance; record each norm/limit and retain identical loss weights. Do not also change LR or rewards. |
| 2 | Moderate step-cost increase versus original cost | Existing cost is0.002/step, only2 per1000-step timeout. Test urgency while monitoring reduced discovery, premature terminal failure, and loss of legitimate detours. |
| 2 | Windowed unproductive-search shaping versus original | Penalize prolonged lack of information/coverage gain, not every revisit. Specify memory/window/reset semantics and expose needed state; test backtracking cases and reward exploitation. |
| 2 | Sustained recovery shaping versus original/refund | Define escape as contact relief followed by useful motion; prevent enter/escape bonus cycling. A small turn alone is not successful recovery. |
| 3 | History extension or larger additive MLP/LSTM | History was strong at507K but never extended. Choose after bottleneck diagnostics; preserve useful MLP capacity.1–2M parameters and~10M steps are candidates, not guaranteed solutions or queued runs. |
| 3 | Pursuit shaping using obstacle-aware progress | Current straight-line progress can penalize a necessary detour. Audit potential-based shaping and terminal handling; disclose privileged geometry. Compare on unchanged arrival objective. |
| 3 | Deterministic legal-action rescue / expert teaching | First evaluate assistance separately. If teaching, use explicit imitation/DAgger-style supervision rather than treating overridden actions as PPO samples. Report unassisted policy separately. |

Before discovery current rewards include first-visit cell/view and bounded scan
bonuses, first discovery0.5 and best-distance progress shaping. After discovery
cell/view/scan bonuses stop; signed distance progress remains. Both use goal25,
collision0.18, stuck/freeze10 and step0.002. Avoid assuming that all wandering is
reward farming: the collision-free post-discovery counterexample earns no search
bonus. Strong per-step retreat penalties can obstruct valid detours and recovery.

Potential-based shaping reference: [Ng, Harada and Russell1999](https://ai.stanford.edu/~ang/papers/shaping-icml99.pdf).
Its policy-invariance result depends on the construction/assumptions; it is not a
guarantee that any new novelty or timeout penalty is safe or learns faster.

## Larger multicore CPU: benchmark before choosing throughput settings

The completed runs used CPU Torch. Local RTX3050 Laptop4GB was present but installed
Torch was CPU-only; no CUDA training or4090 benchmark happened. More cores and
RAM may help, but speedup is unmeasured and not guaranteed. Prior timing found a
large collection component; that includes policy inference, not just environment
physics. Two simultaneous trainers can compete for cores and memory bandwidth.

On the new machine:
1. Capture hardware, OS, Python/packages, Torch build, CPU/thread limits, git state
   and source hashes. Transfer immutable artifacts with hashes and preserve parents.
2. Benchmark sequential vector environments versus subprocess workers using the
   same policy/environment and fixed total rollout transitions. Try a small ladder
   of worker counts; record thread counts so worker processes do not each consume
   all cores. Validate Windows spawn/pickling and per-worker seeds/resets.
3. Time environment stepping, batched inference, rollout collection, PPO updates,
   evaluation, serialization and logging separately. Record RAM, CPU utilization,
   transitions/second and wall-time-to-evaluation. Compare concurrent independent
   runs with one larger worker pool; choose from measured throughput.
4. Keep PPO rollout size8×1024=8192 as the baseline. Changing worker count while
   keeping8192 changes per-worker temporal horizon; explicitly verify recurrent
   chunks/burn-in/GAE and log that statistical change. First benchmark speed without
   declaring a scientific model improvement. Batch256, epochs10 remain controls.
5. Parallelize independent development episodes if needed, retaining seed ordering,
   per-episode recurrent resets and identical deterministic actions/metrics. Verify
   equivalence against sequential evaluation. Do not touch reserved confirmation.
6. Separate engineering throughput probes from scientific runs in artifact paths.
   Choose training budgets in transitions and also report wall time. No claimed
   CPU/GPU multiplier before measurement; use explicit spawn-safe entry points.

Common PPO baseline: gamma0.995, GAE0.95, clip0.2, entropy0.01, value coefficient0.5,
max gradient norm0.5, Adam epsilon1e-5, batch256,10 epochs, no target-KL early stop.
Per-run saved configs/hyperparameter audits remain authoritative. Validate actual
optimizer LR at intermediate and final progress, checkpoint resume, finite losses,
sequence boundaries and deterministic evaluation before long launches.

## Additional decisions from the architecture and scaling discussion

This section incorporates the owner's separate discussion chat. It supplements the
priorities above; it does not authorize launching every proposed comparison. Reverse,
recovery assistance, history extension and multicore benchmarking were already listed.
The owner specifically wants an explicit rolling-window LSTM tested next. Existing
stateful inference is standard LSTM usage, not an established implementation defect.
The completed runs remain valid controls and must not be overwritten.

### Explicit rolling-window LSTM

Proposed initial window:64 consecutive observations, each34 features, including the
current step (current plus63 previous).64 is a suggested starting length, not a final
owner-selected hyperparameter. For a strict window, start the recurrent state fresh
for each window, process observations chronologically, and use the last valid LSTM
output with the current-observation MLP branch to predict the action. Do not also
carry pre-window recurrent state, which would no longer be a strict finite window.
This differs from the completed model's one-new-timestep inference with carried state.

Train the actor and critic using the same window/state convention used at inference;
do not merely swap evaluation inputs on an existing stateful checkpoint. Define
episode-start padding/masking so missing history is not confused with real observations,
prevent cross-episode/worker leakage, and retain correct terminal/time-limit handling.
Overlapping input windows are context, not additional environment transitions. Record
the gradient span, memory cost and inference throughput: replaying a window at every
decision costs more than updating a carried state once. First compare scratch windowed
versus stateful models with the same architecture, rewards, forward-only actions and
budget. Reverse is a separate controlled branch before any combined candidate.

### Feature candidates and what is already present

Persistent target memory already enters the34-input policy directly. Zero-based
indices0/1 are current visibility and capped sighting age;2/3 are world-space direction
from the current position to the last-seen location;4 is normalized remembered distance.
The location persists until episode reset. Indices5/6 encode yaw;7 previous collision;
8/9 previous actions;10–25 body-origin rays;26–30 frontier suggestion;31–33 actual
previous displacement x/z and rotation. Do not propose these existing inputs as missing.

Candidate feature comparisons, not a bundle:

- Robot-relative remembered-target direction (and separately frontier direction):
  derive from existing direction/yaw without revealing new hidden-target information.
  Specify replacement versus augmentation. Hypothesis: easier action-relevant
  representation; no measured gain yet.
- Explicit target-ever-discovered flag: redundant in principle but unambiguous phase
  information. Keep target information unavailable before genuine discovery.
- Stall counters or whole-footprint clearance: previously tested only in separate
  fine-tuning branches, not adopted in the current scratch LSTM. Footprint added16
  six-unit fixed-yaw translation-clearance sensors to the original rays; it does not
  guarantee safe rotation. Footprint arrival76.5% versus control72.5%, but discovery
 85.5% versus90.5%; stall counters74.5% arrival. These are mixed findings, not automatic
  additions. Reverse also raises the importance of the existing rear blind wedge;
  any rear-sensor change should be explicit and separate from the reverse-action test.

### Recovery demonstrations and alternative learning algorithms

The owner's proposed human/programmatic "nudge" must be specified as physical rescue,
temporary action override, or demonstrations that teach independent recovery. Prefer
validated recovery sequences with explicit imitation/DAgger-style supervision when
the objective is an unassisted learned policy. Legal immediate movement is not proof
of eventual escape. Log intervention triggers, expert information access, actions,
frequency and subsequent outcomes. Do not credit an overridden expert action as an
action sampled from the PPO policy; preserve separate assisted/unassisted evaluations.

After stabilizing the chosen observation/action task, consider these algorithm branches:

| Candidate | Question / priority |
|---|---|
| SAC | First suggested alternative to PPO: can replay-based continuous-control learning use collected experience more efficiently? Compare both equal transitions and wall time; memory/window support requires explicit implementation. |
| TQC | Later SAC-family comparison if value overestimation is a credible limitation; not a promised improvement. |
| TRPO | Lower-priority related policy-optimization comparator; no present evidence that its trust-region update addresses the dominant failure. |
| Population-based training over PPO | Closest match to the owner's "genetics on top of PPO": multiple learners, selection/copying and hyperparameter mutation. Requires an explicitly revised population protocol and compute budget; current one-run/config rule remains in force until then. |
| Pure genetic/evolutionary weight search | Discussed, lower priority than PPO/SAC and targeted recovery learning; no launch planned. |

References: [SAC](https://spinningup.openai.com/en/latest/algorithms/sac.html),
[TQC](https://sb3-contrib.readthedocs.io/en/v2.8.0/modules/tqc.html),
[TRPO](https://sb3-contrib.readthedocs.io/en/v2.0.0/modules/trpo.html),
[DAgger](https://imitation.readthedocs.io/en/latest/_api/imitation.algorithms.dagger.html),
[population-based training](https://arxiv.org/abs/1711.09846).

### Focused scaling direction and decision gates

Owner favors stronger multicore compute, more parallel environments, longer training
and a possible wider model. Benchmark8→16→24/32 environments rather than treating50
as a target or limit. Distinguish simultaneous environment streams feeding one policy
from5–10 independent model runs. Larger rollout batches, larger optimization minibatches
and higher learning rates are separate interventions; no automatic linear LR scaling.

Keep the current model and strong history baseline; a roughly200K–500K-parameter wider
challenger (for example LSTM128, initially one recurrent layer) was suggested before
depth expansion. Exact widths/counts need prospective selection. This is not a cap:
the earlier permission for1–2M-parameter models remains. Width does not itself enlarge
the explicit window or backpropagation span. Hold other settings fixed to attribute gains.

A5M–10M-transition horizon is a planning option, with2M/5M decision points, not a promise
or queued job. The now-completed2M results above supersede earlier optimism based on the
802K checkpoint: LSTM later plateaued near60%, so unchanged scaling is not guaranteed.
Declare a full-horizon LR schedule prospectively and evaluate sustained arrival and
failure changes before further extensions. Budget in transitions, also report completed
episodes and their lengths; short failed episodes must not inflate apparent experience.

For hardware selection, first benchmark the existing GPU in a separate compatible
runtime if useful, then a rented strong CPU host before purchase. A16–32 physical-core,
64GB-RAM machine was suggested as a benchmark starting point, not a measured requirement.
Size from actual usage and test concurrent-job throughput. Five million transitions in
three hours requires about463 transitions/sec per model; ten such runs require about4630
aggregate, excluding evaluation/setup. Faster compute cannot guarantee90% arrival within
two or three hours. No hardware purchase, package migration or new training is authorized
by this discussion-only documentation update.

## What to deliver next session

A hardware throughput table; audited gradient telemetry; broader escape findings;
a short prospectively specified experiment shortlist with exact budgets/controls;
then individual launch briefings and five-minute updates. End each run with final
and best checkpoints, equal-budget comparisons, hidden-only discovery, arrival,
failure-capped times, phase-specific stuck/timeout/freeze counts, and lessons.
Include assisted versus unassisted outcomes if a controller is tested. Do not
replace the deployed browser model or claim90% from filtered episodes.
