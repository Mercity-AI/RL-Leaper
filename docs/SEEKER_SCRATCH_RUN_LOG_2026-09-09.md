# From-scratch seeker campaign

**Current active directory: `rl_artifacts/seeker_scratch_lr_20260909/`.** It uses
linear learning-rate decay 0.00015 → 0.000015. Earlier constant-rate entries below
are archived history; see the final schedule-change section for the superseding run.

The owner explicitly requires random initialization and a parallel MLP + LSTM
experiment. This supersedes the stopped warm-start round-two queue. Earlier 80.7%
confirmation is a fine-tuning result, never a scratch baseline. See the independent
[failure analysis](SEEKER_SCRATCH_ANALYSIS_2026-09-09.md).

## Six experiments and controls

1. `original_mlp`: original rewards, fresh 34→64→64 actor/critic.
2. `removal_mlp`: remove only cell/view bonuses, same freshly randomized weights.
3. `residual_lstm`: removal rewards; parallel current-observation MLP and 64-unit LSTM,
   separate actor/critic memory, zero-initialized residual projections.
4. `residual_mlp`: removal rewards; a similarly sized feedforward residual branch to
   distinguish extra capacity from recurrence.
5. `history_mlp`: removal rewards; current observation plus snapshots 1/4/16 steps ago.
6. `recovery_reward`: removal rewards; ordinary collision fine refunded when fallback
   translation or rotation succeeds; stuck/freeze terminal fines remain unchanged.

All six start at zero timesteps with empty Adam state. No checkpoint is loaded.
A common **newly randomized**, untrained reference MLP supplies the shared base
weights, final projections, and initial log standard deviation. This is controlled
random initialization, not transfer from any trained policy. Extra history input
weights and residual output projections start at zero; all remain trainable.
Save every run's initial model, initial-weight hash, seed, parameter count, package
versions, source snapshot, optimizer-entry count, and step counter as evidence.

Tests verify that construction does not call `PPO.load`, reward controls have exactly
matching new weights, and changing the seed changes the new weights. Two CPU slots
run independent processes; each uses one Torch thread and eight vector workers.
GPU is unavailable in the installed CPU-only Torch build. Parallel job timing is
not an isolated architecture throughput benchmark.

## Budget, recurrent correctness, and evaluation

Each healthy run receives 507,904 steps from scratch, not additional donor training.
Retain 8×1024 rollout, batch 256, ten epochs, learning rate 0.00015, gamma 0.995,
GAE 0.95, entropy 0.01. One training seed per configuration. A 24,576-step engineering
checkpoint is saved inside each run and the same model/optimizer continues; it is
not a repeated training run. Broken/nonfinite implementations must stop and be logged.

Recurrent learning uses contiguous within-episode segments up to 128 observations,
up to 32 preceding observations for no-gradient burn-in, and detached starting state
for the learning loss. Batch packing splits a segment only to fill 256 valid learning
tokens; episode endings also shorten segments. Padding and burn-in are excluded from
all PPO losses and advantage normalization. Every rollout token is learned once per
epoch. Cached pre-burn-in state may be stale after PPO updates; this approximation
is explicit. States cannot cross episode/worker boundaries. Inference preserves
memory between actions, and inherited SB3 collection handles true terminals versus
time-limit bootstrapping with the corresponding recurrent state.

For efficiency, save 200-maze deterministic exams at 106,496, 253,952, and 507,904
steps for every arm, rather than the older plan's roughly 50k intervals. Do not
reject a healthy LSTM for failing to win at its early checkpoint. Development uses
30000–30199 (reused). Reserved confirmation remains 120000–120999: no outcomes from
that panel have been evaluated. Freeze candidate/control model hashes first.
Selection: highest development arrival; tie fewer stuck/frozen endings, then lower
failure-capped arrival time. Confirmation must compare an equally trained scratch
control, not the old trained walker. Report one-seed limitations and both point
estimate and uncertainty against the >90% objective.

## Initial status

`original_mlp` and `removal_mlp` are training. The parallel MLP+LSTM policy and custom
sequence-training tests are being completed before its queue validation gate opens.
The remaining four runs are queued, not claimed as trained. Configuration/seed
record: `rl_artifacts/seeker_scratch_20260909/protocol.json`.

The user asked whether all earlier fine-tuning experiments should be repeated.
Decision: repeat the scientifically central original-reward versus removal comparison
from scratch. Prior weak curiosity/sensor/counter arms remain diagnostic evidence;
do not automatically replicate all of them. Reward removal may help refinement yet
harm early acquisition, so its scratch comparison is essential.

### Recurrent validation and expanded authorization

Nine policy checks, seven custom recurrent training/collection checks, and three
scratch-initialization integration checks pass. The queue's recurrent validation
marker records source hashes. Both baseline models passed their 24,576-step
engineering checkpoints. The LSTM is validated and queued, not yet trained.

The owner expanded authorization to further justified experiments or much longer
training if evidence supports it; the initial six remain the first controlled set,
not a hard overall ten-run cap. From-scratch origin and one seed per configuration
remain binding. Extending a model that itself originated in this scratch campaign
is compatible with longer training; loading an old pretrained walker is not.

Scientific context: navigation is demonstrably learnable, but published success
depends on sensor/task/budget. DD-PPO's near-perfect PointGoal result used RGB-D
and GPS/compass and large-scale training, not this hidden-target legged arena:
https://arxiv.org/abs/1911.00357 . Do not assume its result fixes our hyperparameters.

