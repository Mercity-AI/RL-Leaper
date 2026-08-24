# Leaper RL Specification

Consolidated technical reference for the Leaper reinforcement-learning agent:
the sensors it reads, the actions it takes, the brain that maps one to the other,
and the environment and experiment design around it. This is the single place to
check exact values. **Keep it in sync** whenever the observation, action, physics,
reward, or PPO settings change — those changes also invalidate older trained
policies and must be recorded in `TRAINING.md`.

Source of truth in code: `rl_environment.py` (environment) and `train_rl.py`
(training/evaluation). Values below are current as of PPO_17.

---

## 1. Observation — what the agent senses (18 values)

The observation is a single flat vector of 18 float32 values in `[-1, 1]`
(`Box(-1.0, 1.0, (18,))`). Indices 0-9 are the navigation and one-step memory
channels; indices 10-17 are PPO_17's forward collision-aware vision sectors.

| Idx | Channel | Definition | Range |
|---:|---|---|---|
| 0 | position x | `x / WORLD_LIMIT` | [-1, 1] |
| 1 | position z | `z / WORLD_LIMIT` | [-1, 1] |
| 2 | target dir x | unit vector toward target, x | [-1, 1] |
| 3 | target dir z | unit vector toward target, z | [-1, 1] |
| 4 | distance | `clip(distance / (2√2·WORLD_LIMIT), 0, 1)` | [0, 1] |
| 5 | facing sin | `sin(yaw)` | [-1, 1] |
| 6 | facing cos | `cos(yaw)` | [-1, 1] |
| 7 | last collision | 1.0 if the previous step collided, else 0.0 | {0, 1} |
| 8 | prev throttle | previous step's signed throttle action | [-1, 1] |
| 9 | prev turn | previous step's turn action | [-1, 1] |
| 10-17 | eight forward safe-clearance sectors | see below | [0, 1] |

**Forward vision (indices 10-17).** Eight contiguous 25° sectors tile a 200° field
centred on the current facing, from `yaw - 100°` through `yaw + 100°`; the rear
160° is unseen. Each sector samples three evenly spaced translation directions
and exposes only the most conservative result. For every sample direction the
environment sweeps the same 19 collision circles used by physics—body plus three
points on each of six legs—against obstacle circles expanded by each point's
radius and against radius-adjusted arena walls. The nearest sampled collision
distance divided by `RAY_MAX_RANGE = 12.0` is returned. **1.0 = at least 12 units
of safe clearance; 0.0 = touching/immediately unsafe.**

This reports safe clearance for translating the current pose. It does not predict
the changed leg sweep from a future simultaneous rotation, and three samples per
sector remain a finite angular approximation. The brain receives no map, obstacle
coordinates, route, rear vision, or long-term obstacle memory. It still receives
the exact static target direction and distance through indices 2-4; the pink
target is a known destination, not visually recognized.

At `reset()`, `last_collision`, `prev throttle`, and `prev turn` are all 0.

---

## 2. Action — what the agent controls (2 values)

Action is `Box(-1.0, 1.0, (2,))`, clipped to range each step.

| Idx | Action | Effect |
|---:|---|---|
| 0 | signed throttle | `-1` full reverse, `0` stop, `+1` full forward; translation = `throttle · MOVE_SPEED` along the candidate facing |
| 1 | turn | yaw change = `turn · TURN_SPEED` |

`MOVE_SPEED = 0.75` units/step. `TURN_SPEED = 18°` (`radians(18)`) per step. The
signed throttle (PPO_10 onward) means reverse uses the candidate facing direction:
a negative throttle moves opposite the way the robot points.

---

## 3. Reward

Computed every step (`LeaperReachEnv.step`):

```
progress   = 0.2 * (previous_distance - current_distance)   # DISTANCE_REWARD_SCALE = 0.2
time       = -0.01                                           # STEP_PENALTY
collision  = -0.18 if collided else 0.0                      # COLLISION_PENALTY
goal       = +25.0 if reached else 0.0                       # GOAL_REWARD
reward     = progress + time + collision + goal
```

No alive, upright, energy, smoothness, fall, balance, or jump terms. "Reached"
means `distance <= TARGET_RADIUS + AGENT_RADIUS = 1.4 + 0.75 = 2.15`. The progress
term is symmetric, so moving away then back nets zero — an early cause of the
vibrating/idling behavior before sensors and signed throttle.

