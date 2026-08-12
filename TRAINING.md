# Leaper RL Training Ledger

This file is the human-readable history of reinforcement-learning runs. Generated models, raw logs, plots, checkpoints, and browser replay data stay under `rl_artifacts/` because they are large and ignored by Git. Update this ledger whenever a run is started, stopped, completed, or diagnosed.

## Terms used in this project

- **Environment step:** one action applied to one Leaper environment. The current action can move at most `0.75` units and turn at most `18` degrees.
- **Episode:** one attempt from a random spawn. It ends on goal success or after `400` environment steps.
- **Training rollout:** the experience PPO collects before updating its neural network. `n_steps=1024` means 1,024 steps from each of 8 parallel environments, so one training rollout contains `8,192` transitions.
- **PPO update:** after a training rollout, PPO reuses those 8,192 transitions for `10` epochs. With `batch_size=256`, that is 32 mini-batches per epoch and 320 gradient updates per rollout.
- **Evaluation checkpoint:** every 10,000 total training steps, training pauses briefly for 25 deterministic evaluation episodes. Five additional exploratory episodes are recorded for the browser visualizer. These five recordings are replays only and are not used to train the policy.
- **Total timesteps:** total transitions across all 8 environments. Because PPO completes whole 8,192-transition rollouts, a requested 300,000-step run currently finishes at 303,104 collected steps.

## Current baseline configuration

### Environment

- Arena boundary: `[-25, 25]` on both planar axes
- Fixed target: `(18, 18)`
- Fixed circular obstacles: 5
- Collision samples: body plus 3 samples on each of 6 legs (19 total)
- Maximum episode length: 400 steps
- Maximum movement: 0.75 units per step
- Maximum turn: 18 degrees per step
- PPO_9 observation: original 7 navigation values plus `last_collision`,
  `previous_forward_action`, and `previous_turn_action` (10 values total)
- PPO_10 forward throttle: signed `[-1, 1]`; negative reverses, zero stops,
  and positive moves forward. Turning remains `[-1, 1]`.

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