## Active campaign superseded to explicit linear learning-rate schedule

Owner requires a decaying LR and a complete hyperparameter audit. The two partial
constant-rate scratch runs were stopped at their saved 253,952-step checkpoints;
those checkpoint evaluations were interrupted, and only their 106,496 exams are
complete (18.5% original / 21% removal arrival). They remain under the old directory,
excluded from the scheduled comparison. No recurrent full run had started.

**ACTIVE: `rl_artifacts/seeker_scratch_lr_20260909/`.** All six configurations restart
from random weights with the same recorded seed 145032259. The only intended
learning change versus the stopped scratch setup is an explicit linear LR:
0.000150 initially, 0.0000825 at half budget, 0.000015 at 507,904 transitions.
This lower nonzero floor permits continued small updates without a zero-rate end.
The schedule is common to MLP and recurrent PPO. Two new checks verify endpoints,
clamping, serialization and actual optimizer rates over real MLP and recurrent PPO
updates. Existing 9 policy + 7 recurrent trainer + 3 scratch tests also passed.
The source/validation marker and initial models are preserved in the new campaign.

TensorBoard filter: `seeker_scratch_lr_20260909`. Active runs start with original_mlp
and removal_mlp; the validated residual_lstm is next as a CPU slot becomes available.
Primary tag development/success_rate is a fraction (0.90=90%). Other useful tags:
development/detection_rate, development/success_given_detection,
development/mean_arrival_steps_capped, development/mean_collision_rate,
stochastic_last100/success, train/learning_rate, train/approx_kl and train/clip_fraction.
PPO losses need not decline monotonically as the on-policy data changes. Compare
success and failure behavior alongside optimization diagnostics, not loss alone.

`AGENTS.md` now requires explicit schedules, actual-rate tests/logging, scratch-origin
evidence and no silent upward LR reset on future extensions. User authorization
allows further justified experiments and longer training; initial six are a first
controlled block rather than a hard overall limit. All active runs remain static-target.

### Scheduled scratch checkpoint 106,496

Original rewards: **24% arrival / 85.5% discovery**. Reward removal: **19% arrival /
84.5% discovery**. These are the new scheduled runs, not the archived constant-rate
18.5%/21% checkpoints. The reward choice must be established for acquisition rather
than assumed from fine-tuning. Finish the common budget before selecting a reward.
The 71-test combined suite passed, including schedule and recurrent integration.
Live logs at this stage show approximate KL 0.004–0.005 and clip fractions 3–4%;
there is no obvious optimizer explosion in those diagnostics. This is not evidence
that the behavioral task is solved. Hyperparameter audits and TensorBoard Custom
Scalars panels are available per run; development smoothing should be zero.

### Corrected inherited training accounting

User asked how much the earlier donor had actually trained. A recursive config and
checkpoint-metadata audit found PPO25 fresh507904 → PPO27 +507904 → PPO28 +507904
→ PPO29 +253952 → PPO35 +507904. Total recorded donor ancestry: **2,285,568** steps.
Our selected first-round fine-tuning adds253952, giving **2,539,520 ancestral steps**.
Each saved stage counter matches that stage's collected-step log. All counts are in
`rl_artifacts/seeker_20260909/donor_lineage.json`; there are no missing stage counts.
These inherited stages changed observations/actions/rewards/environment, so the sum
is not equivalent to identical-task scratch training. Prior descriptions that only
mentioned the donor's last500k stage were incomplete; do not repeat that shorthand.
This reinforces treating507904 scratch steps as a screening floor, not convergence.

The target location is already remembered after first sight: last_seen_target stores
world x/z, and observation2:4 provides direction to it with distance atindex4, even
when occluded. Age clips at120 but does not delete the remembered location. Before
first sight the direction iszero. Since targets remain stationary within episodes,
post-discovery failures are not simply forgotten coordinates. LSTM targets action/
observation history and recovery sequencing, not replacement of that existing memory.

User requests experiment updates every five minutes; heartbeat changed from15 to5.

### Midpoint diagnosis and next-launch sequencing

At253952 steps, original rewards reached21.5% arrival/82.5% discovery; removal
reached18%/69%. These are regressions from their106496 checkpoints, not gains.
Both baseline runs continue unchanged to507904 before choosing the reward for
the memory/capacity comparisons. The LSTM launch gate is temporarily held:
engineering validation remains passed in `recurrent_validation_engineering_passed.json`.
This is a scientific sequencing hold, not a failed recurrent test.

`rl/seeker_pursuit_probe.py` evaluated the two253952 checkpoints in64 diagnostic
cases each: no obstacles, known static target8 units away,8 headings x8 relative
bearings,200-step cap. Original arrived in30/64 cases (46.875%), removal25/64
(39.0625%). Full actions/positions and model hashes are saved in
`open_space_pursuit_probe.json`. These synthetic cases are not benchmark scores
and do not establish the cause: they show that known-target pursuit itself needs
inspection, in addition to contact recovery. An egocentric direction representation
derived from existing sensors is a possible follow-up, not yet implemented.

User's persistent-location concern is now covered by an additional regression test:
hide the target behind the robot, move the robot, advance sensing beyond120 steps,
and verify the old coordinate survives with the updated relative displacement.
All13 target-sensing tests passed (`rl_artifacts/seeker_target_memory_tests.log`).
No environment behavior changed. Original cell/view bonuses already switch off
after discovery, so post-discovery failures are not ongoing exploration-bonus payout.

### Hardware and throughput audit