---

## 4. Collision model and response

**19 collision points** (`_collision_points`): the body center (radius
`AGENT_RADIUS = 0.75`) plus three sample points along each of six legs at radii
`(1.2, 2.2, 3.24)` from the body, each with radius `LEG_COLLISION_RADIUS = 0.24`.
Leg base angles: `(-0.62, 0.62, -1.57, 1.57, -2.42, 2.42)` relative to yaw. A pose
collides if any point is within `obstacle_radius + point_radius` of any obstacle,
or beyond the world boundary (`|coord| > WORLD_LIMIT - point_radius`). This is a
planar approximation of the articulated visual legs, not mesh physics.

**Obstacles** (randomized every episode, `(x, z, radius)`). `reset()` calls
`_generate_obstacles`, which samples `NUM_OBSTACLES` circles (PPO_14: 51; PPO_13:
10) with radii in `[2.5, 3.6]` (robot-relative, not scaled with the world), each
kept inside a `OBSTACLE_WALL_MARGIN = 4.0` band, at least
`OBSTACLE_TARGET_CLEARANCE = 6.0` off the target tile, and `OBSTACLE_SPACING = 1.5`
apart. It then re-rolls the whole layout until `_target_reachable` confirms the
goal connects to a large open region (coarse-grid flood-fill,
`REACHABILITY_MIN_FRACTION = 0.5`), so detours are allowed but a walled-off goal is
rejected. Generation uses `self.np_random`, so a reset seed reproduces its layout
and the fixed-seed evaluation is identical across runs. Through PPO_12 the arena
was five fixed obstacles `(-10,-5,3.2)`, `(1,4,3.0)`, `(10,11,2.8)`, `(-7,13,2.6)`,
`(12,-8,3.4)` in a `WORLD_LIMIT = 25` field; PPO_13/PPO_14 replaced that with the
larger randomized arena below.

**Response (PPO_12 decoupled).** Each step proposes a combined new pose
(`candidate_yaw` from the turn, `candidate` position from the throttle along that
new facing). If the combined pose is collision-free, both apply. If it collides,
rotation and translation are resolved independently: rotate in place if the turned
pose alone is clear, then translate along the resolved facing if that alone is
clear. This lets a touching robot turn or reverse out of contact instead of
freezing. The `collided` flag and its `-0.18` penalty still reflect the full
intended move, so reward semantics are unchanged from PPO_11. (Before PPO_12, a
collision rejected the whole move, so a deterministic policy could wedge and loop
until timeout.)

**Spawning.** After generating the episode's obstacles, `reset()` samples a
uniform position in `[-(WORLD_LIMIT-4), WORLD_LIMIT-4]²` and a uniform yaw,
rejecting any pose that collides or is within `TARGET_RADIUS + 2.0` of the target,
up to 10,000 tries.

---

## 5. Environment constants

| Constant | Value |
|---|---|
| World boundary | `[-93.75, 93.75]` on both axes (`WORLD_LIMIT = 93.75`; 62.5 for PPO_13, 25 through PPO_12) |
| Target | `(-40, -10)`, `TARGET_RADIUS = 1.4` (was `(45,45)` PPO_13, `(18,18)` through PPO_12) |
| Agent body radius | `AGENT_RADIUS = 0.75` |
| Obstacles | `NUM_OBSTACLES = 51`, randomized per episode + reachability re-roll, radii `[2.5, 3.6]` (10 for PPO_13, 5 fixed through PPO_12) |
| Max episode length | `MAX_STEPS = 1000` (was `400` through PPO_12) |
| Move / turn speed | `0.75` units / `18°` per step |
| Ray count / range | `RAY_COUNT = 8`, `RAY_MAX_RANGE = 12.0` |
| Reward scales | progress `0.2`, time `-0.01`, collision `-0.18` (PPO_15 tried `-0.5`, reverted), goal `+25` |
| Stuck rule (PPO_16) | `STUCK_LIMIT = 40` consecutive collide-and-no-progress steps -> terminal failure + one-time `STUCK_PENALTY = 10` (reported in the collision term) |

---

## 6. Model architecture and parameter count

Stable-Baselines3 `PPO` with the default `MlpPolicy` (`ActorCriticPolicy`). Input
is flattened (no-op `FlattenExtractor` for the 18-value vector). Actor and critic
are **separate** two-layer MLPs, 64 units each, `tanh` activations.

