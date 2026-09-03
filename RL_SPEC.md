# Leaper RL Specification

Consolidated technical reference for the Leaper reinforcement-learning agent:
the sensors it reads, the actions it takes, the brain that maps one to the other,
and the environment and experiment design around it. This is the single place to
check exact values. **Keep it in sync** whenever the observation, action, physics,
reward, or PPO settings change — those changes also invalidate older trained
policies and must be recorded in `TRAINING.md`.

Source of truth in code: `rl_environment.py` (environment) and `train_rl.py`
(training/evaluation). The default env is unchanged from PPO_28 (`[0,1]`
throttle); the PPO_29 seeker line activates the normalized-throttle, general-freeze,
and scan changes below via CLI flags.

## PPO_29 changes — IMPLEMENTED (2026-09-02, active in the seeker line)

These are behind flags, so the class defaults still reproduce PPO_28; the seeker
runs pass the flags. See `TRAINING.md` for full results.

- **Normalized throttle** (`--normalized-throttle`, class flag `NORMALIZED_THROTTLE`,
  default off). Policy throttle output becomes `[-1,1]` and maps to a forward-only
  physical throttle via `physical_throttle()` = `(action[0]+1)/2`: `-1=stop`,
  `0=half`, `1=full`. NOT the old signed/reverse throttle — reverse stays
  impossible. Fixes the PPO_28 clip-to-zero freeze: stopped steps fell 56.73% -> ~6%.
- **General-freeze rule** (`FREEZE_LIMIT=60`, `FREEZE_PENALTY=10`, flags
  `--freeze-limit/--freeze-penalty`). Terminal failure after 60 consecutive
  no-translation steps (turning in place counts; real translation resets it),
  reported in the `time` reward bucket, `info["frozen"]`. Separate from the 40-step
  collision-stuck rule (stuck fires first for wedged contact).
- **Scan nudge** (`SCAN_REWARD=0.01`, flag `--scan-reward`, in the `exploration`
  bucket). Small reward for facing each new heading bin before first sight, capped
  at one revolution/episode via `scanned_headings`, off after discovery.
- **Warm-transfer** (`--warm-transfer`): loads a donor with no env (skips SB3's
  action-space check), builds a fresh normalized-action model, copies
  `policy.state_dict()`, keeps the fresh optimizer.
- Result: PPO_29 (memoryless) = **69%** deterministic, freeze cured, and is the
  current seeker champion. The recurrent memory brain (PPO_30, `--memory lstm`) was
  tested for search and LOST (39-53%, unstable) — memory line closed for the static
  target. Remaining blocker = search/discovery (~30% never find the target).

---

## 1. Observation — what the agent senses (26 values)

The observation is a flat vector of 26 float32 values in `[-1, 1]`
(`Box(-1.0, 1.0, (26,))`). The target has semantic identity (the object tagged
as the goal), but its coordinates are private environment state: the policy gets
no target bearing or distance until the target is inside its 270° sight cone,
within 28 units, and not occluded by an obstacle. This is ray/geometry perception,
not pixel recognition.

| Idx | Channel | Definition | Range |
|---:|---|---|---|
| 0 | target visible | 1 only while the tagged target is currently visible | {0, 1} |
| 1 | target memory age | steps since sight, divided by 120; 1 before sight/after expiry | [0, 1] |
| 2 | remembered target dir x | world-space unit x toward the visible/last-seen target; 0 before first sight | [-1, 1] |
| 3 | remembered target dir z | world-space unit z toward the visible/last-seen target; 0 before first sight | [-1, 1] |
| 4 | remembered distance | visible/last-seen distance normalized by arena diagonal; 1 before first sight | [0, 1] |
| 5 | facing sin | `sin(yaw)` | [-1, 1] |
| 6 | facing cos | `cos(yaw)` | [-1, 1] |
| 7 | last collision | 1.0 if the previous step collided, else 0.0 | {0, 1} |
| 8 | prev throttle | previous step's forward throttle action | [0, 1] |
| 9 | prev turn | previous step's turn action | [-1, 1] |
| 10-25 | sixteen forward rangefinder rays | see below | [0, 1] |

**Forward vision (indices 10-25).** Sixteen thin rangefinder rays fan across a **270°**
forward field centred on the current facing (`VISION_FOV = 270°`), from `yaw - 135°`
through `yaw + 135°`; the rear 90° wedge is unseen. The rays sit at the centres of
sixteen equal 16.875° sectors, so they are symmetric about straight-ahead (the two
central rays straddle the forward direction). Each ray is a simple rangefinder cast
from the body centre: it returns the distance to the nearest obstacle surface or
arena wall along that heading, divided by `RAY_MAX_RANGE = 28.0` and clipped to
`[0, 1]`. **1.0 = clear for at least 28 units; 0.0 = at the surface.**

This is the simple PPO_11-16 sensor (a point ray from the body centre), re-aimed
into a forward human cone with a longer range; it does not model the swept leg
footprint. The brain receives no map, obstacle coordinates, route, rear vision, or
target coordinates. Target memory lasts 120 steps and keeps only the last-seen
target location. A future mesh can replace the pink cuboid without changing the
brain as long as the game tags that object as the same semantic target.

