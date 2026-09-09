# Start here: current seeker research

Read [the consolidated findings and next experiments](SEEKER_FINDINGS_AND_NEXT_EXPERIMENTS_2026-09-10.md)
for the next session: final results, uncertainty, recovery/wandering mechanisms,
gradient diagnostics and the larger-CPU benchmark plan. No new training is queued.

## Completion update: September10, 00:56 IST

All six scratch screens and both extensions are COMPLETE. No training is queued.
Both extensions finished2,031,616 transitions: LSTM final60.5% arrival/80%
discovery, best63.5% at901120; MLP final56.5%/77.5%, best59% at1957888.
Same200 development mazes; reserved confirmation remains untouched. The90% goal
has not been reached. LSTM final failures:68 stuck,11 timeouts; MLP37 stuck,
49 timeouts,1 frozen. Longer training narrowed the final architecture gap to4pp;
do not assume that difference is established across training seeds.

TensorBoard server stopped at owner's request after all training completed;
port6006 verified closed. Supplemental watcher and training/supervisor processes
had already exited. Models and event files preserved. Completion heartbeat is
paused. Saved charts: active campaign report/outcomes.png, report/metrics.png
and gradient_audit/optimizer_trends.png. Read the run log for gradient and escape
audits before designing a new experiment. Older live-work snapshots below are
historical and must not be used to restart any supervisor or worker.

This is the cross-chat handoff for E:/Leaper, written9 September2026. Status changes
when work resumes. **Read live status JSON before launching or stopping anything.**
The owner may open another chat to ask questions; that does not authorize duplicate
training jobs. This task's existing five-minute heartbeat is paused after completion.

## Objective and owner decisions

- Seek a stationary, initially hidden target in randomized arenas; target >90%
  deterministic arrival. Do not switch to moving targets yet.
- New architectures start from random weights. Continuing their own scratch run
  is allowed; silently importing an old walker is not.
- One training run per configuration; no automatic seed replications.
- Log all run configs, initial weights/optimizer evidence, model hashes, results,
  diagnoses, failed/interrupted runs and changes. Keep stochastic training success
  separate from deterministic evaluation.
- Announce launches with architecture/counts, hypothesis, changes/control, origin,
  budget, LR schedule, validation and limitations. Update every five minutes.
- New evaluations approximately every50k steps, aligned to8192-transition rollouts.
  Keep fixed development mazes and reserve final confirmation for frozen selection.
- Capacity matching is a control, not a restriction. The LSTM is additive; its
  original MLP was never shrunk. Larger1–2M-parameter architectures and longer
  runs are permitted when justified; no such large model has launched yet.

## Live work: do not duplicate

Active campaign: `rl_artifacts/seeker_scratch_lr_20260909/`.

- `queue_status.json`: original six-run screen, now complete.
- `extension_queue_status.json`: current two-job continuation supervisor.
- `<run>/status.json`: latest collected total steps; may say training during an
  evaluation. Only `evaluations.jsonl` or complete `dev_*_summary.json` proves an
  evaluation result. Do not confuse current training step with evaluated step.
- `residual_lstm_extension_2m` and `residual_mlp_extension_2m` are active. They
  continue their own507904-step parents to2031616 total,1523712 additional steps.
  Supervisor PID26916; initial worker PIDs24056/10820 (verify, PIDs can change).
- No history extension or larger architecture is queued. Two CPU training slots.
- Five-minute automation: `seeker-experiment-completion`. Do not create a duplicate.

Latest measured snapshot: LSTM901120 total steps63.5% arrival/84% discovery.
Latest matched851968: LSTM60.5%/83.5%, MLP44.5%/71%. MLP901120 evaluation
was pending; both runs remain active. LSTM contact failures dominate its remaining
73 failures (56 stuck), while only2 episodes froze at901120.
Consult [generated run index](SEEKER_RUN_INDEX.md) and live files for newer results.

## Results and comparisons

All current DEV results use the same200 seeds30000–30199. Initial screen,507904
steps per model:

| Run | Arrival | Discovery | Meaning |
|---|---:|---:|---|
| history_mlp |50.5%|85.5%|Current plus1/4/16-step observations |
| residual_lstm |46.5%|82%|Parallel memory branch |
| residual_mlp |37%|72.5%|Similar-sized feedforward control |
| original_mlp |29%|73.5%|Original exploration rewards |
| removal_mlp |27.5%|60.5%|Remove cell/view exploration bonuses |
| recovery_reward |26%|83%|Removal rewards plus useful-contact refund |