Saved `runtime_bottleneck_audit.json` from59 ordinary rollout cycles per baseline,
excluding evaluation-sized gaps (>40 seconds). Original/removal median cycles:
12.60/12.66 seconds per8192 transitions; collection11.51/11.49 seconds; outside
collection1.15/1.17 seconds. Collection includes policy inference and simulation;
the residual includes updates and other overhead, so this is not a pure kernel
profile. Accelerating only that residual has approximately1.1x theoretical ceiling.
No actual CPU-versus-CUDA benchmark exists yet; do not invent GPU speedup numbers.
Training reached507904 in1185/1262 seconds including intermediate exams but excluding
the final exam. These two jobs ran concurrently. InstalledTorch2.13.0+cpu cannot use
the RTX3050 Laptop4GB (driver592.82). A separate CUDA runtime benchmark is a sensible
next performance experiment, especially for recurrence; replacing hardware before
profiling simulation/inference/updates separately is not justified by these timings.

### Final baseline results and prospective reward amendment

At507904 transitions original reached29% arrival/73.5% discovery and removal27.5%/
60.5%. Arrival improved from the midpoint; discovery declined in both. This does
not demonstrate convergence or justify promising90% with more training alone.
Before any memory/capacity arm launches, choose original rewards for residual_lstm,
residual_mlp and history_mlp, preserving a matched-reward architecture comparison.
The small arrival gap is exploratory, not proof of reward superiority; stronger
discovery motivates this choice for acquisition. The recovery_reward arm retains
removal rewards and compares with removal_mlp, isolating its contact refund.
Initial protocol remains archived; protocol_amendments.json and each future run's
effective_experiment_spec explicitly record the prospective change. No active or
completed run changed. Engineering gate reopens after scratch/schedule verification.

### Architecture launch briefing and live audit

Owner requires the full experiment briefing at launch, not only when requested;
this reporting requirement is now explicit in AGENTS.md. Both active models use
34 inputs, separate actor and critic networks, a direct34->64 Tanh->64 Tanh path,
and an additional parallel path whose64 features are added to the direct path.
Actor produces two Gaussian action means with learned standard deviations; critic
produces one value estimate. Recurrent path: one-layer unidirectional LSTM64 then
linear64 projection, separately for actor and critic (72517 total parameters).
Feedforward control path:34->128->112->64 Tanh layers then linear64 projection,
separately for actor and critic (73637 parameters, approximately1.5% larger).
Both added paths start with zero output projections, preserving identical newly
randomized base behavior; all parameters remain trainable.

Library foundation is PyTorch/SB3/SB3-Contrib. Parallel residual architecture and
fixed-context training are custom. Sequences retain order, separate workers and
episodes, learn at most128 steps with up to32 detached warm-up steps. Every rollout
transition contributes once per epoch,256 valid tokens per minibatch,10 epochs.
Padding/warm-up are excluded from loss. Runtime hidden/cell state persists across
steps and resets on episode boundaries, not target discovery. Evaluation explicitly
passes state and episode_start. Cached prefix states can be stale after optimizer
updates; bounded warm-up reduces but does not eliminate this approximation.

The saved architecture_runtime_audit.json verifies both initial counters/optimizers
were zero, both effective rewards original, and live106496 LSTM recurrent weights
and residual projections differ from initialization. Latest logged LR0.000123871;
LSTM KL0.00328, clip fraction0.0264,81920 valid learning tokens/320 optimizer steps
per rollout. Logged gradient norm38.67 is BEFORE clipping to0.5, not an unclipped
applied update; active clipping warrants monitoring, not an automatic failure claim.
Policy9/trainer7/scratch3/schedule2 focused checks passed before launch. These checks
support implementation integrity, not optimal hyperparameters or task success.

### First architecture results:106496 transitions, matched200-maze DEV

Original small MLP:24% arrival/85.5% discovery; residual MLP:20%/86.5%;
residual LSTM:17%/84%. Post-discovery stuck counts are69/58/36 respectively,
but post-discovery timeouts54/75/98. LSTM mean episode collision rate8.84%
versus11.99% residual MLP and13.57% original; failure-capped arrival time911.87
versus881.97 and837.88 (lower is better). Memory currently reduces contact/stuck
endings but does not convert that into arrival. Fewer stuck endings can also leave
more opportunities to time out, so these aggregate counts do not prove recovery.
No LSTM success advantage at this checkpoint; continue the same runs unchanged
to253952 and507904 rather than conclude from the early screen or restart seeds.

### Owner request: denser evaluation and capacity discussion

AGENTS.md now requires approximately50k-step development evaluations plus final.
New scratch workers use first completed8192-transition rollout after each milestone:
57344,106496,155648,204800,253952,303104,352256,401408,450560,507904.
The exact list overrides the historical protocol in each newly launched run config.
Cadence alignment/uniqueness/final-only short budget checks passed. Existing LSTM
and residual MLP processes retain their imported106496/253952/507904 cadence;
no process was restarted and no past checkpoints are invented. Pending history and
recovery runs will pick up the new cadence. Reserved confirmation remains untouched.

Discussed1-2M-parameter/10M-transition scaling as a possible experiment, not a
confirmed remedy or newly launched job. Current larger branches underperform the
small MLP at106496, which does not isolate width/capacity and does not exclude a
later scaling benefit. A clean width-only comparison at matched budget, followed
by longer matched training if justified, separates size from experience. Choosing
only the winner at100k could discard a slower-learning architecture. Any long run
must declare its full LR horizon rather than repeatedly resetting a500k schedule.

