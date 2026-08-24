# Leaper RL Training Ledger

This file is the human-readable history of reinforcement-learning runs. Generated models, raw logs, plots, checkpoints, and browser replay data stay under `rl_artifacts/` because they are large and ignored by Git. Update this ledger whenever a run is started, stopped, completed, or diagnosed.

## Terms used in this project

- **Environment step:** one action applied to one Leaper environment. The current action can move at most `0.75` units and turn at most `18` degrees.
- **Episode:** one attempt from a random spawn. It ends on goal success, PPO_16's terminal stuck failure, or after `1,000` environment steps in the current large arena.
- **Training rollout:** the experience PPO collects before updating its neural network. `n_steps=1024` means 1,024 steps from each of 8 parallel environments, so one training rollout contains `8,192` transitions.
- **PPO update:** after a training rollout, PPO reuses those 8,192 transitions for `10` epochs. With `batch_size=256`, that is 32 mini-batches per epoch and 320 gradient updates per rollout.
- **Evaluation checkpoint:** every 10,000 total training steps, training pauses briefly for 25 deterministic evaluation episodes. Five additional exploratory episodes are recorded for the browser visualizer. These five recordings are replays only and are not used to train the policy.
- **Total timesteps:** total transitions across all 8 environments. Because PPO completes whole 8,192-transition rollouts, a requested 300,000-step run currently finishes at 303,104 collected steps.

## Current baseline configuration

### Environment

- Arena boundary: `[-93.75, 93.75]` on both planar axes
- Fixed target: `(-40, -10)`; exact direction and distance are observations, not visual detections
- Random circular obstacles: 51, regenerated every episode with a reachability guard
- Collision samples: body plus 3 samples on each of 6 legs (19 total)
- Maximum episode length: 1,000 steps
- Maximum movement: 0.75 units per step
- Maximum turn: 18 degrees per step
- PPO_9 observation: original 7 navigation values plus `last_collision`,
  `previous_forward_action`, and `previous_turn_action` (10 values total)
- PPO_10 forward throttle: signed `[-1, 1]`; negative reverses, zero stops,
  and positive moves forward. Turning remains `[-1, 1]`.
- PPO_17_SMOKE keeps the 18-value observation shape but replaces the old eight
  360° centre rays with eight 25° collision-aware sectors covering only the
  forward 200°. Each sector samples three directions and returns the minimum
  safe translation clearance for the complete 19-point body/leg footprint,
  normalized by the unchanged 12-unit range. The rear 160° is unseen. This
  semantic change invalidates every earlier policy even though the shape stays 18.

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
| PPO_11 | 106,496 | Add only eight obstacle-clearance rangefinder rays to the observation (10 to 18 values); no other change | 69% deterministic success and +12.96 mean reward over the final 100-episode evaluation (best in project history) | Completed and archived in `ppo_11_ray_vision_100k/`; sight of obstacles cut collisions and roughly fixed the failure |
| PPO_12 | 106,496 | Keep PPO_11's rays; change only the collision response so rotation and translation resolve independently (a touching robot can turn or reverse out of contact) | 65% deterministic success and +6.09 mean reward (natural seed 53054) | Completed and archived in `ppo_12_collision_recovery_100k/`; escape mechanic proven and typical jams shorter, but collision rate did not fall |
| PPO_13 | 303,104 | Generalization run (owner decision): field ~2.5x wider each side (WORLD_LIMIT 25->62.5), 10 obstacles randomized into a fresh layout every episode (was 5 fixed), episode cap 400->1000, trained 300k. Robot's brain (rays, reward, signed throttle, decoupled collisions, PPO settings, rollout) identical to PPO_12 | 85% deterministic success and +31.66 mean reward on unseen random mazes (natural seed 364970); collision rate collapsed to 0.11% | Completed and archived in `ppo_13_random_arena_300k/`; best run in project history and it generalizes, but three env changes + 3x steps at once and a single seed limit clean attribution |
| PPO_14 | 303,104 | Harder-arena run (owner decision): field grown to WORLD_LIMIT 93.75 (187.5 wide), obstacle count 10->51 randomized per episode, target moved off-center to the south-west (-40, -10) with a small plaza plus a flood-fill reachability guarantee, episode cap 1000, trained 300k. Robot's brain identical to PPO_13 | 54% deterministic success and +3.38 mean reward on unseen dense mazes (natural seed 876919); collision rate back up to 15.87% with a 994-step worst wedge | Completed and archived in `ppo_14_sw51_300k/`; the density largely answers "was PPO_13's low collision just open space?"-yes: the stuck-in-contact freeze returns under a dense field |
| PPO_15 | 303,104 | Contact-avoidance experiment: raise only the collision penalty from -0.18 to -0.5 per step; arena, target, rays, PPO settings, and 300k steps identical to PPO_14 | 51% deterministic success (natural seed 889404); collision rate 12.84% (down from 15.87%), mean longest streak 52.41 (down from 67.18), but worst wedge still 990 steps and forward-step share fell 74%->46% | Completed and archived in `ppo_15_collision_penalty_300k/`; a small, mixed win-less contact and shorter jams, but success flat and the deep freeze persists; the heavier fine bought timidity, not smarter navigation |
| PPO_16 | 303,104 | Stuck rule: revert collision penalty to -0.18 and add a terminal stuck-failure - if the robot collides with no forward progress for STUCK_LIMIT=40 consecutive steps, end the episode with a one-time STUCK_PENALTY=10; arena/target/rays/PPO settings/300k identical to PPO_14 | 64% deterministic success (natural seed 489429); collision rate collapsed to 1.35%, mean longest streak 3.66, worst wedge capped at 43 steps, forward-step share healthy at 70% | Completed and archived in `ppo_16_stuck_rule_300k/`; best result on the hard arena and it fixes the freeze without timidity - the robot learned to avoid dead-ends rather than endure them |
| PPO_17_SMOKE | 24,576 | Validation only: eight forward 25° collision-aware sectors over 200°, same 18-value shape and 12-unit range; all reward, action, arena, collision recovery, stuck rule, and PPO settings unchanged | Smoke final: 1% deterministic success, 18.75 target progress, 3.88% collision steps; natural seed 308443 | Technical pipeline passed, NaN-free with empty stderr; not experimental evidence; isolated under `ppo_17_forward_clearance_smoke/` |
| PPO_17 | 106,496 | Main 100k gate for PPO_17's eight forward body/leg-aware clearance sectors; otherwise PPO_16 environment, reward, action, stuck rule, and PPO settings | Final 100 episodes: 8% deterministic success, -6.45 mean reward, 28.67 target progress, 2.91% collision steps; natural seed 846909 | Completed under `ppo_17_forward_clearance_100k_rerun/`; low contact but weak, nearly zero-mean throttle and a 38% stochastic/8% deterministic gap. Do not extend automatically to 300k |

