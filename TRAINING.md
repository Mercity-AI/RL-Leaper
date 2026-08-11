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

Current run:

```text
rl_artifacts/
  training_stdout.log       console and evaluation output
  training_stderr.log       Python warnings and errors
  training_progress.csv     reward for every completed training episode
  training_progress.png     reward and evaluation plots
  leaper_ppo.zip             final trained policy
  checkpoints/               policy snapshot every 10,000 steps
  tensorboard/PPO_8/          detailed PPO metrics for the current run
public/
  rl_live_state.json         evaluation checkpoints and browser replay frames
```

Historical archives currently include:

```text
rl_artifacts/body_only_run/
rl_artifacts/leg_collision_freeze_run/
rl_artifacts/pre_potential_reward_run/
rl_artifacts/time_decaying_goal_run/
rl_artifacts/ppo_8_collision_unaware_run/
rl_artifacts/ppo_9_collision_awareness_100k/
rl_artifacts/tensorboard/PPO_1/ through PPO_9/
```

The PPO_8 archive contains its final model, per-episode CSV, graph, console logs,
complete browser replay JSON, all 10k model checkpoints, and its TensorBoard
event file. It is the immutable comparison baseline for PPO_9.

These generated files are intentionally excluded from Git, but they remain on this computer unless manually deleted.

## What to change when increasing training

- Increase **total timesteps** only when success or evaluation reward is still trending upward. A reasonable progression is 300k, 600k, then 1M, checking the same fixed-seed evaluation at each checkpoint.
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
