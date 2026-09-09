# Seeker run index

Generated UTC: 2026-09-09T19:26:37.898414+00:00

Four September9 seeker campaigns; older PPO history remains in TRAINING.md.

Development evaluations only; fine-tuned and scratch origins differ. Read live statuses before acting.

Regenerate with `python -m rl.seeker_run_index`. No training is launched.

## seeker_20260909

Earlier fine-tuning; inherited walker, not scratch

| Run | Status | Latest DEV step | Arrival | Discovery |
|---|---|---:|---:|---:|
| [control_250k](../rl_artifacts/seeker_20260909/control_250k/config.json) | complete | 253952 | 72.5% | 90.5% |
| [footprint_250k](../rl_artifacts/seeker_20260909/footprint_250k/config.json) | complete | 253952 | 76.5% | 85.5% |
| [icm_250k](../rl_artifacts/seeker_20260909/icm_250k/config.json) | complete | 253952 | 76.5% | 89.5% |
| [removal_250k](../rl_artifacts/seeker_20260909/removal_250k/config.json) | complete | 253952 | 78.0% | 89.5% |
| [stall_memory_250k](../rl_artifacts/seeker_20260909/stall_memory_250k/config.json) | complete | 253952 | 74.5% | 89.5% |
| [visibility_250k](../rl_artifacts/seeker_20260909/visibility_250k/config.json) | complete | 253952 | 76.0% | 87.5% |

## seeker_round2_20260909

Superseded warm continuation; do not resume

| Run | Status | Latest DEV step | Arrival | Discovery |
|---|---|---:|---:|---:|
| [continuation](../rl_artifacts/seeker_round2_20260909/continuation/config.json) | interrupted_by_user_direction | 106496 | 74.0% | 86.5% |

## seeker_scratch_20260909

Superseded constant-LR scratch; do not resume

| Run | Status | Latest DEV step | Arrival | Discovery |
|---|---|---:|---:|---:|
| [original_mlp](../rl_artifacts/seeker_scratch_20260909/original_mlp/config.json) | interrupted_for_schedule_change | 106496 | 18.5% | 84.0% |
| [removal_mlp](../rl_artifacts/seeker_scratch_20260909/removal_mlp/config.json) | interrupted_for_schedule_change | 106496 | 21.0% | 84.5% |

## seeker_scratch_lr_20260909

Active scheduled scratch and own-model extensions

| Run | Status | Latest DEV step | Arrival | Discovery |
|---|---|---:|---:|---:|
| [history_mlp](../rl_artifacts/seeker_scratch_lr_20260909/history_mlp/config.json) | complete | 507904 | 50.5% | 85.5% |
| [original_mlp](../rl_artifacts/seeker_scratch_lr_20260909/original_mlp/config.json) | complete | 507904 | 29.0% | 73.5% |
| [recovery_reward](../rl_artifacts/seeker_scratch_lr_20260909/recovery_reward/config.json) | complete | 507904 | 26.0% | 83.0% |
| [removal_mlp](../rl_artifacts/seeker_scratch_lr_20260909/removal_mlp/config.json) | complete | 507904 | 27.5% | 60.5% |
| [residual_lstm](../rl_artifacts/seeker_scratch_lr_20260909/residual_lstm/config.json) | complete | 507904 | 46.5% | 82.0% |
| [residual_lstm_extension_2m](../rl_artifacts/seeker_scratch_lr_20260909/residual_lstm_extension_2m/config.json) | complete | 2031616 | 60.5% | 80.0% |
| [residual_mlp](../rl_artifacts/seeker_scratch_lr_20260909/residual_mlp/config.json) | complete | 507904 | 37.0% | 72.5% |
| [residual_mlp_extension_2m](../rl_artifacts/seeker_scratch_lr_20260909/residual_mlp_extension_2m/config.json) | complete | 2031616 | 56.5% | 77.5% |