## PPO_17 forward collision-aware vision smoke test

- Status: complete; smoke only, not a main result. Natural seed 308443.
- Purpose: prove that a forward 200° field can report body-and-leg-safe clearance,
  train without numerical failures, publish rollouts, and render the actual
  randomized obstacle layout plus vision readings.
- Observation: indices 0-9 remain unchanged. The target remains a known static
  destination through exact direction and distance channels; it is not visually
  detected. Indices 10-17 are eight contiguous 25° sectors, each internally
  sampling three directions and returning the minimum 19-point safe translation
  clearance divided by 12.
- Rear vision: none outside `yaw ±100°`. No maps, obstacle coordinates, routes,
  waypoints, or long-term obstacle memory are added.
- Reverse remains signed and unrestricted. Forward/reverse/stopped behaviour will
  be measured, not altered, in this smoke test.
- Command: `python train_rl.py --timesteps 20000 --run-name PPO_17_SMOKE --artifact-dir rl_artifacts/ppo_17_forward_clearance_smoke`
- Expected collection: 24,576 transitions. Do not start the 300k main run until
  the geometry, replay, logs, and smoke outputs have been inspected.

### PPO_17_SMOKE validation result

- Requested/collected: 20,000 / 24,576 transitions.
- Deterministic fixed-seed exam (100 episodes): 1% success, 99% timeout,
  -11.06 mean reward, 18.75 mean net target progress, 3.88% collision steps,
  15.38 mean longest collision streak, 43 worst streak, 663.38 average steps,
  55.33% forward, 44.67% reverse, and effectively 0% stopped.
- Latest stochastic training sample (24 completed episodes): 0% success, 15.57
  mean progress, 1.60% collision steps, 50.42% forward and 49.58% reverse.
- Reward breakdown per deterministic episode: +3.75 progress, -6.63 time,
  -8.43 collision/stuck, +0.25 goal.
- Validation: all 40 focused tests, Gymnasium checker, production browser build,
  populated CSVs, two checkpoints, final model/evaluation, TensorBoard event,
  replay JSON, progress plot, no NaN/Infinity, and empty stderr.
- Interpretation: the sensor/training/telemetry pipeline works. These 20k smoke
  numbers must not be compared as learning performance against PPO_16 at 300k.

### PPO_17 100k decision-gate result

- Status: complete, natural seed 846909, 106,496 collected transitions. Archive:
  `rl_artifacts/ppo_17_forward_clearance_100k_rerun/`.
- An initial attempt stopped at roughly 10k because Windows kept the browser live
  JSON open during atomic replacement. `write_live_state()` now retries briefly
  and skips a monitoring refresh instead of allowing a viewer lock to terminate
  training. The failed partial archive remains separate at
  `ppo_17_forward_clearance_100k/` and is not an experimental result.
- Deterministic fixed-seed exam (100 episodes): 8% success, 92% timeout, -6.45
  mean reward, 28.67 mean target progress, 2.91% collision steps, 1.51 mean
  longest collision streak, 42 worst streak, and 910.79 average steps.
- Movement diagnosis: 46.92% forward, 53.05% reverse, effectively 0% stopped,
  but mean signed throttle was -0.00094 and mean absolute throttle only 0.1184.
  The policy did not literally stop; it settled into weak, almost perfectly
  cancelling forward/reverse movement and usually timed out.
- Latest 100 stochastic training episodes: 38% success, +5.00 reward, 45.37
  progress, 3.44% collision steps, and 0.629 mean absolute throttle. Exploration
  moves decisively and sometimes succeeds; the deterministic mean policy does not.
- Checkpoint deterministic success was 0% through 40k, 4% at 50k/60k, 8% at
  70k, 4% at 80k/90k/100k. There is no stable upward deterministic trend.