```
observation (18)
├── policy net:  Linear(18→64) → Tanh → Linear(64→64) → Tanh → action_net Linear(64→2)   # action mean
│                 + log_std (2)   state-independent log standard deviation
└── value  net:  Linear(18→64) → Tanh → Linear(64→64) → Tanh → value_net  Linear(64→1)    # state value
```

Actions are continuous, sampled during training from a Gaussian with the predicted
mean and the learned `log_std`; deployment/evaluation uses the mean
(deterministic). Exact trainable parameter counts (verified from the PPO_12 model):

| Component | Params |
|---|---:|
| policy MLP (18→64→64) | 5,376 |
| action head (64→2) | 130 |
| log_std | 2 |
| **Actor subtotal** | **5,508** |
| value MLP (18→64→64) | 5,376 |
| value head (64→1) | 65 |
| **Critic subtotal** | **5,441** |
| **Total trainable** | **10,949** |

This is a small network; it runs on CPU (`device="auto"` resolves to CPU here;
`torch` is the CPU build). It is **not** a CNN — the input is a short numeric
vector, not an image, so an MLP is the correct and deliberate choice.

---

## 7. PPO hyperparameters

Set in `train_rl.py`; identical across PPO_8 through PPO_12 (only observation,
action, reward, physics, or seed changed between experiments).

| Hyperparameter | Value |
|---|---|
| learning_rate | `3e-4` |
| n_steps (per env) | `1024` |
| parallel environments | `8` (`DummyVecEnv`) |
| rollout size | `1024 × 8 = 8,192` transitions |
| batch_size | `256` |
| n_epochs | `10` |
| gamma | `0.995` |
| gae_lambda | `0.95` |
| ent_coef | `0.01` |
| clip_range, vf_coef, max_grad_norm | SB3 defaults (`0.2`, `0.5`, `0.5`) |
| seed | natural/random from PPO_12 on (was fixed `7` through PPO_11) |

Because PPO completes whole 8,192-transition rollouts, a requested 100,000-step
run collects 106,496 steps.

---

## 8. Evaluation protocol

- **Deterministic exam** (`evaluate_diagnostics`): 100 episodes, fixed seeds
  `10,000 … 10,099`, actions taken as the policy mean. This exam is identical for
  every run regardless of training seed, so cross-run comparison is fair. Reports
  success/timeout, mean reward, net target progress, forward/reverse/stopped step
  %, mean signed and absolute throttle, collision rate, mean and worst collision
  streak, average episode length, and the reward breakdown.
- **Stochastic summary**: the latest 100 on-policy training episodes, reported
  separately. Never treat stochastic training success as deployment success.
- Both are written to each run's `final_evaluation.json`; per-episode training
  diagnostics go to `training_diagnostics.csv`.

---

## 9. Experiment history (summary)

Full detail with tables and conclusions is in `TRAINING.md`. Deterministic success
on the fixed 100-episode exam:

| Run | One controlled change | Deterministic success | Note |
|---|---|---:|---|
| PPO_8 | distance-change reward, no obstacle sensor | 0% | froze (zero throttle) |
| PPO_9 | + collision memory (obs 7→10) | 0% | still froze |
| PPO_10 | signed throttle `[-1, 1]` | 5% | freeze fixed; grinds on obstacles (38.9% collision) |
| PPO_11 | + eight clearance rays (obs 10→18) | 69% / 54% / 39% (3 seeds) | decisive win; collisions still 24-43% |
| PPO_12 | decoupled collision response | 65% (1 natural seed) | can turn/reverse out; jams shorter, collision rate ~40% |

**Current recommended next experiment (PPO_13):** raise the collision penalty above
`-0.18` to discourage grinding, keeping rays, decoupled physics, PPO settings, and
rollout size unchanged. Alternative single change: denser or longer-range rays.

---

## 10. Change checklist

When any of these change, update this file **and** `TRAINING.md`, add or adjust the
focused tests under `tests/`, and start a fresh model (older policies become
incompatible):

- Observation channels or size → §1, model input in §6
- Action space or speeds → §2, §5
- Reward terms or amounts → §3
- Collision geometry or response → §4
- Environment constants → §5
- Model architecture or PPO hyperparameters → §6, §7