### Architecture midpoint:253952 transitions

LSTM regressed17%->14.5% arrival,84%->76.5% discovery. Matched residual MLP
improved20%->26% arrival,86.5%->82.5% discovery. Original small MLP at the same
budget was21.5%/82.5%. LSTM post-discovery endings:12 stuck,72 frozen,40 timeout;
residual MLP:26 stuck,4 frozen,83 timeout (all counts out of200). Frozen denotes
60 steps without meaningful translation and may include rotation, not necessarily
zero action. The lower LSTM collision rate8.63% vs10.73% does not establish better
recovery: lack of useful movement is now prominent. No basis to scale or extend
this LSTM unchanged beyond the planned507904 screen. Both current runs continue
to that budget; report the failure shift explicitly, not just lower collisions.

### Upcoming automatic launches: advance briefing

As the current slots free, history_mlp and recovery_reward launch automatically.
History:136 inputs (current34 plus observations1/4/16 steps ago), separate actor/
critic136->64->64 Tanh, two Gaussian actions and scalar value,26053 parameters.
Original rewards; compare original_mlp. Hypothesis: explicit short history provides
motion/recovery context without recurrent optimization. Reset pads history with
zeros; cannot represent arbitrary long-term memory. Recovery:34->64->64 separate
actor/critic,12997 parameters, removal rewards plus refund of ordinary collision
fine when fallback translation or rotation succeeds; terminal failure penalties
remain. Compare removal_mlp. This deliberately changes reward incentives, not
physics. Both random initialization,507904 steps, CPU, linear0.00015->0.000015,
one run/config, new approximately50k evaluation cadence with fixed200-maze DEV.
Focused wrapper tests previously passed; actual construction verifies both sizes.
No claim of new results until their evaluations complete.

### Final architecture screen: LSTM reverses the midpoint ranking

At507904 steps LSTM reached46.5% arrival/82% discovery, residual MLP37%/72.5%,
original MLP29%/73.5%. This supersedes the pessimistic midpoint judgment: LSTM
rose14.5%->46.5% in the second half and now merits consideration for a matched
longer-training experiment. It does not establish90% or generalize across training
seeds. LSTM post-discovery endings:23 stuck,26 frozen,22 timeout; residual MLP:
30 stuck,1 frozen,40 timeout. Freezing remains disproportionately recurrent.
Do not scale based solely on the100k/250k ranking; learning trajectories crossed.

History and recovery runs have launched on the new50k cadence. History's first
57344 exam:17% arrival/78.5% discovery; no same-budget baseline exam exists, so
do not compare this early percentage directly with500k final results. Recovery
was at49152 without a completed exam at this update. Next useful milestone is
the shared106496 evaluation. Confirmation seeds remain unopened.

### Longer matched training prepared (not launched yet)

`rl/seeker_extension.py` extends residual_lstm and residual_mlp from their OWN
completed scratch507904 checkpoint to2031616 total steps (1523712 additional).
Architectures72517/73637 parameters, observations, original rewards and PPO settings
remain fixed. Restore optimizer moments and decay its final0.000015 rate linearly
to0.000003 over the extension, without an upward reset. New episodes and seed
145032260 start at the continuation boundary; this is explicitly not bit-exact RNG/
environment resumption. Full parent hashes and optimizer evidence are recorded.
Evaluate approximately every50k total steps; confirmation remains reserved.
Use only free CPU slots after the ongoing history/recovery jobs; no duplicate jobs.
Hypothesis: the late LSTM rise continues with more experience; matched MLP duration
separates the memory benefit from simply giving any policy more training. This is
an extension of the single scratch run, not another seed replication or warm walker.

### 204800-step history/recovery update

History:26% arrival/82.5% discovery (23.5%/86.5% at106496); recovery reward:
21%/85% (18.5%/84.5% at106496). Arrival improved modestly in both, but there
are no archived204800 exams for the original controls, so no matched-budget
superiority claim. Next253952 exams permit direct comparisons. Both CPUslots
remain occupied; prepared extensions have not launched. Extension tests passed
for exact optimizer-state preservation and real PPO/LSTM schedule continuation.

### Matched253952 history/recovery results

History25% arrival/79% discovery vs original21.5%/82.5%: modest arrival gain,
weaker discovery. Recovery17%/79.5% vs removal18%/69%: more discovery does not
convert into arrival. Both regressed from their204800 arrival scores26%/21%.
History post-discovery endings21 stuck/4 frozen/83 timeout; recovery16/20/89.
Mean collision rates7.92%/8.84%; failure-capped arrival827.57/881.64 steps.
This remains mixed evidence. Both reached303104 and are evaluating; no free CPU
slots or extension launches. A read-only second review of extension code/tests
was requested from the recurrent-policy analysis agent before launch.

### Owner leaves for30 minutes: next work and additive capacity

Clarified architecture: no MLP capacity was removed for LSTM. Original12997
parameters are retained within the72517-parameter additive recurrent model; the
73637-parameter feedforward comparator was enlarged to control for capacity.
Owner permits larger additive branches without parameter-matching constraints;
AGENTS.md records this. No larger architecture launched yet.