At `reset()`, collision/actions are 0 and target memory is unknown unless the
randomized spawn happens to have clear initial sight.

---

## 2. Action — what the agent controls (2 values)

Action is `Box(low=[0, -1], high=[1, 1], shape=(2,))`, clipped to range each step.

| Idx | Action | Effect |
|---:|---|---|
| 0 | forward throttle | `0` stop … `+1` full forward (reverse removed in PPO_18); translation = `throttle · MOVE_SPEED` along the candidate facing |
| 1 | turn | yaw change = `turn · TURN_SPEED` |

`MOVE_SPEED = 0.375` units/step. `TURN_SPEED = 9°` (`radians(9)`) per step. PPO_28
halves both together, preserving the turning radius, and doubles the episode cap
to preserve PPO_27's approximate physical search horizon. PPO_18
makes throttle **forward-only** `[0, 1]` (reverse removed): the robot always
translates along its facing, so it travels only into its 270° visible cone and never
into its blind spot. PPO_10 through PPO_17 used a signed `[-1, 1]` throttle where
negative reversed along the candidate facing.

---

## 3. Reward

Computed every step (`LeaperReachEnv.step`):

```
pursuit progress = 0.2 * symmetric clipped distance improvement after first sight
search best      = 0.1 * positive improvement beyond episode's best distance
new cell         = +0.01 before first sight only
new cell+heading = +0.002 before first sight only
first-ever sight = +0.5 once per episode
time             = -0.002
idle             = -0.04 after 15 repeated no-move/no-new-view steps
collision        = -0.18
stuck            = -10.0 once, then terminal after 40 blocked steps
goal             = +25.0
```

No alive, upright, energy, smoothness, fall, balance, or jump terms. "Reached"
means `distance <= TARGET_RADIUS + AGENT_RADIUS = 1.4 + 0.75 = 2.15`. The progress
reward cannot reveal the target while hidden. The new-best term is positive-only:
backtracking during search does not accumulate a long stream of negatives, but the
agent still gets a directional clue when it genuinely discovers a better area.

- **`idle`:** a genuinely new heading view resets the counter, so purposeful
  scanning is free. Repeating the same view without translating for more than
  `IDLE_GRACE = 15` steps receives the proven `-0.04` freeze penalty.
- **`stuck` (PPO_16):** one-time terminal failure when the robot collides with no
  forward progress for `STUCK_LIMIT = 40` consecutive steps; reported inside the
  `collision` diagnostics bucket.

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
`_generate_obstacles`, which samples `NUM_OBSTACLES = 6` circles with radii in
`[2.5, 3.6]` (robot-relative, not scaled with the world), each
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
clear. This lets a touching robot turn out of contact (and, through PPO_17, reverse
out) instead of freezing; since PPO_18 removed reverse, escape now comes from
rotating in place plus the stuck rule (§5). The `collided` flag and its `-0.18`
penalty still reflect the full
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
| World boundary | `[-31.25, 31.25]` on both axes: one-third of PPO_25's 187.5-wide arena |
| Target | randomized every episode with semantic target identity; `TARGET_RADIUS = 1.4` |
| Agent body radius | `AGENT_RADIUS = 0.75` |
| Obstacles | `NUM_OBSTACLES = 6`, randomized per episode + reachability re-roll, radii `[2.5, 3.6]` |
| Max episode length | `MAX_STEPS = 1000` |
| Move / turn speed | `0.375` units / `9°` per step (both half PPO_27, same turning radius) |
| Vision | **`RAY_COUNT = 16`** thin rays across `VISION_FOV = 270°`, `RAY_MAX_RANGE = 28.0` (PPO_23 doubled 8→16; range 45 tried in PPO_24/26 and reverted; was 12.0 and 360°/200° through PPO_17). Observation size is `10 + RAY_COUNT = 26` |
| Throttle | forward-only `[0, 1]` from PPO_18 (was signed `[-1, 1]` PPO_10-17) |
| Reward scales | post-sight symmetric progress `0.2`, pre-sight new-best progress `0.1`, first-ever sight `+0.5`, pre-sight new cell/view `+0.01/+0.002`, time `-0.002`, idle `-0.04`, collision `-0.18`, goal `+25` |
| Idle penalty | `IDLE_PENALTY = 0.04` after `IDLE_GRACE = 15` no-move steps that reveal no new heading view |
| Stuck rule (PPO_16) | `STUCK_LIMIT = 40` consecutive collide-and-no-progress steps -> terminal failure + one-time `STUCK_PENALTY = 10` (reported in the collision term) |

---

## 6. Model architecture and parameter count

> **Note (current seeker):** PPO_27 uses the same 26-value input and 64×64
> actor/critic architecture as PPO_25. It warm-starts PPO_25, zeros the first-layer
> connections from repurposed channels 0-1, and clears old Adam optimizer state.
> Channels 5-25 preserve facing, action/collision memory, and all obstacle rays;
> channels 2-4 remain goal direction/distance only after sight. The historical
> table below is anchored to the PPO_12-era
> **18-value** observation (8 rays). Since **PPO_23** the observation is **26**
> (10 base + 16 rays), so the input layer is `Linear(26→64)` for both nets and the
> totals are correspondingly larger; recompute from the current model if an exact
> count is needed. Everything else (64×64 `tanh` MLPs, heads, `log_std`) is unchanged.