- Verdict: forward body-aware clearance greatly limits contact, but this exact
  200°/eight-sector configuration does not yet produce reliable navigation on
  the dense hard arena. Do not automatically extend it to 300k. The next change
  should address deterministic indecision or restore some rear/peripheral safety
  information while preserving an animal-like preference for forward travel.

## PPO_16 stuck-rule experiment

- Date: 2026-08-20
- Status: complete
- Parent: PPO_14 arena; PPO_15's -0.5 penalty reverted to -0.18. Fresh model.
- Reason: PPO_15 showed scaling the flat penalty only buys timidity, not a fix.
  The freeze is a deterministic re-issue-of-a-blocked-move loop, so target it
  directly. Owner insight during design: ending an episode early is NOT a
  punishment on its own - without an explicit penalty, quitting early can even
  look attractive because it avoids accumulated time/collision costs. So the stuck
  end must carry a clear negative.
- The only learning-related change: a terminal stuck-failure. If the robot is in
  contact and makes no forward progress (`prev_distance - distance <= 1e-3`) for
  `STUCK_LIMIT = 40` consecutive steps, `step()` returns `terminated = True` (a
  true terminal failure, not a truncation, so the future value bootstraps to just
  the penalty) and applies a one-time `STUCK_PENALTY = 10`. Reported inside the
  collision reward term so diagnostics keys are unchanged. `COLLISION_PENALTY`
  reverted 0.5 -> 0.18. Everything else identical to PPO_14. Tests:
  `tests/test_ppo13_random_arena.py` (wedged episode terminates with penalty;
  open space never triggers stuck).
- Command: `python train_rl.py --timesteps 300000 --seed <random> --run-name PPO_16 --artifact-dir rl_artifacts/ppo_16_stuck_rule_300k` (natural seed 489429).

### PPO_16 final result

| Deterministic metric | PPO_14 (-0.18) | PPO_15 (-0.5) | PPO_16 (stuck rule) |
|---|---|---|---:|
| Success rate | 54% | 51% | 64% |
| Timeout rate | 46% | 49% | 36% |
| Collision rate | 15.87% | 12.84% | 1.35% |
| Mean longest collision streak | 67.18 | 52.41 | 3.66 |
| Worst collision streak | 994 | 990 | 43 |
| Forward step share | 74.4% | 46.0% | 70.0% |
| Average episode length | 510.76 | 552.55 | 366.82 |
| Mean net target progress | 47.89 | 49.38 | 57.28 |
| Stochastic training success | 100% | 100% | 94% |

