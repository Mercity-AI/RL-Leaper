# Seeker experiments — 9 September 2026

Objective: push deterministic stationary-target arrival beyond 90%. This is a measured objective, not a promised result. No browser champion is replaced during research.

## Protocol fixed before training

Owner overrides the older plan's replication requirement: **one training run per configuration**, no three-seed repeats. All initial arms use one naturally drawn seed and the exact same donor, `ppo_35_frontier_seed025_500k_s1/leaper_ppo.zip`. The seed, donor SHA-256, development/confirmation IDs and selection rule are frozen in `rl_artifacts/seeker_20260909/protocol.json`.

Four initial arms: continued MLP (03), newly visible space reward (12), visitation-reward removal with zero-coefficient ICM (16), and capped ICM reward (17). Stationary arenas, physical rules, PPO settings and donor remain fixed. Each healthy arm gets 253,952 additional transitions, with a 106,496 checkpoint. Promising candidates and matched controls may continue to 507,904. No curriculum or recurrent branch is bundled into these reward comparisons.

All use 34 inputs: unchanged donor channels 0–30 plus actual displacement x/z divided by 0.375 and wrapped actual yaw displacement divided by 9 degrees. New input columns are zero; donor action/value equality is tested even with nonzero odometry. These experimental changes live under `rl/`; the production environment defaults are unchanged.

Development: 200 mazes, seeds 30000–30199. Historical seeds 10000–10099 remain a reference. The plan's proposed 20000 series is already used in replay generation and is not claimed unseen. Confirmation: seeds 80000–80999, reserved until model selection is frozen. Selection: development arrival success, then fewer early physical failures, then lower failure-capped arrival time. Per-maze results support paired differences; one training seed does not estimate across-training variability.

## Runtime and audit

RTX 3050 Laptop GPU, 4 GB, driver 592.82 is present. Available PyTorch 2.13.0+cpu reports CUDA unavailable. Owner permits CPU fallback, so no GPU package migration was attempted. The broken `.venv` launcher is bypassed with bundled Python 3.12.14 and the existing project package directory. `run_seeker.ps1` records the explicit launch recipe; every run snapshots package versions, interpreter path, source hashes, Git revision, existing working-tree patch, seed and configuration. This is a documented compatibility runtime, not a newly installed virtual environment.

Runtime verification records actual imported versions and file locations in `runtime.json` and per-run `runtime_verification.json`: NumPy **2.5.2**, Gymnasium1.3.0, SB3/contrib2.9.0, Torch2.13.0+cpu, Matplotlib3.11.1, TensorBoard2.21.0. Distribution metadata inventory contains a conflicting NumPy2.3.5 entry; treat actual imported-module versions as authoritative. No Python packages changed during these runs. Later configurations also record imported versions directly; the original metadata inventories remain intact for audit.

Audit: 23 focused wrapper/ICM tests passed. Independent note-mask audit reproduces pre-detection trajectories on seeds 10000–10005, and reconciles all 1,200 archived outcomes. Evidence: `rl_artifacts/seeker_20260909/audit.json`. Audit supports measuring contact/freeze separately from discovery, rather than attributing every failure to inadequate search memory.

## Measurements

- Deterministic development arrival, discovery, arrival conditional on discovery, initially visible/hidden strata, and pre/post-discovery stuck/frozen/time-limit flags.
- Detection time (null if undetected), failure-capped detection/arrival time, successful arrival and pursuit time, unique visible area at discovery/end, physical path length, revisits only after leaving a cell, collision rate/streaks, action saturation.
- Every completed stochastic training episode with the six task reward components, curiosity payout separately, contact payout, payout without new visibility, and budget exhaustion. Stochastic figures remain separate from deterministic results.
- PPO optimizer metrics in TensorBoard/CSV, per-rollout throughput and wall time, independent curiosity inverse/forward losses, error RMS and payout. Model/module/optimizer checkpoints; exact mid-episode resume is not claimed.
- Same fixed illustrative maze panel and automatically selected worst failure, with trajectories and coverage deltas. Evaluation disables all intrinsic rewards/learning.

Each artifact directory has a source snapshot and a status record; failed or interrupted attempts remain recorded. Generated artifacts are ignored by Git. Final results and interpretation will be appended after evaluation.