At303104, history33%/76.5% arrival/discovery; recovery15.5%/70.5%. Both continue
their first run to507904. The prepared extension supervisor waits for initial
queue completion, then launches the paired2031616-total continuations using two
CPUslots. These retain34->64->64 direct branches, LSTM64 vs feedforward residual,
72517/73637 parameters, original rewards, same physics, full preserved optimizers,
and LR0.000015->0.000003. Next evaluation557056 total, then roughly50k cadence.
Explicit fresh episode/RNG boundary remains documented. Review found no blocking
defect; fixed saved seed metadata, redundant parent evaluation, and parent identity
assertions. Three extension tests now include seed and no-duplicate-parent checks.
Within30 minutes expect further/final initial-screen results and possibly early
extension results, not completed2M runs or a promised90% solution. The opportunity
for a larger additive model remains a separate capacity experiment after reviewing
longer-training evidence and profiling its compute cost.

### 352k/401k progress

History352256:35.5% arrival/80.5% discovery, up from33%/76.5% at303104.
Recovery352256:24%/79.5%, then401408:23%/78.5%. Recovery recovered from its
303k dip but remains inconsistent. These latest checkpoints have different budgets;
compare final507904 results before ranking against the46.5% LSTM. At the check,
history was evaluating401408 and recovery collecting425984. Extension supervisor
PID26916 is waiting normally; neither continuation has launched. Cleaned extension
config scalar learning_rate/steps to match the explicit extension schedule/horizon.

### Focused best-model trajectory graphs

User requested important learning trajectories including LR. Generated reproducible
`rl/seeker_comparison_graphs.py` outputs under `best_comparison/`: arrival/discovery
and failure-capped arrival time/LR. Earlier fine-tune: donor74% ->77% at106496
additional ->78% at253952; constantLR0.00015. This looks flatter late, but only two
post-start exams cannot prove convergence. Scratch LSTM17%->14.5%->46.5%, with
failure-capped time912->906->634 and LR decaying to0.000015. Its final measured
interval improved strongly; sparse checkpoints do not establish instantaneous
end-of-run slope or prove LR caused the gain. Graphs share200-maze DEV, but x is
steps within each phase; fine-tune had2.285568M ancestral steps beforehand. The
separate80.7% confirmation result is deliberately excluded from learning curves.

### Initial screen complete; extensions launched

All six507904-step scratch runs are complete. History50.5%arrival/85.5%discovery
now leads LSTM46.5%/82%, residualMLP37%/72.5%, original29%/73.5%, removal27.5%/
60.5%, recovery26%/83%. History is a serious longer-training candidate; its4-point
lead over LSTM alone is not proof of superiority across training seeds. Recovery
does not improve final arrival over its matched removal control.

Extension supervisor launched residual_lstm_extension_2m PID24056 and
residual_mlp_extension_2m PID10820. Both passed516096 total steps. Parent SHA256:
LSTM e9327919ef6739161919e3184a90ab2129d44d154125d615f54fed304b832981;
MLP 9d8accc511f03ab121eafea99a2e79a212ca0f193ed1ed4df282b0f80807de78.
Restored optimizer entries25/29, both LR0.000015; no upward reset. First new exam
557056total, full endpoint2031616. Announced architecture/hypothesis/limits at
launch. Supplemental TensorBoard exporter had exited with the initial queue;
updated it to track both queues and restarted after confirming no exporter process.
Do not duplicate either extension. History extension is a possible later addition,
not yet queued. Fresh confirmation remains unopened.

### First continuation exam:557056 total steps

LSTM44.5% arrival/80% discovery vs its parent46.5%/82%; residual MLP39%/72.5%
vs37%/72.5%. No immediate LSTM gain; two-point changes are small exploratory
movements on200 mazes, not convergence evidence. LSTM post-discovery32 frozen,
16 stuck,23 timeout; MLP0 frozen,25 stuck,42 timeout. Both have reached606208
and are evaluating. Latest logged LR1.429032258e-5 in both, correctly below their
1.5e-5 continuation start. Healthy queue, no worker failures. Continue unchanged
to assess multiple50k checkpoints before interpreting a plateau.

### Cross-chat handoff and655360 evaluation

Created docs/SEEKER_HANDOFF.md, generated SEEKER_RUN_INDEX.md/.json covering17
runs across four campaigns, and rl/seeker_run_index.py for refresh without training.
AGENTS/TRAINING/RL_SPEC/original plan now point to these and flag historical advice.
Continuations remain supervised; another chat should read live JSON and never
duplicate workers. At606208 LSTM52%/82.5%, MLP44%/75.5%; at655360 LSTM47%/82%,
MLP43%/72.5%. Record best vs latest separately. Both are active; no confirmation
exam or new architecture launched as part of the documentation handoff.

### 704512-step continuation update

LSTM53.5%arrival/81.5%discovery, MLP44%/76%. LSTM exceeds its prior52% DEV
best by1.5points; the gain is small, not a breakthrough. It also exceeds the
history model's50.5% at a larger budget; this is not a matched-budget architecture
claim. LSTM post-discovery17 stuck/20 frozen/19 timeout vsMLP35/1/28.
Both reached753664 and are evaluating; no worker failure. Run index refreshed.

### LSTM reaches59.5% at802816

LSTM753664:54.5%/82%, matching MLP45%/72.5%. LSTM802816:59.5%arrival/84%
discovery; MLP802816 exam pending at check. Do not compare different latest budgets
as matched. LSTM post-discovery22 stuck/8 frozen/19 timeout; frozen down from20
at704512. This supports ongoing improvement, not a plateau claim. Still below the
earlier fine-tuned78% DEV and goal90%. Focused comparison graphs now include saved
LSTM extension evaluations and logged extension LR, preserving the same phase
and inherited-training caveats. Run index refreshed; both workers healthy.