LSTM trajectory106496/253952/507904:17%/14.5%/46.5% arrival. It looked poor at
the midpoint, then improved sharply. First continuation557056 dipped44.5%, then
606208 improved52%, then655360 fell47%. This is not yet90% or proof of convergence/seed robustness.
History likewise improved late. Never select solely on100k rankings.

Earlier best fine-tuned model: `seeker_20260909/removal_250k/model_253952.zip`.
It scored78% on the same200 DEV mazes, then80.7% on a separate1000-maze confirmation
exam (seeds80000–80999). Its donor had2285568 ancestral steps; this fine-tune brings
the recorded total to2539520 across changing training stages. This is not equivalent
to that many steps of today's scratch task. Audit: `seeker_20260909/donor_lineage.json`.
Fine-tune LR was constant0.00015; do not claim it used today's decay.

**Current confirmation seeds120000–120999 remain unopened.** Freeze candidate and
control hashes before using them; never tune against confirmation. Old known-target
walker percentages in historical docs concern different tasks and cannot rank
today's hidden-target seeker directly.

## Architecture and training contract

Observations34, actions2 (normalized throttle and turn; throttle maps to forward-only
movement). Separate actor/critic networks; actor outputs Gaussian action means and
learned standard deviations, critic a scalar value.

- Base MLP34→64 Tanh→64 Tanh:12997 total parameters.
- Additive LSTM: same direct MLP plus separate actor/critic34→LSTM64→Linear64,
  add64-dimensional branch outputs;72517 parameters.
- Capacity control: same direct MLP plus34→128→112→64 Tanh→Linear64 branches;
 73637 parameters. Extra output projections start zero, all branches train.
- History:136 inputs (current plus lags1/4/16), separate64→64 networks;26053 params.

PyTorch, Stable-Baselines3 and SB3-Contrib are the foundation. Parallel policy and
fixed-context trainer are custom. Recurrent sequences <=128 steps; detached warm-up
<=32; episode/worker boundaries respected; padding and warm-up excluded from losses;
256 valid tokens/minibatch; every transition once per epoch;10 epochs. Memory resets
per episode and is passed during evaluation. Cached prefix states may be stale
after updates: warm-up reduces, not eliminates, that approximation.

Shared PPO:8 envs×1024 steps, batch256,10 epochs,gamma.995,GAE.95,entropy.01,
clip.2,value coefficient.5,gradient norm clipping.5,Adam eps1e-5. No target-KL stop.
Complete audits in each run's `hyperparameter_audit.json`. Gradient norm logged by
custom trainer is BEFORE clipping. Initial seed145032259. Scratch LR linearly
0.00015→0.000015 over507904. Extensions preserve optimizer moments and decay
0.000015→0.000003 through2031616; new episodes/RNG seed145032260 are explicit,
not bit-exact process resumption. Real optimizer-continuity/rate tests passed.

Original/removal baselines and initial architecture runs used106496/253952/507904
exams. Later history/recovery and extensions use50k nominal cadence rounded up to
rollout boundaries. Do not invent missing earlier checkpoints.

## Environment, rewards and failure interpretation

`rl/seeker_env.py` wraps `rl_environment.py`; `rl/seeker_round2.py:ExperimentEnv`
supplies current history/refund variants despite that module's historical name.
Do not run the old round-two training entry point.

16 thin body-centred rays,270-degree vision,28-unit range;19-point body/leg collision
model; blocked combined actions can fall back to safe rotation/translation. Collision
flags describe rejected intended movement even when a fallback succeeds.

Target position is ALREADY stored after first sight (`last_seen_target`). Direction/
distance remain in observations after occlusion. Age saturation at120 does not
erase it. Direction is world-space, with yaw provided separately. LSTM is not needed
just to remember that coordinate. Explicit memory-age persistence test passes.

Original cell/view exploration bonuses switch off after target discovery. Removal
removes those two bonuses, retaining other rewards. LSTM/residualMLP/history use
ORIGINAL rewards after a prospective recorded amendment. Recovery uses REMOVAL plus
refund of ordinary collision fine when fallback motion/rotation succeeds; terminal
penalties remain. Physics is unchanged. Read source/config for exact reward terms;
older AGENTS historical reward descriptions are not today's full seeker specification.

Stuck:40 blocked/no-translation steps. Frozen:60 no-translation steps, possibly
turning in place. Timeout:1000-step cap. Count failures before/after discovery.
Lower collisions alone can hide inactivity. Prioritize arrival, discovery, conditional
arrival and failure-capped arrival time (failures charged1000 steps).