## Run ledger

| Run | Change | Budget | Status / finding |
|---|---|---:|---|
| donor baseline | Evaluation only, zero-added-input weights | 200 development mazes | Complete: 74% arrival, 88% discovery, 84.1% arrival given discovery |
| control_250k | Continued donor with actual odometry | 253,952 additional transitions | Complete: 72.5% arrival, 90.5% discovery |
| visibility_250k | Replace cell/view bonuses with newly visible fraction | 253,952 | Complete: 76% arrival, 87.5% discovery |
| removal_250k | Remove cell/view bonuses; zero-paid independent ICM | 253,952 | Complete: 78% arrival, 89.5% discovery |
| icm_250k | Activate capped pre-discovery ICM bonus | 253,952 | Complete: 76.5% arrival, 89.5% discovery |
| footprint_250k | Add whole-footprint local clearance to original control | 253,952 | Complete: 76.5% arrival, 85.5% discovery |
| stall_memory_250k | Expose two self-motion stall counters to original control | 253,952 | Running |

TensorBoard: http://127.0.0.1:6006/ . Deterministic replay viewer: http://127.0.0.1:5173/?training=1 .

The viewer now labels the replay with its saved experiment name; the last completed checkpoint remains on screen until the active run produces a new evaluation. This is a UI-only change. Direct Vite production build and an actual browser replay check passed. The package-manager build helper first failed during its automatic dependency-script check; its log is retained, and the existing Vite build then succeeded without changing dependencies or approvals.

### Baseline finding

Development outcomes: 148 arrivals / 200. Before detection: 11 stuck, 9 frozen, 4 time limits. After detection: 25 stuck, 2 frozen, 1 time limit. Thus 47 of 52 failures are physical early endings; pure time-limit search failure is a small share. Mean successful arrival is 109.3 steps; the failure-capped average is 340.9. Mean final visible coverage is 65.8%, pooled collision steps 5.49%. This is an evaluation of the historical donor with zero-weight extra inputs, not a newly trained result.

Control full-loop throughput through seven rollouts: approximately 530 transitions/sec with one PyTorch thread, including optimizer work and simultaneous read-only baseline/calibration work. Final evaluation overhead is still to be added. The configured natural seed is 123953224.

### First control checkpoint

At 106,496 additional transitions: 73.5% arrival, 89.5% discovery, 82.1% arrival conditional on discovery. Before discovery: 11 stuck, 5 frozen, 5 time limits; afterward: 29 stuck, 3 frozen, no time limits. Interpretation: more practice and odometry have not yet improved arrival; the small discovery difference does not establish an effect. Continue to the fixed 253,952 budget without changing settings.

### Curiosity readiness

Calibration collected 24,576 deterministic donor transitions in 49.68 seconds; 12,831 pre-discovery transitions were eligible. No policy or curiosity updates occurred. The same saved calibration data initialize both removal and active-ICM error scales. Integration checks now bring the total to 28 passing tests, including exact two-update PPO buffer/parameter/Adam equality with zero-paid ICM versus no ICM, executed-action clipping, discovery/terminal gating, timeout bootstrapping, and extrinsic/intrinsic logging separation.

### Control final finding

253,952 additional transitions: **72.5% arrival, 90.5% discovery, 80.1% arrival conditional on discovery**. More practice plus actual-motion feedback did not improve arrival versus the donor's 74%; finding the target more often did not solve reaching it. Keep the 106,496 checkpoint visible (73.5%) as well as this final result; do not report only the best checkpoint. Training through the last rollout took 531 seconds, plus the last optimizer/evaluation. This is one seed and does not establish that odometry itself caused a decline.

### Contact-action diagnostic (evaluation only)

Replayed all 52 baseline failures; saved outcomes matched exactly. At the final pose, 48 had a translating alternative among nine tested throttle/turn pairs. The other four had feasible smaller movements on a denser action grid. These are local mobility tests, not demonstrations of a complete route to the target. In the last up-to-100 steps per failed episode, 1,479 collision steps were attributed to `leg-3`: this label means the outer sample along a leg, not the third of the six legs. Of 1,475 blocked-translation contact steps, 1,314 had an alternative translating action on the small grid. In 1,429 poses, full-footprint forward clearance was under one movement step while the body alone had more clearance.