### 901120: LSTM63.5%, contact now dominates remaining failures

LSTM851968:60.5%arrival/83.5%discovery vs matched MLP44.5%/71%.
LSTM901120:63.5%/84%; MLP901120 evaluation pending. LSTM127 successes/200;
remaining73 endings:56 stuck (28 before/28 after discovery),2 frozen,15 timeout.
Post-discovery frozen count is now1, down from72 at the early253952 checkpoint.
Discovery is fairly flat while arrival increases, indicating better conversion
after finding the target; conditional arrival127/168=75.6%. Contact failures now
account for56/73 remaining failures, a useful next diagnostic if the trend stalls.
Continue current configuration: sustained improvements justify the existing budget.
Run index refreshed. No confirmation or additional architecture launched.

### 950272 dip: distinguish latest from best

LSTM latest95027258.5%arrival/81.5%discovery, below901120 best63.5%/84%.
MLP latest90112042.5%/68% vs its prior44.5%/71%. LSTM reached1007616 and
is evaluating; MLP950272 exam pending. Latest logged LR1.1129e-5 LSTM and
1.1581e-5 MLP differ because progress differs. KL0.00173/0.00252, clipped
fractions1.24%/1.69%; no obvious large-update instability from these diagnostics.
One dip does not establish a plateau or erase previous improvement; continue
the declared run and report best and latest separately. Index refreshed.

### 1056768: recent arrival fluctuates around60%, no frozen endings

LSTM1007616:61.5%arrival/82.5%discovery;1056768:60%/82.5%, best remains
63.5% at901120. At1056768,63 stuck endings (29 pre/34 post),17 timeouts and
zero frozen endings out of200; contact is now the dominant residual failure.
MLP950272:43.5%/68%, best45% at753664;1007616 evaluation pending. LSTM is
collecting1097728. Recent LSTM scores are flatter around60% over~150k steps,
not evidence of the former rapid slope continuing. Keep the declared budget;
diagnose contact trajectories before prescribing more capacity or changed reward.

### Clarification: stuck rule, recovery and learning rate

Verified current step code: stuck counts40 consecutive intended collisions with
actual translation<=0.001 world units, reset otherwise. Rotation alone does not
clear this counter if intended collision persists. This is a classified failure,
not proof that no escape action exists. Safe fallback rotation/translation, rays,
previous-collision/actual-motion feedback and terminal stuck penalty already exist.
TensorBoard/replays help diagnose; they are not an action controller. Prior useful-
contact refund changed reward, not physics, and finished26% vs27.5% removal control.
Owner correctly notes that slowing may reflect LR decay. Never attribute a flat
curve solely to capacity or task limits: declining LR and additional training are
confounded in these runs. A deliberate logged schedule comparison would be needed
to identify its effect; do not silently raise the active learning rate.

### Requested geometry audit and programmatic teacher discussion

Spawned Aquinas01a08749-987c-7b91-a5df-e25c7cb0850f usinggpt-6-astra/low,
the lowest exposed Astra setting (no separate Astra Light option). Freed completed
reviewer Hypatia's slot after spawn hit concurrency limit. Scope: read-only code
and bounded saved-LSTM-replay geometry probes, no training/benchmark mutation or
reserved confirmation. Output docs/SEEKER_ESCAPE_AUDIT_2026-09-09.md plus diagnostic
JSON/script if needed. Distinguish sparse-grid evidence from proof of impossibility.

Programmatic rescue is possible but not implemented. Distinguish legal-action
fallback at runtime (assisted/hybrid-system score), expert action labels with an
explicit imitation-learning objective (test policy unassisted), and teleport/push
outside the action space (changes task dynamics; not evidence of learned recovery).
Do not silently insert expert actions into PPO as policy-sampled actions; preserve
proposed/executed action provenance and handle the learning objective explicitly.
Potential metrics: unassisted/assisted arrival, interventions per episode, recovery
success/time, invalid actions and teacher use of privileged information. These are
future hypotheses only. Current continuation policies and rewards remain unchanged.

### Geometry audit returned; current progress softer

Reviewed Aquinas report/script/JSON:18 stalled poses from only3 distinct mazes,
across1056768/1105920/1155072 checkpoints, all permit immediate0.375-unit movement
and a safe pivot-forward witness before termination.3282 saved transitions and
189 actual-step geometry/counter checks matched. Sample is correlated and selected
from retained failures; local movement does not establish complete escape/arrival.
No evidence here that these specific failures require relaxing physics. Next
intervention research can use legal-action teachers, keeping assisted metrics
separate; no controller/training change made. Report linked from handoff.
Latest training: LSTM1253376 57.5%arrival/83.5%discovery (1204224 60.5%/83%);
MLP1105920 41.5%/64%. LSTMbest63.5% remains901120. Both workers running.

### 1351680 update

LSTM recovered to61.5%arrival/82%discovery at1351680, still below best63.5%.
MLP latest1155072:42%/68.5%; collecting/evaluating1204224. Both worker states
healthy. Recent LSTM oscillation around60% is not sustained improvement beyond
the901k best. Finish the declared extension rather than silently resetting LR or
injecting recovery assistance. Geometry audit remains diagnostic-only. Index refreshed.

### 1400832 /1253376 update