Stable-Baselines3 `PPO` with the default `MlpPolicy` (`ActorCriticPolicy`). Input
is flattened (no-op `FlattenExtractor` for the observation vector — 18 through
PPO_18, **26 from PPO_23's 16 rays**). Actor and critic are **separate** two-layer
MLPs, 64 units each, `tanh` activations.

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
| PPO_13 | larger randomized arena (10 obs, 62.5 field, 300k) | 85% | generalizes to unseen mazes; low collisions partly open-field geometry |
| PPO_14 | dense hard arena (51 obs, 93.75 field, SW target) | 54% | freeze returns under density; collisions 15.9% |
| PPO_15 | collision penalty `-0.18 → -0.5` | 51% | mixed; less contact but timid, freeze persists |
| PPO_16 | terminal stuck rule (40 steps, penalty 10) | 64% | freeze fixed; collisions collapse to 1.35%, forward 70% |
| PPO_17 | 200° forward collision-aware sectors | 8% | discarded; timid, half-blind while still reversing |
| PPO_18 | 270° human cone + forward-only, range 12→28 | 75% | best on hard arena; decisive forward gait, no freeze |
| PPO_19-21 | recurrent LSTM memory (3 learning rates) | 71% / 69% | dismissed; memory does not beat memoryless PPO_18 |
| PPO_22 | wider network 64×64 → 256×256 | 74% | dismissed; capacity is not the bottleneck (tie) |
| PPO_23 | sharper eyes, `RAY_COUNT` 8 → 16 | 86/73/87/80 → 81.5% | confirmed +5 pt win but high-variance seed lottery |
| PPO_24 | range 28 → 45 (longer sight) | 80% (1 seed) | dismissed; inside PPO_23 noise; blocker is nerve |
| **PPO_25** | **+ idle penalty (tax on standing still)** | **89/92/93/92 → 91.5%** | ✅ **CHAMPION**; variance killed, mean +10 pt, 1,000-maze = 91.3% |
| PPO_26 | idle penalty + range 45 | 80/84/82 → 82% | dismissed; longer range hurts even with the nerve fix |

**New task from PPO_27 on: the SEEKER world** (hidden, randomized target — direction/distance
withheld until line-of-sight, then remembered — in a smaller 62.5-wide, 6-obstacle
arena). This is a harder, different exam than PPO_1-26 (where the target direction
was always known), so its scores are NOT comparable to the 91-93% above.

| Run | One controlled change | Deterministic success | Note |
|---|---|---:|---|
| PPO_27 | first seeker (hidden target) | 64% | search proof-of-concept; `+0.5` reacquire reward caused an orbit exploit |
| PPO_28 | slow seeker (½ speed/turn, first-sight-only reward) | 71% | orbit fixed; but 56.7% stopped steps (Gaussian throttle clipped to 0 by `[0,1]`) |
| PPO_29 | normalized throttle + freeze rule + scan nudge | **69%** | ✅ **SEEKER CHAMPION**; freeze cured (stopped 57%→6%), but success flat — blocker is search/discovery |
| PPO_30 | recurrent LSTM memory (200k / 500k) | 53% / 39% | dismissed; memory is worse AND unstable on search — internal-memory line closed |
| PPO_31 | 2-layer LSTM + 5x exploration reward (250k) | ~20% @164k | ABORTED (OOM at 164k); flattened ~20-24%, worse still; boosted reward → "professional wanderer"; from-scratch LSTM closed a 2nd time |

**Status (two tracks):**
- **Known-target world:** target met, **Champion = PPO_25** (16 rays · range 28 ·
  forward-only · idle-penalty 0.04 / grace 3), seed 911743 = 93% exam / 91.3% on
  1,000 fresh mazes. This is the DEPLOYED web-game brain.
- **Seeker world (current work):** fallback **Champion = PPO_29** (memoryless, 69%,
  normalized throttle + freeze rule + scan nudge). Internal-memory LSTM ruled out
  TWICE (PPO_30, PPO_31). Remaining blocker = finding the hidden target (~30%
  timeout). **DECIDED DIRECTION (2026-09-03):** add memory as **state augmentation**
  — an explicit **coverage/visitation map** ("been-there radar", only cells actually
  visited/seen) fed as extra observation inputs, warm-started on PPO_29, targeting
  **≥85%**, then a slowly moving target (upgrade the `last_seen_target` note to carry
  heading). Never feed the full map or hidden target position. Densify-the-arena is a
  paused later stage. See `TRAINING.md` / `AGENTS.md` for full detail.

The known-target arc: memory ❌ → bigger brain ❌ → sharper eyes ✅ (but a lottery) →
idle penalty ✅ (reliable). Longer range (PPO_24/26) ruled out. See `TRAINING.md`,
`RUN_LOG_PPO23-26.md`, and `Leaper_RL_Case_Study.pdf` for the known-target detail.

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