Interpretation: physical failure is largely ineffective action selection with outer-leg contact, not demonstrated mechanical entrapment. This motivates a possible later **additional short-range full-footprint clearance sensor** experiment if reward changes plateau. It would be a stronger sensor than current body-center rays, not free information reconstructed from them, and would not override actions or relax collisions. It is being prepared separately; none of the four reward arms receives it. Evidence: `clearance_diagnostic.json`.

### Curiosity scripted probes (module-only engineering check)

The independent ICM was trained for 20 passes over 405 scripted transitions covering open movement, scanning, loops and blocked contact, not as a policy training run. A separate 512-transition probe remained held out. The contact fixture still earned 0.39 curiosity reward over 40 collision steps after those updates; a looping fixture also earned reward without revealing new cells. Therefore surprise is demonstrably not equivalent to useful exploration. The cap bounds this incentive but does not prevent it. Existing collision and terminal penalties remain much larger and unchanged. The main ICM arm is not initialized from these probe updates. Full settings, trajectories, losses and hashes: `curiosity_probe/probe.json`; chart: `curiosity_probe/probe.png`.

### Visibility first checkpoint

106,496 additional transitions: **73.5% arrival, 85.5% discovery**, compared with the control's 73.5%/89.5% at the same budget. Conditional arrival is 86.0%, higher than the control's 82.1%, but lower discovery cancels that improvement in overall arrival. Before detection: 9 stuck, 14 frozen, 6 time limits; afterward: 24 stuck, no frozen/time limits. Hypothesis is not supported at this checkpoint; finish the predeclared budget without tuning.

### Visibility final finding

253,952 transitions: **76% arrival, 87.5% discovery, 86.9% arrival conditional on discovery**. Arrival is +3.5 percentage points over the matched continued control and +2 over the donor. Discovery is lower than control; the gain comes from better conversion after discovery. This small single-run gain is promising only provisionally and does not meet the 90% objective. The first 100k checkpoint alone would have missed the eventual improvement; completing the predeclared budget mattered. Removal and active-ICM comparisons remain necessary before choosing a reward.

Paired maze-bootstrap intervals: visibility minus control **+3.5 points, 95% interval [-0.5, +8.0]**; visibility minus donor **+2.0 points, [-2.5, +6.5]**. These fixed-policy intervals exclude training-seed variability and do not correct for development selection. They do not establish a reliable winner yet.

### Prepared sensory follow-up (not yet launched)

`FootprintSeekerEnv` keeps all 34 inputs and appends 16 normalized six-unit clearances for the full 19-circle body/leg footprint, along the existing 270-degree directions. These are hypothetical stronger multi-origin proximity sensors, including footprint-width inflation; they are **not** reconstructed from the existing body-center thin rays. They supply nearest contact distance for translation at fixed yaw, not an action override or guaranteed safe turn. All geometry, reward, target hiding, model layers and PPO settings stay fixed; only input information and the corresponding first-layer columns grow. Those columns start at zero, preserving the donor at step zero. The policy grows from 12,997 to 15,045 parameters. Ten new sensor tests pass, bringing focused checks to 38.

Decision rule: consider a single 253,952-step sensor run after the four reward arms if arrival remains far below 90% and contact failures remain important. Compare it with the existing control at matched budget and seed. Do not combine it with the best new reward in that first test. The contact diagnostic, rather than reward leaderboard alone, motivates this separate hypothesis.

The wider network preserves donor action means, values and log-standard-deviations within tested numerical tolerance. A common numeric seed does not imply identical sampled training trajectories across input widths: constructing a wider network consumes different initialization RNG draws. No stochastic-trajectory identity is claimed for the sensory comparison, and it is not replicated by owner instruction. All final policy comparisons still use exactly the same deterministic maze seeds.

### Removal first checkpoint

106,496 transitions: **77% arrival, 88% discovery, 87.5% arrival conditional on discovery**, with the curiosity reward coefficient exactly zero. Both control and visibility were 73.5% arrival at the same budget. This suggests reward removal itself may account for a gain; it makes an active-ICM versus removal comparison essential. Finish the fixed budget before deciding whether the effect persists. No bonus settings changed during the run.

### Removal final finding