LSTM1400832:60%arrival/83%discovery, still below63.5%best at901120; collecting
1458176. MLP1204224:45.5%/69.5%,1253376:46.5%/68%, a new MLP continuation
best; collecting/evaluating1253376. MLP arrival is improving despite weaker
discovery, but these latest budgets differ and are not a matched comparison.
Both workers healthy; no schedule or objective changes. Index refreshed.

### 1507328 /1302528 update

LSTM1458176:60%/84.5%,1507328:59.5%arrival/82.5%discovery; latest collected
1523712. MLP1302528:46%/71%, collected1318912. Neither sets a new best;
best63.5% LSTM and46.5% MLP. Sustained recent flattening under the declining-LR
schedule is now evident, but does not identify whether optimizer rate, capacity,
or behavior is limiting. Both continue the declared2.03M budget; index refreshed.

## Gradient telemetry audit (2026-09-09)

Owner asked whether small gradient updates explain the LSTM plateau. Read-only
analysis implemented in `rl/seeker_gradient_report.py`; outputs under active
campaign `gradient_audit/` (audit.json and optimizer_trends.png). No training
configuration, optimizer, reward, or running process changed.

LSTM `train/gradient_norm` is the mean minibatch combined actor+critic norm BEFORE
max-norm0.5 clipping. MLP does not log this metric. No per-branch gradients,
postclip norms, gradient clipping frequency, or actual Adam weight delta is logged.
`train/clip_fraction` means PPO probability-ratio clipping, not gradient clipping.

Window medians: first254K raw norm16.57, LR1.152e-4, KL0.00420; after1.2M through
1.6384M raw norm190.30, LR7.839e-6, KL0.00114. Value loss rises3.33 to14.56;
explained variance remains about0.874 late. These are correlations: combined
vanishing gradients are not supported; critic-dominated clipping and reduced LR
are plausible contributors, not established causes. Adam moments mean raw norm
and clipping scale cannot be converted directly into actual weight updates.

Latest evaluated LSTM1,605,632:60% arrival,84.5% discovery,71 contact-stuck failures
(29 before discovery,42 after),9 timeouts,0 frozen; best remains63.5% at901,120.
Next diagnostic instrumentation should split actor/critic and MLP/LSTM gradient
norms, record postclip norm/clipping frequency and actual update-to-weight ratios.
Existing processes cannot acquire new telemetry without restarting; do not silently
restart them. A future LR-floor or clipping experiment needs a declared control;
finish the existing budget without claiming the plateau's cause is proven.

### 18:27 UTC live check: LSTM1.704M / MLP1.401M evaluations

Both extension workers and supervisor verified alive; queue reports no failures.
LSTM collected1,712,128; evaluations1,654,784:61.5%arrival/85%discovery,
1,703,936:60.5%/80.5%. Latest79 failures comprise66 stuck and13 timeouts;
no frozen endings. Best remains63.5% at901,120; plateau persists.
MLP collected1,458,176; latest completed evaluation1,400,832:43.5%/68.5%,
below its46.5% best. Current evaluation budgets differ, not a matched comparison.
Next milestones: LSTM1,753,088; MLP1,458,176 evaluation pending in snapshot.
Continue declared2,031,616 totals unchanged. No new training or controller launched.
Gradient telemetry audit remains the next-experiment diagnostic priority; no causal
claim from falling KL and rising pooled gradient norms.

### 18:33 UTC update (00:03 IST September10)

Initial queue complete; extension queue running without reported failures.
LSTM latest completed1,753,088:62% arrival/83.5% discovery, up1.5pp from preceding
60.5% but below63.5% best.64 stuck and12 timeout failures; no frozen endings.
Collected1,802,240, next evaluation pending. MLP1,458,176 tied46.5% best with
73.5% discovery;1,507,328 then45.5%/69%, collected1,515,520. Next MLP eval1,556,480.
No demonstrated breakout. Models retain original configuration through2,031,616.
Do not treat small same-panel fluctuations as a new established improvement.

### 18:39 UTC update (00:09 IST September10)

Queues: initial complete, two extensions running, no reported failures.
LSTM1,802,240:60.5%/82%;1,851,392:61.5%arrival/81.5%discovery,65 stuck and12
 timeout failures. Collected1,900,544, evaluation pending;131,072 transitions
remaining to declared2,031,616 (evaluation overhead excluded from step budget).
MLP1,556,480:46.5%/69%, tying best arrival; collected1,605,632 evaluation pending.
No new best or plateau breakout. Gradient graph and generated index refreshed.
No training changes, restarts, extra runs or confirmation-set access.

### 18:45 UTC update (00:15 IST September10)

LSTM1,900,544:61%arrival/81.5%discovery;1,957,888:63%/84%, near but below63.5%
best.65 stuck and9 timeout failures, zero frozen. Collected1,974,272;57,344
transitions remain, plus evaluation time. Next scheduled eval2,007,040 then final
2,031,616. MLP1,605,632:49.5%arrival/70.5%discovery, NEW development best (+3pp
versus previous46.5%, six additional arrivals on200 mazes);37 stuck and64 timeout
failures. Collected1,654,784 evaluation pending. Single-policy development-panel
result, not confirmation evidence or proof of sustained improvement. Both remain
running, queue reports no failures. No settings changes or new launches.

### Failure composition and seeking audit requested by owner