## Files to read

- [Detailed current ledger](SEEKER_SCRATCH_RUN_LOG_2026-09-09.md): decisions/results.
- [Run index](SEEKER_RUN_INDEX.md) and JSON sibling: four September9 campaigns.
- [TRAINING.md](../TRAINING.md): historical PPO and seeker ledger.
- [RL_SPEC.md](../RL_SPEC.md): technical reference, includes historical sections.
- [Original experiment plan](SEEKER_EXPERIMENT_PLAN.md): historical proposal;
  subsequent scratch/schedule decisions supersede its warm-start recommendations.
- `rl/seeker_scratch.py`, `seeker_scratch_queue.py`: initial screen and cadence.
- `rl/seeker_recurrent_policy.py`, `seeker_recurrent_train.py`: memory implementation.
- `rl/seeker_extension.py`, `seeker_extension_queue.py`: active continuations.
- `rl/seeker_metrics.py`: canonical evaluations and diagnostic definitions.
- `rl/seeker_tensorboard.py`: supplemental outcome panels.
- `rl/seeker_scratch_report.py`: all-run graphs; `rl/seeker_comparison_graphs.py`:
  focused best fine-tune versus scratch LSTM graphs, sparse points labelled.
- Tests: `test_seeker_recurrent_policy.py` (9), `test_seeker_recurrent_train.py` (7),
  `test_seeker_scratch.py` (3), `test_seeker_schedules.py` (2),
  `test_seeker_extension.py` (3); target sensing tests13. No need rerun everything
  just to answer questions. Training-test fixtures are not scientific seed replicas.

Each artifact folder stores config, source snapshot/hashes, package versions,
initial or continuation audit, models, episode logs, evaluations, replays and
TensorBoard events. Large artifacts are ignored by Git; another machine needs them
copied separately. Production `public/leaper.onnx` has NOT been replaced.

## Runtime and safe read-only commands

Windows PowerShell. Broken `.venv/Scripts/python` points to a missing interpreter.
Use the bundled interpreter with repository site-packages:

```powershell
$env:PYTHONPATH='E:\Leaper\.venv\Lib\site-packages;E:\Leaper'
$env:OMP_NUM_THREADS='1'
$env:MKL_NUM_THREADS='1'
& 'C:\Users\ankud\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' -m rl.seeker_run_index
Get-Content rl_artifacts/seeker_scratch_lr_20260909/extension_queue_status.json
Get-Content rl_artifacts/seeker_scratch_lr_20260909/residual_lstm_extension_2m/status.json
```

CPU training: installed Torch2.13.0+cpu, CUDA unavailable. HardwareRTX3050Laptop4GB,
driver592.82. No CUDA setup was installed. MLP median rollout cycle12.6sec, collection
11.5sec including inference; GPU speedup unmeasured. Do not promise4090 speedups.

TensorBoard: http://127.0.0.1:6006/ ; replay: http://127.0.0.1:5173/?training=1 .
Watch `development/success_rate`, `detection_rate`, post-discovery failure rates,
`mean_arrival_steps_capped`, `train/learning_rate`, KL and clipping. Smoothing0 for
sparse DEV points. Read live files instead of guessing from stale browser panels.

## Archived work: never resume automatically

`seeker_round2_20260909`: interrupted warm continuation when owner required scratch.
`seeker_scratch_20260909`: interrupted constant-LR scratch when owner required decay.
`seeker_20260909`: completed earlier fine-tuning screen and confirmation.
Preserve their artifacts and lessons, but do not mix them into current scratch scores.

## Next decisions

Read [the geometry audit](SEEKER_ESCAPE_AUDIT_2026-09-09.md): all18 sampled
stalled poses from three mazes had legal immediate movement and pivot-forward
witnesses before termination. This is evidence of missed local choices, not
proof of full escape/arrival or general geometry feasibility. No assistance
controller was implemented. Any future assisted evaluation must be separate
from unassisted policy success, with interventions recorded explicitly.

Continue monitoring active extensions; history deserves a later same-origin extension.
Larger additive models are permitted but not yet implemented/launched. A diagnostic
known-target/no-obstacle probe showed weak midpoint pursuit, suggesting coordinate
representation/recovery deserves inspection; its synthetic200-step cases are NOT
benchmark scores or proof of cause. More training, capacity, and representation
are separate hypotheses. No guarantee that any one will reach90%.