253,952 transitions: **78% arrival, 89.5% discovery, 87.2% arrival conditional on discovery**. Arrival improves +5.5 points over the matched control, +2 over visibility, +4 over the donor. The improvement persists from the first checkpoint, but remains one training seed and below the owner's 90% objective. This supports testing whether the old cell/view incentives were distracting; it does not prove a universal causal effect. The ICM module remains independent and zero-paid throughout this run. Active ICM now changes only the bonus coefficient from 0 to0.01 with the same cap, seed, donor, architecture, optimizer and calibration.

Paired arrival difference versus control: **+5.5 points, 95% maze-bootstrap interval [+0.5, +10.5]**. This supports a difference on the development maze sample, with the previously stated training-seed/selection limitations. Successful arrivals take 110.5 steps on average; all-maze failure-capped arrival is 306.2 steps. Remaining failures: 9 pre-discovery stuck, 8 frozen, 4 time limits; 22 post-discovery stuck and 1 time limit. Physical failures remain dominant.

### ICM first checkpoint

106,496 transitions: **73% arrival, 88% discovery, 83.0% arrival conditional on discovery** versus removal's 77%/88%/87.5% at the same budget. The added curiosity bonus has not improved discovery; its shared-policy training influence also worsens post-discovery outcomes despite payment stopping at discovery. This is a checkpoint finding, not the completed comparison. Finish the fixed budget with no coefficient or cap changes.

### ICM final finding and reward-branch decision

253,952 transitions: **76.5% arrival, 89.5% discovery, 85.5% arrival conditional on discovery**. Removal scored78%/89.5%/87.2%. Curiosity provides no discovery gain and is1.5 points below removal on arrival. It has not earned its implementation/training overhead in this tested configuration. Do not attribute its gain over the original control to curiosity: removing the visitation bonuses alone performs better. This does not reject every curiosity algorithm or coefficient; no RND or ICM coefficient sweep was run.

Completed reward branch: control72.5%, visibility76%, removal78%, ICM76.5% arrival. None is near90%, and known-target physical failures persist. Proceed with the independently tested full-footprint sensor hypothesis once, using **original control rewards**, not reward removal or ICM. Same seed, donor, PPO settings and253,952 budget; protocol decision saved in `sensor_decision.json`. This gives a clean control-versus-sensors comparison before considering combinations. Confirmation has not been accessed.

### Footprint first checkpoint

106,496 transitions: **75% arrival, 88% discovery**, versus the control's73.5%/89.5%.
Pre-discovery endings:8 stuck,12 frozen,4 time limits. Post-discovery:19 stuck,7 frozen,
no time limits. Fewer contact-stuck endings do not translate into a strong arrival gain;
frozen behavior partly replaces contact failures. Finish the original fixed budget.

### New diagnostic hypothesis: explicit stall history

The MLP receives previous collision/action and one-step actual displacement, but not
the consecutive-stall counts that trigger terminal penalties. At a static blocked pose,
the first34 observations can become exactly constant while the hidden stuck/freeze
counters approach failure. The same deterministic input then produces the same action.

Prepare a separate36-input continuation: append `stuck_steps/40` and `freeze_steps/60`,
reset to zero and clipped to[0,1]. These are maintained history of the robot's own
collision/motion outcomes, not target or map information. Keep original control rays,
rewards, physics and network layers; zero the two extra input columns.13,253 parameters.
Hypothesis: the policy can learn to change a recovery action as a stall persists, and
the critic can distinguish a first blockage from imminent terminal failure. This is a
small explicit-memory experiment, not an LSTM or action override. Run once after the
footprint comparison if90% remains unmet; compare at the same253,952 budget. Do not
combine with reward removal or footprint sensors in this first test.

### Footprint final finding and stall-memory launch

253,952 transitions: **76.5% arrival, 85.5% discovery, 89.5% arrival conditional on
discovery**. Control was72.5%/90.5%/80.1%; reward removal was78%/89.5%/87.2%.
The sensory branch improves conversion after discovery but reduces discovery.
Pre-discovery failures:6 stuck,21 frozen,2 time limits; afterward:16 stuck,1 frozen,
1 time limit. This is a concrete tradeoff, not a clean win: avoiding contact can
coexist with failing to move while searching. It does not justify combining the
sensor with a new reward as though both were established independent wins.