Regenerated report/outcomes.png and metrics.png. Frozen snapshot in chart:
LSTM2,007,040:122 arrivals,29 pre-discovery stuck,4 pre-discovery timeouts,
38 post-discovery stuck,7 post-discovery timeouts, zero frozen (200 total).
MLP1,654,784:102 arrivals,12 pre-stuck,43 pre-timeout,24 post-stuck,19 post-timeout,
zero frozen. Latest MLP51% is a new development best; budgets differ.
LSTM non-stuck-ending subset122/133=91.7% arrival is selected observational data,
NOT the causal success rate of a rescue controller. All67 stuck failures magically
converted to arrivals would give94.5%, but this is arithmetic only, not a forecast.

Actual LSTM zero-collision counterexamples from dev_2007040_episodes.json:
seed30002:1000 steps,342.382 path units,never detected,38 unique cells,98 revisits,
revisit rate72.6%; seed30052:detected259,1000 steps,323.925 path units,zero collisions,
no arrival. Therefore neither no-contact nor discovery guarantees arrival.

Discovery denominator matters:63/200 targets initially visible. Among137 initially
hidden LSTM episodes,104 discovered (75.9%);29 stopped stuck before discovery and4
never discovered before timeout. Overall83.5% includes the63 initially visible.
History hidden discovery108/137=78.8% at507904; latest MLP82/137=59.9%.
Contact prematurely cuts off search, and collision-free revisiting supplies direct
 evidence of inefficient search; cannot infer a single reward/optimizer cause.
Prioritize hidden-only discovery and failure-capped discovery time, distinguish
contact-shortened search from moving/revisiting timeouts. Evaluate any rescue
intervention separately; do not treat filtering failed episodes as an intervention.

### LSTM extension COMPLETE; MLP new54% best (18:56 UTC)

LSTM completed2,031,616 transitions, final deterministic DEV60.5%arrival/80%
discovery.121 arrivals,68 stuck (35 pre/33 post),11 timeouts (5 pre/6 post),0 frozen.
Best remains63.5% at901120. Extension improved final arrival14pp over507904 parent
46.5%, but last1.13M steps did not beat the901120 peak. Do not extend this exact
configuration automatically; inspect gradient balance and recovery before another
training intervention. Final hidden discovery97/137=70.8%; overall includes63
initially visible. Confirmation untouched.
MLP latest1,753,088:54%arrival/78.5%discovery NEW best;49 stuck and43 timeout
failures. Previous1,703,936:50.5%/74.5%. Collected1,769,472, still running to2,031,616.
Supervisor active only MLP, no failures. No new run launched; freed slot not reused
without a declared experiment and audited configuration. Refresh reports/index.

### Owner completion and TensorBoard shutdown instruction

User requested notification when all current training completes and TensorBoard
shutdown afterward. LSTM complete; MLP still running, snapshot1,851,392 collected,
latest1,802,240:54%arrival/76%discovery.180,224 transitions remain plus evaluations.
Existing five-minute heartbeat updated to finish this batch, refresh artifacts,
then verify and stop only workspace TensorBoard server and supplemental watcher,
preserve logs, notify owner and pause monitoring. No additional training launches
in this completion phase. Server PID11540 and watcher33172 must be revalidated.

### 19:09 UTC /00:39 IST completion check

MLP remains running:1,941,504 collected,90,112 transitions remaining plus evals.
Latest1,900,544 evaluation NEW best57%arrival/83%discovery; previous1,851,39252%/
80.5%. Latest86 failures:44 stuck and42 timeouts, zero frozen. LSTM complete,
unchanged final60.5%/80%, best63.5%. TensorBoard remains running until MLP and
supervisor complete per owner. No new launches. Generated index refreshed.

### 19:15 UTC /00:45 IST completion check

MLP latest1,957,888:NEW best59%arrival/82.5%discovery (118/200 arrivals).
47 stuck and35 timeout failures. Collected2,007,040, evaluation pending,24,576
training transitions remain before final2,031,616 plus evaluation overhead.
Queue still running with MLP only, no failures. TensorBoard kept alive pending
completion; no new launches. MLP late gains narrow the gap to LSTM, but compare
final equal budgets before concluding. Run index refreshed.

### Batch COMPLETE and TensorBoard stopped (19:26 UTC /00:56 IST)

Both extensions and supervisor complete, no failed jobs or queued work. Equal
2,031,616 totals: LSTM60.5%arrival/80%discovery (best63.5% at901120), MLP56.5%/
77.5% (best59% at1957888). MLP final113 arrivals,37 stuck,49 timeouts,1 frozen;
LSTM121 arrivals,68 stuck,11 timeouts. Final gap4pp, eight mazes, single training
configuration each; not proof across seeds. Confirmation untouched,90% not met.
Report, gradient plots and index regenerated; handoff completion notice added.
Verified no trainer/supervisor/watcher processes remained. Revalidated TensorBoard
PID11540 exact module/logdir/port, terminated and waited; socket port6006 returned
10061 (connection refused). All logs/models preserved. Existing heartbeat paused
as completion delivery closes this batch; no new experiments launched.

### Consolidated scientific handoff requested by owner

Created docs/SEEKER_FINDINGS_AND_NEXT_EXPERIMENTS_2026-09-10.md with the complete
batch synthesis, final/best results and uncertainty, architecture/reward contracts,
geometry and gradient audit limits, collision-free wandering examples, hidden-only
discovery, recovery-refund interpretation, prioritized prospective experiments,
and multicore CPU/multiprocessing benchmark protocol. Linked from AGENTS.md,
SEEKER_HANDOFF.md and SEEKER_EXPERIMENT_PLAN.md; corrected stale live-work notices
at their entry points. Owner expects larger-CPU training next session; no new
training, environment/reward changes or monitoring restarts made by this doc task.