Conclusion: the decisive win of the PPO_14-16 sequence and the best result on the
hard arena. The stuck rule eliminates the freeze by construction (worst wedge 994
-> 43, capped near STUCK_LIMIT) and, more importantly, the policy learned to avoid
dead-ends entirely: collision rate collapsed 15.87% -> 1.35% and mean longest
streak 67 -> 3.7. Deterministic success rose 54% -> 64% while forward-step share
stayed healthy at 70% (vs PPO_15's timid 46%), so the terminal penalty fixed the
behavior without the global caution tax of a flat fine. This confirms the design
reasoning: pairing the early end with an explicit failure penalty (and treating it
as terminal, not truncation) is what teaches "getting wedged is the worst outcome."

Next decision: keep the stuck rule permanently. Remaining headroom is the 36%
timeout rate - runs that neither reach the goal nor wedge, just don't arrive in
time on the big field. Candidate single changes: replicate PPO_16 on two more
seeds to confirm 64%; tune STUCK_LIMIT (e.g., 30 vs 60) or STUCK_PENALTY; or, for
the timeouts, revisit ray range/count so it plans routes better, or a longer
training budget. Test one at a time and record here.

## PPO_15 collision-penalty experiment

- Date: 2026-08-20
- Status: complete
- Parent: PPO_14 configuration; fresh model.
- Reason: PPO_14 showed the stuck-in-contact deterministic freeze returns in a
  dense field. The hypothesis: the -0.18 collision penalty makes grinding too
  cheap, so raising it should push the policy to steer around obstacles.
- The only learning-related change: `COLLISION_PENALTY` 0.18 -> 0.5. A blocked
  step now costs -0.5 instead of -0.18. Everything else identical to PPO_14
  (WORLD_LIMIT 93.75, 51 randomized obstacles with reachability, target (-40,-10),
  rays, signed throttle, decoupled collisions, PPO settings, 8,192 rollout, 1000
  cap, 300k steps). Reward change, so it invalidates prior policies (fresh run).
- Command: `python train_rl.py --timesteps 300000 --seed <random> --run-name PPO_15 --artifact-dir rl_artifacts/ppo_15_collision_penalty_300k` (natural seed 889404).

### PPO_15 final result

| Deterministic metric | PPO_14 (-0.18) | PPO_15 (-0.5) |
|---|---|---:|
| Success rate | 54% | 51% |
| Timeout rate | 46% | 49% |
| Collision rate | 15.87% | 12.84% |
| Mean longest collision streak | 67.18 | 52.41 |
| Worst collision streak | 994 | 990 |
| Forward step share | 74.4% | 46.0% |
| Average episode length | 510.76 | 552.55 |
| Mean net target progress | 47.89 | 49.38 |

(Mean reward is not comparable across the penalty change and is omitted; -18.38 for
PPO_15 mostly reflects the larger fine, not worse behavior.)

Conclusion: a small, mixed result, not the fix. The heavier fine did reduce contact
(15.87% -> 12.84%) and shorten typical jams (67 -> 52 steps), confirming the penalty
does influence contact. But deterministic success did not improve (54% -> 51%), one
episode still wedged for 990 of 1000 steps, and the forward-step share collapsed
from 74% to 46%: the policy bought caution/timidity rather than better avoidance,
and the core re-issue-blocked-move freeze is intact. A larger penalty alone would
likely deepen the timidity without solving the freeze.

Next decision: stop scaling the flat penalty. Target the freeze mechanism directly.
Preferred single change (PPO_16 candidate): a stuck/no-progress consequence - e.g.
truncate the episode (or apply an escalating penalty) after K consecutive collision
steps with no net progress, so the 990-step wedge cannot persist and the policy
gets a clean signal that being stuck is terminal, without a global timidity tax.
Alternatives: an escalating (not flat) collision penalty that stays cheap for a
single necessary brush but rises fast during sustained grinding; or a sparse->dense
obstacle curriculum. Test one at a time and record here.

## PPO_14 denser-arena, moved-target stress run

- Date: 2026-08-20
- Status: complete
- Parent: PPO_13 configuration (rays, signed throttle, decoupled collisions,
  reward, PPO settings, rollout); starts from a completely fresh model.
- Reason: PPO_13 hit 85% on the roomy 10-obstacle field with a near-zero 0.11%
  collision rate, but two caveats stood: the field was inherently open (more room
  to dodge) and it was a single seed. The owner chose to stress the arena directly
  to see whether the low collision rate was real avoidance skill or just open
  space, and to make the task harder overall.
- Environment changes (multiple at once, by explicit owner decision):
  - Field grown from WORLD_LIMIT 62.5 to 93.75 (a 187.5-wide field, ~1.5x each
    side, ~2.25x area).
  - Obstacle count raised 10 -> 51, still randomized into a fresh layout every
    episode; target-plaza clearance tightened 12 -> 6 so obstacles may sit close
    and force detours.
  - Target relocated from (-20, 15) to the south-west (-40, -10), off-center and
    farther out, so the robot must weave through obstacles rather than sit near
    the goal.
  - Reachability guarantee added: `_generate_obstacles` re-rolls any layout whose
    target is walled into a pocket, verified by a coarse-grid flood-fill
    (`_target_reachable`, `REACHABILITY_MIN_FRACTION = 0.5`). Detours are allowed;
    a sealed goal is rejected. Covered by `tests/test_ppo13_random_arena.py`.
  - Episode cap kept at 1000; total training kept at 300k.
- Unchanged (the learned brain): 18-value observation with eight rays, signed
  throttle, reward formula and amounts, 19 collision points, decoupled collision
  response, speeds, all PPO hyperparameters, 8,192 rollout, 10k eval interval.
- Command: `python train_rl.py --timesteps 300000 --seed <random> --run-name PPO_14 --artifact-dir rl_artifacts/ppo_14_sw51_300k` (natural seed 876919).

### PPO_14 final result

| Deterministic metric | PPO_13 (roomy, 10 obs) | PPO_14 (dense, 51 obs, SW target) |
|---|---|---:|
| Success rate | 85% | 54% |
| Timeout rate | 15% | 46% |
| Mean reward | +31.66 | +3.38 |
| Mean net target progress | 64.12 | 47.89 |
| Collision rate | 0.11% | 15.87% |
| Mean longest collision streak | 0.02 | 67.18 |
| Worst collision streak | 2 | 994 |
| Average episode length | 236.85 | 510.76 |
| Stochastic training success | 99% | 100% |

Conclusion: the dense field is much harder and it largely answers PPO_13's open
question. Packing the arena with 51 obstacles and forcing the robot to weave to a
south-west goal brings the stuck-in-contact freeze back: collision rate rose from
0.11% to 15.87%, the mean longest collision streak from 0.02 to 67 steps, and one
deterministic episode fully wedged for 994 of 1000 steps. So PPO_13's near-perfect
dodging was substantially a product of open space, not purely skill. The
stochastic training policy still reaches the goal ~100% of the time, but the
deterministic deployment policy re-issues blocked moves and freezes - the same
mechanism seen in PPO_10-PPO_12, now under real pressure. 54% deterministic on a
dense, generalized, moved-target field is a respectable result and a clear signal
that contact-avoidance/escape is the remaining problem.

Next decision: the arena is now a good hard benchmark; keep it. The contact
problem is the priority. The cleanest single controlled experiment is a reward
change (raise the -0.18 collision penalty so grinding costs more) or a curriculum
that starts sparser and densifies, with everything else at PPO_14 settings; also
worth adding is replication across two more natural seeds. Test one learning
change at a time and record here.

## PPO_13 larger randomized-arena generalization experiment

- Date: 2026-08-20
- Status: complete
- Parent: PPO_12 configuration (rays, signed throttle, decoupled collision
  response, reward, PPO settings, rollout); starts from a completely fresh model.
- Reason: the previously planned PPO_13 (raise the collision penalty) was
  superseded by an owner decision. Because the rays were confirmed across three
  seeds in PPO_11, the precondition recorded in the handoff notes for randomized
  and larger arenas was met, so the owner chose to test generalization directly:
  can the ray-based policy handle fields and obstacle layouts it has never seen,
  instead of one memorized arena.
- Environment changes (this is a multi-change run by explicit owner decision, not
  the usual single-variable experiment):
  - Field ~2.5x wider each side: `WORLD_LIMIT` 25.0 -> 62.5 (play area ~6x). The
    fixed target scaled with it, (18, 18) -> (45, 45), same proportional corner.
  - Obstacles randomized every episode: a fresh layout of `NUM_OBSTACLES = 10`
    (was 5 fixed) is sampled in `reset()` via `_generate_obstacles`. Radii stay
    robot-relative in `[2.5, 3.6]` (not scaled with the world, because the robot
    is unchanged), kept inside a wall margin, spaced apart, and cleared of the
    target so every episode stays solvable. Generation uses `self.np_random`, so a
    given reset seed reproduces its layout and the fixed-seed evaluation stays fair
    and identical across future runs.
  - Episode cap raised `MAX_STEPS` 400 -> 1000 so the much larger field is not an
    automatic timeout; the robot's speed is unchanged.
- Unchanged (the learned brain): 18-value observation with eight rays, signed
  `[-1, 1]` throttle and `[-1, 1]` turn, `RAY_MAX_RANGE = 12.0`, 19 collision
  points, decoupled collision response, movement/turn speeds, reward formula and
  amounts, eight environments, all PPO hyperparameters, 8,192-transition rollout,
  and the 10,000-step evaluation/checkpoint interval.
- Model compatibility: randomized geometry and the larger world change the
  dynamics but not the observation or action shape, so the network shape is
  unchanged; PPO_13 still starts fresh because it must learn against different
  dynamics.
- Replay change: `step()` info and the recorded replay episodes now carry the
  per-episode obstacle layout so viewers can draw the actual random maze rather
  than a stale fixed arena. Coverage in `tests/test_ppo13_random_arena.py`
  (obstacle count, in-bounds, target clearance, per-episode variation,
  seed reproducibility, collision-free start, unchanged observation size).
- Smoke command: `python train_rl.py --timesteps 20000 --seed <random> --run-name PPO_13_SMOKE --artifact-dir rl_artifacts/ppo_13_random_arena_smoke`
- Main command: `python train_rl.py --timesteps 300000 --seed <random> --run-name PPO_13 --artifact-dir rl_artifacts/ppo_13_random_arena_300k`

The isolated 20,000-step smoke test collected 24,576 steps under run name
`PPO_13_SMOKE` (natural seed 435196), NaN-free, stored in
`rl_artifacts/ppo_13_random_arena_smoke/`; technical verification only. The main
run collected 303,104 steps under natural seed 364970 with an empty stderr log and
no NaN in evaluation, stored in `rl_artifacts/ppo_13_random_arena_300k/`.

### PPO_13 final result and comparison

Deterministic values use the same fixed seeds from 10,000, but note the exam is
now harder than every prior run: each evaluation episode is a different random
maze in a much larger field, so this is not the same fixed arena PPO_1-PPO_12 were
scored on. The comparison below is "memorized fixed arena" (PPO_12) versus
"unseen random mazes" (PPO_13).

| Deterministic metric | PPO_12 (fixed arena) | PPO_13 (random mazes) |
|---|---|---:|
| Success rate | 65% | 85% |
| Timeout rate | 35% | 15% |
| Mean reward | +6.09 | +31.66 |
| Mean net target progress | 21.45 | 64.12 |
| Collision rate | 40.47% | 0.11% |
| Mean longest collision streak | 62.78 | 0.02 |
| Worst collision streak | 400 | 2 |
| Average episode length | 174.46 | 236.85 |
| Forward step share | (mostly reverse) | 78.0% |
| Stochastic training success | 93% | 99% |

Conclusion: this is the strongest result in the project and, unlike every prior
run, it is measured on fields the policy has never seen, so it is genuine
generalization rather than memorization of one arena. The stuck-in-contact failure
that dominated PPO_10-PPO_12 is effectively absent here (collision rate 0.11%,
mean longest streak 0.02, worst streak 2 steps), and the reverse-gait quirk is
gone: the robot walks forward (78% forward steps) to the goal.

Caveats on attribution (important, do not over-claim the collision fix):
- This run changed three environment variables at once (field size, obstacle
  count/randomization) and trained 3x longer (300k vs 100k), by explicit owner
  decision. So the dramatic collision drop cannot be attributed to any single
  cause.
- A larger field is inherently more open: with the same-size robot and obstacles
  spread across ~6x the area, there is simply more room to route around contact,
  which makes low collision rates easier independent of skill. Part of the 40% ->
  0.11% drop is this geometry, not only better avoidance.
- Single natural seed (364970). Like PPO_12, one seed cannot separate policy
  quality from seed luck.

Next decision: keep the larger randomized arena as the new baseline world; it is
a better generalization test and the policy clearly handles it. To make the result
trustworthy and to understand what drove it, the recommended follow-ups, one
controlled change at a time, are: (1) replicate PPO_13 on two more natural seeds
(three total) and compare on the same fixed-seed evaluation; (2) to isolate how
much of the collision drop is open-field geometry versus skill, run a variant that
restores the original obstacle density (more obstacles for the larger area) with
everything else at PPO_13 settings. Record each in this ledger.

## PPO_12 decoupled-collision-response experiment

- Date: 2026-08-19
- Status: complete
- Parent: PPO_11 configuration; starts from a completely fresh model
- Reason: across three seeds PPO_11 confirmed the rays work but left the
  stuck-in-contact failure unsolved (collision rates up to 43%, mean longest
  collision streaks of 90-112 steps, episodes reaching a ~400-step streak). The
  cause is the collision rule: a blocked step rejected translation and rotation
  together, so a touching deterministic policy re-issued the same rejected action
  and looped until timeout.
- Behavioral change (the only learning-related change): when the combined
  turn-and-move is blocked, resolve the two independently. First rotate in place
  if the turned pose alone is collision-free, then translate along the resolved
  facing if that alone is collision-free. This lets a wedged robot turn or reverse
  out of contact. The collision flag and its -0.18 penalty still reflect the full
  intended move, so reward semantics are identical to PPO_11.
- Unchanged: signed `[-1, 1]` throttle and `[-1, 1]` turn, the 18-value
  observation with eight rays, arena, target, spawning, five obstacles, 19
  collision points, movement and turning speeds, 400-step limit, reward formula
  and amounts, eight environments, all PPO hyperparameters, 8,192-transition
  rollout, and the 10,000-step evaluation/checkpoint interval.
- Seeding: per the owner's decision, training no longer fixes seed 7. Each run
  uses a fresh natural random seed, recorded in `training_config.json`. The
  100-episode deterministic evaluation still uses fixed seeds from 10,000, so the
  comparison against PPO_11 remains the same exam.
- This changes only physics, not the observation size, so it does not by itself
  invalidate PPO_11's policy shape, but PPO_12 still starts fresh because the
  world dynamics it learns against are different.
- Smoke command: `python train_rl.py --timesteps 20000 --seed <random> --run-name PPO_12_SMOKE --artifact-dir rl_artifacts/ppo_12_collision_recovery_smoke`
- Main command: `python train_rl.py --timesteps 100000 --seed <random> --run-name PPO_12 --artifact-dir rl_artifacts/ppo_12_collision_recovery_100k`
- Decision rule: judge against PPO_11 primarily on collision step rate, mean and
  worst collision streak, and deterministic success. The fix succeeds if collision
  streaks shrink and deterministic success rises or holds.

The isolated 20,000-step smoke test collected 24,576 steps under run name
`PPO_12_SMOKE` (natural seed 6123), NaN-free, and is stored in
`rl_artifacts/ppo_12_collision_recovery_smoke/`. It is a technical verification
only. The main run collected 106,496 steps under natural seed 53054 with an empty
stderr log, 456 completed training episodes, and no NaN in evaluation, stored in
`rl_artifacts/ppo_12_collision_recovery_100k/`.

### PPO_12 final result and comparison

Deterministic values use the same fixed seeds from 10,000. PPO_11 is shown as its
three-seed spread (seeds 7 / 11 / 23) so PPO_12's single natural-seed run can be
placed against the range rather than one lucky point.

| Deterministic metric | PPO_11 (7 / 11 / 23) | PPO_12 (natural) |
|---|---|---:|
| Success rate | 69% / 54% / 39% | 65% |
| Timeout rate | 31% / 46% / 61% | 35% |
| Mean reward | +12.96 / -1.70 / -10.48 | +6.09 |
| Mean net target progress | 22.79 / 19.57 / 14.93 | 21.45 |
| Collision rate | 24.50% / 42.92% / 42.08% | 40.47% |
| Mean longest collision streak | 31.54 / 92.66 / 111.99 | 62.78 |
| Worst collision streak | 400 / 399 / 400 | 400 |
| Average episode length | 163.64 / 219.00 / 270.79 | 174.46 |
| Stochastic training success | 83% / 88% / 93% | 93% |

Conclusion: the escape mechanic works and is proven in the unit tests
(`tests/test_ppo12_collision_recovery.py`): a wedged robot now rotates or reverses
out of contact instead of freezing. Its effect on the trained policy is a modest,
real improvement rather than a knockout. Deterministic success (65%) sits at the
strong end of PPO_11's spread and clearly above PPO_11's seed average (about 54%),
with a short average episode length (174 steps) showing the robot reaches the goal
and finishes. The mean longest collision streak (62.78) is far below PPO_11's
worse seeds (92.66, 111.99), i.e. typical jams are shorter.

But the deterministic collision rate did not fall (40.47%), and one episode still
reached a full 400-step streak. Part of the high collision rate is a measurement
artifact: the collision flag marks any blocked intended move even when the robot
then successfully rotates or reverses, so a policy that slides along an obstacle
edge while still progressing registers a collision every step. The remaining real
failure is that avoiding contact is a different skill from escaping it, and the
unchanged -0.18 penalty leaves the policy willing to grind past obstacles.

Caveat: this is a single natural-seed run against PPO_11's three seeds. Because
PPO_11 seed 7 alone also reached 69%, one PPO_12 seed cannot cleanly separate the
fix's contribution from seed variation for the success number; the trustworthy
evidence for the fix is the shorter mean jam length and the unit-tested escape
behavior, not the headline success percentage.

Next decision: keep the decoupled collision response permanently; it is a sound
mechanic that strictly gives the robot more ways out and never freezes a pose that
a sub-move could clear. It did not by itself drive collisions down, so the next
single controlled experiment should target contact avoidance directly. The
cleanest candidate is a reward change (PPO_13): raise the collision penalty so
grinding along obstacles costs more, keeping rays, the decoupled physics, PPO
settings, and rollout size unchanged. An alternative single change is denser or
longer-range rays so the policy sees narrow gaps between beams. Test only one.

## PPO_11 obstacle-clearance ray-vision experiment

- Date: 2026-08-19
- Status: complete
- Parent: PPO_10 configuration; starts from a completely fresh model
- Reason: PPO_10 fixed the deterministic freeze but still spent 38.87% of steps
  in collision with a worst streak of 399, because the policy had no sensor for
  obstacles ahead. It could only feel a collision after it happened via the
  single `last_collision` bit. This run gives it forward-looking sight.
- Observation change: the observation grows from 10 to 18 values. Indices 0-9 are
  the exact PPO_10 observation, unchanged. Indices 10-17 are eight rangefinder
  rays cast every 45 degrees around the current facing (ray 0 straight ahead),
  each reporting the clear distance to the nearest obstacle or wall, divided by
  `RAY_MAX_RANGE = 12.0` and clipped to `[0, 1]`; 1.0 means nothing within range.
- We do not tell the policy to avoid obstacles. It only gains the sensor values;
  the unchanged `-0.18` collision penalty and progress reward supply the incentive
  and PPO must learn the avoidance behavior itself.
- Unchanged: signed `[-1, 1]` throttle and `[-1, 1]` turn, arena, target,
  spawning, five obstacles, 19 collision points, combined movement-and-rotation
  rejection, movement and turning speeds, 400-step limit, reward formula and
  amounts, eight environments, all PPO hyperparameters, 8,192-transition rollout,
  seed 7, and 10,000-step evaluation/checkpoint interval.
- Adding sensors to the observation invalidates every earlier trained policy. A
  PPO_10 model wired for 10 inputs cannot be loaded into PPO_11's 18-input policy;
  PPO_11 must start fresh. Do not load PPO_8, PPO_9, or PPO_10 as a starting point.
- Requested steps: 100,000 (expected collection: 106,496 because PPO completes
  full 8,192-transition rollouts)
- Smoke command: `python train_rl.py --timesteps 20000 --run-name PPO_11_SMOKE --artifact-dir rl_artifacts/ppo_11_ray_vision_smoke`
- Main command: `python train_rl.py --timesteps 100000 --run-name PPO_11 --artifact-dir rl_artifacts/ppo_11_ray_vision_100k`
- Artifact directory: `rl_artifacts/ppo_11_ray_vision_100k/`
- Decision rule: judge against PPO_10 primarily on collision step rate, mean and
  worst collision streak, and deterministic success. Extend or add seeds only if
  the rays clearly reduce collisions or raise deterministic success.

The isolated 20,000-step smoke test collected 24,576 steps under run name
`PPO_11_SMOKE`. Its populated progress and diagnostic CSVs (60 rows each), model,
checkpoints, TensorBoard event, replay, logs, and NaN-free final evaluation are
stored in `rl_artifacts/ppo_11_ray_vision_smoke/`. It confirmed the 18-value
observation passes Gymnasium's checker and already reached 20% deterministic
success; it is a technical verification only and is not the experimental result.

The main run completed 106,496 steps, the expected whole-rollout total. Its 10
checkpoint models, 459 completed training episodes, final model, replay, progress
files, full console logs, TensorBoard event, exact configuration, and final
evaluation are in `rl_artifacts/ppo_11_ray_vision_100k/`. The stderr log is empty,
and the evaluation and both CSV files contain no NaN values.

### PPO_11 final result and controlled comparison

All deterministic values below use the fixed seeds beginning at 10,000, the same
100-episode procedure used for PPO_8, PPO_9, and PPO_10. PPO_11 is the final
fresh model after PPO completed its requested 100k run at 106,496 collected steps.

| Deterministic metric | PPO_10 signed throttle | PPO_11 ray vision |
|---|---:|---:|
| Success rate | 5% | 69% |
| Timeout rate | 95% | 31% |
| Mean reward | -28.0351 | +12.9552 |
| Mean net target progress | 6.2933 | 22.7891 |
| Stopped steps | 0% | 0.1100% |
| Forward steps | 54.6371% | 19.6529% |
| Reverse steps | 45.3629% | 80.2371% |
| Mean signed throttle | 0.11636 | -0.17218 |
| Mean absolute throttle | 0.36975 | 0.35474 |
| Collision rate | 38.8746% | 24.4989% |
| Mean longest collision streak | 49.44 | 31.54 |
| Worst collision streak | 399 | 400 |
| Average episode length | 381.92 | 163.64 |
| Mean distance reward | +1.25867 | +4.55783 |
| Mean time reward | -3.81920 | -1.63640 |
| Mean collision reward | -26.72460 | -7.21620 |
| Mean goal reward | +1.25 | +17.25 |

The latest 100 stochastic training episodes reached 83% success with 26.2070 units
of mean net target progress, mean reward 20.6941, average length 166.31 steps,
collision rate 12.1400%, mean longest collision streak 3.52, and worst streak 32.
This stochastic success is reported separately and is not treated as evidence of
deterministic deployment quality, though here the two agree that the run works.

Conclusion: adding forward-looking sight was the decisive change. With eight rays,
the deterministic policy reached 69% success — the best in this project's history,
and higher than the body-only PPO_2 (60%) in the harder 19-point-collision arena.
Collision rate fell from 38.87% to 24.50%, mean longest collision streak from
49.44 to 31.54, and average episode length from 381.92 to 163.64, meaning the
robot now reaches the target and ends the episode rather than timing out. It
learned to keep its rays clear and steer around obstacles it can now perceive
before contact, which it never had a sensor for in PPO_8 through PPO_10.

Two honest caveats. First, the policy settled on a mostly-reverse gait (mean
signed throttle -0.17, 80.24% reverse steps): backing toward the target scores as
well as facing it, and PPO committed to it. This is a cosmetic quirk, not a
failure, because net progress is strongly positive. Second, 31% of episodes still
time out and one episode still reached a 400-step collision streak, so obstacle
recovery is improved but not solved.

Next decision: PPO_11 clearly passes the gate — deterministic success rose from 5%
to 69% with fewer collisions from a single controlled change. The recommended next
work is to confirm robustness with two additional fresh 100,000-step runs at
different seeds (three seeds total), changing only the seed and using distinct run
names and artifact directories. Do not change reward, sensors, collision response,
PPO settings, or rollout size for that replication. If the sensors repeat across
seeds, a longer or randomized-arena run becomes justified. A randomized-obstacle
or larger arena should not be attempted before sensors are confirmed, because the
earlier blind observation could only avoid obstacles by memorizing this one arena.

### PPO_11 seed replication

- Status: complete
- Purpose: confirm the 69% deterministic result is the sensor, not seed-7 luck
- Change from PPO_11: only the training seed. Reward, observation (18 values with
  eight rays), collision response, PPO settings, and 8,192-transition rollout are
  identical. The 100-episode deterministic evaluation still uses fixed seeds from
  10,000, so all three seeds sit the same exam.
- Runs: `PPO_11_S11` (seed 11, `rl_artifacts/ppo_11_ray_vision_seed11_100k/`) and
  `PPO_11_S23` (seed 23, `rl_artifacts/ppo_11_ray_vision_seed23_100k/`). Both
  collected 106,496 steps with empty stderr and no NaN in evaluation.

| Deterministic metric | Seed 7 (PPO_11) | Seed 11 | Seed 23 |
|---|---:|---:|---:|
| Success rate | 69% | 54% | 39% |
| Timeout rate | 31% | 46% | 61% |
| Mean reward | +12.9552 | -1.6964 | -10.4816 |
| Mean net target progress | 22.7891 | 19.5682 | 14.9277 |
| Collision rate | 24.4989% | 42.9224% | 42.0769% |
| Mean longest collision streak | 31.54 | 92.66 | 111.99 |
| Worst collision streak | 400 | 399 | 400 |
| Average episode length | 163.64 | 219.00 | 270.79 |
| Reverse steps | 80.24% | 65.91% | 58.53% |
| Stochastic training success | 83% | 88% | 93% |

Read: two findings, both important.

1. The ray sensor is confirmed, decisively. All three seeds tower over the blind
   PPO_10 baseline (5% deterministic, 0-10% stochastic). Stochastic training
   success is high and tight across seeds (83%, 88%, 93%), and deterministic
   success is 39-69% versus 5%. The jump is the sensor, not seed-7 luck.

2. But the collision-recovery failure is not solved, and it is seed-sensitive.
   Deterministic success spans 39-69% (mean about 54%), and seeds 11 and 23 spend
   about 43% of steps colliding with mean longest streaks of 92 and 112 steps.
   Seed 7 was the luckiest on collisions (24.5%), which flattered the first
   result. Every seed still has episodes that reach a ~400-step collision streak.

The gap between high stochastic success and lower, variable deterministic success
is the known mechanism: a collision rejects both translation and rotation, so a
deterministic policy that faces an obstacle re-issues the same rejected action and
loops until timeout, while stochastic exploration noise escapes. The rays let the
robot avoid many obstacles, but once it is stuck against one it still cannot
reliably turn out of contact.

Next decision: keep the rays permanently; they are a proven win. Do not extend
this exact configuration to 300k and do not move to a randomized or larger arena
yet, because the unsolved stuck-in-contact behavior would dominate there. The next
single controlled experiment is the one the ledger already anticipated: resolve
rotation and translation collisions independently so a touching robot can still
turn or reverse out of contact. Keep the rays, reward, PPO settings, and rollout
size unchanged for that test and change only the collision response. Re-run the
same three seeds afterward and compare collision rate, mean and worst collision
streak, and deterministic success.

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
rl_artifacts/ppo_11_ray_vision_smoke/
rl_artifacts/ppo_11_ray_vision_100k/
rl_artifacts/ppo_11_ray_vision_seed11_100k/
rl_artifacts/ppo_11_ray_vision_seed23_100k/
rl_artifacts/ppo_12_collision_recovery_smoke/
rl_artifacts/ppo_12_collision_recovery_100k/
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