Launched `stall_memory_250k` once, with original control sensors/rewards and the two
additional stall-history inputs only. Eight new tests verify exact old-observation
and reward preservation, counter updates/resets, donor equivalence, and the specific
aliasing case: repeated blockage leaves old34 inputs constant while the two new
counters change. **46 focused tests pass**. No episodes were made easier and no
failed actions are replaced by code. The common seed remains123953224.

### Stall-memory first checkpoint

At 106,496 transitions: 72.5% arrival, 89% discovery, 81.5% arrival conditional on
 discovery. The same-budget control scored 73.5% arrival / 89.5% discovery. There
 is no early improvement. Pre-discovery failures: 10 stuck, 7 frozen, 5 time limits;
 afterward: 31 stuck, 1 frozen, 1 time limit. Finish the fixed 253,952 budget.

User update clarified that the footprint sensor supplements rather than replaces
body rays, measures fixed-yaw whole-footprint translation, and does not guarantee
safe turning. No new LSTM has been implemented or trained in this campaign. The
planned residual 64-unit LSTM requires correct contiguous sequence training,
burn-in, per-worker state resets and timeout bootstrapping, plus a similarly sized
feedforward comparator. Its healthy learning floor is about 500k additional steps;
100k is an engineering/early-learning screen, not a verdict on memory.

### Stall-memory final and frozen screen selection

253,952 transitions: **74.5% arrival, 89.5% discovery, 83.2% arrival conditional on
 discovery**. Pre-discovery failures: 9 stuck, 6 frozen, 6 time limits; afterward:
30 stuck, no frozen/time-limit failures. This is only +2 points over the control,
and does not solve known-target contact recovery. The richer sensor and the two
stall counters are informative negative/mixed experiments, not promoted winners.

All six single-training-run configurations are complete. Selection across the
predeclared 106,496 and 253,952 checkpoints chose **removal_250k/model_253952.zip**
(78% development arrival). `screen_selection.json` freezes candidate/control hashes,
all ranked candidates, the rule, and confirmation scope before any held-out outcomes.
The equally trained control and selected removal policy now evaluate on the same
1,000 seeds 80000–80999. These are fixed-policy evaluation episodes, not retraining.
No subsequent model choice or tuning in this screen may use confirmation outcomes.

Evaluation logging refinement after confirmation launch: future evaluation processes
print an episode-count progress line every 100 episodes. This changes console
visibility only, not measurements, selection, or policy behavior; the already-running
confirmation processes imported the earlier evaluator and will report at completion.

### Reserved confirmation complete: useful gain, 90% still unmet

On the 1,000 frozen mazes, the selected removal policy reaches **807/1,000 (80.7%)**,
versus **758/1,000 (75.8%)** for the equally trained control. Wilson 95% intervals:
78.1–83.0% and 73.0–78.4%. Paired arrival difference **+4.9 percentage points**;
10,000 paired maze bootstrap resamples give **[+2.7, +7.1]** points. The model hashes
match the selection record and both episode panels contain exactly seeds 80000–80999.

Discovery is 91.2% versus 91.3%; arrival after discovery is 88.5% versus 83.0%.
Thus this configuration's improvement is chiefly conversion after discovery, not
finding the target more often. The result supports this fixed-policy improvement
beyond development selection. It does not quantify training-seed repeatability.
No confirmation-driven tuning or replacement of the selected model was performed.

All six screen runs are complete, each with 253,952 additional transitions and one
training seed: 1,523,712 additional transitions total. No new recurrent model was
trained. The next planned architecture comparison remains a 64-unit residual LSTM
and similarly sized feedforward branch, preserving the walker and holding sensors
and rewards fixed within that comparison. Correct sequence/burn-in/state handling
needs implementation and validation before a roughly 500k learning run. These are
next steps, not jobs already launched or completed. The production ONNX is unchanged.

Results and intervals: `rl_artifacts/seeker_20260909/confirmation_comparison.json`
and `report/confirmation_comparison.md`. Per-policy episode JSON, summary JSON and
compressed fixed/worst replays accompany each confirmation. The best screen model
is `removal_250k/model_253952.zip`; this is a research checkpoint, not a claim of >90%.
